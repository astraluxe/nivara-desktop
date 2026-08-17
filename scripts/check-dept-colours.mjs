/* Department colours must stay tellable apart. This fails the build if they stop being.
 *
 * WHY THIS EXISTS. The previous palette was picked by eye, and by the time anyone looked
 * properly six of its fifty-five pairs were closer than the eye can separate — Support
 * #15b8c4 against Engineer #10b0c9 measured 8.5 in CIE Lab, which is not "similar", it is
 * the same colour — and five of the eleven were below 3:1 on the light theme, meaning an
 * agent's own name was unreadable inside its own box. None of that showed up as a broken
 * build, a failing test, or anything a reviewer would notice in a diff of hex codes.
 *
 * Every agent's messages are now tinted by department, so "which two departments look
 * alike" stopped being a cosmetic question. This reads the real values out of index.css
 * and measures them.
 *
 * Run: node scripts/check-dept-colours.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.join(here, '..', 'src', 'index.css'), 'utf8');

const MIN_DE = 25;        // below this, two departments read as the same colour
const MIN_CONTRAST = 3;   // an agent's name is written in this colour, on this theme

/* Pull the --nv-dept-* declarations out of each theme block. The dark theme is the bare
   :root; the light theme is :root.paper. Reading the file rather than a duplicated table
   is the point — a copy here could agree with itself while disagreeing with the app. */
function block(selector) {
  const i = CSS.indexOf(selector);
  if (i < 0) throw new Error(`selector ${selector} not found in index.css`);
  const open = CSS.indexOf('{', i);
  let depth = 0, end = open;
  for (let j = open; j < CSS.length; j++) {
    if (CSS[j] === '{') depth++;
    else if (CSS[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  const body = CSS.slice(open, end);
  const out = {};
  for (const m of body.matchAll(/--nv-dept-([a-z]+)\s*:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

const themes = {
  dark:  { colours: block(':root'),       bg: [10, 10, 10] },
  light: { colours: block(':root.paper'), bg: [255, 255, 255] },
};

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

function lab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const problems = [];
let pairs = 0;

for (const [theme, { colours, bg }] of Object.entries(themes)) {
  const names = Object.keys(colours);
  if (names.length !== 11) {
    problems.push(`${theme}: expected 11 departments, found ${names.length} (${names.join(', ')})`);
    continue;
  }
  for (const n of names) {
    const c = contrast(colours[n], bg);
    if (c < MIN_CONTRAST) {
      problems.push(`${theme}: ${n} is ${c.toFixed(1)}:1 on the background — its name would be unreadable in its own box`);
    }
  }
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      pairs++;
      const d = dE(colours[names[i]], colours[names[j]]);
      if (d < MIN_DE) {
        problems.push(`${theme}: ${names[i]} and ${names[j]} are only ${d.toFixed(1)} apart — too close to tell apart (need ${MIN_DE})`);
      }
    }
  }
}

// The same department must be the same HUE on both themes, or its identity changes when
// the user flips the theme and the colour stops meaning anything.
const dHue = ([r, g, b]) => { const [, A, B] = lab([r, g, b]); return (Math.atan2(B, A) * 180) / Math.PI; };
for (const n of Object.keys(themes.dark.colours)) {
  if (!themes.light.colours[n]) { problems.push(`${n} is missing from the light theme`); continue; }
  let diff = Math.abs(dHue(themes.dark.colours[n]) - dHue(themes.light.colours[n]));
  if (diff > 180) diff = 360 - diff;
  if (diff > 25) {
    problems.push(`${n} shifts hue by ${diff.toFixed(0)}° between themes — it should be the same colour, only lighter or darker`);
  }
}

if (problems.length) {
  console.error('\nDepartment colours FAILED:\n');
  for (const p of problems) console.error('  - ' + p);
  console.error(`\n${problems.length} problem(s). See the palette note in src/index.css.\n`);
  process.exit(1);
}

console.log(`Department colours OK — ${pairs} pairs across both themes, all >= ${MIN_DE} dE and >= ${MIN_CONTRAST}:1.`);
