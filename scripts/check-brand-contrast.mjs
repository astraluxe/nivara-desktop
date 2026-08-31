// ─── Every brand mark must be visible in BOTH themes ─────────────────────────
//
// The AI-source menu in the title bar draws these at full brand colour. Measured against the two
// menu backgrounds, ELEVEN of twenty-three fell below the 3:1 floor for a graphical object:
// OpenAI, GitHub, Notion, X, Vercel and Slack were a hole in the dark menu where a logo should be,
// and NVIDIA, Airtable, Shopify and Claude washed out on paper. Nobody had looked at both themes.
//
// The eleven now take their colour from a per-theme CSS variable. This check re-measures every mark
// and fails the build if any of them — a new one included — cannot be seen on one of the two
// backgrounds.
//
// Run: node scripts/check-brand-contrast.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = fs.readFileSync(path.join(ROOT, 'src/components/ui/BrandLogo.tsx'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');

/** The two surfaces a mark is drawn on, read from the stylesheet rather than hardcoded here. */
function surface(themeSelector) {
  const block = css.slice(css.indexOf(themeSelector));
  const m = /--nv-surface-rgb:\s*(\d+)\s+(\d+)\s+(\d+)/.exec(block);
  if (!m) throw new Error(`could not read --nv-surface-rgb for ${themeSelector}`);
  return [+m[1], +m[2], +m[3]];
}
const INK = surface(':root {');
const PAPER = surface(':root.paper {');

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const FLOOR = 3;   // WCAG 1.4.11, non-text contrast

// The plain hues.
const block = logo.slice(logo.indexOf('const BRAND_HEX'), logo.indexOf('};', logo.indexOf('const BRAND_HEX')));
const marks = [...block.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2]]);

/** The per-theme override for a mark, if it has one. */
function themed(id, selector) {
  const start = css.indexOf(selector, css.indexOf('Brand marks that vanish'));
  if (start < 0) return null;
  const body = css.slice(start, css.indexOf('}', start));
  const m = new RegExp(`--brand-${id}:\\s*(#[0-9a-fA-F]{6})`).exec(body);
  return m ? m[1] : null;
}

const problems = [];
for (const [id, hex] of marks) {
  const ink = themed(id, ':root {') || hex;
  const paper = themed(id, ':root.paper {') || hex;
  const rInk = ratio(hex2rgb(ink), INK);
  const rPaper = ratio(hex2rgb(paper), PAPER);
  if (rInk < FLOOR) problems.push(`${id}: ${ink} on the dark menu is ${rInk.toFixed(2)}:1 — needs ${FLOOR}:1`);
  if (rPaper < FLOOR) problems.push(`${id}: ${paper} on the light menu is ${rPaper.toFixed(2)}:1 — needs ${FLOOR}:1`);
}

// A mark listed as themed in the component must actually have both variables, or it silently falls
// back to `var(--brand-x)` with no value and paints nothing at all.
const set = /const THEMED = new Set\(\[([^\]]*)\]\)/.exec(logo);
if (set) {
  for (const id of set[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)) {
    if (!themed(id, ':root {') || !themed(id, ':root.paper {')) {
      problems.push(`${id} is listed in THEMED but has no --brand-${id} in one of the themes — it would paint nothing`);
    }
  }
}

if (problems.length) {
  console.error('\nBrand marks that cannot be seen:\n');
  for (const p of problems) console.error('  ' + p);
  console.error('\n  Add a per-theme value to the brand block in src/index.css and list the id in THEMED.\n');
  process.exit(1);
}
console.log(`brand contrast: ${marks.length} marks, all >= ${FLOOR}:1 on both the dark and light menu`);
