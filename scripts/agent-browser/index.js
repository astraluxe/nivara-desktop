#!/usr/bin/env node
// adris.tech agent-browser — Playwright wrapper using system Chrome
// Persistent profile keeps sessions saved (user logs in once per site)
//
// Usage:
//   node index.js install           — verify playwright-core is installed
//   node index.js open <url>        — navigate to URL, return full page text
//   node index.js <other>           — returns "(done)" (no-op for compat)

const path = require('path');
const os   = require('os');
const fs   = require('fs');

const PROFILE_DIR = process.env.AGENT_BROWSER_PROFILE || (
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'adris.tech', 'browser-session')
    : path.join(os.homedir(), '.local', 'share', 'adris-tech', 'browser-session')
);

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

  if (cmd !== 'open') {
    process.stdout.write('(done)\n');
    return;
  }

  // URL may be quoted or bare
  const rawUrl = argv.slice(1).join(' ').replace(/^"|"$/g, '').trim();
  const url    = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;

  const { chromium } = require('playwright-core');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel:           'chrome',   // uses system Chrome — no separate download
    headless:          false,      // visible so user can log in if needed
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Wait for network to settle (SPA initial JS execution)
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch {}

    // Scroll a third of the way down to trigger lazy-loaded content (LinkedIn posts, Gmail threads)
    await page.evaluate(() => window.scrollTo(0, Math.floor(document.body.scrollHeight / 3)));

    // Extra wait for JS-rendered content after scroll (LinkedIn needs ~2s to render posts)
    await new Promise(r => setTimeout(r, 2500));

    // Extract clean text — remove noise elements before grabbing innerText.
    // Technique borrowed from Firecrawl (tag/class exclusion) + Crawl4AI (semantic element preference).
    const text = await page.evaluate(() => {
      // Tags to always remove
      const REMOVE_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas'];
      // Semantic/class-based selectors for boilerplate regions
      const REMOVE_SELECTORS = [
        'header', 'footer', 'nav', 'aside',
        '[class*="header"]', '[class*="footer"]', '[class*="navbar"]',
        '[class*="nav-"]', '[class*="-nav"]', '[class*="sidebar"]',
        '[class*="cookie"]', '[id*="cookie"]', '[class*="gdpr"]',
        '[class*="banner"]', '[class*="popup"]', '[class*="modal"]',
        '[class*="overlay"]', '[class*="toast"]',
        '[class*="advertisement"]', '[class*=" ad"]', '[class*="ads-"]',
        '[class*="social-"]', '[class*="share-"]', '[class*="breadcrumb"]',
        '[class*="subscribe"]', '[class*="newsletter"]',
        '[aria-label*="advertisement"]',
        '[role="banner"]', '[role="navigation"]', '[role="complementary"]',
        '.sr-only', '.visually-hidden', '[hidden]',
      ];

      // Clone body so we don't mutate the live page
      const clone = document.body.cloneNode(true);
      for (const tag of REMOVE_TAGS) {
        clone.querySelectorAll(tag).forEach(el => el.remove());
      }
      for (const sel of REMOVE_SELECTORS) {
        try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
      }

      // Prefer semantic main-content element (Crawl4AI approach)
      const main = clone.querySelector('article')
        || clone.querySelector('main')
        || clone.querySelector('[role="main"]')
        || clone.querySelector('#content')
        || clone.querySelector('.content')
        || clone.querySelector('#main')
        || clone;

      // Format headings for readability (browser-use markdown approach)
      main.querySelectorAll('h1,h2,h3,h4').forEach(h => {
        const prefix = '#'.repeat(parseInt(h.tagName[1])) + ' ';
        if (!h.textContent.trim().startsWith('#')) {
          h.textContent = prefix + h.textContent.trim();
        }
      });

      return (main.innerText || main.textContent || '').trim();
    });

    process.stdout.write(text || '(page loaded — no readable text)');
  } finally {
    await context.close();
  }
}

main().catch(e => {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
