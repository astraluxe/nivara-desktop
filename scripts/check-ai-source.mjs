// ─── Every screen obeys the one control ──────────────────────────────────────
//
// THE BUG THIS EXISTS FOR. `krew_ai_stream` is the Rust command nearly every screen uses to talk to
// a model, and its match on `mode` ends `_ => emit_error("Unknown mode: {mode}")`. It has never
// heard of 'agent_cli'. So a screen that resolves the AI source correctly and then hands the result
// straight to it does NOT fall back — it shows the user **"Unknown mode: agent_cli"**.
//
// Five screens did exactly that: the Creator screen, the Research screen, the Automation module,
// Studio, and the Quick Bar. Choosing "Your Claude Code" — the option the whole product strategy
// rests on — broke all five, silently, and nothing in the build said so.
//
// This is the check that would have caught it. Any file that invokes krew_ai_stream must also
// contain a bridge interception, so the sixth caller cannot be written without one.
//
// Run: node scripts/check-ai-source.mjs   (wired into `npm run build`)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const offenders = [];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!/invoke\(\s*['"]krew_ai_stream['"]/.test(src)) continue;
  // Either of the two accepted forms: the shared helper, or an explicit branch on the mode.
  const bridged = /bridgeAnswer\s*\(/.test(src)
    || /mode\s*===\s*['"]agent_cli['"]/.test(src)
    || /src\.mode\s*===\s*['"]agent_cli['"]/.test(src);
  if (!bridged) offenders.push(path.relative(ROOT, f));
}

if (offenders.length) {
  console.error('\nThese talk to krew_ai_stream without handling the Claude Code / Codex bridge.');
  console.error('Choosing "Your Claude Code" in the title bar would show the user "Unknown mode: agent_cli".');
  console.error('Fix: call bridgeAnswer(src, messages, systemPrompt, onChunk) first — it returns null when');
  console.error('the bridge is not the chosen source, so carrying on is a two-line addition.\n');
  for (const o of offenders) console.error('  ' + o);
  console.error('');
  process.exit(1);
}

const count = files.filter((f) => /invoke\(\s*['"]krew_ai_stream['"]/.test(fs.readFileSync(f, 'utf8'))).length;
console.log(`ai-source: ${count} screens talk to krew_ai_stream, all of them handle the bridge.`);
