import { useState, useEffect, useCallback } from 'react';

const tourKey = (uid?: string) => uid ? `nv-tour-done-${uid}` : 'nv-tour-done';

export function isTourDone(userId?: string) {
  return localStorage.getItem(tourKey(userId)) === '1';
}

export function markTourDone(userId?: string) {
  localStorage.setItem(tourKey(userId), '1');
}

interface Step {
  id: string;
  title: string;
  body: string;
  target: string | null;
  placement?: 'right' | 'bottom';
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Welcome to adris.tech',
    body: "Your AI operating system — 43 agents, a dev terminal, automation, and more in one app. Let's take a quick tour.",
    target: null,
  },
  {
    id: 'sidebar-nav',
    title: 'All your modules, one sidebar',
    body: 'Every tool lives here. Krew for AI agents, Coder for dev work, Models for local LLMs, and more coming soon.',
    target: 'tour-sidebar-nav',
    placement: 'right',
  },
  {
    id: 'nav-krew',
    title: 'Krew — your AI team',
    body: '43 specialist agents with names, roles, and real tools. Arjun is your boss agent — he delegates to the right specialist automatically.',
    target: 'tour-nav-krew',
    placement: 'right',
  },
  {
    id: 'theme',
    title: 'Paper or Ink',
    body: 'Toggle between light (Paper) and dark (Ink) mode at any time. Preference is saved across launches.',
    target: 'tour-theme-toggle',
    placement: 'right',
  },
  {
    id: 'home',
    title: 'Your dashboard',
    body: 'Last project, token balance, recent AI sessions, and system info — all at a glance every time you open the app.',
    target: 'tour-home-greeting',
    placement: 'bottom',
  },
  {
    id: 'done',
    title: "You're all set",
    body: 'Open Connect Apps to link Gmail, Notion, Slack and more. Then just ask Arjun to do things. You can replay this tour anytime.',
    target: null,
  },
];

const PAD = 10;

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  onDone: () => void;
  userId?: string;
}

export default function TourOverlay({ onDone, userId }: Props) {
  const [step, setStep] = useState(0);
  const [spotRect, setSpotRect] = useState<SpotlightRect | null>(null);

  const current = STEPS[step];

  const updateRect = useCallback(() => {
    if (!current.target) {
      setSpotRect(null);
      return;
    }
    const el = document.getElementById(current.target);
    if (!el) {
      setSpotRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setSpotRect({
      top:    r.top    - PAD,
      left:   r.left   - PAD,
      width:  r.width  + PAD * 2,
      height: r.height + PAD * 2,
    });
  }, [current.target]);

  useEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    return () => window.removeEventListener('resize', updateRect);
  }, [updateRect]);

  function finish() {
    markTourDone(userId);
    onDone();
  }

  function next() {
    if (step >= STEPS.length - 1) { finish(); return; }
    setStep((s) => s + 1);
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  function skip() { finish(); }

  const isFirst = step === 0;
  const isLast  = step === STEPS.length - 1;
  const hasSpot = spotRect !== null;

  function tooltipStyle(): React.CSSProperties {
    const GAP = 18;
    const W   = 296;

    if (!hasSpot || !spotRect || !current.placement) {
      return {
        position: 'fixed',
        top:      '50%',
        left:     '50%',
        transform: 'translate(-50%, -50%)',
        width:    W,
      };
    }

    if (current.placement === 'right') {
      return {
        position: 'fixed',
        top:      spotRect.top + spotRect.height / 2,
        left:     spotRect.left + spotRect.width + GAP,
        transform: 'translateY(-50%)',
        width:    W,
      };
    }

    // bottom
    return {
      position: 'fixed',
      top:      spotRect.top + spotRect.height + GAP,
      left:     Math.max(8, spotRect.left + spotRect.width / 2 - W / 2),
      width:    W,
    };
  }

  return (
    <>
      {/* Full backdrop when no spotlight */}
      {!hasSpot && (
        <div
          onClick={skip}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 9997 }}
        />
      )}

      {/* Click-through barrier behind spotlight */}
      {hasSpot && (
        <div
          onClick={skip}
          style={{ position: 'fixed', inset: 0, zIndex: 9996 }}
        />
      )}

      {/* Spotlight cutout — enormous inset box-shadow darkens everything outside */}
      {hasSpot && spotRect && (
        <div
          style={{
            position:    'fixed',
            top:         spotRect.top,
            left:        spotRect.left,
            width:       spotRect.width,
            height:      spotRect.height,
            borderRadius: 10,
            boxShadow:   '0 0 0 9999px rgba(0,0,0,0.72)',
            outline:     '2px solid rgba(124,92,255,0.75)',
            outlineOffset: 0,
            zIndex:      9997,
            pointerEvents: 'none',
            transition:  'top 0.28s cubic-bezier(.4,0,.2,1), left 0.28s cubic-bezier(.4,0,.2,1), width 0.28s cubic-bezier(.4,0,.2,1), height 0.28s cubic-bezier(.4,0,.2,1)',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{ ...tooltipStyle(), zIndex: 9999 }}
        className="bg-nv-surface border border-nv-border rounded-2xl p-5 shadow-2xl"
      >
        {/* Progress dots */}
        <div className="flex gap-1 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="h-1 rounded-full transition-all"
              style={{
                width:      i === step ? 16 : 8,
                background: i === step ? '#7C5CFF' : i < step ? 'rgba(124,92,255,0.4)' : 'var(--nv-border, #333)',
                transition: 'width 0.2s, background 0.2s',
              }}
            />
          ))}
        </div>

        <h3 className="text-nv-text text-[15px] font-semibold mb-1.5 leading-snug">
          {current.title}
        </h3>
        <p className="text-nv-muted text-[12px] leading-relaxed mb-5">
          {current.body}
        </p>

        <div className="flex items-center justify-between">
          {isFirst ? (
            <button
              onClick={skip}
              className="text-[11px] text-nv-faint hover:text-nv-muted transition-fast"
            >
              Skip tour
            </button>
          ) : (
            <button
              onClick={back}
              className="text-[11px] text-nv-faint hover:text-nv-muted transition-fast"
            >
              ← Back
            </button>
          )}
          <button
            onClick={next}
            className="text-[12px] px-4 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast"
          >
            {isLast ? 'Done' : 'Next →'}
          </button>
        </div>
      </div>
    </>
  );
}
