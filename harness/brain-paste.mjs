// ─── Pasting Markdown into a real Brain note ─────────────────────────────────
//
// markdownPaste.test.mjs asserts the DECISION. This asserts the thing that decision exists for:
// that pasting Markdown into the actual note editor produces a rendered note rather than its
// source, and that pasting ordinary prose still produces exactly what was typed.
//
// It drives the shipped BrainModule with a real ClipboardEvent, because the bug was never in the
// renderer — it was that nothing invoked it on paste.
//
// Run: node harness/brain-paste.mjs   (after: vite build --config vite.visual.config.ts)

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
await new Promise((r) => server.listen(5360, r));

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
const { chromium } = require(PW);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });

/** Fire a real paste at the note editor and hand back what the note became. */
const paste = (plain, html = '') => async (page) => page.evaluate(([p, h]) => {
  const ed = document.querySelector('[data-placeholder][contenteditable]');
  if (!ed) return { error: 'no editor' };
  ed.focus();
  ed.innerHTML = '';
  const dt = new DataTransfer();
  dt.setData('text/plain', p);
  if (h) dt.setData('text/html', h);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ed.dispatchEvent(ev);
  // A SYNTHETIC paste does not trigger the browser's own insert — only a real one does. So for the
  // "leave it alone" cases there is nothing to look for in the DOM, and the thing that actually
  // matters is whether the handler CANCELLED the event. Cancelled means we took over and rendered
  // it; not cancelled means we stood aside and the browser will paste it verbatim.
  return { html: ed.innerHTML, text: ed.innerText, handled: ev.defaultPrevented };
}, [plain, html]);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://127.0.0.1:5360/visual.html?brain=1', { waitUntil: 'networkidle' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // Open a note so the editor exists.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /new note|add note|\+/i.test(b.textContent || '') || b.title === 'New note');
    if (btn) btn.click();
    return true;
  });
  await page.waitForTimeout(600);
  const haveEditor = await page.evaluate(() => !!document.querySelector('[data-placeholder][contenteditable]'));
  ok('a note editor is open', haveEditor, opened ? 'clicked new-note' : 'no button found');
  if (!haveEditor) throw new Error('no editor to paste into');

  console.log('\n=== Markdown becomes a readable note ===');
  {
    const table = '| Name | Role |\n| --- | --- |\n| Priya | Founder |\n| Rahul | CTO |';
    const r = await paste(table)(page);
    ok('a table renders as a table', /<table/i.test(r.html), r.html.slice(0, 120));
    // The whole point: the pipes must be GONE from what the user sees.
    ok('...and the pipes are gone from the page', !r.text.includes('| Name |'), JSON.stringify(r.text.slice(0, 60)));
    ok('...with the data intact', r.text.includes('Priya') && r.text.includes('Founder'));
    ok('...and the paste was taken over deliberately', r.handled === true);
  }
  {
    const doc = '## Blood supply\n\nThe gingiva has **three** sources.\n\n- gingival\n- periodontal\n- alveolar';
    const r = await paste(doc)(page);
    ok('a heading renders as a heading', /<h[1-6]/i.test(r.html), r.html.slice(0, 100));
    ok('bullets render as a list', /<ul|<li/i.test(r.html));
    ok('bold renders as bold', /<(strong|b)\b/i.test(r.html));
    ok('no markdown syntax is left on screen',
      !r.text.includes('##') && !r.text.includes('**') , JSON.stringify(r.text.slice(0, 80)));
  }

  console.log('\n=== but prose is left exactly as written ===');
  {
    // The important half. Rewriting what someone typed is worse than the bug this fixes.
    const prose = 'Had a chance to see Adris today - the local-first workflow is well thought out.';
    const r = await paste(prose)(page);
    ok('a plain paragraph is NOT intercepted', r.handled === false);
    ok('...so nothing was rendered over it', !/<ul|<li|<h[1-6]|<table/i.test(r.html), r.html.slice(0, 100));
  }
  {
    const rich = '<p>Copied from <strong>a web page</strong></p>';
    const r = await paste('Copied from a web page', rich)(page);
    // Rich HTML is already structured. Re-parsing it as Markdown would escape its tags into
    // visible text — a bug this codebase has had before — so we must not intercept it.
    ok('rich HTML is NOT intercepted', r.handled === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await browser.close();
  server.close();
}
process.exit(fail ? 1 : 0);
