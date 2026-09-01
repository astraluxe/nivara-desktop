// ─── When the model answers with nothing, try a bigger one ───────────────────
//
// A user attached four lecture decks and asked for revision notes. The model returned an empty
// response, and the app told them so: "The model accepted the request and sent nothing back... try
// again, or switch the chat to another model." They switched by hand, to a larger model, and it
// worked first time.
//
// Their instruction: "makesure instead of giving tht message change the model for nvidia if on one
// high model and some other model does respond then change to tht one... but to a high model or
// higher b parameter model".
//
// They are right, and the app already knows enough to do it. modelHealth probes every model on the
// key and records which ones actually answer; rankScan orders the survivors. All that was missing
// was the step of reaching for the next one instead of handing the problem back.
//
// WHY BIGGER RATHER THAN MERELY DIFFERENT. An empty return on a long, document-heavy request is
// usually the model running out of room or giving up on the context, and the fix for that is more
// capacity — not another model of the same size, which fails the same way and wastes another
// minute of the user's evening.

/** One model the key can actually use, as modelHealth measured it. */
export interface ModelOption {
  id: string;
  /** Rough context window in tokens, when known. */
  window?: number;
}

/**
 * The parameter count a model id advertises, in billions. Null when it does not say.
 *
 * Ids are the only signal available without another network call, and they are remarkably
 * consistent about this: `llama-3.3-70b-instruct`, `qwen3-235b-a22b`, `mixtral-8x7b`. A
 * mixture-of-experts id gives both numbers and the product is the honest total, so `8x7b` is 56 and
 * not 7 — reading it as 7 would rank a large model below a small one.
 */
export function paramsOf(id: string): number | null {
  const s = String(id || '').toLowerCase();
  // 8x7b, 8x22b — experts × size.
  const moe = s.match(/\b(\d{1,2})\s*x\s*(\d{1,4})\s*b\b/);
  if (moe) return parseInt(moe[1], 10) * parseInt(moe[2], 10);
  // The plain form. Anchored so the "3" in "llama-3.3" and the "4" in "gpt-4" are not read as sizes.
  const all = [...s.matchAll(/(?:^|[^a-z0-9.])(\d{1,4}(?:\.\d)?)\s*b(?![a-z0-9])/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 2000);
  return all.length ? Math.max(...all) : null;
}

export interface FallbackPick {
  /** The model to try next. */
  id: string;
  /** True when it is genuinely larger than the one that failed, rather than merely different. */
  bigger: boolean;
}

/**
 * The next model worth trying after one came back empty.
 *
 * `options` is expected in rankScan order — reliable and quick first — so ties fall to the model
 * the app already measured as the better bet.
 *
 * Returns null when there is nothing left to try, which is when the user genuinely does need to be
 * told rather than kept waiting.
 */
export function nextModel(
  current: string,
  options: ModelOption[],
  tried: string[] = [],
): FallbackPick | null {
  const seen = new Set([current, ...tried].map((s) => String(s || '').toLowerCase()).filter(Boolean));
  const left = (options || []).filter((o) => o?.id && !seen.has(o.id.toLowerCase()));
  if (!left.length) return null;

  const mine = paramsOf(current);

  // 1. Something demonstrably bigger. Largest first, because the reason to move is capacity.
  const bigger = left
    .map((o) => ({ o, p: paramsOf(o.id) }))
    .filter((x) => x.p != null && (mine == null || x.p > mine))
    .sort((a, b) => (b.p as number) - (a.p as number));
  if (bigger.length) return { id: bigger[0].o.id, bigger: true };

  // 2. Nothing bigger by name, but a roomier context is the same argument by another measure.
  const myWindow = (options || []).find((o) => o.id.toLowerCase() === String(current).toLowerCase())?.window ?? 0;
  const roomier = left.filter((o) => (o.window ?? 0) > myWindow * 1.5).sort((a, b) => (b.window ?? 0) - (a.window ?? 0));
  if (roomier.length) return { id: roomier[0].id, bigger: true };

  // 3. Nothing is strictly bigger. Still take the LARGEST that is left rather than the
  //    fastest-ranked: we are here because a heavy request came back empty, and answering it with
  //    an 8b because a 56b was not quite bigger than the 70b that just failed is the wrong way
  //    round. Models whose id names no size sort last — unknown is not a reason to prefer.
  const bySize = left
    .map((o) => ({ o, p: paramsOf(o.id) }))
    .sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
  return { id: bySize[0].o.id, bigger: false };
}

/** What to tell the user, once, when the chat moves itself to another model. */
export function switchNote(from: string, to: string, bigger: boolean): string {
  return bigger
    ? `**${from}** came back empty on this one, so I moved to **${to}** — a larger model on the same key — and carried on. Nothing extra was charged to adris.tech.`
    : `**${from}** came back empty, so I tried **${to}** on the same key instead.`;
}
