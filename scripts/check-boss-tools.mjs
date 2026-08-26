/* The boss must actually HOLD the tools for the things people ask it to do.
 *
 * WHY THIS EXISTS. A capability was built, tested against real Microsoft Word, and shipped —
 * documents came out with the user's own template, fonts and branding intact. Then the user typed
 * "make me a Word proposal for Acme and save it to my Desktop" and was told:
 *
 *     "I cannot create or save files directly to your computer, as I don't have access to your
 *      file system or desktop."
 *
 * Nothing was broken. The boss is delegation-first, so its system tools come from a hand-written
 * allowlist — and the new tool had never been added to it. The agent was answering honestly about
 * the tools it could see.
 *
 * This is the fourth time this exact shape has bitten: recall_from_brain (boss guessed and reported
 * an empty note as saved), create_calendar_event (boss SAID it had scheduled something and had
 * not), read_my_calendar (boss asked who a meeting was with, when the name was in the title), and
 * now this one. A missing tool never fails a build and never throws. It produces a confident
 * sentence — which is the most expensive failure mode this product has.
 *
 * Two things are checked, and the second matters as much as the first:
 *   1. every name in BOSS_SYSTEM_TOOL_NAMES is a tool that really exists (a typo is silent);
 *   2. KrewChat actually USES that shared list, rather than an inline literal that can drift.
 *
 * Run: node scripts/check-boss-tools.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bosstools-'));
const stub = path.join(tmp, 'stub.js');
fs.writeFileSync(stub, 'export const invoke=async()=>"";export const emit=async()=>{};export const listen=async()=>(()=>{});');

const bundle = path.join(tmp, 'tools.mjs');
try {
  execFileSync('npx', ['esbuild', 'src/lib/krewTools.ts', '--bundle', '--format=esm', '--platform=node',
    '--outfile=' + bundle, '--log-level=error',
    '--alias:@tauri-apps/api/core=' + stub, '--alias:@tauri-apps/api/event=' + stub],
    { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch (e) {
  console.error('could not bundle krewTools to inspect the boss toolkit:\n' + (e.stderr || e).toString().slice(0, 500));
  process.exit(1);
}

const mod = await import('file://' + bundle.replace(/\\/g, '/'));
const chat = fs.readFileSync(path.join(root, 'src/components/krew/KrewChat.tsx'), 'utf8');
const problems = [];

const allNames = new Set(mod.SYSTEM_TOOLS.map((t) => t.name));
const bossNames = mod.BOSS_SYSTEM_TOOL_NAMES ?? [];

if (!bossNames.length) {
  problems.push('BOSS_SYSTEM_TOOL_NAMES is missing or empty — the boss would have no system tools at all');
}

// 1. A name that does not match a real tool filters to nothing, silently.
for (const name of bossNames) {
  if (!allNames.has(name)) {
    problems.push(`BOSS_SYSTEM_TOOL_NAMES lists "${name}", which is not a tool in SYSTEM_TOOLS — it silently filters to nothing`);
  }
}

// 2. Capabilities the user asks the BOSS for directly, in the boss's own chat. Each of these is
//    here because its absence produced a wrong answer to a real person, not because it seemed tidy.
const MUST_HOLD = [
  ['create_office_document', '"make me a Word proposal and save it to my Desktop" — answered with "I cannot create or save files"'],
  ['list_installed_apps',    'the boss must be able to check what is installed before offering to use it, or it guesses'],
  ['create_calendar_event',  'the boss SAID it had scheduled something, and had not'],
  ['read_my_calendar',       'the boss asked who a meeting was with, when the name was in the event title'],
  ['recall_from_brain',      'the boss reported an empty note as saved, because it could not check'],
];
for (const [name, why] of MUST_HOLD) {
  if (!bossNames.includes(name)) problems.push(`the boss cannot ${name}: ${why}`);
}

// 3. The shared list has to be the one actually used.
if (!/BOSS_SYSTEM_TOOL_NAMES/.test(chat)) {
  problems.push('KrewChat.tsx does not reference BOSS_SYSTEM_TOOL_NAMES — the boss toolkit has drifted back to an inline literal');
}
if (/SYSTEM_TOOLS\.filter\(\s*t\s*=>\s*\[/.test(chat)) {
  problems.push('KrewChat.tsx filters SYSTEM_TOOLS against an inline array again — use BOSS_SYSTEM_TOOL_NAMES so it can be checked here');
}

if (problems.length) {
  console.error('\nBoss toolkit FAILED:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nA missing tool does not throw. It makes the boss deny something the app can do.\n');
  process.exit(1);
}

console.log(`Boss toolkit OK — ${bossNames.length} system tools, all real, shared list in use.`);
