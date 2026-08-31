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
  const built = await page.evaluate(async (png) => {
    // EVERY layout in the DeckSlide union, each field carrying a findable marker.
    //
    // This used to be the eight layouts the .pptx writer happened to support — so the nine it had
    // no case for were never exercised here, and their content was dropped silently for months.
    // A test that only runs what already works cannot find what does not.
    //
    // The markers are checked against the unzipped file below, so a slide that arrives as an empty
    // shell now fails the run instead of passing it.
    const spec = {
      title: 'Blood supply of the periodontium',
      font: { heading: 'Georgia', body: 'Arial' },
      palette: { bg: '#ffffff', surface: '#f4f4f5', text: '#111111', muted: '#666666', accent: '#7c3aed' },
      logo: png,
      slides: [
        { layout: 'title',      title: 'MK-TITLE', subtitle: 'MK-TITLESUB', body: 'MK-TITLEBODY', imageData: png },
        { layout: 'agenda',     title: 'MK-AGENDA', bullets: ['MK-AG1', 'MK-AG2', 'MK-AG3'] },
        { layout: 'section',    title: 'MK-SECTION', subtitle: 'MK-SECTIONSUB', imageData: png },
        { layout: 'bullets',    title: 'MK-BULLETS', body: 'MK-BULLETSBODY', bullets: ['MK-B1', 'MK-B2', 'MK-B3'], imageData: png },
        { layout: 'chart',      title: 'MK-CHART', chartUnit: 'MK-UNIT', chartData: [{ label: 'MK-CHARTLBL', value: 250000 }, { label: 'MK-CHARTLBB', value: 19999 }] },
        { layout: 'comparison', title: 'MK-COMPARE', columns: [{ heading: 'MK-CMPHA', bullets: ['MK-CMPBA'] }, { heading: 'MK-CMPHB', bullets: ['MK-CMPBB'] }] },
        { layout: 'cards',      title: 'MK-CARDS', cards: [{ heading: 'MK-CARDHA', body: 'MK-CARDBA' }, { heading: 'MK-CARDHB', body: 'MK-CARDBB' }] },
        { layout: 'process',    title: 'MK-PROCESS', cards: [{ heading: 'MK-PROCH', body: 'MK-PROCBODY' }] },
        { layout: 'timeline',   title: 'MK-TIMELINE', timeline: [{ label: 'MK-TLLBL', text: 'MK-TLTEXT' }] },
        { layout: 'pricing',    title: 'MK-PRICING', plans: [{ name: 'MK-PLAN', price: 'MK-PRICE', bullets: ['MK-PLANB'], highlight: true }] },
        { layout: 'team',       title: 'MK-TEAM', people: [{ name: 'MK-PERSON', role: 'MK-ROLE' }] },
        { layout: 'logos',      title: 'MK-LOGOS', logos: ['MK-LOGOA', 'MK-LOGOB'] },
        { layout: 'two-column', title: 'MK-TWOCOL', columns: [{ heading: 'MK-COLHA', bullets: ['MK-COLBA'] }, { heading: 'MK-COLHB', bullets: ['MK-COLBB'] }] },
        { layout: 'quote',      quote: 'MK-QUOTE', attribution: 'MK-ATTRIB' },
        { layout: 'stat',       title: 'MK-STATTITLE', stat: 'MK-STAT', statLabel: 'MK-STATLABEL' },
        { layout: 'image-full', title: 'MK-IMGFULL', imageData: png },
        // The long dash the user asked us to stop shipping, plus a numeric range that must survive
        // the rule that removes it.
        { layout: 'closing',    title: 'MK-CLOSING — thank you', body: 'MK-CLOSINGBODY 2020–2024', subtitle: 'MK-CLOSINGSUB' },
      ],
    };
    const blob = await window.__deck.deckToPptxBlob(spec, { name: 'Amogh M' });
    const buf = await blob.arrayBuffer();
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    // THE SAME SPEC, THROUGH THE OTHER RENDERER.
    //
    // "makesure the ppt designed in chat and when got to power point both are matching as i still
    // find few minor errors and things a bit here and there not used properly."
    //
    // Two renderers of one spec drift, and the last time they did, nine layouts had quietly stopped
    // carrying their content into PowerPoint. Rendering both here and comparing what each actually
    // shows is the only way that stays fixed. The chat deck is parsed as real HTML rather than
    // regexed, so what is compared is what a reader would see.
    //
    // Tags become SPACES rather than being dropped. A DOMParser document is never rendered, so
    // `innerText` is unavailable and `textContent` concatenates adjacent nodes with no separator —
    // an agenda's "01" and its text came back as one run, and the marker regex then read
    // "MK-AG1" + "02" + "MK-AG2" as the single token "MK-AG102MK". That looked like a renderer
    // disagreement and was nothing but the way the text was pulled out.
    const chatHtml = window.__deck.renderDeckHtml(spec);
    const chatText = chatHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')   // the embedded spec is not on screen
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    // The marker list travels back with the file so the checks below are derived from the very
    // spec that was rendered, rather than a copy of it that could drift.
    return {
      b64: btoa(s),
      markers: [...new Set(JSON.stringify(spec).match(/MK-[A-Z0-9]+/g) || [])],
      chatMarkers: [...new Set(chatText.match(/MK-[A-Z0-9]+/g) || [])],
    };
  }, PNG);

  fs.writeFileSync(OUT, Buffer.from(built.b64, 'base64'));
  const size = fs.statSync(OUT).size;
  ok('a file was written', size > 10_000, `${size} bytes`);
  ok('it starts with the zip magic (a .pptx is a zip)',
    fs.readFileSync(OUT).subarray(0, 2).toString('hex') === '504b', fs.readFileSync(OUT).subarray(0, 4).toString('hex'));

  console.log('\n=== what actually survived the trip ===');
  //
  // The slide COUNT was always right, which is exactly why this went unseen for so long: seventeen
  // slides arrived and nine of them were empty shells carrying only their title. Measured on the
  // deck above before the fix: 19 of 54 pieces of content, 35%, never reached the file.
  //
  // Chart series live in ppt/charts/chart1.xml rather than in the slide, so both are read.
  const JSZip = require(path.resolve(HERE, '..', 'node_modules', 'jszip'));
  const zip = await JSZip.loadAsync(fs.readFileSync(OUT));
  let slideXml = '', chartXml = '', propsXml = '';
  for (const name of Object.keys(zip.files)) {
    if (/^ppt[/]slides[/]slide[0-9]+[.]xml$/.test(name))  slideXml += await zip.files[name].async('string');
    else if (/^ppt[/]charts[/].*[.]xml$/.test(name))      chartXml += await zip.files[name].async('string');
    else if (/^docProps[/]/.test(name))                   propsXml += await zip.files[name].async('string');
  }
  const all = slideXml + chartXml;
  const lost = built.markers.filter((m) => !all.includes(m));
  ok('every piece of content reached the file', lost.length === 0,
    `${lost.length} of ${built.markers.length} lost: ${lost.join(', ')}`);
  ok('...across all seventeen layouts', (slideXml.match(/<p:sld /g) || []).length === 17,
    `${(slideXml.match(/<p:sld /g) || []).length} slides`);
  ok('the chart is a real PowerPoint chart, not a picture of one', /barChart/.test(chartXml));

  // The long dash the user asked us to stop using — including the one the writer put in itself, in
  // front of every quote's attribution.
  ok('no em dash anywhere in the file', !all.includes('—'), `${(all.match(/—/g) || []).length} found`);
  ok('...but a numeric range kept its tight form', all.includes('2020-2024'));

  // Two clicks from the slide, in File → Info. Both of these used to announce the generator.
  ok('the file does not name the library that built it', !/pptxgen/i.test(propsXml));
  ok('...nor adris', !/adris/i.test(propsXml), propsXml.slice(0, 200));
  ok('...and it is authored by the person presenting it', /Amogh M/.test(propsXml));
  ok('the divider is numbered, not stamped "SECTION"', !/>SECTION</.test(slideXml));

  console.log('\n=== the chat deck and the PowerPoint show the same thing ===');
  //
  // "makesure the ppt designed in chat and when got to power point both are matching."
  //
  // They are two renderers of one spec, and they drift: last time, nine layouts had stopped
  // carrying their content into PowerPoint while the chat deck showed all of it, which is exactly
  // why the deck looked right and the file did not.
  const inChatOnly = built.chatMarkers.filter((m) => !all.includes(m));
  const inPptOnly = built.markers.filter((m) => all.includes(m) && !built.chatMarkers.includes(m));
  ok('nothing shows in the chat and goes missing in PowerPoint', inChatOnly.length === 0, inChatOnly.join(', '));
  ok('nothing appears in PowerPoint that the chat never showed', inPptOnly.length === 0, inPptOnly.join(', '));
  ok('and both render every layout in the spec',
    built.chatMarkers.length === built.markers.length && built.markers.every((m) => all.includes(m)),
    `chat ${built.chatMarkers.length} · pptx ${built.markers.filter((m) => all.includes(m)).length} · spec ${built.markers.length}`);

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
