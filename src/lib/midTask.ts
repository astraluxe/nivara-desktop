// ─── Adding to a task that is already running ────────────────────────────────
//
// THE PROBLEM. Today a running task cannot be added to. The user waits for it to finish and then
// asks again — which for a long run means watching something being done slightly wrong for ten
// minutes, unable to say the one sentence that would fix it.
//
// And what people remember mid-task is almost always an ADDITION, not a correction: "also cc my
// partner", "skip the ones in Mumbai", "use the September template". A person leaning over your
// desk would just say it, and you would fold it in at the next natural break.
//
// ── WHERE IT IS FOLDED IN, AND WHY NOT SOONER ────────────────────────────────
//
// At step boundaries, never mid-step. Interrupting an agent halfway through writing a document to
// hand it new instructions produces something half-written to one brief and half to another. The
// next step is the earliest point where the instruction can be honoured completely, which is the
// difference between "added" and "half-added".
//
// The user is told which it was — taken now, or queued for the next step — because an instruction
// that appears to have been ignored is worse than one that was refused.

export interface PendingInstruction {
  id: string;
  text: string;
  at: number;
  /** Set once it has actually been handed to a step, with which step took it. */
  takenBy?: string;
}

const queues = new Map<string, PendingInstruction[]>();

/** Add something to a run that is already going. */
export function addInstruction(runId: string, text: string): PendingInstruction | null {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const item: PendingInstruction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: clean,
    at: Date.now(),
  };
  const q = queues.get(runId);
  if (q) q.push(item); else queues.set(runId, [item]);
  return item;
}

/** Everything still waiting to be folded in. */
export function pending(runId: string): PendingInstruction[] {
  return (queues.get(runId) ?? []).filter((i) => !i.takenBy);
}

/**
 * Hand the waiting instructions to a step and mark them taken.
 *
 * Marking happens here rather than at the end of the step on purpose: if the same instruction were
 * handed to two steps running in parallel, "also cc my partner" becomes two copies of everything.
 * Taken once, by the first step to ask.
 */
export function takeFor(runId: string, stepId: string): PendingInstruction[] {
  const q = queues.get(runId) ?? [];
  const mine = q.filter((i) => !i.takenBy);
  for (const i of mine) i.takenBy = stepId;
  return mine;
}

/** Drop a finished run's queue, so a long session does not accumulate them forever. */
export function clearRun(runId: string): void {
  queues.delete(runId);
}

/** Everything that was added during a run, taken or not — for the summary at the end. */
export function allFor(runId: string): PendingInstruction[] {
  return [...(queues.get(runId) ?? [])];
}

/**
 * The instructions, formatted for an agent that is mid-job.
 *
 * Deliberately emphatic about precedence: these arrive AFTER the original brief and the user meant
 * them to win. A model handed two sets of instructions with no ordering will often average them,
 * which is the one outcome nobody asked for.
 */
export function formatForStep(items: PendingInstruction[]): string {
  if (!items.length) return '';
  const lines = items.map((i) => `- ${i.text}`).join('\n');
  return `The user added this WHILE you were working, so it is newer than your original brief and it wins `
    + `wherever the two disagree. Fold it into what you are doing now — do not start over, and do not `
    + `mention that it arrived late:\n${lines}`;
}

/** What the user is told the moment they add something. */
export function acknowledge(runningNow: number): string {
  return runningNow > 0
    ? `Added — I'll fold that in at the next step. ${runningNow} ${runningNow === 1 ? 'agent is' : 'agents are'} mid-task, and interrupting them now would leave half-finished work.`
    : 'Added — the next step will pick that up.';
}
