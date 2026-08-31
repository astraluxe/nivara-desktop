// ─── Every nv- class in a className has to actually exist ────────────────────
//
// This check exists because the same mistake has now shipped twice.
//
// The design system keeps two different kinds of thing under the same `nv-` prefix: CSS VARIABLES
// (`--nv-surface`, `--nv-border`) and CSS CLASSES (`.nv-sheet`, `.nv-card`). They read identically
// in a diff, so `className="nv-surface nv-border"` looks exactly like working code. It is not: no
// such classes exist, the browser ignores them without a word, and the element renders with NO
// BACKGROUND AND NO BORDER. The first time, an outreach popup shipped fully transparent. The second
// time, the office room's hover tooltip did — the room's own labels read straight through it.
//
// Nothing catches this. It is not a type error, it is not a lint error, the build succeeds, and the
// screen only looks wrong if someone happens to open that one panel over a busy background. So it
// gets an assertion of its own.
//
// SCOPE: bare `nv-*` tokens in a JSX `className` attribute, which is where the confusion lives.
//
// Two things are deliberately out of scope. Tailwind colour utilities (`text-nv-faint`,
// `bg-nv-surface2`) are a different mechanism, resolved by Tailwind's own config. And
// `el.className = '...'` on an imperatively built element is skipped, because that code styles
// itself through `style.cssText` and uses the class only as a marker to find the node again — the
// Brain's column menu does exactly that, and it is not a bug.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const CSS = 'src/index.css';

// ── What exists ──────────────────────────────────────────────────────────────
const css = readFileSync(CSS, 'utf8');
const defined = new Set([...css.matchAll(/^\s*\.(nv-[a-z0-9-]+)/gm)].map((m) => m[1]));
// A keyframes name is not a class, but `.nv-rise` and friends are declared as classes above them,
// so nothing extra is needed here — this is only a note for whoever reads the set and wonders.

// ── Where className values are ───────────────────────────────────────────────
/**
 * Pull out the value of every `className=`, quoted or braced.
 *
 * Braced values need real brace matching rather than a regex: `className={cx('a', b ? 'c' : 'd')}`
 * contains braces, quotes and template literals, and a lazy `\{.*?\}` stops at the first one it
 * meets and silently checks half an expression.
 */
function classNameValues(src) {
  const out = [];
  // Not preceded by a dot: `className=` is a JSX attribute, `.className =` is a DOM assignment.
  const re = /(^|[^.\w])className\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const open = src[i];
    if (open === '"' || open === "'") {
      const end = src.indexOf(open, i + 1);
      if (end > 0) out.push(src.slice(i + 1, end));
      continue;
    }
    if (open !== '{') continue;
    let depth = 0, quote = '';
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (quote) {
        if (c === '\\') { j++; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { out.push(src.slice(i + 1, j)); break; } }
    }
  }
  return out;
}

/** The literal text inside an expression — the only part that can be a class name. */
function literals(expr) {
  return [...expr.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    // `${...}` is computed at runtime and cannot be checked from here.
    .map((s) => s.replace(/\$\{[^}]*\}/g, ' '));
}

function tokens(text) {
  return text.split(/\s+/).filter(Boolean).map((t) => {
    // hover:, md:, group-hover: ... the class is whatever follows the last variant.
    const bare = t.slice(t.lastIndexOf(':') + 1);
    // A trailing /70 is Tailwind's opacity modifier, not part of the name.
    return bare.split('/')[0];
  });
}

// ── Walk ─────────────────────────────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
})(SRC);

const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const value of classNameValues(src)) {
    const texts = value.trimStart().startsWith('{') || /['"`]/.test(value) ? literals(value) : [value];
    for (const text of [...texts, value.includes("'") || value.includes('"') || value.includes('`') ? '' : value]) {
      for (const t of tokens(text)) {
        if (!t.startsWith('nv-') || defined.has(t)) continue;
        const line = src.slice(0, src.indexOf(t)).split('\n').length;
        bad.push({ f, line, t });
      }
    }
  }
}

if (bad.length) {
  console.error('\nclassName uses nv- classes that do not exist in src/index.css:\n');
  const seen = new Set();
  for (const b of bad) {
    const k = `${b.f}:${b.t}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.error(`  ${b.f}:${b.line}  "${b.t}"`);
    // The overwhelmingly likely cause, said plainly.
    if (css.includes(`--${b.t}:`)) {
      console.error(`      --${b.t} is a CSS VARIABLE, not a class. This element will render with`);
      console.error('      no background and no border. For a floating panel use "nv-sheet"; for a');
      console.error('      static one "nv-card". For a colour use a Tailwind utility, e.g. bg-nv-surface2.');
    }
  }
  console.error(`\n${seen.size} bad class ${seen.size === 1 ? 'reference' : 'references'}.\n`);
  process.exit(1);
}

console.log(`check-classes: ${files.length} files, every nv- class resolves.`);
