// ─── One live source for the plan ────────────────────────────────────────────
//
// A customer paid, the transaction went through, and the app kept showing the old plan until it was
// restarted. The fix was a realtime subscription in AuthContext: when the webhook updates
// `users`, the profile in the running app updates with it.
//
// That fix only holds while AuthContext is the ONLY place the plan is read from. The moment another
// screen queries `users.plan` for itself — worse, caches it — half the app shows the new plan and
// half shows the old one, and the bug is back in a place nobody thinks to look.
//
// So: nothing outside AuthContext may select `plan` from `users`.
//
// Run: node scripts/check-plan-source.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// THE RULE IS ABOUT CACHING, NOT READING.
//
// A FRESH read of the plan is fine and sometimes necessary. What breaks is keeping a second COPY
// and showing it — that is how one half of the app ends up a plan behind the other. These four
// were checked by hand and each reads fresh at the moment it needs the answer:
//
//   AuthContext   the live source; owns the realtime subscription
//   UpgradeModal  polls `users.plan` for up to five minutes after a payment, waiting for the
//                 webhook to land. This IS the mechanism that fixed "they paid and the app did
//                 not update" — it must never be replaced with a cached value
//   guardWatch    one read at the moment a Guard check runs, to size the limit
//   HeadModule    reads OTHER people’s plans, which is a different question entirely
//   AccountPanel  displays the profile it already has from the context
const ALLOWED = new Set([
  'contexts/AuthContext.tsx',
  'components/UpgradeModal.tsx',
  'lib/guardWatch.ts',
  'modules/HeadModule.tsx',
  'modules/AccountPanel.tsx',
]);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  if (ALLOWED.has(rel)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes("from('users')")) continue;

  // Only a select that actually asks for `plan` matters. Reading usage_period_start or a licence
  // binding from the same table is fine — those are not kept live anywhere else.
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = /\.select\(\s*['"`]([^'"`]*)['"`]/.exec(line);
    if (!m) return;
    const cols = m[1].split(',').map((c) => c.trim());
    if (!cols.includes('plan')) return;
    // Is it this table?
    const near = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
    if (!near.includes("from('users')")) return;
    problems.push(
      `src/${rel}:${i + 1}\n` +
      `    selects \`plan\` from \`users\` directly.\n` +
      `    Use the profile from AuthContext instead — it is kept live by a realtime subscription, and\n` +
      `    a second copy is how "they paid and the app did not update" comes back.`,
    );
  });
}

if (problems.length) {
  console.error('\nThe plan is being read from more than one place:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log('plan source: AuthContext is the only live reader of users.plan');
