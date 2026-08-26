// ─── Handing a plan from Krew to Coder ───────────────────────────────────────
//
// Krew is where the plan gets made — the boss and the specialists work out what to build and in
// what order. Coder is where it gets built. Until now those two never spoke: the user read a plan
// in one module, opened the other, and typed it out again.
//
// ── THE RULE THAT SHAPES THIS: IT NEVER MOVES THE USER ON ITS OWN ────────────
//
// Nothing here fires because an agent decided the work looked like code. It fires when the user
// asks for it — "code this", "build it" — and only then. Being thrown into an editor mid-conversation
// is the same intrusion as an agent grabbing the mouse, applied to adris itself, and the standing
// rule is that adris never shifts someone off what they are working on.
//
// So the handoff is two separate things, deliberately: the plan is STASHED here, and the navigation
// is a separate act the caller performs. A plan can be waiting without the user having been moved.

export interface CoderPlan {
  /** What the whole job is, in a sentence. Shown at the top so the editor has context. */
  title: string;
  /** The steps, in order, exactly as the user approved them. */
  steps: string[];
  /** Anything the plan depends on that is not a step — a stack choice, a file, a constraint. */
  notes?: string;
  /** Which agent produced it, so Coder can say where the work came from. */
  from?: string;
  at: number;
}

const KEY = 'nv-coder-handoff';
export const CODER_PLAN_EVENT = 'nv-coder-plan';

/** Leave a plan for Coder to pick up. Does NOT navigate — see the note above. */
export function stashPlan(plan: Omit<CoderPlan, 'at'>): CoderPlan | null {
  const steps = (plan.steps ?? []).map((s) => String(s).trim()).filter(Boolean);
  const title = String(plan.title ?? '').trim();
  // A plan with no steps is not a plan. Refusing here means Coder never opens on an empty brief,
  // which would look like the handoff silently failed.
  if (!title || !steps.length) return null;
  const full: CoderPlan = { title, steps, notes: String(plan.notes ?? '').trim() || undefined, from: plan.from, at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(full));
    window.dispatchEvent(new CustomEvent(CODER_PLAN_EVENT, { detail: full }));
  } catch { return null; }
  return full;
}

/** What is waiting, if anything. Does not consume it. */
export function peekPlan(): CoderPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as CoderPlan;
    if (!p || !p.title || !Array.isArray(p.steps) || !p.steps.length) return null;
    // A plan older than a day is not the one they meant. Coder would otherwise greet somebody on
    // Monday with what they asked for on Friday.
    if (Date.now() - (p.at || 0) > 24 * 60 * 60 * 1000) return null;
    return p;
  } catch { return null; }
}

/** Take it, and clear it — so opening Coder again does not re-announce the same plan. */
export function takePlan(): CoderPlan | null {
  const p = peekPlan();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return p;
}

export function clearPlan(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * The plan as the opening brief Coder actually works from.
 *
 * Numbered, because the order was the point of making a plan. The closing instruction exists
 * because a model handed a list will otherwise summarise it back — which is the one thing the user
 * definitely does not need, having just read it in the other module.
 */
export function planAsBrief(p: CoderPlan): string {
  const lines = [
    `Build this. It is the plan ${p.from ? `${p.from} ` : ''}already agreed with the user in Krew, so do not re-plan it and do not summarise it back to them.`,
    '',
    `## ${p.title}`,
    '',
    ...p.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  if (p.notes) lines.push('', '## Also', p.notes);
  lines.push(
    '',
    'Start with step 1. Work in the folder that is open. If nothing is open, say so and ask which folder to work in '
    + 'rather than guessing — writing files into the wrong project is worse than waiting.',
  );
  return lines.join('\n');
}
