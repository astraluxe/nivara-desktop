// ─── Making the PowerPoint file look like a person made it ───────────────────
//
// The deck in the chat looked right and the .pptx of the SAME deck did not: words at the wrong
// size, whole slides arriving empty, and — the user's word — it "look[ed] very clearly like it's
// made using AI". Some of that is layout, and lives in deck.ts. Three things are text and metadata,
// and they live here because they are pure and can be tested without a browser.
//
//   1. THE LONG DASH. The em dash is the single best-known tell of machine-written text, and the
//      writer put one in by hand as well (`— ${attribution}` on every quote slide).
//   2. TEXT THAT DOES NOT FIT. Every size in the .pptx writer was a constant — fontSize: 48 on a
//      2-inch box — while the HTML deck measures each slide and shrinks to fit. Same content, two
//      different sizes, and in PowerPoint the overflow spills off the slide or is clipped.
//   3. WHAT THE FILE SAYS ABOUT ITSELF. Every deck shipped with `PptxGenJS Presentation` as its
//      subject and `adris.tech` as its author, both plainly visible in File → Info → Properties.
//      Nothing in the slides matters if the properties panel announces the generator.

/**
 * The long dash, gone — without changing what the sentence means.
 *
 * A range between two numbers is a hyphen (2020-2024). Everywhere else the dash is separating a
 * clause, and a spaced hyphen carries that with no risk: unlike a comma it cannot create a splice,
 * and unlike a colon it does not promise a list. The point is to remove the tell, not to rewrite
 * the writing.
 */
export function plainDashes(s: string): string {
  if (!s) return s;
  return String(s)
    // A numeric range keeps its tight form: 2020–2024 → 2020-2024, ₹10–20 → ₹10-20.
    .replace(/(\d)\s*[‒–—―]\s*(\d)/g, '$1-$2')
    // Anything else, spaced or not, becomes a spaced hyphen.
    .replace(/\s*[‒–—―]\s*/g, ' - ')
    // A dash that opened the line ("- point") should not become " - point".
    .replace(/^\s+-\s+/, '- ')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Every string on its way into the .pptx goes through here. */
export function slideText(s: string | undefined | null): string {
  return plainDashes(String(s ?? '')).trim();
}

export interface FitBox {
  /** Box width in inches. */
  w: number;
  /** Box height in inches. */
  h: number;
  /** The size to use when the content is short enough to deserve it. */
  base: number;
  /** Never go below this, however much text there is — past it, shrinking stops helping. */
  min?: number;
  /** Line spacing multiple, matching what the caller passes to pptxgenjs. */
  lineSpacing?: number;
}

/**
 * The size that actually fits, worked out rather than assumed.
 *
 * pptxgenjs can write `fit: 'shrink'`, but PowerPoint only recomputes that factor when someone
 * edits the shape — so a file that is opened, looked at and sent on never shrinks at all. The size
 * has to be right in the file. This estimates how many lines the text wraps to at a given size and
 * steps down until it fits the box.
 *
 * Deliberately an estimate: exact glyph metrics need the font, and being one step small is
 * invisible while being one step large pushes text off the slide.
 */
export function fitSize(paragraphs: string[], box: FitBox): number {
  const min = box.min ?? Math.max(9, Math.round(box.base * 0.45));
  const spacing = box.lineSpacing ?? 1.25;
  const text = paragraphs.filter(Boolean);
  if (!text.length) return box.base;

  for (let size = box.base; size > min; size -= 1) {
    // 72 points to the inch. Average glyph width sits near half the point size across the
    // humanist sans and serif faces the presets use.
    const charsPerLine = Math.max(8, Math.floor((box.w * 72) / (size * 0.5)));
    let lines = 0;
    for (const p of text) lines += Math.max(1, Math.ceil(p.length / charsPerLine));
    // Each paragraph after the first carries a gap above it. Ignoring that made a bullet list read
    // as shorter than PowerPoint actually draws it, which is the direction that overflows.
    lines += (text.length - 1) * 0.35;
    const neededInches = (lines * size * spacing) / 72;
    if (neededInches <= box.h) return size;
  }
  return min;
}

export interface DocProps {
  title: string;
  author: string;
  company: string;
  subject: string;
}

/**
 * What the file says about itself in File → Info.
 *
 * `PptxGenJS Presentation` was sitting in the subject of every deck ever exported, and the author
 * of a deck a person is about to present as their own work read `adris.tech`. Both are visible in
 * two clicks. The deck's own title is a truthful subject; the author is whoever the app knows the
 * user to be, and is left EMPTY rather than filled with a generator's name when it knows nobody -
 * an empty author is ordinary in a real file, and a wrong one is a tell.
 */
export function docProps(deckTitle: string, userName?: string, org?: string): DocProps {
  const clean = (v: string | undefined) => String(v ?? '').trim();
  const title = clean(deckTitle) || 'Presentation';
  return {
    title,
    author: clean(userName),
    company: clean(org),
    subject: title,
  };
}

/**
 * Section slides carried the literal word `SECTION` as a kicker above every chapter title. No
 * person types that on a divider; a number is what a designer puts there, and when the count is
 * not known the kicker is simply dropped.
 */
export function sectionKicker(index: number, total: number): string {
  if (!Number.isFinite(index) || index < 1) return '';
  return total > 1 ? `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}` : String(index).padStart(2, '0');
}

export interface RowFit { /** Width of each item. */ w: number; /** Left edge of the first item. */ x: number }

/**
 * A row of panels that neither stretches nor bunches.
 *
 * Dividing the full width by the number of items is right for four and wrong for one: a single
 * pricing plan became a full-width box with a line of text adrift in it, and two cards became two
 * enormous ones. Real decks cap the item and centre what is left over.
 */
export function centredRow(count: number, avail: number, gap: number, max: number, startX: number): RowFit {
  const n = Math.max(1, Math.floor(count));
  const even = (avail - gap * (n - 1)) / n;
  const w = Math.min(even, max);
  const used = w * n + gap * (n - 1);
  return { w, x: startX + (avail - used) / 2 };
}

/**
 * The same idea vertically: rows that fill the space they are given rather than crowding into the
 * top of it and leaving the bottom half of the slide empty.
 */
export function centredStack(count: number, avail: number, max: number, startY: number): RowFit {
  const n = Math.max(1, Math.floor(count));
  const h = Math.min(avail / n, max);
  return { w: h, x: startY + (avail - h * n) / 2 };
}
