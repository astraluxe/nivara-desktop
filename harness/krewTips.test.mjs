// ─── The empty chat teaches, and never nags ──────────────────────────────────
//
// The line this replaces — "No apps connected. Link Gmail, GitHub, Notion & more" — was shown
// identically on the hundredth launch as on the first, including to people who had connected nine
// apps. These are the rules that stop the replacement becoming the same thing.

import { TIPS, tipApplies, pickTip } from './krewTips.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const ctx = (o = {}) => ({ appsConnected: 0, hasModelKey: false, hasCli: false, hasLocalModel: false, ...o });

console.log('\n=== enough of them, and all distinct ===');
{
  ok(`there are ${TIPS.length} tips`, TIPS.length >= 150);
  const ids = TIPS.map((t) => t.id);
  ok('every id is unique', new Set(ids).size === ids.length,
    'dupes: ' + ids.filter((v, i) => ids.indexOf(v) !== i).join(', '));
  // Two tips with the same words is the same failure as one tip shown twice.
  const texts = TIPS.map((t) => t.text);
  ok('no two tips say the same thing', new Set(texts).size === texts.length);
  ok('every tip has text worth reading', TIPS.every((t) => t.text.length >= 20));
  ok('none is too long for a one-line bar', TIPS.every((t) => t.text.length <= 190));
}

console.log('\n=== never advertise what they already have ===');
{
  // THE WHOLE POINT. The old line told someone with nine apps connected to connect apps.
  const connected = ctx({ appsConnected: 9, hasModelKey: true, hasCli: true, hasLocalModel: true });
  const shown = TIPS.filter((t) => tipApplies(t, connected));
  ok('a fully set-up user is never told to connect an app',
    !shown.some((t) => t.when === 'no-apps'));
  ok('...nor to get a model key', !shown.some((t) => t.when === 'no-key'));
  ok('...nor to install a CLI they already have', !shown.some((t) => t.when === 'no-cli'));
  ok('...nor to download a local model they already have', !shown.some((t) => t.when === 'no-local'));
  ok('but they still get plenty to read', shown.length > 100);

  const fresh = ctx();
  const first = TIPS.filter((t) => tipApplies(t, fresh));
  ok('a brand-new user does get the set-up tips', first.some((t) => t.when === 'no-apps'));
  ok('...and is not shown tips that assume a CLI', !first.some((t) => t.when === 'has-cli'));
  ok('...and is not shown tips that assume connected apps', !first.some((t) => t.when === 'has-apps'));
}

console.log('\n=== rotation ===');
{
  // A rotating tip that repeats immediately feels like a static one.
  const c = ctx();
  const eligible = TIPS.filter((t) => tipApplies(t, c)).map((t) => t.id);
  const seen = eligible.slice(0, eligible.length - 1);
  const t = pickTip(c, seen);
  ok('with one left unseen, that is the one picked', t.id === eligible[eligible.length - 1]);

  // Going blank when everything has been seen would be worse than a repeat.
  const all = pickTip(c, eligible);
  ok('when all have been seen it starts again rather than showing nothing', all !== null);

  // Deterministic draw, so the test is not flaky.
  const picked = pickTip(c, [], () => 0);
  ok('the picker returns a real tip', !!picked && typeof picked.text === 'string');
  ok('and it is one that applies', tipApplies(picked, c));
}

console.log('\n=== they teach the whole product, not one corner ===');
{
  const all = TIPS.map((t) => t.text.toLowerCase()).join(' ');
  // Each of these is a feature a new user would otherwise never discover.
  for (const topic of ['brain', 'outreach', 'excel', 'word', 'automation', 'guard', 'local model',
                       'subscription', 'council', 'coder', 'linkedin', 'offline']) {
    ok(`covers ${topic}`, all.includes(topic));
  }
  const withAction = TIPS.filter((t) => t.cmd || t.nav);
  ok('a good share are one click from doing the thing', withAction.length >= 40,
    `only ${withAction.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
