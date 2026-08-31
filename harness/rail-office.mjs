// ─── "i clicked on word and nth happened" ────────────────────────────────────
//
// The rail's Word / Excel / PowerPoint buttons called the launcher with a COMMAND NAME:
//
//     invoke('launch_application', { exe: 'winword', file: null })
//
// The Rust side requires a real file (`path.is_file()`), so it returned an error every single
// time — and the caller wrapped the call in `catch {}`, so the error went nowhere. The button
// looked alive and did nothing at all.
//
// This drives the SHIPPED rail in a real browser and checks the three things that were wrong:
//   1. The Office buttons appear when Office is on the machine.
//   2. Clicking one asks the launcher for the executable's real PATH, not a name.
//   3. When the launch fails, the person who clicked is TOLD. A dead button is the bug.
//
// Run: node harness/rail-office.mjs   (after: vite build --config vite.visual.config.ts)

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
await new Promise((r) => server.listen(5363, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

const OFFICE = String.raw`C:\Program Files\Microsoft Office\root\Office16`;
const scan = {
  scannedAt: Date.now(),
  automation: { word: true, excel: true, powerpoint: true, outlook: false, libreoffice: false },
  apps: [
    { name: 'Microsoft Word', kind: 'office', path: OFFICE + String.raw`\WINWORD.EXE` },
    { name: 'Microsoft Excel', kind: 'office', path: OFFICE + String.raw`\EXCEL.EXE` },
    { name: 'Microsoft PowerPoint', kind: 'office', path: OFFICE + String.raw`\POWERPNT.EXE` },
    // WordPad is not Word. It shipped on every Windows for decades, so a rule that matches loosely
    // finds it first and opens the wrong application.
    { name: 'WordPad', kind: 'other', path: String.raw`C:\Program Files\Windows NT\Accessories\wordpad.exe` },
  ],
};

/** Open the rail, optionally scripting the launcher to fail the way the real one did. */
async function rail(launchError) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(([s, err]) => {
    localStorage.setItem('nv-installed-apps', JSON.stringify(s));
    if (err) window.__invokeReplies = { launch_application: { error: err } };
  }, [scan, launchError || '']);
  await page.goto('http://127.0.0.1:5363/visual.html?rail=1', { waitUntil: 'networkidle' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  return page;
}

/** Click a rail button by its tooltip/label, the way a person picks it out. */
const clickRail = (page, label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll('button')]
    .find((x) => (x.getAttribute('title') || x.getAttribute('aria-label') || '').includes(label));
  if (!b) return false;
  b.click();
  return true;
}, label);

try {
  console.log('\n=== the buttons are there, and they carry the right names ===');
  {
    const page = await rail();
    const labels = await page.evaluate(() => [...document.querySelectorAll('button')]
      .map((b) => b.getAttribute('title') || b.getAttribute('aria-label') || '').filter(Boolean));
    ok('Word is on the rail', labels.some((l) => /Word/.test(l)), JSON.stringify(labels));
    ok('Excel is on the rail', labels.some((l) => /Excel/.test(l)));
    ok('PowerPoint is on the rail', labels.some((l) => /PowerPoint/.test(l)));
    // The label says what the click does. "Word — on this computer" described a state; a button
    // that opens something should say so.
    ok('the label says it opens the application', labels.some((l) => /^Open Word$/.test(l)), JSON.stringify(labels));
    await page.close();
  }

  console.log('\n=== clicking Word asks for the real executable ===');
  {
    const page = await rail();
    ok('the Word button can be clicked', await clickRail(page, 'Word'));
    await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__calls || []);
    const launch = calls.find((c) => c.cmd === 'launch_application');
    ok('the launcher was actually called', !!launch, JSON.stringify(calls));
    ok('...with a real path, not the name "winword"',
      !!launch && /WINWORD\.EXE$/i.test(launch.args.exe || ''), JSON.stringify(launch && launch.args));
    ok('...and NOT with WordPad', !!launch && !/wordpad/i.test(launch.args.exe || ''));
    await page.close();
  }

  console.log('\n=== PowerPoint opens PowerPoint, not the first Office app found ===');
  {
    const page = await rail();
    await clickRail(page, 'PowerPoint');
    await page.waitForTimeout(400);
    const launch = await page.evaluate(() => (window.__calls || []).find((c) => c.cmd === 'launch_application'));
    ok('the PowerPoint button launches POWERPNT.EXE',
      !!launch && /POWERPNT\.EXE$/i.test(launch.args.exe || ''), JSON.stringify(launch && launch.args));
    await page.close();
  }

  console.log('\n=== a failed launch is said out loud ===');
  {
    // This is the whole point. Before, this exact case looked identical to a working button.
    const page = await rail('Word is not on this computer — scan the installed applications first.');
    await clickRail(page, 'Word');
    await page.waitForTimeout(500);
    const txt = await page.evaluate(() => document.body.innerText);
    ok('the user is told the launch failed', /couldn't open word/i.test(txt), txt.slice(0, 300));
    ok('...and told why', /not on this computer/i.test(txt), txt.slice(0, 300));
    await page.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
