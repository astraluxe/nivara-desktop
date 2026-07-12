import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAuth } from "../contexts/AuthContext";
import { getMonthlyUsage } from "../lib/tokenTracker";

const PLAN_LABEL: Record<string, string> = {
  free:     "Free",
  explore:  "Explore",
  solo:     "Solo",
  builder:  "Builder",
  business: "Team",
  custom:   "Custom",
};

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

  useEffect(() => {
    getMonthlyUsage().then((used) => setTokenUsed(used)).catch(() => {});
    const un = listen<{ tokens: number }>('nivara-tokens', (e) => setTokenUsed((p) => (p ?? 0) + (e.payload?.tokens || 0)));
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

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
  const tokenLimit   = PLAN_LIMIT[plan] ?? 100_000;
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
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Status</span>
            <span className="text-nv-text text-sm font-medium capitalize">
              {profile?.subscription_status ?? "free"}
            </span>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full py-2.5 rounded-lg border border-nv-red/40 text-nv-red text-sm font-medium hover:bg-nv-red/10 transition-fast"
        >
          Sign out
        </button>

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