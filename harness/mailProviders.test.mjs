import { composeTarget, fillTemplate, mailtoUrl, mailDestinationName, mailSetupIncomplete, MAIL_PROVIDERS, COMPOSE_PRESETS } from './mailProviders.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const eq = (name, got, want) => ok(name, got === want, `\n    got : ${got}\n    want: ${want}`);

const F = { to: 'priya@acme.co.in', subject: 'Quick question, Priya', body: 'Hi Priya,\n\nSaw the Series A — 15 mins?\n\nAmogh' };

// Every provider must produce a URL that a browser can actually open, and must not lose the body.
for (const p of MAIL_PROVIDERS) {
  if (p.id === 'custom') continue;
  const t = composeTarget({ provider: p.id }, F);
  ok(`${p.id}: has a url`, !!t.url);
  ok(`${p.id}: url parses`, (() => { try { new URL(t.url); return true; } catch { return false; } })(), t.url);
  ok(`${p.id}: recipient survives`, decodeURIComponent(t.url).includes('priya@acme.co.in'), t.url);
  ok(`${p.id}: subject survives`, decodeURIComponent(t.url).includes('Quick question, Priya'), t.url);
  ok(`${p.id}: body survives incl. newlines`, decodeURIComponent(t.url).includes('Saw the Series A'), t.url);
  ok(`${p.id}: no raw spaces or newlines left in url`, !/[ \n]/.test(t.url), t.url);
}

// Only Gmail claims it can attach — everything else must say so rather than imply it.
eq('gmail canAttach', composeTarget({ provider: 'gmail' }, F).canAttach, true);
eq('outlook365 canAttach', composeTarget({ provider: 'outlook365' }, F).canAttach, false);
eq('mailto canAttach', composeTarget({ provider: 'mailto' }, F).canAttach, false);

// mailto keeps the @ readable (encoded @ breaks some Windows handlers) and encodes the rest.
const m = mailtoUrl(F);
ok('mailto keeps a literal @', m.startsWith('mailto:priya@acme.co.in?'), m);
ok('mailto encodes newlines', m.includes('%0A'), m);
ok('mailto encodes the subject comma', m.includes('subject=Quick%20question%2C%20Priya'), m);
eq('mailto with no subject/body has no ?', mailtoUrl({ to: 'a@b.com' }), 'mailto:a@b.com');

// Ampersands in a subject must not split the query string — the classic silent truncation.
const amp = composeTarget({ provider: 'gmail' }, { to: 'x@y.com', subject: 'Ops & Finance', body: 'a&b=c' });
ok('gmail escapes & in subject', amp.url.includes('su=Ops%20%26%20Finance'), amp.url);
ok('gmail escapes & in body', amp.url.includes('body=a%26b%3Dc'), amp.url);
const ampM = mailtoUrl({ to: 'x@y.com', subject: 'Ops & Finance', body: 'a&b' });
ok('mailto escapes & too', ampM.includes('%26') && ampM.split('&').length === 2, ampM);
ok('mailto: only real separators are bare &', ampM === 'mailto:x@y.com?subject=Ops%20%26%20Finance&body=a%26b', ampM);

// ── Custom: the three states ────────────────────────────────────────────────
const noSetup = composeTarget({ provider: 'custom' }, F);
eq('custom with nothing → unset', noSetup.prefill, 'unset');
eq('custom with nothing → no url', noSetup.url, '');
ok('custom with nothing → tells the user to set it up', /Set up|where your webmail is/i.test(noSetup.note), noSetup.note);
eq('mailSetupIncomplete flags it', mailSetupIncomplete({ provider: 'custom' }), true);

const webOnly = composeTarget({ provider: 'custom', webmailUrl: 'https://hostinger.titan.email/', label: 'Hostinger / Titan' }, F);
eq('webmail-only → prefill none (never claims a fill)', webOnly.prefill, 'none');
eq('webmail-only → copies the draft', webOnly.copyDraft, true);
eq('webmail-only → opens the webmail', webOnly.url, 'https://hostinger.titan.email/');
ok('webmail-only → says plainly it cannot fill it in', /can't fill it in/i.test(webOnly.note), webOnly.note);
ok('webmail-only → names the recipient to type', webOnly.note.includes('priya@acme.co.in'), webOnly.note);
eq('mailSetupIncomplete false once a url is given', mailSetupIncomplete({ provider: 'custom', webmailUrl: 'x' }), false);

const tpl = composeTarget({
  provider: 'custom', label: 'Company mail',
  composeTemplate: 'https://mail.mycorp.in/?_task=mail&_action=compose&_to={to}&_subject={subject}&_message={body}',
}, F);
eq('template → full prefill', tpl.prefill, 'full');
eq('template → no clipboard fallback', tpl.copyDraft, false);
ok('template → tokens substituted', !/\{to\}|\{subject\}|\{body\}/.test(tpl.url), tpl.url);
ok('template → values encoded', tpl.url.includes('_to=priya%40acme.co.in'), tpl.url);
ok('template → body encoded, no raw newline', tpl.url.includes('%0A') && !/\n/.test(tpl.url), tpl.url);

// Case-insensitive tokens, and a missing token is simply not substituted (not left as "undefined").
eq('uppercase tokens work', fillTemplate('u?to={TO}&s={Subject}', { to: 'a@b.c', subject: 'hi' }), 'u?to=a%40b.c&s=hi');
eq('absent value becomes empty, never "undefined"', fillTemplate('u?s={subject}', { to: 'a@b.c' }), 'u?s=');
ok('cc token supported', fillTemplate('u?c={cc}', { to: 'a@b.c', cc: 'x@y.z' }).endsWith('x%40y.z'));

// A template that injects nothing weird: quotes/spaces in the body cannot break out of the URL.
const nasty = fillTemplate('https://h/?b={body}', { to: 'a@b.c', body: 'He said "hi" & left\nBye' });
ok('quotes/newlines/& in body are all encoded', !/["\n&]/.test(nasty.replace(/\?b=/, '')), nasty);

// Labels
eq('label for gmail', mailDestinationName({ provider: 'gmail' }), 'Gmail');
eq('label for custom uses the user name', mailDestinationName({ provider: 'custom', label: 'Hostinger / Titan' }), 'Hostinger / Titan');
eq('label for custom without a name', mailDestinationName({ provider: 'custom' }), 'your webmail');

// Presets are shapes, not guesses at a host.
ok('presets keep the host as the user\'s to fill', COMPOSE_PRESETS.filter(p => p.template).every(p => p.template.includes('your-webmail-host')));
ok('there is an honest "I don\'t know" preset', COMPOSE_PRESETS.some(p => p.template === ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
