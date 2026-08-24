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
// Open the LinkedIn compose box for the profile currently loaded in `page`, and return the
// REAL editable element (or null). Shared by `message` and `typemsg`.
//
// Why this is not just "click the Message button": on the current LinkedIn layout that button is
// an <a href="/messaging/compose/?profileUrn=…&interop=msgOverlay"> — a genuine navigation link.
// Clicking it navigates away, so the old code's immediate look for an overlay found nothing on the
// page it was still holding. Worse, its existence check used a comma-selector that included
// `.msg-overlay-conversation-bubble` — an ANCESTOR wrapper, not an input — so `.count() > 0` could
// be true with no compose box anywhere, which is exactly how it reported MESSAGE_BOX_OPENED while
// the user stared at a plain profile page. Verified live: reading the anchor's href and navigating
// straight to it yields exactly one visible `.msg-form__contenteditable` every time.
//
// Returns { box, why } — box is a Playwright locator for the editable, or null with a reason.
async function openLinkedInComposeBox(page) {
  // Only the actual editable counts as "the box" — never a wrapper.
  var EDITABLE = '.msg-form__contenteditable';
  var FALLBACK = '[contenteditable="true"][role="textbox"]';

  var visibleBox = async function () {
    for (var i = 0; i < 2; i++) {
      var sel = i === 0 ? EDITABLE : FALLBACK;
      try {
        var loc = page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible()) return loc;
      } catch (_) {}
    }
    return null;
  };

  // Already open (e.g. we're on a messaging page already)?
  var existing = await visibleBox();
  if (existing) return { box: existing, why: '' };

  // Preferred path — read the compose link off the profile and go straight there.
  var href = null;
  try {
    href = await page.evaluate(function () {
      var as = document.querySelectorAll('main a[href*="/messaging/compose"], a[href*="/messaging/compose"]');
      for (var i = 0; i < as.length; i++) {
        var t = (as[i].innerText || '').trim();
        if (!t || /^message$/i.test(t)) return as[i].getAttribute('href');
      }
      return as.length ? as[0].getAttribute('href') : null;
    });
  } catch (_) {}

  if (href) {
    var full = href.indexOf('http') === 0 ? href : 'https://www.linkedin.com' + href;
    try { await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}
    try { await page.waitForSelector(EDITABLE, { timeout: 9000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 600); });
    var afterNav = await visibleBox();
    if (afterNav) return { box: afterNav, why: '' };
  }

  // Fallback for older/alternate layouts where Message really is a JS button. Must be a TRUSTED
  // Playwright click — a synthetic el.click() inside evaluate() is ignored by LinkedIn's handler.
  var clicked = false;
  try {
    var loc = page.locator('main a, main button', { hasText: /^Message$/ }).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
    await loc.click({ timeout: 5000 });
    clicked = true;
  } catch (_) {}
  if (!clicked) { try { await page.getByRole('button', { name: /^Message$/ }).first().click({ timeout: 4000 }); clicked = true; } catch (_) {} }
  if (clicked) {
    try { await page.waitForSelector(EDITABLE, { timeout: 8000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 800); });
    var afterClick = await visibleBox();
    if (afterClick) return { box: afterClick, why: '' };
  }

  return { box: null, why: href || clicked
    ? 'The chat box did not open (LinkedIn may still be loading, or messaging is restricted for this person).'
    : 'No Message button on this profile — you may not be connected to them yet.' };
}

/**
 * A HUMAN CHECK is not a login page, and waiting it out is the wrong move.
 *
 * LinkedIn answers automated-looking traffic with /checkpoint/challengesV2. Measured live on a
 * real session, that page was its DEVICE CONFIRMATION — "open your LinkedIn app and tap Yes" —
 * which renders as ~400 characters and a spinner, i.e. it looks to the user like a blank window
 * that never loads. It can also be a reCAPTCHA behind
 * li.protechts.net. isAuthWall lumps it in with a login, so the caller then sat in
 * pollForLoginCompletion for 30 seconds. Add that to a 25-second navigation and the command blows
 * past Rust's 45-second cap, gets abandoned, and the user is told something untrue about their
 * inbox. A CAPTCHA also takes longer than any poll window we could justify: the honest move is to
 * bring the window forward, say what is being asked, and return at once so they can solve it and
 * press the button again.
 */
var START_MS = Date.now();   // when this command began — see pollForLoginCompletion

function isHumanCheck(url) {
  return /\/checkpoint\/(challenge|challengesV2)|\/checkpoint\/rp\/|px-captcha|protechts\.net/i.test(url || '');
}

async function pollForLoginCompletion(page, maxWait) {
  // NEVER outlive the caller. Rust abandons this process at 45 seconds, and a command that has
  // already spent 25 of them navigating has nowhere near `maxWait` left — it just gets killed, and
  // the user is told something false about their inbox rather than being asked to sign in. Spend
  // only what is actually left of a 38-second budget, with a floor so the poll is never pointless.
  var spent = Date.now() - START_MS;
  var budget = Math.max(5000, Math.min(maxWait, 38000 - spent));
  var deadline = Date.now() + budget;
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
  // EXCLUDE our custom commands — they are handled by their OWN blocks further down. Without this
  // exclusion they fell into here, matched none of navigate/snapshot/click/…, and hit the "(done)"
  // fall-through at the end of this block — so `connections` opened Chrome but returned nothing
  // ("couldn't read any names"). This is THE bug behind the whole /scan saga.
  if (cmd !== 'open' && cmd !== 'close'
      && cmd !== 'connections' && cmd !== 'logincheck' && cmd !== 'message' && cmd !== 'printpdf'
      && cmd !== 'findprofile' && cmd !== 'messages' && cmd !== 'typemsg' && cmd !== 'meetlink' && cmd !== 'whatsapp'
      && cmd !== 'readthread' && cmd !== 'gcalcheck' && cmd !== 'sentinvites' && cmd !== 'humancheck'
      && cmd !== 'gmailthread' && cmd !== 'sendmsg' && cmd !== 'sendmail' && cmd !== 'webmail') {
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
          // A <label for="x"> / wrapping <label> is how most real forms name their fields. Without
          // this an <input id="email"> with its caption in a sibling <label> looked completely
          // anonymous — and, because unnamed fields were skipped entirely below, never appeared in
          // the snapshot at all. That is why filling an unfamiliar form used to be guesswork.
          var viaLabel = '';
          try {
            var id = el.getAttribute('id');
            if (id) {
              var lab = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
              if (lab) viaLabel = lab.innerText || lab.textContent || '';
            }
            if (!viaLabel && el.closest) {
              var wrap = el.closest('label');
              if (wrap) viaLabel = wrap.innerText || wrap.textContent || '';
            }
            if (!viaLabel) viaLabel = el.getAttribute('aria-labelledby')
              ? ((document.getElementById(el.getAttribute('aria-labelledby')) || {}).innerText || '')
              : '';
          } catch (_) {}
          return (
            el.getAttribute('aria-label') ||
            viaLabel ||
            el.innerText || el.textContent ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.getAttribute('title') || ''
          ).trim().replace(/\s+/g, ' ').slice(0, 100);
        }

        function walk(el, depth) {
          if (!el || !el.tagName) return '';
          var tag = el.tagName.toLowerCase();
          if (['script','style','noscript','svg','head'].includes(tag)) return '';
          var line = '';
          if (isInteractive(el)) {
            var label = getLabel(el);
            // A form control is worth listing even with no label at all — it still has to be filled.
            // Previously anonymous inputs were dropped, which is precisely the field the agent then
            // could not complete.
            var isField = ['input', 'select', 'textarea'].indexOf(tag) !== -1;
            if (label || el.getAttribute('placeholder') || isField) {
              el.setAttribute('data-aref', 'e' + (++idx));
              var indent = '  '.repeat(Math.min(depth, 6));
              var type  = el.getAttribute('type')        ? ' type='         + el.getAttribute('type')         : '';
              var ph    = el.getAttribute('placeholder') ? ' placeholder="' + el.getAttribute('placeholder') + '"' : '';
              var href  = el.getAttribute('href')        ? ' href="'        + (el.getAttribute('href')||'').slice(0,60) + '"' : '';
              var role  = el.getAttribute('role')        ? ' role='         + el.getAttribute('role')         : '';
              var chk   = el.checked !== undefined && el.checked ? ' checked' : '';
              var req   = (el.required || el.getAttribute('aria-required') === 'true') ? ' REQUIRED' : '';
              var nm    = el.getAttribute('name')        ? ' name='         + el.getAttribute('name')         : '';
              // Current value, so the agent can tell an already-filled field from an empty one and
              // not clobber something the user typed.
              var val = '';
              try {
                if (tag === 'input' && ['checkbox', 'radio', 'file', 'password'].indexOf((el.getAttribute('type') || '').toLowerCase()) === -1 && el.value) val = ' value="' + String(el.value).slice(0, 40) + '"';
                else if (tag === 'textarea' && el.value) val = ' value="' + String(el.value).slice(0, 40) + '"';
              } catch (_) {}
              // A <select> is unusable without knowing what may be chosen — list the options so the
              // agent picks a real one instead of inventing a value the form will reject.
              var opts = '';
              if (tag === 'select') {
                try {
                  var os = Array.prototype.slice.call(el.options || []).slice(0, 25)
                    .map(function (o) { return (o.text || o.value || '').trim(); }).filter(Boolean);
                  if (os.length) opts = ' options=[' + os.join(' | ').slice(0, 300) + ']';
                  if (el.value) val = ' selected="' + String(el.value).slice(0, 40) + '"';
                } catch (_) {}
              }
              line = indent + '[@' + el.getAttribute('data-aref') + '] <' + tag + type + nm + ph + href + role + chk + req + val + opts + '> ' + label + '\n';
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

    // ── select <selector> <option> ──────────────────────────────────────────────
    // Choose an option in a <select>. page.fill() does nothing to a dropdown, so before this a form
    // with a country/plan/category picker simply could not be completed. Matches by visible label
    // first, then by value, then case-insensitively — the agent reads labels off the snapshot, but
    // the underlying value is often a code ("IN" for "India").
    if (cmd === 'select') {
      var selSel = argv[1] || '';
      var selVal = argv.slice(2).join(' ').replace(/^"|"$/g, '').trim();
      if (!selSel || !selVal) { process.stdout.write('select: missing selector or option'); return; }
      var selTarget = selSel.startsWith('@') ? '[data-aref="' + selSel.slice(1) + '"]' : selSel;
      var chosen = null;
      var attempts = [{ label: selVal }, { value: selVal }];
      for (var ai = 0; ai < attempts.length && !chosen; ai++) {
        try { await page.selectOption(selTarget, attempts[ai], { timeout: 6000 }); chosen = selVal; } catch (_) {}
      }
      if (!chosen) {
        // Last resort: case/whitespace-insensitive match against the real option list.
        try {
          var match = await page.evaluate(function (a) {
            var el = document.querySelector(a.sel);
            if (!el || !el.options) return null;
            var want = a.want.toLowerCase().trim();
            for (var i = 0; i < el.options.length; i++) {
              var o = el.options[i];
              if ((o.text || '').toLowerCase().trim() === want || (o.value || '').toLowerCase().trim() === want) return o.value;
            }
            for (var j = 0; j < el.options.length; j++) {
              if ((el.options[j].text || '').toLowerCase().indexOf(want) !== -1) return el.options[j].value;
            }
            return null;
          }, { sel: selTarget, want: selVal });
          if (match !== null) { await page.selectOption(selTarget, { value: match }, { timeout: 5000 }); chosen = match; }
        } catch (_) {}
      }
      if (!chosen) {
        var avail = await page.evaluate(function (s) {
          var el = document.querySelector(s);
          return el && el.options ? Array.prototype.slice.call(el.options).map(function (o) { return o.text; }).slice(0, 25) : [];
        }, selTarget).catch(function () { return []; });
        process.stdout.write('select-error: no option matching "' + selVal + '".' + (avail.length ? ' Available: ' + avail.join(' | ') : ' (could not read the options)'));
        return;
      }
      writeState({ url: page.url() });
      process.stdout.write('Selected "' + selVal + '" in "' + selSel + '". Nothing was submitted.');
      return;
    }

    // ── check <selector> [on|off] ───────────────────────────────────────────────
    // Tick or untick a checkbox / choose a radio. Clicking these blindly TOGGLES them, so asking
    // for a state (rather than a click) is what makes a re-run safe: setting an already-ticked box
    // to "on" must leave it ticked, not turn it off.
    if (cmd === 'check') {
      var ckSel = argv[1] || '';
      var ckWant = (argv[2] || 'on').replace(/^"|"$/g, '').trim().toLowerCase();
      if (!ckSel) { process.stdout.write('check: missing selector'); return; }
      var ckTarget = ckSel.startsWith('@') ? '[data-aref="' + ckSel.slice(1) + '"]' : ckSel;
      var wantOn = !(ckWant === 'off' || ckWant === 'false' || ckWant === 'uncheck' || ckWant === 'no');
      try {
        var loc = page.locator(ckTarget).first();
        if (wantOn) await loc.check({ timeout: 6000 });
        else await loc.uncheck({ timeout: 6000 });
      } catch (e) {
        process.stdout.write('check-error: ' + (e && e.message ? String(e.message).slice(0, 200) : String(e)));
        return;
      }
      writeState({ url: page.url() });
      process.stdout.write((wantOn ? 'Ticked ' : 'Unticked ') + '"' + ckSel + '". Nothing was submitted.');
      return;
    }

    // ── upload <selector> <filePath> ────────────────────────────────────────────
    // Attach a local file to a <input type="file"> the agent found via snapshot (@ref) or a CSS
    // selector — same ref-resolution convention as click/fill. Only sets the input's value; it
    // never submits anything, same safety boundary as fill.
    if (cmd === 'upload') {
      var upSel  = argv[1] || '';
      var upPath = argv.slice(2).join(' ').replace(/^"|"$/g, '').trim();
      if (!upSel || !upPath) { process.stdout.write('upload: missing selector or file path'); return; }
      var upTarget = upSel.startsWith('@') ? '[data-aref="' + upSel.slice(1) + '"]' : upSel;
      try {
        await page.setInputFiles(upTarget, upPath, { timeout: 10000 });
        writeState({ url: page.url() });
        process.stdout.write('Attached "' + upPath + '" to "' + upSel + '". Nothing was submitted — the file is only staged in the form field.');
      } catch (e) {
        process.stdout.write('upload-error: ' + (e && e.message ? String(e.message).slice(0, 200) : String(e)));
      }
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

  // ── logincheck [linkedin] ───────────────────────────────────────────────────
  // Non-disruptive login probe: checks the persistent browser's COOKIES for the site's auth
  // cookie WITHOUT navigating anywhere — so we can poll for "has the user signed in yet?" while
  // they're mid-login without yanking the page out from under them. LinkedIn's auth cookie is li_at.
  if (cmd === 'logincheck') {
    var dom = (argv[1] || 'linkedin').toLowerCase();
    var lc = await ensureChrome();
    var lctx = lc && lc.context;
    if (!lctx) { process.stdout.write('LOGGED_OUT'); return; }
    var cookies = []; try { cookies = await lctx.cookies(); } catch (_) {}
    var authName = dom.indexOf('linkedin') !== -1 ? 'li_at' : (dom.indexOf('twitter') !== -1 || dom.indexOf('x.com') !== -1 ? 'auth_token' : 'li_at');
    var hostPart = dom.indexOf('linkedin') !== -1 ? 'linkedin.com' : dom;
    var logged = cookies.some(function (c) { return (c.domain || '').indexOf(hostPart) !== -1 && c.name === authName && c.value; });
    process.stdout.write(logged ? 'LOGGED_IN' : 'LOGGED_OUT');
    return;
  }

  // ── connections [limit] ────────────────────────────────────────────────────
  // Load the "My Network → Connections" page, scroll + click "Load more" until we have
  // `limit` connections (bounded well under Rust's 30s cap), then return the RAW innerText
  // — the exact on-screen list. The caller parses real names from this in code, so the model
  // can NEVER rewrite/hallucinate them (the bug where 8 fake "Gupta" names got saved).
  if (cmd === 'connections') {
    var wantN = parseInt(argv[1], 10) || 50;
    // RESUME: keep the already-loaded list and carry on scrolling from where the last pass stopped.
    // Without this every pass reloads the page and has to re-scroll past everyone already saved, so
    // once a few hundred people are stored a pass spends its whole budget re-reading known names and
    // returns almost nobody new. Chrome is persistent, so the list is still on screen between calls.
    var cResume = /resume/i.test(argv[2] || '');
    var cConn = await ensureChrome();
    var cCtx  = cConn.context;
    if (!cCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    // Pick the tab that is ACTUALLY on the connections list, not simply the last one opened. A
    // resume pass reuses the loaded list, and `.at(-1)` handed back whatever tab happened to be
    // newest (a profile the copilot opened, say) — so resume saw an unpopulated page, reloaded the
    // list from scratch, and every pass came back with the same first ~200 people forever.
    var cPage = null;
    try {
      var cPages = cCtx.pages();
      for (var cpi = cPages.length - 1; cpi >= 0; cpi--) {
        if (/\/mynetwork\/invite-connect\/connections/.test(cPages[cpi].url())) { cPage = cPages[cpi]; break; }
      }
      if (!cPage) cPage = cPages.at(-1);
    } catch (_) {}
    if (!cPage) cPage = await cCtx.newPage();
    // Bring the window forward so the user actually SEES it working (and can log in if needed).
    try { await cPage.bringToFront(); } catch (_) {}
    var connUrl = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
    // Only reload when we are not already sitting on a populated connections list.
    var cOnList = false;
    if (cResume) {
      try {
        cOnList = /\/mynetwork\/invite-connect\/connections/.test(cPage.url())
          && (await cPage.evaluate(function () { return document.querySelectorAll('a[href*="/in/"]').length; })) > 0;
      } catch (_) { cOnList = false; }
    }
    if (!cOnList) {
      try { await cPage.goto(connUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch (_) {}
      try { await cPage.waitForLoadState('networkidle', { timeout: 2500 }); } catch (_) {}
    }
    var cFinal = cPage.url();
    // NOT SIGNED IN → do NOT wait/poll here (a long poll blows past the 45s process budget, which
    // makes the node path time out and fall back to the generic agent-browser.exe — that opens a
    // blank window and can't read LinkedIn, which is the "browser opens but nothing loads" bug).
    // Instead leave the window open on the login page and tell the user to sign in + rerun. Fast.
    if (isHumanCheck(cFinal)) {
      await showBanner(cPage, 'LinkedIn needs you to confirm this sign-in — it may be waiting for you to tap Yes in the LinkedIn app on your phone. Then run /scan again; nothing is lost.');
      try { await cPage.bringToFront(); } catch (_) {}
      writeState({ url: cFinal });
      process.stdout.write('[HUMAN_CHECK_REQUIRED] LinkedIn is showing a sign-in confirmation. It may be waiting for the user to tap Yes in the LinkedIn app on their phone. Complete it in the ADRIS browser window, then try again.');
      return;
    }
    if (isAuthWall(cFinal)) {
      await showBanner(cPage, 'Sign in to LinkedIn in THIS window, then run /scan again — it reads your connections automatically.');
      try { await cPage.bringToFront(); } catch (_) {}
      writeState({ url: cFinal });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there (once, it is saved), then run /scan again.');
      return;
    }
    await showBanner(cPage, 'ADRIS is reading your LinkedIn connections — please don’t close this window.');
    // Wait for the connection cards to render — the /in/ profile links (document-wide, not just
    // <main>, so it matches the extraction below and doesn't miss a differently-nested layout).
    try { await cPage.waitForSelector('a[href*="/in/"]', { timeout: 9000 }); } catch (_) {}
    if (!cOnList) {
      try { await progressiveScroll(cPage); } catch (_) {}
      try { await waitForContentStability(cPage, 300, 1500); } catch (_) {} // let the list settle (proven open-cmd helper)
    }
    // Probe: distinguish not-signed-in / wrong-page from genuinely-no-connections so the message is
    // accurate. Fast — no polling.
    var probe = await cPage.evaluate(function() {
      var n = document.querySelectorAll('a[href*="/in/"]').length;
      var login = !!(document.querySelector('input[name="session_key"], input#username, .login__form, a[href*="/uas/login"], a[href*="/login"], form[action*="login"]'))
        || /\/(login|authwall|checkpoint|uas\/login)/.test(location.href);
      return { n: n, login: login };
    }).catch(function () { return { n: 0, login: false }; });
    if (probe.n === 0 && probe.login) {
      await showBanner(cPage, 'Sign in to LinkedIn in THIS window, then run /scan again.');
      try { await cPage.bringToFront(); } catch (_) {}
      writeState({ url: cFinal });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there (once, it is saved), then run /scan again.');
      return;
    }
    // A resume pass skips the navigation + settle work above, so it can spend that time scrolling
    // instead. A fresh pass keeps the old, proven budget — the whole process must stay under Rust's
    // 45s cap or run_browser_persistent falls back to the blank-window exe.
    var cDeadline = Date.now() + (cOnList ? 37000 : 26000);
    var cLast = 0, cStall = 0, cExhausted = false;
    var cCountPeople = function () {
      return cPage.evaluate(function() {
        var s = {}, a = document.querySelectorAll('a[href*="/in/"]');
        for (var i = 0; i < a.length; i++) { var h = (a[i].getAttribute('href') || '').split('?')[0]; if (h.indexOf('/in/') > -1) s[h] = 1; }
        return Object.keys(s).length;
      }).catch(function () { return 0; });
    };
    while (Date.now() < cDeadline) {
      // Count UNIQUE people (by profile href) — each card has ~2 /in/ anchors, so counting raw
      // anchors made the loop stop at ~half the requested count (the "only 30 of 50" bug).
      var cCount = await cCountPeople();
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
          // A button that is out of view can be a no-op click. Bring it into view first.
          if (btn) { try { btn.scrollIntoView({ block: 'center' }); } catch (e) {} btn.click(); }
        }).catch(function () {});
      } catch (_) {}
      // WAIT FOR GROWTH instead of a flat 1.3s. LinkedIn regularly takes 2-4s to append the next
      // batch, so a fixed short wait read as "no growth" three times in a row and declared the list
      // finished at ~200 people on a 766-person network. Poll up to 5s, and stop as soon as it grows.
      var cGrew = false;
      for (var cw = 0; cw < 10; cw++) {
        await new Promise(function (r) { setTimeout(r, 500); });
        if (Date.now() >= cDeadline) break;
        if ((await cCountPeople()) > cCount) { cGrew = true; break; }
      }
      if (!cGrew) {
        // Five seconds of no new people, twice running, with the page scrolled to the bottom and no
        // Load-more left = genuinely the end of the list. Report that, so the caller can tell "we
        // ran out of time" apart from "there is nobody else" instead of guessing.
        cStall++;
        if (cStall >= 2) {
          cExhausted = await cPage.evaluate(function () {
            var btn = document.querySelector('button.scaffold-finite-scroll__load-button');
            if (!btn) { var bs = [].slice.call(document.querySelectorAll('button')); for (var i = 0; i < bs.length; i++) { if (/load more/i.test(bs[i].textContent || '')) { btn = bs[i]; break; } } }
            return !btn;
          }).catch(function () { return false; });
          break;
        }
      } else cStall = 0;
      cLast = cCount;
    }
    await hideBanner(cPage);
    // Extract each connection from the DOM. LinkedIn's connection card is an obfuscated <div>
    // (no <li>, hashed classes) whose profile /in/ link is just the AVATAR (empty text). The clean
    // data is in the card's innerText lines: [name, headline, "Connected on <date>", "Message"].
    // So: from each unique /in/ anchor, walk UP to the card (nearest ancestor whose text contains
    // "Connected on"), then take the first two non-noise lines as name + headline. This is VERIFIED
    // live against the user's real logged-in connections page (real names + correct headlines).
    var people = await cPage.evaluate(function() {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
      var skip = /^(message|connect|following|pending|connected on|•|·|\d+(st|nd|rd|th)\b|view .*profile)/i;
      var out = [], seen = {};
      var anchors = document.querySelectorAll('a[href*="/in/"]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = (a.getAttribute('href') || '');
        if (href.indexOf('/in/') === -1) continue;
        var key = href.split('?')[0].replace(/\/$/, '');
        if (seen[key]) continue;
        // Walk up to the card: nearest ancestor whose text has a name line + "Connected on".
        var card = a, hops = 0;
        while (card && hops < 7) {
          var t = card.innerText || '';
          if (/connected on/i.test(t) && t.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).length >= 2) break;
          card = card.parentElement; hops++;
        }
        if (!card) continue;
        var lines = (card.innerText || '').split('\n').map(function (x) { return clean(x); }).filter(Boolean);
        var picked = [];
        for (var j = 0; j < lines.length && picked.length < 2; j++) {
          if (!skip.test(lines[j]) && lines[j].length >= 2) picked.push(lines[j]);
        }
        if (!picked.length || picked[0].length > 90) continue;
        seen[key] = 1;
        out.push({ name: picked[0], headline: picked[1] || '', url: key });
      }
      return out;
    }).catch(function () { return []; });
    writeState({ url: cFinal });
    // `exhausted` lets the caller distinguish "LinkedIn has no more to give" from "this pass ran out
    // of its 45s budget" — the difference between correctly stopping and wrongly telling the user
    // their whole network is already saved.
    if (people && people.length) { process.stdout.write('CONN_JSON:' + JSON.stringify({ people: people, exhausted: cExhausted, loaded: people.length })); return; }
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

  // ── messages [limit] ─────────────────────────────────────────────────────────
  // Read the REAL text of the user's LinkedIn conversations (not a guess) so replies can be
  // grounded in what the other person actually said. Lists threads in the left rail (unread
  // first), opens each one, and pulls the last few messages with their sender label straight
  // from the DOM. `.msg-conversation-listitem` / `.msg-s-message-list__event` /
  // `.msg-s-event-listitem__body` are LinkedIn's long-stable messaging classes (unlike the
  // hashed classes on the feed/profile pages), same family as `.msg-form__contenteditable`
  // already relied on by the `message` command below.
  if (cmd === 'messages') {
    var wantN = parseInt(argv[1], 10) || 10;
    var mxConn = await ensureChrome();
    var mxCtx  = mxConn.context;
    if (!mxCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var mxPage = mxCtx.pages().at(-1) || await mxCtx.newPage();
    try { await mxPage.bringToFront(); } catch (_) {}
    var inboxUrl = 'https://www.linkedin.com/messaging/';
    try { await mxPage.goto(inboxUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch (_) {}
    try { await mxPage.waitForLoadState('networkidle', { timeout: 2500 }); } catch (_) {}
    var mxFinal = mxPage.url();
    if (isHumanCheck(mxFinal)) {
      await showBanner(mxPage, 'LinkedIn needs you to confirm this sign-in — it may be waiting for you to tap Yes in the LinkedIn app on your phone. Then ask me to check your messages again; nothing is lost.');
      try { await mxPage.bringToFront(); } catch (_) {}
      writeState({ url: mxFinal });
      process.stdout.write('[HUMAN_CHECK_REQUIRED] LinkedIn is showing a sign-in confirmation. It may be waiting for the user to tap Yes in the LinkedIn app on their phone. Complete it in the ADRIS browser window, then try again.');
      return;
    }
    if (isAuthWall(mxFinal)) {
      await showBanner(mxPage, 'Sign in to LinkedIn in THIS window, then ask me to check your messages again.');
      try { await mxPage.bringToFront(); } catch (_) {}
      writeState({ url: mxFinal });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there (once, it is saved), then try again.');
      return;
    }
    await showBanner(mxPage, 'ADRIS is reading your LinkedIn messages — please don’t close this window.');
    try { await mxPage.waitForSelector('li.msg-conversation-listitem, .msg-conversations-container__convo-item-link', { timeout: 9000 }); } catch (_) {}
    try { await waitForContentStability(mxPage, 300, 1500); } catch (_) {}

    var threadInfo = await mxPage.evaluate(function() {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
      var items = document.querySelectorAll('li.msg-conversation-listitem');
      var out = [];
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var nameEl = el.querySelector('.msg-conversation-listitem__participant-names');
        var name = clean(nameEl ? nameEl.innerText : '');
        if (!name) continue;
        var unread = !!el.querySelector('.notification-badge__count, [class*="unread-count"]')
          || /unread/i.test(el.className || '');
        out.push({ name: name, unread: unread });
      }
      return out;
    }).catch(function () { return []; });

    if (!threadInfo.length) {
      var diagI = await mxPage.evaluate(function() {
        var m = document.querySelector('main') || document.body;
        return { url: location.href, title: document.title, snippet: ((m && m.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 200) };
      }).catch(function () { return {}; });
      await hideBanner(mxPage);
      writeState({ url: mxPage.url() });
      process.stdout.write('MSGS_DIAG:' + JSON.stringify(diagI));
      return;
    }

    // Unread first, capped so the whole pass stays inside the 45s process budget.
    var ordered = threadInfo.slice().sort(function(a, b) { return (b.unread ? 1 : 0) - (a.unread ? 1 : 0); }).slice(0, wantN);
    var results = [];
    for (var t = 0; t < ordered.length; t++) {
      var target = ordered[t];
      var handles = await mxPage.$$('li.msg-conversation-listitem');
      var matchHandle = null;
      for (var h = 0; h < handles.length; h++) {
        var hn = await handles[h].evaluate(function(el) {
          var n = el.querySelector('.msg-conversation-listitem__participant-names');
          return n ? n.innerText.replace(/[ \t]+/g, ' ').trim() : '';
        }).catch(function () { return ''; });
        if (hn === target.name) { matchHandle = handles[h]; break; }
      }
      if (!matchHandle) continue;
      try { await matchHandle.click({ timeout: 4000 }); } catch (_) { continue; }
      await new Promise(function (r) { setTimeout(r, 1400); });
      try { await mxPage.waitForSelector('.msg-s-message-list-container, .msg-s-message-list__event', { timeout: 6000 }); } catch (_) {}
      await new Promise(function (r) { setTimeout(r, 500); });

      var convo = await mxPage.evaluate(function(participant) {
        function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
        var groups = document.querySelectorAll('li.msg-s-message-list__event, .msg-s-message-list__event');
        var out = [];
        var lastSender = '';
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          var nameEl = g.querySelector('.msg-s-message-group__name, .msg-s-message-group__profile-link');
          var name = nameEl ? clean(nameEl.innerText) : '';
          if (name) lastSender = name;
          var bodyEls = g.querySelectorAll('.msg-s-event-listitem__body');
          for (var j = 0; j < bodyEls.length; j++) {
            var text = clean(bodyEls[j].innerText);
            if (!text) continue;
            // WHO SAID THIS — decided from the DOM, not from the name text. LinkedIn puts
            // `msg-s-event-listitem--other` on the OTHER person's messages; its absence means the
            // account owner sent it. Names alone were never enough: LinkedIn prints a sender name
            // only on the FIRST message of a consecutive run, so `lastSender` carried the wrong
            // name whenever a run began before the visible window — and the reader then read the
            // owner's own words as the other person's, and drafted a reply to the user's own
            // message. This class is on every message, so it cannot drift.
            var item = bodyEls[j].closest('.msg-s-event-listitem');
            var isOther = !!(item && item.classList.contains('msg-s-event-listitem--other'));
            out.push({ from: lastSender || (isOther ? participant : 'You'), isYou: !isOther, text: text });
          }
        }
        // The other participant's profile link — reliably scoped to the thread header, unlike the
        // message bodies which link BOTH participants' avatars (so a generic /in/ query would be
        // ambiguous in a 1:1 chat).
        var profileEl = document.querySelector('.msg-thread__link-to-profile, a.msg-thread__link-to-profile');
        var profileUrl = profileEl ? (profileEl.getAttribute('href') || '').split('?')[0] : '';
        // Keep a decent run of history, not just the tail: deciding whether a thread still needs a
        // reply means knowing what was already asked, answered and agreed earlier in it — judging
        // only by who spoke last produces both false "needs a reply" and missed follow-ups.
        return { messages: out.slice(-20), profileUrl: profileUrl };
      }, target.name).catch(function () { return { messages: [], profileUrl: '' }; });

      results.push({ name: target.name, unread: target.unread, url: convo.profileUrl, messages: convo.messages });
    }

    await hideBanner(mxPage);
    writeState({ url: mxPage.url() });
    if (!results.length) { process.stdout.write("Opened LinkedIn messaging but couldn't read any conversation content — the page may not have finished loading. Try again in a moment."); return; }
    process.stdout.write('MSGS_JSON:' + JSON.stringify(results));
    return;
  }

  // ── gcalcheck ────────────────────────────────────────────────────────────────
  // Read the user's upcoming calendar STRAIGHT FROM THE BROWSER (their logged-in Google), so the
  // outreach copilot can check availability without them connecting Google via OAuth. Opens the
  // Schedule/agenda view and returns its visible text — the model reads "you have X at 9am" from it,
  // which is far more robust than scraping Calendar's shifting DOM into structured fields.
  if (cmd === 'gcalcheck') {
    var gcConn = await ensureChrome();
    var gcCtx  = gcConn.context;
    if (!gcCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var gcPage = gcCtx.pages().at(-1) || await gcCtx.newPage();
    try { await gcPage.bringToFront(); } catch (_) {}
    // Schedule view lists upcoming events as plain rows (date · time · title) — ideal to read as text.
    try { await gcPage.goto('https://calendar.google.com/calendar/u/0/r/agenda', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}
    var gcFinal = gcPage.url();
    if (isAuthWall(gcFinal) || /accounts\.google\.com/.test(gcFinal)) {
      await showBanner(gcPage, 'Sign in to Google in THIS window to let ADRIS check your calendar, then try again.');
      writeState({ url: gcFinal });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened Google Calendar in the ADRIS browser — please sign in there, then try again.');
      return;
    }
    await showBanner(gcPage, 'ADRIS is checking your calendar for conflicts — please don’t close this window.');
    try { await gcPage.waitForLoadState('networkidle', { timeout: 3000 }); } catch (_) {}
    try { await gcPage.waitForSelector('[role="main"], [role="grid"], .GVQtR', { timeout: 6000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 900); });
    var gcText = await gcPage.evaluate(function() {
      var main = document.querySelector('[role="main"]') || document.body;
      var t = (main && main.innerText ? main.innerText : '').replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      return t.slice(0, 2500);
    }).catch(function () { return ''; });
    await hideBanner(gcPage);
    writeState({ url: gcPage.url() });
    if (!gcText) { process.stdout.write('CALENDAR_EMPTY Opened your calendar but could not read it — it may still be loading.'); return; }
    process.stdout.write('CALENDAR_TEXT:' + gcText);
    return;
  }

  // ── meetlink ────────────────────────────────────────────────────────────────
  // Mint a REAL, shareable Google Meet link. meet.google.com/new creates a room and then redirects
  // to https://meet.google.com/xxx-xxxx-xxx — that final URL is the link you can send someone.
  // The redirect is NOT instant (it lands on /new?pli=1 first and swaps a couple of seconds later),
  // so we poll the URL rather than reading it once; checking immediately returns the pre-redirect
  // page and looks like a failure. Observed ~3s on a signed-in profile; capped at 20s to stay well
  // inside the 45s process budget. Requires the user to be signed in to Google in this browser.
  if (cmd === 'meetlink') {
    var mlConn = await ensureChrome();
    var mlCtx  = mlConn.context;
    if (!mlCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var mlPage = mlCtx.pages().at(-1) || await mlCtx.newPage();
    try { await mlPage.goto('https://meet.google.com/new', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}
    var CODE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i;
    var mlUrl = '';
    for (var mi = 0; mi < 13; mi++) {
      var cur = mlPage.url();
      if (CODE.test(cur)) { mlUrl = cur.split('?')[0]; break; }
      if (isAuthWall(cur) || /accounts\.google\.com/i.test(cur)) {
        writeState({ url: cur });
        process.stdout.write('[SIGN_IN_REQUIRED] Sign in to Google in the ADRIS browser, then try again.');
        return;
      }
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
    writeState({ url: mlPage.url() });
    if (!mlUrl) { process.stdout.write('[no-meet-link] Google Meet did not hand back a meeting link in time.'); return; }
    process.stdout.write('MEET_URL:' + mlUrl);
    return;
  }

  // ── findprofile <query> ─────────────────────────────────────────────────────
  // Search LinkedIn People for <query> (usually a connection's name) and return the top few
  // REAL results as JSON — {name, headline, url, degree} read straight from the results page.
  // Used by /verifylinks to repair outreach contacts whose saved profile link is missing/wrong:
  // the caller matches the returned names against the contact and writes the correct /in/ URL back.
  // Opens fast and returns quickly (no deep scroll) to stay well under the 45s process budget.
  if (cmd === 'findprofile') {
    // findprofile "<name>" ::: <city or extra keywords>
    //
    // A bare name search returns everyone who shares it, and picking the top hit is how a lead
    // ends up pointing at a stranger. The extra terms go into the query AND come back out as each
    // result's own location line, so the caller can insist on the right city rather than hoping.
    var fRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var fParts = fRaw.split(':::');
    var fq = (fParts[0] || '').replace(/^"|"$/g, '').trim();
    var fFilter = (fParts[1] || '').replace(/^"|"$/g, '').trim();
    if (!fq) { process.stdout.write('PROFILE_JSON:[]'); return; }
    var fConn = await ensureChrome();
    var fCtx  = fConn.context;
    if (!fCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var fPage = fCtx.pages().at(-1) || await fCtx.newPage();
    try { await fPage.bringToFront(); } catch (_) {}
    var searchUrl = 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(fFilter ? (fq + ' ' + fFilter) : fq);
    try { await fPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch (_) {}
    var fFinal = fPage.url();
    if (isAuthWall(fFinal)) {
      await showBanner(fPage, 'Sign in to LinkedIn in THIS window, then run /verifylinks again.');
      try { await fPage.bringToFront(); } catch (_) {}
      writeState({ url: fFinal });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there, then try again.');
      return;
    }
    await showBanner(fPage, 'ADRIS is finding the correct LinkedIn profile — please don’t close this window.');
    // Let the results list render. People-search results are always /in/ anchors inside the list.
    try { await fPage.waitForSelector('a[href*="/in/"]', { timeout: 9000 }); } catch (_) {}
    try { await waitForContentStability(fPage, 300, 1200); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 800); });
    var results = await fPage.evaluate(function() {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
      var noise = /^(message|connect|follow|following|pending|view .*profile|• 1st|• 2nd|• 3rd|status is|current company|save|more)/i;
      // Prefer the search results container so we skip the sidebar / "people you may know" rails.
      var scope = document.querySelector('.search-results-container') || document.querySelector('main') || document.body;
      var out = [], seen = {};
      var anchors = scope.querySelectorAll('a[href*="/in/"]');
      for (var i = 0; i < anchors.length && out.length < 6; i++) {
        var a = anchors[i];
        var href = (a.getAttribute('href') || '');
        if (href.indexOf('/in/') === -1) continue;
        var url = href.split('?')[0].replace(/\/$/, '');
        if (!/^https?:/i.test(url)) url = 'https://www.linkedin.com' + url;
        var key = url.toLowerCase();
        if (seen[key]) continue;
        // Walk up to the result card (nearest ancestor with a name line + a degree/headline).
        var card = a, hops = 0;
        while (card && hops < 6) {
          var ct = card.innerText || '';
          if (ct.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).length >= 2) break;
          card = card.parentElement; hops++;
        }
        var scopeText = (card && card.innerText) || a.innerText || '';
        var lines = scopeText.split('\n').map(function (x) { return clean(x); }).filter(Boolean);
        // Name = anchor's own text (first meaningful line), with any "View …’s profile" / degree stripped.
        var nameRaw = clean((a.innerText || '').split('\n')[0] || (lines[0] || ''));
        nameRaw = nameRaw.replace(/\bView\b.*$/i, '').replace(/•\s*\d+(st|nd|rd|th).*$/i, '').replace(/\s+\d+(st|nd|rd|th)\b.*$/i, '').trim();
        if (!nameRaw || nameRaw.length > 90 || noise.test(nameRaw)) continue;
        // The location sits on its own line in a result card and is the single most useful thing
        // for telling apart two people with the same name.
        var locLine = '';
        for (var li = 1; li < lines.length; li++) {
          var cand = lines[li];
          if (/^(•|\d(st|nd|rd|th))/i.test(cand) || noise.test(cand)) continue;
          if (/,\s*[A-Za-z]/.test(cand) && cand.length < 60 && !/\bat\b|\|/.test(cand)) { locLine = cand; break; }
        }
        var degMatch = scopeText.match(/\b(1st|2nd|3rd)\b/i);
        var degree = degMatch ? degMatch[1].toLowerCase() : '';
        // Headline = first line after the name that isn't the degree/location/noise.
        var headline = '';
        for (var j = 1; j < lines.length; j++) {
          var ln = lines[j];
          if (noise.test(ln) || /^\d+(st|nd|rd|th)\b/i.test(ln) || ln === nameRaw) continue;
          if (/^(1st|2nd|3rd)$/i.test(ln)) continue;
          headline = ln; break;
        }
        seen[key] = 1;
        out.push({ name: nameRaw, headline: headline, url: url, degree: degree, location: locLine });
      }
      return out;
    }).catch(function () { return []; });
    await hideBanner(fPage);
    writeState({ url: fFinal });
    process.stdout.write('PROFILE_JSON:' + JSON.stringify(results || []));
    return;
  }

  // ── humancheck <url> ────────────────────────────────────────────────────────
  // A search engine has shown a "confirm you're human" page. Rather than dead-ending the task,
  // put that page in front of the USER in the visible window, let THEM complete it, and carry on
  // the moment it clears.
  //
  // This deliberately does not try to get around the check — it does the opposite. The check
  // exists to confirm a human is present, so it asks the human who is already sitting there. All
  // this command adds is noticing when the page clears so the work resumes by itself instead of
  // failing and making the user start again.
  //
  // Capped well under the caller's per-command budget; the caller re-runs it if the user needs
  // longer, which keeps a single call from ever hanging the browser bridge.
  if (cmd === 'humancheck') {
    var hcUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    if (!hcUrl) { process.stdout.write('HUMANCHECK:NO_URL'); return; }
    var hcConn = await ensureChrome();
    var hcCtx = hcConn.context;
    if (!hcCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var hcPage = hcCtx.pages().at(-1) || await hcCtx.newPage();
    try { await hcPage.bringToFront(); } catch (_) {}
    try { await hcPage.goto(hcUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch (_) {}
    await showBanner(hcPage, 'The search engine wants to confirm you are human — please complete the check in this window. ADRIS continues on its own the moment it clears.');

    // Must match the app's looksBlockedPage, or a page can be declared "cleared" while the
    // challenge is still on screen. DuckDuckGo's duck puzzle in particular names none of the usual
    // words — no captcha, no robot, no unusual traffic.
    var blockedRe = /unusual traffic|verify[^.\n]{0,24}human|are you a human|i.?m not a robot|captcha|access denied|automated (queries|requests)|request could not be processed|bots use duckduckgo|complete the following challenge|search was made by a human|select all squares|before you continue to google|enable javascript and cookies to continue|our systems have detected/i;
    var hcStart = Date.now(), hcText = '', hcCleared = false;
    while (Date.now() - hcStart < 38000) {
      await new Promise(function (r) { setTimeout(r, 1500); });
      try {
        hcText = await hcPage.evaluate(function () { return (document.body && document.body.innerText) || ''; });
      } catch (_) { continue; }
      // Cleared = the challenge wording is gone AND there is real content to read.
      if (hcText && hcText.length > 200 && !blockedRe.test(hcText)) { hcCleared = true; break; }
    }
    await hideBanner(hcPage);
    writeState({ url: hcPage.url() });
    if (hcCleared) {
      process.stdout.write('HUMANCHECK:CLEARED\n' + hcText.slice(0, 6000));
    } else {
      // Still waiting — the caller decides whether to give the user another window of time.
      process.stdout.write('HUMANCHECK:PENDING');
    }
    return;
  }

  // ── sentinvites ─────────────────────────────────────────────────────────────
  // Read the connection requests the user has SENT that are still pending, from LinkedIn's own
  // invitation manager.
  //
  // Why this rather than visiting each prospect's profile: checking N people one at a time is N
  // page loads of a logged-in account hitting stranger profiles in a burst, which is exactly the
  // pattern LinkedIn's automation detection looks for. This is ONE page. Combined with the existing
  // `connections` scan it answers all three questions at once — accepted (now in connections),
  // still pending (listed here), or gone (in neither: withdrawn, declined, or expired). A profile's
  // degree badge alone cannot tell the last case apart from "never sent".
  if (cmd === 'sentinvites') {
    var siConn = await ensureChrome();
    var siCtx  = siConn.context;
    if (!siCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var siPage = siCtx.pages().at(-1) || await siCtx.newPage();
    try { await siPage.bringToFront(); } catch (_) {}
    try {
      await siPage.goto('https://www.linkedin.com/mynetwork/invitation-manager/sent/',
        { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (_) {}
    var siUrl = siPage.url();
    if (isAuthWall(siUrl)) {
      await showBanner(siPage, 'Sign in to LinkedIn in THIS window, then press Check again.');
      try { await siPage.bringToFront(); } catch (_) {}
      writeState({ url: siUrl });
      process.stdout.write('[SIGN_IN_REQUIRED] Opened LinkedIn in the ADRIS browser — please sign in there, then press Check again.');
      return;
    }
    await showBanner(siPage, 'ADRIS is checking which connection requests are still pending — please don’t close this window.');
    try { await siPage.waitForSelector('a[href*="/in/"]', { timeout: 9000 }); } catch (_) {}
    try { await waitForContentStability(siPage, 300, 1200); } catch (_) {}

    // The sent list paginates ("Show more"). Pull a few pages so a long-running campaign is fully
    // covered, but stop early — this must finish well inside the 45s the caller allows.
    var siStart = Date.now();
    for (var siPass = 0; siPass < 6; siPass++) {
      if (Date.now() - siStart > 20000) break;
      var more = await siPage.evaluate(function () {
        var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].innerText || '').trim().toLowerCase();
          if (t === 'show more' || t === 'load more' || t.indexOf('show more') === 0) { btns[i].click(); return true; }
        }
        return false;
      }).catch(function () { return false; });
      if (!more) break;
      try { await waitForContentStability(siPage, 300, 1500); } catch (_) {}
    }

    var invites = await siPage.evaluate(function () {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
      // The anchor's OWN innerText is empty on this page — the name lives a couple of levels up, in
      // the card. Verified against the live page: every invite renders as
      //     Praveen Savarapu / <headline> / Sent 1 week ago / Withdraw
      // Reading only the anchor made all 70 invites fall back to their URL slug, and a slug is not
      // a name: "Nicole D." has the slug "dangelo-nicole". A lead with no saved profile URL is
      // matched on name, so that mismatch would report a pending invite as expired — the exact
      // confusion this feature exists to remove.
      var noise = /^(withdraw|message|pending|sent |view |• |status is|people \(|pages \(|received$|sent$|manage invitations)/i;
      var scope = document.querySelector('main') || document.body;
      var out = [], seen = {};
      var anchors = scope.querySelectorAll('a[href*="/in/"]');
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = a.getAttribute('href') || '';
        if (href.indexOf('/in/') === -1) continue;
        var url = href.split('?')[0].replace(/\/$/, '');
        if (!/^https?:/i.test(url)) url = 'https://www.linkedin.com' + url;
        var key = url.toLowerCase();
        if (seen[key]) continue;

        // Walk up to the invite card — the nearest ancestor that carries the whole entry.
        var card = a, hops = 0;
        while (card && hops < 6) {
          var ct = card.innerText || '';
          if (/\bWithdraw\b/i.test(ct) && ct.split('\n').filter(function (x) { return x.trim(); }).length >= 2) break;
          card = card.parentElement; hops++;
        }
        var lines = ((card && card.innerText) || a.innerText || '')
          .split('\n').map(clean).filter(Boolean);
        var nameRaw = '';
        for (var j = 0; j < lines.length; j++) {
          var ln = lines[j].replace(/\bView\b.*$/i, '').replace(/•\s*\d+(st|nd|rd|th).*$/i, '').trim();
          if (!ln || ln.length > 90 || noise.test(ln)) continue;
          nameRaw = ln; break;
        }
        // "Sent 1 week ago" straight from LinkedIn beats asking the user to remember when they
        // sent it — and it is the only age we have for invites sent outside this app.
        var sentAgo = '';
        for (var k = 0; k < lines.length; k++) {
          var m = /^Sent\s+(.+ago)$/i.exec(lines[k]);
          if (m) { sentAgo = m[1]; break; }
        }
        if (!nameRaw) {
          // Last resort so a pending invite is never MISSED because its name was unreadable —
          // a missed pending invite gets wrongly reported as expired.
          var slug = (url.split('/in/')[1] || '').split('/')[0].replace(/-[0-9a-f]{6,}$/i, '');
          nameRaw = slug ? slug.replace(/-/g, ' ') : '';
          if (!nameRaw) continue;
        }
        seen[key] = 1;
        out.push({ name: nameRaw, url: url, sent: sentAgo });
      }
      return out;
    }).catch(function () { return []; });

    await hideBanner(siPage);
    writeState({ url: siUrl });
    process.stdout.write('SENTINV_JSON:' + JSON.stringify(invites || []));
    return;
  }

  // ── whatsapp <phone> ::: <text> ─────────────────────────────────────────────
  // Open WhatsApp Web's chat for a phone number with the message PRE-FILLED (WhatsApp's own
  // send?phone=&text= URL does the typing), so the user just reviews and presses send. Never
  // auto-sends. If the user isn't logged in, we show the QR page, keep the window open, WAIT for
  // them to scan it with their phone, then continue automatically. Phone must be full international
  // digits (e.g. 919876543210) — WhatsApp needs the country code, no + or spaces.
  if (cmd === 'whatsapp') {
    var wRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var wSplit = wRaw.indexOf(' ::: ');
    var wPhone = (wSplit >= 0 ? wRaw.slice(0, wSplit) : wRaw).replace(/[^\d]/g, '');
    var wText  = wSplit >= 0 ? wRaw.slice(wSplit + 5).trim() : '';
    if (!wPhone) { process.stdout.write('[whatsapp-error] No phone number given. Use the full number with country code, digits only (e.g. 919876543210).'); return; }
    var wConn = await ensureChrome();
    var wCtx  = wConn.context;
    if (!wCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var wPage = wCtx.pages().at(-1) || await wCtx.newPage();
    try { await wPage.bringToFront(); } catch (_) {}
    var wUrl = 'https://web.whatsapp.com/send?phone=' + encodeURIComponent(wPhone) + (wText ? '&text=' + encodeURIComponent(wText) : '');
    try { await wPage.goto(wUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}

    // Compose box = logged in + chat open. QR canvas = needs login. Poll for whichever appears.
    var composeSel = 'div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"], [data-testid="conversation-compose-box-input"]';
    var qrSel = 'canvas[aria-label*="Scan" i], [data-testid="qrcode"], div[data-ref]';
    async function wComposeReady() { try { return await wPage.$(composeSel); } catch (_) { return null; } }
    async function wQrShown() { try { return await wPage.$(qrSel); } catch (_) { return null; } }

    // First quick check (already logged in?)
    try { await wPage.waitForSelector(composeSel, { timeout: 9000 }); } catch (_) {}
    if (!(await wComposeReady())) {
      // Not in a chat yet — either QR login is needed, or the number is invalid.
      if (await wQrShown()) {
        await showBanner(wPage, 'Scan this QR with WhatsApp on your phone (Settings → Linked devices). I\'ll send the message in once you\'re logged in — don\'t close this window.');
        try { await wPage.bringToFront(); } catch (_) {}
        // Wait up to 2.5 min for login, then re-open the send URL so the chat + text load.
        var wDeadline = Date.now() + 150000;
        var wLoggedIn = false;
        while (Date.now() < wDeadline) {
          await new Promise(function (r) { setTimeout(r, 2500); });
          if (!(await wQrShown())) { wLoggedIn = true; break; }
        }
        if (!wLoggedIn) { writeState({ url: wPage.url() }); process.stdout.write('[SIGN_IN_REQUIRED] Scan the WhatsApp QR in the ADRIS browser to log in, then try again.'); return; }
        await hideBanner(wPage);
        try { await wPage.goto(wUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
        try { await wPage.waitForSelector(composeSel, { timeout: 15000 }); } catch (_) {}
      }
    }
    // Invalid-number dialog?
    try {
      var badNum = await wPage.evaluate(function () { return /phone number.*(shared|invalid)|invalid.*phone|isn.?t on whatsapp/i.test(document.body.innerText || ''); }).catch(function () { return false; });
      if (badNum && !(await wComposeReady())) { writeState({ url: wPage.url() }); process.stdout.write('[whatsapp-badnumber] WhatsApp says that number isn\'t on WhatsApp (or the format is wrong). Use the full country code, digits only.'); return; }
    } catch (_) {}

    var wBox = await wComposeReady();
    writeState({ url: wPage.url() });
    if (!wBox) { process.stdout.write('PROFILE_OPENED_NO_BOX WhatsApp opened but the chat box didn\'t load. Nothing was sent.'); return; }
    // The URL pre-fills the text; make sure the caret is in the box so the user can just press Enter.
    try { await wBox.click({ timeout: 3000 }); } catch (_) {}
    await showBanner(wPage, 'Your message is typed into WhatsApp — review it and press Enter/Send yourself. ADRIS never sends for you.');
    process.stdout.write('MESSAGE_DRAFTED — the message is in the WhatsApp chat box, unsent. Tell the user to review it and press Enter/Send.');
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
    var opened = await openLinkedInComposeBox(mPage);
    if (opened.box) {
      // The whole point of this command is that the user presses Ctrl+V next — so the caret MUST be
      // inside the box. A click alone was leaving activeElement on <body> (verified live), which
      // would have pasted into nothing. Click, then force focus + place the caret as a backstop.
      try { await opened.box.click({ timeout: 2500 }); } catch (_) {}
      try {
        await mPage.evaluate(function () {
          var el = document.querySelector('.msg-form__contenteditable') || document.querySelector('[contenteditable="true"][role="textbox"]');
          if (!el) return;
          el.focus();
          try {
            var r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
            var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          } catch (_) {}
        });
      } catch (_) {}
    }
    writeState({ url: mPage.url() });
    process.stdout.write(opened.box ? 'MESSAGE_BOX_OPENED' : 'PROFILE_OPENED ' + opened.why);
    return;
  }

  // ── typemsg <url> ::: <text> ────────────────────────────────────────────────
  // Same as `message` (open profile → click "Message"), then TYPE the drafted reply into the
  // compose box using real per-character keystrokes (pressSequentially — a scripted .fill() on a
  // contenteditable div doesn't fire the input events LinkedIn's React state listens for, same
  // reason the click above must be a trusted Playwright click and not a synthetic one). It never
  // sends — the user reviews the pre-filled box and presses Enter/Send themselves.
  if (cmd === 'typemsg') {
    var tRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var tSplitIdx = tRaw.indexOf(' ::: ');
    var tUrlRaw = tSplitIdx >= 0 ? tRaw.slice(0, tSplitIdx).trim() : tRaw;
    var tText   = tSplitIdx >= 0 ? tRaw.slice(tSplitIdx + 5).trim() : '';
    var tUrl = tUrlRaw.startsWith('http') ? tUrlRaw : 'https://' + tUrlRaw;
    if (!tText) { process.stdout.write('[typemsg-error] No message text was given to type.'); return; }
    var tConn = await ensureChrome();
    var tCtx  = tConn.context;
    if (!tCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var tPage = tCtx.pages().at(-1) || await tCtx.newPage();
    try { await tPage.goto(tUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    var tFinal = tPage.url();
    if (isAuthWall(tFinal)) {
      var tok = await pollForLoginCompletion(tPage, 30000);
      if (!tok) { writeState({ url: tFinal }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to LinkedIn in the ADRIS browser window that just opened, then try again.'); return; }
    }
    // DEAD PROFILE URL. A stale or wrong link lands on LinkedIn's "This page doesn't exist", and we
    // used to carry on regardless — hunting for a compose box that cannot be there, then reporting
    // some vague failure. Say plainly that the link is dead so the caller can retry with the URL it
    // has saved for this person instead.
    var tMissing = await tPage.evaluate(function () {
      var t = (document.body && document.body.innerText) || '';
      return /this page doesn.{0,3}t exist|page not found|check your URL/i.test(t);
    }).catch(function () { return false; });
    if (tMissing) {
      writeState({ url: tFinal });
      process.stdout.write('[typemsg-error] PROFILE_NOT_FOUND — LinkedIn says that profile page does not exist (' + tFinal + '). The saved link for this person is stale.');
      return;
    }
    await showBanner(tPage, 'ADRIS drafted a reply here — review it, then press Enter/Send yourself.');
    try { await tPage.waitForLoadState('networkidle', { timeout: 4000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1200); });
    // Shared with `message` — see openLinkedInComposeBox for why clicking the Message button alone
    // is not enough on the current LinkedIn layout, and why the box must be the real editable.
    var tOpened = await openLinkedInComposeBox(tPage);
    var tInputBox = tOpened.box;
    writeState({ url: tPage.url() });
    if (!tInputBox) { process.stdout.write('PROFILE_OPENED_NO_BOX ' + tOpened.why + ' The draft was NOT typed anywhere — nothing was sent.'); return; }
    var tTyped = false;
    try {
      await tInputBox.click({ timeout: 3000 });
      await tInputBox.pressSequentially(tText, { delay: 12, timeout: 30000 });
      var landedText = await tInputBox.innerText().catch(function () { return ''; });
      tTyped = landedText.trim().length > 0;
    } catch (_) {}
    if (!tTyped) { process.stdout.write('PROFILE_OPENED_NO_BOX The compose box opened but typing into it failed. The draft was NOT sent — tell the user to paste it manually.'); return; }
    process.stdout.write('MESSAGE_DRAFTED — the reply is now sitting in the open chat box, unsent. Tell the user to review it and press Enter (or click Send) themselves.');
    return;
  }

  // ── sendmsg <url> ::: <text> ────────────────────────────────────────────────
  // typemsg, and then actually press Send.
  //
  // This is the one command in the file that does something irreversible, so it is the one that
  // has to be hardest to get wrong. Three rules:
  //
  //   1. TYPE IT THE SAME WAY typemsg DOES. Real per-character keystrokes into the real editable.
  //      A .fill() on a contenteditable does not fire the input events LinkedIn's React state
  //      listens to, so Send stays disabled and a "sent" message was never in the box at all.
  //
  //   2. CONFIRM THE TEXT IS IN THE BOX BEFORE PRESSING SEND. If typing half-landed, sending
  //      transmits half a message to a real person and there is no unsend.
  //
  //   3. CONFIRM IT LEFT. The box going empty is necessary but not sufficient — a failed send can
  //      also clear it — so the message must be found in the thread afterwards. Anything less and
  //      the caller marks somebody "sent" who never heard from you, which is worse than a failure:
  //      a failure gets retried, a false success never does.
  if (cmd === 'sendmsg') {
    var sRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var sSplit = sRaw.indexOf(' ::: ');
    var sUrlRaw = sSplit >= 0 ? sRaw.slice(0, sSplit).trim() : sRaw;
    var sText = sSplit >= 0 ? sRaw.slice(sSplit + 5).trim() : '';
    var sUrl = sUrlRaw.indexOf('http') === 0 ? sUrlRaw : 'https://' + sUrlRaw;
    if (!sText) { process.stdout.write('[sendmsg-error] NO_TEXT — no message was given, so nothing was sent.'); return; }
    var sConn = await ensureChrome();
    var sCtx = sConn.context;
    if (!sCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var sPage = sCtx.pages().at(-1) || await sCtx.newPage();
    try { await sPage.goto(sUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    if (isAuthWall(sPage.url())) {
      var sTok = await pollForLoginCompletion(sPage, 30000);
      if (!sTok) { writeState({ url: sPage.url() }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to LinkedIn in the ADRIS browser window, then run this again.'); return; }
    }
    var sMissing = await sPage.evaluate(function () {
      var t = (document.body && document.body.innerText) || '';
      return /this page doesn.{0,3}t exist|page not found|check your URL/i.test(t);
    }).catch(function () { return false; });
    if (sMissing) {
      writeState({ url: sPage.url() });
      process.stdout.write('[sendmsg-error] PROFILE_NOT_FOUND — LinkedIn says that profile does not exist (' + sPage.url() + '). Nothing was sent.');
      return;
    }
    await showBanner(sPage, 'ADRIS is sending a message you approved. Do not close this window.');
    try { await sPage.waitForLoadState('networkidle', { timeout: 4000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1200); });
    var sOpened = await openLinkedInComposeBox(sPage);
    var sBox = sOpened.box;
    writeState({ url: sPage.url() });
    if (!sBox) { process.stdout.write('SEND_FAILED NO_BOX ' + sOpened.why + ' Nothing was typed and nothing was sent.'); return; }
    // Rule 1 + 2: type it, then read it back out of the box.
    var sLanded = '';
    try {
      await sBox.click({ timeout: 3000 });
      await sBox.pressSequentially(sText, { delay: 12, timeout: 30000 });
      sLanded = (await sBox.innerText().catch(function () { return ''; })) || '';
    } catch (_) {}
    var normalise = function (t) { return String(t || '').replace(/\s+/g, ' ').trim(); };
    var wantN = normalise(sText);
    var gotN = normalise(sLanded);
    if (!gotN) { process.stdout.write('SEND_FAILED TYPING_FAILED The compose box opened but nothing could be typed into it. Nothing was sent.'); return; }
    // A short message must match outright; a long one is allowed to differ at the tail only if the
    // overwhelming majority landed (LinkedIn trims trailing whitespace and can lazily re-render).
    if (gotN !== wantN && gotN.length < Math.floor(wantN.length * 0.9)) {
      process.stdout.write('SEND_FAILED PARTIAL_TEXT Only ' + gotN.length + ' of ' + wantN.length
        + ' characters reached the box, so NOTHING was sent — a half-written message to a real person cannot be taken back. The draft is sitting in the box for the user to finish by hand.');
      return;
    }
    // Press Send. The button first (it is the one LinkedIn itself wires up), Ctrl+Enter after —
    // plain Enter is deliberately NOT used: on some layouts it inserts a newline instead, and on
    // others it sends, so it cannot be told afterwards which one happened.
    var sPressed = false;
    try {
      var sBtn = sPage.locator('button.msg-form__send-button, button[type="submit"].msg-form__send-btn, form.msg-form button:has-text("Send")').first();
      if (await sBtn.count() > 0 && await sBtn.isEnabled({ timeout: 2000 }).catch(function () { return false; })) {
        await sBtn.click({ timeout: 5000 });
        sPressed = true;
      }
    } catch (_) {}
    if (!sPressed) {
      try { await sPage.getByRole('button', { name: /^Send$/ }).first().click({ timeout: 4000 }); sPressed = true; } catch (_) {}
    }
    if (!sPressed) {
      try { await sBox.press('Control+Enter'); sPressed = true; } catch (_) {}
    }
    if (!sPressed) {
      process.stdout.write('SEND_FAILED NO_SEND_BUTTON The message is typed into the chat box but the Send button could not be found or was disabled. Nothing was sent — the user can press Send themselves in the open window.');
      return;
    }
    await new Promise(function (r) { setTimeout(r, 2200); });
    // Rule 3: it is only sent if it is now IN THE THREAD. Checking the box emptied is not enough.
    var sVerdict = await sPage.evaluate(function (payload) {
      function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
      var want = norm(payload.want);
      var box = document.querySelector('.msg-form__contenteditable, [contenteditable="true"][role="textbox"]');
      var boxText = box ? norm(box.innerText) : '';
      // The sent bubbles in the open conversation.
      var bubbles = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-event__content, li.msg-s-message-list__event');
      var found = false;
      // Compare on a healthy chunk of the message, not the whole of it: LinkedIn re-flows
      // whitespace and can truncate very long bubbles behind a "see more".
      var probe = want.slice(0, Math.min(60, want.length));
      for (var i = 0; i < bubbles.length; i++) {
        if (norm(bubbles[i].innerText).indexOf(probe) >= 0) { found = true; break; }
      }
      return { boxEmpty: boxText.length === 0, inThread: found, bubbles: bubbles.length };
    }, { want: sText }).catch(function () { return null; });
    await hideBanner(sPage).catch(function () {});
    writeState({ url: sPage.url() });
    if (sVerdict && sVerdict.inThread) {
      process.stdout.write('MESSAGE_SENT — confirmed in the conversation thread.');
      return;
    }
    if (sVerdict && sVerdict.boxEmpty) {
      // Box cleared but we could not find the bubble. Probably sent; say so in those words and let
      // the caller decide, rather than recording a certainty nobody checked.
      process.stdout.write('SEND_UNCONFIRMED The compose box cleared, which usually means it went, but the message could not be found in the thread to prove it. Do NOT record this as sent without the user checking the conversation.');
      return;
    }
    process.stdout.write('SEND_FAILED NOT_IN_THREAD The Send button was pressed but the message is still in the box and not in the conversation. Nothing appears to have gone.');
    return;
  }

  // ── webmail <url> ::: <to> ::: <subject> ::: <body> ─────────────────────────
  // Open ANY webmail, find its compose window, and type the email into it.
  //
  // Gmail has a compose deeplink and a DOM we know; nothing else does. Everyone on a Titan,
  // Hostinger, Zoho, Rediff or cPanel mailbox got "your webmail is open, here is your draft on the
  // clipboard, paste it yourself" — which is barely better than nothing, and worse when the copy
  // silently fails.
  //
  // A compose form is a compose form, though. Every one of them has a recipient box, a subject box
  // and a body, and they are all findable without knowing the product: by field name, by label, by
  // placeholder, by role. So this hunts for them generically instead of hard-coding a provider —
  // and where a rich-text editor lives inside an iframe (Roundcube's TinyMCE does exactly this),
  // it looks inside the frames too.
  //
  // It never presses Send. The user reads what landed and sends it themselves — and because we
  // cannot be certain a strange webmail took the text, the reply says exactly which boxes were
  // filled and which were not, rather than claiming a draft that may not be there.
  if (cmd === 'webmail') {
    var wRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var wParts = wRaw.split(' ::: ');
    var wUrl = (wParts[0] || '').trim();
    var wTo = (wParts[1] || '').trim();
    var wSubj = (wParts[2] || '').trim();
    var wBody = wParts.slice(3).join(' ::: ').trim();
    if (!wUrl) { process.stdout.write('[webmail-error] NO_URL — no webmail address was given.'); return; }
    if (wUrl.indexOf('http') !== 0) wUrl = 'https://' + wUrl;
    var wConn = await ensureChrome();
    var wCtx = wConn.context;
    if (!wCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var wPage = wCtx.pages().at(-1) || await wCtx.newPage();
    try { await wPage.bringToFront(); } catch (_) {}
    try { await wPage.goto(wUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1800); });
    writeState({ url: wPage.url() });

    // Signed out? Say so plainly — this is the single most common reason nothing appears, and it
    // is not something we can fix for them.
    var wLoggedOut = await wPage.evaluate(function () {
      var t = ((document.body && document.body.innerText) || '').toLowerCase();
      var hasPw = !!document.querySelector('input[type="password"]');
      return hasPw && /sign in|log in|login|password/.test(t);
    }).catch(function () { return false; });
    if (wLoggedOut) {
      process.stdout.write('WEBMAIL_NEEDS_LOGIN Your webmail is open but asking you to sign in. Sign in here in the ADRIS browser — it stays signed in afterwards — then try again.');
      return;
    }

    await showBanner(wPage, 'ADRIS is writing your email here. Check it, then press Send yourself.');

    // ── Find and open the compose window ────────────────────────────────────
    // Already on one? Some webmail links land straight in a composer.
    var composeOpen = async function () {
      return await wPage.evaluate(function () {
        function vis(el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 40 && r.height > 10; }
        var sels = ['input[name*="subject" i]', 'input[id*="subject" i]', '[aria-label*="subject" i]', '[placeholder*="subject" i]'];
        for (var i = 0; i < sels.length; i++) { var e = document.querySelector(sels[i]); if (vis(e)) return true; }
        return false;
      }).catch(function () { return false; });
    };

    var opened = await composeOpen();
    if (!opened) {
      // Click whatever this webmail calls "new message". Text first (most reliable across
      // products), then the conventional attributes, then Roundcube's own compose URL.
      var labels = /^(compose|new message|new mail|new e-?mail|write|new)$/i;
      var clicked = false;
      try {
        var byRole = wPage.getByRole('button', { name: labels }).first();
        if (await byRole.count() > 0) { await byRole.click({ timeout: 4000 }); clicked = true; }
      } catch (_) {}
      if (!clicked) {
        try {
          var byLink = wPage.getByRole('link', { name: labels }).first();
          if (await byLink.count() > 0) { await byLink.click({ timeout: 4000 }); clicked = true; }
        } catch (_) {}
      }
      if (!clicked) {
        try {
          var byAttr = wPage.locator('[aria-label*="ompose" i], [title*="ompose" i], [data-testid*="ompose" i], a[href*="_action=compose"], a[href*="compose"]').first();
          if (await byAttr.count() > 0) { await byAttr.click({ timeout: 4000 }); clicked = true; }
        } catch (_) {}
      }
      if (!clicked) {
        // Roundcube (most cPanel/shared hosting webmail) always answers this URL.
        try {
          var base = wPage.url().split('?')[0];
          await wPage.goto(base + '?_task=mail&_action=compose', { waitUntil: 'domcontentloaded', timeout: 15000 });
          clicked = true;
        } catch (_) {}
      }
      await new Promise(function (r) { setTimeout(r, 2200); });
      opened = await composeOpen();
    }

    // ── Fill it in ──────────────────────────────────────────────────────────
    // Tried across the main frame AND any iframes, because rich-text editors (Roundcube's TinyMCE,
    // several others) put the message body inside one.
    var frames = [wPage].concat(wPage.frames ? wPage.frames() : []);
    var filled = { to: false, subject: false, body: false };

    var typeInto = async function (frame, selectors, value, isBody) {
      if (!value) return false;
      for (var i = 0; i < selectors.length; i++) {
        try {
          var loc = frame.locator(selectors[i]).first();
          if (await loc.count() === 0) continue;
          if (!await loc.isVisible().catch(function () { return false; })) continue;
          await loc.click({ timeout: 2500 });
          // Real keystrokes. A scripted value assignment does not fire the events these editors
          // listen to, so the text looks present and vanishes the moment anything re-renders.
          await loc.pressSequentially(value, { delay: isBody ? 4 : 12, timeout: 25000 });
          var landed = '';
          try { landed = await loc.inputValue(); } catch (_) { try { landed = await loc.innerText(); } catch (_) {} }
          if ((landed || '').replace(/\s+/g, ' ').trim().length > 0) return true;
        } catch (_) { /* try the next selector */ }
      }
      return false;
    };

    for (var fi = 0; fi < frames.length && !(filled.to && filled.subject && filled.body); fi++) {
      var fr = frames[fi];
      if (!filled.to) {
        filled.to = await typeInto(fr, [
          'input[name="_to"]', 'textarea[name="_to"]',              // Roundcube
          'input[name*="to" i]:not([name*="auto" i])', 'textarea[name*="to" i]',
          'input[id*="to" i]:not([id*="auto" i])',
          '[aria-label="To"]', '[aria-label*="to recipients" i]', '[aria-label^="To" i]',
          '[placeholder^="To" i]', 'input[type="email"]',
        ], wTo, false);
      }
      if (!filled.subject) {
        filled.subject = await typeInto(fr, [
          'input[name="_subject"]',                                  // Roundcube
          'input[name*="subject" i]', 'input[id*="subject" i]',
          '[aria-label*="subject" i]', '[placeholder*="subject" i]',
        ], wSubj, false);
      }
      if (!filled.body) {
        filled.body = await typeInto(fr, [
          'body[id*="tinymce" i]', 'body.mce-content-body',          // TinyMCE inside an iframe
          'textarea[name="_message"]',                               // Roundcube plain-text mode
          'div[role="textbox"]', '[contenteditable="true"]',
          'textarea[name*="body" i]', 'textarea[name*="message" i]',
          '[aria-label*="message body" i]', '[aria-label*="body" i]',
        ], wBody, true);
      }
    }

    writeState({ url: wPage.url() });

    if (filled.to && filled.subject && filled.body) {
      process.stdout.write('WEBMAIL_DRAFTED — the email is written into your webmail, unsent. Check it and press Send yourself.');
      return;
    }
    if (filled.body || filled.to) {
      // PARTIAL. Say exactly what is missing rather than implying the draft is ready — the whole
      // point of this command is that the user should not have to discover a half-written email
      // after pressing Send.
      var missing = [];
      if (!filled.to) missing.push('the recipient');
      if (!filled.subject) missing.push('the subject');
      if (!filled.body) missing.push('the message');
      process.stdout.write('WEBMAIL_PARTIAL The compose window is open but I could not fill in ' + missing.join(' and ')
        + '. Everything is on your clipboard — finish it by hand before sending.');
      return;
    }
    await hideBanner(wPage).catch(function () {});
    process.stdout.write('WEBMAIL_NO_COMPOSE Your webmail is open but I could not find a compose window I understand, so nothing was typed. The draft is on your clipboard — press Compose and paste it.');
    return;
  }

  // ── sendmail <to> ::: <subject> ::: <body> ──────────────────────────────────
  // Gmail: open a compose window with the message in it, check the fields really carry what we
  // meant, press Send, and confirm Gmail said it went.
  //
  // Same discipline as sendmsg, and one extra check that matters here: the compose deeplink is a
  // URL, and a URL can silently drop or mangle a field. Sending a message whose body arrived empty
  // — or whose recipient did not — is the failure this verification exists to prevent.
  if (cmd === 'sendmail') {
    var mRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    var mParts = mRaw.split(' ::: ');
    var mTo = (mParts[0] || '').trim();
    var mSubj = (mParts[1] || '').trim();
    var mBody = mParts.slice(2).join(' ::: ').trim();
    if (!mTo || mTo.indexOf('@') < 0) { process.stdout.write('[sendmail-error] NO_RECIPIENT — "' + mTo.slice(0, 60) + '" is not an email address. Nothing was sent.'); return; }
    if (!mBody) { process.stdout.write('[sendmail-error] NO_BODY — no message body was given, so nothing was sent.'); return; }
    var mConn = await ensureChrome();
    var mCtx = mConn.context;
    if (!mCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var mPage = mCtx.pages().at(-1) || await mCtx.newPage();
    var mUrl = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(mTo)
      + '&su=' + encodeURIComponent(mSubj) + '&body=' + encodeURIComponent(mBody);
    try { await mPage.goto(mUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    if (isAuthWall(mPage.url()) || /accounts\.google\.com/i.test(mPage.url())) {
      var mTok = await pollForLoginCompletion(mPage, 30000);
      if (!mTok) { writeState({ url: mPage.url() }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to Gmail in the ADRIS browser window, then run this again.'); return; }
    }
    await showBanner(mPage, 'ADRIS is sending an email you approved. Do not close this window.');
    try { await mPage.waitForSelector('textarea[name="to"], input[name="to"], div[role="textbox"][aria-label*="Message Body"], div[aria-label="Message Body"]', { timeout: 12000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1200); });
    // Did the deeplink really fill the compose window in?
    var mCheck = await mPage.evaluate(function (payload) {
      function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }
      function val(el) { if (!el) return ''; return norm(el.value !== undefined && el.value !== null && el.value !== '' ? el.value : el.innerText); }
      var toEl = document.querySelector('textarea[name="to"], input[name="to"]');
      // Gmail also renders confirmed recipients as chips rather than raw text in the field.
      var chips = document.querySelectorAll('div[email], span[email]');
      var chipMails = [];
      for (var c = 0; c < chips.length; c++) { chipMails.push(String(chips[c].getAttribute('email') || '').toLowerCase()); }
      var subjEl = document.querySelector('input[name="subjectbox"]');
      var bodyEl = document.querySelector('div[role="textbox"][aria-label*="Message Body"], div[aria-label="Message Body"], div[g_editable="true"]');
      return {
        to: val(toEl).toLowerCase(),
        chips: chipMails,
        subject: val(subjEl),
        body: bodyEl ? norm(bodyEl.innerText) : '',
        hasCompose: !!bodyEl,
      };
    }, {}).catch(function () { return null; });
    if (!mCheck || !mCheck.hasCompose) {
      await hideBanner(mPage).catch(function () {});
      writeState({ url: mPage.url() });
      process.stdout.write('SEND_FAILED NO_COMPOSE Gmail did not open a compose window, so nothing was written and nothing was sent.');
      return;
    }
    var mToOk = mCheck.to.indexOf(mTo.toLowerCase()) >= 0 || mCheck.chips.indexOf(mTo.toLowerCase()) >= 0;
    if (!mToOk) {
      await hideBanner(mPage).catch(function () {});
      process.stdout.write('SEND_FAILED WRONG_RECIPIENT The compose window is addressed to "' + String(mCheck.to).slice(0, 80)
        + '" rather than ' + mTo + '. Nothing was sent — sending to the wrong person cannot be undone.');
      return;
    }
    var mBodyN = String(mBody).replace(/\s+/g, ' ').trim();
    var mGotN = String(mCheck.body || '').replace(/\s+/g, ' ').trim();
    if (mGotN.length < Math.floor(mBodyN.length * 0.9)) {
      await hideBanner(mPage).catch(function () {});
      process.stdout.write('SEND_FAILED BODY_INCOMPLETE Only ' + mGotN.length + ' of ' + mBodyN.length
        + ' characters of the message reached the compose window, so nothing was sent. The window is open for the user to finish by hand.');
      return;
    }
    // Send. Gmail's own button first; Ctrl+Enter is the documented shortcut and the fallback.
    var mPressed = false;
    try {
      var mBtn = mPage.locator('div[role="button"][data-tooltip^="Send"], div[role="button"][aria-label^="Send"], div.T-I.J-J5-Ji.aoO').first();
      if (await mBtn.count() > 0) { await mBtn.click({ timeout: 5000 }); mPressed = true; }
    } catch (_) {}
    if (!mPressed) { try { await mPage.keyboard.press('Control+Enter'); mPressed = true; } catch (_) {} }
    if (!mPressed) {
      await hideBanner(mPage).catch(function () {});
      process.stdout.write('SEND_FAILED NO_SEND_BUTTON The email is written in the compose window but Gmail\'s Send button could not be found. Nothing was sent.');
      return;
    }
    await new Promise(function (r) { setTimeout(r, 2500); });
    // Gmail confirms with a "Message sent" toast and closes the compose window. Require one of them.
    var mVerdict = await mPage.evaluate(function () {
      var t = (document.body && document.body.innerText) || '';
      var toast = /message sent|your message has been sent/i.test(t);
      var stillOpen = !!document.querySelector('div[role="textbox"][aria-label*="Message Body"], div[aria-label="Message Body"]');
      return { toast: toast, stillOpen: stillOpen };
    }).catch(function () { return null; });
    await hideBanner(mPage).catch(function () {});
    writeState({ url: mPage.url() });
    if (mVerdict && mVerdict.toast) { process.stdout.write('EMAIL_SENT — Gmail confirmed "Message sent" to ' + mTo + '.'); return; }
    if (mVerdict && !mVerdict.stillOpen) {
      process.stdout.write('SEND_UNCONFIRMED The compose window closed, which usually means it went, but Gmail\'s "Message sent" confirmation was not seen. Do NOT record this as sent without the user checking their Sent folder.');
      return;
    }
    process.stdout.write('SEND_FAILED STILL_OPEN Send was pressed but the compose window is still open, so the email does not appear to have gone.');
    return;
  }

  // ── gmailthread <email> ──────────────────────────────────────────────────────
  // Read the most recent email conversation with one person, so the outreach copilot can plan a
  // reply to an EMAIL the same way it already does for a LinkedIn message. Everything downstream
  // (the strategist, the verifier, the draft box) works on plain thread text and never cared
  // which channel it came from — this is the piece that was missing.
  //
  // Uses Gmail's own search rather than scrolling the inbox: `from:x OR to:x` finds the thread
  // wherever it is, including archived, and puts the newest first.
  if (cmd === 'gmailthread') {
    var gmAddr = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    if (!gmAddr) { process.stdout.write('GMAIL_NO_ADDRESS'); return; }
    var gmConn = await ensureChrome();
    var gmCtx = gmConn.context;
    if (!gmCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var gmPage = gmCtx.pages().at(-1) || await gmCtx.newPage();
    try { await gmPage.bringToFront(); } catch (_) {}
    var gmQuery = encodeURIComponent('from:' + gmAddr + ' OR to:' + gmAddr);
    try { await gmPage.goto('https://mail.google.com/mail/u/0/#search/' + gmQuery, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    if (isAuthWall(gmPage.url())) {
      var gmTok = await pollForLoginCompletion(gmPage, 30000);
      if (!gmTok) { writeState({ url: gmPage.url() }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to Gmail in the ADRIS browser window that just opened, then try again.'); return; }
    }
    await showBanner(gmPage, 'ADRIS is reading this email conversation to plan your reply — please don’t close this window.');
    // The result rows are a table of <tr>; wait for one rather than a fixed sleep.
    try { await gmPage.waitForSelector('tr.zA, div.Cp, .ae4', { timeout: 9000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 900); });
    // Open the newest matching conversation.
    var gmOpened = await gmPage.evaluate(function () {
      var row = document.querySelector('tr.zA');
      if (!row) return false;
      row.click();
      return true;
    }).catch(function () { return false; });
    if (!gmOpened) {
      await hideBanner(gmPage);
      writeState({ url: gmPage.url() });
      process.stdout.write('GMAIL_NO_THREAD No email conversation with ' + gmAddr + ' was found.');
      return;
    }
    try { await gmPage.waitForSelector('div.a3s, div.ii', { timeout: 9000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 700); });
    // Expand a collapsed "show trimmed content" / stacked-message view so older replies are read
    // too — a thread read down to only its newest message loses the context the reply needs.
    await gmPage.evaluate(function () {
      var more = document.querySelectorAll('span.ajT, div.adx, .iX .ajR');
      for (var i = 0; i < more.length && i < 6; i++) { try { more[i].click(); } catch (e) {} }
    }).catch(function () {});
    await new Promise(function (r) { setTimeout(r, 600); });
    var gmThread = await gmPage.evaluate(function (addr) {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
      var out = [];
      // Each message in an opened conversation is a .adn/.gs block with a sender span and a body.
      var blocks = document.querySelectorAll('div.adn, div.gs');
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var bodyEl = b.querySelector('div.a3s, div.ii');
        if (!bodyEl) continue;
        var text = clean(bodyEl.innerText || '');
        if (!text) continue;
        // Drop the quoted history Gmail folds into each reply, or every message repeats the last.
        text = text.split(/\nOn .{10,80} wrote:\n/)[0];
        text = text.replace(/\n>.*/g, '').trim();
        if (!text) continue;
        var fromEl = b.querySelector('span.gD, span[email]');
        var from = fromEl ? (fromEl.getAttribute('email') || clean(fromEl.innerText)) : '';
        // isYou: anything NOT from the person we searched for is the account owner's own message.
        var isOther = from && addr && from.toLowerCase().indexOf(addr.toLowerCase()) !== -1;
        out.push({ from: from || (isOther ? addr : 'You'), isYou: !isOther, text: text.slice(0, 2000) });
      }
      var subjEl = document.querySelector('h2.hP');
      return { subject: subjEl ? clean(subjEl.innerText) : '', messages: out.slice(-12) };
    }, gmAddr).catch(function () { return { subject: '', messages: [] }; });
    await hideBanner(gmPage);
    writeState({ url: gmPage.url() });
    if (!gmThread.messages || !gmThread.messages.length) {
      process.stdout.write('GMAIL_EMPTY Opened the conversation but could not read any messages yet.');
      return;
    }
    process.stdout.write('GMAIL_JSON:' + JSON.stringify(gmThread));
    return;
  }
  // ── readthread <profileUrl> ──────────────────────────────────────────────────
  // Read ONE person's conversation, by opening their chat directly from their profile — instead of
  // scanning the whole inbox. This is what the outreach copilot uses to "scan a reply": it targets
  // exactly the person the user is on, so it's faster and never reads unrelated threads.
  if (cmd === 'readthread') {
    var rtUrlRaw = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
    if (!rtUrlRaw) { process.stdout.write('[readthread-error] No profile URL given.'); return; }
    var rtUrl = rtUrlRaw.startsWith('http') ? rtUrlRaw : 'https://' + rtUrlRaw;
    var rtConn = await ensureChrome();
    var rtCtx  = rtConn.context;
    if (!rtCtx) { process.stdout.write('[browser-crash] Chrome could not start. Make sure Google Chrome is installed.'); return; }
    var rtPage = rtCtx.pages().at(-1) || await rtCtx.newPage();
    try { await rtPage.goto(rtUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }); } catch (_) {}
    var rtFinal = rtPage.url();
    if (isHumanCheck(rtFinal)) {
      await showBanner(rtPage, 'LinkedIn needs you to confirm this sign-in. Check THIS window — it may be waiting for you to tap Yes in the LinkedIn app on your phone. Then press the button in ADRIS again; nothing is lost.');
      try { await rtPage.bringToFront(); } catch (_) {}
      writeState({ url: rtFinal });
      process.stdout.write('[HUMAN_CHECK_REQUIRED] LinkedIn is showing a sign-in confirmation at ' + rtFinal + '. It may be waiting for the user to tap Yes in the LinkedIn app on their phone. Complete it in the ADRIS browser window, then try again.');
      return;
    }
    if (isAuthWall(rtFinal)) {
      var rtTok = await pollForLoginCompletion(rtPage, 30000);
      if (!rtTok) { writeState({ url: rtFinal }); process.stdout.write('[SIGN_IN_REQUIRED] Please sign in to LinkedIn in the ADRIS browser window that just opened, then try again.'); return; }
    }
    await showBanner(rtPage, 'ADRIS is reading this conversation to plan your reply — please don’t close this window.');
    try { await rtPage.waitForLoadState('networkidle', { timeout: 4000 }); } catch (_) {}
    await new Promise(function (r) { setTimeout(r, 1000); });
    // Open the chat overlay (same helper typemsg uses) — this loads the message history for THIS
    // person into the DOM without touching the rest of the inbox.
    var rtOpened = await openLinkedInComposeBox(rtPage);
    writeState({ url: rtPage.url() });
    if (!rtOpened.box) { await hideBanner(rtPage); process.stdout.write('READTHREAD_NO_BOX ' + (rtOpened.why || '') + ' Could not open their chat to read it.'); return; }
    // Wait for message BODIES, not just the list container. The container renders first and empty,
    // so a 6s wait on it plus a flat 500ms was regularly satisfied before a single message existed —
    // the read then came back empty on a thread that was really there, and the user was told to
    // paste it in by hand. Poll for actual message text instead, and give it room on a cold window.
    try { await rtPage.waitForSelector('.msg-s-event-listitem__body', { timeout: 12000 }); } catch (_) {}
    // Let the history settle: LinkedIn backfills older messages after the first paint, so reading
    // the instant the first node appears can catch only the newest one.
    var rtSeen = -1;
    for (var rtW = 0; rtW < 8; rtW++) {
      var rtNow = await rtPage.evaluate(function () {
        return document.querySelectorAll('.msg-s-event-listitem__body').length;
      }).catch(function () { return 0; });
      if (rtNow > 0 && rtNow === rtSeen) break;   // stable for one round → done growing
      rtSeen = rtNow;
      await new Promise(function (r) { setTimeout(r, 400); });
    }
    // Same who-said-what extraction as the inbox reader: LinkedIn marks the OTHER person's messages
    // with `msg-s-event-listitem--other`; its absence means the account owner sent it. This is on
    // every message so the sender never drifts.
    var rtConvo = await rtPage.evaluate(function() {
      function clean(s) { return (s || '').replace(/[ \t]+/g, ' ').trim(); }
      // Files sent in a LinkedIn message live OUTSIDE `__body` (their own attachment node), so a
      // body-only read reported the thread as text alone. The follow-up writer then believed nothing
      // had been sent and drafted "I realised I hadn't sent the deck yet — attached it here" on a
      // thread where the PDF had already been delivered and read. Capture attachments per message.
      var FILE_RE = /[\w][\w .,()\[\]&+-]{0,80}\.(pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|gif|mp4|mov)\b/gi;
      function attachmentsIn(item) {
        if (!item) return [];
        var names = {};
        var nodes = item.querySelectorAll('[class*="attachment"], [class*="file"], .msg-s-event-listitem__footer a, a[href*="/dms/"], a[download]');
        for (var a = 0; a < nodes.length; a++) {
          var t = clean(nodes[a].innerText || nodes[a].getAttribute('title') || nodes[a].getAttribute('download') || '');
          if (!t) continue;
          var m = t.match(FILE_RE);
          if (m) for (var k = 0; k < m.length; k++) names[clean(m[k])] = 1;
        }
        // Fallback: the filename can render as plain text in the bubble with no tell-tale class.
        if (!Object.keys(names).length) {
          var whole = clean(item.innerText || '').match(FILE_RE);
          if (whole) for (var w = 0; w < whole.length; w++) names[clean(whole[w])] = 1;
        }
        return Object.keys(names);
      }
      var groups = document.querySelectorAll('li.msg-s-message-list__event, .msg-s-message-list__event');
      var out = []; var lastSender = ''; var seenDone = {};
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        var nameEl = g.querySelector('.msg-s-message-group__name, .msg-s-message-group__profile-link');
        var name = nameEl ? clean(nameEl.innerText) : '';
        if (name) lastSender = name;
        // Walk the message ITEMS, not just bodies — an attachment-only message has no body node and
        // was being dropped entirely.
        var items = g.querySelectorAll('.msg-s-event-listitem');
        if (!items.length) items = [g];
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          var bodyEl = item.querySelector ? item.querySelector('.msg-s-event-listitem__body') : null;
          var text = bodyEl ? clean(bodyEl.innerText) : '';
          var files = attachmentsIn(item);
          // A filename repeated from the body text isn't a second attachment.
          files = files.filter(function (f) { return text.toLowerCase().indexOf(f.toLowerCase()) === -1; });
          if (!text && !files.length) continue;
          var isOther = !!(item.classList && item.classList.contains('msg-s-event-listitem--other'));
          if (files.length) text = (text ? text + '\n' : '') + '[attached file: ' + files.join(', ') + ']';
          var key = (isOther ? 'o' : 'y') + '|' + text;
          if (seenDone[key]) continue;          // guard against a node matched twice by both queries
          seenDone[key] = 1;
          out.push({ from: lastSender || (isOther ? 'them' : 'You'), isYou: !isOther, text: text });
        }
      }
      // "Seen by …" read receipt — proof they opened the last message rather than missing it, which
      // changes what a good follow-up says.
      var seen = '';
      var receipts = document.querySelectorAll('[class*="seen-receipt"], .msg-s-message-list__typing-indicator-container ~ * [class*="seen"]');
      for (var r = 0; r < receipts.length; r++) {
        var rt = clean(receipts[r].innerText || '');
        if (/^seen\b/i.test(rt)) seen = rt;
      }
      var hdr = document.querySelector('.msg-overlay-bubble-header__title, .msg-thread__link-to-profile');
      var who = hdr ? clean(hdr.innerText) : '';
      return { who: who, seen: seen, messages: out.slice(-20) };
    }).catch(function () { return { who: '', seen: '', messages: [] }; });
    await hideBanner(rtPage);
    if (!rtConvo.messages || !rtConvo.messages.length) { process.stdout.write('READTHREAD_EMPTY Opened their chat but could not read any messages yet — it may still be loading.'); return; }
    process.stdout.write('THREAD_JSON:' + JSON.stringify(rtConvo));
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
    // A PROFILE is not a feed. The feed extractor was run on every linkedin.com URL, so opening
    // /in/<someone> returned their recent posts and stopped there — the headline, About, Experience
    // and Education were never read, which is why a "research this person" briefing came back thin
    // and generic. Read the profile body for /in/ pages; keep the feed extractor for the feed and
    // for the recent-activity tab, which really are post lists.
    var isProfilePage = /\/in\//.test(openPage.url()) && !/recent-activity|detail\/recent-activity/.test(openPage.url());
    if (!isProfilePage) markdown = await extractLinkedInFeed(openPage);
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
