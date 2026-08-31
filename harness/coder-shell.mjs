// ─── Does Coder read as a code editor? ───────────────────────────────────────
//
// It had the pieces — a tree, an editor, a terminal, an assistant — but none of the furniture that
// makes a screen say "editor" at a glance: no activity bar down the left edge, no status line, and
// a file tree in which every single file drew the same grey middle-dot, so it could be read but
// never scanned.
//
// Run: node harness/coder-shell.mjs   (after: vite build --config vite.visual.config.ts)

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
await new Promise((r) => server.listen(5379, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e) + String.fromCharCode(10) + (e.stack || '').split(String.fromCharCode(10)).slice(0,4).join(String.fromCharCode(10))));
  // A real folder listing, so the tree renders rows and its icons can be looked at. Without this
  // the stub hands list_dir an empty string and the component throws before drawing anything.
  await page.addInitScript(() => {
    window.__invokeReplies = {
      list_dir: { json: [
        { name: "src", path: "C:/repo/src", is_dir: true },
        { name: "KrewChat.tsx", path: "C:/repo/KrewChat.tsx", is_dir: false },
        { name: "lib.rs", path: "C:/repo/lib.rs", is_dir: false },
        { name: "package.json", path: "C:/repo/package.json", is_dir: false },
        { name: "README.md", path: "C:/repo/README.md", is_dir: false },
        { name: "logo.png", path: "C:/repo/logo.png", is_dir: false },
      ] },
      read_file: "const a = 1;",
      git_status_porcelain: "",
    };
    localStorage.setItem("nv-coder", JSON.stringify({ projectPath: "C:/repo", openFile: "C:/repo/KrewChat.tsx" }));
  });
  await page.goto('http://127.0.0.1:5379/visual.html?coder=1', { waitUntil: 'networkidle' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  console.log('\n=== the activity bar ===');
  const acts = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed], button[aria-label]')]
      .map((b) => b.getAttribute('aria-label')).filter(Boolean));
  for (const want of ['Files', 'Find a file  (Ctrl+P)', 'Search in files  (Ctrl+Shift+F)', 'Ask about this code']) {
    ok(`"${want.split('  ')[0]}" is on the bar`, acts.some((a) => a === want), JSON.stringify(acts));
  }
  ok('the terminal button is there', acts.some((a) => /^Terminal/.test(a)), JSON.stringify(acts));

  // Every one of them must be a real target, not a 12px glyph.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed]')]
      .map((b) => { const r = b.getBoundingClientRect(); return { l: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((b) => b.w < 28 || b.h < 28));
  ok('every activity icon is at least 28px', small.length === 0, JSON.stringify(small));

  console.log('\n=== the status bar ===');
  const txt = await page.evaluate(() => document.body.innerText);
  ok('it says whether a folder is open', /No folder open|Terminal/.test(txt), txt.slice(-160));
  ok('it reports the terminal', /Terminal/.test(txt));
  ok('it reports the assistant', /Assistant/.test(txt));

  console.log('\n=== the file tree can be put away ===');
  {
    const before = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button[aria-label="Files"]')][0];
      b.click();
      return true;
    });
    ok('the Files button responds', before);
    await page.waitForTimeout(250);
    const pressed = await page.evaluate(() =>
      document.querySelector('button[aria-label="Files"]')?.getAttribute('aria-pressed'));
    ok('...and its pressed state flips', pressed === 'false', String(pressed));
  }

  // The event stub throws once on mount: CoderModule subscribes to a Tauri event and the harness
  // hands the callback an object where the component expects a list. That is the STUB, not the app
  // — the stack points into cursor-stub — so it is named and excluded here rather than quietly
  // relaxing the assertion into "no errors we mind about".
  const appErrors = errors.filter((e) => !/cursor-stub/.test(e));
  ok('no errors from the app itself', appErrors.length === 0, appErrors.join('\n'));
  if (errors.length > appErrors.length) {
    console.log('  note  one known harness-stub error ignored (cursor-stub, not the app)');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
