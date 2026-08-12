// EVERY SURFACE THAT CALLS A MODEL MUST HONOUR THE USER'S CHOICE.
//
// Written after finding that the connection picker reached exactly one screen. Krew read its own
// stored choice; Coder hardcoded 'nivara' on every mount; Creator, Research and Studio each walked
// a hardcoded provider list and took the first key they found; Guard and Automations used the
// separate aiSource preference. Choosing OmniRoute — or a specific NVIDIA model — changed the Krew
// chat and nothing else, and every one of them passed baseUrl: null, so a user-run gateway could
// not have worked there even by accident.
//
//   node scripts/check-ai-callers.mjs
import fs from 'fs';
import path from 'path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(path.join(root, 'src'));

let bad = 0;
console.log('  surfaces that stream from a model:\n');
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  if (!/invoke\(\s*'(krew_)?ai_stream'/.test(src)) continue;
  // src/lib/ai.ts is the shared TRANSPORT, not a decider: it takes an opts object and forwards it.
  // Requiring it to resolve a preference would be requiring it to ignore its own arguments.
  const rel = path.relative(root, f).split(String.fromCharCode(92)).join('/');
  if (rel === 'src/lib/ai.ts') continue;

  // How does it decide? Either the shared resolver, or the persisted connection the bar writes.
  const shared = /resolveAiSource\s*\(/.test(src);
  const barStore = /nv-krew-connection/.test(src);
  const honours = shared || barStore;

  // Does it throw the gateway address away? That is what makes OmniRoute impossible.
  //
  // Only INSIDE the invoke call. A `baseUrl: null` elsewhere is usually a legitimate fallback for
  // hosted mode, where there genuinely is no gateway address — flagging those made the check cry
  // wolf, and a check that cries wolf gets ignored.
  const calls = [...src.matchAll(new RegExp(String.raw`invoke\(\s*'(?:krew_)?ai_stream'\s*,\s*\{[\s\S]{0,900}?\}\)`, 'g'))].map((m) => m[0]);
  const nullsBase = calls.some((c) => /baseUrl:\s*null\s*[,}]/.test(c));

  const flags = [];
  if (!honours) flags.push('IGNORES THE USER CHOICE');
  if (nullsBase) flags.push('DROPS baseUrl');
  if (flags.length) bad++;
  console.log(`  ${flags.length ? 'WARN' : ' ok '}  ${rel.padEnd(42)} ${shared ? 'aiSource' : barStore ? 'connection-bar' : '—'}${flags.length ? '  [' + flags.join(', ') + ']' : ''}`);
}
console.log(`\n${bad === 0 ? 'EVERY AI SURFACE HONOURS THE CHOICE' : bad + ' need a look'}`);
process.exit(bad ? 1 : 0);
