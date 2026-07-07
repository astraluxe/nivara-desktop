import { useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskPhase {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface TaskProgressProps {
  phases: TaskPhase[];
  onDismiss: () => void;
  recommendConnect?: string[];
  onConnectApp?: (app: string) => void;
}

// ─── Spinner SVG ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className="animate-spin text-accent shrink-0"
    >
      <circle cx="12" cy="12" r="10" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

// ─── Phase icon ───────────────────────────────────────────────────────────────

function PhaseIcon({ status }: { status: TaskPhase['status'] }) {
  if (status === 'done')
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-accent shrink-0">
        <path d="M2.5 8l3.5 3.5 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === 'running') return <Spinner />;
  if (status === 'error')
    return (
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-red-400 shrink-0">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.7" fill="currentColor" />
      </svg>
    );
  // pending
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-nv-faint shrink-0">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TaskProgress({ phases, onDismiss, recommendConnect, onConnectApp }: TaskProgressProps) {
  const doneCount    = phases.filter((p) => p.status === 'done' || p.status === 'error').length;
  const totalCount   = phases.length;
  const progressPct  = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const allDone      = totalCount > 0 && doneCount === totalCount;

  // Expand to see the full workflow top-to-bottom (step 1 → last). Collapsed by default.
  const [expanded, setExpanded] = useState(false);

  // Slide-in animation on mount
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = 'translateY(8px)';
    el.style.opacity   = '0';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
      el.style.transform  = 'translateY(0)';
      el.style.opacity    = '1';
    });
  }, []);

  const hasRecommendations = recommendConnect && recommendConnect.length > 0;

  return (
    <div
      ref={ref}
      className="mx-3 mb-2 rounded-xl border border-nv-border bg-nv-surface overflow-hidden"
    >
      {/* Top row — expand toggle + progress bar + dismiss */}
      <div className="flex items-center gap-2.5 px-3 py-2 border-b border-nv-border/60">
        {/* Expand / collapse chevron — reveals the step-by-step workflow */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-nv-faint hover:text-nv-text transition-fast shrink-0"
          title={expanded ? 'Collapse workflow' : 'Expand to see each step'}
          aria-expanded={expanded}
        >
          <svg
            width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        <span className="text-[10px] font-mono text-nv-muted shrink-0">{allDone ? 'Done' : 'Working…'}</span>
        <span className={`text-[10px] font-mono shrink-0 ${allDone ? 'text-green-400' : 'text-accent'}`}>
          {progressPct}%
        </span>
        {/* Progress bar */}
        <div className="flex-1 h-1.5 rounded-full bg-nv-bg overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-green-400' : 'bg-accent'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-nv-faint shrink-0 tabular-nums">{doneCount}/{totalCount}</span>
        <button
          onClick={onDismiss}
          className="text-nv-faint hover:text-nv-text transition-fast shrink-0 ml-1"
          title="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {expanded ? (
        /* Expanded — full workflow, step 1 → last, top-to-bottom */
        <div className="flex flex-col px-3 py-2 gap-0.5">
          {phases.map((phase, i) => (
            <div key={phase.id} className="flex items-start gap-2 py-1">
              {/* Step number + connector */}
              <div className="flex flex-col items-center shrink-0" style={{ width: 16 }}>
                <span className="text-[9px] font-mono text-nv-faint leading-none mt-0.5">{i + 1}</span>
                {i < phases.length - 1 && <span className="w-px flex-1 bg-nv-border/70 mt-1" style={{ minHeight: 10 }} />}
              </div>
              <span className="mt-0.5"><PhaseIcon status={phase.status} /></span>
              <span
                className={`text-[11px] font-mono leading-snug flex-1 ${
                  phase.status === 'done'    ? 'text-nv-muted' :
                  phase.status === 'running' ? 'text-nv-text font-semibold' :
                  phase.status === 'error'   ? 'text-red-400' :
                  'text-nv-faint'
                }`}
              >
                {phase.label}
                {phase.status === 'running' && <span className="text-accent"> · running…</span>}
              </span>
            </div>
          ))}
        </div>
      ) : (
        /* Collapsed — compact scrollable strip */
        <div className="flex items-center gap-3 px-3 py-2 overflow-x-auto">
          {phases.map((phase, i) => (
            <div key={phase.id} className="flex items-center gap-1.5 shrink-0">
              {i > 0 && (
                <span className="text-nv-faint/40 text-[10px] font-mono mr-1">·</span>
              )}
              <PhaseIcon status={phase.status} />
              <span
                className={`text-[10px] font-mono leading-tight ${
                  phase.status === 'done'    ? 'text-accent line-through opacity-70' :
                  phase.status === 'running' ? 'text-nv-text font-semibold' :
                  phase.status === 'error'   ? 'text-red-400' :
                  'text-nv-faint'
                }`}
              >
                {phase.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recommendation row (amber tip) */}
      {hasRecommendations && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/8 border-t border-amber-500/20">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="text-amber-400 shrink-0">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            <circle cx="8" cy="11" r="0.6" fill="currentColor"/>
          </svg>
          <p className="text-[10px] text-amber-300 flex-1 leading-tight">
            Connect{' '}
            {recommendConnect!.map((app, i) => (
              <span key={app}>
                {i > 0 && (i === recommendConnect!.length - 1 ? ' or ' : ', ')}
                <button
                  onClick={() => onConnectApp?.(app)}
                  className="underline hover:text-amber-200 transition-fast"
                >
                  {app}
                </button>
              </span>
            ))}{' '}
            for larger datasets →
          </p>
        </div>
      )}
    </div>
  );
}
