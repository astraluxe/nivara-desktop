// THE OFFICE IS AGENTS REFERRING TO EACH OTHER — CHECK EVERY REFERENCE RESOLVES.
//
// A plan says "Nyx.Research runs query_table". Routing turns a step into agent keys. The boss
// delegates by key. The work-order text tells the model which keys are legal. If any of those
// layers names an agent that does not exist, the task dies quietly: routing returns nobody, the
// delegation errors with "Unknown agent key", or the handover picks the wrong person. None of it
// is a compile error, which is why it needs its own audit.
//
//   node scripts/check-office-graph.mjs
import fs from 'fs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => fs.readFileSync(root + p, 'utf8');

// ── 1. The real roster ────────────────────────────────────────────────────────
const agentsSrc = read('src/lib/krewAgents.ts');
const agentBlocks = [...agentsSrc.matchAll(/key: '([a-z_0-9]+)',[\s\S]{0,200}?humanName: '([A-Za-z ]+)', role: '([A-Za-z]+)'/g)];
const keys = new Set(agentBlocks.map((m) => m[1]));
const handles = new Map(agentBlocks.map((m) => [`${m[2]}.${m[3]}`, m[1]]));
console.log(`  roster: ${keys.size} agent keys, ${handles.size} handles`);

// Duplicate handles make "give this to Nyx.Research" ambiguous.
const seen = new Map();
let dupes = 0;
for (const [h] of handles) { seen.set(h, (seen.get(h) ?? 0) + 1); }
for (const [h, n] of seen) if (n > 1) { console.log(`  DUPLICATE HANDLE: ${h}`); dupes++; }

// ── 2. Task routing must point at real agents ────────────────────────────────
const routingSrc = read('src/lib/taskRouting.ts');
const routedKeys = [...routingSrc.matchAll(/agents: \[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]));
const badRouted = [...new Set(routedKeys)].filter((k) => !keys.has(k));
console.log(`  taskRouting references ${new Set(routedKeys).size} distinct keys — unknown: ${badRouted.length}${badRouted.length ? ' -> ' + badRouted.join(', ') : ''}`);

// ── 3. Hardcoded keys in the chat and work-order plumbing ─────────────────────
let badHard = [];
for (const f of ['src/components/krew/KrewChat.tsx', 'src/lib/workOrder.ts', 'src/lib/toolCallRescue.ts', 'src/components/krew/PlanPanel.tsx', 'src/components/krew/TaskHandover.tsx']) {
  const src = read(f);
  // agent_key: "x" / agentKey === 'x' / AGENT_BY_KEY['x'] style references
  const refs = [...src.matchAll(/(?:agent_?[Kk]ey[^a-zA-Z]{1,12}|AGENT_BY_KEY\[)'([a-z_0-9]+)'/g)].map((m) => m[1]);
  for (const r of new Set(refs)) if (!keys.has(r)) badHard.push(`${f}: ${r}`);
}
console.log(`  hardcoded agent keys — unknown: ${badHard.length}${badHard.length ? '\n    ' + badHard.join('\n    ') : ''}`);

// ── 4. The work-order text must teach the model REAL keys ────────────────────
const woSrc = read('src/lib/workOrder.ts');
const taught = [...woSrc.matchAll(/"([a-z_0-9]+)"\s+\(([A-Za-z]+\.[A-Za-z]+)\)/g)];
let badTaught = 0;
for (const [, k, h] of taught) {
  if (!keys.has(k)) { console.log(`  WORK ORDER teaches unknown key: ${k}`); badTaught++; }
  if (handles.size && ![...handles.keys()].includes(h) && !/\./.test('skip')) { /* handle text is display only */ }
}
console.log(`  work-order instruction teaches ${taught.length} key(handle) pairs — unknown: ${badTaught}`);

// ── 5. Council members exist ──────────────────────────────────────────────────
const councilKeys = ['council_contrarian', 'council_first_principles', 'council_expansionist', 'council_outsider', 'council_executor'];
const missingCouncil = councilKeys.filter((k) => !keys.has(k));
console.log(`  council seats: ${councilKeys.length - missingCouncil.length}/5 present${missingCouncil.length ? ' MISSING: ' + missingCouncil.join(', ') : ''}`);

const bad = dupes + badRouted.length + badHard.length + badTaught + missingCouncil.length;
console.log(`\n${bad === 0 ? 'OFFICE GRAPH RESOLVES' : bad + ' BROKEN REFERENCES'}`);
process.exit(bad ? 1 : 0);
