import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlanStep } from '../../lib/planStore';
import {
  type WorkOrder, parseWorkOrder, formatWorkOrder, workOrderInstruction, blankWorkOrder,
} from '../../lib/workOrder';
import { routeTeam } from '../../lib/taskRouting';
import { AGENT_BY_KEY, agentHandle } from '../../lib/krewAgents';

/**
 * A text box that grows to fit what is in it.
 *
 * The work order that arrives from a plan is often one long paragraph — the whole of a day's
 * detail, written by the council — and a fixed three-row box showed about a tenth of it with no
 * way to open it up. You cannot approve what you cannot read, which defeats the entire point of
 * showing the order before it runs. It still caps and scrolls, so one enormous brief cannot push
 * the buttons off the bottom of the screen.
 */
function GrowText({ value, onChange, min = 3, max = 320, ...rest }: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min * 18), max)}px`;
  }, [value, min, max]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
      style={{ overflowY: 'auto' }}
    />
  );
}

// ─── Handing a task to the team ──────────────────────────────────────────────
//
// In a real office you do not point at a line on a wall chart and shout "go". You write down what
// the job is, who takes it, what they will use and how you will both know it is finished — then the
// person doing it reads it back, you fix the two things you got wrong, and only then does it start.
//
// That is the whole design of this sheet. An agent drafts the work order from the plan's own
// reasoning, the user edits every part of it, and nothing runs until they press the button that
// says it runs. A one-click "do this task" would be faster and would spend the user's tokens
// working on the wrong thing about a third of the time.

export default function TaskHandover({ step, planTitle, draft, onRun, onSaveOnly, onClose }: {
  step: PlanStep;
  planTitle: string;
  /** Ask an agent to draft the order. Streams so the sheet fills in rather than hanging. */
  draft: (onDelta: (partial: string) => void) => Promise<string>;
  /** Send the approved order to the team. */
  onRun: (instruction: string, brief: string) => void;
  /** Keep the detail on the task without starting it. */
  onSaveOnly: (brief: string) => void;
  onClose: () => void;
}) {
  const [order, setOrder] = useState<WorkOrder>(() => (
    step.brief ? parseWorkOrder(step.brief, step.action) : blankWorkOrder()
  ));
  // A brief already agreed once is not re-drafted: that would spend a model call to overwrite the
  // user's own edits, which is the opposite of what a saved brief is for.
  const [state, setState] = useState<'drafting' | 'ready' | 'failed'>(step.brief ? 'ready' : 'drafting');
  const [partial, setPartial] = useState('');
  const [err, setErr] = useState('');
  const started = useRef(false);

  // Everyone this task could sensibly go to — routed per STEP, so the team actually covers the
  // work. Routing the task as one blob returned whichever two rules scored highest over all of it,
  // which for "write the one-liner, filter the sheet, test the install" meant three writers and
  // nobody who could open a spreadsheet: every step then fell to the first agent and one agent did
  // the lot, which is the exact failure this whole sheet exists to prevent.
  const suggested = useMemo(
    () => routeTeam([step.action, ...order.steps.filter((s) => s.trim())])
      .map((k) => AGENT_BY_KEY[k]).filter(Boolean)
      .map((a) => ({ key: a.key, handle: agentHandle(a) })),
    [step.action, order.steps],
  );
  // Keyed by agent KEY, never by handle: the handle is a label, and delegate_to_agent resolves
  // agent_key with an exact lookup — a display name reaches nobody.
  const [team, setTeam] = useState<string[]>([]);
  // The draft arrives after mount and brings the steps with it, so the team is only knowable then.
  // Anything the user has already ticked is respected; this only fills an empty selection.
  useEffect(() => {
    setTeam((t) => (t.length ? t : suggested.slice(0, 3).map((a) => a.key)));
  }, [suggested]);

  useEffect(() => {
    if (started.current || step.brief) return;
    started.current = true;
    let live = true;
    draft((p) => { if (live) setPartial(p); })
      .then((text) => {
        if (!live) return;
        setOrder(parseWorkOrder(text, step.action));
        setState('ready');
      })
      .catch((e) => {
        if (!live) return;
        setErr(e instanceof Error ? e.message : String(e));
        setState('failed');
      });
    return () => { live = false; };
  }, [draft, step.brief, step.action]);

  const set = <K extends keyof WorkOrder>(k: K, v: WorkOrder[K]) => setOrder((o) => ({ ...o, [k]: v }));
  const setStep = (i: number, v: string) => setOrder((o) => ({ ...o, steps: o.steps.map((s, j) => (j === i ? v : s)) }));
  const addStep = () => setOrder((o) => ({ ...o, steps: [...o.steps, ''] }));
  const delStep = (i: number) => setOrder((o) => ({ ...o, steps: o.steps.filter((_, j) => j !== i) }));
  const moveStep = (i: number, by: number) => setOrder((o) => {
    const j = i + by;
    if (j < 0 || j >= o.steps.length) return o;
    const steps = [...o.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...o, steps };
  });

  const clean: WorkOrder = {
    ...order,
    steps: order.steps.map((s) => s.trim()).filter(Boolean),
    uses: order.uses.map((s) => s.trim()).filter(Boolean),
    asks: order.asks.map((s) => s.trim()).filter(Boolean),
  };
  // Nothing to hand over is not an error state — it is a draft the user has emptied, and the button
  // should simply be unavailable rather than sending an empty order to an agent.
  const runnable = state === 'ready' && (clean.steps.length > 0 || clean.summary.trim().length > 10);

  const field = 'w-full rounded-lg px-2 py-1.5 text-[11.5px] bg-nv-bg border border-nv-border focus:border-accent outline-none text-nv-text resize-y';
  const label = 'text-[9.5px] font-semibold uppercase tracking-wide text-nv-faint';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-md p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-full bg-nv-surface border border-nv-border rounded-2xl shadow-2xl flex flex-col min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-nv-border shrink-0 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-nv-text leading-snug">Hand this to the team</p>
            <p className="text-[10px] text-nv-faint mt-0.5 truncate">Day {step.day} · {planTitle}</p>
          </div>
          <button onClick={onClose} className="text-[15px] leading-none px-1 text-nv-faint hover:text-nv-text transition-fast" aria-label="Close">×</button>
        </div>

        <div className="px-4 py-3 overflow-y-auto min-h-0 flex-1 space-y-3">
          <div className="px-2.5 py-2 rounded-lg bg-nv-bg border border-nv-border">
            <p className="text-[11.5px] text-nv-text leading-snug">{step.action}</p>
            {step.doneWhen && <p className="text-[9.5px] text-nv-faint mt-0.5">the plan says: done when {step.doneWhen}</p>}
          </div>

          {state === 'drafting' && (
            /* The draft is streamed in rather than hidden behind a spinner. It is being written by
               the same model everything else here runs on, which on a local model can take a while,
               and a blank box for forty seconds looks broken. */
            <div>
              <p className="text-[10.5px] text-accent flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Working out what this task actually involves…
              </p>
              <pre className="mt-1.5 text-[10px] text-nv-faint leading-relaxed whitespace-pre-wrap max-h-52 overflow-y-auto">{partial || ' '}</pre>
            </div>
          )}

          {state === 'failed' && (
            <div className="px-2.5 py-2 rounded-lg border border-nv-bad/30 bg-nv-bad/[0.07]">
              <p className="text-[11px] text-nv-bad leading-snug">The draft did not come back — {err.slice(0, 160)}</p>
              <p className="text-[10px] text-nv-faint leading-snug mt-1">
                You can still write the order yourself below and hand it over; nothing here depends on that draft.
              </p>
              <button
                onClick={() => { setState('ready'); setOrder((o) => (o.summary ? o : blankWorkOrder(step.action))); }}
                className="mt-1.5 text-[10px] px-2 py-0.5 rounded-md border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast"
              >Write it myself →</button>
            </div>
          )}

          {state === 'ready' && (
            <>
              <div>
                <label className={label}>What this actually means</label>
                <GrowText
                  value={order.summary} onChange={(v) => set('summary', v)}
                  min={3} max={340} className={`${field} mt-1`}
                  placeholder="What the task really is, in your situation."
                />
                {/* A plan's own detail arrives as one paragraph. Splitting it is the difference
                    between an order an agent can follow and a wall of text it will summarise. */}
                {order.steps.length === 0 && order.summary.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 15).length > 2 && (
                  <button
                    onClick={() => setOrder((o) => {
                      const parts = o.summary.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 15);
                      return { ...o, summary: parts[0] ?? o.summary, steps: parts.slice(1).slice(0, 8) };
                    })}
                    className="mt-1 text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast"
                  >Split this into steps →</button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className={label}>Steps — the actual job</label>
                  <button onClick={addStep} className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast">+ step</button>
                </div>
                <div className="mt-1 space-y-1">
                  {order.steps.length === 0 && (
                    <p className="text-[10px] text-nv-faint leading-snug">No steps yet. Add them, or hand it over on the description alone and let the team work them out.</p>
                  )}
                  {order.steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <span className="text-[9.5px] font-mono text-nv-faint mt-1.5 w-3.5 shrink-0 text-right">{i + 1}</span>
                      <GrowText
                        value={s} onChange={(v) => setStep(i, v)} min={2} max={200}
                        className={`${field} flex-1`}
                      />
                      <div className="flex flex-col gap-0.5 shrink-0 mt-0.5">
                        <button onClick={() => moveStep(i, -1)} disabled={i === 0}
                          className="text-[9px] px-1 leading-none py-0.5 rounded border border-nv-border text-nv-faint hover:text-nv-text disabled:opacity-30" aria-label="Move up">↑</button>
                        <button onClick={() => moveStep(i, 1)} disabled={i === order.steps.length - 1}
                          className="text-[9px] px-1 leading-none py-0.5 rounded border border-nv-border text-nv-faint hover:text-nv-text disabled:opacity-30" aria-label="Move down">↓</button>
                        <button onClick={() => delStep(i)}
                          className="text-[9px] px-1 leading-none py-0.5 rounded border border-nv-border text-nv-faint hover:text-nv-bad" aria-label="Remove step">×</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* WHO IT GETS SPLIT ACROSS.
                  "Write the one-liner, filter the sheet, smoke-test the install" is three people's
                  work. Handing all of it to whichever agent the router named first produced one
                  agent writing a document about all three and doing none of them — so the team is
                  named here, shown before you approve, and the instruction tells the boss to
                  delegate each part rather than answer the whole thing itself. */}
              <div>
                <label className={label}>Who it goes to</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {suggested.map((a) => {
                    const on = team.includes(a.key);
                    return (
                      <button
                        key={a.key}
                        onClick={() => setTeam((t) => (on ? t.filter((x) => x !== a.key) : [...t, a.key]))}
                        className={`text-[10px] px-1.5 py-0.5 rounded-md border transition-fast ${
                          on ? 'border-accent/50 bg-accent/10 text-accent' : 'border-nv-border text-nv-faint hover:text-nv-muted'
                        }`}
                      >{on ? '✓ ' : ''}{a.handle}</button>
                    );
                  })}
                  {suggested.length === 0 && (
                    <span className="text-[10px] text-nv-faint">No obvious specialist — the boss will pick.</span>
                  )}
                </div>
                <p className="text-[9.5px] text-nv-faint mt-1 leading-snug">
                  {team.length > 1
                    ? `Split across ${team.length} of them, one part each.`
                    : team.length === 1
                      ? `${suggested.find((a) => a.key === team[0])?.handle ?? team[0]} takes the whole thing.`
                      : 'Whoever the boss thinks fits.'}
                </p>
              </div>

              <div>
                <label className={label}>Done when</label>
                <input
                  value={order.doneWhen} onChange={(e) => set('doneWhen', e.target.value)}
                  placeholder="how you'll know it's finished"
                  className={`${field} mt-1`}
                />
              </div>

              <div>
                <label className={label}>What it will use</label>
                <input
                  value={order.uses.join('; ')}
                  onChange={(e) => set('uses', e.target.value.split(';').map((x) => x.trim()))}
                  placeholder="your lists, notes and apps — separated by semicolons"
                  className={`${field} mt-1`}
                />
                <p className="text-[9.5px] text-nv-faint mt-0.5 leading-snug">Check these are things you really have. A list named here that does not exist is the fastest way to get confident work on nothing.</p>
              </div>

              {/* THE QUESTIONS COME FIRST, NOT HALFWAY THROUGH. An agent that stops to ask on step
                  four has already done three steps on a guess. */}
              <div>
                <label className={label}>It should ask you first</label>
                <textarea
                  value={order.asks.join('\n')}
                  onChange={(e) => set('asks', e.target.value.split('\n'))}
                  rows={2} className={`${field} mt-1`}
                  placeholder="Decisions only you can make — one per line. Leave empty if there are none."
                />
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-nv-border shrink-0 flex flex-wrap items-center gap-1.5">
          <button
            disabled={!runnable}
            onClick={() => {
              const brief = formatWorkOrder(clean);
              onRun(workOrderInstruction(clean, step.action, step.day, suggested.filter((a) => team.includes(a.key))), brief);
            }}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/85 transition-fast disabled:opacity-40"
          >Hand it over →</button>
          <button
            disabled={state !== 'ready'}
            onClick={() => onSaveOnly(formatWorkOrder(clean))}
            className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast disabled:opacity-40"
          >Save the detail, don't start</button>
          <button onClick={onClose} className="text-[11px] px-2.5 py-1.5 rounded-lg text-nv-faint hover:text-nv-text transition-fast">Cancel</button>
          <p className="w-full text-[9.5px] text-nv-faint leading-snug mt-0.5">
            Nothing runs until you press <b>Hand it over</b>. Whatever you save here becomes this task's detail in the calendar.
          </p>
        </div>
      </div>
    </div>
  );
}
