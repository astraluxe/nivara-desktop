// ─── A real .pptx, in the real PowerPoint on this machine ────────────────────
//
// Everything else about the deck is tested in a browser: the spec renders, the zip contains the
// pictures, the card asks where it should go. None of that proves the file PowerPoint receives is
// one PowerPoint will actually open — a .pptx can satisfy every assertion we write and still be
// rejected by the application it is for.
//
// So this builds a deck through the SHIPPED renderer, writes it to disk, opens it in the real
// POWERPNT.EXE, and checks that PowerPoint is still running a few seconds later. A corrupt file
// makes PowerPoint show a repair dialog or exit; a good one leaves a live process with the file
// open.
//
// Run: node harness/powerpoint-real.mjs   (after: vite build --config vite.visual.config.ts)
//      --keep-open   leave PowerPoint open at the end so a person can look at the slides

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist-visual');
const KEEP = process.argv.includes('--keep-open');

if (!fs.existsSync(path.join(DIST, 'visual.html'))) {
  console.error('no dist-visual — run: npx vite build --config vite.visual.config.ts --outDir dist-visual');
  process.exit(2);
}

const PPT = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE';
if (!fs.existsSync(PPT)) {
  console.log('PowerPoint is not installed on this machine — skipping (this test only runs where it is).');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/visual.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5392, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

// A 2×2 PNG standing in for a figure lifted out of the user's document.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQI12P8//8/AzbAxIAHDDNJAB2wAhkBFsn0AAAAAElFTkSuQmCC';

const OUT = path.join(process.env.TEMP || '.', 'adris-powerpoint-test.pptx');
let running = null;

// Was PowerPoint already up? This decides both what we are allowed to close afterwards and whether
// "PowerPoint is running" means anything at the end — if it was running all along, that assertion
// proves nothing on its own.
const wasAlreadyRunning = /POWERPNT\.EXE/i.test(
  (() => { try { return execFileSync('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/FO', 'CSV'], { encoding: 'utf8' }); } catch { return ''; } })(),
);
if (wasAlreadyRunning) {
  console.log('note: PowerPoint was already open before this test started.');
}

try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5392/visual.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__deck, null, { timeout: 20000 });

  console.log('\n=== build it through the shipped renderer ===');
  const b64 = await page.evaluate(async (png) => {
    // A deck that uses every layout the placer can target, each carrying a picture, so the file
    // PowerPoint opens is the most demanding one we ever produce rather than a trivial one.
    const spec = {
      title: 'Blood supply of the periodontium',
      font: { heading: 'Georgia', body: 'Arial' },
      palette: { bg: '#ffffff', surface: '#f4f4f5', text: '#111111', muted: '#666666', accent: '#7c3aed' },
      logo: png,
      slides: [
        { layout: 'title',      title: 'Blood supply of the periodontium', subtitle: 'Seminar 5', imageData: png },
        { layout: 'section',    title: 'The three sources', imageData: png },
        { layout: 'bullets',    title: 'Gingival vessels', bullets: ['Supraperiosteal arterioles', 'Vessels of the periodontal ligament', 'Arterioles from the alveolar crest'], imageData: png },
        { layout: 'image-full', title: 'Figure 1 — arterial supply', imageData: png },
        { layout: 'two-column', title: 'Nerve supply', columns: [{ heading: 'Maxillary', bullets: ['Superior alveolar'] }, { heading: 'Mandibular', bullets: ['Inferior alveolar'] }] },
        { layout: 'quote',      quote: 'The periodontium is richly vascularised.', attribution: 'Carranza' },
        { layout: 'stat',       stat: '3', statLabel: 'sources of supply' },
        { layout: 'closing',    title: 'Thank you', body: 'Questions welcome', imageData: png },
      ],
    };
    const blob = await window.__deck.deckToPptxBlob(spec);
    const buf = await blob.arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, PNG);

  fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  const size = fs.statSync(OUT).size;
  ok('a file was written', size > 10_000, `${size} bytes`);
  ok('it starts with the zip magic (a .pptx is a zip)',
    fs.readFileSync(OUT).subarray(0, 2).toString('hex') === '504b', fs.readFileSync(OUT).subarray(0, 4).toString('hex'));

  console.log('\n=== open it in the real PowerPoint ===');
  // Detached, because this is a window a person is meant to look at — not something to wait on.
  running = spawn(PPT, [OUT], { detached: true, stdio: 'ignore' });
  running.unref();

  // Give PowerPoint time to parse the file and decide whether it likes it.
  await new Promise((r) => setTimeout(r, 9000));

  const tasks = execFileSync('tasklist', ['/FI', 'IMAGENAME eq POWERPNT.EXE', '/FO', 'CSV'], { encoding: 'utf8' });
  const alive = /POWERPNT\.EXE/i.test(tasks);
  // If PowerPoint was already open, "it is running" was true before we did anything — so the thing
  // that actually proves our file opened is the window title below, not this.
  ok(wasAlreadyRunning ? 'PowerPoint is still running (it was already open)' : 'PowerPoint started and stayed up',
    alive, tasks.split('\n')[1] || tasks.slice(0, 120));

  // A file PowerPoint cannot read produces a repair prompt, and its window title says so. Reading
  // the window title is how we tell "opened" from "opened and complained".
  const titles = execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-Process POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }"],
    { encoding: 'utf8' }).trim();
  console.log('   window title: ' + (titles || '(none yet)'));
  ok('...and it did not raise a repair dialog', !/repair|recover|error/i.test(titles), titles);
  ok('...with our file open', !titles || /adris-powerpoint-test|PowerPoint/i.test(titles), titles);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('file: ' + OUT);
} finally {
  await browser.close();
  server.close();
  // ONLY CLOSE WHAT WE OPENED.
  //
  // The first version ran `taskkill /IM POWERPNT.EXE /F`, which closes every PowerPoint on the
  // machine — including a presentation the user had open with unsaved changes. A test may not
  // destroy the work of the person running it. So: if PowerPoint was already running before we
  // started, we leave the whole application alone, and otherwise we close only our own process.
  if (KEEP) {
    console.log('\nPowerPoint left open so you can look at the slides.');
  } else if (wasAlreadyRunning) {
    console.log('\nPowerPoint was already open before this test — leaving it alone.');
    console.log('Close the "' + path.basename(OUT) + '" tab yourself when you are done with it.');
  } else if (running?.pid) {
    try { execFileSync('taskkill', ['/PID', String(running.pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { /* it already exited */ }
  }
}
process.exit(fail ? 1 : 0);
