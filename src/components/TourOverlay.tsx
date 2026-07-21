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

// The tour used to describe the furniture — "this is the sidebar, this is the theme toggle" —
// and never once explained what the app DOES. People (including the founder) came away unsure how
// lead generation worked or that slash commands existed at all. It now walks the actual workflow
// end to end and hands off to the full written guide.
const STEPS: Step[] = [
  {
    id: 'welcome',
    title: 'Krew is an office, not a chatbot',
    body: "adris.tech runs an AI office on your laptop. Arjun is the boss — you tell him the outcome you want, and he assigns the specialists who do it. You never have to know which agent is which.",
    target: null,
  },
  {
    id: 'nav-krew',
    title: 'Talk to Arjun here',
    body: 'Ask in plain words — "find me 20 solar companies in Pune", "check my LinkedIn messages and reply". He works out the steps, uses a real browser when he needs one, and shows you the result.',
    target: 'tour-nav-krew',
    placement: 'right',
  },
  {
    id: 'slash',
    title: 'Type / for the shortcuts',
    body: 'Slash commands run a whole workflow in one go instead of you explaining it. /scan, /verify, /enrich, /outreach, /repair-table, /autopilot — press / in the chat box to see them all with descriptions.',
    target: 'tour-nav-krew',
    placement: 'right',
  },
  {
    id: 'leadgen',
    title: 'How lead generation actually works',
    body: 'Four steps, in order. /scan reads your LinkedIn connections. /verify checks that a lead is real. /enrich fills in email, phone and LinkedIn. /outreach drafts a message per person and opens the copilot. Each step feeds the next — run them in that order.',
    target: 'tour-nav-krew',
    placement: 'right',
  },
  {
    id: 'brain',
    title: 'Everything is saved in Brain',
    body: 'Results become notes you can open, edit and reuse — connections land in a note called "LinkedIn connections". Agents read Brain before asking you to repeat yourself, so the work compounds instead of vanishing with the chat.',
    target: 'tour-nav-krew',
    placement: 'right',
  },
  {
    id: 'approval',
    title: 'Nothing goes out without you',
    body: 'Krew drafts and fills, then stops. Messages are typed into the chat box for you to read and send yourself; forms wait for your approval. Anything left hanging shows up in your To-do list.',
    target: null,
  },
  {
    id: 'done',
    title: 'Read the full guide',
    body: 'Every module, every slash command and a worked LinkedIn example are written up in Info — including where each thing gets saved. Worth ten minutes; it is the fastest way to stop guessing.',
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
  /** Sends the user to the written guide in Info — the tour is an orientation, not the manual. */
  onOpenGuide?: () => void;
}

export default function TourOverlay({ onDone, userId, onOpenGuide }: Props) {
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
          <div className="flex items-center gap-2">
            {isLast && onOpenGuide && (
              <button
                onClick={() => { markTourDone(userId); onOpenGuide(); onDone(); }}
                className="text-[12px] px-3 py-1.5 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-fast"
              >
                Open the full guide
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
      </div>
    </>
  );
}
