import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// playwright-core ships with the agent browser, not with this app, so it is loaded from wherever
// that toolchain was installed rather than from node_modules.
const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
if (!fs.existsSync(PW)) {
  console.error('playwright-core not found at ' + PW + ' — set NV_PLAYWRIGHT to its index.js. Skipping the browser suite.');
  process.exit(0);
}
const pw = (await import(pathToFileURL(PW).href)).default;
const { chromium } = pw;

// Chrome, wherever this machine keeps it.
const CHROME = [
  process.env.NV_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found — set NV_CHROME. Skipping the browser suite.'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-harness');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/harness.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5199, r));

let pass = 0, fail = 0;
const L = [];
const log = (s) => { L.push(s); console.log(s); };
const ok = (n, c, x = '') => { if (c) { pass++; log('  ok   ' + n); } else { fail++; log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 520, height: 1400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const body = () => page.evaluate(() => document.body.innerText);
  const drafts = () => page.evaluate(() => JSON.parse(localStorage.getItem('nv-outreach-v1') || '{}').contacts || []);

  log('\n=== 1. It renders, and the email fields are really editable ===');
  ok('panel mounted', (await body()).length > 100);
  ok('no page errors on mount', errors.length === 0, errors.join(' | '));

  let emailTa = null;
  for (const t of await page.locator('textarea').all()) {
    if ((await t.inputValue()) === 'B0') emailTa = t;
  }
  ok('email body textarea found, prefilled with the draft', !!emailTa);

  await emailTa.fill('B0 EDITED BY HAND');
  await page.waitForTimeout(350);
  let d = await drafts();
  ok('typing in the email body persists to the campaign', d[0].email_body === 'B0 EDITED BY HAND', JSON.stringify(d[0]));

  let subjTa = null;
  for (const t of await page.locator('input').all()) {
    const v = await t.inputValue().catch(() => '');
    if (v === 'S0') subjTa = t;
  }
  ok('subject input found, prefilled', !!subjTa);
  await subjTa.fill('S0 EDITED');
  await page.waitForTimeout(350);
  d = await drafts();
  ok('typing in the subject persists', d[0].email_subject === 'S0 EDITED', JSON.stringify(d[0]));

  log('\n=== 2. "Improve with AI" rewrites THIS email only ===');
  const shorter = page.getByRole('button', { name: 'Shorter' });
  ok('both the LinkedIn and the email refine rows render', await shorter.count() === 2, 'n=' + await shorter.count());
  ok('the LinkedIn chip is disabled (no LinkedIn message on this fixture)', await shorter.nth(0).isDisabled());
  ok('the EMAIL chip is enabled', await shorter.nth(1).isEnabled());
  const emailShorter = shorter.nth(1);
  await emailShorter.click();
  await page.waitForTimeout(1000);
  d = await drafts();
  ok('current email rewritten', String(d[0].email_body).startsWith('NEW BODY for Priya Sharma'), d[0].email_body);
  ok('subject rewritten too', d[0].email_subject === 'NEW SUBJECT for Priya Sharma', d[0].email_subject);
  ok('OTHER contacts untouched by a single rewrite', d[1].email_body === 'B1' && d[3].email_body === 'B3', JSON.stringify([d[1].email_body, d[3].email_body]));
  const prompts = await page.evaluate(() => window.__ai || []);
  ok('the AI was asked exactly once', prompts.length === 1, 'n=' + prompts.length);
  ok('the prompt carried the email shape instruction', /This is an EMAIL/.test(prompts[0] || ''));
  ok('the prompt carried the current draft', /B0 EDITED BY HAND/.test(prompts[0] || ''));

  log('\n=== 3. Undo puts the single rewrite back ===');
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await page.waitForTimeout(350);
  d = await drafts();
  ok('undo restores body', d[0].email_body === 'B0 EDITED BY HAND', d[0].email_body);
  ok('undo restores subject', d[0].email_subject === 'S0 EDITED', d[0].email_subject);

  log('\n=== 4. Apply to the others: scope, progress, and who is spared ===');
  await emailShorter.click();
  await page.waitForTimeout(1000);
  let txt = await body();
  ok('bulk panel opened itself after a rewrite', /will change/.test(txt), txt.slice(0, 500));
  ok('it offers to repeat the same change', /Make the same change I just made to Priya/.test(txt));
  ok('default scope counts only untouched others (Rahul)', /1 will change/.test(txt), (txt.match(/\d+ will change/) || [])[0]);

  await page.getByRole('button', { name: 'Everyone (except already sent)' }).click();
  await page.waitForTimeout(250);
  txt = await body();
  ok('"everyone" scope counts Rahul + Replied, not Sent and not the draftless one', /2 will change/.test(txt), (txt.match(/\d+ will change/) || [])[0]);

  const before = await drafts();
  await page.getByRole('button', { name: /Make the same change I just made/ }).click();
  await page.waitForTimeout(3000);
  d = await drafts();
  ok('Rahul rewritten', String(d[1].email_body).startsWith('NEW BODY for Rahul Verma'), d[1].email_body);
  ok('Replied Person rewritten', String(d[3].email_body).startsWith('NEW BODY for Replied Person'), d[3].email_body);
  ok('SENT person never touched', d[2].email_body === 'B2', d[2].email_body);
  ok('draftless contact never given an invented email', !d[4].email_body, JSON.stringify(d[4]));
  ok('person on screen not rewritten a second time', d[0].email_body === before[0].email_body, d[0].email_body);
  txt = await body();
  ok('it reports how many changed', /2 drafts updated/.test(txt), txt.slice(0, 400));

  const prompts2 = await page.evaluate(() => window.__ai || []);
  ok('bulk sent one prompt per person, not one big batch', prompts2.length === 4, 'n=' + prompts2.length);
  ok('the worked example was included', /SAME CHANGE I ALREADY MADE/.test(prompts2[prompts2.length - 1] || ''));

  log('\n=== 5. Undo all ===');
  await page.getByRole('button', { name: 'Undo all' }).click();
  await page.waitForTimeout(450);
  d = await drafts();
  ok('Rahul restored', d[1].email_body === 'B1', d[1].email_body);
  ok('Replied Person restored', d[3].email_body === 'B3', d[3].email_body);

  log('\n=== 6. Send from: the provider really changes where Compose goes ===');
  txt = await body();
  ok('Send from picker is on screen', /Send from/.test(txt));
  ok('default button says Gmail', /Open in Gmail/.test(txt), (txt.match(/Open in [^\n]*/) || [])[0]);

  const sel = page.locator('select').first();
  await sel.selectOption('outlook365');
  await page.waitForTimeout(300);
  txt = await body();
  ok('button now names Outlook, not Gmail', /Open in Outlook/.test(txt) && !/Open in Gmail/.test(txt), txt.slice(0,200));

  await page.evaluate(() => { window.__opened = []; });
  await page.getByRole('button', { name: /Open in Outlook/ }).click();
  await page.waitForTimeout(450);
  let opened = await page.evaluate(() => window.__opened || []);
  ok('clicking Compose opened an Outlook deeplink', /outlook\.office\.com\/mail\/deeplink\/compose/.test(opened[0] || ''), opened[0]);
  ok('addressed to the right person', decodeURIComponent(opened[0] || '').includes('priya@acme.co.in'), opened[0]);
  ok('carrying the CURRENT edited draft', decodeURIComponent(opened[0] || '').includes('NEW BODY for Priya'), String(opened[0]).slice(0, 200));

  log('\n=== 7. An unknown provider ASKS instead of guessing ===');
  await sel.selectOption('custom');
  await page.waitForTimeout(400);
  txt = await body();
  ok('setup panel opens itself', /What is it called/.test(txt), txt.slice(0, 400));
  ok('button refuses to pretend', /Tell me where your webmail is first/.test(txt), (txt.match(/Tell me[^\n]*/) || [])[0]);

  await page.evaluate(() => { window.__opened = []; });
  await page.locator('input[placeholder*="Hostinger / Titan, Zoho"]').fill('Hostinger / Titan');
  await page.locator('input[placeholder="https://hostinger.titan.email/"]').fill('https://hostinger.titan.email/');
  await page.waitForTimeout(450);
  txt = await body();
  ok('button now offers to open it and copy the draft', /Open Hostinger \/ Titan & copy the draft/.test(txt), (txt.match(/Open [^\n]*/) || [])[0]);

  await page.getByRole('button', { name: /Open Hostinger \/ Titan & copy the draft/ }).click();
  await page.waitForTimeout(600);
  opened = await page.evaluate(() => window.__opened || []);
  ok('it opened the webmail the user gave, not a guessed URL', opened[0] === 'https://hostinger.titan.email/', opened[0]);
  txt = await body();
  ok('and says plainly the draft must be pasted', /paste it/i.test(txt), (txt.match(/Hostinger[^\n]*/g) || []).join(' | ').slice(0, 300));

  log('\n=== 8. A compose template the user supplies is used verbatim ===');
  const tplSel = 'input[placeholder="Leave blank if you don' + String.fromCharCode(39) + 't know it"]';
  await page.locator(tplSel).fill('https://mail.mycorp.in/?_task=mail&_action=compose&_to={to}&_subject={subject}&_message={body}');
  await page.waitForTimeout(450);
  await page.evaluate(() => { window.__opened = []; });
  txt = await body();
  ok('button switches to a real compose', /Open in Hostinger \/ Titan/.test(txt), (txt.match(/Open [^\n]*/) || [])[0]);
  await page.getByRole('button', { name: /Open in Hostinger \/ Titan/ }).click();
  await page.waitForTimeout(450);
  opened = await page.evaluate(() => window.__opened || []);
  ok('the user template is used', String(opened[0] || '').startsWith('https://mail.mycorp.in/?_task=mail'), opened[0]);
  ok('tokens filled, none left raw', !/\{to\}|\{body\}/.test(opened[0] || ''), opened[0]);
  ok('recipient encoded into it', String(opened[0] || '').includes('_to=priya%40acme.co.in'), opened[0]);

  log('\n=== 9. The choice survives a reload ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  txt = await body();
  ok('provider remembered after reload', /Open in Hostinger \/ Titan/.test(txt), (txt.match(/Open [^\n]*/) || [])[0]);

  log('\n=== 10. A model that fails does not destroy the drafts ===');
  await page.evaluate(() => { window.__aiFail = true; });
  const beforeFail = await drafts();
  await emailShorter.click();
  await page.waitForTimeout(900);
  d = await drafts();
  ok('a thrown model error leaves the draft alone', d[0].email_body === beforeFail[0].email_body, d[0].email_body);
  txt = await body();
  ok('and it says so', /Couldn.t rewrite/.test(txt), (txt.match(/Couldn.t[^\n]*/) || [])[0]);

  await page.evaluate(() => { window.__aiFail = false; window.__aiEmpty = true; });
  await emailShorter.click();
  await page.waitForTimeout(900);
  d = await drafts();
  ok('an empty model reply leaves the draft alone', d[0].email_body === beforeFail[0].email_body, d[0].email_body);
  txt = await body();
  ok('and says the AI gave nothing back', /same email \(or nothing\)/.test(txt), (txt.match(/The AI[^\n]*/) || [])[0]);

  log('\n=== errors seen during the whole run ===');
  ok('no uncaught page errors at all', errors.length === 0, errors.slice(0, 3).join(' | '));

} catch (e) {
  fail++; log('  FAIL harness threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

log('\n' + pass + ' passed, ' + fail + ' failed');
fs.writeFileSync(path.join(process.env.TEMP || '.', 'drive.log'), L.join('\n'));
process.exit(fail ? 1 : 0);
