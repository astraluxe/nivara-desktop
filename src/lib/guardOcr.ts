// ─── Guard document extraction (text + OCR + multilingual) ───────────────────
// Pulls clean, English-readable text out of ANY document the user drops in:
//   • Born-digital PDFs / TXT / MD            → direct text extraction
//   • Scanned PDFs (pages are just images)    → Gemini-vision OCR fallback
//   • Hindi / regional / mixed-language docs  → transcribed AND translated to
//                                               English so the analyst prompt
//                                               can reason over one language.
//
// OCR is bounded by a page cap so one 200-page scanned agreement can't drain a
// user's whole monthly token budget in a single click.

import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';

// A scanned page yields almost no extractable text. If a PDF averages fewer than
// this many characters per page, we treat it as image-only and route to OCR.
const MIN_CHARS_PER_PAGE = 100;

// Cap OCR coverage. ~40 image pages ≈ ~50–70k vision tokens — meaningful but far
// from a whole budget. Beyond this we warn and scan only the first N pages.
export const GUARD_OCR_MAX_PAGES = 40;
const OCR_RENDER_SCALE = 1.6;     // sharp enough for small legal print
const OCR_JPEG_QUALITY = 0.72;    // keep base64 payloads reasonable
const OCR_PAGES_PER_CALL = 2;     // pages bundled into one vision request
const OCR_MODEL = 'gemini-2.5-flash-lite';

export type ExtractPhase = 'reading' | 'detecting' | 'rendering' | 'ocr' | 'done';

export interface ExtractProgress {
  phase: ExtractPhase;
  current: number;
  total: number;
  /** True once we've decided the document is a scanned/image PDF needing OCR. */
  ocr: boolean;
}

export interface ExtractResult {
  text: string;
  pages: number;
  /** Whether the OCR vision path was used (vs. plain text extraction). */
  ocrUsed: boolean;
  /** How many pages OCR actually covered (≤ GUARD_OCR_MAX_PAGES). */
  ocrPagesScanned: number;
  /** True if the doc had more pages than the OCR cap. */
  ocrTruncated: boolean;
}

export class GuardExtractError extends Error {
  constructor(message: string, public code: 'no_vision_key' | 'unsupported' | 'empty' | 'ocr_failed') {
    super(message);
  }
}

async function getGeminiKey(): Promise<string | null> {
  try {
    const d = await credentialStore.get('gemini');
    return d?.api_key || d?.access_token || null;
  } catch {
    return null;
  }
}

/** Returns true if a Gemini key is connected (so OCR of scanned docs is possible). */
export async function hasVisionProvider(): Promise<boolean> {
  return (await getGeminiKey()) !== null;
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function loadPdf(file: File) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return getDocument({ data: await file.arrayBuffer() }).promise;
}

// ─── Render PDF pages to JPEG base64 for the vision model ─────────────────────

async function renderPagesToJpeg(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  maxPages: number,
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  const count = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    onProgress?.(i, count);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', OCR_JPEG_QUALITY);
    const base64 = dataUrl.split(',')[1];
    if (base64) out.push(base64);
    // Free the bitmap before the next page to keep memory flat on big docs.
    canvas.width = 0; canvas.height = 0;
  }
  return out;
}

// ─── Gemini vision OCR ────────────────────────────────────────────────────────

const OCR_PROMPT =
  'You are an OCR + translation engine. Transcribe ALL text visible in these document page images. ' +
  'The pages may be in Hindi, English, or a regional Indian language — possibly several mixed on the same page. ' +
  'Transcribe every line faithfully. For any text that is NOT already English, append its English translation in [brackets] right after it. ' +
  'Preserve clause numbers, section headings, party names, dates, amounts and signatures exactly. ' +
  'Do NOT summarize, interpret, or omit anything — output the complete readable text only, with no commentary.';

async function ocrBatch(images: string[], apiKey: string): Promise<string> {
  const parts: Record<string, unknown>[] = [{ text: OCR_PROMPT }];
  for (const data of images) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_MODEL}:generateContent?key=${apiKey}`;
  const raw = await invoke<string>('krew_http_call', {
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });
  const parsed = JSON.parse(raw) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return (parsed.candidates?.[0]?.content?.parts ?? [])
    .map(p => p.text ?? '')
    .join('')
    .trim();
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Extract analysis-ready English text from a dropped file.
 * Routes scanned/image PDFs and non-English docs through Gemini-vision OCR.
 */
export async function extractDocument(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  // Plain text formats — nothing to OCR.
  if (file.type === 'text/plain' || name.endsWith('.txt') || name.endsWith('.md')) {
    onProgress?.({ phase: 'reading', current: 1, total: 1, ocr: false });
    const text = (await file.text()).trim();
    if (!text) throw new GuardExtractError('That file is empty.', 'empty');
    onProgress?.({ phase: 'done', current: 1, total: 1, ocr: false });
    return { text, pages: 1, ocrUsed: false, ocrPagesScanned: 0, ocrTruncated: false };
  }

  if (!name.endsWith('.pdf')) {
    throw new GuardExtractError('Unsupported format. Upload a .pdf or .txt file, or paste text directly.', 'unsupported');
  }

  onProgress?.({ phase: 'reading', current: 0, total: 1, ocr: false });
  const pdf = await loadPdf(file);
  const numPages: number = pdf.numPages;

  // First pass: try born-digital text extraction.
  onProgress?.({ phase: 'detecting', current: 0, total: numPages, ocr: false });
  let extracted = '';
  for (let i = 1; i <= numPages; i++) {
    onProgress?.({ phase: 'detecting', current: i, total: numPages, ocr: false });
    const content = await (await pdf.getPage(i)).getTextContent();
    extracted += content.items.map((it: unknown) => (it as { str: string }).str).join(' ') + '\n';
  }
  extracted = extracted.trim();

  const looksScanned = extracted.length < numPages * MIN_CHARS_PER_PAGE;
  if (!looksScanned) {
    onProgress?.({ phase: 'done', current: numPages, total: numPages, ocr: false });
    return { text: extracted, pages: numPages, ocrUsed: false, ocrPagesScanned: 0, ocrTruncated: false };
  }

  // Scanned / image-only PDF → OCR path. Needs a Gemini (vision) key.
  const apiKey = await getGeminiKey();
  if (!apiKey) {
    throw new GuardExtractError(
      'This looks like a scanned PDF (pages are images, not selectable text). Connect a Gemini API key in Connect Apps so Guard can read scanned documents, or paste the text directly.',
      'no_vision_key',
    );
  }

  onProgress?.({ phase: 'rendering', current: 0, total: Math.min(numPages, GUARD_OCR_MAX_PAGES), ocr: true });
  const images = await renderPagesToJpeg(pdf, GUARD_OCR_MAX_PAGES,
    (cur, total) => onProgress?.({ phase: 'rendering', current: cur, total, ocr: true }));

  if (images.length === 0) {
    throw new GuardExtractError('Could not render the PDF pages for OCR. Try a different export of the file.', 'ocr_failed');
  }

  // OCR in small page batches so each vision response stays coherent and bounded.
  const batches: string[][] = [];
  for (let i = 0; i < images.length; i += OCR_PAGES_PER_CALL) {
    batches.push(images.slice(i, i + OCR_PAGES_PER_CALL));
  }

  let ocrText = '';
  let okBatches = 0;
  for (let b = 0; b < batches.length; b++) {
    onProgress?.({ phase: 'ocr', current: b + 1, total: batches.length, ocr: true });
    try {
      const t = await ocrBatch(batches[b], apiKey);
      if (t) { ocrText += t + '\n\n'; okBatches++; }
    } catch (e) {
      // Tolerate a hiccup on a later batch; fail hard only if nothing worked.
      if (b === 0 && batches.length === 1) throw e;
    }
  }
  ocrText = ocrText.trim();

  if (okBatches === 0 || !ocrText) {
    throw new GuardExtractError('OCR could not read any text from the scanned pages. The scan may be too low-resolution.', 'ocr_failed');
  }

  return {
    text: ocrText,
    pages: numPages,
    ocrUsed: true,
    ocrPagesScanned: images.length,
    ocrTruncated: numPages > GUARD_OCR_MAX_PAGES,
  };
}
