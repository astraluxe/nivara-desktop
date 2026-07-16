#!/usr/bin/env node
// adris.tech agent-browser — Playwright wrapper using system Chrome.
// Techniques from: browser-use (CDP element detection, accessibility tree),
//   firecrawl (Markdown conversion, content-type detection, wait strategies),
//   crawl4ai (multi-metric scoring, word-threshold filtering, content stability),
//   crawlee (progressive infinite scroll, network-idle detection, cookie handling).

const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const http    = require('http');
// chromium at module level so helper functions (launchChromeDetached, cdpConnect, ensureChrome)
// can access it without being nested inside main().
const chromium = (() => { try { return require('playwright-core').chromium; } catch (_) { return null; } })();

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

// Locate the system Chrome executable (shared by the detached launcher and the headless
// PDF renderer). Returns the path or null.
function findChromeExe() {
  var chromePaths = [];
  if (process.platform === 'win32') {
    var pf   = process.env['ProgramFiles']      || 'C:\\Program Files';
    var pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    var la   = process.env['LOCALAPPDATA']       || '';
    chromePaths = [
      path.join(pf,   'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      la ? path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(pf,   'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ].filter(Boolean);
  } else if (process.platform === 'darwin') {
    chromePaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  } else {
    chromePaths = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  }
  for (var i = 0; i < chromePaths.length; i++) {
    try { if (chromePaths[i] && fs.existsSync(chromePaths[i])) return chromePaths[i]; } catch (_) {}
  }
  return null;
}

// Launch Chrome as a fully DETACHED independent process — it will outlive this node process.
// This is the core technique used by browser-use / crawl4ai / crawlee:
// keep the browser running persistently across all agent commands.
// We NEVER use launchPersistentContext (Playwright kills Chrome on node exit).
// We always connectOverCDP to the running Chrome instead.
async function launchChromeDetached() {
  var spawn = require('child_process').spawn;
  var chromeExe = findChromeExe();
  if (!chromeExe) return false; // Chrome not found — caller falls back

  var child = spawn(chromeExe, [
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
  ], {
    detached: true, // Chrome runs in its OWN process group — node exit does NOT kill it
    stdio:    'ignore',
  });
  child.unref(); // Node can exit freely without Chrome dying

  // Wait up to 12 seconds for Chrome CDP endpoint to be ready
  var deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await new Promise(function(r) { setTimeout(r, 400); });
    if (await isBrowserRunning()) return true;
  }
  return false; // Chrome didn't start in time
}

// Connect to the running Chrome via CDP and get its default browser context.
// The default context has all the user's saved logins (LinkedIn, Gmail, etc.)
// because Chrome loaded them from PROFILE_DIR on startup.
async function cdpConnect() {
  var browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5000 });
  var ctxs = browser.contexts();
  // contexts()[0] is Chrome's default profile context — has all saved cookies/sessions
  var ctx = ctxs.length > 0 ? ctxs[0] : null;
  return { browser: browser, context: ctx };
}

// Ensure Chrome is running and return a connected context.
// Launches Chrome as detached process if not already running.
async function ensureChrome() {
  if (await isBrowserRunning()) {
    try { return await cdpConnect(); } catch (_) {}
  }
  // Not running — acquire lock so concurrent processes don't double-launch
  await acquireLaunchLock(12000);
  // Double check after lock (another process may have started it while we waited)
  if (await isBrowserRunning()) {
    releaseLaunchLock();
    try { return await cdpConnect(); } catch (_) {}
  }
  // Launch Chrome as a detached process that outlives this node process
  var ok = await launchChromeDetached();
  releaseLaunchLock();
  if (!ok) return { browser: null, context: null };
  try { return await cdpConnect(); } catch (_) { return { browser: null, context: null }; }
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
      // LinkedIn uses obfuscated classes now — the stable signal that the feed loaded
      // is author profile links appearing inside <main>. Wait for those.
      await page.waitForSelector('main a[href*="/in/"], main a[href*="/company/"]', { timeout: 8000 });
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
  var steps = 3;
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
    await new Promise(function(r) { setTimeout(r, 500); });
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
// LinkedIn feed extraction — CLASS-INDEPENDENT.
// LinkedIn now ships fully obfuscated/hashed CSS class names (e.g. "ee8092b5 _731d00bc")
// and removed all data-urn attributes, so old selectors (.feed-shared-update-v2 etc.)
// match NOTHING. The only stable anchors are author profile links (/in/ and /company/)
// and post-signal text (degree markers • 1st/2nd/3rd, timestamps Nh/Nd/Nw, Like/Comment).
// Strategy: for each author link inside <main>, walk up to the post-sized container,
// filter out the profile/news rails, require a post signal, dedupe, clean and return.
// Validated live 2026-06-25 against the real logged-in feed.
async function extractLinkedInFeed(page) {
  var posts = await page.evaluate(function() {
    var main = document.querySelector('main') || document.body;
    // Rail/sidebar/ad noise we must never treat as a feed post.
    var SKIP = [
      'Profile viewers', 'Post impressions', 'Grow your business', 'Add to your feed',
      'Try Premium', 'ad credits', 'visitor analytics', 'Who viewed', 'People you may know',
      'Promoted', 'Saved items', 'Recent', 'Groups', 'Newsletters', 'Events'
    ];
    var authorLinks = Array.prototype.slice.call(
      main.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')
    );
    var chosenEls = [];
    var chosenTxt = [];
    for (var i = 0; i < authorLinks.length; i++) {
      var el = authorLinks[i];
      // Walk up to the FULL post container — one that includes the footer (impressions /
      // reactions / Like+Comment actions), not just the post text. This is what lets us
      // capture "N impressions" on the user's own activity page.
      for (var d = 0; d < 14; d++) {
        if (!el.parentElement || el === main) break;
        el = el.parentElement;
        var tt = (el.innerText || '').trim();
        if (tt.length > 7000) break; // too big — would merge multiple posts
        var hasFooter =
          /[\d,]+\s+impressions/i.test(tt) ||
          /reaction/i.test(tt) ||
          (/\bLike\b/.test(tt) && /\bComment\b/.test(tt));
        if (tt.length >= 120 && hasFooter) break;
      }
      var t = (el.innerText || '').trim();
      if (t.length < 120 || t.length > 7000) continue;

      var skip = false;
      for (var s = 0; s < SKIP.length; s++) { if (t.indexOf(SKIP[s]) !== -1) { skip = true; break; } }
      if (skip) continue;

      // Must look like an actual post.
      var hasSignal =
        /•\s*(1st|2nd|3rd|Following)/.test(t) ||
        /\b\d+\s*(h|d|w|mo|hour|day|week|month)s?\b/.test(t) ||
        (/\bLike\b/.test(t) && /\bComment\b/.test(t));
      if (!hasSignal) continue;

      // Dedupe nested/overlapping containers.
      var dup = false;
      for (var c = 0; c < chosenEls.length; c++) {
        if (chosenEls[c].contains(el) || el.contains(chosenEls[c])) { dup = true; break; }
      }
      if (dup) continue;

      chosenEls.push(el);
      chosenTxt.push(t);
      if (chosenTxt.length >= 15) break;
    }

    // Clean each block into readable text the AI can brief from.
    var UI = ['Like', 'Comment', 'Repost', 'Send', 'Follow', 'Following', 'Verified Profile',
              'Feed post', '…more', 'See more', 'Play video', 'Activate to view larger image,',
              'View analytics'];
    return chosenTxt.map(function(raw) {
      // Pull the impressions count (own-posts analytics) before cleaning.
      var impMatch = raw.match(/([\d,]+)\s+impressions/i);
      var impressions = impMatch ? impMatch[1].replace(/,/g, '') : '';

      var lines = raw.split('\n').map(function(l) { return l.trim(); })
        .filter(function(l) { return l.length > 0; });
      // Author = first real name line, skipping accessibility/meta labels.
      var META = /^(Feed post|Suggested|Promoted|Verified|You|Following|Feed post number)/i;
      var author = 'Unknown';
      for (var ai = 0; ai < lines.length; ai++) {
        if (!META.test(lines[ai]) && !/^•/.test(lines[ai]) && lines[ai].length > 1) { author = lines[ai]; break; }
      }
      var kept = [];
      var prev = author; // seeded so the content's leading repeat of the author name is dropped
      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];
        if (UI.indexOf(ln) !== -1) continue;     // drop pure UI words (Like/Comment/…)
        if (/^•/.test(ln)) continue;             // drop "• 2nd" connector lines
        if (ln === prev) continue;               // drop consecutive duplicate (repeated author/name)
        kept.push(ln);
        prev = ln;
      }
      var text = kept.join('\n');
      if (text.length > 1200) text = text.slice(0, 1200) + '…';
      return { author: author, content: text, impressions: impressions };
    }).filter(function(p) { return p.content && p.content.length > 40; });
  }).catch(function() { return null; });

  if (!posts || posts.length === 0) return null;

  var formatted = '=== LinkedIn Feed — ' + posts.length + ' posts ===\n\n' +
    posts.map(function(p, i) {
      var head = (i + 1) + '. ' + p.author;
      if (p.impressions) head += '  ·  ' + p.impressions + ' impressions';
      return head + '\n' + p.content;
    }).join('\n\n---\n\n');

  return formatted;
}

// On-page "agent is controlling this window" banner. Injected onto the page the agent
// is working on so the user — who is watching the Chrome window, not the app — gets a
// clear, in-place signal not to scroll/close while automation runs. Appended to
// <html> (not <body>) so it survives body re-renders and is never picked up by the
// content extractors (LinkedIn extractor scopes to <main>; general extractor clones <body>).
async function showBanner(page, text) {
  await page.evaluate(function(msg) {
    var id = 'adris-agent-banner';
    var b = document.getElementById(id);
    if (!b) {
      b = document.createElement('div');
      b.id = id;
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#7C5CFF;color:#fff;' +
        'font:600 13px/1.4 system-ui,Segoe UI,Roboto,sans-serif;' +
        'padding:9px 16px;text-align:center;letter-spacing:.02em;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.28);pointer-events:none;';
      (document.documentElement || document.body).appendChild(b);
    }
    b.textContent = '🤖 ' + msg;
  }, text).catch(function () {});
}
async function hideBanner(page) {
  await page.evaluate(function () {
    var b = document.getElementById('adris-agent-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }).catch(function () {});
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
    if (chromium) {
      process.stdout.write('agent-browser ready (playwright-core + system Chrome)\n');
    } else {
      process.stderr.write('playwright-core not installed\n');
      process.exit(1);
    }
    return;
  }

  if (!chromium) {
    process.stdout.write('[agent-browser not installed] playwright-core is missing. Run: npm install playwright-core');
    return;
  }

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // ── openmany <url1>|<url2>|<url3> ──────────────────────────────────────────
  // Batch read: open several URLs as CONCURRENT tabs inside the ONE detached Chrome
  // window (single node process → single CDP connection → many pages via newPage()),
  // read each in parallel, then close the extra tabs. This is the fast path for the
  // deterministic lead tools (verify/enrich), which otherwise open pages one-by-one at
  // ~14s each. It is SAFE re: the old "multi-window mess" — that came from separate node
  // PROCESSES each grabbing the last tab; here it's one process managing its own pages,
  // and no second Chrome window is ever launched. URLs are '|'-joined (URLs never contain
  // a raw '|' — it's %7C when encoded), so the Rust "rest of args as one string" passes
  // through cleanly. Output: blocks delimited by ===SEP=== each starting with a
  // ===URL:.===/===STATUS:.=== header, so the caller can map text back to each URL.
  if (cmd === 'openmany') {
    var joined = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var manyUrls = joined.split('|').map(function (u) { return u.trim(); }).filter(Boolean);
    if (!manyUrls.length) { process.stdout.write('===BATCH==='); return; }

    var mconn = await ensureChrome();
    var mctx  = mconn.context;
    if (!mctx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }

    var readOne = async function (raw) {
      var url = raw.startsWith('http') ? raw : 'https://' + raw;
      var host = ''; try { host = new URL(url).hostname; } catch (_) {}
      var page = null;
      try {
        page = await mctx.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 22000 });
        try { await page.waitForLoadState('networkidle', { timeout: 2500 }); } catch (_) {}
        var finalUrl = page.url();
        if (isAuthWall(finalUrl)) return { url: raw, status: 'login', text: '' };
        // Show the "agent is controlling this window" banner so the user sees it during the batch
        // read too (it was only on the single-page `open` before). Sits on <documentElement>, so it
        // never pollutes the <main>/<body> text we extract below.
        await showBanner(page, 'ADRIS agent is using this window — please don’t close it. It will close automatically when the task finishes.');
        await waitForPlatformContent(page, host);
        await progressiveScroll(page);
        await waitForContentStability(page, 300, 1800);
        var isLinkedIn  = host.indexOf('linkedin.com') !== -1;
        // A /company/ page (an organisation with no specific named contact — e.g. a "find
        // internships" list, where each row IS a company) has the same shape problem as a /in/
        // profile: its identity (name/about/industry) is at the TOP, not in a feed of posts.
        var isLIProfile = isLinkedIn && /\/(?:in|company)\//i.test(url);
        var text = null;
        if (isLIProfile) {
          // PROFILE/COMPANY page — identity (name/headline/company/experience, or company
          // name/about/industry) is at the TOP, not in posts. Read the whole page via innerText:
          // it reliably contains what matchLI/checkMatch look for. The feed extractor is for
          // /feed/ & /recent-activity/ and can miss/mangle a profile or company page.
          text = await page.evaluate(function () {
            var m = document.querySelector('main') || document.body;
            var t = (m.innerText || '').trim();
            return t.length > 8000 ? t.slice(0, 8000) + '\n…[truncated]' : t;
          }).catch(function () { return ''; });
        } else if (isLinkedIn) {
          text = await extractLinkedInFeed(page);
          if (!text) {
            text = await page.evaluate(function () {
              var m = document.querySelector('main') || document.body;
              var t = (m.innerText || '').trim();
              return t.length > 6000 ? t.slice(0, 6000) + '\n…[truncated]' : t;
            }).catch(function () { return ''; });
          }
        } else {
          text = await page.evaluate(function () {
            var m = document.querySelector('main') || document.body;
            var t = (m.innerText || '').trim();
            // Surface mailto:/tel: hrefs — company emails/phones are frequently ONLY in the link
            // href, not in visible text. Appending them lets the caller's email/phone regex find
            // them (the single-page `open` path keeps them via markdown; batch must too).
            var links = [];
            try {
              document.querySelectorAll('a[href]').forEach(function (a) {
                var h = a.getAttribute('href') || '';
                // mailto:/tel: — company emails/phones often live only in the href.
                if (/^mailto:/i.test(h) || /^tel:/i.test(h)) {
                  var c = h.replace(/^mailto:/i, '').replace(/^tel:/i, '').split('?')[0].trim();
                  if (c && links.indexOf(c) === -1) links.push(c);
                  return;
                }
                // SEARCH-RESULT links to LinkedIn profiles OR company pages: the real URL is
                // usually wrapped in a redirect (DuckDuckGo /l/?uddg=…, Google /url?q=…), so decode
                // it. Surfacing these lets the browser-based LinkedIn search fallback pull profile/
                // company URLs reliably even when the headless HTTP search engines are throttling.
                var dec = h;
                var mm = h.match(/[?&](?:uddg|url|q|u3)=([^&]+)/i);
                if (mm) { try { dec = decodeURIComponent(mm[1]); } catch (_) {} }
                if (/linkedin\.com\/(?:in|company)\//i.test(dec)) {
                  var li = (dec.match(/https?:\/\/[a-z]{0,3}\.?linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%]+/i) || [])[0];
                  if (li) { li = li.split(/[?#]/)[0]; if (links.indexOf(li) === -1) links.push(li); }
                }
              });
            } catch (_) {}
            var full = links.length ? (t + '\n' + links.join('\n')) : t;
            return full.length > 8000 ? full.slice(0, 8000) + '\n…[truncated]' : full;
          }).catch(function () { return ''; });
        }
        return { url: raw, status: 'ok', text: text || '' };
      } catch (e) {
        return { url: raw, status: 'error', text: '' };
      } finally {
        // Close the tab we created — keeps the window tidy. Chrome stays alive because
        // ensureChrome's original page (and any prior `open` page) remains.
        if (page) { try { await page.close(); } catch (_) {} }
      }
    };

    var mresults = await Promise.all(manyUrls.map(readOne));
    process.stdout.write('===BATCH===\n' + mresults.map(function (r) {
      return '===URL:' + r.url + '===\n===STATUS:' + r.status + '===\n' + r.text;
    }).join('\n===SEP===\n'));
    return;
  }

  // NOTE on process lifetime: we connect to Chrome via connectOverCDP, whose WebSocket
  // keeps Node's event loop alive — so the process will NOT exit on its own after a
  // command finishes. That made every command hang until the Rust 45s timeout, which
  // surfaced as a false "browser timed out / please log in" message. The fix is the
  // forced `process.exit(0)` in the main().then() handler at the bottom of this file.
  // It is SAFE to force-exit: our Chrome is launched as a DETACHED, unref'd child
  // process (launchChromeDetached) that Playwright does not own, so exiting Node never
  // kills Chrome — the window stays open and logged in for the next command.

  // ── Interactive commands ───────────────────────────────────────────────────
  if (cmd !== 'open' && cmd !== 'close') {
    var state   = readState();

    var conn    = await ensureChrome();
    var context = conn.context;

    if (!context) {
      process.stderr.write('[agent-browser] Could not launch or connect to Chrome.\n');
      process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.');
      return;
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
    // Handles both regular inputs AND contenteditable elements (LinkedIn, X, Reddit
    // post editors). page.fill() / el.value only works on real input/textarea.
    // For contenteditable we must click to focus then use keyboard.type().
    if (cmd === 'fill') {
      var fillSel  = argv[1] || '';
      var fillText = argv.slice(2).join(' ');
      if (!fillSel) { process.stdout.write('fill: missing selector'); return; }

      // Resolve selector to an actual DOM element to detect contenteditable
      var isContentEditable = await page.evaluate(function(args) {
        var el = args.ref
          ? document.querySelector('[data-aref="' + args.ref + '"]')
          : document.querySelector(args.sel);
        if (!el) return false;
        return el.isContentEditable || el.getAttribute('contenteditable') === 'true';
      }, { ref: fillSel.startsWith('@') ? fillSel.slice(1) : '', sel: fillSel }).catch(function() { return false; });

      if (isContentEditable) {
        // Click to focus, wipe existing content, then type naturally
        var focusSel = fillSel.startsWith('@')
          ? '[data-aref="' + fillSel.slice(1) + '"]'
          : fillSel;
        await page.click(focusSel, { timeout: 8000 }).catch(function() {});
        // Select-all + delete to clear any placeholder / existing text
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Delete');
        await new Promise(function(r) { setTimeout(r, 200); });
        await page.keyboard.type(fillText, { delay: 18 });
      } else if (fillSel.startsWith('@')) {
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
      process.stdout.write('Typed into "' + fillSel + '". Content set.');
      return;
    }

    // ── press key ─────────────────────────────────────────────────────────────
    if (cmd === 'press') {
      var pressKey = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim() || 'Enter';
      await page.keyboard.press(pressKey);
      try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch (_) {}
      process.stdout.write('Pressed ' + pressKey + '. Page: ' + page.url());
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
        // IMPORTANT: connectOverCDP does NOT own our detached Chrome, so browser.close() only
        // drops the CDP socket and LEAVES THE WINDOW OPEN (the user then has to close it by
        // hand). Send the CDP `Browser.close` command to actually terminate the Chrome we
        // launched. This targets only our port-9223 instance — never the user's own Chrome.
        try {
          var session = await closeBrowser.newBrowserCDPSession();
          await session.send('Browser.close');
        } catch (_) {
          // Fallback: close every page/context so Chrome exits when the last one closes.
          try {
            var ctxs = closeBrowser.contexts();
            for (var ci = 0; ci < ctxs.length; ci++) {
              var pgs = ctxs[ci].pages();
              for (var pi = 0; pi < pgs.length; pi++) { try { await pgs[pi].close(); } catch (_) {} }
            }
          } catch (_) {}
        }
        try { await closeBrowser.close(); } catch (_) {} // socket likely already gone — fine
      } catch (_) {}
    }
    writeState({ url: null });
    process.stdout.write('Browser closed.');
    return;
  }

  // ── connections [limit] ────────────────────────────────────────────────────
  // Load the "My Network → Connections" page, scroll + click "Load more" until we have
  // `limit` connections (bounded well under Rust's 30s cap), then return the RAW innerText
  // — the exact on-screen list. The caller parses real names from this in code, so the model
  // can NEVER rewrite/hallucinate them (the bug where 8 fake "Gupta" names got saved).
  if (cmd === 'connections') {
    var wantN = parseInt(argv[1], 10) || 50;
    var cConn = await ensureChrome();
    var cCtx  = cConn.context;
    if (!cCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var cPage = cCtx.pages().at(-1) || await cCtx.newPage();
    // Bring the window forward so the user actually SEES it working (and can log in if needed).
    try { await cPage.bringToFront(); } catch (_) {}
    var connUrl = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
    try { await cPage.goto(connUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    try { await cPage.waitForLoadState('networkidle', { timeout: 3500 }); } catch (_) {}
    var cFinal = cPage.url();
    // Not signed in? Show the window on the login page and give the user time to log in, then reload.
    if (isAuthWall(cFinal)) {
      await showBanner(cPage, 'Sign in to LinkedIn in THIS window — then it will read your connections. (Run /scan again if it closes.)');
      var ok = await pollForLoginCompletion(cPage, 40000);
      if (!ok) { writeState({ url: cFinal }); process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there, then run /scan again.'); return; }
      try { await cPage.goto(connUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}
      try { await cPage.waitForLoadState('networkidle', { timeout: 3500 }); } catch (_) {}
    }
    await showBanner(cPage, 'ADRIS is reading your LinkedIn connections — please don’t close this window.');
    // Wait for the connection cards to actually render (the /in/ profile links).
    try { await cPage.waitForSelector('main a[href*="/in/"]', { timeout: 12000 }); } catch (_) {}
    // Nudge lazy-loading with a couple of scrolls before the main loop.
    try { await progressiveScroll(cPage); } catch (_) {}
    // Still nothing? Distinguish "not logged in / wrong page" from "no connections" so the message
    // is accurate instead of a generic "couldn't read".
    var probe = await cPage.evaluate(function() {
      var n = document.querySelectorAll('main a[href*="/in/"]').length;
      var login = !!(document.querySelector('input[name="session_key"], input#username, .login__form, a[href*="/uas/login"], a[href*="/login"]'));
      return { n: n, login: login };
    }).catch(function () { return { n: 0, login: false }; });
    if (probe.n === 0) {
      writeState({ url: cFinal });
      if (probe.login) { process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there, then run /scan again.'); return; }
      // Give the page one more chance to load, then continue into the loop anyway.
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
    var cDeadline = Date.now() + 20000; // stay under the 30s Rust process timeout
    var cLast = 0, cStall = 0;
    while (Date.now() < cDeadline) {
      var cCount = await cPage.evaluate(function() { return document.querySelectorAll('a[href*="/in/"]').length; }).catch(function () { return 0; });
      if (cCount >= wantN) break;
      await cPage.evaluate(function() {
        var m = document.querySelector('.scaffold-finite-scroll__content') || document.querySelector('.scaffold-layout__main') || document.querySelector('main') || document.body;
        if (m) m.scrollTop = m.scrollHeight;
        window.scrollTo(0, document.body.scrollHeight);
      }).catch(function () {});
      try {
        await cPage.evaluate(function() {
          var btn = document.querySelector('button.scaffold-finite-scroll__load-button');
          if (!btn) { var bs = [].slice.call(document.querySelectorAll('button')); for (var i = 0; i < bs.length; i++) { if (/load more/i.test(bs[i].textContent || '')) { btn = bs[i]; break; } } }
          if (btn) btn.click();
        }).catch(function () {});
      } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 1300); });
      if (cCount <= cLast) { cStall++; if (cStall >= 3) break; } else cStall = 0;
      cLast = cCount;
    }
    await hideBanner(cPage);
    // Extract each connection STRUCTURALLY from the DOM — name from the /in/ profile link, and the
    // occupation as the most substantial non-name/non-badge text element in the card. This is
    // element-traversal (textContent), NOT innerText line-parsing (which was fragile and dropped
    // names/occupations). Verified against realistic LinkedIn card markup. Returns CONN_JSON:[…].
    var people = await cPage.evaluate(function() {
      function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
      var noiseRe = /^(message|connect|connected|following|follow|pending|1st|2nd|3rd|•\s*1st|·\s*1st|view .*profile)$/i;
      var out = [], seen = {};
      var anchors = document.querySelectorAll('a[href*="/in/"]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = (a.getAttribute('href') || '');
        if (href.indexOf('/in/') === -1) continue;
        var key = href.split('?')[0].replace(/\/$/, '');
        if (seen[key]) continue;
        var card = a.closest('li') || a.closest('.mn-connection-card') || a.closest('[data-view-name]') || a.closest('.artdeco-list__item') || a.parentElement;
        if (!card) continue;
        var nameEl = a.querySelector('span[aria-hidden="true"]') || a.querySelector('span') || a;
        var name = clean(nameEl.textContent).split('\n')[0].trim();
        if (!name || name.length > 80 || noiseRe.test(name)) {
          var h = card.querySelector('a[href*="/in/"] span[aria-hidden="true"]');
          name = h ? clean(h.textContent) : '';
          if (!name || name.length > 80) continue;
        }
        var cands = [];
        var els = card.querySelectorAll('div,p,span,h3,h4');
        for (var k = 0; k < els.length; k++) {
          var el = els[k];
          if (el.closest('a[href*="/in/"]') || el.closest('button') || el.closest('time')) continue;
          if (el.querySelector('a[href*="/in/"], button, time')) continue; // wrapper, not a leaf line
          var tt = clean(el.textContent);
          if (tt.length < 3 || tt.length > 180) continue;
          if (tt === name || noiseRe.test(tt)) continue;
          if (/^[•·]/.test(tt) && tt.length < 14) continue;
          if (/degree connection/i.test(tt)) continue;
          cands.push(tt);
        }
        cands.sort(function (x, y) { return y.length - x.length; });
        seen[key] = 1;
        out.push({ name: name, headline: cands[0] || '' });
      }
      return out;
    }).catch(function () { return []; });
    writeState({ url: cFinal });
    if (people && people.length) { process.stdout.write('CONN_JSON:' + JSON.stringify(people)); return; }
    // Nothing read → return a DIAGNOSTIC (url, link count, login?, title, snippet) so the failure
    // message is accurate and pin-pointable instead of a vague "couldn't read".
    var diag = await cPage.evaluate(function() {
      var u = location.href;
      var anchors = document.querySelectorAll('a[href*="/in/"]').length;
      var login = !!(document.querySelector('input[name="session_key"], input#username, .login__form, a[href*="/uas/login"], a[href*="/login"], form[action*="login"]'))
        || /\/(login|authwall|checkpoint|uas\/login)/.test(u);
      var m = document.querySelector('main') || document.body;
      return { url: u, anchors: anchors, login: login, title: (document.title || '').slice(0, 80), snippet: ((m && m.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 160) };
    }).catch(function () { return { url: cFinal, anchors: 0, login: false, title: '', snippet: '' }; });
    process.stdout.write('CONN_DIAG:' + JSON.stringify(diag));
    return;
  }

  // ── printpdf <htmlFilePath> ─────────────────────────────────────────────────
  // Render a deck's HTML with Chromium's OWN print engine and write a perfect PDF — every
  // gradient/shadow/mesh background, exact fonts, sharp vector text, one slide per page, nothing
  // missing. Runs in a HEADLESS Chrome (a dedicated, invisible instance — NOT the user's visible
  // session, so no window pops up and no logins are touched), using Playwright's page.pdf(), which
  // is the well-trodden reliable path. Writes the PDF next to the html file → "PDF_OK:<path>".
  if (cmd === 'printpdf') {
    var htmlPath = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/').replace(/^\/+/, '');
    var pdfPath = htmlPath.replace(/\.html?$/i, '') + '.pdf';
    var pdfArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'];
    // Runs on any page: switch to print media so ALL slides lay out (each 1280x720, one per
    // page), then run the on-screen content auto-fit on EVERY slide so long ones shrink to fit.
    async function prep(pg) {
      try { await pg.goto(fileUrl, { waitUntil: 'load', timeout: 20000 }); }
      catch (_) { try { await pg.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 12000 }); } catch (e2) {} }
      try { await pg.evaluate(function(){ return document.fonts && document.fonts.ready; }); } catch (_) {}
      try { await pg.emulateMedia({ media: 'print' }); } catch (_) {}
      try {
        await pg.evaluate(function() {
          var avail = 720 - 96 - 96 - 6;
          var sls = document.querySelectorAll('.slide');
          for (var i = 0; i < sls.length; i++) {
            var wrap = sls[i].querySelector(':scope > .fitwrap');
            if (!wrap) continue;
            wrap.style.transform = 'none';
            var h = wrap.scrollHeight;
            if (h > avail) wrap.style.transform = 'scale(' + Math.max(0.55, avail / h) + ')';
          }
        });
      } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 350); });
    }
    var ok = function () { try { return fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1200; } catch (_) { return false; } };
    var lastErr = '';
    // Strategy 1 & 2 & 3: a dedicated HEADLESS browser (invisible, no session), tried via the
    // official Chrome channel, then a detected Chrome/Edge exe, then the Edge channel.
    var exe = findChromeExe();
    var launchTries = [{ headless: true, channel: 'chrome', args: pdfArgs }];
    if (exe) launchTries.push({ headless: true, executablePath: exe, args: pdfArgs });
    launchTries.push({ headless: true, channel: 'msedge', args: pdfArgs });
    for (var t = 0; t < launchTries.length && !ok(); t++) {
      var hb = null;
      try {
        hb = await chromium.launch(launchTries[t]);
        var hp = await hb.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
        await prep(hp);
        await hp.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
      } catch (e) { lastErr = (e && e.message ? e.message : String(e)); }
      finally { if (hb) { try { await hb.close(); } catch (_) {} } }
    }
    // Strategy 4 (last resort): CDP Page.printToPDF on the already-running persistent Chrome.
    if (!ok()) {
      try {
        var pc = await ensureChrome();
        var pctx = pc && pc.context;
        if (pctx) {
          var pp = pctx.pages().at(-1) || await pctx.newPage();
          await prep(pp);
          var sess = await pctx.newCDPSession(pp);
          var r = await sess.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
          fs.writeFileSync(pdfPath, Buffer.from(r.data, 'base64'));
        }
      } catch (e) { lastErr = (e && e.message ? e.message : String(e)); }
    }
    if (ok()) process.stdout.write('PDF_OK:' + pdfPath);
    else process.stdout.write('[pdf-failed] ' + (lastErr || 'no PDF produced'));
    return;
  }

  // ── message <profileUrl> ───────────────────────────────────────────────────
  // Open a LinkedIn profile and CLICK its "Message" button so the chat box pops open,
  // ready for the user to paste + send. This ONLY opens the box — it never types or sends
  // (that's the human-in-the-loop step that keeps the account safe). Falls back to just
  // showing the profile if the Message button can't be found (e.g. not a 1st-degree
  // connection, where you must connect first).
  if (cmd === 'message') {
    var mRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var mUrl = mRaw.startsWith('http') ? mRaw : 'https://' + mRaw;
    var mConn = await ensureChrome();
    var mCtx  = mConn.context;
    if (!mCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var mPage = mCtx.pages().at(-1) || await mCtx.newPage();
    try { await mPage.goto(mUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    var mFinal = mPage.url();
    if (isAuthWall(mFinal)) {
      var mok = await pollForLoginCompletion(mPage, 30000);
      if (!mok) { writeState({ url: mFinal }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to LinkedIn in the ADRIS browser window that just opened, then try again.'); return; }
    }
    await showBanner(mPage, 'ADRIS opened this chat for you — paste your message (Ctrl+V) and send.');
    try { await mPage.waitForLoadState('networkidle', { timeout: 4000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1200); });
    var mClicked = await mPage.evaluate(function() {
      function vis(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
      var cands = [].slice.call(document.querySelectorAll('button, a'));
      // Prefer the primary profile "Message" action; avoid "Message" links that are actually
      // premium upsells or nav items.
      var btn = null;
      for (var i = 0; i < cands.length; i++) {
        var el = cands[i];
        if (!vis(el)) continue;
        var al = (el.getAttribute('aria-label') || '').toLowerCase();
        var tx = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (al.indexOf('premium') !== -1) continue;
        if (al.indexOf('message ') === 0 || al === 'message' || tx === 'message') { btn = el; break; }
      }
      if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (e) {} btn.click(); return true; }
      return false;
    }).catch(function () { return false; });
    await new Promise(function (r) { setTimeout(r, 900); });
    writeState({ url: mFinal });
    process.stdout.write(mClicked ? 'MESSAGE_BOX_OPENED' : 'PROFILE_OPENED');
    return;
  }

  // ── open <url> ────────────────────────────────────────────────────────────
  var rawUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
  var url    = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl;

  var hostname = '';
  try { hostname = new URL(url).hostname; } catch (_) {}

  var openConn = await ensureChrome();
  var openCtx  = openConn.context;

  if (!openCtx) {
    process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.');
    return;
  }

  var openPage = openCtx.pages().at(-1) || await openCtx.newPage();
  await openPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  // SPA feeds (LinkedIn/Twitter/Reddit) never reach networkidle — capping this low
  // avoids burning the full timeout on every navigation. Content readiness is ensured
  // by waitForPlatformContent below, not by networkidle.
  try { await openPage.waitForLoadState('networkidle', { timeout: 2500 }); } catch (_) {}

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

  // Show the "agent is controlling this window" banner during the active read phase.
  await showBanner(openPage, 'ADRIS is reading this page — please don’t scroll or close this window');

  // Wait for platform-specific content elements to appear (firecrawl pattern).
  await waitForPlatformContent(openPage, hostname);

  // Progressive multi-step scroll to trigger lazy-loaded content (crawlee pattern).
  await progressiveScroll(openPage);

  // Wait for content to stabilize — text length stops growing (crawl4ai pattern).
  await waitForContentStability(openPage, 300, 1800);

  // Remove the banner before extraction so it is never captured in page text.
  await hideBanner(openPage);

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
    // If structured extraction found nothing, fall back to a SIMPLE fast body read.
    // Never run the heavy DOM-scoring/domToMd path on LinkedIn — its enormous feed DOM
    // makes that recursion hang (this was the real cause of the "stuck / login screen" bug).
    if (!markdown) {
      markdown = await openPage.evaluate(function() {
        var main = document.querySelector('main') || document.body;
        var t = (main.innerText || '').trim();
        return t.length > 6000 ? t.slice(0, 6000) + '\n…[truncated]' : t;
      }).catch(function() { return null; });
    }
  }

  // ── General content extraction (firecrawl selector removal + crawl4ai scoring) ─
  // Skipped for LinkedIn (handled above) to avoid the hanging DOM walk.
  if (!markdown && !hostname.includes('linkedin.com')) {
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

  // Extraction is done — restore a PERSISTENT banner so the user always sees that
  // ADRIS is controlling this window and shouldn't close it. It sits on
  // <documentElement> (not <body>), so it never pollutes the text we extracted above,
  // and it stays visible until the window is closed at the end of the task.
  await showBanner(openPage, 'ADRIS agent is using this window — please don’t close it. It will close automatically when the task finishes.');

  writeState({ url: url });
  // DON'T close context — Chrome stays open so click/fill/snapshot work on this page
  process.stdout.write(markdown || '(page loaded — no readable text)');
}

// Force a clean exit after the command completes. The CDP WebSocket would otherwise
// keep the event loop alive forever (hang). Our detached Chrome is NOT owned by
// Playwright, so exiting Node does not close it. Small delay lets stdout flush first.
function finishExit(code) {
  // Drain stdout, then hard-exit so the open CDP socket can't keep us alive.
  try {
    if (process.stdout.writableLength === 0) { process.exit(code); return; }
  } catch (_) {}
  setTimeout(function () { process.exit(code); }, 60);
}

main().then(function () {
  finishExit(0);
}).catch(function (e) {
  process.stderr.write(String(e && e.message ? e.message : e));
  finishExit(1);
});
