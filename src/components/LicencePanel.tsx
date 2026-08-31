// ─── What you have, what it covers, and where it is bound (L2) ───────────────
//
// There was nowhere in the app that answered "what am I actually paying for, and how much of it is
// left". The plan was a word in the title bar; the usage was a token count on another screen; and
// nothing said which machine an entitlement belonged to or what happened when the connection
// dropped.
//
// One screen, four questions:
//   · what you are on, and what that covers
//   · how much is left, in tasks, and when it resets
//   · which machine this is tied to
//   · whether we have been able to confirm any of it lately

import { useState } from 'react';
import { useEntitlement, machineId } from '../lib/useEntitlement';
import { TIER_LABEL, covers, stateLabel, ALLOWANCE } from '../lib/entitlement';

/** A bar with a number under it. The bar is the glance; the number is the check. */
function Meter({ label, left, cap, unit }: { label: string; left: number; cap: number; unit: string }) {
  const unlimited = cap === Number.POSITIVE_INFINITY;
  const pct = unlimited ? 0 : Math.max(0, Math.min(100, (left / cap) * 100));
  const tone = unlimited ? 'bg-accent' : pct <= 0 ? 'bg-nv-red' : pct <= 20 ? 'bg-amber-500' : 'bg-accent';
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] text-nv-muted">{label}</span>
        <span className="text-[11px] font-mono text-nv-text">
          {unlimited ? 'Unlimited' : `${left.toLocaleString('en-IN')} ${unit} left`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-nv-surface2 overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${unlimited ? 100 : pct}%` }} />
      </div>
    </div>
  );
}

export default function LicencePanel() {
  const ent = useEntitlement();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const a = ALLOWANCE[ent.tier];

  return (
    <div className="space-y-5">
      {/* ── what you are on ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-nv-border bg-nv-surface p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-nv-faint">Your plan</p>
            <p className="text-[22px] font-semibold text-nv-text mt-1">{TIER_LABEL[ent.tier]}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-nv-faint">Status</p>
            <p className={`text-[12px] font-medium mt-1 ${ent.state === 'stale' ? 'text-amber-600' : 'text-nv-green'}`}>
              {stateLabel(ent.state)}
            </p>
          </div>
        </div>

        {/* WHEN WE CANNOT REACH THE SERVER, SAY SO PLAINLY AND CARRY ON.
            A customer on a bad connection is not doing anything wrong, and the app has no business
            implying they are. Nothing here stops working. */}
        {ent.state === 'grace' && (
          <p className="mt-3 text-[11px] text-nv-muted leading-relaxed">
            We haven't been able to check in for a little while — you're offline, or we are.
            Everything keeps working; the figures below are the last ones we confirmed.
          </p>
        )}
        {ent.state === 'stale' && (
          <p className="mt-3 text-[11px] text-nv-muted leading-relaxed">
            It's been a while since we could confirm your plan. Nothing has been switched off, and
            <b className="text-nv-text"> your own API key and local models are unaffected</b> — they never
            needed us. Reconnect when you can and this sorts itself out.
          </p>
        )}
        {ent.wrongMachine && (
          <p className="mt-3 text-[11px] text-amber-600 leading-relaxed">
            This plan is tied to a different computer. It still works here, but if that's a surprise,
            it's worth checking who else is signed in.
          </p>
        )}
      </div>

      {/* ── how much is left ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-nv-border bg-nv-surface p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[12px] font-semibold text-nv-text">This month</p>
          <p className="text-[10.5px] text-nv-faint font-mono">
            resets in {ent.resetsInDays} day{ent.resetsInDays === 1 ? '' : 's'}
          </p>
        </div>

        {/* TASKS FIRST, TOKENS UNDERNEATH. Nobody outside this industry can check a bill written in
            tokens, and a number the payer cannot check is a number they have to take on trust. */}
        <Meter label="AI tasks" left={ent.left.tasksLeft} cap={a.tokens / 1000} unit="tasks" />
        <Meter label="AI images" left={ent.left.images} cap={a.images} unit="images" />
        <Meter label="Cloud automation runs" left={ent.left.runs} cap={a.runs} unit="runs" />

        <p className="text-[10.5px] text-nv-faint leading-relaxed pt-1 border-t border-nv-border/60">
          {ent.left.unlimited
            ? 'Fair use — we will talk to you long before we ever talk about a limit.'
            : <>Used {ent.used.tokens.toLocaleString('en-IN')} tokens so far.{' '}
               <b className="text-nv-muted">Work you run on your own API key, your Claude or Codex
               subscription, or a local model is not counted here</b> — it costs us nothing, so it
               costs you nothing.</>}
        </p>
      </div>

      {/* ── what it covers ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-nv-border bg-nv-surface p-4">
        <p className="text-[12px] font-semibold text-nv-text mb-3">What {TIER_LABEL[ent.tier]} covers</p>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {covers(ent.tier).map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-[11.5px] text-nv-muted">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" fill="none"
                   stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── this machine ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-nv-border bg-nv-surface p-4">
        <p className="text-[12px] font-semibold text-nv-text mb-2">This computer</p>
        <p className="text-[10.5px] font-mono text-nv-faint break-all">{machineId() || 'not identified'}</p>
        <p className="text-[10.5px] text-nv-faint mt-2 leading-relaxed">
          Used only to tell one computer from another, so a plan bought for one team is not shared
          across several. It is a random id — not your hardware, not anything about you.
        </p>
      </div>

      {/* ── a key, for anyone issued one ────────────────────────────────── */}
      <div className="rounded-xl border border-nv-border bg-nv-surface p-4">
        <p className="text-[12px] font-semibold text-nv-text mb-1">Have a key?</p>
        <p className="text-[10.5px] text-nv-faint mb-3">
          Enterprise and pilot customers are issued one. Everyone else is set up by signing in — there
          is nothing to enter.
        </p>
        <div className="flex gap-2">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ADRIS-XXXX-XXXX-XXXX"
            className="flex-1 nv-field bg-nv-bg border border-nv-border rounded-nv px-3 py-2
                       text-[12px] font-mono placeholder:text-nv-faint"
          />
          <button
            onClick={() => {
              // HONEST UNTIL IT IS REAL. Minting and verifying keys is server work that does not
              // exist yet (L7), and a box that pretends to accept one would be worse than no box:
              // the customer would believe they were set up.
              setMsg(key.trim()
                ? "Key redemption isn't switched on yet — your plan is set from your account for now. Nothing needs entering."
                : 'Enter the key you were sent.');
            }}
            className="text-[11.5px] px-3.5 py-2 rounded-nv border border-accent/50 text-accent
                       hover:bg-accent/10 transition-fast shrink-0"
          >Apply</button>
        </div>
        {msg && <p className="text-[10.5px] text-nv-muted mt-2 leading-relaxed">{msg}</p>}
      </div>

      <button
        onClick={ent.refresh}
        className="text-[11px] px-3 py-1.5 rounded-nv border border-nv-border text-nv-muted
                   hover:border-accent hover:text-accent transition-fast"
      >Check again</button>
    </div>
  );
}
