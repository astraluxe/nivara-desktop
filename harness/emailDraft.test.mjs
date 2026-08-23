import { parseEmailRewrite, bulkEmailTargets } from './emailDraft.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x); } };
const eq = (n, g, w) => ok(n, JSON.stringify(g) === JSON.stringify(w), `\n    got : ${JSON.stringify(g)}\n    want: ${JSON.stringify(w)}`);

const OLD = 'Following up on our chat';

// ── The happy shape ─────────────────────────────────────────────────────────
eq('normal rewrite splits cleanly',
  parseEmailRewrite('Subject: 15 minutes on your ops stack?\n\nHi Priya,\n\nSaw the raise. Worth 15 minutes?\n\nAmogh', OLD),
  { subject: '15 minutes on your ops stack?', body: 'Hi Priya,\n\nSaw the raise. Worth 15 minutes?\n\nAmogh' });

eq('lowercase "subject:" works',
  parseEmailRewrite('subject: hello\n\nbody here', OLD).subject, 'hello');
eq('extra spaces around the colon',
  parseEmailRewrite('Subject   :   hello\n\nbody', OLD).subject, 'hello');
eq('single newline after subject still splits',
  parseEmailRewrite('Subject: hi\nbody line', OLD), { subject: 'hi', body: 'body line' });

// ── The ways it goes wrong, and the draft must survive each one ─────────────
eq('no subject line → old subject kept, whole thing is the body',
  parseEmailRewrite('Hi Priya,\n\nJust the body.', OLD),
  { subject: OLD, body: 'Hi Priya,\n\nJust the body.' });
eq('"Subject:" with nothing after it → old subject kept',
  parseEmailRewrite('Subject:\n\nHi Priya,\n\nBody.', OLD).subject, OLD);
eq('subject but NO body → empty body so the caller can refuse it',
  parseEmailRewrite('Subject: a new subject', OLD).body, '');
eq('empty model reply → empty body, subject untouched',
  parseEmailRewrite('', OLD), { subject: OLD, body: '' });
eq('whitespace-only reply',
  parseEmailRewrite('   \n\n  ', OLD), { subject: OLD, body: '' });
eq('leading blank line before the subject',
  parseEmailRewrite('\n\nSubject: hi\n\nbody', OLD), { subject: 'hi', body: 'body' });
eq('a stray code fence first',
  parseEmailRewrite('```\nSubject: hi\n\nbody', OLD), { subject: 'hi', body: 'body' });
eq('"Subject:" appearing LATER in the body is not treated as the subject',
  parseEmailRewrite('Hi Priya,\n\nSubject: this is a quote from their email\n\nBye', OLD).subject, OLD);
ok('subject-later keeps the whole text as body',
  parseEmailRewrite('Hi Priya,\n\nSubject: quoted\n\nBye', OLD).body.includes('Subject: quoted'));

// A body containing a colon-heavy line must not be mangled.
eq('colons inside the body are left alone',
  parseEmailRewrite('Subject: hi\n\nAgenda:\n- pricing: 3 tiers\n- timeline: 2 weeks', OLD).body,
  'Agenda:\n- pricing: 3 tiers\n- timeline: 2 weeks');

// ── Who a bulk change hits ──────────────────────────────────────────────────
const C = (status, body) => ({ status, email_body: body });
const list = [
  C('todo', 'a'),        // 0
  C(undefined, 'b'),     // 1  (no status = untouched)
  C('sent', 'c'),        // 2  already gone
  C('replied', 'd'),     // 3  touched, but not sent
  C('todo', ''),         // 4  NO DRAFT
  C('todo', 'e'),        // 5  <- pretend this is the one on screen
  { status: 'todo', linkedin_message: 'f' },   // 6  body falls back to the LinkedIn message
  { status: 'todo', email_subject: 'g' },      // 7  subject only still counts as a draft
];

eq('untouched scope', bulkEmailTargets(list, 5, 'untouched'), [0, 1, 6, 7]);
eq('all scope (keeps replied, drops sent)', bulkEmailTargets(list, 5, 'all'), [0, 1, 3, 6, 7]);
ok('never includes the person on screen', !bulkEmailTargets(list, 0, 'all').includes(0));
ok('never includes a SENT contact', !bulkEmailTargets(list, 5, 'all').includes(2));
ok('never includes a contact with no draft', !bulkEmailTargets(list, 5, 'all').includes(4));

eq('picked scope honours the ticks', bulkEmailTargets(list, 5, 'picked', [1, 3]), [1, 3]);
eq('picked scope still refuses SENT', bulkEmailTargets(list, 5, 'picked', [1, 2, 3]), [1, 3]);
eq('picked scope still refuses a draftless row', bulkEmailTargets(list, 5, 'picked', [1, 4]), [1]);
eq('picked scope drops the person on screen', bulkEmailTargets(list, 5, 'picked', [5, 1]), [1]);
eq('picked scope runs in list order, not tick order', bulkEmailTargets(list, 5, 'picked', [7, 0, 3]), [0, 3, 7]);
eq('picked scope ignores out-of-range indexes', bulkEmailTargets(list, 5, 'picked', [1, 99, -1]), [1]);
eq('nothing picked = nothing changes', bulkEmailTargets(list, 5, 'picked', []), []);
eq('empty campaign', bulkEmailTargets([], 0, 'all'), []);
eq('one-contact campaign has nobody else to change', bulkEmailTargets([C('todo', 'x')], 0, 'all'), []);

// Everyone sent = nothing to do (rather than silently rewriting history).
const allSent = [C('sent', 'a'), C('sent', 'b'), C('sent', 'c')];
eq('all sent → no targets', bulkEmailTargets(allSent, 0, 'all'), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
