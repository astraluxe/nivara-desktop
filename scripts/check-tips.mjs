// ─── Every tip names something that actually exists ──────────────────────────
//
// WHY THIS EXISTS. `src/lib/krewTips.ts` teaches the product to a new user from the empty chat, and
// it is the file in this repo most likely to rot: a command renamed or a module removed leaves a
// tip cheerfully promising something that does nothing, and NOTHING ELSE WOULD CATCH IT. The tip
// would keep appearing, in the app's calmest voice, being wrong.
//
// This is the same shape as check-boss-tools.mjs, and for the same reason: the Info page once
// documented /findleads and /repair-table when neither existed, so typing them opened an empty
// palette and the guide was quietly lying.
//
// Run: node scripts/check-tips.mjs   (wired into `npm run build`)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tipsSrc = fs.readFileSync(path.join(root, 'src/lib/krewTips.ts'), 'utf8');
const chatSrc = fs.readFileSync(path.join(root, 'src/components/krew/KrewChat.tsx'), 'utf8');

// The real command table, read from the source of truth rather than duplicated here.
const table = chatSrc.slice(
  chatSrc.indexOf('const SLASH_COMMANDS'),
  chatSrc.indexOf('// Line icons for the slash menu'),
);
const commands = new Set([...table.matchAll(/cmd: '([a-z-]+)'/g)].map((m) => m[1]));
const navTargets = new Set([...table.matchAll(/run: 'nav', value: '([a-z]+)'/g)].map((m) => m[1]));
// Modules a tip may point at: anything a slash command already navigates to, plus the ones the
// sidebar owns. Kept explicit so adding a target is a deliberate act.
for (const m of ['krew', 'office', 'studio', 'home', 'account', 'head', 'info']) navTargets.add(m);

if (commands.size < 20) { console.error('check-tips: could not read SLASH_COMMANDS — refusing to pass'); process.exit(1); }

const ids = [...tipsSrc.matchAll(/^\s*\{ id: '([a-z0-9-]+)'/gm)].map((m) => m[1]);
const problems = [];

// 1. Every command named must exist.
for (const m of tipsSrc.matchAll(/id: '([a-z0-9-]+)'[^\n]*?cmd: '([a-z-]+)'/g)) {
  if (!commands.has(m[2])) problems.push(`tip "${m[1]}" names /${m[2]}, which is not a slash command`);
}
// 2. Every module named must exist.
for (const m of tipsSrc.matchAll(/id: '([a-z0-9-]+)'[^\n]*?nav: '([a-z]+)'/g)) {
  if (!navTargets.has(m[2])) problems.push(`tip "${m[1]}" opens "${m[2]}", which is not a module`);
}
// 3. Ids must be unique — they are what "already shown" is remembered by, so a duplicate silently
//    suppresses a different tip forever.
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
for (const d of new Set(dupes)) problems.push(`duplicate tip id "${d}"`);

// 4. Enough of them to be worth rotating, and short enough to read in three seconds.
if (ids.length < 100) problems.push(`only ${ids.length} tips — the empty chat needs enough not to repeat`);
// Line-based rather than regex-based: a tip's text can contain apostrophes and escapes, and a
// pattern clever enough to handle those is a pattern that breaks silently on the next one.
for (const line of tipsSrc.split('\n')) {
  const id = line.match(/^\s*\{ id: '([a-z0-9-]+)'/)?.[1];
  if (!id) continue;
  const start = line.indexOf(", text: '");
  if (start < 0) { problems.push(`tip "${id}" has no text`); continue; }
  const end = line.lastIndexOf("'");
  const text = line.slice(start + 9, end);
  if (text.length > 190) problems.push(`tip "${id}" is ${text.length} chars — too long to read above a text box`);
  if (text.length < 20) problems.push(`tip "${id}" is too short to teach anything`);
}

// ── AND THE TIPS MUST ACTUALLY REACH THE SCREEN ──────────────────────────────
//
// 152 tips were written, checked, and shipped where nobody could see them: the render site read
// `{agent.key !== 'boss' && <TipBar .../>}`, and the boss is the DEFAULT agent. So the one screen
// almost every user looks at — the blank main chat — was the single screen the feature was hidden
// on. Nothing failed. The tips were simply never shown, and the owner had to report it.
//
// A feature guarded off its own primary surface is not something a type checker can see, so it is
// checked here.
const at = chatSrc.indexOf('<TipBar');
if (at === -1) {
  problems.push('TipBar is not rendered anywhere in KrewChat — the tips have no home');
} else {
  // Look at the JSX guarding it, just above the tag.
  const before = chatSrc.slice(Math.max(0, at - 400), at);
  const guard = before.slice(before.lastIndexOf('{'));
  if (/agent\.key\s*!==?\s*['"]boss['"]/.test(guard)) {
    problems.push('TipBar is gated on the agent NOT being the boss — the boss is the default agent, '
      + 'so that hides every tip on the main chat screen');
  }
}

// ── AND THE EMPTY CHAT MUST SHOW ONE ─────────────────────────────────────────
//
// The middle of a blank chat is the best teaching surface in the product: the user is looking
// straight at it with nothing else to read. It used to hold an avatar, the agent's name and role
// (both already in the header above), an "N apps connected" count, and three starter prompts that
// were the same three every time. The owner's verdict was "there is no use of all this".
//
// If TipStage ever falls out of that branch it fails silently — the chat still works, it just goes
// back to teaching nobody anything.
if (!chatSrc.includes('<TipStage')) {
  problems.push('the empty chat does not render <TipStage> — the middle of a blank chat is the '
    + 'best teaching surface in the product and it is showing nothing');
}

if (problems.length) {
  console.error('\nTips name things that do not exist, or break the rules:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\nsrc/lib/krewTips.ts is shown to new users as fact. Fix the tip or restore the feature.\n');
  process.exit(1);
}
console.log(`tips: ${ids.length} tips, every command and module they name exists.`);
