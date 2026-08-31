// ─── Reading the documents people actually work in ───────────────────────────
//
// The chat's file picker offered .txt, .md, .csv, code, .pdf and images — and no Office formats at
// all. A small business does not keep its work in Markdown. It keeps it in Word, PowerPoint and
// Excel, and none of the three could even be SELECTED.
//
// Making them selectable is the easy half and the wrong half on its own: a file the picker accepts
// and then reads as gibberish is worse than one it refuses, because the user cannot tell that
// anything went wrong — the reply is merely poor. So each format gets a real reader.
//
// ── ALL THREE MODERN FORMATS ARE ZIPS ───────────────────────────────────────
//
// .docx, .pptx and .xlsx are Open XML: a zip of XML parts. That is why one dependency (JSZip, which
// docgen already uses) covers all of them, and why the pictures come out as ordinary PNG and JPEG
// files rather than needing to be decoded.
//
// The OLD formats — .doc, .ppt, .xls — are a completely different thing: undocumented binary
// compound files from the nineties. They are accepted by the picker on purpose and answered with a
// sentence telling the user how to fix it, because "why won't it take my file" with no explanation
// is the worse experience.

import { docxMediaOrder, mimeForMedia, type DocImage } from './docImages';

export interface OfficeDoc {
  text: string;
  images: DocImage[];
  /** Set when the file is readable in principle but not by us — shown to the user as-is. */
  problem?: string;
}

/** The extension, lower-cased, without the dot. */
export function extOf(name: string): string {
  return (name.toLowerCase().split('.').pop() || '');
}

/** Formats the picker should offer. Legacy ones are included deliberately — see below. */
export const OFFICE_EXTS = ['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls'];

/**
 * The old binary formats, and what to tell someone who attaches one.
 *
 * Reading a 1997 compound-file .doc means implementing a format Microsoft never published, for a
 * file anyone can convert in four clicks. Saying so plainly is the honest trade — and far better
 * than a picker that silently will not show their file.
 */
export function legacyFormatMessage(name: string): string | null {
  const ext = extOf(name);
  const modern: Record<string, string> = { doc: '.docx', ppt: '.pptx', xls: '.xlsx' };
  if (!modern[ext]) return null;
  return `[${name} is in the older ${'.' + ext} format, which adris cannot read. `
    + `Open it in Office and use File → Save As to save it as ${modern[ext]}, then attach that. `
    + `Everything in it will come across, including the pictures.]`;
}

async function openZip(bytes: Uint8Array) {
  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  return JSZip.loadAsync(bytes);
}

/** Strip XML to readable text, keeping only the structure that carries meaning. */
function stripXml(xml: string, blockEnd: RegExp): string {
  return xml
    .replace(blockEnd, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every media file in a zip, in numeric order, as data URIs. */
async function mediaFrom(zip: any, prefix: RegExp, source: string): Promise<DocImage[]> {
  const names = Object.keys(zip.files)
    .filter((p: string) => prefix.test(p) && mimeForMedia(p))
    .sort((a: string, b: string) => {
      const n = (s: string) => parseInt(s.replace(/\D+/g, ''), 10) || 0;
      return n(a) - n(b);
    });
  const out: DocImage[] = [];
  for (let i = 0; i < names.length; i++) {
    const mime = mimeForMedia(names[i]);
    if (!mime) continue;
    const b64 = await zip.files[names[i]].async('base64');
    const dataUri = `data:${mime};base64,${b64}`;
    const size = await measure(dataUri);
    if (!size) continue;
    out.push({ source, index: i + 1, dataUri, ...size });
  }
  return out;
}

function measure(dataUri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * Slide files, in the order they are presented.
 *
 * `slide10.xml` must come after `slide2.xml`. A plain string sort puts it second, which silently
 * reorders every deck of ten slides or more — and a reordered deck reads as nonsense rather than as
 * a bug, so nobody reports it.
 */
export function slideOrder(paths: string[]): string[] {
  return paths
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace(/\D+/g, ''), 10) || 0;
      return n(a) - n(b);
    });
}

/** Read a .pptx: what each slide says, and every picture in it. */
export async function readPptx(bytes: Uint8Array, source: string): Promise<OfficeDoc> {
  try {
    const zip = await openZip(bytes);
    const slides = slideOrder(Object.keys(zip.files));
    const parts: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const xml = await zip.files[slides[i]].async('string');
      // </a:p> ends a paragraph; a run break also ends a line. Without these every slide arrives
      // as one unbroken string of words.
      const body = stripXml(xml, /<\/a:p>|<a:br\/>/g);
      if (body) parts.push(`--- Slide ${i + 1} ---\n${body}`);
    }
    return { text: parts.join('\n\n'), images: await mediaFrom(zip, /^ppt\/media\//i, source) };
  } catch {
    return { text: '', images: [], problem: `[Could not read ${source}]` };
  }
}

/** Worksheets, in workbook order. */
export function sheetOrder(paths: string[]): string[] {
  return paths
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace(/\D+/g, ''), 10) || 0;
      return n(a) - n(b);
    });
}

/**
 * The shared string table.
 *
 * Excel does not put text in cells. It puts an INDEX into this table, and the cell is marked
 * `t="s"`. Read the sheet without it and every text cell comes out as a number — a spreadsheet of
 * names arrives as a spreadsheet of 0, 1, 2, 3.
 */
export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

/** One worksheet as tab-separated rows. */
export function sheetToRows(xml: string, shared: string[]): string[] {
  const rows: string[] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1];
      const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(c[2])?.[1] ?? '';
      const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2])?.[1];
      if (inline !== undefined) { cells.push(inline); continue; }
      // t="s" means "this number is an index into the shared string table", not a value.
      cells.push(/t="s"/.test(attrs) ? (shared[parseInt(v, 10)] ?? '') : v);
    }
    if (cells.some((x) => x !== '')) rows.push(cells.join('\t'));
  }
  return rows;
}

/** Read an .xlsx into rows a model can actually reason about. */
export async function readXlsx(bytes: Uint8Array, source: string): Promise<OfficeDoc> {
  try {
    const zip = await openZip(bytes);
    const ssFile = zip.file('xl/sharedStrings.xml');
    const shared = ssFile ? parseSharedStrings(await ssFile.async('string')) : [];
    const sheets = sheetOrder(Object.keys(zip.files));
    const parts: string[] = [];
    for (let i = 0; i < sheets.length; i++) {
      const rows = sheetToRows(await zip.files[sheets[i]].async('string'), shared);
      // A 50,000-row export must not become the whole message.
      const capped = rows.slice(0, 400);
      if (capped.length) {
        parts.push(`--- Sheet ${i + 1} (${rows.length} rows${rows.length > capped.length ? ', first 400 shown' : ''}) ---\n${capped.join('\n')}`);
      }
    }
    return { text: parts.join('\n\n'), images: await mediaFrom(zip, /^xl\/media\//i, source) };
  } catch {
    return { text: '', images: [], problem: `[Could not read ${source}]` };
  }
}

/** Word, for completeness — the media path differs from the other two. */
export async function readDocxDoc(bytes: Uint8Array, source: string): Promise<OfficeDoc> {
  try {
    const zip = await openZip(bytes);
    const doc = zip.file('word/document.xml');
    const text = doc ? stripXml(await doc.async('string'), /<\/w:p>|<w:br[^>]*\/?>/g) : '';
    const names = docxMediaOrder(Object.keys(zip.files));
    const images: DocImage[] = [];
    for (let i = 0; i < names.length; i++) {
      const mime = mimeForMedia(names[i]);
      if (!mime) continue;
      const b64 = await zip.files[names[i]].async('base64');
      const dataUri = `data:${mime};base64,${b64}`;
      const size = await measure(dataUri);
      if (size) images.push({ source, index: i + 1, dataUri, ...size });
    }
    return { text, images };
  } catch {
    return { text: '', images: [], problem: `[Could not read ${source}]` };
  }
}

/** One entry point: hand it any Office file and get back text and pictures. */
export async function readOfficeDoc(bytes: Uint8Array, name: string): Promise<OfficeDoc> {
  const legacy = legacyFormatMessage(name);
  if (legacy) return { text: legacy, images: [], problem: legacy };
  switch (extOf(name)) {
    case 'docx': return readDocxDoc(bytes, name);
    case 'pptx': return readPptx(bytes, name);
    case 'xlsx': return readXlsx(bytes, name);
    default:     return { text: '', images: [] };
  }
}
