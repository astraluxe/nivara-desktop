// ─── One answer, everywhere, that survives no internet ───────────────────────
//
// The title bar, the licence screen and the account panel must never disagree about what someone is
// entitled to. They did: the badge read a plan name from the profile, the account panel counted
// tokens separately, and neither knew what the other had found.
//
// This is the single loader. It fetches once, caches what it learned, and hands every screen the
// same object.
//
// ── THE CACHE IS THE POINT (L4) ─────────────────────────────────────────────
//
// adris is built for machines on bad connections. If this failed closed, a five-minute outage at
// the customer's end would blank their allowance, grey out their plan, and generate a support call
// about a problem that was never theirs. So the last good answer is written to disk and honoured
// for a grace window, and the UI is told whether it is looking at a fresh answer or a remembered
// one — never left to imply freshness it does not have.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  tierForAccount, remaining, usedFrom, daysToReset, entitlementState, boundElsewhere, isOneTime,
  type Tier, type Used, type Remaining, type EntitlementState,
} from './entitlement';

const CACHE_KEY = 'nv-entitlement';

export interface Entitlement {
  tier: Tier;
  used: Used;
  left: Remaining;
  resetsInDays: number;
  /** True when this allowance never comes back — do not promise a reset. */
  oneTime: boolean;
  /** Fresh, remembered-while-offline, or too old to trust. */
  state: EntitlementState;
  /** True while the first load is still in flight and there was no cache. */
  loading: boolean;
  /** Set when the entitlement is bound to a machine that is not this one. */
  wrongMachine: boolean;
  /** When the figures were last confirmed by the server. */
  verifiedAt: number | null;
  machineId: string | null;
  refresh: () => void;
}

interface Cached {
  tier: Tier; used: Used; periodStart: string | null;
  verifiedAt: number; machineId: string | null;
}

function readCache(): Cached | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    if (!c || typeof c.verifiedAt !== 'number') return null;
    return c;
  } catch { return null; }
}

function writeCache(c: Cached) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota, private mode */ }
}

/**
 * This machine's identity, for binding.
 *
 * Generated once and kept. It is deliberately NOT a hardware fingerprint: we are stopping one
 * licence being passed around an office, not building an anti-piracy system, and a fingerprint that
 * changes when someone upgrades their RAM would lock out a paying customer for no reason.
 */
export function machineId(): string {
  try {
    let id = localStorage.getItem('nv-machine-id');
    if (!id) {
      id = 'm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('nv-machine-id', id);
    }
    return id;
  } catch { return ''; }
}

export function useEntitlement(): Entitlement {
  // The live plan. AuthContext keeps this current through a realtime subscription, so a payment on
  // the website changes it here without a restart.
  const { profile } = useAuth();
  // The whole account, not just its plan string: an admin or head account is Enterprise however
  // its `plan` column happens to read. See tierForAccount.
  const planFromAuth = profile?.plan ?? null;
  const adminLevel = profile?.admin_level ?? null;
  const cached = readCache();
  const [tier, setTier] = useState<Tier>(cached?.tier ?? 'free');
  const [used, setUsed] = useState<Used>(cached?.used ?? { tokens: 0, images: 0, runs: 0 });
  const [periodStart, setPeriodStart] = useState<string | null>(cached?.periodStart ?? null);
  const [verifiedAt, setVerifiedAt] = useState<number | null>(cached?.verifiedAt ?? null);
  const [boundTo, setBoundTo] = useState<string | null>(cached?.machineId ?? null);
  const [loading, setLoading] = useState(!cached);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { if (!dead) setLoading(false); return; }

        // The plan comes from AuthContext (see the note above) — not re-queried here. Only the two
        // columns nothing else reads are fetched.
        const { data: extra } = await supabase
          .from('users')
          .select('usage_period_start, licence_machine_id')
          .eq('id', session.user.id)
          .single();

        // The stored column is the LEGACY vocabulary — see the note on tierOf about `business`
        // meaning opposite things in the two.
        const t = tierForAccount({ plan: planFromAuth, admin_level: adminLevel });
        const start = (extra as { usage_period_start?: string } | null)?.usage_period_start ?? null;
        const bound = (extra as { licence_machine_id?: string } | null)?.licence_machine_id ?? null;

        // A ONE-TIME ALLOWANCE IS COUNTED OVER ALL TIME.
        //
        // Free does not refill (see RENEWS), so counting only this month's rows would silently hand
        // the user a fresh 300,000 tokens on the first of every month — which is precisely the
        // promise the owner decided NOT to make. Paid tiers still count from the period start.
        let q = supabase
          .from('token_usage')
          .select('tokens_consumed, task_type, source')
          .eq('user_id', session.user.id);
        if (!isOneTime(t)) {
          const from = start ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
          q = q.gte('created_at', from);
        }
        const { data: rows } = await q;

        const u = usedFrom(rows ?? []);
        if (dead) return;
        setTier(t); setUsed(u); setPeriodStart(start); setBoundTo(bound);
        setVerifiedAt(Date.now());
        setLoading(false);
        writeCache({ tier: t, used: u, periodStart: start, verifiedAt: Date.now(), machineId: bound });
      } catch {
        // OFFLINE, OR THE SERVER IS HAVING A BAD DAY. Keep whatever was last known — the state
        // below will report it as remembered rather than fresh — and never blank the screen.
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
    // Re-run whenever the plan changes — that is the moment a payment lands.
  }, [nonce, planFromAuth, adminLevel]);

  // The plan is authoritative the moment AuthContext has it; usage catches up a beat later. Showing
  // the OLD tier while the new one is already known is the bug this whole note is about.
  const liveTier = profile ? tierForAccount({ plan: planFromAuth, admin_level: adminLevel }) : tier;

  return {
    tier: liveTier, used,
    left: remaining(liveTier, used),
    resetsInDays: daysToReset(periodStart),
    oneTime: isOneTime(liveTier),
    state: entitlementState({ verifiedAt, machineId: boundTo }),
    loading,
    wrongMachine: boundElsewhere({ verifiedAt, machineId: boundTo }, machineId()),
    verifiedAt,
    machineId: boundTo,
    refresh: () => setNonce((n) => n + 1),
  };
}
