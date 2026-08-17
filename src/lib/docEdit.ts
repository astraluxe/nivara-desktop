// ─── Editing a Word document in place, keeping its formatting ────────────────
//
// WHY THIS EXISTS. Asked to fix the reference list in a real paper — forty-odd entries,
// author names to complete — the office could do nothing useful. It could CREATE a .docx
// from scratch (generate_document), but there was no way to open one the user already had,
// change the parts they asked about, and leave everything else exactly as it was. Rewriting
// the document from scratch is not the same job: it throws away their styles, numbering,
// figures and layout, which is most of the work in an academic paper.
//
// HOW IT KEEPS THE FORMATTING. A .docx is a zip; the text lives in word/document.xml as
// paragraphs (<w:p>) made of runs (<w:r>), each holding a piece of text (<w:t>). Word
// splits a sentence across runs freely — spell-check, a changed font, an autosave — so
// "J. Smith, A. Johnson" can be stored as <w:t>J. Smi</w:t><w:t>th, A. John</w:t><w:t>son</w:t>.
// A plain find-and-replace over the XML therefore misses most of what a person can see.
//
// So edits are matched against the paragraph's VISIBLE text (all its runs joined), and
// applied by putting the new text into the paragraph's FIRST run and blanking the others.
// The first run carries the paragraph's character formatting, so the replacement keeps the
// font, size and style that were already there, and everything outside the matched
// paragraphs is untouched byte for byte.
//
// It never writes over the original. The edited copy goes to Downloads under a new name,
// so a bad edit costs nothing.

export interface DocEdit {
  /** Match a paragraph whose visible text contains this (case-insensitive). */
  find: string;
  /** What the whole paragraph should say instead. */
  replace: string;
}

export interface DocEditResult {
  path: string;
  filename: string;
  applied: { find: string; before: string; after: string }[];
  missed: string[];
  paragraphs: number;
}

/** Decode the XML entities Word uses, so matching works on what a person would read. */
function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** The text a reader sees in one paragraph: every <w:t> in it, joined. */
export function paragraphText(paragraphXml: string): string {
  const parts = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => unescapeXml(m[1]));
  // <w:tab/> and <w:br/> are visible whitespace; without them "…2020.[2] M. Brown" runs together.
  const withBreaks = paragraphXml.replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n');
  return parts.length ? parts.join('') : unescapeXml(withBreaks.replace(/<[^>]+>/g, ''));
}

/**
 * Put `text` into a paragraph, keeping its formatting.
 *
 * The first <w:t> takes the whole replacement and the rest are emptied rather than deleted:
 * removing runs outright can strip a bookmark, a comment anchor or a field that Word needs,
 * and an empty run renders as nothing anyway.
 */
export function setParagraphText(paragraphXml: string, text: string): string {
  let first = true;
  return paragraphXml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_m, open: string, _body: string, close: string) => {
    if (first) {
      first = false;
      // xml:space="preserve" or Word trims the leading/trailing spaces of the run.
      const openTag = /xml:space=/.test(open) ? open : open.replace(/>$/, ' xml:space="preserve">');
      return `${openTag}${escapeXml(text)}${close}`;
    }
    return `${open}${close}`;
  });
}

/** Apply the edits to a word/document.xml string. Pure, so it can be tested without a file. */
export function applyEditsToDocumentXml(xml: string, edits: DocEdit[]):
  { xml: string; applied: DocEditResult['applied']; missed: string[]; paragraphs: number } {
  const applied: DocEditResult['applied'] = [];
  const used = new Set<number>();

  // Split on paragraphs, keeping them addressable. Word nests paragraphs inside table cells
  // too, and those match the same pattern, so references inside a table are editable as well.
  const paras = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((m) => ({ xml: m[0], index: m.index ?? 0 }));

  let out = xml;
  // Work back-to-front so earlier replacements do not shift the offsets of later ones.
  const plan: { at: number; len: number; next: string }[] = [];

  for (const edit of edits) {
    const needle = (edit.find || '').trim().toLowerCase();
    if (!needle) continue;
    let hit = -1;
    for (let i = 0; i < paras.length; i++) {
      if (used.has(i)) continue;                       // one paragraph serves one edit
      const text = paragraphText(paras[i].xml).trim();
      if (text.toLowerCase().includes(needle)) { hit = i; break; }
    }
    if (hit < 0) continue;
    used.add(hit);
    const before = paragraphText(paras[hit].xml).trim();
    const next = setParagraphText(paras[hit].xml, edit.replace);
    plan.push({ at: paras[hit].index, len: paras[hit].xml.length, next });
    applied.push({ find: edit.find, before, after: edit.replace });
  }

  plan.sort((a, b) => b.at - a.at);
  for (const p of plan) out = out.slice(0, p.at) + p.next + out.slice(p.at + p.len);

  const missed = edits.filter((e) => !applied.some((a) => a.find === e.find)).map((e) => e.find);
  return { xml: out, applied, missed, paragraphs: paras.length };
}

/** Every paragraph's visible text, for showing the user what is in the file. */
export function documentParagraphs(xml: string): string[] {
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((m) => paragraphText(m[0]).trim())
    .filter(Boolean);
}

/**
 * Open a .docx, apply the edits, write the result to Downloads as a NEW file.
 * Returns where it went and exactly what changed, so nothing has to be taken on trust.
 */
export async function editDocx(path: string, edits: DocEdit[], saveAs?: string): Promise<DocEditResult> {
  if (!/\.docx$/i.test(path)) {
    throw new Error(`${path} is not a .docx. Word can only be edited in place in the .docx format — `
      + `a .doc or a PDF has to be saved as .docx first.`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const b64 = await invoke<string>('read_file_base64', { path });

  const JSZipMod: any = await import('jszip');
  const JSZip = JSZipMod.default || JSZipMod;
  const zip = await JSZip.loadAsync(b64, { base64: true });

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('That .docx has no word/document.xml — it may be corrupt or not really a Word file.');
  const xml = await docFile.async('string');

  const { xml: nextXml, applied, missed, paragraphs } = applyEditsToDocumentXml(xml, edits);
  if (!applied.length) {
    throw new Error(`None of the ${edits.length} passages were found in the document. `
      + `Read it first and match the text exactly as it appears.`);
  }

  // Only document.xml changes; every other part of the zip is carried over untouched, which
  // is what preserves styles, numbering, fonts, images and headers.
  zip.file('word/document.xml', nextXml);
  const outB64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });

  const stem = (path.split(/[\\/]/).pop() || 'document.docx').replace(/\.docx$/i, '');
  const filename = (saveAs && saveAs.trim() ? saveAs.trim().replace(/\.docx$/i, '') : `${stem} (edited)`) + '.docx';
  const outPath = await invoke<string>('save_to_downloads', { filename, dataBase64: outB64 });

  return { path: outPath, filename: outPath.split(/[\\/]/).pop() || filename, applied, missed, paragraphs };
}
