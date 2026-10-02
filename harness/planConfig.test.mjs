// ─── adris.tech is free: one entitlement, for everyone ───────────────────────
//
// Until Oct 2026 this suite held the app to what the pricing page SOLD each tier. The hosted plan is
// retired: there is no adris.tech key, so nothing a user does costs adris.tech anything, and there is
// nothing to ration or sell. `lib/planConfig.ts` now hands every account the same FREE_FOR_ALL
// entitlement.
//
// What this suite protects now:
//   1. Every account — whatever its old `plan` column or admin level says — gets the SAME config.
//   2. Nothing in it can stop someone: no token cap, no Guard / deck / voice / scheduling lock,
//      no power-command trial, no Advanced-search quota, no local-model lock.
//   3. The one thing that would only ever have run on OUR money stays off: cloud automation runs
//      (the Edge Function that ran them used adris.tech's key). Automations still run on the PC.

import { getPlanConfig, planConfigFor, FREE_FOR_ALL } from './planConfig.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

const PLANS = ['free', 'explore', 'solo', 'builder', 'business', 'custom', 'starter', 'made-up', ''];

console.log('\n=== every account gets the same entitlement ===');
for (const plan of PLANS) {
  ok(`plan "${plan}" → FREE_FOR_ALL`, getPlanConfig(plan) === FREE_FOR_ALL);
}
ok('an account with no plan', planConfigFor(null) === FREE_FOR_ALL);
ok('undefined likewise', planConfigFor(undefined) === FREE_FOR_ALL);
ok('a free account', planConfigFor({ plan: 'free' }) === FREE_FOR_ALL);
ok('an old paid account', planConfigFor({ plan: 'business' }) === FREE_FOR_ALL);
ok('a head account', planConfigFor({ plan: 'solo', admin_level: 'head' }) === FREE_FOR_ALL);

console.log('\n=== nothing in it can stop someone ===');
const c = FREE_FOR_ALL;
ok('no token cap (null = unlimited — every reader checks !== null)', c.monthlyTokens === null, String(c.monthlyTokens));
ok('Guard is on', c.guardAccess === true);
ok('Guard checks are unlimited', c.guardChecks === null);
ok('contract scanning is on', c.contractScanning === true);
ok('audit export is on', c.auditExport === true);
ok('voice input is on', c.voiceToCode === true);
ok('Advanced decks are on', c.advancedDeck === true);
ok('social scheduling is on', c.socialScheduling === true);
ok('power commands are unlimited', c.powerCommands === null);
ok('Advanced searches are unlimited', c.advancedSearches === null);
ok('AI images are not capped (only the user\'s own key can make one)', c.imageUnits === null);
ok('Mesh can be created and joined', c.canCreateMesh && c.canJoinMesh);
ok('a full Mesh device limit', c.meshDevices >= 50);
ok('plenty of app connections', c.mcpConnections >= 100);

console.log('\n=== what only ever ran on our money stays off ===');
ok('cloud automation runs are off (they used adris.tech\'s key)', c.cloudAutomations === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
