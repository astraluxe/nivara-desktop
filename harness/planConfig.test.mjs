// ─── The app must honour what the page sold ──────────────────────────────────
//
// The pricing page states numbers. `lib/entitlement.ts` is where those numbers live and what the
// page and the account screen read. `lib/planConfig.ts` is what actually STOPS someone. The two had
// drifted, in the direction that costs a customer:
//
//   plan `solo`, sold as Business:  8,000,000 tokens · 25 Mesh devices · 1,500 runs
//   enforced as:                    4,000,000 tokens · 10 Mesh devices ·   500 runs
//
// Somebody paying for Business would have been cut off at half the capacity they bought.
//
// The rule: enforce the GREATER of what they were promised and what their old plan already gave
// them. Never less than the page — and never less than they already had, because a rename must not
// take anything away.

import { getPlanConfig } from './planConfig.js';
// entitlement.js is the bundle the entitlement suite writes into the same folder, and that suite
// is listed BEFORE this one in run-tests.mjs. If it is ever moved after, this import fails loudly
// rather than silently testing nothing.
import { ALLOWANCE, tierOf, TIER_LABEL } from './entitlement.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const PLANS = ['free', 'explore', 'solo', 'builder', 'business', 'custom'];

console.log('\n=== nobody is stopped below what the page sold them ===');
for (const plan of PLANS) {
  const cfg = getPlanConfig(plan);
  const tier = tierOf(plan, 'plan');
  const sold = ALLOWANCE[tier];
  const label = `${plan} (sold as ${TIER_LABEL[tier]})`;

  // null / 0 mean unlimited in this config and must stay that way.
  const unlimitedTokens = cfg.monthlyTokens === null || cfg.monthlyTokens === 0;
  ok(`${label}: tokens`,
    unlimitedTokens || sold.tokens === Infinity || cfg.monthlyTokens >= sold.tokens,
    `enforced ${cfg.monthlyTokens} < sold ${sold.tokens}`);

  ok(`${label}: Mesh devices`,
    sold.meshDevices === Infinity || cfg.meshDevices >= sold.meshDevices,
    `enforced ${cfg.meshDevices} < sold ${sold.meshDevices}`);

  ok(`${label}: automation runs`,
    sold.runs === Infinity || cfg.cloudAutomations >= sold.runs,
    `enforced ${cfg.cloudAutomations} < sold ${sold.runs}`);
}

console.log('\n=== and nobody loses what they already had ===');
{
  // The old Team plan gave 50,000,000 tokens; Growth advertises 25,000,000. Renaming the plans must
  // not quietly halve an existing customer.
  const team = getPlanConfig('business');
  ok('the old Team keeps its 50M tokens', team.monthlyTokens >= 50_000_000, String(team.monthlyTokens));
  ok('...and its 50 Mesh devices', team.meshDevices >= 50, String(team.meshDevices));
  const builder = getPlanConfig('builder');
  ok('the old Builder keeps its 16M tokens', builder.monthlyTokens >= 16_000_000, String(builder.monthlyTokens));
}

console.log('\n=== unlimited stays unlimited ===');
{
  // `custom` has monthlyTokens: null, meaning no cap. Taking "the bigger of" a null would put a
  // number on a plan that has none.
  const custom = getPlanConfig('custom');
  ok('custom has no token cap', custom.monthlyTokens === null || custom.monthlyTokens === 0, String(custom.monthlyTokens));
}

console.log('\n=== the qualitative flags are untouched ===');
{
  // This change is about quantities the page puts a number on. Guard, voice and audit export are
  // decided elsewhere and must not move.
  ok('free still has no Guard', getPlanConfig('free').guardAccess === false);
  ok('solo still has Guard', getPlanConfig('solo').guardAccess === true);
  ok('an unknown plan falls back to free', getPlanConfig('nonsense').monthlyTokens === getPlanConfig('free').monthlyTokens);
}

console.log('\n=== the numbers the page prints are the ones enforced ===');
{
  // The specific case that was wrong.
  const business = getPlanConfig('solo');
  ok('a Business customer gets the 8M they paid for', business.monthlyTokens >= 8_000_000, String(business.monthlyTokens));
  ok('...and 25 Mesh devices, not 10', business.meshDevices >= 25, String(business.meshDevices));
  ok('...and 1,500 runs, not 500', business.cloudAutomations >= 1500, String(business.cloudAutomations));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
