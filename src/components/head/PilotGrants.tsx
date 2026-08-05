import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// ─── Pilot program ───────────────────────────────────────────────────────────
//
// Put an email on the pilot list and that person gets the plan — whether they already have an
// account or sign up next month. Before this, granting a plan meant editing the users table by
// hand in Supabase, which does nothing at all for someone who has not signed up yet, and left no
// record of who granted what.
//
// This is the same surface as the Pilot tab on the website admin dashboard, backed by the same
// pilot_grants table, so it does not matter which one you happen to have open.
//
// Head-admin only — but enforced by RLS on the table, not by this screen. Every request here is
// authorised by the database, so someone who reached this component another way still gets
// nothing. The UI hiding is a convenience, never the control.

interface Grant {
  id: string;
  email: string;
  plan: string;
  expires_at: string | null;
  note: string | null;
  granted_at: string;
  claimed_at: string | null;
  revoked_at: string | null;
}

const PLANS = ['solo', 'builder', 'business', 'custom'] as const;

export default function PilotGrants() {
  const [rows, setRows]     = useState<Grant[]>([]);
  const [loading, setLoad]  = useState(true);
  const [email, setEmail]   = useState('');
  const [plan, setPlan]     = useState<string>('builder');
  const [expires, setExp]   = useState('');
  const [note, setNote]     = useState('');
  const [msg, setMsg]       = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy]     = useState(false);

  async function load() {
    setLoad(true);
    const { data, error } = await supabase
      .from('pilot_grants').select('*').order('granted_at', { ascending: false });
    if (error) setMsg({ tone: 'bad', text: error.message });
    setRows((data as Grant[]) || []);
    setLoad(false);
  }
  useEffect(() => { void load(); }, []);

  async function grant() {
    const e = email.trim();
    if (!e || !e.includes('@')) { setMsg({ tone: 'bad', text: 'Enter a valid email address.' }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.from('pilot_grants').insert({
      email: e,
      plan,
      expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      // One ACTIVE grant per address, enforced by a partial unique index. Say what that means
      // rather than showing a constraint name.
      setMsg({ tone: 'bad', text: /duplicate|unique/i.test(error.message)
        ? 'That email already has an active pilot grant. Revoke it first to change the plan.'
        : error.message });
      return;
    }
    setMsg({ tone: 'ok', text: 'Granted. If they already have an account it applies the next time they sign in; if not, it applies the moment they sign up.' });
    setEmail(''); setNote('');
    void load();
  }

  async function revoke(id: string) {
    // Deliberately does NOT downgrade a plan that was already claimed. Silently taking a plan back
    // from someone mid-pilot would be worse than leaving it — say so and let the head decide.
    if (!confirm('Revoke this pilot grant?\n\nIf it has already been claimed their plan is NOT changed back — do that on the website admin Users tab.')) return;
    await supabase.from('pilot_grants').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    void load();
  }

  const status = (g: Grant) =>
    g.revoked_at ? { text: 'Revoked', cls: 'text-nv-faint' }
    : g.claimed_at ? { text: `Active · claimed ${new Date(g.claimed_at).toLocaleDateString()}`, cls: 'text-nv-ok' }
    : { text: 'Waiting for them to sign in', cls: 'text-accent' };

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="rounded-xl border border-nv-border bg-nv-surface p-3.5">
        <p className="text-[12.5px] font-semibold text-nv-text">Grant a pilot plan</p>
        <p className="text-[11px] text-nv-muted mt-0.5 leading-relaxed">
          Applied the moment they sign in — or automatically at signup if they don't have an account yet.
          One active grant per email.
        </p>

        <div className="mt-3 space-y-2">
          <input
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="their@email.com" type="email"
            className="w-full h-8 px-2.5 rounded-lg bg-nv-bg border border-nv-border text-[12px] text-nv-text placeholder:text-nv-faint focus:outline-none focus:border-accent/50"
          />
          <div className="flex gap-2">
            <select
              value={plan} onChange={(e) => setPlan(e.target.value)}
              className="flex-1 h-8 px-2 rounded-lg bg-nv-bg border border-nv-border text-[12px] text-nv-text focus:outline-none focus:border-accent/50"
            >
              {PLANS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
            <input
              value={expires} onChange={(e) => setExp(e.target.value)} type="date"
              title="Optional — leave blank for a pilot that doesn't expire"
              className="flex-1 h-8 px-2 rounded-lg bg-nv-bg border border-nv-border text-[12px] text-nv-text focus:outline-none focus:border-accent/50"
            />
          </div>
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note — why (e.g. 'design partner, Bengaluru')"
            className="w-full h-8 px-2.5 rounded-lg bg-nv-bg border border-nv-border text-[12px] text-nv-text placeholder:text-nv-faint focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={() => void grant()} disabled={busy}
            className="w-full h-8 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent-dim transition-fast disabled:opacity-50"
          >{busy ? 'Granting…' : 'Grant pilot plan'}</button>
        </div>

        {msg && (
          <p className={`text-[11px] mt-2 leading-relaxed ${msg.tone === 'ok' ? 'text-nv-ok' : 'text-nv-bad'}`}>{msg.text}</p>
        )}
      </div>

      <div>
        <p className="text-[9.5px] uppercase tracking-wide text-nv-faint mb-1.5 px-1">
          Pilot grants{rows.length ? ` · ${rows.length}` : ''}
        </p>
        {loading ? (
          <p className="text-[11.5px] text-nv-faint px-1">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[11.5px] text-nv-faint px-1">No pilot grants yet.</p>
        ) : rows.map((g) => {
          const st = status(g);
          return (
            <div key={g.id} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border border-nv-border mb-1.5 ${g.revoked_at ? 'opacity-55' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-mono text-nv-text truncate">{g.email}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-accent/30 text-accent bg-accent/5">{g.plan}</span>
                  <span className={`text-[9.5px] ${st.cls}`}>{st.text}</span>
                  <span className="text-[9px] text-nv-faint">
                    · {g.expires_at ? `expires ${new Date(g.expires_at).toLocaleDateString()}` : 'no expiry'}
                  </span>
                </div>
                {g.note && <p className="text-[10px] text-nv-muted leading-snug mt-0.5">{g.note}</p>}
              </div>
              {!g.revoked_at && (
                <button
                  onClick={() => void revoke(g.id)}
                  className="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-bad hover:border-nv-bad/40 transition-fast"
                >Revoke</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
