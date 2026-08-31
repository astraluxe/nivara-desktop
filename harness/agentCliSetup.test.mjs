// ─── Reading what the CLI says about being signed in ─────────────────────────
//
// WHY THIS MATTERS MORE THAN IT LOOKS. Claude Code prefers ANTHROPIC_API_KEY over the user's own
// login whenever both are present. So a bridge can be installed, signed in, answering questions —
// and billing per token instead of using the subscription the whole feature exists to use. Nothing
// asked before. `authMethod` is the field that tells them apart, and these are the shapes it comes
// in, taken from the real CLI (2.1.247) rather than imagined.

import {
  parseAuthStatus, mergeAuth, subscriptionVerdict, daysUntilExpiry,
  rollUpDaily, totalUsage, todayUsage, formatTokens, prettyModel,
  usageWindow, untilReset, FIVE_HOURS, ONE_WEEK,
} from './agentCli.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== Claude Code, real output ===');
{
  // Captured verbatim from `claude auth status --json` on a signed-in machine.
  const real = JSON.stringify({
    loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
    analyticsDisabled: false, email: 'someone@example.com',
    orgId: 'ad4e9aa1', orgName: "someone@example.com's Organization", subscriptionType: 'pro',
  });
  const a = parseAuthStatus('claude_code', real);
  ok('signed in is read as signed in', a.state === 'signed_in');
  ok('the account is named', a.email === 'someone@example.com');
  ok('the plan is named', a.plan === 'pro');
  ok('and it is on the SUBSCRIPTION, which is the point', a.subscription === true);
}
{
  const a = parseAuthStatus('claude_code', JSON.stringify({ loggedIn: false }));
  ok('signed out is read as signed out', a.state === 'signed_out');
  ok('...and is not mistaken for an error', a.state !== 'unknown');
}
{
  // The case the whole warning exists for: working, but metered.
  const a = parseAuthStatus('claude_code', JSON.stringify({
    loggedIn: true, authMethod: 'apiKey', email: 'x@y.com',
  }));
  ok('an API key still counts as signed in', a.state === 'signed_in');
  ok('...but is flagged as NOT the subscription', a.subscription === false);
}

console.log('\n=== Codex, and anything that is not JSON ===');
{
  const a = parseAuthStatus('codex', 'Not logged in. Run `codex login` to sign in.');
  ok('a plain "not logged in" is read as signed out', a.state === 'signed_out');
}
{
  const a = parseAuthStatus('codex', 'Logged in as person@example.com');
  ok('a plain "logged in" is read as signed in', a.state === 'signed_in');
  ok('...and the address is picked out', a.email === 'person@example.com');
}
{
  ok('nothing at all is "unknown", never "signed in"', parseAuthStatus('codex', '').state === 'unknown');
  ok('whitespace only is also unknown', parseAuthStatus('claude_code', '   \n ').state === 'unknown');
}
{
  // A GARBLED ANSWER MUST NOT READ AS SUCCESS. Defaulting to signed-in on unrecognised output is how
  // the user gets sent to a chat that fails on its first message with a CLI error.
  const a = parseAuthStatus('claude_code', '{"loggedIn":');
  ok('broken JSON does not claim the user is signed in', a.state !== 'signed_in');
}

// ─── The money question: subscription or metered API key ─────────────────────
//
// Two signals are combined — what the CLI says about itself, and what its own credential file says.
// One is not enough, because being wrong costs the user real money (claude-code#43333: `claude -p`
// reported billing as API usage despite an OAuth login; one user, $1,800+ in two days).

console.log('\n=== the credential file, measured shape ===');
{
  // Exactly the shape read off a real machine: ~/.claude/.credentials.json
  const file = {
    found: true, oauth: true, subscriptionType: 'pro',
    expiresAt: 1787863295654, refreshTokenExpiresAt: 1789292097654,
    rateLimitTier: 'default_claude_pro', scopeCount: 5,
  };
  const a = mergeAuth({ state: 'signed_in', subscription: true, email: 'x@y.com' }, file);
  ok('both sources agreeing is marked as such', a.source === 'both');
  ok('the plan survives', a.plan === 'pro');
  ok('expiry is carried through for the warning', a.refreshExpiresAt === 1789292097654);

  // The CLI could not be asked — a rename, a timeout, a locked-down machine. Its own file still
  // proves the user is signed in on a subscription, and that must not read as "signed out".
  const b = mergeAuth({ state: 'unknown' }, file);
  ok('the file alone can establish signed-in', b.state === 'signed_in');
  ok('...and that it is a subscription', b.subscription === true);
  ok('...and says the evidence came from the file', b.source === 'file');
}
{
  const a = mergeAuth({ state: 'signed_in', subscription: true }, { found: false, reason: 'no credential file' });
  ok('a missing file does not undo what the CLI said', a.subscription === true);
  ok('...and is reported as CLI-only evidence', a.source === 'cli');
}
{
  // Codex's metered path is the one case where the file alone is decisive.
  const a = mergeAuth({ state: 'signed_in' }, { found: true, oauth: false, apiKeyPresent: true });
  ok('an API key in the file overrides everything', a.subscription === false);
}

console.log('\n=== the verdict, and what it allows ===');
{
  const v = (auth) => subscriptionVerdict(auth).verdict;
  ok('a proven subscription runs', v({ state: 'signed_in', subscription: true }) === 'subscription');
  ok('a proven API key is REFUSED', v({ state: 'signed_in', subscription: false }) === 'api_key');
  ok('signed out is its own answer, not an error', v({ state: 'signed_out' }) === 'signed_out');

  // THE DELIBERATE ASYMMETRY. Refusing what cannot be parsed would turn one CLI field rename into a
  // dead feature for every user — a worse failure than the one being prevented. The setup panel is
  // the strict half and never claims "Ready" without evidence; the run path refuses only what it
  // can prove is wrong.
  ok('an unreadable answer does NOT block the user', v({ state: 'signed_in' }) === 'unknown');
  ok('...and unknown is not silently called a subscription', v({ state: 'signed_in' }) !== 'subscription');

  const msg = subscriptionVerdict({ state: 'signed_in', subscription: false }).message ?? '';
  ok('the refusal says it did not run', /has not run/i.test(msg));
  ok('the refusal says what to do about it', /sign in again/i.test(msg));
  ok('the refusal contains no jargon a business owner would not know',
    !/oauth|token|api_key|authMethod/i.test(msg), msg);
}

console.log('\n=== expiry, warned about while it is still a sentence ===');
{
  const day = 86_400_000;
  const now = 1_700_000_000_000;
  ok('days left are counted from the REFRESH token',
    daysUntilExpiry({ refreshExpiresAt: now + 10 * day }, now) === 10);
  // The access token expires every few hours and is renewed silently. Warning on it would cry wolf
  // several times a day, which trains the user to ignore the one warning that matters.
  ok('the access token is deliberately NOT used',
    daysUntilExpiry({ expiresAt: now + day }, now) === null);
  ok('nothing known means no false alarm', daysUntilExpiry({}, now) === null);
  ok('an already-expired token reads negative, not null',
    daysUntilExpiry({ refreshExpiresAt: now - 2 * day }, now) === -2);
}

// ─── Usage: what the subscription has actually been spent on ─────────────────
//
// The numbers below are the REAL shape measured on this machine over seven days — 2,379 turns after
// 1,992 duplicates were removed, 2.1M output tokens, 944M cache reads. The duplicate count is the
// thing worth remembering: the same assistant turn is written into more than one transcript when a
// session is resumed, so counting lines rather than request ids would have roughly doubled every
// figure shown to the user.

const HOUR = 3_600_000, DAY = 86_400_000;
const cell = (o) => ({ in: 0, out: 0, cr: 0, cw: 0, n: 0, ...o });

console.log('\n=== rolling hours into the user\'s own days ===');
{
  // Local days, not UTC. A user in IST working at 2am must see that work on the right day, because
  // "yesterday" is a word they check against their own memory.
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const buckets = [
    { h: today.getTime() + 9 * HOUR, ...cell({ out: 100, n: 2 }) },
    { h: today.getTime() + 14 * HOUR, ...cell({ out: 50, n: 1 }) },
    { h: today.getTime() - DAY + 10 * HOUR, ...cell({ out: 700, n: 9 }) },
  ];
  const days = rollUpDaily(buckets, 7, now.getTime());
  ok('every day in the window is returned', days.length === 7);
  ok('two hours on the same day are added together', days[6].out === 150);
  ok('...and their call counts too', days[6].n === 3);
  ok('yesterday lands on yesterday', days[5].out === 700);
  // A chart that silently drops quiet days compresses time and makes a burst look like steady use.
  ok('quiet days are present, not omitted', days.filter((d) => d.out === 0).length === 5);
  ok('the days are in order, oldest first', days.every((d, i) => i === 0 || d.day > days[i - 1].day));
}
{
  const now = Date.now();
  const old = [{ h: now - 40 * DAY, ...cell({ out: 999 }) }];
  const days = rollUpDaily(old, 7, now);
  ok('anything older than the window is dropped, not folded into day one',
    days.every((d) => d.out === 0));
}

console.log('\n=== totals, and today ===');
{
  const now = new Date(); now.setHours(15, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const buckets = [
    { h: today.getTime() + 2 * HOUR, ...cell({ in: 5, out: 47, cr: 1000, cw: 20, n: 47 }) },
    { h: today.getTime() - 3 * DAY, ...cell({ in: 10, out: 200, cr: 5000, cw: 60, n: 100 }) },
  ];
  const t = totalUsage(buckets);
  ok('the whole range adds up', t.out === 247 && t.cr === 6000 && t.n === 147);
  const td = todayUsage(buckets, now.getTime());
  ok('today counts only today', td.out === 47 && td.n === 47);
  ok('an empty range is zero, not NaN', totalUsage([]).out === 0);
}

console.log('\n=== numbers a business owner can read ===');
{
  // 944,500,000 is not a figure anyone parses at a glance, and nobody outside this industry knows
  // what a token is. The short form keeps the shape without asking for arithmetic.
  ok('billions', formatTokens(944_500_000) === '944.5M');
  ok('millions', formatTokens(2_100_000) === '2.1M');
  ok('thousands', formatTokens(5_400) === '5k');
  ok('small numbers stay exact', formatTokens(47) === '47');
  ok('zero is zero, never "0.0k"', formatTokens(0) === '0');
  ok('nothing known does not print NaN', formatTokens(NaN) === '0');
}

console.log('\n=== model names, for recognising not copying ===');
{
  ok('the vendor prefix goes', prettyModel('claude-opus-5') === 'Opus 5');
  ok('so does a trailing date stamp', prettyModel('claude-3-5-haiku-20241022').includes('Haiku'));
  ok('an unknown id still renders as something', prettyModel('mystery-model').length > 0);
}

// ─── The window that actually matters ────────────────────────────────────────
//
// "Today" is not a unit any of these plans use. Claude's allowance resets on a rolling FIVE-HOUR
// window, with a second limit over seven days — so a user told "58k today" still cannot answer the
// only question they have: can I keep working now, or should I wait?

console.log('\n=== rolling windows, not calendar days ===');
{
  const now = 1_700_000_000_000;
  const H = 3_600_000;
  const buckets = [
    { h: now - 9 * H, ...cell({ out: 500, n: 20 }) },   // outside a 5h window
    { h: now - 3 * H, ...cell({ out: 300, n: 12 }) },   // inside
    { h: now - 1 * H, ...cell({ out: 100, n: 5 }) },    // inside
  ];
  const w = usageWindow(buckets, FIVE_HOURS, now);
  ok('only what is inside the window is counted', w.used.n === 17, `got ${w.used.n}`);
  ok('...and the older activity is excluded', w.used.out === 400);

  const week = usageWindow(buckets, ONE_WEEK, now);
  ok('the weekly window sees all of it', week.used.n === 37);
}

console.log('\n=== when room actually frees up ===');
{
  const now = 1_700_000_000_000;
  const H = 3_600_000;
  // THE FIDDLY, HONEST PART. A rolling window does not reset all at once — room comes back as the
  // OLDEST activity ages out. Telling somebody who has been working steadily "resets in 5 hours"
  // would be wrong every single time.
  const buckets = [
    { h: now - 4 * H, ...cell({ out: 100, n: 5 }) },
    { h: now - 1 * H, ...cell({ out: 100, n: 5 }) },
  ];
  const w = usageWindow(buckets, FIVE_HOURS, now);
  ok('the reset is one span after the OLDEST usage, not after now',
    w.resetsAt === (now - 4 * H) + FIVE_HOURS);
  ok('...which is about an hour away, not five', Math.round((w.resetsAt - now) / H) === 1);

  // Nothing used means nothing to wait for.
  const empty = usageWindow([], FIVE_HOURS, now);
  ok('an unused window is already free', empty.resetsAt <= now);
  ok('...and reads as "now"', untilReset(empty.resetsAt, now) === 'now');
}

console.log('\n=== the countdown, for someone deciding whether to wait ===');
{
  const now = 1_700_000_000_000;
  ok('under an hour is minutes', untilReset(now + 25 * 60_000, now) === '25m');
  ok('over an hour is hours and minutes', untilReset(now + 134 * 60_000, now) === '2h 14m');
  ok('the past is "now", never negative', untilReset(now - 60_000, now) === 'now');
}

console.log('\n=== a percentage ONLY when the user supplied the number ===');
{
  const now = 1_700_000_000_000;
  const buckets = [{ h: now - 60_000, ...cell({ out: 100, n: 20 }) }];

  // THE RULE. The credential file holds a tier NAME, not a remaining count, and Claude Code's own
  // /usage fetches it live with the OAuth token — which this product refuses to touch. So a
  // denominator we invented would be a number the user trusts and we made up.
  const guessed = usageWindow(buckets, FIVE_HOURS, now);
  ok('no percentage is shown when nobody supplied a limit', guessed.percent === undefined);
  ok('...and it is not silently zero', guessed.percent !== 0);

  const told = usageWindow(buckets, FIVE_HOURS, now, 40);
  ok('a percentage appears once the user states their own allowance', told.percent === 50);
  ok('it is capped, so going over does not read as 300%',
    usageWindow(buckets, FIVE_HOURS, now, 5).percent === 100);
  ok('a zero limit is treated as no limit, not as divide-by-zero',
    usageWindow(buckets, FIVE_HOURS, now, 0).percent === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
