// ─── No control characters in source ─────────────────────────────────────────
//
// A regex written through a shell can arrive with its escapes eaten. `\b` becomes a literal
// BACKSPACE byte (0x08), `\s` becomes the letter "s", `\n` becomes a real newline. The file still
// compiles, the editor shows something that looks right, and the code is quietly wrong.
//
// That is not hypothetical here. `deckRouting.ts` shipped with this:
//
//     return /<BS>(change|edit|replace|…|turn)<BS>/.test(t);
//
// The word boundaries had become backspace characters, so the pattern could only match text
// containing a backspace — which no chat message contains. It was the last line of `isDeckEdit`,
// so EVERY in-chat deck edit ("put my logo on slide 1", "remove slide 4") silently returned false
// and fell through to the boss. Nothing failed loudly; the feature just never worked.
//
// A control character in a source file is never intentional, so this is a cheap, absolute rule.
//
// Run: node scripts/check-source-chars.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'harness', 'scripts', 'src-tauri/src'];
const EXT = /\.(ts|tsx|js|jsx|mjs|rs|css)$/;

// Tab, newline and carriage return are the only ones that belong in a text file.
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;
const NAMES = {
  8: 'BACKSPACE — almost certainly a \\b (word boundary) eaten by a shell',
  12: 'FORM FEED — almost certainly a \\f',
  27: 'ESCAPE — a terminal colour code that was pasted in',
  0: 'NUL',
};

function walk(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'target' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

const problems = [];
for (const dir of DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    const text = fs.readFileSync(file, 'utf8');
    // A FRESH regex per file, and matchAll rather than a while/exec loop. The first version shared
    // one /g regex between the scan and the line-formatting below, and `String.replace` resets
    // lastIndex — so exec restarted at zero and the check never finished.
    const found = [...text.matchAll(new RegExp(BAD.source, 'g'))];
    if (found.length === 0) continue;
    const lines = text.split('\n');
    for (const m of found) {
      const code = text.charCodeAt(m.index);
      const line = text.slice(0, m.index).split('\n').length;
      const src = (lines[line - 1] || '').replace(new RegExp(BAD.source, 'g'), (c) => `<${c.charCodeAt(0)}>`);
      problems.push(
        `${path.relative(ROOT, file).split(path.sep).join('/')}:${line}\n` +
        `    control character ${code} (0x${code.toString(16).padStart(2, '0')}) — ${NAMES[code] || 'not valid in source'}\n` +
        `    ${src.trim().slice(0, 110)}`,
      );
    }
  }
}

if (problems.length) {
  console.error('\nControl characters in source — a regex escape was almost certainly eaten:\n');
  for (const p of problems) console.error('  ' + p + '\n');
  console.error('  Write the file with the Write tool or a .mjs script, never through a shell heredoc.\n');
  process.exit(1);
}
console.log('source characters: clean');
