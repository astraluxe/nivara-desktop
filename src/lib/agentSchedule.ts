// ─── Several agents on one job, at the same time where that is safe ──────────
//
// THE REQUIREMENT, in the owner's words: if a task needs three agents and each can work without the
// others finishing, all three should work at once. But if an agent will answer better once it has
// what the previous one found, it must wait for that.
//
// Today the office runs steps one after another regardless. A campaign that needs a lead list, a
// competitor scan and a pricing sheet takes three times longer than it should — and none of those
// three needs anything from the other two.
//
// WHAT THIS IS AND IS NOT. This is the scheduler only: it decides what may start now, what must
// wait, and for whom. It runs nothing itself. That separation is the point — deciding is pure and
// can be tested exhaustively in node, while running involves models, browsers and Office and cannot.
//
// ── THE THREE THINGS THAT GO WRONG, and what is done about each ──────────────
//
// 1. A CYCLE. Two steps each waiting for the other, and the office silently does nothing forever.
//    Detected before anything starts, and reported as an error — never as a run that hangs.
// 2. A DEPENDENCY ON SOMETHING THAT ISN'T THERE. A step waiting for "pricing" when no step produces
//    "pricing" is the same deadlock wearing a different hat, and is caught the same way.
// 3. A FAILURE UPSTREAM. If the lead list fails, the outreach that needed it must not run on
//    nothing — it is BLOCKED and says why. Steps that never needed it carry on, because punishing
//    unrelated work for an unrelated failure is how one broken step wastes a whole run.

export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'blocked';

export interface AgentStep {
  id: string;
  /** Which agent does it — used for the cursor colour and the label the user sees. */
  agent: string;
  /** What the user is told is happening. Never a bare "working…". */
  label: string;
  /** Ids that must be `done` first. Empty means it can start immediately. */
  needs?: string[];
  state?: StepState;
  /** Filled in as it runs, and handed to whatever depends on it. */
  output?: string;
  error?: string;
}

export interface Plan {
  steps: AgentStep[];
  /** How many may run at once. More than this and the browser and Office start colliding. */
  maxParallel?: number;
}

/** The default ceiling on concurrency. See why in `pickRunnable`. */
export const DEFAULT_MAX_PARALLEL = 3;

export interface PlanProblem { kind: 'cycle' | 'missing' | 'duplicate'; detail: string }

/**
 * Check a plan before a single agent starts.
 *
 * A deadlock discovered halfway through a run has already cost the user real time and left the
 * office in a state nobody can explain. Every one of these is knowable up front.
 */
export function validatePlan(plan: Plan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const ids = new Set<string>();
  for (const s of plan.steps) {
    if (ids.has(s.id)) problems.push({ kind: 'duplicate', detail: `two steps share the id "${s.id}"` });
    ids.add(s.id);
  }
  for (const s of plan.steps) {
    for (const need of s.needs ?? []) {
      if (!ids.has(need)) {
        problems.push({ kind: 'missing', detail: `"${s.id}" waits for "${need}", which no step produces` });
      }
    }
  }

  // Cycle detection by depth-first search, tracking the path so the message can name the loop
  // rather than just assert that one exists.
  const colour = new Map<string, 0 | 1 | 2>();   // 0 unseen, 1 on the current path, 2 finished
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const walk = (id: string, path: string[]): void => {
    const c = colour.get(id) ?? 0;
    if (c === 2) return;
    if (c === 1) {
      const from = path.indexOf(id);
      problems.push({ kind: 'cycle', detail: `these wait on each other forever: ${[...path.slice(from), id].join(' → ')}` });
      return;
    }
    colour.set(id, 1);
    for (const need of byId.get(id)?.needs ?? []) if (byId.has(need)) walk(need, [...path, id]);
    colour.set(id, 2);
  };
  for (const s of plan.steps) walk(s.id, []);

  // The same cycle is found once per entry point into it; report each loop once.
  const seen = new Set<string>();
  return problems.filter((p) => (seen.has(p.kind + p.detail) ? false : (seen.add(p.kind + p.detail), true)));
}

/** Every step starts as waiting; anything already carrying a state keeps it (for resuming a run). */
export function initPlan(plan: Plan): Plan {
  return { ...plan, steps: plan.steps.map((s) => ({ ...s, state: s.state ?? 'waiting' })) };
}

/**
 * Which steps may start right now.
 *
 * A step is runnable when it is waiting, everything it needs is done, and there is room under the
 * parallel ceiling.
 *
 * WHY A CEILING AT ALL. Three agents is not an arbitrary number: there is ONE agent browser (a
 * single CDP session — two agents driving it interleave their clicks) and ONE Word application
 * object per process. Unlimited parallelism does not make the work faster, it makes it collide.
 * The real fix is a resource claim per agent; until that exists, the ceiling is what keeps the
 * office honest.
 */
export function pickRunnable(plan: Plan): AgentStep[] {
  const max = plan.maxParallel ?? DEFAULT_MAX_PARALLEL;
  const running = plan.steps.filter((s) => s.state === 'running').length;
  const room = Math.max(0, max - running);
  if (!room) return [];
  const done = new Set(plan.steps.filter((s) => s.state === 'done').map((s) => s.id));
  return plan.steps
    .filter((s) => s.state === 'waiting' && (s.needs ?? []).every((n) => done.has(n)))
    .slice(0, room);
}

/**
 * Record a result, and work out what that means for everything downstream.
 *
 * A failure does NOT stop the run. It blocks only what genuinely depended on the failed step —
 * directly or through a chain — and leaves everything else alone. One broken step should cost the
 * user that step, not the afternoon.
 */
export function applyResult(
  plan: Plan,
  id: string,
  result: { ok: true; output: string } | { ok: false; error: string },
): Plan {
  const steps = plan.steps.map((s) => {
    if (s.id !== id) return s;
    return result.ok
      ? { ...s, state: 'done' as StepState, output: result.output }
      : { ...s, state: 'failed' as StepState, error: result.error };
  });

  if (result.ok) return { ...plan, steps };

  // Walk the chain outward: anything waiting on a failed or blocked step is itself blocked, and so
  // is anything waiting on THAT. Repeated until nothing changes, so a three-deep chain is caught.
  const bad = new Set(steps.filter((s) => s.state === 'failed' || s.state === 'blocked').map((s) => s.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps) {
      if (s.state !== 'waiting') continue;
      const culprit = (s.needs ?? []).find((n) => bad.has(n));
      if (!culprit) continue;
      s.state = 'blocked';
      s.error = `could not start — "${culprit}" did not finish`;
      bad.add(s.id);
      changed = true;
    }
  }
  return { ...plan, steps };
}

/** Nothing left that could still start or is still going. */
export function isFinished(plan: Plan): boolean {
  return plan.steps.every((s) => s.state === 'done' || s.state === 'failed' || s.state === 'blocked');
}

/**
 * The context a step is given: what the steps it waited for actually produced.
 *
 * This is the other half of the requirement — an agent that waits for another must actually RECEIVE
 * its work, or the waiting bought nothing.
 */
export function contextFor(plan: Plan, id: string): string {
  const step = plan.steps.find((s) => s.id === id);
  if (!step || !(step.needs ?? []).length) return '';
  const parts: string[] = [];
  for (const need of step.needs ?? []) {
    const from = plan.steps.find((s) => s.id === need);
    if (from?.output?.trim()) parts.push(`--- from ${from.agent} (${from.label}) ---\n${from.output.trim()}`);
  }
  return parts.join('\n\n');
}

/**
 * One line the user can read while it runs.
 *
 * The standing rule is never a bare "thinking…" — name what is happening. With several agents at
 * once that matters more, not less: three spinners with no labels is worse than one.
 */
export function describePlan(plan: Plan): string {
  const by = (st: StepState) => plan.steps.filter((s) => s.state === st);
  const running = by('running');
  const bits: string[] = [];
  if (running.length) {
    bits.push(running.length === 1
      ? `${running[0].agent} is ${running[0].label}`
      : `${running.length} working at once: ${running.map((s) => `${s.agent} (${s.label})`).join(', ')}`);
  }
  const waiting = by('waiting');
  if (waiting.length) bits.push(`${waiting.length} waiting`);
  const done = by('done');
  if (done.length) bits.push(`${done.length} done`);
  const failed = by('failed');
  if (failed.length) bits.push(`${failed.length} failed`);
  const blocked = by('blocked');
  if (blocked.length) bits.push(`${blocked.length} could not start`);
  return bits.join(' · ') || 'nothing to do';
}

/**
 * Run a plan.
 *
 * `run` does the actual work and is supplied by the caller, so this file never imports a model, a
 * browser or Office — and stays testable with a fake.
 *
 * `onChange` fires on every state change so the chat and the cursor overlay can show progress as it
 * happens rather than only at the end.
 */
export async function runPlan(
  plan: Plan,
  run: (step: AgentStep, context: string) => Promise<string>,
  onChange: (plan: Plan) => void = () => {},
  shouldStop: () => boolean = () => false,
  /**
   * Anything the user said WHILE this was running, handed to the next step to start.
   *
   * Taken at step boundaries and never mid-step: interrupting an agent halfway through writing a
   * document to give it a new brief produces something written half to each. See midTask.ts.
   */
  takeInstructions: (stepId: string) => string = () => '',
): Promise<Plan> {
  const problems = validatePlan(plan);
  if (problems.length) {
    throw new Error(`This plan cannot run: ${problems.map((p) => p.detail).join('; ')}`);
  }

  let current = initPlan(plan);
  onChange(current);

  const inFlight = new Map<string, Promise<void>>();

  while (!isFinished(current)) {
    if (shouldStop()) {
      // Stop means stop: what is already in flight is awaited so nothing is left half-written, but
      // nothing new starts.
      await Promise.allSettled([...inFlight.values()]);
      return current;
    }

    for (const step of pickRunnable(current)) {
      current = { ...current, steps: current.steps.map((s) => (s.id === step.id ? { ...s, state: 'running' as StepState } : s)) };
      onChange(current);
      // The step's inputs, plus anything the user added since the run began.
      const late = takeInstructions(step.id);
      const ctx = [contextFor(current, step.id), late].filter(Boolean).join('\n\n');
      const p = run(step, ctx)
        .then((output) => { current = applyResult(current, step.id, { ok: true, output }); })
        .catch((e) => {
          current = applyResult(current, step.id, { ok: false, error: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => { inFlight.delete(step.id); onChange(current); });
      inFlight.set(step.id, p);
    }

    if (!inFlight.size) break;      // nothing running and nothing startable — done, or all blocked
    await Promise.race([...inFlight.values()]);
  }

  await Promise.allSettled([...inFlight.values()]);
  return current;
}

// ─── Turning the boss's workflow into a plan ─────────────────────────────────
//
// `plan_workflow` hands over a list of delegations that has always been run strictly in order. Two
// things are wrong with that, and they are different problems:
//
//   1. STEPS THAT NEED NOTHING FROM EACH OTHER STILL QUEUE. "Research three competitors, pull my
//      pricing, and check my calendar" is three independent jobs run one after another for no
//      reason at all.
//   2. A BADLY ORDERED LIST RUNS BADLY. A model that lists the writer before the researcher gets
//      exactly that, and the writer opens with an empty {{prev}}.
//
// This converts the delegations into a Plan the scheduler understands, so both are answered by the
// same piece of code.
//
// HOW A DEPENDENCY IS WORKED OUT, in order of authority:
//   - an explicit `needs` on the delegation wins, always;
//   - otherwise, `{{prev}}` in the task means "I need the step before me" — which is exactly what
//     it has always meant, so every existing prompt keeps its current behaviour;
//   - otherwise the step depends on nothing and may run in parallel.
//
// That last line is the entire win, and it is backwards compatible: nothing that used {{prev}}
// changes, and everything that never needed it stops waiting.

export interface Delegation {
  agent_key: string;
  task: string;
  /** Optional explicit dependencies, by step id ("1", "2", …) or by agent_key. */
  needs?: string[];
}

/** Build a validated Plan from what the boss asked for. Ids are 1-based to match how it thinks. */
export function planFromDelegations(dels: Delegation[], maxParallel = DEFAULT_MAX_PARALLEL): Plan {
  const steps: AgentStep[] = dels.map((d, i) => {
    const id = String(i + 1);
    const task = String(d.task ?? '');
    let needs: string[];
    if (Array.isArray(d.needs) && d.needs.length) {
      // Accept either an id or an agent_key, because a model will use whichever it was thinking in.
      needs = d.needs
        .map((n) => {
          const s = String(n);
          const byKey = dels.findIndex((x) => x.agent_key === s);
          return byKey >= 0 ? String(byKey + 1) : s;
        })
        .filter((n) => n !== id);
    } else if (/\{\{prev\}\}/.test(task) && i > 0) {
      needs = [String(i)];
    } else {
      needs = [];
    }
    return {
      id,
      agent: String(d.agent_key ?? `step${id}`),
      label: task.slice(0, 60) + (task.length > 60 ? '…' : ''),
      needs,
    };
  });
  return { steps, maxParallel };
}

/**
 * The order to run them in, and which ones could have gone together.
 *
 * Returned as WAVES: every step in a wave can run at the same time as the others in it, and each
 * wave needs the one before. Running the waves in order is correct even for a caller that executes
 * strictly one at a time — which is why this is useful before true concurrency exists.
 */
export function runWaves(plan: Plan): AgentStep[][] {
  const waves: AgentStep[][] = [];
  const done = new Set<string>();
  const left = new Map(plan.steps.map((s) => [s.id, s]));
  while (left.size) {
    const ready = [...left.values()].filter((s) => (s.needs ?? []).every((n) => done.has(n) || !left.has(n)));
    // Nothing ready and something left means a cycle. validatePlan reports it properly; here the
    // remaining steps are emitted in their original order so a caller can still run *something*
    // rather than looping forever.
    if (!ready.length) { waves.push([...left.values()]); break; }
    waves.push(ready);
    for (const s of ready) { done.add(s.id); left.delete(s.id); }
  }
  return waves;
}

/** How much time the ordering saves, for the line the user is shown. */
export function parallelSummary(plan: Plan): string {
  const waves = runWaves(plan);
  const together = waves.filter((w) => w.length > 1);
  if (!together.length) return `${plan.steps.length} steps, each needing the one before it.`;
  const most = Math.max(...waves.map((w) => w.length));
  return `${plan.steps.length} steps in ${waves.length} rounds — up to ${most} working at the same time.`;
}
