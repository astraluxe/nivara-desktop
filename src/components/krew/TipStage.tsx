// ─── The middle of an empty chat ─────────────────────────────────────────────
//
// WHAT THIS REPLACES, and why none of it was earning its place:
//
//   - A big circular avatar with the agent's initials.
//   - "Arjun.Boss" and "Chief of staff — strategy, routing, catch-all".
//   - "26 apps connected".
//   - Three starter prompts to click.
//
// The owner's verdict was "there is no use of all this", and it is right. The agent's name and role
// are already in the header two inches above. The apps count is a number with nothing to do. And the
// three starter prompts were the same three every time — after the first day they are furniture.
//
// The blank chat is the best teaching surface in the product: the user is looking directly at the
// middle of the screen with nothing else to read. So it now shows one of 152 specific, true things
// the product can do, changing every three seconds.

import { useMemo } from 'react';
import { useTipContext, useRotatingTip } from './tipSource';

/** The owner asked for three seconds. */
const ROTATE_MS = 3000;

const reduceMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function TipStage({ appsConnected, onRunCommand, onOpenModule }: {
  appsConnected: number;
  onRunCommand: (cmd: string) => void;
  onOpenModule: (module: string) => void;
}) {
  const ctx = useTipContext(appsConnected);
  const { tip, next, setPaused } = useRotatingTip(ctx, ROTATE_MS);
  const still = useMemo(reduceMotion, []);

  if (!tip) return null;
  const action = tip.cmd ? () => onRunCommand(tip.cmd!) : tip.nav ? () => onOpenModule(tip.nav!) : null;

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-8 select-none"
      // Stops while it is being read or reached for, and starts again on the way out. Without this,
      // a three-second rotation takes the sentence away halfway through it.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* The word, not just the icon. A lightbulb on its own is a shape people have to interpret;
          "TIP" says what the sentence below it is, and the accent colour ties it to everything else
          in the app that is the product speaking rather than an agent. */}
      <div className="flex items-center gap-1.5 mb-3.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
             strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
          <path d="M9 18h6M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
        </svg>
        <span className="text-[10px] font-semibold tracking-[0.14em] text-accent">TIP</span>
      </div>

      {/*
        `key` is the tip id, so React replaces the node rather than mutating it and the fade actually
        plays on every change. Without it the text swaps in place with no transition at all.

        aria-live polite, because this is text that changes on its own: a screen reader user needs to
        be told rather than left on a stale sentence.
      */}
      <p
        key={tip.id}
        aria-live="polite"
        className={`text-[13.5px] leading-relaxed text-nv-muted text-center max-w-[400px] ${still ? '' : 'nv-fade'}`}
      >
        {tip.text}
      </p>

      {action && (
        <button
          onClick={action}
          className="mt-4 px-3 py-1.5 rounded-lg border border-nv-border text-[11.5px] font-mono
            text-accent hover:border-accent hover:bg-accent/[0.06] transition-fast"
        >
          {tip.cmd ? `/${tip.cmd}` : 'Open'} →
        </button>
      )}

      {/* Somewhere to go when this one is not interesting. Without it the only way past a tip you do
          not care about is to wait, which is how people stop reading them at all. */}
      <button
        onClick={next}
        className="mt-5 text-[10px] text-nv-faint hover:text-nv-muted transition-fast"
      >
        Another tip
      </button>
    </div>
  );
}
