// ─── The right rail ──────────────────────────────────────────────────────────
//
// A narrow strip on the right edge holding everything that is not a core module: the business tools
// from the Shelf, and whatever gets added beside them later.
//
// IT NEVER EXPANDS, and that is the whole design. A rail that widens when the mouse crosses it
// pushes the work sideways every time you reach past it, and people learn to avoid the edge of the
// screen entirely. The name arrives as a tooltip instead — the layout does not move, ever.

import { useEffect, useRef, useState } from 'react';
import { loadCachedScan, type AppScan, officeApps, type OfficeApp } from '../lib/installedApps';
import { TOOLS, toolById, type ToolState } from '../lib/toolShelf';
import ToolMarkIcon from './ToolMarkIcon';

/** First letters, for a tool with no mark of its own. Two at most: three is a word, not a glyph. */
function initials(name: string): string {
  const parts = name.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The applications already on this computer.
 *
 * ── WHY THESE COME FIRST, AND WHY THEY NEED NO DOCKER ───────────────────────
 *
 * Everything else on the rail runs in a container, and Docker is a real wall for the person this
 * product is for: a 600 MB download, WSL2, a restart, admin rights. The owner's point was blunt and
 * correct — *"a non tech person doesnt know to install docker or use docker"*.
 *
 * Word, Excel and PowerPoint are already installed, need nothing, and are what a small business
 * actually works in. Putting them on the rail means the agents' `create_office_document` tool has a
 * visible home, and the user can open the real application in one click.
 *
 * MICROSOFT'S OWN ICONS ARE NOT USED — see the note in scripts/build-tool-logos.mjs. These are
 * neutral glyphs of our own with the real product name in the tooltip.
 */
// NAMES ONLY. This used to carry an `exe` — 'winword', 'excel', 'powerpnt' — which was a guess at
// a command name, and launch_application requires a real file on disk. So every click was rejected
// and the rejection was swallowed: "i clicked on word and nth happened". The path now comes from
// the machine scan (officeApps), which is the only thing that knows where Office actually is.
const OFFICE_NAME: Record<OfficeApp, string> = {
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
};

/** Each Office app's own colour, so the three are told apart at a glance the way the rest of the
 *  rail is — without using Microsoft's marks. */
const OFFICE_INK: Record<string, string> = { word: '#2b579a', excel: '#217346', powerpoint: '#c43e1c' };

function OfficeGlyph({ kind }: { kind: 'word' | 'excel' | 'powerpoint' }) {
  const stroke = { fill: 'none', stroke: OFFICE_INK[kind], strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    // The SAME white tile the Shelf marks sit on, or the rail reads as two unrelated sets of things
    // stacked on top of each other.
    <span className="shrink-0 flex items-center justify-center rounded-[5px] bg-white ring-1 ring-black/10"
          style={{ width: 22, height: 22 }}>
    <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" {...stroke} />
      <path d="M14 3v4h4" {...stroke} />
      {kind === 'word' && <><path d="M9 12h6M9 15h6M9 18h3" {...stroke} /></>}
      {kind === 'excel' && <><path d="M9 11h6M9 14h6M9 17h6M12 11v6" {...stroke} /></>}
      {kind === 'powerpoint' && <rect x="9" y="12" width="6" height="5" rx="1" {...stroke} />}
    </svg>
    </span>
  );
}

export default function ToolRail({ states, activeId, onOpen, onBrowse }: {
  /** What each installed tool is doing. Absent means not installed. */
  states: Record<string, ToolState>;
  activeId: string | null;
  onOpen: (id: string) => void;
  onBrowse: () => void;
}) {
  // Only what is actually on the machine. A rail listing eight things the user has never installed
  // is a menu, not a shelf — the catalogue is behind the + and that is where browsing belongs.
  const installed = TOOLS.filter((t) => states[t.id] && states[t.id].phase !== 'absent');

  // What Office this machine actually has. Read from the cached scan, so the rail costs nothing on
  // every render; an empty scan simply shows no Office section rather than three dead buttons.
  const [scan, setScan] = useState<AppScan | null>(loadCachedScan);
  useEffect(() => {
    if (scan) return;
    let dead = false;
    import('../lib/installedApps')
      .then((m) => m.getInstalledApps())
      .then((s) => { if (!dead && s) setScan(s); })
      .catch(() => { /* no scan yet — the section stays hidden rather than guessing */ });
    return () => { dead = true; };
  }, [scan]);

  // Each entry carries the executable's real path, so the button can actually start it.
  const office = officeApps(scan);

  // A click that fails has to SAY so. The old `catch {}` is why a broken launch was
  // indistinguishable from a decorative icon.
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!err) return;
    const t = setTimeout(() => setErr(''), 6000);
    return () => clearTimeout(t);
  }, [err]);

  async function openApp(which: OfficeApp, path: string) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('launch_application', { exe: path, file: null });
    } catch (e) {
      setErr(`Couldn't open ${OFFICE_NAME[which]} — ${String(e).replace(/^Error:\s*/, '')}`);
    }
  }

  return (
    <div className="relative w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-l border-nv-border bg-nv-surface/60">
      {/* The user's own applications, first. No Docker, nothing to install. */}
      {office.map(({ which, app }) => (
        <RailButton key={which} label={`Open ${OFFICE_NAME[which]}`} onClick={() => void openApp(which, app.path)}>
          <OfficeGlyph kind={which} />
        </RailButton>
      ))}
      {err && (
        <div className="absolute right-12 top-2 z-30 max-w-[240px] rounded-lg border border-nv-border bg-nv-sheet px-2.5 py-1.5 shadow-lg">
          <p className="text-[10px] leading-snug text-nv-text">{err}</p>
        </div>
      )}
      {office.length > 0 && <div className="w-5 h-px bg-nv-border my-1" />}
      {installed.map((t) => (
        <RailButton
          key={t.id}
          label={t.name}
          sub={states[t.id]?.phase === 'ready' ? 'running' : undefined}
          active={activeId === t.id}
          busy={states[t.id]?.phase === 'pulling' || states[t.id]?.phase === 'starting'}
          onClick={() => onOpen(t.id)}
        >
          <ToolMarkIcon id={t.id} name={t.name} />
        </RailButton>
      ))}

      {installed.length > 0 && <div className="w-5 h-px bg-nv-border my-1" />}

      <RailButton label="Add a tool" onClick={onBrowse}>
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </RailButton>
    </div>
  );
}

/**
 * One icon, with a tooltip that appears beside the rail rather than widening it.
 *
 * Positioned with `right-full` so it grows LEFTWARDS into the page. A tooltip that grows rightwards
 * from a rail on the right edge is a tooltip half of which is off screen — which is how a hover
 * label ends up unreadable exactly for the longest names that needed it most.
 */
function RailButton({ children, label, sub, active, busy, onClick }: {
  children: React.ReactNode; label: string; sub?: string;
  active?: boolean; busy?: boolean; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A short delay, so sweeping the mouse across the rail on the way somewhere else does not fire
  // four tooltips in a row.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const enter = () => { timer.current = setTimeout(() => setHover(true), 280); };
  const leave = () => { if (timer.current) clearTimeout(timer.current); setHover(false); };

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        aria-label={label}
        className={`w-8 h-8 rounded-nv flex items-center justify-center transition-colors duration-fast ease-nv
                    ${active
                      ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30'
                      : 'text-nv-faint hover:text-nv-text hover:bg-nv-surface2'}`}
      >
        {children}
      </button>

      {/* Running, at a glance, without opening anything. A dot rather than a word: the rail is
          40px wide and the state is a yes/no. */}
      {sub === 'running' && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 pointer-events-none" />
      )}
      {busy && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse pointer-events-none" />
      )}

      {hover && (
        <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 z-50 pointer-events-none
                        nv-sheet px-2 py-1 whitespace-nowrap">
          <span className="text-[11px] text-nv-text">{label}</span>
          {sub && <span className="text-[10px] text-nv-faint ml-1.5">{sub}</span>}
        </div>
      )}
    </div>
  );
}

/** Used by the panel too, so the rail and the catalogue always spell a tool the same way. */
export { initials as toolInitials };
export { toolById };
