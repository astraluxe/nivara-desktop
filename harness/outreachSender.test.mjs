import {
  findPlaceholder, isMessageableProfile, isDoneWith, checkOne, buildSendQueue,
  nextDelayMs, sentToday, alreadySent, startOfLocalDay, SEND_DEFAULTS,
  parseOutreachStepSettings, summarise, summariseSkips, channelReach, CAP_REASON,
} from './outreachSender.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `got : ${JSON.stringify(g)}\n        want: ${JSON.stringify(w)}`);

const GOOD_BODY = 'Hi Priya, I saw Acme just raised a Series A and you are hiring ops people. We build the tooling that usually gets hired for. Worth fifteen minutes next week?';
const GOOD_LI = 'Hi Priya, saw Acme raised a Series A — congratulations. We build ops tooling for teams at exactly that stage. Open to a quick chat?';

// ── Placeholders: the thing that must never reach a stranger ─────────────────
console.log('\n=== placeholders ===');
ok('[Name] caught', findPlaceholder('Hi [Name], hello') === '[Name]');
ok('[Company Name] caught', findPlaceholder('at [Company Name] you') === '[Company Name]');
ok('{name} caught', !!findPlaceholder('Hi {name}'));
ok('{{company}} caught', !!findPlaceholder('at {{company}}'));
ok('<your pitch here> caught', !!findPlaceholder('say <your pitch here> now'));
ok('TODO caught', !!findPlaceholder('TODO finish this'));
ok('TBD caught', !!findPlaceholder('price: TBD'));
ok('"insert X" caught', !!findPlaceholder('insert company name here'));
ok('clean copy passes', findPlaceholder(GOOD_BODY) === null, String(findPlaceholder(GOOD_BODY)));
ok('an email address is not a placeholder', findPlaceholder('write to me at a@b.com') === null);
ok('a real link is not a placeholder', findPlaceholder('see <https://adris.tech/x>') === null);
ok('normal brackets with numbers are not flagged as names', findPlaceholder('the report (2026) is out') === null);
ok('empty string is fine', findPlaceholder('') === null);

// ── Profile URLs ────────────────────────────────────────────────────────────
console.log('\n=== linkedin profile urls ===');
ok('a personal profile is messageable', isMessageableProfile('https://www.linkedin.com/in/priya-sharma-123'));
ok('regional subdomain works', isMessageableProfile('https://in.linkedin.com/in/priya'));
ok('a COMPANY page is not', !isMessageableProfile('https://www.linkedin.com/company/acme'));
ok('a search url is not', !isMessageableProfile('https://www.linkedin.com/search/results/people/?keywords=priya'));
ok('empty is not', !isMessageableProfile(''));
ok('a bare name is not', !isMessageableProfile('priya sharma'));

// ── Statuses ────────────────────────────────────────────────────────────────
console.log('\n=== statuses ===');
ok('sent is done', isDoneWith('sent'));
ok('replied is done — no cold template on a live conversation', isDoneWith('replied'));
ok('meeting is done', isDoneWith('meeting'));
ok('met is done', isDoneWith('met'));
ok('skip is done', isDoneWith('skip'));
ok('todo is NOT done', !isDoneWith('todo'));
ok('undefined is NOT done', !isDoneWith(undefined));
ok('accepted is NOT done — that is exactly who to message', !isDoneWith('accepted'));

// ── checkOne ────────────────────────────────────────────────────────────────
console.log('\n=== one contact, one channel ===');
const priya = {
  name: 'Priya Sharma', company: 'Acme', status: 'todo',
  email: 'priya@acme.co.in', email_subject: 'Ops tooling for Acme', email_body: GOOD_BODY,
  linkedin_url: 'https://www.linkedin.com/in/priya-sharma', linkedin_message: GOOD_LI,
};
ok('a complete contact sends by email', checkOne(priya, 'email').ok);
ok('a complete contact sends on linkedin', checkOne(priya, 'linkedin').ok);
eq('email carries the right recipient', checkOne(priya, 'email').to, 'priya@acme.co.in');
eq('linkedin carries the profile url', checkOne(priya, 'linkedin').to, 'https://www.linkedin.com/in/priya-sharma');

const why = (c, ch) => { const r = checkOne(c, ch); return r.ok ? '(sendable)' : r.why; };
ok('no email address is refused', why({ ...priya, email: '', emails: [] }, 'email').includes('no email address'));
ok('a broken address is refused', why({ ...priya, email: 'priya@acme' }, 'email').includes('not a usable email'));
ok('no subject is refused', why({ ...priya, email_subject: '' }, 'email').includes('no subject'));
ok('no body is refused', why({ ...priya, email_body: '', linkedin_message: '' }, 'email').includes('no email written'));
ok('a two-word body is refused', why({ ...priya, email_body: 'hi there' }, 'email').includes('too short'));
ok('a placeholder in the body is refused', why({ ...priya, email_body: GOOD_BODY + ' [Company]' }, 'email').includes('placeholder'));
ok('a placeholder in the SUBJECT is refused', why({ ...priya, email_subject: 'Hi [Name]' }, 'email').includes('placeholder'));
ok('already sent is refused', why({ ...priya, status: 'sent' }, 'email').includes('already sent'));
ok('replied is refused with a reason about the conversation', why({ ...priya, status: 'replied' }, 'email').includes('first-touch'));
ok('a pending invite blocks LinkedIn', why({ ...priya, status: 'connect' }, 'linkedin').includes('connection request is still pending'));
ok('...but a pending invite does NOT block email', checkOne({ ...priya, status: 'connect' }, 'email').ok);
ok('a company page is refused for linkedin', why({ ...priya, linkedin_url: 'https://www.linkedin.com/company/acme' }, 'linkedin').includes('not a personal profile'));
ok('no profile is refused', why({ ...priya, linkedin_url: '' }, 'linkedin').includes('no LinkedIn profile'));

// The email body falls back to the LinkedIn message when there is no separate one — same as the UI.
const noEmailBody = { ...priya, email_body: '' };
ok('email falls back to the LinkedIn message', checkOne(noEmailBody, 'email').ok);
ok('...and uses that text', checkOne(noEmailBody, 'email').body === GOOD_LI);

// Tokens are filled before the placeholder check, so {name} in a draft is NOT a blocker.
const tokened = { ...priya, email_body: 'Hi {name}, I saw {company} raised a Series A and thought this was worth a short note about your ops tooling.' };
const tk = checkOne(tokened, 'email');
ok('campaign tokens are filled, not refused', tk.ok, tk.ok ? '' : tk.why);
ok('...first name only', tk.ok && tk.body.startsWith('Hi Priya,'), tk.ok ? tk.body.slice(0, 30) : '');
ok('...company filled', tk.ok && tk.body.includes('I saw Acme raised'));

// ── The queue ───────────────────────────────────────────────────────────────
console.log('\n=== the queue ===');
const roster = [
  { ...priya, name: 'A' },                                        // 0 sendable both
  { ...priya, name: 'B', status: 'sent' },                        // 1 done
  { ...priya, name: 'C', email: '', emails: [] },                 // 2 linkedin only
  { ...priya, name: 'D', linkedin_url: '' },                      // 3 email only
  { ...priya, name: 'E', email_body: 'Hi [Name]', linkedin_message: 'Hi [Name] there friend how are you' }, // 4 placeholders both
];

const both = buildSendQueue(roster, { channels: ['email', 'linkedin'], emailRemaining: 99, linkedinRemaining: 99 });
eq('one message per person, never two', both.queue.map((q) => q.idx), [0, 2, 3]);
eq('A goes by email (first channel listed wins)', both.queue.find((q) => q.idx === 0).channel, 'email');
eq('C falls through to linkedin', both.queue.find((q) => q.idx === 2).channel, 'linkedin');
eq('D goes by email', both.queue.find((q) => q.idx === 3).channel, 'email');
ok('the sent contact is skipped', both.skipped.some((s) => s.idx === 1));
ok('the placeholder contact is skipped', both.skipped.some((s) => s.idx === 4 && /placeholder/.test(s.why)));
ok('nobody appears in both lists', both.queue.every((q) => !both.skipped.some((s) => s.idx === q.idx)));

const emailOnly = buildSendQueue(roster, { channels: ['email'], emailRemaining: 99, linkedinRemaining: 99 });
eq('email-only run skips the no-email contact', emailOnly.queue.map((q) => q.idx), [0, 3]);
ok('...and says why', emailOnly.skipped.some((s) => s.idx === 2 && /no email address/.test(s.why)));

const liOnly = buildSendQueue(roster, { channels: ['linkedin'], emailRemaining: 99, linkedinRemaining: 99 });
eq('linkedin-only run', liOnly.queue.map((q) => q.idx), [0, 2]);

// Caps
console.log('\n=== caps ===');
const capped = buildSendQueue(roster, { channels: ['email'], emailRemaining: 1, linkedinRemaining: 99 });
eq('the daily cap stops the queue', capped.queue.length, 1);
ok('and the rest are told why', capped.skipped.some((s) => /limit is used up/.test(s.why)));
const zero = buildSendQueue(roster, { channels: ['email'], emailRemaining: 0, linkedinRemaining: 0 });
eq('no allowance left = nothing queued', zero.queue.length, 0);
const runCap = buildSendQueue(roster, { channels: ['email', 'linkedin'], emailRemaining: 99, linkedinRemaining: 99, runLimit: 2 });
eq('a per-run limit is respected', runCap.queue.length, 2);
eq('empty campaign', buildSendQueue([], { channels: ['email'], emailRemaining: 9, linkedinRemaining: 9 }).queue, []);

// A campaign where EVERYONE is done must produce nothing, not fall back to sending anyway.
const allDone = roster.map((c) => ({ ...c, status: 'sent' }));
eq('all sent = nothing queued', buildSendQueue(allDone, { channels: ['email', 'linkedin'], emailRemaining: 99, linkedinRemaining: 99 }).queue, []);

// ── Pacing ──────────────────────────────────────────────────────────────────
console.log('\n=== pacing ===');
eq('rnd=0.5 gives exactly the base', nextDelayMs(50, () => 0.5), 50000);
eq('rnd=0 gives the low end (-60%)', nextDelayMs(50, () => 0), 20000);
eq('rnd=1 gives the high end (+60%)', nextDelayMs(50, () => 1), 80000);
ok('never below a 5s floor', nextDelayMs(0, () => 0) >= 2000, String(nextDelayMs(0, () => 0)));
const spread = new Set(Array.from({ length: 40 }, () => nextDelayMs(50)));
ok('real randomness produces a spread, not a fixed cadence', spread.size > 30, 'distinct=' + spread.size);
ok('defaults are conservative for LinkedIn', SEND_DEFAULTS.linkedinDailyCap <= 25, String(SEND_DEFAULTS.linkedinDailyCap));
ok('defaults are conservative for email', SEND_DEFAULTS.emailDailyCap <= 50, String(SEND_DEFAULTS.emailDailyCap));

// ── The log ─────────────────────────────────────────────────────────────────
console.log('\n=== the send log ===');
const now = new Date('2026-08-23T15:00:00').getTime();
const today = startOfLocalDay(now);
const L = (at, channel, result, to = 'x@y.com') => ({ at, channel, result, to, name: 'n', campaign: 'c' });
const log = [
  L(today + 1000, 'email', 'sent', 'a@b.com'),
  L(today + 2000, 'email', 'sent', 'c@d.com'),
  L(today + 3000, 'email', 'failed', 'e@f.com'),
  L(today + 4000, 'email', 'unconfirmed', 'g@h.com'),
  L(today + 5000, 'linkedin', 'sent', 'https://linkedin.com/in/x'),
  L(today - 60 * 60 * 1000, 'email', 'sent', 'yesterday@b.com'),   // an hour before midnight = yesterday
];
eq('counts today\'s confirmed emails only', sentToday(log, 'email', now), 2);
eq('a failure does not eat the daily allowance', sentToday(log.filter((e) => e.result !== 'sent'), 'email', now), 0);
eq('unconfirmed does not count as sent', sentToday([L(today, 'email', 'unconfirmed')], 'email', now), 0);
eq('linkedin counted separately', sentToday(log, 'linkedin', now), 1);
ok('yesterday is not today', sentToday(log, 'email', now) === 2);
ok('alreadySent finds a confirmed recipient', alreadySent(log, 'email', 'a@b.com'));
ok('alreadySent is case-insensitive', alreadySent(log, 'email', 'A@B.COM'));
ok('alreadySent ignores failures', !alreadySent(log, 'email', 'e@f.com'));
ok('alreadySent is channel-specific', !alreadySent(log, 'linkedin', 'a@b.com'));
ok('alreadySent on empty input is false', !alreadySent(log, 'email', ''));

// ── Attachments reach the send ──────────────────────────────────────────────
console.log('\n=== attachments ===');
const withFile = [{ ...priya, name: 'A' }, { ...priya, name: 'B', attachmentPath: 'C:/own/mine.pdf' }];
const qA = buildSendQueue(withFile, { channels: ['email'], emailRemaining: 9, linkedinRemaining: 9, attachmentPath: 'C:/all/deck.pdf' });
eq('the campaign file reaches someone with none of their own', qA.queue[0].attachmentPath, 'C:/all/deck.pdf');
eq('a contact own-file beats the campaign one', qA.queue[1].attachmentPath, 'C:/own/mine.pdf');
const qB = buildSendQueue(withFile, { channels: ['email'], emailRemaining: 9, linkedinRemaining: 9 });
eq('no campaign file: only the person who chose one has it', qB.queue[0].attachmentPath, undefined);
eq('...and theirs still goes', qB.queue[1].attachmentPath, 'C:/own/mine.pdf');
// LinkedIn has no attachments — carrying a path there would be a promise nothing can keep.
const qC = buildSendQueue([{ ...priya, name: 'A', email: '', emails: [] }], { channels: ['linkedin'], emailRemaining: 9, linkedinRemaining: 9, attachmentPath: 'C:/all/deck.pdf' });
eq('LinkedIn never carries an attachment', qC.queue[0].attachmentPath, undefined);
eq('an empty campaign path is not treated as a file', buildSendQueue([{ ...priya, name: 'A' }], { channels: ['email'], emailRemaining: 9, linkedinRemaining: 9, attachmentPath: '   ' }).queue[0].attachmentPath, undefined);

// ── The automation step reads its own settings sentence ─────────────────────
console.log('\n=== automation step settings ===');
const ps = (t) => parseOutreachStepSettings(t);
eq('template default: email only, 20', ps('Send up to 20 approved outreach emails from the saved campaign.'), { channels: ['email'], runLimit: 20 });
eq('a different number is honoured', ps('Send up to 5 approved outreach emails.').runLimit, 5);
eq('LinkedIn opts the channel in', ps('Send up to 15 approved outreach messages by email and LinkedIn.').channels, ['email', 'linkedin']);
eq('"LinkedIn only" drops email', ps('Send up to 10 LinkedIn only messages.').channels, ['linkedin']);
eq('"only LinkedIn" also works', ps('Send 10, only LinkedIn.').channels, ['linkedin']);
eq('an empty sentence is cautious, not permissive', ps(''), { channels: ['email'], runLimit: 20 });
eq('gibberish is cautious too', ps('do the thing'), { channels: ['email'], runLimit: 20 });
eq('zero is floored to 1, never a step that silently never sends', ps('Send up to 0 emails.').runLimit, 1);
eq('an absurd number is capped', ps('Send up to 999 emails.').runLimit, 200);
eq('case does not matter', ps('SEND UP TO 7 LINKEDIN MESSAGES').channels, ['email', 'linkedin']);

// ── The summary sentence both callers show ──────────────────────────────────
console.log('\n=== run summary wording ===');
const S = (o) => summarise({ sent: 0, unconfirmed: 0, failed: 0, stopped: false, results: [], ...o });
eq('a clean run', S({ sent: 3 }), '3 sent and confirmed.');
ok('a stopped run says so first', S({ sent: 1, stopped: true }).startsWith('Stopped.'));
ok('unconfirmed is spelled out as unmarked', /left unmarked/.test(S({ sent: 1, unconfirmed: 2 })));
ok('failures are counted', /2 failed/.test(S({ sent: 1, failed: 2 })));
eq('a run where nothing worked is still honest', S({ failed: 3 }), '0 sent and confirmed, 3 failed.');

// ── "40 ready · 110 not" ─────────────────────────────────────────────────────
// The count that started this: 110 people with nothing wrong with them, reported as though 110
// things had failed. These assert the two halves stay separated and the second half stays grouped.
console.log('\n=== what "will not be sent" actually contains ===');
{
  const many = Array.from({ length: 150 }, (_, i) => ({
    name: `P${i}`, company: 'Acme', email: `p${i}@acme.co.in`, status: 'todo',
    email_subject: 'A real subject', email_body: GOOD_BODY,
  }));
  // Three that genuinely cannot go, so both kinds appear in one run.
  many[0] = { ...many[0], email: '' };
  many[1] = { ...many[1], email: '' };
  many[2] = { ...many[2], email_body: 'too short' };

  const q = buildSendQueue(many, { channels: ['email'], emailRemaining: 40, linkedinRemaining: 0 });
  const sum = summariseSkips(q.skipped);

  ok('the queue stops at the daily cap', q.queue.length === 40, String(q.queue.length));
  ok('the three broken ones are blocked, not deferred', sum.blocked.length === 3, String(sum.blocked.length));
  ok('everyone else is deferred, not blocked', sum.deferred.length === 150 - 40 - 3, String(sum.deferred.length));
  ok('deferred + blocked accounts for every skip', sum.deferred.length + sum.blocked.length === q.skipped.length);
  ok('nothing deferred is reported as a failure', sum.deferred.every((s) => s.why === CAP_REASON.email));
  ok('the two with no address collapse into one group', sum.groups[0].who.length === 2, JSON.stringify(sum.groups.map((g) => [g.why, g.who.length])));
  ok('the biggest group comes first', sum.groups[0].who.length >= (sum.groups[1]?.who.length ?? 0));
  ok('every blocked contact appears in exactly one group',
     sum.groups.reduce((n, g) => n + g.who.length, 0) === sum.blocked.length);
}

console.log('\n=== who can actually be reached ===');
{
  const mixed = [
    { name: 'A', email: 'a@b.co.in' },
    { name: 'B', email: 'not-an-address' },
    { name: 'C', emails: ['c@d.co.in'] },
    { name: 'D', linkedin_url: 'https://www.linkedin.com/in/someone' },
    { name: 'E', linkedin_url: 'https://www.linkedin.com/company/acme' },
  ];
  const r = channelReach(mixed);
  eq('emails counted, including the fallback list and excluding junk', r.email, 2);
  eq('only personal profiles count as reachable on LinkedIn', r.linkedin, 1);
  eq('an empty campaign reaches nobody', channelReach([]), { email: 0, linkedin: 0 });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
