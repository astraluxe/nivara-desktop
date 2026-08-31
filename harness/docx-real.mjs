// ─── A REAL .docx, read by the shipped code ──────────────────────────────────
//
// docImages.test.mjs asserts the judgement — which pictures are worth placing. This asserts the
// part that judgement is worthless without: that a genuine Word file actually gives up its text and
// its pictures. It builds one (three images, one of them an icon), then reads it back through
// `readDocx` running in a real browser, because measuring a picture needs `Image()`.
//
// Run: node harness/docx-real.mjs   (after: vite build --config vite.visual.config.ts)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist-visual');
if (!fs.existsSync(path.join(DIST, 'visual.html'))) {
  console.error('no dist-visual — run: npx vite build --config vite.visual.config.ts --outDir dist-visual');
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

// ── A minimal, valid PNG, hand-rolled so the test needs no encoder ───────────
const CRC = [...Array(256)].map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(w, h, r, g, b) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const JSZip = (await import(pathToFileURL(path.join(ROOT, 'node_modules/jszip/lib/index.js')).href)).default;
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
zip.file('word/document.xml',
  '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'
  + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Blood supply of the periodontium</w:t></w:r></w:p>'
  + '<w:p><w:r><w:t>The gingiva receives its supply from three &amp; only three sources.</w:t></w:r></w:p>'
  + '</w:body></w:document>');
zip.file('word/media/image1.png', png(300, 200, 200, 40, 40));    // a real figure
zip.file('word/media/image2.png', png(20, 20, 0, 0, 255));        // an icon — must be dropped
zip.file('word/media/image10.png', png(400, 300, 40, 160, 40));   // must sort AFTER image2
const docx = await zip.generateAsync({ type: 'nodebuffer' });

const server = http.createServer((req, res) => {
  if (req.url === '/sample.docx') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(docx); return;
  }
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/visual.html';
  const f = path.join(DIST, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ct = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html';
  res.writeHead(200, { 'content-type': ct });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5331, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5331/visual.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__docImages, null, { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const m = window.__docImages;
    const bytes = new Uint8Array(await (await fetch('/sample.docx')).arrayBuffer());
    const { text, images } = await m.readDocx(bytes, 'sample.docx');
    const kept = m.tidy(images);
    return {
      text,
      all: images.map((i) => `${i.width}x${i.height}`),
      kept: kept.map((i) => `${i.width}x${i.height}`),
      firstIsPng: kept[0]?.dataUri.startsWith('data:image/png;base64,'),
      order: kept.map((i) => i.index),
    };
  });

  console.log('\n=== the words come out ===');
  ok('the heading is there', out.text.includes('Blood supply of the periodontium'), out.text.slice(0, 80));
  ok('the body paragraph is there', out.text.includes('three sources'));
  // A .docx used to be read with readAsText, which on a zip returns mojibake.
  ok('it is real text, not zip mojibake', !/PK\x03\x04/.test(out.text) && out.text.length < 500);
  ok('paragraphs are separated, not run together',
    out.text.split('\n').filter(Boolean).length >= 2, JSON.stringify(out.text));
  ok('XML entities are decoded', out.text.includes('three & only three'));
  ok('formatting properties are gone', !out.text.includes('w:jc') && !out.text.includes('val='));

  console.log('\n=== the pictures come out ===');
  ok('all three images are found', out.all.length === 3, out.all.join(' '));
  ok('the icon is dropped', !out.kept.includes('20x20'), out.kept.join(' '));
  ok('both real figures are kept', out.kept.length === 2, out.kept.join(' '));
  ok('they are usable data URIs', out.firstIsPng === true);
  // image10 must come after image2 — a plain string sort puts "10" first.
  ok('kept in document order', out.order[0] < out.order[1], JSON.stringify(out.order));
  ok('the 300x200 figure is first', out.kept[0] === '300x200', out.kept.join(' '));

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
