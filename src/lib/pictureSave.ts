// ─── What actually belongs in the Brain's Pictures folder ────────────────────
//
// A user attached the same Word document twice and the Brain filled up with the same figures over
// and over. Two separate faults:
//
//  1. EVERY image was saved, including the figures we lifted out of their document ourselves. Those
//     are working material for the deck being built — the user never asked for a picture library of
//     them. One report with twelve diagrams turned the Pictures folder into that report.
//
//  2. Nothing deduplicated. `addUniqueNode` does the opposite of what its name suggests: when a
//     title already exists it keeps BOTH and renames the new one "figure 1 (2)". So re-attaching the
//     same file was guaranteed to double everything.
//
// The rule now: a picture the user CHOSE to attach is worth keeping. A picture we extracted from
// their document is not, unless they say so. And the same bytes are never stored twice, whatever
// the file happened to be called.

/**
 * A stable identity for an image, from its bytes.
 *
 * Filenames cannot do this job: two unrelated figures are both "image1.png", and the same figure
 * arrives as "figure 1" one day and "Screenshot" the next. The bytes are the picture.
 *
 * FNV-1a over the base64, mixed with the length. Not a cryptographic hash and does not need to be —
 * it decides whether to store a second copy of a picture, so a collision costs one skipped save,
 * and the length guard makes even that vanishingly unlikely.
 */
export function pictureHash(base64: string): string {
  const s = String(base64 || '');
  if (!s) return '';
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const a = (h1 >>> 0).toString(36);
  const b = (h2 >>> 0).toString(36);
  return `${a}${b}${s.length.toString(36)}`;
}

export interface PictureCandidate {
  /** Did we extract this from a document the user attached, rather than them attaching it? */
  fromDoc?: boolean;
  /** Did it come out of the Brain in the first place? */
  fromBrain?: boolean;
}

/**
 * Should this image be kept in the Pictures folder?
 *
 * Only pictures the user attached themselves. A figure lifted out of their document still reaches
 * the deck — that is what it was extracted for — it simply does not become a permanent library
 * entry the user has to tidy up later.
 */
export function shouldSaveToPictures(f: PictureCandidate): boolean {
  if (f.fromBrain) return false;   // already there
  if (f.fromDoc) return false;     // working material for this deck, not a library
  return true;
}

/**
 * Split a batch into what gets saved and what is skipped, deduplicated by content.
 *
 * Duplicates WITHIN the batch are collapsed too — a document that repeats its header logo on every
 * page produced one Brain entry per page.
 */
export function planPictureSaves<T extends PictureCandidate & { content: string }>(
  files: T[],
  alreadyStored: ReadonlyArray<string> = [],
): { save: T[]; skipped: { file: T; why: 'from-document' | 'already-saved' | 'from-brain' }[] } {
  const seen = new Set(alreadyStored.filter(Boolean));
  const save: T[] = [];
  const skipped: { file: T; why: 'from-document' | 'already-saved' | 'from-brain' }[] = [];

  for (const f of files) {
    if (f.fromBrain) { skipped.push({ file: f, why: 'from-brain' }); continue; }
    if (f.fromDoc) { skipped.push({ file: f, why: 'from-document' }); continue; }
    const h = pictureHash(f.content);
    if (h && seen.has(h)) { skipped.push({ file: f, why: 'already-saved' }); continue; }
    if (h) seen.add(h);
    save.push(f);
  }
  return { save, skipped };
}
