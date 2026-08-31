// ─── The line above the chat, doing something useful ─────────────────────────
//
// WHAT THIS REPLACES. "No apps connected. Link Gmail, GitHub, Notion & more for real actions." One
// sentence, identical on the hundredth launch as on the first, telling the user off for not having
// set something up rather than showing them what the product can do.
//
// It now rotates through 152 specific, true things (see lib/krewTips.ts), skipping anything the
// user has already got — so someone with nine apps connected is never told to connect apps, which
// was the whole problem with the line it replaces.

import { useTipContext, useRotatingTip } from './tipSource';

export default function TipBar({ appsConnected, onRunCommand, onOpenModule }: {
  /** How many real integrations are connected — model keys do not count as "apps". */
  appsConnected: number;
  /** Run a slash command, e.g. 'scan'. */
  onRunCommand: (cmd: string) => void;
  onOpenModule: (module: string) => void;
}) {
  const ctx = useTipContext(appsConnected);
  // A new tip per mount, and NOT on a timer. This one sits beside the composer while the user is
  // typing, where text that changes under the eye is a distraction rather than a lesson. The big
  // centre tip rotates instead, because there the user has nothing else to look at.
  const { tip, next } = useRotatingTip(ctx, 0);

  if (!tip) return null;
  const action = tip.cmd ? () => onRunCommand(tip.cmd!) : tip.nav ? () => onOpenModule(tip.nav!) : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nv-border bg-nv-surface shrink-0">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
           strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0" aria-hidden="true">
        <path d="M9 18h6M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
      </svg>
      {/* Same label as the big one in the middle of an empty chat, so a tip is recognisable as a
          tip wherever it appears. */}
      <span className="text-[9px] font-semibold tracking-[0.14em] text-accent shrink-0">TIP</span>
      <p className="text-[10px] text-nv-muted flex-1 leading-snug">{tip.text}</p>
      {action && (
        <button
          onClick={action}
          className="text-[10px] text-accent hover:underline shrink-0 font-mono"
        >{tip.cmd ? `/${tip.cmd}` : 'Open'} →</button>
      )}
      {/* Somewhere to go when this one is not interesting. Without it the only way past a tip you
          do not care about is to ignore it, which is how people stop reading them at all. */}
      <button
        onClick={next}
        title="Another tip"
        className="text-nv-faint hover:text-nv-text transition-fast shrink-0 -mr-0.5 p-0.5"
        aria-label="Show another tip"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
