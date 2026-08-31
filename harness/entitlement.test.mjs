// ─── What the customer is entitled to (L1–L4, L10) ───────────────────────────
//
// Two things carry real money and real trust here, so they get the most assertions:
//
//   1. NOTHING BUT OUR OWN AI IS EVER METERED. A customer's own key, their Claude/Codex
//      subscription through the bridge, and a local model cost us nothing. Charging an allowance
//      for any of them would be taking money for work we did not do.
//   2. A DROPPED CONNECTION NEVER LOCKS ANYBODY OUT. adris runs on bad connections; failing closed
//      turns our outage into their problem.

import {
  tierOf, TIER_LABEL, ALLOWANCE, FEATURES, tasksFrom, remaining, daysToReset,
  consumesAllowance, usedFrom, entitlementState, stateLabel, boundElsewhere, covers, GRACE_DAYS,
} from './entitlement.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

console.log('\n=== nobody loses what they already had ===');
{
  // Six old plan keys, four new tiers. A rename must never quietly downgrade a paying account.
  ok('free stays free', tierOf('free') === 'free');
  ok('explore is free', tierOf('explore') === 'free');
  ok('solo becomes Business', tierOf('solo') === 'business');
  ok('builder becomes Growth', tierOf('builder') === 'growth');
  // Read as a legacy PLAN key, "business" is the old Team and must become Growth…
  ok('the old Team becomes Growth', tierOf('business', 'plan') === 'growth');
  // …but read as a new TIER name it is Business, the cheapest paid tier. Same word, opposite
  // meaning, which is exactly why the caller has to say which column it read.
  ok('the new Business tier stays Business', tierOf('business', 'tier') === 'business');
  ok('an unknown value in the new vocabulary is free, never paid', tierOf('mystery', 'tier') === 'free');
  ok('custom becomes Enterprise', tierOf('custom') === 'enterprise');
  ok('an unknown plan is treated as free, never as paid', tierOf('mystery') === 'free');
  ok('null is free', tierOf(null) === 'free');
  ok('a new name passes straight through', tierOf('growth') === 'growth');
  ok('case does not matter', tierOf('Growth') === 'growth');
  // Nobody may end up on a SMALLER allowance than their old plan implied.
  ok('solo → business is not a downgrade in tokens', ALLOWANCE[tierOf('solo')].tokens >= 1_000_000);
  ok('every tier has a label', Object.keys(TIER_LABEL).length === 4);
}

console.log('\n=== ONLY our own AI is metered ===');
{
  // The heart of it. Each of these paths costs adris nothing.
  ok('adris AI is metered', consumesAllowance({ source: 'adris', tokens_consumed: 500 }));
  ok('a customer\'s own key is NOT', !consumesAllowance({ source: 'own_key', tokens_consumed: 9e9 }));
  ok('the bridge is NOT', !consumesAllowance({ source: 'bridge', tokens_consumed: 9e9 }));
  ok('a local model is NOT', !consumesAllowance({ source: 'local', tokens_consumed: 9e9 }));
  ok('nothing at all is NOT', !consumesAllowance(null));

  const rows = [
    { source: 'adris',   task_type: 'krew_direct', tokens_consumed: 1200 },
    { source: 'own_key', task_type: 'krew_direct', tokens_consumed: 90000 },
    { source: 'bridge',  task_type: 'coder',       tokens_consumed: 50000 },
    { source: 'local',   task_type: 'krew_direct', tokens_consumed: 40000 },
    { source: 'adris',   task_type: 'krew_image',  tokens_consumed: 300 },
    { source: 'adris',   task_type: 'automation',  tokens_consumed: 800 },
  ];
  const u = usedFrom(rows);
  ok('only the adris rows are counted', u.tokens === 1200 + 300 + 800, JSON.stringify(u));
  ok('an image is counted as an image', u.images === 1, JSON.stringify(u));
  ok('an automation run is counted as a run', u.runs === 1, JSON.stringify(u));
  ok('180,000 own-key tokens cost the customer nothing', u.tokens < 3000, JSON.stringify(u));
  ok('an empty list is fine', usedFrom([]).tokens === 0);
}

console.log('\n=== how much is left ===');
{
  const r = remaining('business', { tokens: 2_000_000, images: 40, runs: 100 });
  ok('tokens left are right', r.tokens === 6_000_000, String(r.tokens));
  ok('images left are right', r.images === 60, String(r.images));
  ok('runs left are right', r.runs === 1400, String(r.runs));
  ok('tasks are tokens ÷ 1000', r.tasksLeft === 6000, String(r.tasksLeft));
  ok('a quarter spent reads as a quarter', Math.abs(r.spent - 0.25) < 0.001, String(r.spent));
  ok('nothing is exhausted yet', !r.anyExhausted);

  const over = remaining('free', { tokens: 999_999, images: 99, runs: 99 });
  ok('going over never goes negative', over.tokens === 0 && over.images === 0 && over.runs === 0, JSON.stringify(over));
  ok('...and it is reported as exhausted', over.anyExhausted);
  ok('a missing figure is treated as zero used', remaining('free', {}).tokens === ALLOWANCE.free.tokens);
  ok('null usage is fine', remaining('free', null).tokens === ALLOWANCE.free.tokens);

  const ent = remaining('enterprise', { tokens: 9e9, images: 9e9, runs: 9e9 });
  ok('enterprise is never exhausted', !ent.anyExhausted && ent.unlimited);
  ok('...and its meter never fills', ent.spent === 0);
}

console.log('\n=== a dropped connection must not lock anybody out ===');
{
  const DAY = 86_400_000, now = Date.now();
  ok('just verified is active', entitlementState({ verifiedAt: now }, now) === 'active');
  ok('verified an hour ago is active', entitlementState({ verifiedAt: now - 3600_000 }, now) === 'active');
  ok('three days offline is still fine', entitlementState({ verifiedAt: now - 3 * DAY }, now) === 'grace');
  ok('thirteen days offline is still fine', entitlementState({ verifiedAt: now - 13 * DAY }, now) === 'grace');
  ok(`past ${GRACE_DAYS} days it goes stale`, entitlementState({ verifiedAt: now - 20 * DAY }, now) === 'stale');
  ok('never verified is stale', entitlementState({ verifiedAt: null }, now) === 'stale');
  // A machine whose clock is ahead must not be punished for it.
  ok('a fast clock does not lock anyone out', entitlementState({ verifiedAt: now + 5 * DAY }, now) === 'active');
  ok('the grace state says it is offline, not broken', /offline/i.test(stateLabel('grace')), stateLabel('grace'));
  ok('the active state is plain', stateLabel('active') === 'Active');
}

console.log('\n=== binding, without false accusations ===');
{
  ok('a different machine is caught', boundElsewhere({ verifiedAt: 1, machineId: 'A' }, 'B'));
  ok('the same machine is fine', !boundElsewhere({ verifiedAt: 1, machineId: 'A' }, 'A'));
  // If WE cannot identify the machine, that is our failure and must never read as their misuse.
  ok('an unknown machine is never accused', !boundElsewhere({ verifiedAt: 1, machineId: 'A' }, null));
  ok('an unbound entitlement is never accused', !boundElsewhere({ verifiedAt: 1, machineId: null }, 'B'));
}

console.log('\n=== the reset date ===');
{
  const now = new Date('2026-03-10T12:00:00Z');
  ok('counts from the recorded period start', daysToReset('2026-03-01T00:00:00Z', now) === 22,
     String(daysToReset('2026-03-01T00:00:00Z', now)));
  ok('falls back to the calendar month', daysToReset(null, now) > 0 && daysToReset(null, now) <= 31);
  ok('a rubbish date does not crash', daysToReset('not-a-date', now) > 0);
  ok('never negative', daysToReset('2020-01-01T00:00:00Z', now) === 0);
}

console.log('\n=== what the licence screen says ===');
{
  const c = covers('business');
  ok('it lists the tasks', c.some((l) => /8,000 AI tasks/.test(l)), JSON.stringify(c[0]));
  ok('it lists images', c.some((l) => /100 AI images/.test(l)));
  ok('it lists seats', c.some((l) => /10 seats/.test(l)));
  ok('it promises own-key is free', c.some((l) => /never counted/i.test(l)));
  ok('free says Guard is not included', covers('free').some((l) => /Guard not included/.test(l)));
  ok('enterprise says fair use, never plain unlimited',
    covers('enterprise').every((l) => !/^Unlimited$/.test(l)) && covers('enterprise').some((l) => /fair use/.test(l)));
  ok('growth has single sign-on', FEATURES.growth.sso === true);
  ok('business does not', FEATURES.business.sso === false);
  ok('a task is a thousand tokens', tasksFrom(8_000_000) === 8000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
