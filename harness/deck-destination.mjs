// ─── "atleast ask the user where they want the ppt" ──────────────────────────
//
// The deck card had this, in the source, as a fact rather than a question:
//
//     const format: 'html' = 'html';
//
// So someone who owned PowerPoint, and someone who said outright that they wanted PowerPoint, got
// the in-chat deck and no way to say otherwise.
//
// This drives the SHIPPED card in a real browser and checks the two things that matter:
//   1. When PowerPoint is on the machine, the choice is offered and choosing it really does come
//      back as format: 'pptx'.
//   2. When it is NOT, the choice is not offered at all — an option that cannot work is worse than
//      no option, because the user picks it, waits, and gets an error.
//
// Run: node harness/deck-destination.mjs   (after: vite build --config vite.visual.config.ts)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist-visual');
if (!fs.existsSync(path.join(DIST, 'visual.html'))) {
  console.error('no dist-visual — run: npx vite build --config vite.visual.config.ts --outDir dist-visual');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/visual.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5361, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

/** A machine scan, in the exact shape the cache holds, with or without PowerPoint on it. */
const scanWith = (withPpt) => ({
  scannedAt: Date.now(),
  automation: { word: true, excel: true, powerpoint: withPpt, outlook: false, libreoffice: false },
  apps: [
    { name: 'Microsoft Word', kind: 'office', path: String.raw`C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE` },
    { name: 'Microsoft Excel', kind: 'office', path: String.raw`C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE` },
    ...(withPpt
      ? [{ name: 'Microsoft PowerPoint', kind: 'office', path: String.raw`C:\Program Files\Microsoft Office\root\Office16\POWERPNT.EXE` }]
      : []),
  ],
});

/** Open the card with a given machine, and hand back a probe of what it shows. */
async function card(withPpt) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript((scan) => {
    localStorage.setItem('nv-installed-apps', JSON.stringify(scan));
  }, scanWith(withPpt));
  await page.goto('http://127.0.0.1:5361/visual.html?deck=1', { waitUntil: 'networkidle' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  return page;
}

const textOf = (page) => page.evaluate(() => document.body.innerText);
const clickText = (page, t) => page.evaluate((t) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(t));
  if (!b) return false;
  b.click();
  return true;
}, t);

try {
  console.log('\n=== PowerPoint is on this computer ===');
  {
    const page = await card(true);
    const txt = await textOf(page);
    ok('the card asks where the deck should go', /where should it go/i.test(txt), txt.slice(0, 200));
    ok('...offering the chat', /here in the chat/i.test(txt));
    ok('...and offering real PowerPoint', /microsoft powerpoint/i.test(txt));
    // The promise made on the card, which the pptx path has to keep.
    ok('...and promising the document pictures either way', /pictures from your document/i.test(txt));

    // The default must stay the chat deck: it is the thing that works with no other application
    // and is what follow-up edits act on.
    const picked = await clickText(page, 'Microsoft PowerPoint');
    ok('the PowerPoint option is clickable', picked);
    const built = await clickText(page, 'Generate deck');
    ok('the deck can be generated', built);
    await page.waitForTimeout(300);
    const cfg = await page.evaluate(() => window.__deckCfg);
    ok('choosing PowerPoint really returns format: pptx', cfg && cfg.format === 'pptx', JSON.stringify(cfg));
    await page.close();
  }

  console.log('\n=== the user\'s own PowerPoint is the DEFAULT, not the fallback ===');
  {
    // The policy for this product: an application the business already owns beats anything we
    // render ourselves. They know it, their template and fonts live in it, and they can keep
    // editing after we are gone. Our in-chat deck is what happens when there is NO PowerPoint —
    // not the default in spite of one. So pressing Generate without touching anything must
    // produce a real .pptx.
    const page = await card(true);
    await clickText(page, 'Generate deck');
    await page.waitForTimeout(300);
    const cfg = await page.evaluate(() => window.__deckCfg);
    ok('untouched, it builds in PowerPoint', cfg && cfg.format === 'pptx', JSON.stringify(cfg));
    await page.close();
  }

  console.log('\n=== but the chat is still one click away ===');
  {
    const page = await card(true);
    ok('the chat option can be chosen', await clickText(page, 'Here in the chat'));
    await clickText(page, 'Generate deck');
    await page.waitForTimeout(300);
    const cfg = await page.evaluate(() => window.__deckCfg);
    ok('...and it is honoured', cfg && cfg.format === 'html', JSON.stringify(cfg));
    await page.close();
  }

  console.log('\n=== PowerPoint is NOT on this computer ===');
  {
    const page = await card(false);
    const txt = await textOf(page);
    ok('no destination is offered', !/where should it go/i.test(txt));
    ok('...and PowerPoint is not mentioned at all', !/microsoft powerpoint/i.test(txt), txt.slice(0, 200));
    await clickText(page, 'Generate deck');
    await page.waitForTimeout(300);
    const cfg = await page.evaluate(() => window.__deckCfg);
    ok('the deck is built in the chat', cfg && cfg.format === 'html', JSON.stringify(cfg));
    await page.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
