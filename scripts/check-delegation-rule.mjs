/* The boss must be told to delegate by default, and nothing may quietly contradict it.
 *
 * WHY THIS EXISTS. Twice now the office has gone idle because of a sentence, not a bug.
 *
 *   1. "WRITE-IT-YOURSELF EXCEPTION: if the task is to WRITE, EXPLAIN, ADVISE or
 *      STRATEGISE ... do NOT delegate." A content-strategy question is all four, so the
 *      boss answered it itself. Working exactly as written.
 *   2. The replacement carried an escape hatch — "answer yourself when it is a direct
 *      question about their own business, or a decision" — which describes very nearly
 *      everything a founder ever asks. The boss used it, correctly, and the office went
 *      idle again.
 *
 * Neither was a code fault and neither would fail a build. Both were one clause in a
 * 54,000-character prompt outweighing the rule above it. This checks the assembled BOSS
 * prompt — the real string, built by the shipped builder — for the rule's presence and
 * for phrasings that have historically undone it.
 *
 * Run: node scripts/check-delegation-rule.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delegrule-'));
const stub = path.join(tmp, 'stub.js');
fs.writeFileSync(stub, 'export const invoke=async()=>"";export const emit=async()=>{};export const listen=async()=>(()=>{});');

const bundle = path.join(tmp, 'tools.mjs');
try {
  execFileSync('npx', ['esbuild', 'src/lib/krewTools.ts', '--bundle', '--format=esm', '--platform=node',
    '--outfile=' + bundle, '--log-level=error',
    '--alias:@tauri-apps/api/core=' + stub, '--alias:@tauri-apps/api/event=' + stub],
    { cwd: root, stdio: 'pipe', shell: process.platform === 'win32' });
} catch (e) {
  console.error('could not bundle krewTools to inspect the prompt:\n' + (e.stderr || e).toString().slice(0, 500));
  process.exit(1);
}

const mod = await import('file://' + bundle.replace(/\\/g, '/'));
const chat = fs.readFileSync(path.join(root, 'src/components/krew/KrewChat.tsx'), 'utf8');

// The shared prompt the boss receives, plus the override appended to it in KrewChat.
const shared = mod.buildKrewSystemPrompt([...mod.SYSTEM_TOOLS.slice(0, 9), ...mod.BOSS_TOOLS, ...mod.BROWSER_TOOLS]);
const overrideStart = chat.indexOf('BOSS OVERRIDE');
const overrideEnd = chat.indexOf('GREETING EXCEPTION', overrideStart);
if (overrideStart < 0 || overrideEnd < 0) {
  console.error('could not find the BOSS OVERRIDE block in KrewChat.tsx — if it was renamed, update this check');
  process.exit(1);
}
const override = chat.slice(overrideStart, overrideEnd).replace(/\\n/g, '\n').replace(/\\'/g, "'");
const bossPrompt = shared + '\n' + override;

const problems = [];

/* 1. The rule must be there at all. */
const required = [
  ['the delegate-by-default heading', /DELEGATE BY DEFAULT/],
  ['the "is this somebody\'s job" test', /WOULD THIS BE SOMEBODY'S JOB/i],
  ['an exhaustive answer-yourself list', /this list is exhaustive/i],
  ['the one-job-one-person rule', /ONE JOB, ONE PERSON/],
];
for (const [label, re] of required) {
  if (!re.test(override)) problems.push(`missing from the boss override: ${label}`);
}

/* 2. Phrasings that have previously undone it. Each of these authorised the boss to keep
      substantive work on its own desk. */
const banned = [
  [/WRITE-IT-YOURSELF EXCEPTION/i,
   'the original blanket "write it yourself" exception is back'],
  [/answer yourself when[^.]{0,80}\bdecision\b/i,
   '"answer yourself ... a decision" — a decision the user is weighing is exactly what a specialist is for'],
  [/answer (it )?yourself[^.]{0,80}question about (their|your) own business/i,
   '"a question about their own business" describes nearly every request, so it voids the rule'],
  [/Do NOT delegate and do NOT plan_workflow for these/i,
   'a blanket do-not-delegate instruction has returned'],
  [/\bWrite it yourself\.(?!\s*The one case)/i,
   'an unqualified "Write it yourself." — say WHICH narrow case, or it reads as a general licence'],
];
for (const [re, why] of banned) {
  if (re.test(bossPrompt)) problems.push(why);
}

/* 3. The roster has to be reachable from the same prompt, or "delegate" is an empty
      instruction — the boss would be told to pick from a list it cannot see. */
const delegateTool = mod.BOSS_TOOLS.find((t) => t.name === 'delegate_to_agent');
if (!delegateTool) problems.push('delegate_to_agent is not in BOSS_TOOLS');
else {
  const listed = (delegateTool.description.match(/^- [a-z_0-9]+ \(/gm) || []).length;
  if (listed < 30) problems.push(`the delegate roster lists only ${listed} agents — it should carry the whole office`);
  if (!/DEPARTMENT|CONTENT|MARKETING/.test(delegateTool.description)) {
    problems.push('the delegate roster is no longer grouped by department');
  }
}

if (problems.length) {
  console.error('\nDelegation rule FAILED:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(`\n${problems.length} problem(s). The office only works if the boss is told to use it.\n`);
  process.exit(1);
}

console.log(`Delegation rule OK — boss prompt ${bossPrompt.length} chars, roster of ${(mod.BOSS_TOOLS.find((t) => t.name === 'delegate_to_agent').description.match(/^- [a-z_0-9]+ \(/gm) || []).length} agents, no contradicting clause.`);
