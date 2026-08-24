// Drives the REAL outreach copilot through a real automatic send run, in a real browser, with the
// Tauri commands stubbed so nothing leaves the machine.
//
// The paths worth proving here are the ones a live test could never produce on demand: an SMTP
// server that refuses one message in the middle of a run, a LinkedIn send that cannot be confirmed,
// a Stop pressed while the run is waiting. Those decide whether a real person gets marked as
// contacted when they were not — which is the one mistake in this feature that cannot be walked
// back.
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
await new Promise((r) => server.listen(5198, r));

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

let browser;
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 520, height: 1600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push('console: ' + m.text()); });

  const boot = async (setup) => {
    await page.goto('http://localhost:5198/?campaign=sendable', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(300);
    await page.evaluate((s) => {
      localStorage.clear();
      // A mailbox that has already been set up and tested, so the run is not blocked on setup.
      localStorage.setItem('nv-mail-setup', JSON.stringify({
        provider: 'custom', label: 'Work mail', webmailUrl: 'https://mail.example.com/',
        smtp: { host: 'smtp.titan.email', port: 465, username: 'me@mycompany.in', implicitTls: true, fromName: 'Me', verifiedAt: Date.now() },
      }));
      // 5s base gap so a multi-send run finishes inside a test.
      localStorage.setItem('nv-send-pace', '5');
      Object.assign(window, s);
    }, setup);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.evaluate((s) => Object.assign(window, s), setup);
    await page.waitForTimeout(500);
  };

  const body = () => page.evaluate(() => document.body.innerText);
  const contacts = () => page.evaluate(() => JSON.parse(localStorage.getItem('nv-outreach-v1') || '{}').contacts || []);
  const log = () => page.evaluate(() => JSON.parse(localStorage.getItem('nv-outreach-sendlog') || '[]'));
  const openPanel = async () => {
    const t = page.getByRole('button', { name: /Send these for me/ });
    await t.click();
    await page.waitForTimeout(300);
  };

  console.log('\n=== 1. The panel states the real queue, before anything is sent ===');
  await boot({ __invokeReplies: { smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'app-password' }) } });
  let txt = await body();
  ok('the send panel is on screen', /Send these for me/.test(txt), txt.slice(0, 300));
  // 3 sendable + 1 placeholder + 1 already sent
  ok('counts 3 ready', /3 ready/.test(txt), (txt.match(/\d+ ready[^\n]*/) || [])[0]);
  ok('counts 2 that will not go', /2 not/.test(txt), (txt.match(/\d+ not/) || [])[0]);
  await openPanel();
  txt = await body();
  ok('it lists why they will not go', /will NOT be sent/.test(txt));
  await page.getByText(/will NOT be sent/).click();
  await page.waitForTimeout(250);
  txt = await body();
  ok('the placeholder contact is named with its reason', /Placeholder Person — still has a placeholder/.test(txt), (txt.match(/Placeholder[^\n]*/) || [])[0]);
  ok('the already-sent contact is named', /Already Sent — already sent/.test(txt), (txt.match(/Already Sent[^\n]*/) || [])[0]);
  ok('the sending mailbox is stated up front', /me@mycompany\.in/.test(txt), (txt.match(/Emails go from[^\n]*/) || [])[0]);

  console.log('\n=== 2. It asks once more, naming the number and the mailbox ===');
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(300);
  txt = await body();
  ok('the confirmation names the count', /really sends 3 messages/.test(txt.replace(/\s+/g, ' ')), txt.slice(0, 400));
  ok('the confirmation names the mailbox', /from me@mycompany\.in/.test(txt.replace(/\s+/g, ' ')));
  ok('it says it cannot be undone', /cannot be undone/.test(txt));
  ok('nothing has been sent yet', (await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length)) === 0);

  console.log('\n=== 3. Cancel really cancels ===');
  await page.getByRole('button', { name: /^Cancel$/ }).click();
  await page.waitForTimeout(250);
  ok('still nothing sent after Cancel', (await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length)) === 0);
  ok('no contact was marked sent', (await contacts()).filter((c) => c.status === 'sent').length === 1);

  console.log('\n=== 4. A real run: all three accepted ===');
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Yes — send 3$/ }).click();
  await page.waitForTimeout(1500);
  txt = await body();
  ok('it names the person it is working on, live',
    /Sending \d of 3 — (Aisha Khan|Rohit Nair|Meera Iyer) by email|\d of 3 done · waiting \d+s before (Rohit Nair|Meera Iyer)/.test(txt.replace(/\s+/g, ' ')),
    txt.slice(0, 400));
  ok('it reports how many are done, not just where it is',
    /\d of 3 done|Sending \d of 3/.test(txt.replace(/\s+/g, ' ')), txt.slice(0, 300));
  // Wait out the run (3 sends, 2 gaps of ~2-8s each).
  for (let i = 0; i < 60; i++) {
    txt = await body();
    if (/sent and confirmed/.test(txt)) break;
    await page.waitForTimeout(1000);
  }
  ok('the run finishes and reports', /3 sent and confirmed/.test(txt), (txt.match(/\d+ sent and confirmed[^\n]*/) || [])[0]);

  let cs = await contacts();
  ok('Aisha marked sent', cs[0].status === 'sent', cs[0].status);
  ok('Rohit marked sent', cs[1].status === 'sent', cs[1].status);
  ok('Meera marked sent', cs[2].status === 'sent', cs[2].status);
  ok('the placeholder contact was NOT touched', cs[3].status === 'todo', cs[3].status);

  const calls = await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email'));
  ok('exactly three sends happened', calls.length === 3, 'n=' + calls.length);
  ok('each went to the right address', calls.map((c) => c.args.to).join(',') === 'aisha@acme.co.in,rohit@beta.in,meera@gamma.in', calls.map((c) => c.args.to).join(','));
  ok('sent from the configured work mailbox', calls.every((c) => c.args.username === 'me@mycompany.in'));
  ok('using the configured server and port', calls[0].args.host === 'smtp.titan.email' && calls[0].args.port === 465);
  ok('the real subject went, not a placeholder', calls[0].args.subject === 'Ops tooling for Acme', calls[0].args.subject);
  ok('the real body went', /Worth fifteen minutes/.test(calls[0].args.body));
  ok('the password came from the keychain, not from the page', calls[0].args.password === 'app-password', String(calls[0].args.password));
  ok('the keychain was actually asked', (await page.evaluate(() => (window.__calls || []).some((c) => c.cmd === 'get_credential'))));

  const lg = await log();
  ok('every send is in the log', lg.length === 3, 'n=' + lg.length);
  ok('all recorded as confirmed sent', lg.every((e) => e.result === 'sent'));
  ok('the log records the campaign', lg[0].campaign === 'Sendable campaign', lg[0].campaign);

  console.log('\n=== 5. The daily counter moves, and the queue empties ===');
  txt = await body();
  ok('today\'s email count is now 3', /today: 3\/\d+ email/.test(txt.replace(/\s+/g, ' ')), (txt.match(/today:[^\n]*/) || [])[0]);
  ok('nothing is left ready', /0 ready/.test(txt) || !/\d ready/.test(txt), (txt.match(/\d+ ready/) || [])[0]);

  console.log('\n=== 6. A refusal mid-run must not mark anyone sent ===');
  await boot({ __invokeReplies: { smtp_send_email: [{ error: '535 authentication failed' }], get_credential: JSON.stringify({ api_key: 'app-password' }) } });
  await openPanel();
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Yes — send 3$/ }).click();
  for (let i = 0; i < 60; i++) {
    txt = await body();
    if (/failed\./.test(txt)) break;
    await page.waitForTimeout(1000);
  }
  ok('it reports the failures honestly', /0 sent and confirmed.*3 failed/.test(txt.replace(/\s+/g, ' ')), (txt.match(/\d+ sent and confirmed[^\n]*/) || [])[0]);
  cs = await contacts();
  ok('NOBODY was marked sent on a failed run', cs.filter((c) => c.status === 'sent').length === 1, JSON.stringify(cs.map((c) => c.status)));
  ok('the failure reason is shown per person', /authentication failed/.test(txt), txt.slice(-400));
  const lg2 = await log();
  ok('failures are logged as failed', lg2.every((e) => e.result === 'failed'), JSON.stringify(lg2.map((e) => e.result)));
  ok('a failed send does NOT consume the daily allowance', /today: 0\//.test((await body()).replace(/\s+/g, ' ')), ((await body()).match(/today:[^\n]*/) || [])[0]);

  console.log('\n=== 7. An UNCONFIRMED send is not recorded as sent ===');
  await boot({ __invokeReplies: { smtp_send_email: 'ACCEPTED_MAYBE', get_credential: JSON.stringify({ api_key: 'app-password' }) } });
  await openPanel();
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Yes — send 3$/ }).click();
  for (let i = 0; i < 60; i++) {
    txt = await body();
    if (/unconfirmed/.test(txt)) break;
    await page.waitForTimeout(1000);
  }
  ok('it says they are unconfirmed', /unconfirmed \(left unmarked/.test(txt.replace(/\s+/g, ' ')), (txt.match(/\d+ sent and confirmed[^\n]*/) || [])[0]);
  cs = await contacts();
  ok('an unconfirmed send leaves the contact unmarked', cs.filter((c) => c.status === 'sent').length === 1, JSON.stringify(cs.map((c) => c.status)));
  const lg3 = await log();
  ok('logged as unconfirmed, not sent', lg3.every((e) => e.result === 'unconfirmed'), JSON.stringify(lg3.map((e) => e.result)));

  console.log('\n=== 8. Stop halts the run and keeps what already went ===');
  await boot({ __invokeReplies: { smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'app-password' }) } });
  await openPanel();
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Yes — send 3$/ }).click();
  // Let the first one go, then stop during the gap.
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /^Stop$/ }).click();
  await page.waitForTimeout(1500);
  txt = await body();
  ok('it says it stopped', /Stopped\./.test(txt), (txt.match(/Stopped[^\n]*/) || [])[0]);
  const stopCalls = await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length);
  ok('it did not send the whole list', stopCalls < 3, 'n=' + stopCalls);
  cs = await contacts();
  ok('what did send is still marked sent', cs.filter((c) => c.status === 'sent').length === 1 + stopCalls, JSON.stringify(cs.map((c) => c.status)));

  console.log('\n=== 9. Without a tested mailbox it refuses to start ===');
  await page.goto('http://localhost:5198/?campaign=sendable', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('nv-mail-setup', JSON.stringify({ provider: 'gmail' }));
    localStorage.setItem('nv-send-pace', '5');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__invokeReplies = { smtp_send_email: 'SMTP_SENT 250' }; });
  await openPanel();
  txt = await body();
  ok('it says the mailbox is not set up', /Automatic sending needs your mailbox/.test(txt), txt.slice(0, 500));
  ok('and offers to set it up', /Set my mailbox up/.test(txt));
  await page.getByRole('button', { name: /^Send 3 now$/ }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Yes — send 3$/ }).click();
  await page.waitForTimeout(900);
  ok('nothing was sent without a tested mailbox', (await page.evaluate(() => (window.__calls || []).filter((c) => c.cmd === 'smtp_send_email').length)) === 0);

  console.log('\n=== 10. LinkedIn goes through the browser, not SMTP ===');
  await page.goto('http://localhost:5198/?campaign=sendable', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    const c = JSON.parse(localStorage.getItem('x') || 'null');
    localStorage.setItem('nv-send-pace', '5');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => { window.__invokeReplies = { run_browser_persistent: 'MESSAGE_SENT — confirmed in the conversation thread.' }; });
  await openPanel();
  // Switch to LinkedIn only.
  await page.getByRole('button', { name: /^Email$/ }).click();
  await page.getByRole('button', { name: /^LinkedIn$/ }).click();
  await page.waitForTimeout(300);
  txt = await body();
  ok('LinkedIn shows the terms warning', /terms forbid automated messaging/.test(txt), txt.slice(0, 400));
  ok('nobody is LinkedIn-sendable without a profile url', /0 ready/.test(txt) || !/\d+ ready/.test(txt.split('Send these for me')[1] || ''), (txt.match(/\d+ ready/) || [])[0]);

  console.log('\n=== 11. One click, no dialog, once you have said so ===');
  await boot({ __invokeReplies: { smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'app-password' }) } });
  await openPanel();
  txt = await body();
  ok('the skip-confirm choice is offered', /don't ask me to confirm each time/.test(txt), txt.slice(0, 600));
  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(300);
  txt = await body();
  ok('the button now says it goes straight away', /Goes straight away/.test(txt), txt.slice(0, 500));

  await page.getByRole('button', { name: /Send 3 now/ }).click();
  await page.waitForTimeout(1400);
  txt = await body();
  ok('NO confirmation step appeared', !/Yes — send 3|cannot be undone/.test(txt), txt.slice(0, 400));
  ok('it began sending on that one click', /Sending \d of 3|\d of 3 done/.test(txt.replace(/\s+/g, ' ')), txt.slice(0, 400));
  ok('the running tally is shown', /\d+ sent/.test(txt), txt.slice(0, 500));
  for (let i = 0; i < 60; i++) { txt = await body(); if (/sent and confirmed/.test(txt)) break; await page.waitForTimeout(1000); }
  ok('the whole run completed from one click', /3 sent and confirmed/.test(txt), (txt.match(/\d+ sent and confirmed[^\n]*/) || [])[0]);
  cs = await contacts();
  ok('statuses updated for everyone sent', cs.filter((c) => c.status === 'sent').length === 4, JSON.stringify(cs.map((c) => c.status)));
  ok('the unfinished draft was STILL skipped', cs[3].status === 'todo', cs[3].status);

  console.log('\n=== 12. The choice is remembered ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__invokeReplies = { smtp_send_email: 'SMTP_SENT 250', get_credential: JSON.stringify({ api_key: 'x' }) }; });
  await openPanel();
  ok('still set after a reload', /Goes straight away/.test(await body()));

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
