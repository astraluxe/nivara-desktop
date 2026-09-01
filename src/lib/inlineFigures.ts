// ─── Showing the picture, not just describing it ─────────────────────────────
//
// A student attached four lecture decks with thirty-two figures in them and asked for exam notes.
// The notes came back saying "Sketch the 4-layer architecture diagram to ensure you can label all
// components" — about a diagram that was sitting in the attached file, and which the chat never
// showed them. They had to go back to the .pptx to see the thing the notes were telling them to
// learn.
//
// That is not a student problem. A contract clause someone is being asked to look at, a chart in a
// report, a screenshot of the error being explained — whenever the picture IS the point, describing
// it and leaving it out makes the reader go and find it themselves.
//
// The agent marks a figure with ordinary Markdown image syntax and a `figure:` source. This module
// decides which stored picture that refers to, and is deliberately generous about it: the model is
// writing the reference from a filename it saw once, so "figure 3", "Figure 3", and the whole title
// all have to land on the same picture. Being wrong here shows the reader the wrong diagram, so
// ambiguity resolves to nothing rather than to a guess.

/** A picture the app has already stored — the shape the Brain keeps. */
export interface StoredPicture {
  id: string;
  title: string;
  filePath?: string;
}

export interface FigureRef {
  /** The whole `![caption](figure:ref)` marker, so a caller can replace it exactly. */
  marker: string;
  /** What the agent wrote as the caption. */
  caption: string;
  /** The reference itself, e.g. "figure 3" or a full file title. */
  ref: string;
}

const MARKER = /!\[([^\]]*)\]\(\s*figure:([^)]+?)\s*\)/gi;

/** Every figure the answer asks to show, in the order it asks. */
export function figureRefs(text: string): FigureRef[] {
  const out: FigureRef[] = [];
  const re = new RegExp(MARKER.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const ref = m[2].trim();
    if (ref) out.push({ marker: m[0], caption: m[1].trim(), ref });
  }
  return out;
}

/** Is this line nothing but a figure marker? Those get their own block. */
export function isFigureLine(line: string): boolean {
  const t = String(line || '').trim();
  if (!t) return false;
  const refs = figureRefs(t);
  return refs.length === 1 && refs[0].marker === t;
}

/** Punctuation and spacing vary between how a file is named and how a model writes it back. */
function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')     // any dash becomes a plain one
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "… — figure 3" → 3. Null when the title does not number itself. */
function figureNumber(s: string): number | null {
  const m = norm(s).match(/\bfig(?:ure)?\s*(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Which stored picture a reference means.
 *
 * Tried in order of how sure each match is. Anything that matches more than one picture returns
 * null: showing the reader the wrong diagram, confidently, is worse than showing none — they would
 * have no reason to doubt it.
 */
export function matchPicture(ref: string, pictures: StoredPicture[]): StoredPicture | null {
  const list = (pictures || []).filter((p) => p && p.title);
  if (!list.length || !String(ref || '').trim()) return null;
  const want = norm(ref);

  const only = (hits: StoredPicture[]) => (hits.length === 1 ? hits[0] : null);

  // 1. The exact title, or the id.
  const exact = list.filter((p) => norm(p.title) === want || p.id === ref.trim());
  if (exact.length) return exact[0];

  // 2. The title contains the whole reference ("1 - Introduction.pptx — figure 3" for "figure 3"
  //    only when a single picture carries that number).
  const contains = list.filter((p) => norm(p.title).includes(want));
  if (contains.length === 1) return contains[0];

  // 3. A bare figure number. Only usable when exactly one stored picture has it — with four decks
  //    attached there are four "figure 3"s, and picking one at random is precisely the failure this
  //    function exists to avoid.
  const n = figureNumber(ref);
  if (n != null) {
    const byNumber = list.filter((p) => figureNumber(p.title) === n);
    const hit = only(byNumber);
    if (hit) return hit;

    // 3b. Qualified by the document it came from: "introduction figure 3".
    const words = want.replace(/\bfig(?:ure)?\s*\d{1,3}\b/, '').trim();
    if (words) {
      const qualified = byNumber.filter((p) => norm(p.title).includes(words));
      const q = only(qualified);
      if (q) return q;
    }
  }

  return null;
}

export type ProseBlock =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; caption: string; ref: string };

/**
 * Split an answer into prose and the figures standing on their own lines.
 *
 * Only a line that is NOTHING but a marker becomes a picture. A marker written mid-sentence stays
 * in the text and renders as ordinary Markdown, because pulling it out would break the sentence
 * around it — and a model that writes one inline meant it as a mention, not a plate.
 */
export function splitFigureBlocks(text: string): ProseBlock[] {
  const lines = String(text || '').split(/\r?\n/);
  const out: ProseBlock[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join('\n');
    // Whitespace between two figures is not a paragraph.
    if (t.trim()) out.push({ kind: 'text', text: t });
    buf = [];
  };
  for (const line of lines) {
    if (isFigureLine(line)) {
      flush();
      const [ref] = figureRefs(line);
      out.push({ kind: 'figure', caption: ref.caption, ref: ref.ref });
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * The instruction that gets a figure onto the screen.
 *
 * Added only when the user actually attached pictures, so an ordinary chat carries none of it. The
 * bar is deliberately high: a wall of every figure in the deck is worse than none, because it buries
 * the writing the user asked for.
 */
export function figureDirective(titles: string[]): string {
  const list = (titles || []).filter(Boolean);
  if (!list.length) return '';
  const shown = list.slice(0, 40);
  return [
    '',
    '## SHOW A PICTURE WHEN THE PICTURE IS THE POINT',
    '',
    'These figures came with the user\'s files and can be placed directly in your answer:',
    ...shown.map((t) => `- ${t}`),
    ...(list.length > shown.length ? [`- …and ${list.length - shown.length} more`] : []),
    '',
    'Put one in by writing it on **its own line**, as Markdown, with a `figure:` source:',
    '',
    '    ![What it shows](figure:figure 3)',
    '',
    'The reference can be the figure number or the whole title as written above.',
    '',
    '- **Only when the picture carries the meaning** — a diagram being explained, a chart whose',
    '  numbers you are quoting, the screenshot of the thing that is wrong. Telling someone to go and',
    '  look at a diagram you could have shown them is the failure this fixes.',
    '- **Never decoration, and never all of them.** Two or three across a long answer is plenty; a',
    '  wall of images buries the writing they asked for.',
    '- **The caption says what to look at**, not "Figure 3" again.',
  ].join('\n');
}
