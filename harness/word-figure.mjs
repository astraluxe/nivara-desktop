// ─── A picture in the Word document, through real Word ───────────────────────
//
// A student attached four lecture decks with 32 figures, asked for a study guide, and got one with
// none of the diagrams in it. Their report: "it didnt put any img. or anything anywhere".
//
// Word could not hold one. A WordBlock was a style and a string, so there was nothing a picture
// could be — the figures were extracted, listed, and had nowhere to go. `style: 'figure'` is that
// somewhere, and this drives the real COM path to prove the picture ends up inside the file rather
// than merely being asked for.
//
// It also pins the ENCODING, which matters more here than anywhere else in the app: this is an
// Indian product and ₹ is in half the documents it will ever write. While building this I saw the
// title come back as "Edge Computing â€" figure test" — but that was my own scratch harness writing
// a .ps1 as UTF-8 with no BOM and running it with -File, which PowerShell 5.1 reads as ANSI. The
// app passes the script to -Command, where argv is UTF-16 and the characters survive. The
// difference is invisible until you look, so it is asserted here.
//
// Run: node harness/word-figure.mjs      (skips cleanly without Windows or Word)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

if (process.platform !== 'win32') {
  console.log('not Windows — skipping (this test drives real Word).');
  process.exit(0);
}
const WORD = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE';
if (!fs.existsSync(WORD)) {
  console.log('Word is not installed on this machine — skipping.');
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '\n        ' + x : '')); } };

// Build the shipped module the same way the unit runner does.
const tmp = path.join(ROOT, 'node_modules', '.cache', 'nv-harness');
fs.mkdirSync(tmp, { recursive: true });
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild.cmd');
execFileSync(esbuild, [path.join(ROOT, 'src/lib/officeCom.ts'), '--bundle', '--format=esm',
  `--outfile=${path.join(tmp, 'officeCom.js')}`], { shell: true, stdio: 'ignore' });
const { buildScript } = await import('file://' + path.join(tmp, 'officeCom.js').replace(/\\/g, '/'));

// A real 64×64 PNG, so Word is given something genuine to place.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAWklEQVR42u3PMQEAAAgDoJnc6BpjDyRgSjvVBQEB'
  + 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBK7ABlQAB0e0PsQAAAABJRU5ErkJggg==',
  'base64');
const figPath = path.join(process.env.TEMP, 'nv-fig-test.png');
fs.writeFileSync(figPath, PNG);

const out = path.join(process.env.TEMP, 'nv-word-figure.docx');
try { fs.unlinkSync(out); } catch { /* not there */ }

const spec = {
  kind: 'word', savePath: out, visible: false, typeDelayMs: 0,
  blocks: [
    { style: 'title',  text: 'Edge Computing — the ₹2,999 “essentials” guide' },
    { style: 'body',   text: 'Cost saved: ₹1,25,000 per year — measured over 12 months.' },
    { style: 'figure', text: 'The four layers, from sensors to cloud.', path: figPath },
    { style: 'body',   text: 'Each layer does one job.' },
    // A figure whose file is not there. The caption must survive and the document must not die —
    // losing the rest of a study guide because one picture moved would be a far worse failure.
    { style: 'figure', text: 'A figure that could not be found.', path: 'C:/definitely/not/here.png' },
    { style: 'bullet', text: 'A bullet after it all.' },
  ],
};

console.log('\n=== drive real Word, exactly as the app does ===');
// -Command with the script as an argument, matching run_powershell in lib.rs. NOT -File: that path
// needs a BOM and silently mangles ₹.
let ran = '';
try {
  ran = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', buildScript(spec)],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 1 << 24 });
} catch (e) { ran = String(e.stdout || e.message); }
const result = (ran.trim().split('\n').pop() || '').trim();
ok('Word reported success', /"ok"\s*:\s*true/.test(result), result.slice(0, 200));
ok('the file exists', fs.existsSync(out));

console.log('\n=== what is actually inside it ===');
const JSZip = require(path.join(ROOT, 'node_modules', 'jszip'));
const zip = await JSZip.loadAsync(fs.readFileSync(out));
const media = Object.keys(zip.files).filter((n) => n.startsWith('word/media/'));
const xml = await zip.files['word/document.xml'].async('string');
const text = (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(' | ');

ok('the picture is embedded in the document', media.length === 1, `${media.length}: ${media.join(', ')}`);
ok('...as a real drawing, not a placeholder', xml.includes('<w:drawing>'));
ok('a figure that could not be found keeps its caption', text.includes('A figure that could not be found'));
ok('...and costs the document nothing else', text.includes('A bullet after it all'));
ok('every text block is present', ['Each layer does one job', 'The four layers'].every((t) => text.includes(t)), text);

console.log('\n=== the characters this product cannot afford to lose ===');
ok('the rupee sign survives', text.includes('₹'), text.slice(0, 120));
ok('the em dash survives', text.includes('—'));
ok('curly quotes survive', text.includes('“') && text.includes('”'));
ok('nothing arrived as mojibake', !/Ã|â€/.test(text), text.slice(0, 160));

console.log(`\n${pass} passed, ${fail} failed`);
console.log('file: ' + out);
process.exit(fail ? 1 : 0);
