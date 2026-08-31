import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../contexts/AuthContext";
import { getMonthlyUsage } from "../lib/tokenTracker";
import UsagePanel from "../components/UsagePanel";
import LicencePanel from "../components/LicencePanel";
import { TIER_LABEL, tierOf } from "../lib/entitlement";
import { supabase } from "../lib/supabase";

/**
 * L10 — THE PLAN WORDS.
 *
 * Every one of these strings is user-visible, and every one of them read wrong the moment the
 * pricing changed: "Solo", "Builder", "Team" are names the website no longer uses. They are derived
 * now from lib/entitlement.ts, which is also what the app meters against, so a customer cannot be
 * shown one plan and charged as another.
 *
 * The stored column is the LEGACY vocabulary — `business` there means the old Team, not the new
 * Business tier. tierOf is told which it is reading.
 */
const PLAN_LABEL: Record<string, string> = new Proxy({}, {
  get: (_t, key: string) => TIER_LABEL[tierOf(key, 'plan')],
}) as Record<string, string>;

const PLAN_COLOR: Record<string, string> = {
  free:     "text-nv-muted  bg-nv-surface2",
  explore:  "text-nv-muted  bg-nv-surface2",
  solo:     "text-nv-green  bg-nv-green/10",
  builder:  "text-accent    bg-accent/10",
  business: "text-accent    bg-accent/10",
  custom:   "text-nv-yellow bg-nv-yellow/10",
};

const PLAN_LIMIT: Record<string, number> = {
  free:     100_000,
  explore:  100_000,
  solo:     4_000_000,
  builder:  16_000_000,
  business: 50_000_000,
  custom:   0,
};

export default function AccountPanel() {
  const { profile, user, signOut } = useAuth();
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [tokenUsed, setTokenUsed] = useState<number | null>(null);
  /**
   * The two billing facts the profile does not carry: when a cancelled plan actually stops, and
   * whether there is a Razorpay subscription behind it at all.
   *
   * Read here rather than added to AuthContext on purpose — the auth path is deliberately left
   * alone, and this is the only screen that needs the dates.
   */
  const [billing, setBilling] = useState<{ graceEnd: string | null; hasSub: boolean; teamSize: number } | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data } = await supabase.from('users')
          .select('grace_period_end, razorpay_subscription_id, team_id')
          .eq('id', session.user.id).single();
        if (dead) return;
        // HOW MANY PEOPLE SHARE THIS ALLOWANCE. A Team subscription buys one pot of tokens and the
        // server divides it across the active seats — so a member of a three-person workspace has a
        // third of it. Showing the undivided plan figure here meant the app promised 50,000,000
        // while the server cut them off at 16,666,666, and the person in front of it had no way to
        // know which number was real.
        let teamSize = 1;
        if (data?.team_id) {
          const { count } = await supabase.from('team_members')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', String(data.team_id)).eq('status', 'active');
          teamSize = Math.max(1, Number(count ?? 1) || 1);
        }
        setBilling({
          graceEnd: (data?.grace_period_end as string | null) ?? null,
          hasSub: !!data?.razorpay_subscription_id,
          teamSize,
        });
      } catch { /* offline — the panel simply omits the dates */ }
    })();
    return () => { dead = true; };
    // Re-read when the plan or status changes: a webhook or a cancellation arrives over realtime,
    // and the date underneath it moves with them.
  }, [profile?.plan, profile?.subscription_status]);

  useEffect(() => {
    // Free/explore quotas are LIFETIME, not monthly. Passing the flag matters: without it this
    // panel counted only the current month while Home, Krew and Coder counted lifetime, so the
    // same allowance was reported as two different numbers depending on where you looked.
    const pl = profile?.plan ?? 'explore';
    getMonthlyUsage(pl === 'free' || pl === 'explore').then((used) => setTokenUsed(used)).catch(() => {});
    const un = listen<{ tokens: number }>('nivara-tokens', (e) => setTokenUsed((p) => (p ?? 0) + (e.payload?.tokens || 0)));
    // Spend that happened elsewhere (Guard, Research, an automation) never reaches the listener,
    // so re-read the authoritative total periodically instead of trusting one snapshot.
    const refresh = () => getMonthlyUsage(pl === 'free' || pl === 'explore').then(setTokenUsed).catch(() => {});
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const iv = setInterval(refresh, 60_000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(iv); un.then((f) => f()).catch(() => {}); };
    // Re-read once the profile arrives — the plan decides monthly vs lifetime, and on first render
    // it is still null.
  }, [profile?.plan]);

  async function runDiag() {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const result = await invoke<string>('test_krew_connection');
      setDiagResult(result);
    } catch (e) {
      setDiagResult(`invoke error: ${e}`);
    }
    setDiagRunning(false);
  }

  const email      = profile?.email ?? user?.email ?? "—";
  const firstName  = profile?.first_name ?? "";
  const lastName   = profile?.last_name  ?? "";
  const fullName   = [firstName, lastName].filter(Boolean).join(" ") || null;
  const plan       = profile?.plan ?? "explore";
  const adminLevel = profile?.admin_level ?? null;
  const initial    = (fullName ?? email)[0]?.toUpperCase() ?? "N";
  const planLabel  = PLAN_LABEL[plan] ?? plan;
  const planColor  = PLAN_COLOR[plan] ?? PLAN_COLOR.explore;
  // Mirrors the division in get-session-key. Floor, so the figure shown is never larger than the
  // one enforced — being told you have slightly less than you do is survivable; the reverse is how
  // someone ends up believing they were cut off early.
  const teamSize     = billing?.teamSize ?? 1;
  const planLimit    = PLAN_LIMIT[plan] ?? 100_000;
  const tokenLimit   = planLimit > 0 && teamSize > 1 ? Math.floor(planLimit / teamSize) : planLimit;
  const isUnlimited  = tokenLimit === 0;
  const tokenFmt     = (n: number) => n.toLocaleString();

  return (
    <div className="flex-1 flex items-center justify-center bg-nv-bg">
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">

        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center text-accent text-2xl font-bold select-none">
            {initial}
          </div>
          {fullName && (
            <p className="text-nv-text text-base font-semibold">{fullName}</p>
          )}
          {adminLevel && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent uppercase tracking-wide">
              {adminLevel}
            </span>
          )}
        </div>

        {/* Info card */}
        <div className="bg-nv-surface border border-nv-border rounded-xl divide-y divide-nv-border">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Email</span>
            <span className="text-nv-text text-sm font-medium truncate max-w-[200px]">{email}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Plan</span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${planColor}`}>
              {planLabel}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Tokens</span>
            <span className="text-nv-text text-sm font-mono">
              {tokenUsed !== null
                ? isUnlimited
                  ? `${tokenFmt(tokenUsed)} / ∞`
                  : `${tokenFmt(tokenUsed)} / ${tokenFmt(tokenLimit)}`
                : '—'}
            </span>
          </div>
          {teamSize > 1 && (
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-nv-muted text-sm">Team</span>
              <span className="text-nv-text text-sm">
                {teamSize} members · sharing {tokenFmt(planLimit)} tokens
              </span>
            </div>
          )}
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Status</span>
            <span className="text-nv-text text-sm font-medium capitalize">
              {profile?.subscription_status ?? "free"}
            </span>
          </div>
          {/* WHEN A CANCELLED PLAN ACTUALLY ENDS. "Cancelled" on its own reads as "it is gone", and
              it is not — the plan runs to the end of the period already paid for. Without the date
              the honest reaction is to assume access has already been lost and to pay again. */}
          {profile?.subscription_status === "cancelled" && billing?.graceEnd && (
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-nv-muted text-sm">Access until</span>
              <span className="text-nv-text text-sm font-medium">
                {new Date(billing.graceEnd).toLocaleDateString(undefined, {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </span>
            </div>
          )}
        </div>

        {/* Managing the subscription — renewal date, and cancelling — lives on the website, which
            is where the payment was made and where the card details are. Duplicating it in here
            would mean two places to keep correct about someone's money. */}
        {!["free", "explore"].includes(profile?.plan ?? "explore") && (
          <button
            onClick={async () => {
              const url = "https://www.adris.tech/pricing.html";
              try {
                const { open } = await import("@tauri-apps/plugin-shell");
                await open(url);
              } catch { window.open(url, "_blank"); }
            }}
            className="w-full py-2.5 rounded-lg border border-nv-border text-nv-text text-sm font-medium hover:border-accent/50 transition-fast"
          >
            Manage subscription
            <span className="block text-[11px] text-nv-faint font-normal mt-0.5">
              {profile?.subscription_status === "cancelled"
                ? "See when access ends, or resubscribe"
                : billing?.hasSub === false
                  ? "This plan was set up manually — contact support to change it"
                  : "Renewal date, payment method, or cancel"}
            </span>
          </button>
        )}

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full py-2.5 rounded-lg border border-nv-red/40 text-nv-red text-sm font-medium hover:bg-nv-red/10 transition-fast"
        >
          Sign out
        </button>

        {/* ── USAGE, IN DETAIL ───────────────────────────────────────────
            The bar above this shows one number against a plan limit, which is the right amount of
            detail for a quota. Pay-per-use turns that number into a bill, and a bill has to be
            checkable: what was billable, what the user's own key covered, which days, which parts
            of the app. */}
        {/* WHAT YOU HAVE, BEFORE WHAT YOU SPENT.
            The usage panel below answers "where did it go"; this answers "what have I got and how
            much is left", which is the question people arrive with. */}
        <LicencePanel />
        <UsagePanel periodStart={(profile as { usage_period_start?: string } | null)?.usage_period_start ?? null} />

        {/* Connection diagnostic */}
        <div className="border border-nv-border rounded-xl overflow-hidden">
          <button
            onClick={runDiag}
            disabled={diagRunning}
            className="w-full px-5 py-3 text-left text-xs text-nv-muted hover:bg-nv-surface2 transition-fast disabled:opacity-50"
          >
            {diagRunning ? "Testing connection…" : "Test adris.tech AI connection"}
          </button>
          {diagResult && (
            <pre className="px-5 py-3 text-[11px] text-nv-text bg-nv-surface whitespace-pre-wrap border-t border-nv-border font-mono leading-relaxed">
              {diagResult}
            </pre>
          )}
        </div>

      </div>
    </div>
  );
}