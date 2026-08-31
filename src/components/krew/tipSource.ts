// ─── Where a tip comes from ──────────────────────────────────────────────────
//
// Shared by the line above the composer and by the big one in the middle of an empty chat, so the
// two cannot drift apart or — worse — show the same tip at the same moment.

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickTip, type Tip, type TipContext } from '../../lib/krewTips';

const SEEN_KEY = 'nv-tips-seen';

/** Ids shown already. Session-scoped on purpose: tips are worth meeting again in a week, just not
 *  twice in one sitting. */
export function loadSeen(): string[] {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]') as string[]; } catch { return []; }
}
export function remember(id: string) {
  try {
    const seen = loadSeen();
    if (!seen.includes(id)) sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
  } catch { /* private mode — the worst case is a repeat */ }
}

/**
 * What the user already has, asked for rather than passed in.
 *
 * The caller knows about connected apps and nothing else, and a tip that guesses at the rest would
 * advertise a local model to somebody who has three. `getAiAvailability` is the one thing that
 * actually knows, so this asks it — the alternative was four more props threaded through a
 * 15,000-line component, each able to drift.
 */
export function useTipContext(appsConnected: number): TipContext | null {
  const [ctx, setCtx] = useState<TipContext | null>(null);
  useEffect(() => {
    let dead = false;
    import('../../lib/aiSource')
      .then(({ getAiAvailability }) => getAiAvailability())
      .then((a) => {
        if (dead) return;
        setCtx({
          appsConnected,
          hasModelKey: a.byokProviders.length > 0,
          hasCli: a.clis.length > 0,
          hasLocalModel: a.localModels.length > 0,
        });
      })
      // Availability needs Tauri. Without it, show the tips that apply to everybody rather than
      // showing nothing — a blank space teaches less than a general tip.
      .catch(() => { if (!dead) setCtx({ appsConnected, hasModelKey: false, hasCli: false, hasLocalModel: false }); });
    return () => { dead = true; };
  }, [appsConnected]);
  return ctx;
}

/**
 * A tip, optionally changing on its own.
 *
 * `everyMs = 0` means "one per mount", which is right for the thin line above the composer: text
 * that changes while you are reading it is worse than text that does not change.
 *
 * ── WHY IT PAUSES ───────────────────────────────────────────────────────────
 *
 * The owner asked the big centre tip to rotate every three seconds. Three seconds is about right
 * for glancing and too short for reading a full sentence, so the one thing it must not do is
 * vanish mid-sentence while somebody is actually reading it. It stops while the pointer is over it
 * or it has keyboard focus, and resumes when they leave. That is also what makes auto-updating text
 * accessible rather than merely animated.
 */
export function useRotatingTip(ctx: TipContext | null, everyMs: number) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const next = useCallback(() => {
    if (!ctx) return;
    const t = pickTip(ctx, loadSeen());
    if (t) remember(t.id);
    setTip(t);
  }, [ctx]);

  useEffect(() => { next(); }, [next]);

  useEffect(() => {
    if (!everyMs || !ctx) return;
    const id = setInterval(() => { if (!pausedRef.current) next(); }, everyMs);
    return () => clearInterval(id);
  }, [everyMs, ctx, next]);

  return { tip, next, paused, setPaused };
}
