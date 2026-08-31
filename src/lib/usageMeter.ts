// ─── What a user actually owes ───────────────────────────────────────────────
//
// adris is moving to pay-per-use, which changes what the usage number IS. Until now it was a quota
// display: roughly right was fine, and nobody was harmed by a rounding error. The moment it becomes
// an invoice, every one of those "roughly rights" is a customer being over- or under-charged.
//
// This file is the arithmetic, kept pure so it can be checked without a database. What it will not
// do is invent a price — see RATE_CARD.
//
// ── WHAT THE EXISTING DATA COULD NOT DO, AND WHY ────────────────────────────
//
// The `token_usage` table has counted 11 million tokens across 900 rows since June, and none of it
// was billable as it stood:
//
//   1. NO INPUT/OUTPUT SPLIT. One blended `tokens_consumed`. Output tokens cost several times input
//      at every provider, so one number is generous to heavy writers and punitive to heavy readers.
//   2. THE MODEL WAS HARDCODED. Every row said `gemini-3-flash-preview` regardless of what actually
//      ran, so per-model pricing was impossible and the data was simply wrong.
//   3. NO RECORD OF WHOSE KEY PAID. A user on their own Claude subscription, their own API key, or
//      a local model costs us nothing. Billing them per token would be charging for something we
//      did not pay for.
//   4. THE USER COULD EDIT IT. RLS allowed UPDATE and DELETE on your own rows. Fixed in the
//      migration `harden_token_usage_for_pay_per_use`.

/** The AI-source modes the app resolves to, and what each means for a bill. */
export type BillingSource = 'adris' | 'own_key' | 'local' | 'bridge' | 'unknown';

/**
 * Who paid for this call.
 *
 * **Only `adris` is billable.** The other three are the user's own capacity: their API key, their
 * machine, or the Claude/Codex subscription they already pay for. Charging per token for those
 * would be charging for something adris never bought — and the bridge is sold on exactly that
 * promise, so getting this wrong would contradict the pitch on the pricing page.
 */
export function billingSource(mode: string | null | undefined): BillingSource {
  switch (mode) {
    // The app's own mode names, as `resolveAiSource` reports them.
    case 'nivara':    return 'adris';
    case 'agent_cli': return 'bridge';
    case 'own_key':   return 'own_key';
    case 'local':     return 'local';

    // ── AND ITS OWN OUTPUT, WHICH IS THE POINT ──────────────────────────────
    //
    // The value is mapped ON WRITE (tokenTracker stores `billingSource(mode)`) and mapped again ON
    // READ (this file re-derives it from the stored string). Without these two cases the second
    // mapping does not recognise its own output: every 'adris' row came back 'unknown', unknown is
    // deliberately not billable, and the effect was that NOBODY WOULD EVER BE BILLED. It failed
    // silently and in the safe direction, which is exactly why it would have survived a launch.
    //
    // So this has to be idempotent, and there is a test that says so.
    case 'adris':     return 'adris';
    case 'bridge':    return 'bridge';
    case 'unknown':   return 'unknown';

    default:          return 'unknown';
  }
}

/**
 * `unknown` is deliberately NOT billable.
 *
 * Every row written before the `source` column existed is unknown, and there is no way to tell now
 * which of them ran on our key. Billing an ambiguous row means charging someone for usage we cannot
 * prove we paid for; not billing it costs us a little revenue on historic data. That is the right
 * way round, and it is a one-time cost that ends as soon as rows carry a source.
 */
export function isBillable(source: BillingSource): boolean {
  return source === 'adris';
}

// ── The rate card ────────────────────────────────────────────────────────────

export interface Rate {
  /** Paise per million input tokens. */
  inputPaisePerMTok: number;
  /** Paise per million output tokens. */
  outputPaisePerMTok: number;
}

/**
 * PRICES ARE NOT SET, AND ARE NOT GUESSED HERE.
 *
 * The owner is deciding them. An invented number would flow straight into a customer's invoice and
 * look authoritative, so this stays empty and every surface says "pricing not set yet" rather than
 * showing a figure nobody chose. Fill this in, bump `RATE_VERSION`, and the screens light up.
 *
 * `rate_version` is stored on every priced row so an old invoice can still be reproduced exactly
 * after the card changes. Never re-price history in place.
 */
export const RATE_CARD: Record<string, Rate> = {};
export const RATE_VERSION = 'unset';

/** True once the owner has actually set prices. Every caller checks this before showing money. */
export function pricingReady(card: Record<string, Rate> = RATE_CARD): boolean {
  return Object.keys(card).length > 0;
}

// ── Pricing one row ──────────────────────────────────────────────────────────

export interface UsageRow {
  created_at: string;
  task_type: string;
  tokens_consumed: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  model_used?: string | null;
  source?: string | null;
}

/**
 * What one row costs, in paise, or null when it cannot be priced honestly.
 *
 * Returns null — rather than 0 — for anything unpriceable, so a caller cannot quietly add
 * "free" rows into a total and present it as complete. A total that silently omits rows is worse
 * than one that says how many it could not price.
 */
export function priceRow(row: UsageRow, card: Record<string, Rate> = RATE_CARD): number | null {
  if (!isBillable(billingSource(row.source))) return 0;
  const rate = card[row.model_used ?? ''] ?? card['*'];
  if (!rate) return null;

  // Fall back to the blended count when the split is missing, splitting it the way a chat turn
  // usually runs. It is an approximation and it is marked as one by `estimated` in the summary —
  // it must never be presented as a measured figure.
  const hasSplit = typeof row.input_tokens === 'number' && typeof row.output_tokens === 'number';
  const inTok  = hasSplit ? row.input_tokens! : Math.round(row.tokens_consumed * 0.75);
  const outTok = hasSplit ? row.output_tokens! : row.tokens_consumed - Math.round(row.tokens_consumed * 0.75);

  return Math.round(
    (inTok / 1_000_000) * rate.inputPaisePerMTok +
    (outTok / 1_000_000) * rate.outputPaisePerMTok,
  );
}

// ── Summarising for a screen ─────────────────────────────────────────────────

export interface UsageSummary {
  totalTokens: number;
  billableTokens: number;
  /** Tokens the user's own key, machine or subscription paid for — shown as money SAVED. */
  ownTokens: number;
  rows: number;
  /** Rows whose source predates the column, so we cannot say who paid. */
  unknownRows: number;
  /** Rows with no input/output split, so any price for them is an approximation. */
  estimatedRows: number;
  costPaise: number | null;
  /** Rows that could not be priced at all — the total is incomplete by this many. */
  unpricedRows: number;
  byDay: Array<{ day: string; tokens: number }>;
  byModule: Array<{ module: string; tokens: number; rows: number }>;
  bySource: Array<{ source: BillingSource; tokens: number; rows: number }>;
}

/** Everything a usage screen needs, from the raw rows, in one pass. */
export function summarise(rows: UsageRow[], card: Record<string, Rate> = RATE_CARD): UsageSummary {
  const day = new Map<string, number>();
  const mod = new Map<string, { tokens: number; rows: number }>();
  const src = new Map<BillingSource, { tokens: number; rows: number }>();

  let totalTokens = 0, billableTokens = 0, ownTokens = 0;
  let unknownRows = 0, estimatedRows = 0, unpricedRows = 0;
  let costPaise = 0;

  for (const r of rows) {
    const t = Math.max(0, r.tokens_consumed || 0);
    const s = billingSource(r.source);
    totalTokens += t;
    if (isBillable(s)) billableTokens += t;
    else if (s !== 'unknown') ownTokens += t;
    if (s === 'unknown') unknownRows++;
    if (typeof r.input_tokens !== 'number' || typeof r.output_tokens !== 'number') estimatedRows++;

    const d = (r.created_at || '').slice(0, 10);
    if (d) day.set(d, (day.get(d) ?? 0) + t);

    const m = mod.get(r.task_type) ?? { tokens: 0, rows: 0 };
    m.tokens += t; m.rows++; mod.set(r.task_type, m);

    const e = src.get(s) ?? { tokens: 0, rows: 0 };
    e.tokens += t; e.rows++; src.set(s, e);

    const p = priceRow(r, card);
    if (p === null) unpricedRows++;
    else costPaise += p;
  }

  return {
    totalTokens, billableTokens, ownTokens,
    rows: rows.length, unknownRows, estimatedRows, unpricedRows,
    // AN INCOMPLETE BILL IS NOT A BILL. If even one billable row could not be priced, the total is
    // knowably short and must not be shown as the amount owed — the first version summed what it
    // could and returned "₹0.00" for a period containing an unpriceable billable row, which is a
    // confidently wrong number and the most expensive kind, because the user believes it.
    //
    // Zero itself is fine and worth saying: a user who ran entirely on their own key genuinely owes
    // nothing, and telling them so plainly is the point of the whole bridge.
    costPaise: unpricedRows > 0 ? null : costPaise,
    byDay: [...day.entries()].map(([d, t]) => ({ day: d, tokens: t })).sort((a, b) => a.day.localeCompare(b.day)),
    byModule: [...mod.entries()].map(([k, v]) => ({ module: k, ...v })).sort((a, b) => b.tokens - a.tokens),
    bySource: [...src.entries()].map(([k, v]) => ({ source: k, ...v })).sort((a, b) => b.tokens - a.tokens),
  };
}

/** Paise as rupees, for display. Money is integer paise everywhere else. */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Big token counts, readably. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
