#!/usr/bin/env node
// adris.tech agent-browser — Playwright wrapper using system Chrome
// Persistent profile keeps sessions saved (user logs in once per site).
// Browser stays open between commands — click/fill/snapshot work on the live page.
//
// Usage:
//   node index.js install              — verify playwright-core is installed
//   node index.js open <url>           — navigate, return clean page text
//   node index.js snapshot             — accessibility tree with @eN refs
//   node index.js click "<sel>"        — click selector or @eN ref
//   node index.js fill "<sel>" "<txt>" — fill input
//   node index.js screenshot           — JPEG as data URI
//   node index.js get text "<sel>"     — innerText of element
//   node index.js close                — close the browser

const path = require('path');
const os   = require('os');
const fs   = require('fs');
const http = require('http');

const PROFILE_DIR = process.env.AGENT_BROWSER_PROFILE || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'adris.tech', 'browser-session')
    : path.join(os.homedir(), '.local', 'share', 'adris-tech', 'browser-session')
);

// Fixed CDP port — lets us reconnect to a running Chrome instance
const CDP_PORT  = 9223;
const CDP_URL   = `http://localhost:${CDP_PORT}`;
// State file: remembers the last navigated URL so click/fill can reload if needed
const STATE_FILE = path.join(PROFILE_DIR, '.agent-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { url: null }; }
}
function writeState(data) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(data)); } catch {}
}

// Returns true if Chrome is already running and accepting CDP connections
async function isBrowserRunning() {
  return new Promise(resolve => {
    http.get(`${CDP_URL}/json/version`, res => {
      resolve(res.statusCode === 200);
      res.resume();
    }).on('error', () => resolve(false)).setTimeout(1500, () => resolve(false));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd  = argv[0] || '';

  if (cmd === 'install') {
    try {
      require('playwright-core');
      process.stdout.write('agent-browser ready (playwright-core + system Chrome)\n');
    } catch {
      process.stderr.write('playwright-core not installed\n');
      process.exit(1);
    }
    return;
  }

  const { chromium } = require('playwright-core');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // ── open <url> ────────────────────────────────────────────────────────────
  if (cmd !== 'open' && cmd !== 'close') {
    // Interactive commands: try to connect to already-running Chrome first
    const running = await isBrowserRunning();
    const state   = readState();

    let context, browser;
    if (running) {
      try {
        browser  = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
        const ctxs = browser.contexts();
        context = ctxs.length > 0 ? ctxs[0] : await browser.newContext();
      } catch { running && (browser = null); }
    }

    if (!context) {
      // Browser not running — launch fresh with the persistent profile
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome',
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          `--remote-debugging-port=${CDP_PORT}`,
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      });
    }

    let page = context.pages().at(-1) || await context.newPage();

    // If current page is blank and we know the last URL, navigate back to it
    if ((page.url() === 'about:blank' || page.url() === '') && state.url) {
      await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
    }

    // ── snapshot ─────────────────────────────────────────────────────────────
    if (cmd === 'snapshot') {
      const tree = await page.evaluate(function() {
        var idx = 0;
        function walk(el, depth) {
          if (!el || !el.tagName) return '';
          var tag = el.tagName.toLowerCase();
          if (['script','style','noscript','svg','head'].includes(tag)) return '';
          var isInteractive = ['a','button','input','select','textarea'].includes(tag)
            || el.getAttribute('role') === 'button'
            || el.getAttribute('onclick');
          var text = (el.innerText || el.textContent || '').trim().replace(/\n/g,' ').slice(0, 80);
          var line = '';
          if (isInteractive && (text || el.getAttribute('placeholder'))) {
            el.setAttribute('data-aref', 'e' + (++idx));
            var indent = '  '.repeat(Math.min(depth, 6));
            var attrs = [
              el.getAttribute('type')        ? 'type=' + el.getAttribute('type')                        : '',
              el.getAttribute('placeholder') ? 'placeholder="' + el.getAttribute('placeholder') + '"'  : '',
              el.getAttribute('href')        ? 'href="' + (el.getAttribute('href')||'').slice(0,60)+'"': '',
              el.getAttribute('role')        ? 'role=' + el.getAttribute('role')                        : '',
            ].filter(Boolean).join(' ');
            line = indent + '[@' + el.getAttribute('data-aref') + '] <' + tag + (attrs ? ' '+attrs : '') + '> ' + text + '\n';
          }
          return line + Array.from(el.children).map(function(c) { return walk(c, depth + 1); }).join('');
        }
        return walk(document.body, 0);
      });
      process.stdout.write(tree.trim() || '(no interactive elements found)');
      return;
    }

    // ── click <selector or @ref> ─────────────────────────────────────────────
    // Shell strips quotes; argv[1] is the selector (may have spaces if shell didn't split further)
    if (cmd === 'click') {
      const sel = (argv[1] || '').replace(/^"|"$/g, '').trim();
      if (sel.startsWith('@')) {
        const ref = sel.slice(1);
        await page.evaluate(r => {
          const el = document.querySelector(`[data-aref="${r}"]`);
          if (!el) throw new Error(`ref @${r} not found — call snapshot first`);
          el.click();
        }, ref);
      } else {
        await page.click(sel, { timeout: 10000 });
      }
      await new Promise(r => setTimeout(r, 800));
      writeState({ url: page.url() });
      process.stdout.write(`Clicked "${sel}". Page: ${page.url()}`);
      return;
    }

    // ── fill <selector> <text> ───────────────────────────────────────────────
    // Shell already strips quotes before Node sees them, so argv[1]=selector, rest=text
    if (cmd === 'fill') {
      const sel  = argv[1] || '';
      const text = argv.slice(2).join(' ');
      if (!sel) { process.stdout.write('fill: missing selector'); return; }
      if (sel.startsWith('@')) {
        const ref = sel.slice(1);
        await page.evaluate(function(args) {
          var el = document.querySelector('[data-aref="' + args.r + '"]');
          if (!el) throw new Error('ref @' + args.r + ' not found');
          el.value = args.t;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { r: ref, t: text });
      } else {
        await page.fill(sel, text, { timeout: 10000 });
      }
      writeState({ url: page.url() });
      process.stdout.write(`Filled "${sel}" with the provided text.`);
      return;
    }

    // ── screenshot ───────────────────────────────────────────────────────────
    if (cmd === 'screenshot') {
      const buf = await page.screenshot({ type: 'jpeg', quality: 72 });
      process.stdout.write('data:image/jpeg;base64,' + buf.toString('base64'));
      return;
    }

    // ── get text <selector> ──────────────────────────────────────────────────
    // Shell-parsed (run_agent_browser_session): argv = ['get', 'text', selector]
    // Node-parsed (run_browser_persistent option B): argv = ['get', 'text body'] (single arg)
    if (cmd === 'get') {
      // Reconstruct the full selector: drop 'text' word(s) from front of remaining args
      const rest = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim(); // e.g. "text body" or "text"
      const bodyOnly = rest.startsWith('text') ? rest.slice(4).trim() : rest;
      const sel = bodyOnly || 'body';
      const txt = await page.evaluate(function(s) {
        var el = document.querySelector(s);
        return el ? (el.innerText || el.textContent || '').trim() : '(element not found)';
      }, sel);
      process.stdout.write(txt);
      return;
    }

    process.stdout.write('(done)');
    return;
  }

  // ── close ─────────────────────────────────────────────────────────────────
  if (cmd === 'close') {
    const running = await isBrowserRunning();
    if (running) {
      try {
        const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 2000 });
        await browser.close();
      } catch {}
    }
    writeState({ url: null });
    process.stdout.write('Browser closed.');
    return;
  }

  // ── open <url> ────────────────────────────────────────────────────────────
  const rawUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
  const url    = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  // Try connecting to running Chrome first (avoids opening a second window)
  let context;
  const running = await isBrowserRunning();
  if (running) {
    try {
      const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 3000 });
      const ctxs = browser.contexts();
      context = ctxs.length > 0 ? ctxs[0] : null;
    } catch {}
  }

  if (!context) {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chrome',
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        `--remote-debugging-port=${CDP_PORT}`,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  }

  const page = context.pages()[0] || await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}
  await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight / 3)));
  await new Promise(r => setTimeout(r, 2500));

  // Extract clean text — remove noise before innerText (Firecrawl + Crawl4AI technique)
  const text = await page.evaluate(function() {
    var REMOVE_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas'];
    var REMOVE_SELECTORS = [
      'header', 'footer', 'nav', 'aside',
      '[class*="header"]', '[class*="footer"]', '[class*="navbar"]',
      '[class*="nav-"]', '[class*="-nav"]', '[class*="sidebar"]',
      '[class*="cookie"]', '[id*="cookie"]', '[class*="gdpr"]',
      '[class*="banner"]', '[class*="popup"]', '[class*="modal"]',
      '[class*="overlay"]', '[class*="toast"]',
      '[class*="advertisement"]', '[class*="ads-"]',
      '[class*="social-"]', '[class*="share-"]', '[class*="breadcrumb"]',
      '[class*="subscribe"]', '[class*="newsletter"]',
      '[aria-label*="advertisement"]',
      '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
      '.sr-only', '.visually-hidden', '[hidden]',
    ];
    var clone = document.body.cloneNode(true);
    REMOVE_TAGS.forEach(function(tag) { clone.querySelectorAll(tag).forEach(function(el) { el.remove(); }); });
    REMOVE_SELECTORS.forEach(function(sel) {
      try { clone.querySelectorAll(sel).forEach(function(el) { el.remove(); }); } catch(_) {}
    });
    var main = clone.querySelector('article')
      || clone.querySelector('main')
      || clone.querySelector('[role="main"]')
      || clone.querySelector('#content')
      || clone.querySelector('.content')
      || clone.querySelector('#main')
      || clone;
    main.querySelectorAll('h1,h2,h3,h4').forEach(function(h) {
      var prefix = '#'.repeat(parseInt(h.tagName[1])) + ' ';
      if (!(h.textContent || '').trim().startsWith('#'))
        h.textContent = prefix + (h.textContent || '').trim();
    });
    return (main.innerText || main.textContent || '').trim();
  });

  writeState({ url });
  // DON'T close context — Chrome stays open so click/fill/snapshot work on this page
  process.stdout.write(text || '(page loaded — no readable text)');
}

main().catch(e => {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
