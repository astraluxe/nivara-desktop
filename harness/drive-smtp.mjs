// The mailbox setup, driven in a real browser.
//
// Written after the first real person to use it pasted their webmail URL into the username box and
// got "…is not an email address — nothing was sent." The error was right; the form was what led
// them there. Every case below is either that mistake, or the thing that should mean nobody has to
// fill the form in at all.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PW = process.env.NV_PLAYWRIGHT
  || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
if (!fs.existsSync(PW)) { console.error('playwright-core not found — skipping'); process.exit(0); }
const pw = (await import(pathToFileURL(PW).href)).default;
const { chromium } = pw;
const CHROME = [
  process.env.NV_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found — skipping'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-harness');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/harness.html';
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(5197, r));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 520, height: 1800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text()); });

  const boot = async (replies) => {
    await page.goto('http://localhost:5197/?campaign=sendable', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    await page.evaluate((r) => { window.__invokeReplies = r; }, replies);
    // Open Send from → Details so the mailbox panel is on screen.
    await page.locator('select').first().selectOption('gmail');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /^Details$/ }).click();
    await page.waitForTimeout(300);
  };
  const body = () => page.evaluate(() => document.body.innerText);
  const setup = () => page.evaluate(() => JSON.parse(localStorage.getItem('nv-mail-setup') || '{}'));
  const emailBox = () => page.locator('input[placeholder="you@yourcompany.com"]');
  const pwBox = () => page.locator('input[type="password"]');

  const HOSTINGER = JSON.stringify({
    email: 'amogh@adris.tech', domain: 'adris.tech', mx: ['mx1.hostinger.com'],
    detected: 'Hostinger',
    candidates: [{ host: 'smtp.hostinger.com', port: 465, implicitTls: true, provider: 'Hostinger', note: 'Use the mailbox address and password from hPanel.', source: "your domain's mail is handled by mx1.hostinger.com" }],
  });

  console.log('\n=== 1. Every field has a label that does not vanish ===');
  await boot({ smtp_discover: HOSTINGER, smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'x' }) });
  let txt = await body();
  ok('the mailbox section is on screen', /Send automatically/.test(txt), txt.slice(0, 400));
  ok('the email field is labelled', /Your work email/.test(txt));
  ok('the password field is labelled', /Password for that mailbox/.test(txt));
  ok('server settings are hidden behind a disclosure', /Server settings/.test(txt));
  ok('port and TLS are NOT in the user\'s face', !/STARTTLS/.test(txt), txt.slice(0, 600));
  // The webmail-link field only exists for the "other webmail" provider — which is the exact
  // screen the mistake happened on, so check it there rather than on Gmail's.
  await page.locator('select').first().selectOption('custom');
  await page.waitForTimeout(300);
  const customTxt = await body();
  ok('the webmail link field no longer says "address"', !/The address you open your mail at/.test(customTxt));
  ok('...it says link instead', /Link to your webmail page/.test(customTxt), customTxt.slice(0, 700));
  ok('both boxes are on screen together, and read differently',
    /Link to your webmail page/.test(customTxt) && /Your work email/.test(customTxt));
  await page.locator('select').first().selectOption('gmail');
  await page.waitForTimeout(250);

  // The label must survive typing — that is the whole bug.
  await emailBox().fill('amogh@adris.tech');
  await page.waitForTimeout(200);
  ok('the label is still there after typing', /Your work email/.test(await body()));

  console.log('\n=== 2. The exact mistake, caught as you type ===');
  await emailBox().fill('https://mail.hostinger.com/mailboxes/INBOX.Scheduled');
  await page.waitForTimeout(300);
  txt = await body();
  ok('a pasted URL is flagged immediately', /That is a web address/.test(txt), txt.slice(0, 800));
  ok('and it says what the box actually wants', /you@yourcompany\.com/.test(txt));
  const btn = page.getByRole('button', { name: /^Set it up for me$/ });
  ok('the setup button is disabled for a URL', await btn.isDisabled());

  await emailBox().fill('not-an-email');
  await page.waitForTimeout(250);
  ok('plain nonsense is flagged too', /does not look like an email/.test(await body()));

  await emailBox().fill('amogh@adris.tech');
  await page.waitForTimeout(250);
  txt = await body();
  ok('a real address clears the warning', !/That is a web address|does not look like an email/.test(txt));
  ok('and enables the button', await btn.isEnabled());

  console.log('\n=== 3. It refuses to start without a password ===');
  await btn.click();
  await page.waitForTimeout(500);
  ok('asks for the password rather than failing at the server', /Enter the password for that mailbox/.test(await body()));
  ok('nothing was sent', (await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length)) === 0);

  console.log('\n=== 4. Two fields is the whole setup ===');
  await pwBox().fill('my-app-password');
  await btn.click();
  for (let i = 0; i < 40; i++) { txt = await body(); if (/Set up and working|Couldn/.test(txt)) break; await page.waitForTimeout(300); }
  ok('it succeeds', /Set up and working/.test(txt), txt.slice(0, 700));
  ok('it names what it detected', /Hostinger/.test(txt), (txt.match(/✓[^\n]*/) || [])[0]);
  ok('it names the server it used', /smtp\.hostinger\.com/.test(txt));

  const disc = await page.evaluate(() => (window.__calls || []).find((c) => c.cmd === 'smtp_discover'));
  ok('discovery was asked about the right address', disc?.args?.email === 'amogh@adris.tech', JSON.stringify(disc?.args));
  const sent = await page.evaluate(() => (window.__calls || []).find((c) => c.cmd === 'smtp_send_email'));
  ok('the test used the DETECTED host, not a stale one', sent?.args?.host === 'smtp.hostinger.com', String(sent?.args?.host));
  ok('...the detected port', sent?.args?.port === 465, String(sent?.args?.port));
  ok('...and the user as both sender and recipient', sent?.args?.to === 'amogh@adris.tech' && sent?.args?.username === 'amogh@adris.tech', JSON.stringify([sent?.args?.to, sent?.args?.username]));

  let st = await setup();
  ok('the settings were saved', st.smtp?.host === 'smtp.hostinger.com', JSON.stringify(st.smtp));
  ok('and marked verified only after a real send', !!st.smtp?.verifiedAt);
  ok('the password is NOT in localStorage', !JSON.stringify(st).includes('my-app-password'), JSON.stringify(st).slice(0, 200));
  ok('the password went to the keychain', (await page.evaluate(() => (window.__calls || []).some((c) => c.cmd === 'store_credential'))));
  ok('server settings collapse again once it works', !/STARTTLS/.test(await body()));

  console.log('\n=== 5. A refused password explains itself and opens the settings ===');
  await boot({ smtp_discover: HOSTINGER, smtp_send_email: { error: '535 authentication failed' }, get_credential: JSON.stringify({ api_key: 'x' }) });
  await emailBox().fill('amogh@adris.tech');
  await pwBox().fill('wrong');
  await page.getByRole('button', { name: /^Set it up for me$/ }).click();
  for (let i = 0; i < 40; i++) { txt = await body(); if (/Couldn/.test(txt)) break; await page.waitForTimeout(300); }
  ok('it says which server it tried', /Couldn't send through smtp\.hostinger\.com/.test(txt), txt.slice(0, 600));
  ok('it distinguishes a refused sign-in from an unreachable server', /refused the sign-in/.test(txt));
  ok('it names the actual fix — an app password', /APP PASSWORD/.test(txt));
  ok('it passes on the provider\'s own note', /hPanel/.test(txt), txt.slice(0, 900));
  ok('the settings open automatically on failure', /STARTTLS/.test(txt));
  st = await setup();
  ok('a failed test does NOT mark the mailbox verified', !st.smtp?.verifiedAt, JSON.stringify(st.smtp));

  console.log('\n=== 6. An unreachable server gets a different explanation ===');
  await boot({ smtp_discover: HOSTINGER, smtp_send_email: { error: 'Could not reach smtp.hostinger.com: connection timed out' }, get_credential: JSON.stringify({ api_key: 'x' }) });
  await emailBox().fill('amogh@adris.tech');
  await pwBox().fill('pw');
  await page.getByRole('button', { name: /^Set it up for me$/ }).click();
  for (let i = 0; i < 40; i++) { txt = await body(); if (/Couldn/.test(txt)) break; await page.waitForTimeout(300); }
  ok('it does not blame the password', !/APP PASSWORD/.test(txt), txt.slice(0, 500));
  ok('it suggests the other port', /try the other port/.test(txt));

  console.log('\n=== 7. When nothing can be looked up, it says so honestly ===');
  await boot({ smtp_discover: { error: 'no network' }, get_credential: JSON.stringify({ api_key: 'x' }) });
  await emailBox().fill('amogh@somewhere-unknown.co.in');
  await pwBox().fill('pw');
  await page.getByRole('button', { name: /^Set it up for me$/ }).click();
  for (let i = 0; i < 40; i++) { txt = await body(); if (/could not work out/i.test(txt)) break; await page.waitForTimeout(300); }
  ok('it admits it could not work it out', /could not work out who runs your email/i.test(txt), txt.slice(0, 600));
  ok('it points at the provider\'s own help wording', /SMTP settings/.test(txt));
  ok('and opens the manual settings', /STARTTLS/.test(await body()));
  ok('nothing was sent on a failed lookup', (await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length)) === 0);

  console.log('\n=== 8. A hand-typed server beats detection ===');
  await boot({ smtp_discover: HOSTINGER, smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'x' }) });
  await emailBox().fill('amogh@adris.tech');
  await pwBox().fill('pw');
  await page.getByRole('button', { name: /Server settings/ }).click();
  await page.waitForTimeout(250);
  await page.locator('input[placeholder="smtp.yourprovider.com"]').fill('smtp.titan.email');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Set it up for me$/ }).click();
  for (let i = 0; i < 40; i++) { txt = await body(); if (/Set up and working|Couldn/.test(txt)) break; await page.waitForTimeout(300); }
  const sent2 = await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').pop());
  ok('what the user typed is what gets used', sent2?.args?.host === 'smtp.titan.email', String(sent2?.args?.host));

  console.log('\n=== errors ===');
  ok('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  fail++; console.log('  FAIL harness threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
