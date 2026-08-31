// ─── What this customer is entitled to, and how much is left ─────────────────
//
// One place that answers those two questions. The exe reads it, the website writes what it is
// derived from, and it has to keep working when the connection does not.
//
// ── WHY THIS EXISTS (L1–L4, L10) ────────────────────────────────────────────
//
// The plan words in the app are wrong in three separate ways at once. The title bar reads
// "Free / Solo / Builder / Team" — names the pricing page no longer uses — and it sits inches from
// a menu offering pay-per-use, so the two halves of the screen describe different products. The
// badge also says only WHICH plan, never how much of it is left, which is the one number a customer
// on a metered product actually wants.
//
// ── THE RULE THAT GOVERNS ALL OF IT (L3) ────────────────────────────────────
//
// **Only work that ran on adris.tech's own AI may ever be metered.** A customer's own API key,
// their own Claude or Codex subscription through the bridge, and a model running on their own
// machine all cost us nothing, so they must cost them nothing — and must not consume an allowance
// either. `usageMeter.billingSource` already draws exactly that line; this module reuses it rather
// than inventing a second, subtly different one, because two rules that must agree eventually will
// not.
//
// ── AND THE ONE THAT KEEPS IT USABLE (L4) ───────────────────────────────────
//
// adris runs on machines with bad connections. An entitlement check that fails closed the moment
// Wi-Fi drops turns a network blip into a support call and a customer who cannot work. So a
// verification is cached and honoured for a grace window, and only after that does the app step
// down — and even then it steps down to "use your own key or a local model", never to a locked
// door, because those paths never needed us in the first place.

import { billingSource } from './usageMeter';

/** The four tiers on the pricing page. */
export type Tier = 'free' | 'business' | 'growth' | 'enterprise';

export const TIERS: Tier[] = ['free', 'business', 'growth', 'enterprise'];

/** What each tier is called, in the customer's words. */
export const TIER_LABEL: Record<Tier, string> = {
  free: 'Free',
  business: 'Business',
  growth: 'Growth',
  enterprise: 'Enterprise',
};

/**
 * The plan keys already stored against existing accounts.
 *
 * Six old keys, four new tiers. Nobody's account may silently change what it can do, so the map is
 * chosen to never take anything away: whichever tier is at least as generous as what they had.
 */
const LEGACY: Record<string, Tier> = {
  free: 'free',
  explore: 'free',
  solo: 'business',
  builder: 'growth',
  business: 'growth',     // the old "Team"
  custom: 'enterprise',
};

/**
 * Read a tier from a stored value.
 *
 * ── THE COLLISION THAT MAKES THIS AWKWARD ───────────────────────────────────
 *
 * `business` is a word in BOTH vocabularies, and it means opposite things in each. As an old plan
 * key it is "Team" — the most generous paid plan we sold. As a new tier it is Business — the
 * CHEAPEST paid tier. Reading an old value with the new vocabulary therefore downgrades every
 * existing Team customer, quietly, and they would find out when something stopped working.
 *
 * No amount of cleverness can tell the two apart from the string, so the caller says which column
 * it read. `plan` is what every existing account carries, so it is the default.
 */
export function tierOf(
  stored: string | null | undefined,
  vocabulary: 'plan' | 'tier' = 'plan',
): Tier {
  const p = String(stored || '').trim().toLowerCase();
  if (vocabulary === 'tier') {
    return (TIERS as string[]).includes(p) ? (p as Tier) : 'free';
  }
  // The legacy vocabulary. A value that is ONLY a new tier name (growth, enterprise) is still
  // understood, because a migrated row may carry one.
  if (LEGACY[p]) return LEGACY[p];
  if ((TIERS as string[]).includes(p)) return p as Tier;
  return 'free';
}

export interface Allowance {
  /** Monthly AI capacity, in tokens. */
  tokens: number;
  /** AI-generated images a month. */
  images: number;
  /** Cloud automation runs a month. */
  runs: number;
  /** People who can use it. */
  seats: number;
  /** Machines that can share memory. */
  meshDevices: number;
}

/**
 * The published monthly allowances.
 *
 * These are the numbers on the pricing page, in one place, so a figure can never be right on the
 * website and wrong in the app. Enterprise is "fair use" rather than truly unlimited — an
 * unqualified "unlimited" is a promise that gets broken quietly the first time anyone is throttled.
 */
export const ALLOWANCE: Record<Tier, Allowance> = {
  free:       { tokens:    300_000, images:  10, runs:    3, seats:  2, meshDevices:  1 },
  business:   { tokens:  8_000_000, images: 100, runs: 1500, seats: 10, meshDevices: 25 },
  growth:     { tokens: 25_000_000, images: 400, runs: 5000, seats: 25, meshDevices: 50 },
  enterprise: { tokens: Number.POSITIVE_INFINITY, images: Number.POSITIVE_INFINITY,
                runs: Number.POSITIVE_INFINITY, seats: Number.POSITIVE_INFINITY,
                meshDevices: Number.POSITIVE_INFINITY },
};

/** Does this tier get the security scanner, single sign-on, a shared workspace? */
export const FEATURES: Record<Tier, { guard: boolean; sso: boolean; workspace: 'none' | 'basic' | 'full' | 'roles' }> = {
  free:       { guard: false, sso: false, workspace: 'none' },
  business:   { guard: true,  sso: false, workspace: 'basic' },
  growth:     { guard: true,  sso: true,  workspace: 'full' },
  enterprise: { guard: true,  sso: true,  workspace: 'roles' },
};

/**
 * Tokens as TASKS.
 *
 * Nobody outside this industry knows what a token is, and a bill denominated in them cannot be
 * checked by the person paying it. The pricing page's own FAQ sets the rate — "one typical task
 * uses around 1,000 tokens" — so the app uses the same one, and shows tokens underneath for anyone
 * who wants them.
 */
export const TOKENS_PER_TASK = 1000;
export function tasksFrom(tokens: number): number {
  return Math.max(0, Math.round((Number(tokens) || 0) / TOKENS_PER_TASK));
}

export interface Used { tokens: number; images: number; runs: number; }

export interface Remaining {
  tokens: number; images: number; runs: number;
  tasksLeft: number;
  /** 0–1, how much of the token allowance is gone. */
  spent: number;
  /** True once anything is exhausted. */
  anyExhausted: boolean;
  unlimited: boolean;
}

/** What is left this period. Never negative, and never NaN on a missing figure. */
export function remaining(tier: Tier, used: Partial<Used> | null | undefined): Remaining {
  const a = ALLOWANCE[tier];
  const u = { tokens: 0, images: 0, runs: 0, ...(used ?? {}) };
  const left = (cap: number, spent: number) =>
    cap === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, cap - Math.max(0, spent || 0));
  const tokens = left(a.tokens, u.tokens);
  const unlimited = a.tokens === Number.POSITIVE_INFINITY;
  return {
    tokens, images: left(a.images, u.images), runs: left(a.runs, u.runs),
    tasksLeft: unlimited ? Number.POSITIVE_INFINITY : tasksFrom(tokens),
    spent: unlimited ? 0 : Math.min(1, Math.max(0, (u.tokens || 0) / a.tokens)),
    anyExhausted: !unlimited && (tokens <= 0 || left(a.images, u.images) <= 0 || left(a.runs, u.runs) <= 0),
    unlimited,
  };
}

/** Days until the allowance resets, from the period start. */
export function daysToReset(periodStart: string | Date | null | undefined, now: Date = new Date()): number {
  const start = periodStart ? new Date(periodStart) : null;
  if (!start || Number.isNaN(start.getTime())) {
    // No recorded period: fall back to the calendar month, which is what the counters already do.
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
  }
  const next = new Date(start);
  next.setMonth(next.getMonth() + 1);
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86_400_000));
}

// ── Only our own AI is ever metered (L3) ────────────────────────────────────

/**
 * Does this row consume the customer's allowance?
 *
 * Delegates to `billingSource` on purpose. That function already decides who paid for a request —
 * and the bridge deliberately maps to `own_key`, never to `adris` — so building a second rule here
 * would create two answers that must agree forever and eventually will not.
 */
export function consumesAllowance(row: Partial<{ source?: string | null; tokens_consumed?: number; task_type?: string }> | null | undefined): boolean {
  if (!row) return false;
  // billingSource takes the MODE STRING, not the row. Handing it the object returned 'unknown'
  // for everything — and unknown is deliberately not billable — so no usage would ever have counted
  // against an allowance. The same shape of mistake this file's comment warns about, made again.
  return billingSource((row as { source?: string | null }).source) === 'adris';
}

/** Add up only what the customer's allowance should actually be charged for. */
export function usedFrom(rows: ReadonlyArray<Partial<{ source?: string | null; tokens_consumed?: number; task_type?: string }>>): Used {
  const out: Used = { tokens: 0, images: 0, runs: 0 };
  for (const r of rows ?? []) {
    if (!consumesAllowance(r)) continue;
    out.tokens += Number((r as { tokens_consumed?: number }).tokens_consumed) || 0;
    const task = String((r as { task_type?: string }).task_type || '');
    if (/image/i.test(task)) out.images += 1;
    if (/automation/i.test(task)) out.runs += 1;
  }
  return out;
}

// ── Entitlement, and surviving no internet (L4) ─────────────────────────────

export type EntitlementState = 'active' | 'grace' | 'stale';

/** How long a verified entitlement is honoured with no contact at all. */
export const GRACE_DAYS = 14;

export interface Verification {
  /** When the server last confirmed this entitlement. */
  verifiedAt: number | null;
  /** The machine this was confirmed for, if it is bound to one. */
  machineId?: string | null;
}

/**
 * Is this entitlement still good?
 *
 * `active` while it has been confirmed recently. `grace` when we have not been able to reach the
 * server but the last confirmation is inside the window — the customer keeps working and is told
 * nothing, because a dropped connection is not their problem to solve. `stale` only after the
 * window has passed, and even then the app must not lock: their own key and a local model never
 * needed us, and taking those away would be punishing someone for our own outage.
 */
export function entitlementState(v: Verification, now: number = Date.now(), graceDays: number = GRACE_DAYS): EntitlementState {
  if (!v || !v.verifiedAt) return 'stale';
  const age = now - v.verifiedAt;
  if (age < 0) return 'active';                    // clock skew: never punish for a fast clock
  const day = 86_400_000;
  if (age <= day) return 'active';
  return age <= graceDays * day ? 'grace' : 'stale';
}

/** Plain words for that state, for the licence screen and the title bar. */
export function stateLabel(s: EntitlementState): string {
  return s === 'active' ? 'Active'
    : s === 'grace' ? 'Active — offline'
    : 'Needs checking';
}

/**
 * Is this entitlement bound to a different machine?
 *
 * Binding exists so a licence is not shared around an office it was not bought for. It must never
 * fire on a machine we cannot identify — an unknown id is our failure, not the customer's.
 */
export function boundElsewhere(v: Verification, thisMachine: string | null | undefined): boolean {
  if (!v?.machineId || !thisMachine) return false;
  return v.machineId !== thisMachine;
}

/** What the customer gets, in the words the licence screen shows. */
export function covers(tier: Tier): string[] {
  const a = ALLOWANCE[tier];
  const f = FEATURES[tier];
  const n = (x: number) => (x === Number.POSITIVE_INFINITY ? 'Unlimited (fair use)' : x.toLocaleString('en-IN'));
  return [
    `${a.tokens === Number.POSITIVE_INFINITY ? 'Unlimited' : tasksFrom(a.tokens).toLocaleString('en-IN')} AI tasks a month`,
    `${n(a.images)} AI images a month`,
    `${n(a.runs)} cloud automation runs a month`,
    `${n(a.seats)} ${a.seats === 1 ? 'seat' : 'seats'}`,
    `${n(a.meshDevices)} Mesh ${a.meshDevices === 1 ? 'device' : 'devices'}`,
    f.guard ? 'Guard security scanner' : 'Guard not included',
    f.sso ? 'Single sign-on and admin controls' : 'No single sign-on',
    'Your own API key or a local model — always free, never counted',
  ];
}
