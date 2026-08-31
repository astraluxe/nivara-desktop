// ─── "the img. which are attached or taken are used directly there" ──────────
//
// A user attached a .docx with five figures in it and asked for a presentation. The figures are
// pulled out of the document and placed on slides — but the .pptx writer only ever drew a picture
// on two of the six layouts the placer targets. So the same deck had the figures in chat and lost
// them the moment it opened in PowerPoint, with nothing said.
//
// Arguing about which branch draws what is how that survived. This builds a REAL .pptx through the
// shipped renderer, unzips it, and looks for the picture inside — the only evidence that counts.
//
// Run: node harness/deck-images.mjs   (after: vite build --config vite.visual.config.ts)

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
await new Promise((r) => server.listen(5364, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

// A real 2×2 PNG. Small, but a genuine image the writer has to encode and embed.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQI12P8//8/AzbAxIAHDDNJAB2wAhkBFsn0AAAAAElFTkSuQmCC';

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5364/visual.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__deck && window.__JSZip, null, { timeout: 20000 });

  /** Build a one-slide deck on `layout`, write the .pptx, and report what is inside it. */
  const build = (layout, withImage) => page.evaluate(async ([layout, withImage, png]) => {
    const spec = {
      title: 'Quarterly review',
      font: { heading: 'Georgia', body: 'Arial' },
      palette: { bg: '#ffffff', surface: '#f4f4f5', text: '#111111', muted: '#666666', accent: '#7c3aed' },
      slides: [{
        layout,
        title: 'Findings',
        subtitle: 'Q3',
        body: 'A short paragraph of body text.',
        bullets: ['One point', 'Another point'],
        quote: 'A quotation.',
        attribution: 'Someone',
        stat: '42%',
        statLabel: 'growth',
        columns: [{ heading: 'Left', bullets: ['a'] }, { heading: 'Right', bullets: ['b'] }],
        ...(withImage ? { imageData: png } : {}),
      }],
    };
    const blob = await window.__deck.deckToPptxBlob(spec);
    const zip = await window.__JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    // The zip lists the FOLDER too. Counting it as a picture made the positive cases pass on a
    // file with no image in it at all, so the name has to have something after the slash.
    const media = names.filter((n) => /^ppt\/media\/.+/.test(n));
    const slideXml = await (zip.file('ppt/slides/slide1.xml') || { async: async () => '' }).async('string');
    return { size: blob.size, media, drawsPicture: /<a:blip/.test(slideXml) };
  }, [layout, withImage, PNG]);

  console.log('\n=== every layout the placer targets carries its picture into PowerPoint ===');
  const shown = await page.evaluate(() => window.__deck.LAYOUTS_WITH_IMAGE);
  ok('the renderer publishes the list of layouts that show a picture', Array.isArray(shown) && shown.length > 0, JSON.stringify(shown));

  for (const layout of shown) {
    const r = await build(layout, true);
    ok(`${layout}: the picture is embedded in the file`, r.media.length >= 1, JSON.stringify(r));
    ok(`${layout}: ...and slide 1 actually draws it`, r.drawsPicture, JSON.stringify(r));
  }

  console.log('\n=== a layout with no picture is still a valid deck ===');
  {
    // The other half: no image must not mean a broken file or an empty grey box.
    for (const layout of ['title', 'bullets', 'image-full', 'quote', 'stat', 'two-column']) {
      const r = await build(layout, false);
      ok(`${layout}: writes a file with no picture in it`, r.size > 0 && r.media.length === 0, JSON.stringify(r));
    }
  }

  console.log('\n=== a slide the placer must never target ===');
  {
    // two-column was on the placer's friendly list while neither renderer drew a picture there, so
    // a figure sent to one disappeared. It must stay off the list.
    ok('two-column is not offered as a place to put a picture',
      !shown.includes('two-column'), JSON.stringify(shown));
  }

  ok('no page errors while writing decks', errors.length === 0, errors.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
