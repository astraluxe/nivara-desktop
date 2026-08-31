// ─── The three things in the chat that must stay wired ───────────────────────
//
// Each of these was a real, reported failure, and each is a few lines of wiring that a refactor
// could remove without breaking a type or a test:
//
//  1. QUICK REPLIES. An agent asks "PowerPoint or here in the chat?" and the user has to retype the
//     answer. The extraction is unit-tested; what is NOT unit-testable is whether the message list
//     still renders it.
//
//  2. THE REFUSAL GUARD. A model answered a document-and-figures request with "I cannot create
//     .pptx files, I am a text-based AI, no files were received". If the guard stops being called,
//     that reply reaches the user again and the work silently does not happen.
//
//  3. THE OFFICE ROUTE REACHING THE BUILDER. Naming PowerPoint used to send the request to an agent
//     that could refuse. It must go to the deterministic builder instead.
//
// Run: node scripts/check-chat-affordances.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAT = path.join(ROOT, 'src/components/krew/KrewChat.tsx');
const src = fs.readFileSync(CHAT, 'utf8');

const must = [
  ['quick replies are imported', "from '../../lib/quickReplies'"],
  ['...and rendered under answers', '<QuickReplyBar'],
  ['...from the message content', 'text={msg.content}'],

  ['the refusal guard is imported', "from '../../lib/refusalGuard'"],
  ['...and consulted before the answer is shown', 'shouldOverrideRefusal({'],
  ['...with the deck builder as the recovery', "addMsg({ role: 'deck_setup'"],

  ['naming PowerPoint reaches the deck builder', "deckRoute === 'office' && namedApp(text) === 'powerpoint'"],
  ['...and the builder still handles plain build requests', "deckRoute === 'build'"],
  ['the card is told the user named their own app', 'preferOwnApp={deckWantsOwnAppRef.current}'],
];

const missing = must.filter(([, needle]) => !src.includes(needle));

// The guard has to run BEFORE the answer is committed, or it guards nothing.
//
// The commit used to read `finaliseLastMsg(honest)`. It now shows `answered`, which is `honest`
// plus the wrong-site note from lib/urlFidelity.ts — so the anchor moved. Both halves are checked
// rather than just the call: that `answered` is still built FROM `honest` (otherwise the refusal
// guard, the ongoing-work stripper and the empty-answer fallbacks above it would all be bypassed
// by whatever replaced it), and that the guard still runs first.
const iGuard = src.indexOf('shouldOverrideRefusal({');
const iShow = src.indexOf('finaliseLastMsg(answered);');
const derived = src.includes('const answered = honest + fidelityNote(');
const ordered = iGuard > 0 && iShow > 0 && iGuard < iShow && derived;

if (missing.length || !ordered) {
  console.error('\nChat wiring that users depend on has gone missing:\n');
  for (const [what] of missing) console.error(`  MISSING: ${what}`);
  if (!ordered) {
    if (!derived) {
      console.error('  ANSWER:  the text shown must still be built from `honest` —');
      console.error('           expected `const answered = honest + fidelityNote(...)`.');
    }
    console.error('  ORDER:   shouldOverrideRefusal must run BEFORE finaliseLastMsg(answered),');
    console.error('           otherwise the refusal is already on screen when it is checked.');
  }
  console.error('\n  See lib/quickReplies.ts and lib/refusalGuard.ts for what these are for.\n');
  process.exit(1);
}

console.log(`chat affordances: all ${must.length} wired, guard runs before the answer is shown`);
