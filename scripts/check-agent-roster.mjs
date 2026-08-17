/* Every agent reachable, and nobody named who does not exist. Fails the build otherwise.
 *
 * WHY THIS EXISTS. delegate_to_agent carried a hand-typed list of 22 agent keys while the
 * roster had grown to 55. Thirty-three agents — the whole Support department, most of
 * Designer, the social manager, the script writers — could not be delegated to at all,
 * however plainly the user asked. And one key on that list, blog_writer, named an agent
 * that had never been defined: the boss was instructed by three separate prompts to send
 * blog posts to it, and every one of those ended in "Unknown agent key" and a wasted turn.
 *
 * Neither fault was visible in either file on its own. They only appeared when the two were
 * compared, which nothing did. This compares them.
 *
 * Run: node scripts/check-agent-roster.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const agentsSrc = read('src/lib/krewAgents.ts');
const toolsSrc  = read('src/lib/krewTools.ts');
const routeSrc  = read('src/lib/taskRouting.ts');
const chatSrc   = read('src/components/krew/KrewChat.tsx');

/* Defined agents, and which of them the boss may delegate to. Mirrors DELEGATABLE_AGENTS:
   the boss cannot delegate to itself, and the council is convened as a group of five by
   council_review rather than tasked one at a time. */
const defined = [...agentsSrc.matchAll(/key:\s*'([a-z_0-9]+)',\s*name:\s*'/g)].map((m) => m[1]);
const categoryOf = {};
for (const m of agentsSrc.matchAll(/key:\s*'([a-z_0-9]+)',[\s\S]{0,300}?category:\s*'(\w+)'/g)) {
  categoryOf[m[1]] = m[2];
}
const delegatable = new Set(defined.filter((k) => k !== 'boss' && categoryOf[k] !== 'Council'));

const problems = [];

if (defined.length < 10) problems.push(`only parsed ${defined.length} agents — the parser is broken, not the roster`);

/* 1. The tool description must be generated. A literal list here is the original bug. */
if (!/delegationRoster\(\)/.test(toolsSrc)) {
  problems.push('delegate_to_agent no longer builds its list from delegationRoster() — a hand-written list will drift out of date again');
}
if (/^\s*\+?\s*'?-\s+[a-z_]+\s+→/m.test(toolsSrc)) {
  problems.push('krewTools.ts contains a hand-written "- agent_key → description" list again');
}

/* 2. Nobody may be named who does not exist. These are the three places an agent key is
      referred to by name outside the roster itself — including the routing table in the
      boss prompt, which is where blog_writer hid. */
const referenced = new Map(); // key -> where
const note = (k, where) => { if (!referenced.has(k)) referenced.set(k, where); };

for (const m of routeSrc.matchAll(/agents:\s*\[([^\]]*)\]/g)) {
  for (const k of m[1].matchAll(/'([a-z_0-9]+)'/g)) note(k[1], 'taskRouting.ts');
}
for (const src of [agentsSrc, chatSrc, toolsSrc]) {
  for (const m of src.matchAll(/agent_key\\?"\s*:\s*\\?"([a-z_0-9]+)/g)) note(m[1], 'a prompt example');
  for (const m of src.matchAll(/delegate_to_agent with ([a-z_0-9]+)/g)) note(m[1], 'a prompt instruction');
}
/* The markdown routing table inside the boss prompt — the last cell of each row is the
   agent key. Scanned by locating the table rather than by matching pipes anywhere, because
   this file also contains pipe-separated enums ("gmail|x_mentions|rss") and other tables. */
{
  const head = agentsSrc.indexOf('| Topic | agent_key |');
  if (head < 0) {
    problems.push('the ROUTING TABLE in the boss prompt could not be found — if it was renamed, update this check');
  } else {
    for (const line of agentsSrc.slice(head).split('\n').slice(2)) {
      const row = line.trim();
      if (!row.startsWith('|')) break;                       // end of the table
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      const key = cells[cells.length - 1];
      if (/^[a-z][a-z_0-9]{3,}$/.test(key)) note(key, 'the routing table in the boss prompt');
    }
  }
}

const known = new Set(defined);
for (const [key, where] of referenced) {
  if (!known.has(key)) {
    problems.push(`"${key}" is named in ${where} but no such agent exists — every attempt to use it fails with "Unknown agent key"`);
  } else if (!delegatable.has(key) && key !== 'boss') {
    problems.push(`"${key}" is named in ${where} but is excluded from delegation`);
  }
}

/* 3. No agent may be stranded. Anything defined and not council/boss must be delegatable —
      that is what "all agents connected" means. */
const stranded = defined.filter((k) => k !== 'boss' && categoryOf[k] !== 'Council' && !delegatable.has(k));
if (stranded.length) problems.push(`unreachable agents: ${stranded.join(', ')}`);

/* 4. Agent choice must not go back to matching words. */
for (const rule of ['isGTM', 'isColdOutreach', 'isPricing', 'isCompetitor']) {
  if (new RegExp(`const\\s+${rule}\\s*=`).test(chatSrc)) {
    problems.push(`${rule} is back: agent choice is being decided by a keyword pattern again, which misses every phrasing it was not written for`);
  }
}

/* 5. Every agent needs a description — it is now the only thing the boss routes on. */
for (const k of delegatable) {
  const m = agentsSrc.match(new RegExp(`key:\\s*'${k}',[\\s\\S]{0,300}?description:\\s*'([^']*)'`));
  if (!m || m[1].trim().length < 12) {
    problems.push(`${k} has no usable description — the boss chooses from descriptions, so it would never be picked`);
  }
}

if (problems.length) {
  console.error('\nAgent roster FAILED:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(`\n${problems.length} problem(s).\n`);
  process.exit(1);
}

const depts = new Set(Object.values(categoryOf));
console.log(`Agent roster OK — ${defined.length} agents, ${delegatable.size} delegatable across ${depts.size - 2} departments, no dangling references.`);
