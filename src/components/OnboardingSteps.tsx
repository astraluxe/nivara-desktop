import { useState } from 'react';
import {
  EMPTY_ANSWERS, ROLE_OPTIONS, SCALE_OPTIONS, hasAnything, whatThisUnlocks,
  type OnboardingAnswers, type OnboardingRole,
} from '../lib/onboarding';

// ─── Asked once, at the only moment the user is definitely looking ───────────
//
// Everything in Settings that makes the app behave well was invisible to a new user, because a new
// user has no reason to open Settings. So the app guessed, and the guesses were the complaints:
// leads aimed at companies far too big to sell to, a lead search with no city, a guide that opened
// on "Everything", agents that did not know the user's name.
//
// Three screens, five answers, all skippable. Deliberately NOT a form: one question per screen,
// tappable answers, and only two free-text fields — because a wall of inputs at first launch is
// the thing everyone abandons, and a half-answered onboarding is worth more than a skipped one.

interface Props {
  onDone: (a: OnboardingAnswers) => void;
  onSkip: () => void;
}

const STEPS = 3;

export default function OnboardingSteps({ onDone, onSkip }: Props) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<OnboardingAnswers>(EMPTY_ANSWERS);
  const set = (patch: Partial<OnboardingAnswers>) => setA((p) => ({ ...p, ...patch }));

  const next = () => (step < STEPS - 1 ? setStep(step + 1) : onDone(a));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const field =
    'w-full bg-nv-surface border border-nv-border rounded-xl px-3.5 py-2.5 text-[13px] text-nv-text ' +
    'outline-none focus:border-accent transition-colors placeholder:text-nv-faint';

  const choice = (active: boolean) =>
    `text-left px-3.5 py-2.5 rounded-xl border transition-colors ${
      active
        ? 'border-accent bg-accent/10'
        : 'border-nv-border bg-nv-surface hover:border-accent/50'
    }`;

  return (
    <div className="fixed inset-0 z-50 bg-nv-bg flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-md my-auto">

        {/* Progress — three dots, so the end is visibly close. Nobody abandons three. */}
        <div className="flex items-center justify-center gap-1.5 mb-7">
          {Array.from({ length: STEPS }).map((_, i) => (
            <span key={i}
              className="h-1 rounded-full transition-all duration-300"
              style={{
                width: i === step ? 22 : 8,
                background: i <= step ? 'var(--nv-accent, #7C5CFF)' : 'var(--nv-border)',
              }} />
          ))}
        </div>

        {/* ── 1. Who they are ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div>
            <h1 className="text-[20px] font-semibold text-nv-text tracking-tight mb-1">
              First — what should we call you?
            </h1>
            <p className="text-[12.5px] text-nv-faint leading-relaxed mb-5">
              Your agents sign emails and messages as you. Without this they write as “the user”,
              which is the tell that something was automated.
            </p>
            <div className="space-y-2.5">
              <input autoFocus className={field} placeholder="Your name"
                value={a.name} onChange={(e) => set({ name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }} />
              <input className={field} placeholder="Your company (optional)"
                value={a.company} onChange={(e) => set({ company: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }} />
            </div>
          </div>
        )}

        {/* ── 2. What they do — this picks the guide's running order ───────── */}
        {step === 1 && (
          <div>
            <h1 className="text-[20px] font-semibold text-nv-text tracking-tight mb-1">
              What do you mostly do?
            </h1>
            <p className="text-[12.5px] text-nv-faint leading-relaxed mb-5">
              The guide is long. This puts your part of it first, and you can change it there any time.
            </p>
            <div className="grid grid-cols-1 gap-1.5 max-h-[46vh] overflow-y-auto pr-0.5">
              {ROLE_OPTIONS.map((r) => (
                <button key={r.key} type="button"
                  onClick={() => { set({ role: r.key as OnboardingRole }); setStep(2); }}
                  className={choice(a.role === r.key)}>
                  <span className="block text-[13px] font-medium text-nv-text">{r.label}</span>
                  <span className="block text-[11px] text-nv-faint mt-0.5">{r.blurb}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 3. How big, and where — the answer that fixes the lead lists ─── */}
        {step === 2 && (
          <div>
            <h1 className="text-[20px] font-semibold text-nv-text tracking-tight mb-1">
              How big are you, and where?
            </h1>
            <p className="text-[12.5px] text-nv-faint leading-relaxed mb-5">
              This is the one that matters most. It decides the size of company your lead searches
              aim at — without it they return household names nobody small can actually sell to.
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {SCALE_OPTIONS.map((sc) => (
                <button key={sc.key} type="button"
                  onClick={() => set({ scale: sc.key })}
                  className={choice(a.scale === sc.key)}>
                  <span className="block text-[12.5px] font-medium text-nv-text">{sc.label}</span>
                  <span className="block text-[10px] text-nv-faint mt-0.5 leading-snug">{sc.blurb}</span>
                </button>
              ))}
            </div>
            <div className="space-y-2.5">
              <input className={field} placeholder="Your city — e.g. Bengaluru"
                value={a.city} onChange={(e) => set({ city: e.target.value })} />
              <input className={field} placeholder="What do you sell? One line. (optional)"
                value={a.sells} onChange={(e) => set({ sells: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') next(); }} />
            </div>

            {/* Say plainly what each answer buys them, rather than asking on trust. */}
            {hasAnything(a) && (
              <ul className="mt-4 space-y-1">
                {whatThisUnlocks(a).map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[11px] text-nv-faint leading-snug">
                    <span className="text-accent mt-px shrink-0">✓</span>{line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mt-7">
          {step > 0 && (
            <button onClick={back}
              className="text-[12px] px-3 py-2.5 rounded-xl border border-nv-border text-nv-faint hover:text-nv-text transition-colors">
              Back
            </button>
          )}
          <button onClick={next}
            className="flex-1 py-2.5 rounded-xl text-[13.5px] font-semibold bg-accent text-white hover:bg-accent/85 transition-colors">
            {step === STEPS - 1 ? 'Save and continue →' : 'Continue'}
          </button>
        </div>

        {/* Skipping is a real option, and saying so is what keeps the answers honest. */}
        <button onClick={onSkip}
          className="w-full text-center text-[11px] text-nv-faint hover:text-nv-text transition-colors mt-3">
          Skip — I’ll set this up later in Settings
        </button>
      </div>
    </div>
  );
}
