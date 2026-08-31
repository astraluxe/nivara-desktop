// ─── Getting the pictures out of the user's own document ─────────────────────
//
// A deck built from a document that HAS diagrams, and which then contains none of them, is missing
// the part the reader actually needed. The owner put it plainly: *"if the user doc has pic then need
// to add that also in the ppt… I don't know how you're going to take the user pic from their doc and
// put it but it should be done and it's required."*
//
// Two formats, two completely different jobs:
//
//   **DOCX** is a zip. The pictures are already sitting in `word/media/` as ordinary PNG and JPEG
//   files. Nothing has to be decoded — they are lifted out whole, at full quality.
//
//   **PDF** has no such folder. Images are content-stream objects referenced by the page's drawing
//   operators, so the only honest way to get one is to ask the PDF renderer: walk the operator list
//   for paint-image operations, resolve each object, and put its pixels on a canvas. That is what
//   pdf.js exposes and what this does.
//
// ── WHAT IS DELIBERATELY THROWN AWAY ────────────────────────────────────────
//
// Most images in a real document are not content. Bullet glyphs, logos in a header, rules, the
// scanner's watermark, a 1×1 spacer. Putting those on slides is worse than putting nothing there,
// because it looks like a mistake rather than an omission. Anything small, anything extremely thin,
// and anything nearly blank is dropped — see `isWorthPlacing`.

/** One picture lifted out of a document. */
export interface DocImage {
  /** Where it came from, for the caption and for the agent to reason about. */
  source: string;
  /** Page (PDF) or order of appearance (DOCX), 1-based — decks read better in document order. */
  index: number;
  dataUri: string;
  width: number;
  height: number;
}

/**
 * Is this picture worth putting on a slide?
 *
 * The thresholds are deliberately blunt. A decorative rule is very wide and a few pixels tall; an
 * icon is small in both directions; a spacer is one pixel. A diagram, a photo or a chart — the
 * things worth carrying into a deck — are none of those.
 */
export function isWorthPlacing(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  // Icons, bullets, spacers.
  if (w < 120 || h < 120) return false;
  // Rules, borders and banner strips: real content is not fifteen times longer than it is tall.
  const ratio = w / h;
  if (ratio > 12 || ratio < 1 / 12) return false;
  return true;
}

/** Sort into the order a reader met them, so a deck follows the document. */
export function inDocumentOrder(imgs: DocImage[]): DocImage[] {
  return [...imgs].sort((a, b) => a.index - b.index);
}

/**
 * Drop repeats.
 *
 * A logo in a page header appears on every page of a PDF, so a 40-page document yields 40 copies of
 * the same picture. Keyed on the encoded bytes, which is exact and costs nothing — comparing pixels
 * would be slower and no more correct for what is literally the same object drawn again.
 */
export function dedupe(imgs: DocImage[]): DocImage[] {
  const seen = new Set<string>();
  const out: DocImage[] = [];
  for (const im of imgs) {
    // The tail of the data URI is enough: two different pictures do not share their last 256 bytes.
    const key = im.dataUri.slice(-256) + ':' + im.width + 'x' + im.height;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(im);
  }
  return out;
}

/** A sensible ceiling. Twelve pictures is already more than most decks can use. */
export const MAX_DOC_IMAGES = 12;

/** Everything a caller wants: in order, without repeats, without junk, and capped. */
export function tidy(imgs: DocImage[], cap = MAX_DOC_IMAGES): DocImage[] {
  return inDocumentOrder(dedupe(imgs.filter((i) => isWorthPlacing(i.width, i.height)))).slice(0, cap);
}

// ── DOCX ─────────────────────────────────────────────────────────────────────

/** The media types Word actually stores, mapped to what a data URI needs. */
export function mimeForMedia(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() || '';
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    case 'webp': return 'image/webp';
    // EMF/WMF are Windows metafiles — vector formats a browser cannot draw. Skipped rather than
    // shipped as a broken image, which is what putting them on a slide would produce.
    default: return null;
  }
}

/** Media entries inside a .docx, in the order Word numbered them. */
export function docxMediaOrder(paths: string[]): string[] {
  return paths
    .filter((p) => /^word\/media\//i.test(p) && mimeForMedia(p))
    .sort((a, b) => {
      const n = (s: string) => parseInt(s.replace(/\D+/g, ''), 10) || 0;
      return n(a) - n(b);
    });
}

/**
 * Pull the pictures out of a .docx.
 *
 * A .docx is a zip, so this needs a zip reader; JSZip is loaded dynamically because a user who never
 * attaches a Word file should not pay for it on startup.
 */
export async function extractDocxImages(bytes: Uint8Array, source: string): Promise<DocImage[]> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const names = docxMediaOrder(Object.keys(zip.files));
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
  } catch {
    // A picture that cannot be read is not worth failing the whole document over.
    return [];
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * Pull the pictures out of a PDF.
 *
 * There is no folder of images to raid. Each page's operator list is walked for paint-image
 * operations, the named object is resolved, and its raw pixels are drawn to a canvas and encoded.
 * `page.objs.get` is asynchronous in the sense that the object may not have been parsed yet, so
 * each page is rendered's operator list is awaited first.
 */
export async function extractPdfImages(
  pdf: { numPages: number; getPage: (n: number) => Promise<unknown> },
  source: string,
  maxPages = 40,
): Promise<DocImage[]> {
  const out: DocImage[] = [];
  const pages = Math.min(pdf.numPages, maxPages);
  for (let p = 1; p <= pages; p++) {
    try {
      const page = await pdf.getPage(p) as {
        getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
        objs: { get: (name: string, cb?: (o: unknown) => void) => unknown; has?: (n: string) => boolean };
        commonObjs: { get: (name: string) => unknown; has?: (n: string) => boolean };
      };
      const ops = await page.getOperatorList();
      const { OPS } = await import('pdfjs-dist');
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        // This build of pdf.js funnels JPEGs through the same operator, so one test covers both.
        if (fn !== OPS.paintImageXObject) continue;
        const name = ops.argsArray[i]?.[0] as string;
        if (typeof name !== 'string') continue;
        const store = name.startsWith('g_') ? page.commonObjs : page.objs;
        let img: unknown = null;
        try { img = store.has?.(name) === false ? null : store.get(name); } catch { img = null; }
        const drawn = await toDataUri(img);
        if (!drawn) continue;
        out.push({ source, index: p, ...drawn });
      }
    } catch {
      // One unreadable page must not lose the pictures on the other thirty-nine.
    }
  }
  return out;
}

/** Turn a pdf.js image object into a data URI, or null if it is not something we can draw. */
async function toDataUri(img: unknown): Promise<{ dataUri: string; width: number; height: number } | null> {
  const o = img as { width?: number; height?: number; data?: Uint8ClampedArray | Uint8Array; bitmap?: ImageBitmap } | null;
  if (!o?.width || !o?.height) return null;
  const { width, height } = o;
  if (!isWorthPlacing(width, height)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (o.bitmap) {
      ctx.drawImage(o.bitmap, 0, 0);
    } else if (o.data) {
      // pdf.js hands back either RGBA or RGB. RGB has to be widened, or every image comes out
      // shifted and psychedelic — three bytes read as four.
      const src = o.data;
      const out = ctx.createImageData(width, height);
      const rgb = src.length === width * height * 3;
      for (let i = 0, j = 0; i < width * height; i++) {
        out.data[i * 4] = src[j++];
        out.data[i * 4 + 1] = src[j++];
        out.data[i * 4 + 2] = src[j++];
        out.data[i * 4 + 3] = rgb ? 255 : src[j++];
      }
      ctx.putImageData(out, 0, 0);
    } else {
      return null;
    }
    return { dataUri: canvas.toDataURL('image/png'), width, height };
  } catch {
    return null;
  }
}

/** Read a data URI's real dimensions, since a .docx does not record them. */
function measure(dataUri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * Read a .docx: its words AND its pictures, from one pass over the zip.
 *
 * ── WHY THE TEXT IS HERE TOO ────────────────────────────────────────────────
 *
 * A .docx attachment was being read with `FileReader.readAsText`, which on a ZIP produces mojibake —
 * so every Word document the user attached arrived as a page of nonsense the model then tried to
 * reason about. It was never reported because the reply is merely bad rather than obviously broken.
 *
 * The real text lives in `word/document.xml`. Paragraph and break tags become newlines before the
 * markup is stripped, or the whole document arrives as one unreadable run-on line.
 */
export async function readDocx(bytes: Uint8Array, source: string): Promise<{ text: string; images: DocImage[] }> {
  try {
    const JSZipMod: any = await import('jszip');
    const JSZip = JSZipMod.default || JSZipMod;
    const zip = await JSZip.loadAsync(bytes);

    let text = '';
    const doc = zip.file('word/document.xml');
    if (doc) text = docxXmlToText(await doc.async('string'));

    const names = docxMediaOrder(Object.keys(zip.files as Record<string, unknown>));
    const images: DocImage[] = [];
    for (let i = 0; i < names.length; i++) {
      const mime = mimeForMedia(names[i]);
      if (!mime) continue;
      const b64 = await zip.files[names[i]].async('base64');
      const dataUri = `data:${mime};base64,${b64}`;
      const size = await measure(dataUri);
      if (!size) continue;
      images.push({ source, index: i + 1, dataUri, ...size });
    }
    return { text, images };
  } catch {
    return { text: '', images: [] };
  }
}

/** WordprocessingML to readable text. Structure first, then strip. */
export function docxXmlToText(xml: string): string {
  return xml
    // Paragraph ends and explicit breaks are the only structure worth keeping. Stripping the tags
    // first would collapse the entire document into one unreadable run-on line.
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    // Everything else goes, including the mountain of formatting properties Word writes.
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
