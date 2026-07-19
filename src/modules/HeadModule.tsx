import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getMonthlyUsage } from '../lib/tokenTracker';

interface FeedbackRow {
  id: string;
  user_id: string | null;
  email: string | null;
  plan: string | null;
  type: 'suggestion' | 'error';
  message: string;
  created_at: string;
}

const TYPE_STYLE: Record<string, string> = {
  suggestion: 'text-accent bg-accent/10 border-accent/20',
  error:      'text-nv-red  bg-nv-red/10  border-nv-red/20',
};

const PLAN_STYLE: Record<string, string> = {
  explore: 'text-nv-faint',
  solo:    'text-nv-green',
  growth:  'text-nv-green',
  builder: 'text-accent',
  pro:     'text-nv-yellow',
  custom:  'text-nv-yellow',
};

// ─── Platform view ────────────────────────────────────────────────────────────
// RLS lets head/admin read every row of `users` and `token_usage`, so the Head can see how
// adris.tech is actually being used rather than only their own numbers. Everything is derived
// client-side from two selects — no new tables, no new endpoints.

interface PlatformStats {
  userCount: number;
  newThisWeek: number;
  activeThisMonth: number;
  byPlan: { plan: string; count: number }[];
  tokensThisMonth: number;
  tokensLifetime: number;
  callsThisMonth: number;
  topUsers: { email: string; plan: string; tokens: number }[];
  nearingLimit: { email: string; plan: string; used: number; cap: number }[];
  users: HeadUser[];
}

export interface HeadUser {
  id: string;
  email: string;
  plan: string;
  status: string | null;
  blocked: boolean;
  usedThisPeriod: number;
  periodStart: string | null;
  createdAt: string;
}

const PLAN_CAPS: Record<string, number> = {
  free: 100_000, explore: 100_000, solo: 4_000_000, builder: 16_000_000, business: 50_000_000,
};

async function loadPlatformStats(): Promise<PlatformStats | null> {
  try {
    const [{ data: users }, { data: usage }] = await Promise.all([
      supabase.from('users').select('id, email, plan, created_at, subscription_status, is_blocked, usage_period_start'),
      supabase.from('token_usage').select('user_id, tokens_consumed, created_at'),
    ]);
    // A non-admin only sees their own rows; that isn't a platform view, so show nothing.
    if (!users || users.length <= 1) return null;

    const now = Date.now();
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 86400000;
    const rows = (usage ?? []) as { user_id: string; tokens_consumed: number; created_at: string }[];

    const byUser = new Map<string, { month: number; life: number }>();
    let tokensThisMonth = 0, tokensLifetime = 0, callsThisMonth = 0;
    const activeIds = new Set<string>();
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      const tok = r.tokens_consumed ?? 0;
      const acc = byUser.get(r.user_id) ?? { month: 0, life: 0 };
      acc.life += tok;
      tokensLifetime += tok;
      if (t >= monthStart.getTime()) {
        acc.month += tok; tokensThisMonth += tok; callsThisMonth++; activeIds.add(r.user_id);
      }
      byUser.set(r.user_id, acc);
    }

    const emailOf = new Map(users.map((u) => [u.id as string, u as { email: string; plan: string }]));
    const planCounts = new Map<string, number>();
    for (const u of users) planCounts.set(u.plan ?? 'free', (planCounts.get(u.plan ?? 'free') ?? 0) + 1);

    const enriched = [...byUser.entries()]
      .map(([id, v]) => ({ email: emailOf.get(id)?.email ?? '—', plan: emailOf.get(id)?.plan ?? 'free', ...v }))
      .sort((a, b) => b.month - a.month);

    return {
      userCount: users.length,
      newThisWeek: users.filter((u) => new Date(u.created_at as string).getTime() >= weekAgo).length,
      activeThisMonth: activeIds.size,
      byPlan: [...planCounts.entries()].map(([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count),
      tokensThisMonth, tokensLifetime, callsThisMonth,
      topUsers: enriched.slice(0, 5).map((e) => ({ email: e.email, plan: e.plan, tokens: e.month })),
      users: (users as Record<string, unknown>[]).map((u) => {
        const start = (u.usage_period_start as string | null) ?? null;
        const since = start ? new Date(start).getTime() : monthStart.getTime();
        const mine = rows.filter((r) => r.user_id === u.id && new Date(r.created_at).getTime() >= since);
        return {
          id: String(u.id), email: String(u.email ?? '—'), plan: String(u.plan ?? 'free'),
          status: (u.subscription_status as string | null) ?? null,
          blocked: u.is_blocked === true,
          usedThisPeriod: mine.reduce((a, r) => a + (r.tokens_consumed ?? 0), 0),
          periodStart: start,
          createdAt: String(u.created_at ?? ''),
        };
      }).sort((a, b) => b.usedThisPeriod - a.usedThisPeriod),
      // Who is about to hit a wall — the thing worth acting on before they complain.
      nearingLimit: enriched
        .map((e) => ({ email: e.email, plan: e.plan, used: e.month, cap: PLAN_CAPS[e.plan] ?? 100_000 }))
        .filter((e) => e.cap > 0 && e.used / e.cap >= 0.75)
        .sort((a, b) => b.used / b.cap - a.used / a.cap)
        .slice(0, 5),
    };
  } catch {
    return null;
  }
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 min-w-[110px] rounded-xl border border-nv-border bg-nv-surface/50 px-3 py-2.5">
      <p className="nv-eyebrow text-nv-muted mb-1">{label}</p>
      <p className="text-[17px] font-semibold text-nv-text leading-none font-mono">{value}</p>
      {hint && <p className="text-[10px] text-nv-faint mt-1">{hint}</p>}
    </div>
  );
}

// ─── Head actions ─────────────────────────────────────────────────────────────
// Every write goes through the normal client with the Head's own JWT, so RLS decides whether it is
// allowed — the UI never grants permission, it only offers the button. A non-head who somehow
// reached this screen would have every one of these rejected by the database.
const PLANS = ['free', 'explore', 'solo', 'builder', 'business', 'custom'];

async function setUserPlan(id: string, plan: string) {
  const { error } = await supabase.from('users').update({ plan }).eq('id', id);
  if (error) throw new Error(error.message);
}
async function setUserBlocked(id: string, blocked: boolean) {
  const { error } = await supabase.from('users').update({ is_blocked: blocked }).eq('id', id);
  if (error) throw new Error(error.message);
}
/** Start a fresh usage period — the non-destructive way to give someone a clean slate. */
async function resetUsagePeriod(id: string) {
  const { error } = await supabase.from('users').update({ usage_period_start: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

function UserRow({ u, onDone }: { u: HeadUser; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const cap = PLAN_CAPS[u.plan] ?? 100_000;
  const pct = cap > 0 ? Math.min(100, Math.round((u.usedThisPeriod / cap) * 100)) : 0;

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr('');
    try { await fn(); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="px-3 py-2.5 border-b border-nv-border/60 last:border-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-nv-text flex-1 min-w-0 truncate">{u.email}</span>
        {u.blocked && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-nv-bad/40 text-nv-bad">BLOCKED</span>}
        <span className="text-[10px] font-mono text-nv-faint shrink-0">{fmt(u.usedThisPeriod)} · {pct}%</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        <select
          value={u.plan}
          disabled={busy}
          onChange={(e) => run(() => setUserPlan(u.id, e.target.value))}
          className="text-[10.5px] bg-nv-surface2 border border-nv-border rounded-md px-1.5 py-0.5 text-nv-text outline-none focus:border-accent disabled:opacity-50"
        >
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          disabled={busy}
          onClick={() => run(() => resetUsagePeriod(u.id))}
          title="Start a fresh usage period. Keeps their history — only changes what counts from now."
          className="text-[10px] px-2 py-0.5 rounded-md border border-nv-border text-nv-muted hover:text-accent hover:border-accent/40 transition-fast disabled:opacity-50"
        >
          Reset usage
        </button>
        <button
          disabled={busy}
          onClick={() => run(() => setUserBlocked(u.id, !u.blocked))}
          className={`text-[10px] px-2 py-0.5 rounded-md border transition-fast disabled:opacity-50 ${
            u.blocked ? 'border-nv-ok/40 text-nv-ok hover:bg-nv-ok/10' : 'border-nv-border text-nv-muted hover:text-nv-bad hover:border-nv-bad/40'
          }`}
        >
          {u.blocked ? 'Unblock' : 'Block'}
        </button>
        {u.status && <span className="text-[9px] font-mono text-nv-faint">{u.status}</span>}
      </div>
      {err && <p className="text-[10px] text-nv-bad mt-1">{err}</p>}
    </div>
  );
}

const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

export default function HeadModule() {
  const [rows, setRows]         = useState<FeedbackRow[]>([]);
  const [filter, setFilter]     = useState<'all' | 'suggestion' | 'error'>('all');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [tokenUsed, setTokenUsed] = useState<number | null>(null);

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [userQuery, setUserQuery] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    const [{ data, error: err }, usage, platform] = await Promise.all([
      supabase.from('feedback').select('*').order('created_at', { ascending: false }),
      getMonthlyUsage(),
      loadPlatformStats(),
    ]);
    if (err) setError(err.message);
    else setRows(data ?? []);
    setTokenUsed(usage);
    setStats(platform);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const visible = filter === 'all' ? rows : rows.filter(r => r.type === filter);
  const suggestions = rows.filter(r => r.type === 'suggestion').length;
  const errors      = rows.filter(r => r.type === 'error').length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-nv-border shrink-0">
        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4 text-accent shrink-0">
          <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.5l-4.8 2.4.9-5.4L2.2 7.7l5.4-.8L10 2z" fill="currentColor"/>
        </svg>
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-semibold text-nv-text leading-tight">Head Dashboard</span>
          <span className="text-[9px] font-mono text-nv-faint leading-tight">
            {loading ? '…' : `${suggestions} suggestion${suggestions !== 1 ? 's' : ''} · ${errors} error report${errors !== 1 ? 's' : ''}`}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono border border-nv-border rounded-lg text-nv-muted hover:border-accent/30 hover:text-accent transition-fast disabled:opacity-40 shrink-0"
        >
          {loading
            ? <><span className="w-2.5 h-2.5 rounded-full border border-current/30 border-t-current animate-spin" />Loading…</>
            : <>
                <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5"><path d="M10 6A4 4 0 112 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 3v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Refresh
              </>
          }
        </button>
      </div>

      {/* Platform overview */}
      {stats && (
        <div className="px-4 py-3 border-b border-nv-border shrink-0 bg-nv-surface/40 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Stat label="Users"          value={String(stats.userCount)}              hint={stats.newThisWeek > 0 ? `+${stats.newThisWeek} this week` : 'no signups this week'} />
            <Stat label="Active"         value={String(stats.activeThisMonth)}    hint="used AI this month" />
            <Stat label="Tokens · month" value={fmt(stats.tokensThisMonth)}       hint={`${stats.callsThisMonth} calls`} />
            <Stat label="Tokens · total" value={fmt(stats.tokensLifetime)}        hint="all time" />
            <Stat label="Paying"         value={String(stats.byPlan.filter((p) => p.plan !== 'free' && p.plan !== 'explore').reduce((s, p) => s + p.count, 0))} hint="on a paid plan" />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {stats.byPlan.map((p) => (
              <span key={p.plan} className="text-[11px] text-nv-muted">
                <span className="text-nv-text font-medium">{p.count}</span> {p.plan}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="nv-eyebrow text-nv-muted mb-1.5">Heaviest users this month</p>
              {stats.topUsers.length === 0 ? (
                <p className="text-[11px] text-nv-faint">No usage yet this month.</p>
              ) : stats.topUsers.map((u) => (
                <div key={u.email} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className="flex-1 min-w-0 truncate text-nv-muted">{u.email}</span>
                  <span className="text-[9px] font-mono text-nv-faint shrink-0">{u.plan}</span>
                  <span className="font-mono text-nv-text shrink-0">{fmt(u.tokens)}</span>
                </div>
              ))}
            </div>
            <div>
              {/* The actionable one: reach out before they hit the wall, not after. */}
              <p className="nv-eyebrow text-nv-muted mb-1.5">Nearing their limit</p>
              {stats.nearingLimit.length === 0 ? (
                <p className="text-[11px] text-nv-faint">Nobody is close to their cap.</p>
              ) : stats.nearingLimit.map((u) => {
                const pct = Math.round((u.used / u.cap) * 100);
                return (
                  <div key={u.email} className="flex items-center gap-2 text-[11px] py-0.5">
                    <span className="flex-1 min-w-0 truncate text-nv-muted">{u.email}</span>
                    <span className="text-[9px] font-mono text-nv-faint shrink-0">{u.plan}</span>
                    <span className={`font-mono shrink-0 ${pct >= 100 ? 'text-nv-bad' : 'text-nv-yellow'}`}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Manage people directly — plan, block, usage reset. */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="nv-eyebrow text-nv-muted">Users ({stats.users.length})</p>
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                placeholder="Filter by email or plan…"
                className="ml-auto flex-1 max-w-[240px] bg-nv-surface2 border border-nv-border focus:border-accent rounded-md px-2 py-1 text-[11px] text-nv-text placeholder:text-nv-faint outline-none transition-fast"
              />
            </div>
            <div className="rounded-xl border border-nv-border overflow-hidden max-h-[260px] overflow-y-auto">
              {stats.users
                .filter((u) => !userQuery.trim()
                  || u.email.toLowerCase().includes(userQuery.toLowerCase())
                  || u.plan.toLowerCase().includes(userQuery.toLowerCase()))
                .map((u) => <UserRow key={u.id} u={u} onDone={load} />)}
            </div>
            <p className="text-[10px] text-nv-faint mt-1.5">
              Every action here is authorised by the database, not by this screen — the same request from
              a non-head account is rejected.
            </p>
          </div>

          {tokenUsed !== null && (
            <p className="text-[10px] text-nv-faint pt-1 border-t border-nv-border/60">
              Your own usage this month: <span className="text-nv-muted font-mono">{tokenUsed.toLocaleString()}</span> tokens
            </p>
          )}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-nv-border shrink-0">
        {(['all', 'suggestion', 'error'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-mono capitalize transition-fast ${
              filter === f
                ? 'bg-accent/15 text-accent'
                : 'text-nv-faint hover:text-nv-muted'
            }`}
          >
            {f === 'all' ? 'All' : f === 'suggestion' ? 'Suggestions' : 'Error Reports'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="text-[11px] text-red-400 font-mono bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 h-48 text-nv-faint">
            <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8 opacity-30">
              <path d="M28 20a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
            <span className="text-[11px] font-mono">Nothing here yet.</span>
          </div>
        )}

        {visible.length > 0 && (
          <div className="flex flex-col gap-2 max-w-2xl mx-auto">
            {visible.map((row) => (
              <div key={row.id} className="bg-nv-surface border border-nv-border rounded-xl p-3.5 flex flex-col gap-2 hover:border-nv-muted/60 transition-fast">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Type badge */}
                  <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border capitalize shrink-0 ${TYPE_STYLE[row.type] ?? ''}`}>
                    {row.type === 'suggestion' ? 'Suggestion' : 'Error Report'}
                  </span>
                  {/* Plan */}
                  {row.plan && (
                    <span className={`text-[9px] font-mono capitalize shrink-0 ${PLAN_STYLE[row.plan] ?? 'text-nv-faint'}`}>
                      {row.plan}
                    </span>
                  )}
                  {/* Email */}
                  <span className="text-[10px] font-mono text-nv-muted truncate flex-1 min-w-0">
                    {row.email ?? 'anonymous'}
                  </span>
                  {/* Date */}
                  <span className="text-[9px] font-mono text-nv-faint shrink-0">
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-[12px] text-nv-text leading-relaxed whitespace-pre-wrap">{row.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
