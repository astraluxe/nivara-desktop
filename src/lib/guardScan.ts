// ─── Guard large-document scanning ──────────────────────────────────────────
// Scans the ENTIRE document (200+ page agreements included) in bounded chunks,
// then merges + dedupes findings. The chunk cap keeps one document from draining
// a user's whole monthly token budget while still covering very large files.

import { callAutomationAI } from './automationRunner';

export interface GuardFinding {
  severity: 'high' | 'med' | 'low';
  title: string;
  detail: string;
  section?: string;
}

export interface GuardScanResult {
  risk_score: number;
  summary: string;
  findings: GuardFinding[];
  chunksScanned: number;   // how many chunks we actually sent
  chunksTotal: number;     // how many the doc would need at full coverage
  truncated: boolean;      // true if the doc exceeded the chunk cap
  approxTokens: number;    // rough tokens this scan consumed
}

// ~45k chars ≈ 11k tokens ≈ ~18 pages per chunk. 14 chunks ≈ ~250 pages.
// Worst case ≈ 14 × ~12k tokens ≈ 168k tokens (~4% of a Solo plan's 4M/month),
// so even a maxed-out scan leaves plenty of budget for the rest of the month.
export const GUARD_CHUNK_CHARS = 45000;

/**
 * How big a slice this AI source can actually swallow in one request.
 *
 * 45,000 characters is roughly 11,000 tokens. That is comfortable on a hosted key and impossible
 * on a free one: NVIDIA and Groq free tiers meter TOKENS PER MINUTE, so an 11k-token request is
 * either rejected outright or queued behind its own rate limit -- which is why a tender PDF sat on
 * "Analyzing contract..." for five minutes and produced nothing. The document was never too big;
 * each individual bite was.
 *
 * Smaller slices mean more requests, and that is the right trade here: many small calls that
 * finish beat one large call that never returns.
 *
 * NOTE: a big CONTEXT WINDOW does not lift this. A model advertising 1M context can hold a whole
 * document in one prompt, but the free tier still meters how many tokens you may send PER MINUTE —
 * those are different limits, and it is the per-minute one that stalls a scan. Slice size is set
 * by the rate limit, not by what the model could theoretically read.
 */
export function chunkCharsFor(source: 'nivara' | 'own_key' | 'local' | string): number {
  if (source === 'own_key') return 12000;   // ~3k tokens -- fits a free-tier per-minute budget
  if (source === 'local')   return 8000;    // local context windows are smaller again (often 8k total)
  return GUARD_CHUNK_CHARS;
}
export const GUARD_MAX_CHUNKS  = 14;

/**
 * How many slices we are willing to send — i.e. whether a long document gets scanned in FULL.
 *
 * The 14-chunk ceiling exists to bound spend on OUR key: a 300-page agreement could otherwise eat
 * a month's allowance in one scan. That reasoning does not apply to a user's own key or a local
 * model, where the tokens are theirs and free — and silently stopping a quarter of the way into
 * their tender is a much worse outcome than a slow scan. So on BYOK and local there is no cap
 * beyond a sanity bound that stops a runaway (2,000 slices is several thousand pages).
 */
export function maxChunksFor(source: 'nivara' | 'own_key' | 'local' | string): number {
  return source === 'own_key' || source === 'local' ? 2000 : GUARD_MAX_CHUNKS;
}
const CHARS_PER_PAGE = 2500;     // rough average for a dense legal page
const CHARS_PER_TOKEN = 4;       // rough English heuristic

// Pre-scan estimate so the UI can warn before spending tokens on a huge file.
export function estimateScan(text: string): {
  pages: number;
  chunks: number;
  totalChunks: number;
  truncated: boolean;
  approxTokens: number;
} {
  const len = text.trim().length;
  const totalChunks = Math.max(1, Math.ceil(len / GUARD_CHUNK_CHARS));
  const chunks = Math.min(totalChunks, GUARD_MAX_CHUNKS);
  const scannedChars = Math.min(len, chunks * GUARD_CHUNK_CHARS);
  // input ≈ scanned chars + the system prompt repeated per chunk (~700 tokens each)
  const approxTokens = Math.round(scannedChars / CHARS_PER_TOKEN) + chunks * 700;
  return {
    pages: Math.max(1, Math.round(len / CHARS_PER_PAGE)),
    chunks,
    totalChunks,
    truncated: totalChunks > GUARD_MAX_CHUNKS,
    approxTokens,
  };
}

function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

const SEV_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

/**
 * Scan a full document in bounded chunks and return merged findings.
 * @param fullText        the entire extracted document text
 * @param systemPrompt    the analyst system prompt (must request the JSON shape)
 * @param buildUserMessage builds the per-chunk user message
 * @param onProgress      called with (current, total) before each chunk
 */
export async function scanLargeDocument(
  fullText: string,
  systemPrompt: string,
  buildUserMessage: (chunk: string, index: number, count: number) => string,
  onProgress?: (current: number, total: number) => void,
  /** Told when a rate limit forces a wait, so the UI can show it rather than look frozen. */
  onRetry?: (info: { attempt: number; max: number; waitMs: number }) => void,
  /** Slice size for THIS run — see chunkCharsFor. Defaults to the hosted size. */
  chunkChars: number = GUARD_CHUNK_CHARS,
  /** How many slices are allowed — see maxChunksFor. Defaults to the hosted cap. */
  maxChunks: number = GUARD_MAX_CHUNKS,
): Promise<GuardScanResult> {
  const text = fullText.trim();
  const totalChunks = Math.max(1, Math.ceil(text.length / chunkChars));
  const count = Math.min(totalChunks, maxChunks);

  const findings: GuardFinding[] = [];
  const summaries: string[] = [];
  let maxScore = 0;
  let okChunks = 0;

  for (let i = 0; i < count; i++) {
    onProgress?.(i + 1, count);
    const chunk = text.slice(i * chunkChars, (i + 1) * chunkChars);
    let raw: string;
    try {
      raw = await callAutomationAI(buildUserMessage(chunk, i, count), systemPrompt, (info) => onRetry?.(info));
    } catch (e) {
      // Surface a hard failure on the first chunk; tolerate later-chunk hiccups.
      if (i === 0) throw e;
      continue;
    }
    const parsed = extractJson(raw);
    if (!parsed) continue;
    okChunks++;
    if (typeof parsed.risk_score === 'number') maxScore = Math.max(maxScore, parsed.risk_score);
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) summaries.push(parsed.summary.trim());
    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings as GuardFinding[]) {
        if (f && f.title && f.severity) findings.push(f);
      }
    }
  }

  if (okChunks === 0) {
    throw new Error('Could not parse AI response as JSON — the model may have returned malformed output. Try again.');
  }

  // Dedupe findings by normalized title, keeping the highest severity seen.
  const byTitle = new Map<string, GuardFinding>();
  for (const f of findings) {
    const key = (f.title || '').toLowerCase().trim();
    const existing = byTitle.get(key);
    if (!existing || (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[existing.severity] ?? 0)) {
      byTitle.set(key, f);
    }
  }
  const merged = [...byTitle.values()].sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
  );

  const summary = summaries.length > 0
    ? (count > 1 ? `Scanned the full document in ${count} section${count !== 1 ? 's' : ''}. ${summaries[0]}` : summaries[0])
    : 'Scan complete.';

  const scannedChars = Math.min(text.length, count * GUARD_CHUNK_CHARS);
  return {
    risk_score: maxScore,
    summary,
    findings: merged,
    chunksScanned: count,
    chunksTotal: totalChunks,
    truncated: totalChunks > GUARD_MAX_CHUNKS,
    approxTokens: Math.round(scannedChars / CHARS_PER_TOKEN) + count * 700,
  };
}
