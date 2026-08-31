// ─── Fast or Advanced, in the composer, in the app's own menu language ───────
//
// WHAT THIS REPLACES. A two-button segmented toggle sitting in its own bordered box ABOVE the
// composer, with a line of explanatory text beside it that changed as you switched. Three problems:
// it was a fourth bordered rectangle in a corner already carrying several; the explanation was
// permanently on screen for a setting most people change once a month; and it looked nothing like
// the source menu in the title bar, which is the same KIND of decision — "how should this run".
//
// So it is the same control, in the same clothes: a pill that states the current choice, opening a
// sheet that explains the options where the explanation belongs — next to the thing being chosen,
// at the moment of choosing, and nowhere else.
//
// WHY IT OPENS UPWARD. It lives at the bottom of the window. The title-bar menu drops down because
// there is room below it; this one has none, so it rises. Same sheet, mirrored.

import { useEffect, useRef, useState } from 'react';

export type SearchMode = 'fast' | 'advanced';

interface Choice {
  id: SearchMode;
  label: string;
  blurb: string;
  /** What it costs the user, in their terms — the same column the source menu carries. */
  cost: string;
  icon: React.ReactNode;
}

const BOLT = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="currentColor" aria-hidden="true">
    <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
  </svg>
);
const GLASS = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor"
       strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
  </svg>
);

const CHOICES: Choice[] = [
  {
    id: 'fast',
    label: 'Fast',
    blurb: 'Searches quietly in the background. Best for everyday questions and quick lists.',
    cost: 'cheap',
    icon: BOLT,
  },
  {
    id: 'advanced',
    label: 'Advanced',
    blurb: 'Opens the real browser you can watch, checks every result, and drops anything it cannot confirm.',
    cost: 'slower · more tokens',
    icon: GLASS,
  },
];

export default function SearchModeMenu({ mode, onChange, busy }: {
  mode: SearchMode;
  onChange: (m: SearchMode) => void;
  /** A run in flight owns the mode it started with — switching underneath it would change the
   *  rules mid-task, so the control says why rather than silently doing nothing. */
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const current = CHOICES.find((c) => c.id === mode) ?? CHOICES[0];
  const advanced = mode === 'advanced';

  return (
    <div ref={box} className="relative shrink-0 mb-0.5">
      <button
        type="button"
        onClick={() => { if (!busy) setOpen((v) => !v); }}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={busy
          ? "This can't change while a task is running — stop it first."
          : `Search: ${current.label} — ${current.blurb}`}
        className={`flex items-center gap-1.5 h-[26px] pl-2 pr-1.5 rounded-full border text-[10px] font-medium
                    transition-colors duration-fast ease-nv ${busy ? 'opacity-50 cursor-not-allowed' : ''} ${advanced
          ? 'bg-accent/15 border-accent/45 text-accent'
          : 'bg-nv-surface2/60 border-nv-border text-nv-muted hover:text-nv-text hover:border-accent/35'}`}
      >
        {current.icon}
        <span>{current.label}</span>
        <svg viewBox="0 0 24 24"
             className={`w-3 h-3 shrink-0 transition-transform duration-fast ease-nv ${open ? 'rotate-180' : ''}`}
             fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {/* Points UP by default, because this sheet rises. A caret that says "down" above a menu
              that opens upward is a small lie the eye notices before the brain does. */}
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>

      {open && (
        <div role="menu"
             className="absolute left-0 bottom-[30px] w-[286px] nv-sheet p-1.5 z-50 nv-rise">
          <p className="px-2.5 pt-1 pb-2 text-[9.5px] uppercase tracking-[0.12em] text-nv-faint">
            How it searches
          </p>
          {CHOICES.map((c) => {
            const active = c.id === mode;
            return (
              <button
                key={c.id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { onChange(c.id); setOpen(false); }}
                className={`w-full text-left px-2.5 py-2 rounded-nv transition-colors duration-fast ease-nv
                            ${active ? 'bg-accent/[0.13] ring-1 ring-inset ring-accent/25' : 'hover:bg-nv-surface2/70'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={active ? 'text-accent' : 'text-nv-muted'}>{c.icon}</span>
                  <span className={`text-[12px] font-semibold flex-1 truncate ${active ? 'text-accent' : 'text-nv-text'}`}>
                    {c.label}
                  </span>
                  <span className="text-[9px] text-nv-faint shrink-0">{c.cost}</span>
                </span>
                <span className="block pl-[22px] text-[10.5px] text-nv-muted leading-snug mt-0.5">{c.blurb}</span>
              </button>
            );
          })}
          <p className="px-2.5 pt-2 pb-1 text-[9.5px] text-nv-faint leading-snug">
            Advanced is worth it when the answer has to be right — real contacts, real links.
          </p>
        </div>
      )}
    </div>
  );
}
