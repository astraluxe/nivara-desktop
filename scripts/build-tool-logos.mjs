// ─── The Shelf's logos, taken from the real assets ───────────────────────────
//
// The rail used to draw two-letter INITIALS — "n8", "OD", "ER". That is a placeholder, and it makes
// a catalogue of real software look like a list of abbreviations.
//
// **These marks are NOT drawn from memory.** That rule is not academic here: the Claude mark in
// Connect Apps was drawn by eye twice and was wrong twice, and doing that eighteen times over would
// have shipped eighteen subtly-wrong logos that look fine until someone who knows the product sees
// them. Every mark below is downloaded from a source the project itself publishes, and this script
// is the record of which one.
//
// Run it again to refresh:  node scripts/build-tool-logos.mjs
// It writes src/lib/toolLogos.ts, which IS committed — the app must never fetch a logo at runtime.
//
// ── ON TRADEMARKS ───────────────────────────────────────────────────────────
//
// These are other people's trademarks. We use them to IDENTIFY their software in a catalogue that
// installs it unmodified — nominative use, the same thing an app store does. Two rules follow, and
// both are enforced by how this file works:
//   1. The mark is never altered, recoloured or redrawn. It is passed through as published.
//   2. It is never used to suggest that adris is that product, or endorsed by it. In the UI it
//      always sits beside the project's own name.
// If any project asks us to stop, delete its line from SOURCES and re-run. That is the whole cost.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'src', 'lib', 'toolLogos.ts');

/**
 * Where each mark comes from.
 *
 * `simpleicons` is preferred wherever it has the project: those are single-path marks drawn for
 * exactly this size, in the brand's own colour, and they are ~500 bytes each. Everything else comes
 * from the project's own repository or GitHub organisation avatar.
 *
 * WORDMARKS ARE THE TRAP. Simple Icons carries Cal.com, odoo and Twenty as the WORDS, and EspoCRM
 * and Flowise publish 318×78 and 216×91 wordmarks in their own repos. All five are correct marks and
 * all five are an unreadable smudge at eighteen pixels. Where a project publishes only a wordmark,
 * its square avatar is used instead. Checking that — rather than taking the first file that turns up
 * — is the whole reason this is a script and not a copy-paste.
 */
const SOURCES = {
  metabase:     { url: 'https://cdn.simpleicons.org/metabase',      kind: 'simple' },
  baserow:      { url: 'https://cdn.simpleicons.org/baserow',       kind: 'simple' },
  chatwoot:     { url: 'https://cdn.simpleicons.org/chatwoot',      kind: 'simple' },
  erpnext:      { url: 'https://cdn.simpleicons.org/erpnext',       kind: 'simple' },
  akaunting:    { url: 'https://cdn.simpleicons.org/akaunting',     kind: 'simple' },

  // WORDMARKS, swapped for the project's square avatar. Simple Icons carries "Cal.com", "odoo" and
  // "twenty" as the words themselves — correct marks, and completely illegible at eighteen pixels,
  // where they render as a grey smudge. A logo you cannot read is not a logo.
  calcom:       { url: 'https://cal.com/android-chrome-192x192.png', kind: 'png' },
  odoo:         { url: 'https://github.com/odoo.png',     kind: 'png' },
  twentycrm:    { url: 'https://github.com/twentyhq.png', kind: 'png' },

  // NEAR-BLACK MARKS. Both are a dark glyph with no ground of their own, which vanished against the
  // dark rail. The avatars carry the project's own background, and every mark now sits on a neutral
  // tile besides — see ToolMarkIcon.
  invoiceninja: { url: 'https://github.com/invoiceninja.png', kind: 'png' },
  dolibarr:     { url: 'https://github.com/Dolibarr.png',     kind: 'png' },

  // NOTE — MICROSOFT'S OWN ICONS ARE DELIBERATELY NOT HERE.
  //
  // Word, Excel and PowerPoint appear on the rail as the user's own installed applications, and the
  // obvious thing would be to ship their real logos. Simple Icons has REMOVED all Microsoft marks
  // from its set, which is what a trademark request looks like, and Microsoft's brand guidelines
  // restrict third-party use of the Office icons.
  //
  // Redrawing them by eye is not an option either — that rule exists because the Claude mark was
  // drawn by eye twice and was wrong twice. So those three use neutral glyphs of our own drawing
  // (a document, a grid, a slide) with the real product NAME beside them, which identifies the app
  // without borrowing a mark we have no licence for.

  focalboard: { url: 'https://raw.githubusercontent.com/mattermost/focalboard/main/webapp/static/favicon.svg', kind: 'svg' },
  zammad:     { url: 'https://raw.githubusercontent.com/zammad/zammad/develop/public/assets/images/icons/logo.svg', kind: 'svg' },

  documenso: { url: 'https://github.com/documenso.png',  kind: 'png' },
  kimai:     { url: 'https://raw.githubusercontent.com/kimai/kimai/main/public/touch-icon-192x192.png', kind: 'png' },
  openwebui: { url: 'https://raw.githubusercontent.com/open-webui/open-webui/main/static/favicon.png',  kind: 'png' },
  espocrm:   { url: 'https://github.com/espocrm.png',    kind: 'png' },
  flowise:   { url: 'https://github.com/FlowiseAI.png',  kind: 'png' },
};

/** Rasters are stored at this size. Big enough for a 20px rail on a 2× display, small enough that
 *  five of them do not bloat the bundle. */
const PNG_PX = 48;

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** A Simple Icons file is one path and one fill. Both are wanted, unaltered. */
function readSimple(svg) {
  const colour = (svg.match(/fill="(#[0-9A-Fa-f]{3,8})"/) || [])[1];
  const d = (svg.match(/<path[^>]*\sd="([^"]+)"/) || [])[1];
  if (!colour || !d) throw new Error('not a Simple Icons file');
  return { kind: 'path', d, colour };
}

/** A project's own SVG: keep its markup exactly, and only record the box it was drawn in. */
function readSvg(svg) {
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1];
  if (!viewBox) throw new Error('no viewBox');
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { kind: 'svg', viewBox, inner };
}

/**
 * Downscale a raster in a real browser.
 *
 * A 192px touch icon is 40 KB; five of those inlined is a fifth of a megabyte for icons that render
 * at twenty pixels. Chrome's own image scaler is used rather than a hand-rolled one because it
 * resamples properly — a nearest-neighbour shrink of a logo looks broken in a way that is obvious.
 */
async function shrink(buffers) {
  const PW = process.env.NV_PLAYWRIGHT
    || path.join(process.env.LOCALAPPDATA || '', 'tech.nivara.desktop', 'tools', 'playwright', 'node_modules', 'playwright-core', 'index.js');
  const { chromium } = (await import(pathToFileURL(PW).href)).default;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const out = {};
    for (const [id, buf] of Object.entries(buffers)) {
      out[id] = await page.evaluate(async ([b64, px]) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = px; c.height = px;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        // Fitted inside the square, never stretched — a squashed logo is a wrong logo.
        const s = Math.min(px / img.width, px / img.height);
        const w = img.width * s, h = img.height * s;
        g.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
        return c.toDataURL('image/png');
      }, [buf.toString('base64'), PNG_PX]);
    }
    return out;
  } finally { await browser.close(); }
}

// ── Fetch ────────────────────────────────────────────────────────────────────
const marks = {};
const rasters = {};
for (const [id, src] of Object.entries(SOURCES)) {
  process.stdout.write(`  ${id.padEnd(14)}`);
  try {
    const buf = await get(src.url);
    if (src.kind === 'png') { rasters[id] = buf; console.log(`raster  ${buf.length}B`); }
    else {
      const svg = buf.toString('utf8');
      marks[id] = src.kind === 'simple' ? readSimple(svg) : readSvg(svg);
      console.log(`${marks[id].kind.padEnd(7)} ${buf.length}B`);
    }
  } catch (e) {
    console.log(`FAILED  ${e.message}`);
    process.exitCode = 1;
  }
}

if (Object.keys(rasters).length) {
  console.log(`\n  shrinking ${Object.keys(rasters).length} rasters to ${PNG_PX}px...`);
  const shrunk = await shrink(rasters);
  for (const [id, dataUri] of Object.entries(shrunk)) {
    marks[id] = { kind: 'png', src: dataUri };
    console.log(`  ${id.padEnd(14)}png     ${dataUri.length}B inline`);
  }
}

if (process.exitCode) { console.error('\nsome marks failed — not writing the file'); process.exit(1); }

// ── Emit ─────────────────────────────────────────────────────────────────────
const header = `// GENERATED by scripts/build-tool-logos.mjs — do not edit by hand.
//
// The Shelf's logos, each taken from an asset the project itself publishes rather than drawn from
// memory. Run the script again to refresh them; it records where every one came from.
//
// These are other people's trademarks, used to identify their software in a catalogue that installs
// it unmodified. They are passed through exactly as published — never recoloured or redrawn — and
// always shown beside the project's own name.

export type ToolMark =
  | { kind: 'path'; d: string; colour: string }
  | { kind: 'svg'; viewBox: string; inner: string }
  | { kind: 'png'; src: string };

export const TOOL_MARKS: Record<string, ToolMark> = ${JSON.stringify(marks, null, 2)};

/** The mark for a tool, or null when we have none and the caller should fall back to initials. */
export function markFor(id: string): ToolMark | null {
  return TOOL_MARKS[id] ?? null;
}
`;

fs.writeFileSync(OUT, header, 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\nwrote ${path.relative(ROOT, OUT)} — ${Object.keys(marks).length} marks, ${kb} kB`);
