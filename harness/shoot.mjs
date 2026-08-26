// Screenshots the visual page in Playwright's own Chrome with a throwaway profile.
// It never attaches to, and never closes, the browser the user is working in.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
if (!fs.existsSync(PW)) { console.error('no playwright-core at ' + PW); process.exit(2); }
const { chromium } = (await import(pathToFileURL(PW).href)).default;

const CHROME = [process.env.NV_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) { console.error('no chrome'); process.exit(2); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-visual');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/visual.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5198, r));

const out = process.argv[2] || '.';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const pages = process.argv[3] === 'cursor'
    ? [['cursor', '']]
    : [['dark', ''], ['light', '?paper=1']];
  for (const [name, q] of pages) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
    const file = name === 'cursor' ? '/visual-cursor.html' : '/visual.html';
    await page.goto('http://127.0.0.1:5198' + file + q, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const dest = path.join(out, `visual-${name}.png`);
    await page.screenshot({ path: dest });
    console.log('wrote ' + dest);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
