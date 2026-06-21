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

    const text = await page.evaluate(() =>
      (document.body.innerText || document.body.textContent || '').trim()
    );

    process.stdout.write(text || '(page loaded — no readable text)');
  } finally {
    await context.close();
  }
}

main().catch(e => {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exit(1);
});
