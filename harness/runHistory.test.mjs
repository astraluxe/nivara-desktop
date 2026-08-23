import { trimRunHistory } from './runHistory.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, '\n    got :', g, '\n    want:', w); }
};
const U = (c) => ({ role: 'user', content: c });
const A = (c) => ({ role: 'assistant', content: c });

// ── The bug, reproduced exactly ──────────────────────────────────────────────
// A conversation that already had 8 messages, then the real request, then two tool-call pairs.
const OLD = 'hi, can you help with my leads?';          // the chat's FIRST message, days ago
const TASK = 'idk how B2B deals work... explain the phases and agreements';
const prior = [U(OLD), A('sure'), U('thanks'), A('np'), U('another thing'), A('ok'), U('and this'), A('done')];

// What the OLD code did: keep index 0 + last 8.
const oldTrim = (h) => { const c = h.slice(); if (c.length > 9) c.splice(1, c.length - 9); return c; };

// Four rounds is all it takes: each trim eats two of the older entries, and once they run out
// the request itself is next in line. Round 0-2 it survives; on round 3 it is spliced away.
const rounds = (n, trim) => {
  let h = [...prior, U(TASK)];
  for (let r = 0; r < n; r++) { h.push(A('<tool_call>…</tool_call>'), U(`<tool_result>result ${r}</tool_result>`)); h = trim(h); }
  return h;
};
eq('OLD trim: task still there after 3 rounds', rounds(3, oldTrim).some((m) => m.content === TASK), true);
const h = rounds(4, oldTrim);
eq('OLD trim keeps the wrong first message', h[0].content, OLD);
eq('OLD trim has LOST the real task by round 4', h.some((m) => m.content === TASK), false);

// What the NEW code does, same run.
const n = rounds(4, (h) => trimRunHistory(h, TASK));
eq('NEW trim STILL HAS the real task at round 4', n.some((m) => m.content === TASK), true);
eq('NEW trim: the task is the anchor at the front', n[0].content, TASK);
eq('NEW trim still bounded to 9', n.length <= 9, true);
eq('NEW trim keeps the newest tool result', n[n.length - 1].content, '<tool_result>result 3</tool_result>');
// And while it is still inside the tail (round 3) it is kept without being copied to the front.
const n3 = rounds(3, (h) => trimRunHistory(h, TASK));
eq('NEW trim at round 3: task present exactly once', n3.filter((m) => m.content === TASK).length, 1);

// Long run: the task must survive round after round, not just the first trim.
let long = [...prior, U(TASK)];
for (let round = 0; round < 40; round++) {
  long.push(A('call'), U(`<tool_result>r${round}</tool_result>`));
  long = trimRunHistory(long, TASK);
}
eq('task survives 40 rounds', long[0].content, TASK);
eq('still bounded after 40 rounds', long.length <= 9, true);

// ── No duplication when the task is already in the tail ──────────────────────
let fresh = [U(TASK)];
fresh.push(A('call'), U('<tool_result>x</tool_result>'));
fresh = trimRunHistory(fresh, TASK);
eq('short run untouched', fresh.length, 3);
eq('no duplicate anchor on short run', fresh.filter((m) => m.content === TASK).length, 1);

// Exactly at the boundary (9 entries) — unchanged, same as the old bound.
const nine = [U(TASK), ...Array.from({ length: 8 }, (_, i) => A('m' + i))];
eq('9 entries untouched', trimRunHistory(nine, TASK).length, 9);
const ten = [U(TASK), ...Array.from({ length: 9 }, (_, i) => A('m' + i))];
eq('10 entries trimmed to 9', trimRunHistory(ten, TASK).length, 9);
eq('10 entries keep the anchor', trimRunHistory(ten, TASK)[0].content, TASK);

// A task still inside the tail is not copied to the front twice.
const inTail = [A('old0'), A('old1'), U(TASK), A('a'), U('b'), A('c'), U('d'), A('e'), U('f'), A('g')];
const tr = trimRunHistory(inTail, TASK);
eq('anchor already in tail → not duplicated', tr.filter((m) => m.content === TASK).length, 1);
eq('anchor already in tail → tail only', tr.length, 8);

// Empty/blank request must never become a blank user turn.
const blank = trimRunHistory(ten, '   ');
eq('blank anchor keeps head instead of a blank turn', blank[0].content, TASK);
eq('blank anchor still bounded', blank.length, 9);

// Delegation-shaped history (index 0 IS the task) behaves exactly as before.
const del = [U('do the thing'), ...Array.from({ length: 10 }, (_, i) => A('m' + i))];
const dt = trimRunHistory(del, 'do the thing', 6);
eq('delegation keeps its task', dt[0].content, 'do the thing');
eq('delegation bounded to 7', dt.length, 7);

// Input is never mutated.
const orig = [...prior, U(TASK), A('x'), U('y')];
const copy = JSON.parse(JSON.stringify(orig));
trimRunHistory(orig, TASK);
eq('input not mutated', orig, copy);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
