// ─── What you have used, and what it costs ───────────────────────────────────
//
// Under pay-per-use this stops being a quota bar and becomes the screen a customer checks before
// a bill arrives. Two things follow from that, and they drive every decision below:
//
//   1. **It must never state a figure it cannot stand behind.** No "₹0.00" because the rate card is
//      empty; no total that quietly leaves out rows it could not price. Where something is an
//      estimate it says so, in the place the number is, not in a footnote.
//   2. **It must show what the user's own key SAVED them.** That is the whole promise of the
//      bridge, and it is invisible unless this screen makes it visible: tokens that ran on their
//      own Claude subscription, their own API key or their own machine cost them nothing here.
//
// The arithmetic lives in lib/usageMeter.ts, where it is asserted 42 ways without a database.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  summarise, pricingReady, rupees, formatTokens, RATE_CARD,
  type UsageRow, type UsageSummary, type BillingSource,
} from '../lib/usageMeter';

const SOURCE_LABEL: Record<BillingSource, string> = {
  adris:   'adris.tech AI',
  own_key: 'Your own API key',
  local:   'A local model',
  bridge:  'Your Claude / Codex subscription',
  unknown: 'Before we recorded this',
};

/** Only the first is billable; the rest are the user's own capacity. */
const SOURCE_NOTE: Record<BillingSource, string> = {
  adris:   'billed to you',
  own_key: 'billed by your provider, not by us',
  local:   'free — it ran on this computer',
  bridge:  'already covered by your subscription',
  unknown: 'not billed',
};

export default function UsagePanel({ periodStart }: { periodStart?: string | null }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) { if (!dead) setState('error'); return; }

        // The billing period, not the calendar month — a subscription that renews on the 22nd would
        // otherwise show a partial first month and reset mid-cycle.
        const from = periodStart ?? (() => {
          const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
        })();

        const { data, error } = await supabase
          .from('token_usage')
          .select('created_at, task_type, tokens_consumed, input_tokens, output_tokens, model_used, source')
          .eq('user_id', session.user.id)
          .gte('created_at', from)
          .order('created_at', { ascending: true });
        if (error) throw error;
        if (!dead) { setSummary(summarise((data ?? []) as UsageRow[], RATE_CARD)); setState('ready'); }
      } catch {
        if (!dead) setState('error');
      }
    })();
    return () => { dead = true; };
  }, [periodStart]);

  if (state === 'loading') {
    return <div className="border border-nv-border rounded-xl px-5 py-4">
      <p className="text-[11px] text-nv-faint">Reading your usage…</p>
    </div>;
  }
  if (state === 'error' || !summary) {
    return <div className="border border-nv-border rounded-xl px-5 py-4">
      <p className="text-[11px] text-nv-muted">Could not read your usage just now.</p>
      <p className="text-[10px] text-nv-faint mt-1">
        Nothing is lost — it is recorded on the server, not here.
      </p>
    </div>;
  }

  const s = summary;
  const peak = Math.max(1, ...s.byDay.map((d) => d.tokens));
  const priced = pricingReady();

  return (
    <div className="border border-nv-border rounded-xl overflow-hidden">
      {/* ── What it costs ────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-nv-border">
        <p className="text-[10px] uppercase tracking-[0.08em] text-nv-faint">This period</p>

        {!priced ? (
          // Pricing is not set. Showing "₹0.00" here would be a confidently wrong number, and the
          // user would believe it.
          <>
            <p className="text-[22px] font-semibold text-nv-text leading-tight mt-1">
              {formatTokens(s.billableTokens)} <span className="text-[13px] font-normal text-nv-muted">tokens billable</span>
            </p>
            <p className="text-[11px] text-nv-muted leading-relaxed mt-1.5">
              Per-token pricing is not switched on yet, so there is nothing to pay. When it is, this
              is the number it will be based on.
            </p>
          </>
        ) : s.costPaise === null ? (
          <>
            <p className="text-[22px] font-semibold text-nv-text leading-tight mt-1">—</p>
            <p className="text-[11px] text-nv-muted leading-relaxed mt-1.5">
              {s.unpricedRows} {s.unpricedRows === 1 ? 'entry' : 'entries'} could not be priced, so this
              total would be incomplete. We would rather show nothing than a figure that is short.
            </p>
          </>
        ) : (
          <>
            <p className="text-[26px] font-semibold text-nv-text leading-tight mt-1">{rupees(s.costPaise)}</p>
            <p className="text-[11px] text-nv-muted mt-1">
              {formatTokens(s.billableTokens)} billable tokens across {s.rows} {s.rows === 1 ? 'task' : 'tasks'}
            </p>
          </>
        )}
      </div>

      {/* ── What your own key saved you ──────────────────────────────────── */}
      {s.ownTokens > 0 && (
        <div className="px-5 py-3.5 border-b border-nv-border bg-accent/[0.05]">
          <p className="text-[12px] text-nv-text">
            <span className="font-semibold">{formatTokens(s.ownTokens)} tokens</span> ran on your own
            subscription, key or machine.
          </p>
          <p className="text-[10.5px] text-nv-muted mt-0.5">
            adris did not charge for any of it, and never will — that is what the bridge is for.
          </p>
        </div>
      )}

      {/* ── Day by day ───────────────────────────────────────────────────── */}
      {s.byDay.length > 0 && (
        <div className="px-5 py-4 border-b border-nv-border">
          <p className="text-[10px] uppercase tracking-[0.08em] text-nv-faint mb-2.5">By day</p>
          <div className="flex items-end gap-[3px] h-16">
            {s.byDay.map((d) => (
              <div
                key={d.day}
                title={`${d.day} · ${d.tokens.toLocaleString()} tokens`}
                className="flex-1 min-w-[3px] rounded-t-sm bg-accent/60 hover:bg-accent transition-fast"
                // A floor of 2px so a quiet day is visibly a quiet day rather than a missing one.
                style={{ height: `${Math.max(2, (d.tokens / peak) * 100)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9.5px] text-nv-faint">{s.byDay[0].day.slice(5)}</span>
            <span className="text-[9.5px] text-nv-faint">{s.byDay[s.byDay.length - 1].day.slice(5)}</span>
          </div>
        </div>
      )}

      {/* ── Where it went ────────────────────────────────────────────────── */}
      {s.byModule.length > 0 && (
        <div className="px-5 py-4 border-b border-nv-border">
          <p className="text-[10px] uppercase tracking-[0.08em] text-nv-faint mb-2">What used it</p>
          {s.byModule.slice(0, 6).map((m) => (
            <div key={m.module} className="flex items-baseline gap-2 py-[3px]">
              <span className="text-[11.5px] text-nv-text flex-1 truncate">{m.module}</span>
              <span className="text-[11px] text-nv-muted tabular-nums">{formatTokens(m.tokens)}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Who paid ─────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-nv-border">
        <p className="text-[10px] uppercase tracking-[0.08em] text-nv-faint mb-2">Who paid for it</p>
        {s.bySource.map((b) => (
          <div key={b.source} className="flex items-baseline gap-2 py-[3px]">
            <span className="text-[11.5px] text-nv-text truncate">{SOURCE_LABEL[b.source]}</span>
            <span className="text-[10px] text-nv-faint flex-1 truncate">{SOURCE_NOTE[b.source]}</span>
            <span className="text-[11px] text-nv-muted tabular-nums shrink-0">{formatTokens(b.tokens)}</span>
          </div>
        ))}
      </div>

      {/* ── The honest small print, where the numbers are ────────────────── */}
      {(s.estimatedRows > 0 || s.unknownRows > 0) && (
        <div className="px-5 py-3">
          {s.estimatedRows > 0 && (
            <p className="text-[10px] text-nv-faint leading-relaxed">
              {s.estimatedRows} of {s.rows} entries were counted before we recorded reading and
              writing separately, so their share is an estimate rather than a measurement.
            </p>
          )}
          {s.unknownRows > 0 && (
            <p className="text-[10px] text-nv-faint leading-relaxed mt-1">
              {s.unknownRows} {s.unknownRows === 1 ? 'entry predates' : 'entries predate'} us recording
              which AI ran them. They are never billed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
