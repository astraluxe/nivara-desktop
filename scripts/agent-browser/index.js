#!/usr/bin/env node
// adris.tech agent-browser — Playwright wrapper using system Chrome.
// Techniques from: browser-use (CDP element detection, accessibility tree),
//   firecrawl (Markdown conversion, content-type detection, wait strategies),
//   crawl4ai (multi-metric scoring, word-threshold filtering, content stability),
//   crawlee (progressive infinite scroll, network-idle detection, cookie handling).

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const http = require('http');

const PROFILE_DIR = process.env.AGENT_BROWSER_PROFILE || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'adris.tech', 'browser-session')
    : path.join(os.homedir(), '.local', 'share', 'adris-tech', 'browser-session')
);

const CDP_PORT  = 9223;
const CDP_URL   = 'http://localhost:' + CDP_PORT;
const STATE_FILE  = path.join(PROFILE_DIR, '.agent-state.json');
const LAUNCH_LOCK = path.join(PROFILE_DIR, '.launch.lock');

// Atomic file-based lock — prevents concurrent node processes from all calling
// launchPersistentContext simultaneously when none has started the browser yet.
async function acquireLaunchLock(maxWaitMs) {
  var deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LAUNCH_LOCK, String(process.pid), { flag: 'wx' });
      return true; // acquired
    } catch (_) {
      await new Promise(function(r) { setTimeout(r, 200); });
    }
  }
  // Timed out — stale lock, proceed anyway
  try { fs.unlinkSync(LAUNCH_LOCK); } catch (_) {}
  return false;
}
function releaseLaunchLock() {
  try { fs.unlinkSync(LAUNCH_LOCK); } catch (_) {}
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { url: null }; }
}
function writeState(data) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch {}
}

// Detect login / auth-wall pages so the LLM gets a clear structured signal.
function isAuthWall(url) {
  return /\/(login|signin|checkpoint|authwall|challenge|uas\/login|session-redirect|sso\/login)|\/login\?|accounts\.google\.com|appleid\.apple\.com\/auth|auth\.linkedin\.com/.test(url);
}

async function isBrowserRunning() {
  return new Promise(function(resolve) {
    http.get(CDP_URL + '/json/version', function(res) {
      resolve(res.statusCode === 200);
      res.resume();
    }).on('error', function() { resolve(false); }).setTimeout(1500, function() { resolve(false); });
  });
}

// Wait until the page body has at least minChars of text, polling every 500 ms.
async function waitForContent(page, minChars, maxWait) {
  var deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    var len = await page.evaluate(function() {
      return (document.body && document.body.innerText || '').length;
    }).catch(function() { return 0; });
    if (len >= minChars) return true;
    await new Promise(function(r) { setTimeout(r, 500); });
  }
  return false;
}

// Wait until body text length stops growing — content is stable (crawl4ai pattern).
async function waitForContentStability(page, minChars, maxWait) {
  var deadline = Date.now() + maxWait;
  var lastLen = 0;
  var stableCount = 0;
  while (Date.now() < deadline) {
    var len = await page.evaluate(function() {
      return (document.body && document.body.innerText || '').length;
    }).catch(function() { return 0; });
    if (len >= minChars && len === lastLen) {
      stableCount++;
      if (stableCount >= 2) return true;
    } else {
      stableCount = 0;
    }
    lastLen = len;
    await new Promise(function(r) { setTimeout(r, 600); });
  }
  return lastLen >= minChars;
}

// Platform-specific element waiting — wait until real content elements appear (firecrawl pattern).
async function waitForPlatformContent(page, hostname) {
  try {
    if (hostname.includes('linkedin.com')) {
      // LinkedIn feed posts or profile content
      await page.waitForSelector(
        '.feed-shared-update-v2, .occludable-update, .scaffold-layout__main, [data-urn], .artdeco-card',
        { timeout: 8000 }
      );
    } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      await page.waitForSelector('[data-testid="tweet"], [data-testid="tweetText"]', { timeout: 8000 });
    } else if (hostname.includes('mail.google.com')) {
      await page.waitForSelector('.zA, [role="main"]', { timeout: 8000 });
    } else if (hostname.includes('reddit.com')) {
      await page.waitForSelector('[data-testid="post-container"], .Post, shreddit-post', { timeout: 8000 });
    } else if (hostname.includes('github.com')) {
      await page.waitForSelector('.repository-content, .js-repo-nav, main', { timeout: 8000 });
    } else {
      await page.waitForSelector('main, article, [role="main"], body', { timeout: 5000 });
    }
  } catch (_) {
    // Selector not found within timeout — page may still have content, continue
  }
}

// Progressive multi-step scroll (crawlee infinite scroll pattern).
// Scrolls the window AND the platform's main scroll container in 4 steps.
async function progressiveScroll(page) {
  var steps = 4;
  for (var i = 1; i <= steps; i++) {
    var ratio = (i / steps) * 0.8;
    await page.evaluate(function(r) {
      var scrollTargets = [
        document.querySelector('.scaffold-layout__main'),  // LinkedIn
        document.querySelector('[data-finite-scroll-hotkey-context]'),  // LinkedIn alt
        document.querySelector('main') || document.querySelector('[role="main"]'),
        document.querySelector('#main-content'),
        document.body,
      ].filter(Boolean);
      scrollTargets.forEach(function(el) {
        el.scrollTop = Math.floor(el.scrollHeight * r);
      });
      window.scrollTo(0, Math.floor(document.body.scrollHeight * r));
    }, ratio).catch(function() {});
    await new Promise(function(r) { setTimeout(r, 700); });
  }
}

// Legacy single-scroll kept for backwards compat (used by navigate command).
async function scrollForContent(page) {
  await page.evaluate(function() {
    var main = document.querySelector('main') ||
               document.querySelector('[role="main"]') ||
               document.querySelector('.scaffold-layout__main') ||
               document.querySelector('#main-content') ||
               document.body;
    var target = Math.floor(main.scrollHeight * 0.4);
    main.scrollTop = target;
    window.scrollTo(0, Math.floor(document.body.scrollHeight * 0.4));
  }).catch(function() {});
}

// LinkedIn-specific feed post extraction.
// Returns structured JSON array — clean data the AI can parse directly.
async function extractLinkedInFeed(page) {
  var posts = await page.evaluate(function() {
    var selectors = ['.feed-shared-update-v2', '.occludable-update', '[data-urn*="activity"]'];
    var nodes = [];
    for (var si = 0; si < selectors.length; si++) {
      nodes = Array.from(document.querySelectorAll(selectors[si]));
      if (nodes.length > 0) break;
    }
    if (nodes.length === 0) return null;

    return nodes.slice(0, 15).map(function(post) {
      // Author name
      var authorEl = post.querySelector(
        '.feed-shared-actor__name, .update-components-actor__name, [class*="actor__name"]'
      );
      var author = authorEl ? (authorEl.innerText || '').trim().split('\n')[0].trim() : '';

      // Author role / headline
      var roleEl = post.querySelector(
        '.feed-shared-actor__description, .update-components-actor__description, [class*="actor__description"]'
      );
      var role = roleEl ? (roleEl.innerText || '').trim().split('\n')[0].trim() : '';

      // Post time
      var timeEl = post.querySelector('time, [class*="actor__sub-description"]');
      var posted = '';
      if (timeEl) {
        posted = timeEl.getAttribute('datetime') ||
                 (timeEl.innerText || '').trim().replace(/·.*/g, '').trim();
      }

      // Post content
      var contentEl = post.querySelector(
        '.feed-shared-text, .feed-shared-update-v2__description, ' +
        '.feed-shared-inline-show-more-text, [class*="commentary"], .update-components-text'
      );
      var content = contentEl ? (contentEl.innerText || '').trim() : '';
      if (!content || content.length < 10) {
        content = (post.innerText || '').trim()
          .split('\n').filter(function(l) { return l.trim().length > 5; })
          .slice(0, 12).join('\n');
      }

      // Engagement
      var reactEl = post.querySelector('[aria-label*="reaction"], [class*="social-count"] span');
      var reactions = reactEl ? (reactEl.getAttribute('aria-label') || reactEl.innerText || '').replace(/\s+/g,' ').trim() : '';
      var cmtEl = post.querySelector('[aria-label*="comment"], [class*="social-count"] ~ span');
      var comments_count = cmtEl ? (cmtEl.getAttribute('aria-label') || cmtEl.innerText || '').replace(/\s+/g,' ').trim() : '';

      if (!content || content.length < 15) return null;
      return {
        author:    author   || 'Unknown',
        role:      role,
        posted:    posted,
        content:   content,
        reactions: reactions,
        comments:  comments_count,
      };
    }).filter(Boolean);
  }).catch(function() { return null; });

  if (!posts || posts.length === 0) return null;

  // Format as readable feed for the AI
  var formatted = '=== LinkedIn Feed — ' + posts.length + ' posts ===\n\n' +
    posts.map(function(p, i) {
      var header = (i + 1) + '. ' + p.author;
      if (p.role)    header += ' (' + p.role + ')';
      if (p.posted)  header += '  ·  ' + p.posted;
      var engagement = [p.reactions, p.comments].filter(function(s) { return s && s.length > 0; }).join('  ·  ');
      return header + (engagement ? '\n   ' + engagement : '') + '\n\n' + p.content;
    }).join('\n\n---\n\n');

  return formatted;
}

// Poll for auth-wall exit — waits for URL to change away from login page.
// Used after authwall is detected so the agent browser can auto-recover after user logs in.
// maxWait should be ≤ 38000 to stay within Rust's 45-second process timeout.
async function pollForLoginCompletion(page, maxWait) {
  var deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    await new Promise(function(r) { setTimeout(r, 2500); });
    try {
      var cur = page.url();
      if (!isAuthWall(cur)) return true;
    } catch (_) { return false; }
  }
  return false;
}

async function main() {
  var argv = process.argv.slice(2);
  var cmd  = argv[0] || '';

  if (cmd === 'install') {
    try {
      require('playwright-core');
      process.stdout.write('agent-browser ready (playwright-core + system Chrome)\n');
    } catch (_) {
      process.stderr.write('playwright-core not installed\n');
      process.exit(1);
    }
    return;
  }

  var chromium = require('playwright-core').chromium;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // ── Interactive commands ───────────────────────────────────────────────────
  if (cmd !== 'open' && cmd !== 'close') {
    var running = await isBrowserRunning();
    var state   = readState();
    var context, browser;

    if (running) {
      try {
        browser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
        var ctxs = browser.contexts();
        context = ctxs.length > 0 ? ctxs[0] : null;
      } catch (_) { browser = null; }
    }

    if (!context) {
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome', headless: false,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled',
               '--disable-infobars', '--remote-debugging-port=' + CDP_PORT],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }

    var page = context.pages().at(-1) || await context.newPage();

    if ((page.url() === 'about:blank' || page.url() === '') && state.url) {
      await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(function() {});
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) {}
    }

    // ── navigate ─────────────────────────────────────────────────────────────
    if (cmd === 'navigate') {
      var navRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
      var navUrl = navRaw.startsWith('http') ? navRaw : 'https://' + navRaw;
      await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch (_) {}

      var navHostname = '';
      try { navHostname = new URL(navUrl).hostname; } catch (_) {}
      await waitForPlatformContent(page, navHostname);
      await progressiveScroll(page);
      await new Promise(function(r) { setTimeout(r, 1500); });

      var navFinal = page.url();
      writeState({ url: navFinal });
      if (isAuthWall(navFinal)) {
        process.stdout.write('[SIGN_IN_REQUIRED] Redirected to a login page at ' + navFinal + '. The user needs to sign in in the ADRIS agent browser window (separate from their regular Chrome). Once signed in, retry the request — the session will be saved automatically.');
        return;
      }
      process.stdout.write('Navigated to: ' + navFinal);
      return;
    }

    // ── snapshot ─────────────────────────────────────────────────────────────
    if (cmd === 'snapshot') {
      var tree = await page.evaluate(function() {
        var idx = 0;
        var INTERACTIVE_ROLES = [
          'button','link','checkbox','radio','option','menuitem','menuitemcheckbox',
          'menuitemradio','tab','switch','treeitem','listitem','row','combobox',
          'spinbutton','slider','textbox','searchbox','gridcell',
        ];
        var INTERACTIVE_TAGS = ['a','button','input','select','textarea','summary'];

        function isInteractive(el) {
          if (!el || !el.tagName) return false;
          var tag = el.tagName.toLowerCase();
          if (INTERACTIVE_TAGS.includes(tag)) return true;
          var role = el.getAttribute('role') || '';
          if (role && INTERACTIVE_ROLES.includes(role)) return true;
          if (el.getAttribute('tabindex') === '0') return true;
          if (el.getAttribute('onclick')) return true;
          if (el.getAttribute('contenteditable') === 'true') return true;
          return false;
        }

        function getLabel(el) {
          return (
            el.getAttribute('aria-label') ||
            el.innerText || el.textContent ||
            el.getAttribute('placeholder') ||
            el.getAttribute('title') || ''
          ).trim().replace(/\n/g, ' ').slice(0, 100);
        }

        function walk(el, depth) {
          if (!el || !el.tagName) return '';
          var tag = el.tagName.toLowerCase();
          if (['script','style','noscript','svg','head'].includes(tag)) return '';
          var line = '';
          if (isInteractive(el)) {
            var label = getLabel(el);
            if (label || el.getAttribute('placeholder')) {
              el.setAttribute('data-aref', 'e' + (++idx));
              var indent = '  '.repeat(Math.min(depth, 6));
              var type  = el.getAttribute('type')        ? ' type='         + el.getAttribute('type')         : '';
              var ph    = el.getAttribute('placeholder') ? ' placeholder="' + el.getAttribute('placeholder') + '"' : '';
              var href  = el.getAttribute('href')        ? ' href="'        + (el.getAttribute('href')||'').slice(0,60) + '"' : '';
              var role  = el.getAttribute('role')        ? ' role='         + el.getAttribute('role')         : '';
              var chk   = el.checked !== undefined && el.checked ? ' checked' : '';
              line = indent + '[@' + el.getAttribute('data-aref') + '] <' + tag + type + ph + href + role + chk + '> ' + label + '\n';
            }
          }
          return line + Array.from(el.children).map(function(c) { return walk(c, depth + 1); }).join('');
        }
        return walk(document.body, 0);
      });
      process.stdout.write((tree || '').trim() || '(no interactive elements found)');
      return;
    }

    // ── click ─────────────────────────────────────────────────────────────────
    if (cmd === 'click') {
      var sel = (argv[1] || '').replace(/^"|"$/g, '').trim();
      if (!sel) { process.stdout.write('click: missing selector'); return; }

      if (sel.startsWith('@')) {
        var ref = sel.slice(1);
        await page.evaluate(function(r) {
          var el = document.querySelector('[data-aref="' + r + '"]');
          if (!el) throw new Error('ref @' + r + ' not found — call snapshot first');
          el.click();
        }, ref);
      } else {
        await page.click(sel, { timeout: 10000 });
      }

      try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch (_) {}
      var newUrl = page.url();
      writeState({ url: newUrl });
      process.stdout.write('Clicked "' + sel + '". Page: ' + newUrl);
      return;
    }

    // ── fill ───────────────────────────────────────────────────────────────────
    if (cmd === 'fill') {
      var fillSel  = argv[1] || '';
      var fillText = argv.slice(2).join(' ');
      if (!fillSel) { process.stdout.write('fill: missing selector'); return; }

      if (fillSel.startsWith('@')) {
        var fillRef = fillSel.slice(1);
        await page.evaluate(function(args) {
          var el = document.querySelector('[data-aref="' + args.r + '"]');
          if (!el) throw new Error('ref @' + args.r + ' not found');
          el.focus();
          el.value = args.t;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { r: fillRef, t: fillText });
      } else {
        await page.fill(fillSel, fillText, { timeout: 10000 });
      }
      writeState({ url: page.url() });
      process.stdout.write('Filled "' + fillSel + '" with the provided text.');
      return;
    }

    // ── screenshot ─────────────────────────────────────────────────────────────
    if (cmd === 'screenshot') {
      var buf = await page.screenshot({ type: 'jpeg', quality: 72 });
      process.stdout.write('data:image/jpeg;base64,' + buf.toString('base64'));
      return;
    }

    // ── get text ───────────────────────────────────────────────────────────────
    if (cmd === 'get') {
      var rest     = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
      var bodyOnly = rest.startsWith('text') ? rest.slice(4).trim() : rest;
      var gtSel    = bodyOnly || 'body';
      var txt = await page.evaluate(function(s) {
        var el = document.querySelector(s);
        return el ? (el.innerText || el.textContent || '').trim() : '(element not found)';
      }, gtSel);
      process.stdout.write(txt);
      return;
    }

    process.stdout.write('(done)');
    return;
  }

  // ── close ─────────────────────────────────────────────────────────────────
  if (cmd === 'close') {
    var isRunning = await isBrowserRunning();
    if (isRunning) {
      try {
        var closeBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 2000 });
        await closeBrowser.close();
      } catch (_) {}
    }
    writeState({ url: null });
    process.stdout.write('Browser closed.');
    return;
  }

  // ── open <url> ────────────────────────────────────────────────────────────
  var rawUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
  var url    = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl;

  var hostname = '';
  try { hostname = new URL(url).hostname; } catch (_) {}

  var openCtx;
  var openRunning = await isBrowserRunning();
  if (openRunning) {
    try {
      var openBrowser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
      var openCtxs = openBrowser.contexts();
      openCtx = openCtxs.length > 0 ? openCtxs[0] : null;
    } catch (_) {}
  }

  if (!openCtx) {
    // Acquire launch lock — if another concurrent process is mid-launch,
    // wait for it to finish, then connect to the browser it started.
    await acquireLaunchLock(12000);
    // Double-check: another process may have started the browser while we waited.
    openRunning = await isBrowserRunning();
    if (openRunning) {
      try {
        var openBrowser2 = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
        var openCtxs2 = openBrowser2.contexts();
        openCtx = openCtxs2.length > 0 ? openCtxs2[0] : null;
      } catch (_) {}
    }
    if (!openCtx) {
      openCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome', headless: false,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--remote-debugging-port=' + CDP_PORT,
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }
    releaseLaunchLock();
  }

  var openPage = openCtx.pages().at(-1) || await openCtx.newPage();
  await openPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  try { await openPage.waitForLoadState('networkidle', { timeout: 6000 }); } catch (_) {}

  // Check for auth-wall redirect.
  var finalUrl = openPage.url();
  if (isAuthWall(finalUrl)) {
    // Poll for up to 38s for the user to log in (stays within 45s Rust timeout).
    // The browser window is already visible — user can log in while we wait.
    var loggedIn = await pollForLoginCompletion(openPage, 38000);
    if (!loggedIn) {
      writeState({ url: finalUrl });
      process.stdout.write(
        '[SIGN_IN_REQUIRED] The ADRIS agent browser (the Chrome window that just opened with a separate profile) ' +
        'was redirected to a login page at ' + finalUrl + '. ' +
        'Please sign in to ' + hostname + ' in THAT browser window — not your regular Chrome. ' +
        'Your session will be saved permanently so this only happens once. ' +
        'After signing in, say "continue" or "retry" and I will read the page for you.'
      );
      return;
    }
    // User logged in — give the page a moment to fully load the post-login content
    finalUrl = openPage.url();
    try { await openPage.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) {}
    await new Promise(function(r) { setTimeout(r, 1000); });
  }

  // Wait for platform-specific content elements to appear (firecrawl pattern).
  await waitForPlatformContent(openPage, hostname);

  // Progressive multi-step scroll to trigger lazy-loaded content (crawlee pattern).
  await progressiveScroll(openPage);

  // Wait for content to stabilize — text length stops growing (crawl4ai pattern).
  await waitForContentStability(openPage, 300, 3000);

  // If still sparse after progressive scroll, do one more pass.
  var bodyLen = await openPage.evaluate(function() {
    return (document.body && document.body.innerText || '').length;
  }).catch(function() { return 0; });
  if (bodyLen < 300) {
    await progressiveScroll(openPage);
    await new Promise(function(r) { setTimeout(r, 1500); });
  }

  // ── LinkedIn-specific post extraction (firecrawl platform-specific pattern) ─
  var markdown = null;
  if (hostname.includes('linkedin.com')) {
    markdown = await extractLinkedInFeed(openPage);
  }

  // ── General content extraction (firecrawl selector removal + crawl4ai scoring) ─
  if (!markdown) {
    markdown = await openPage.evaluate(function() {
      // 1. Remove known noise selectors
      var REMOVE_TAGS = ['script','style','noscript','iframe','svg','canvas','template'];
      var REMOVE_SELECTORS = [
        'header', 'footer', 'nav', 'aside',
        '[class*="header"]', '[class*="footer"]', '[class*="navbar"]',
        '[class*="nav-"]', '[class*="-nav"]', '[class*="sidebar"]',
        '[class*="cookie"]', '[id*="cookie"]', '[class*="gdpr"]',
        '[class*="banner"]', '[class*="popup"]', '[class*="modal"]',
        '[class*="overlay"]', '[class*="toast"]',
        '[class*="advertisement"]', '[id*="advertisement"]', '[class*="ads-"]',
        '[class*="ad-"]', '[id*="ad-"]',
        '[class*="social-"]', '[class*="share-"]', '[class*="breadcrumb"]',
        '[class*="subscribe"]', '[class*="newsletter"]', '[class*="signup"]',
        '[class*="promo"]', '[class*="widget"]',
        '[aria-label*="advertisement"]',
        '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
        '.sr-only', '.visually-hidden', '[hidden]', '[aria-hidden="true"]',
      ];
      var clone = document.body.cloneNode(true);
      REMOVE_TAGS.forEach(function(t) {
        clone.querySelectorAll(t).forEach(function(el) { el.remove(); });
      });
      REMOVE_SELECTORS.forEach(function(s) {
        try { clone.querySelectorAll(s).forEach(function(el) { el.remove(); }); } catch (_) {}
      });

      // 2. Multi-metric block scoring (crawl4ai approach)
      function scoreBlock(el) {
        var text    = el.innerText || el.textContent || '';
        var textLen = text.trim().length;
        if (textLen < 30) return 0;

        var htmlLen     = el.innerHTML.length;
        var textDensity = htmlLen > 0 ? textLen / htmlLen : 0;

        var linkText = Array.from(el.querySelectorAll('a')).reduce(function(s, a) {
          return s + (a.innerText || a.textContent || '').length;
        }, 0);
        var linkDensity = textLen > 0 ? Math.max(0, 1 - linkText / textLen) : 0.5;

        var TAG_W = { article: 1.5, main: 1.4, section: 1.1, p: 1.2, div: 0.8, span: 0.5 };
        var tagWeight = TAG_W[el.tagName.toLowerCase()] || 0.8;

        var classStr = ((el.className || '') + ' ' + (el.id || '')).toLowerCase();
        var BAD = ['nav','footer','sidebar','header','menu','ad','promo','widget','banner','cookie','social','share'];
        var classWeight = BAD.some(function(w) { return classStr.indexOf(w) !== -1; }) ? 0.2 : 1.0;

        return 0.35 * textDensity + 0.25 * linkDensity + 0.2 * tagWeight + 0.1 * classWeight + 0.1 * (Math.log(textLen + 1) / 10);
      }

      // 3. DOM → Markdown (firecrawl approach)
      function domToMd(el, depth) {
        if (!el) return '';
        if (el.nodeType === 3) return (el.textContent || '').replace(/\s+/g, ' ');
        if (el.nodeType !== 1) return '';
        var tag = el.tagName.toLowerCase();
        if (['script','style','noscript','iframe','svg','canvas','template'].includes(tag)) return '';

        function kids() {
          return Array.from(el.childNodes).map(function(c) { return domToMd(c, depth + 1); }).join('').trim();
        }

        switch (tag) {
          case 'h1': return '\n# '    + (el.textContent || '').trim() + '\n';
          case 'h2': return '\n## '   + (el.textContent || '').trim() + '\n';
          case 'h3': return '\n### '  + (el.textContent || '').trim() + '\n';
          case 'h4': return '\n#### ' + (el.textContent || '').trim() + '\n';
          case 'h5': return '\n##### '+ (el.textContent || '').trim() + '\n';
          case 'br': return '\n';
          case 'hr': return '\n---\n';
          case 'p':  { var pt = kids(); return pt ? '\n' + pt + '\n' : ''; }
          case 'li': return '\n- ' + (el.textContent || '').trim();
          case 'ul':
          case 'ol': return '\n' + kids() + '\n';
          case 'a': {
            var href = el.getAttribute('href') || '';
            var lt   = (el.textContent || '').trim();
            if (!lt) return '';
            if (!href || href.startsWith('#') || href.startsWith('javascript')) return lt;
            return '[' + lt + '](' + href + ')';
          }
          case 'strong':
          case 'b': { var bt = kids(); return bt ? '**' + bt + '**' : ''; }
          case 'em':
          case 'i':  { var it = kids(); return it ? '_' + it + '_' : ''; }
          case 'code': {
            var ct = (el.textContent || '').trim();
            return ct ? ('`' + ct + '`') : '';
          }
          case 'pre': {
            var pret = (el.textContent || '').trim();
            return pret ? ('\n```\n' + pret + '\n```\n') : '';
          }
          case 'blockquote': return '\n> ' + kids().replace(/\n/g, '\n> ') + '\n';
          case 'table': {
            var rows = Array.from(el.querySelectorAll('tr'));
            if (!rows.length) return '';
            var tdata = rows.map(function(r) {
              return Array.from(r.querySelectorAll('td,th')).map(function(c) {
                return (c.textContent || '').trim().replace(/\|/g, '\\|');
              });
            });
            var maxC = Math.max.apply(null, tdata.map(function(r) { return r.length; }));
            var tlines = tdata.map(function(r) {
              while (r.length < maxC) r.push('');
              return '| ' + r.join(' | ') + ' |';
            });
            if (tlines.length > 1) tlines.splice(1, 0, '| ' + Array(maxC).fill('---').join(' | ') + ' |');
            return '\n' + tlines.join('\n') + '\n';
          }
          case 'img': {
            var alt = el.getAttribute('alt') || '';
            return alt ? '[Image: ' + alt + ']' : '';
          }
          default: return kids();
        }
      }

      // 4. Pick best content area
      var preferred = clone.querySelector('article') || clone.querySelector('main')
        || clone.querySelector('[role="main"]') || clone.querySelector('#content')
        || clone.querySelector('.content') || clone.querySelector('#main');
      var container = preferred || clone;

      var blocks = Array.from(container.children).filter(function(el) {
        return ['div','article','section','main','p'].includes(el.tagName.toLowerCase());
      });
      var scored = blocks
        .map(function(el) { return { el: el, s: scoreBlock(el) }; })
        .filter(function(b) { return b.s > 0.15; })
        .sort(function(a, b) { return b.s - a.s; });

      var topN    = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.6)));
      var topText = topN.reduce(function(s, b) { return s + (b.el.innerText || b.el.textContent || ''); }, '').trim();
      var useBlocks = topText.length > 200 && topN.length > 0;

      var md = useBlocks
        ? topN.map(function(b) { return domToMd(b.el, 0); }).join('\n')
        : domToMd(container, 0);

      return md.replace(/\n{3,}/g, '\n\n').trim();
    });
  }

  writeState({ url: url });
  // DON'T close context — Chrome stays open so click/fill/snapshot work on this page
  process.stdout.write(markdown || '(page loaded — no readable text)');
}

main().catch(function(e) {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
