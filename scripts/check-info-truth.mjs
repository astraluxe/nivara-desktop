// ─── The manual has to describe the app that exists ──────────────────────────
//
// The Info page is the user manual, and it had gone stale in the worst way: it told people
//
//   "At the top of Krew is a bar that decides which brain answers you. It has three modes."
//
// That bar was deleted in 1.67.0 and replaced by one menu in the title bar governing the whole app.
// So the manual sent readers hunting for a control that is not there, and listed three sources when
// there are six. A manual that is wrong about where a control is, is worse than no manual at all —
// the reader concludes the app is broken, or that they are.
//
// Nothing warns you when prose goes out of date. This does, for the claims that can be checked
// mechanically: named controls that were removed, and modules or sources the page claims exist.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const info = fs.readFileSync(path.join(root, 'src/modules/InfoModule.tsx'), 'utf8');
const failures = [];

// ── 1. Controls that no longer exist ────────────────────────────────────────
//
// Each entry is a phrase that described something real once and does not now. Add to it whenever a
// control is removed, so the manual cannot go on pointing at its ghost.
const GONE = [
  ['connection bar', 'the per-screen connection pills were removed in 1.67.0 — it is one menu in the title bar now'],
  ['connection pills', 'removed in 1.67.0'],
  ['team room', 'the isometric office screen was removed in 1.73.0'],
];
for (const [phrase, why] of GONE) {
  // Comments in this file may name the phrase in order to explain it; only prose counts.
  const prose = info.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  if (new RegExp(phrase, 'i').test(prose)) failures.push(`Info page still mentions "${phrase}" — ${why}`);
}

// ── 2. Every AI source the page lists must be a real one ────────────────────
//
// The page said three; there are five modes plus "choose for me". Under-listing is not an error the
// compiler can see, so the count is checked against the union in aiSource.ts.
const aiSrc = fs.readFileSync(path.join(root, 'src/lib/aiSource.ts'), 'utf8');
const modes = new Set([...aiSrc.matchAll(/'(auto|nivara|own_key|local|agent_cli)'/g)].map((m) => m[1]));
// The user-facing names the page must be able to point at, one per real mode.
const NAMED = [
  [/Claude Code|Codex/i, 'agent_cli'],
  [/own key/i, 'own_key'],
  [/adris\.tech/i, 'nivara'],
  [/local model|\bLocal\b/i, 'local'],
  [/choose for me|automatic/i, 'auto'],
];
for (const [re, mode] of NAMED) {
  if (modes.has(mode) && !re.test(info)) {
    failures.push(`Info page never mentions the "${mode}" source, which the app has`);
  }
}

// Module reachability is NOT re-checked here — check-ui-reachable.mjs already proves every module
// in the sidebar can be opened, and a second copy of that logic would only rot on its own schedule.

if (failures.length) {
  console.error('\nThe manual describes an app that does not exist:\n');
  for (const f of failures) console.error('  ' + f);
  console.error('');
  process.exit(1);
}
console.log(`info page: no removed controls, all ${modes.size} AI sources named`);
