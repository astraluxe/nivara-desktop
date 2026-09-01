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

// ── WHAT THE APP IS ALLOWED TO SELL ──────────────────────────────────────────
//
// Two ways the product has already promised something untrue about a plan.
//
// SINGLE SIGN-ON was on the pricing page and in the in-app upgrade window, on two tiers. There is
// no SAML, no OIDC, no identity provider — only the Google sign-in button every plan already has.
// It came off the website for that reason; leaving it in a modal is the same untruth in a smaller
// window. It goes back when it exists.
//
// PRICES had drifted. The upgrade window offered Business at ₹9,999 and Growth at ₹19,999 while
// the site sold them at ₹6,499 and ₹12,999, and did not know Starter existed at all. A customer
// reading one number in the product and another on the site cannot tell which is real, so the
// figures now come from lib/entitlement.ts — the same place the pricing page is generated from.
{
  // THE INVARIANT THAT ACTUALLY MATTERS: every tier's `sso` flag is false. entitlement.ts renders
  // that line only when the flag is true, so with all of them false the claim cannot reach a
  // screen. Checking the flag is precise, where grepping for the phrase also hits the comments
  // explaining why it is off and the guarded branch that is the correct pattern.
  const ent = fs.readFileSync(path.join(SRC, 'lib', 'entitlement.ts'), 'utf8');
  const sold = [...ent.matchAll(/\bsso:\s*(true|false)\b/g)].filter((m) => m[1] === 'true').length;

  // And no SCREEN may write the claim by hand, bypassing the flag — which is how the in-app
  // upgrade window came to go on selling it after the website had stopped.
  const screens = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (f.endsWith('.tsx')) screens.push(f);
    }
  };
  walk(path.join(SRC, 'components'));
  walk(path.join(SRC, 'modules'));

  const bad = [];
  if (sold) bad.push(`entitlement.ts sets sso: true on ${sold} tier(s) — it is not built`);
  for (const f of screens) {
    const isModal = f.endsWith('UpgradeModal.tsx');
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*\*/.test(line)) return;                 // a doc-comment line
      const code = line.replace(/\/\/.*$/, '');
      if (/f\.sso|FEATURES\[/.test(code)) return;      // guarded by the flag: the correct pattern
      // SAYING WE DO NOT HAVE IT IS THE OPPOSITE OF SELLING IT. A release note explaining that the
      // claim was removed has to be able to name the thing it removed, or the note is useless.
      if (/\b(not built|removed|came off|no longer|is not|does not exist|never built)\b/i.test(code)) return;
      if (/single sign[- ]on|\bSAML\b/i.test(code)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1} sells SSO`);
      }
      if (isModal && /₹\s?[\d,]{4,}/.test(code)) {
        bad.push(`${path.relative(ROOT, f)}:${i + 1} hardcodes a price — use PRICE from lib/entitlement.ts`);
      }
    });
  }

  if (bad.length) {
    console.error('\nThe app is promising something it should not:\n');
    for (const b of bad) console.error('  ' + b);
    console.error('');
    process.exit(1);
  }
  console.log('plan claims: SSO off on every tier, no hardcoded prices in the upgrade window');
}
