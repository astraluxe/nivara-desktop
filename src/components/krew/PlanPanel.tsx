import { useEffect, useState } from 'react';
import {
  type ActionPlan, type PlanStep,
  loadPlan, savePlan, clearPlan, stepDate, isSameDay, todayView, planProgress, PLAN_EVENT,
  notesForDay, currentDay, setStepNote, setStepBrief, rescheduleOpenSteps, councilQuestionFor,
} from '../../lib/planStore';
import { todos } from '../../lib/todoStore';
import PlanCalendar from './PlanCalendar';
import TaskHandover from './TaskHandover';
import { routeTask, routeTeam } from '../../lib/taskRouting';
import { workOrderInstruction, parseWorkOrder, blankWorkOrder, deriveSteps } from '../../lib/workOrder';
import { AGENT_BY_KEY, KREW_AGENTS, agentHandle } from '../../lib/krewAgents';
import { loadAvailability, freeSlotsOn, to24h, describeAvailability, AVAIL_EVENT } from '../../lib/availability';

// ─── The plan you actually work through ──────────────────────────────────────
//
// A strategy answer is only worth anything if it turns into "what am I doing today". This is the
// same shape as the outreach copilot for the same reason: a long list of work needs its own panel,
// not a chat bubble you scroll past. Today's steps sit at the top because that is the only part
// that matters on any given morning; the rest is context.

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** YYYY-MM-DD in the user's OWN timezone. toISOString() is UTC, so an evening in IST comes back as
 *  the previous day — which would book every late step on the wrong date. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── The work order, drawn instead of written ────────────────────────────────
//
// The detail behind a task was a block of pre-wrapped prose. It is the most useful thing in the
// panel and nobody reads it, which makes it worth nothing — "reading all that is boring", and a
// 380px column of grey text is exactly the shape people skip.
//
// So it is drawn as what it actually is: an ordered handover. One row per stage, each saying who
// does it, what they do it with, and what comes out the other end — a note in the Brain, a file in
// the folder, a page saved, messages sent. Nothing here calls a model: parseWorkOrder already
// splits the order into steps, routeTask already knows who suits a step, and the outcome is read
// off the step's own wording. A panel should answer, not ask.

/**
 * What a step LEAVES BEHIND, read from how it is written. Null when it produces nothing lasting.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL. "Filter the sheet and keep the rows with an email" is a
 * list step that happens to contain the word "email"; checked in the wrong order it came out as
 * "messages ready to send", which is the opposite of what that day produces. So the specific
 * artefacts are tested first, and messaging last — and only when a sending verb is present.
 */
function outcomeOf(step: string): { label: string; tone: string } | null {
  const t = step.toLowerCase();
  if (/\bsave[sd]? (it |them |the )?(to|in|into) (the )?brain\b|\bsave_to_brain\b|\bbrain note\b/.test(t)) return { label: 'saved in your Brain', tone: '#7C5CFF' };
  if (/\b(video|youtube|short|reel|thumbnail|record|film)\b/.test(t)) return { label: 'a video, uploaded', tone: '#e15ba8' };
  if (/\b(pdf|one[- ]?pager|docx|deck|presentation|slides?)\b/.test(t)) return { label: 'a document you can send', tone: '#e0a317' };
  if (/\b(csv|xlsx?|spreadsheet)\b/.test(t)) return { label: 'a spreadsheet', tone: '#e0a317' };
  if (/\b(filter|qualif\w*|enrich\w*|verif\w*|research\w*|scrape|build (a|the) list|shortlist)\b/.test(t)) return { label: 'a list you can act on', tone: '#7C5CFF' };
  if (/\b(draft|write|send|reply|launch|sequence)\b/.test(t) && /\b(email|dm|message|outreach|whatsapp|linkedin)\b/.test(t)) return { label: 'messages ready to send', tone: '#2bb673' };
  if (/\b(publish|upload|post it|list(ed)? on|website|landing page)\b/.test(t)) return { label: 'published, link saved', tone: '#3f8cf5' };
  if (/\b(call|meeting|book|calendar|schedule)\b/.test(t)) return { label: 'in your calendar', tone: '#15b8c4' };
  return null;
}

/**
 * The agent the step NAMES, if it names one.
 *
 * The router is a guess from wording; a step that says "research_agent enriches the top 200 rows"
 * is not a guess, it is an instruction. Guessing over the top of it got that step assigned to
 * nobody at all, while the answer was written in the step itself.
 */
function agentNamedIn(step: string): string | undefined {
  const t = step.toLowerCase();
  const byKey = KREW_AGENTS.find((a) => a.key !== 'boss' && new RegExp(`\b${a.key}\b`).test(t));
  if (byKey) return byKey.key;
  const byHandle = KREW_AGENTS.find((a) => a.key !== 'boss' && t.includes(agentHandle(a).toLowerCase()));
  return byHandle?.key;
}

/** The one or two things a stage actually works WITH — named tools beat a generic sentence. */
function toolsFor(step: string): string[] {
  const r = routeTask(step);
  return (r?.tools ?? []).slice(0, 2).map((t) => t.name);
}

function WorkOrderFlow({ brief, action }: { brief: string; action: string }) {
  const order = parseWorkOrder(brief, action);
  // A brief with no recognisable steps is still worth drawing: derive them from its prose the same
  // way the pipeline does, so an order written as a paragraph is not left as a paragraph.
  const steps = order.steps.length ? order.steps : deriveSteps(order.summary || brief, 7);
  if (!steps.length) {
    return <p className="text-[10px] text-nv-muted leading-relaxed whitespace-pre-wrap mt-0.5">{brief}</p>;
  }
  return (
    <div className="mt-1">
      {order.summary.trim() && steps.length > 0 && order.summary.trim() !== brief.trim() && (
        <p className="text-[10px] text-nv-muted leading-relaxed mb-1.5">{order.summary.trim()}</p>
      )}
      <div className="flex flex-col">
        {steps.map((st, i) => {
          const who = agentNamedIn(st) ?? (routeTask(st)?.agents ?? [])[0];
          const agent = who ? AGENT_BY_KEY[who] : undefined;
          const out = outcomeOf(st);
          const tools = toolsFor(st);
          return (
            <div key={i} className="flex gap-1.5">
              {/* the spine — a number and the line joining it to the next stage */}
              <div className="flex flex-col items-center shrink-0 w-4">
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                  style={{ background: 'rgba(124,92,255,.16)', color: '#7C5CFF' }}
                >{i + 1}</span>
                {i < steps.length - 1 && <span className="flex-1 w-px my-0.5" style={{ background: 'var(--nv-border)' }} />}
              </div>
              <div className="min-w-0 flex-1 pb-2">
                <p className="text-[10.5px] text-nv-text leading-snug">{st}</p>
                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                  {agent && (
                    <span className="text-[9px] px-1.5 py-[1px] rounded-md border border-accent/30 bg-accent/[0.07] text-accent">
                      {agentHandle(agent)}
                    </span>
                  )}
                  {tools.map((t) => (
                    <span key={t} className="text-[9px] font-mono px-1.5 py-[1px] rounded-md border border-nv-border text-nv-faint">{t}</span>
                  ))}
                  {out && (
                    <span className="text-[9px] px-1.5 py-[1px] rounded-md" style={{ border: `1px solid ${out.tone}44`, color: out.tone }}>
                      → {out.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {order.uses.length > 0 && (
        <p className="text-[9.5px] text-nv-faint leading-snug mt-0.5">
          <span className="uppercase tracking-wide font-semibold">Works from </span>
          {order.uses.slice(0, 5).join(' · ')}
        </p>
      )}
      {order.doneWhen.trim() && (
        <p className="text-[9.5px] leading-snug mt-1 px-1.5 py-1 rounded-md"
          style={{ background: 'rgba(43,182,115,.08)', color: '#2bb673' }}>
          ✔ Finished when: {order.doneWhen.trim()}
        </p>
      )}
      {order.asks.length > 0 && (
        <p className="text-[9.5px] text-nv-muted leading-snug mt-1">
          <span className="uppercase tracking-wide font-semibold text-nv-faint">Needs you </span>
          {order.asks.slice(0, 3).join(' · ')}
        </p>
      )}
    </div>
  );
}

export default function PlanPanel({ onClose, onRunStep, onSchedule, onCouncil, onAskForPlan, onDraftBrief }: {
  onClose: () => void;
  /** Hand a step to Krew so it can actually DO it — with the browser, the apps, the lot. */
  onRunStep: (instruction: string) => void;
  /**
   * Ask an agent to draft the work order behind a task, streaming as it writes.
   *
   * The drafting lives in the chat component because that is where the model connection is; this
   * panel only decides WHEN to ask and shows the result for the user to edit.
   */
  onDraftBrief: (step: PlanStep, onDelta: (partial: string) => void) => Promise<string>;
  /** Ask Krew to put a set of steps in the real calendar. */
  onSchedule: (instruction: string) => void;
  /**
   * Convene the council DIRECTLY — not by sending a chat message that asks an agent to do it.
   * That indirection is what put an ops agent in front of the plan: it read a message full of
   * steps, decided this was work to delegate, and wrote its own five-voice review because it could
   * not run the tool. A button has to do the thing it says.
   */
  onCouncil: (question: string, asked?: string) => void;
  /** Write the first plan — a direct call with everything the app already knows, not a chat message. */
  onAskForPlan: (goal: string) => void;
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(() => loadPlan());
  const [showAll, setShowAll] = useState(false);
  // Which step's note box is open, and its unsaved text. One at a time: two open editors is how a
  // note gets written against the wrong task.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [note, setNote] = useState('');
  /** Which step has its detail open. One at a time — the panel is 380px wide. */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The task whose work order is being written and signed off. Nothing runs while this is open. */
  const [handover, setHandover] = useState<PlanStep | null>(null);
  const [view, setView] = useState<'list' | 'month'>('list');
  /** The "ask the council my own question" box: open, and what has been typed into it. */
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState('');
  /** What the user is trying to achieve — the only thing the plan writer cannot work out itself. */
  const [goal, setGoal] = useState('');

  const [avail, setAvail] = useState(() => loadAvailability());

  useEffect(() => {
    const on = () => setPlan(loadPlan());
    const onAvail = () => setAvail(loadAvailability());
    window.addEventListener(PLAN_EVENT, on);
    window.addEventListener(AVAIL_EVENT, onAvail);
    return () => { window.removeEventListener(PLAN_EVENT, on); window.removeEventListener(AVAIL_EVENT, onAvail); };
  }, []);

  // NOT A DEAD END. The header button is visible with no plan running, so this screen is something
  // people will walk into on purpose — it has to explain the feature AND offer the way in, rather
  // than describing a button the user cannot see from here.
  if (!plan) {
    return (
      <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-nv-surface border-l border-nv-border shadow-2xl flex flex-col animate-[slidein_.18s_ease-out] min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3.5 py-2.5 border-b border-nv-border shrink-0 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-nv-text leading-snug">Plan</p>
            <p className="text-[10px] text-nv-faint mt-0.5">Nothing running yet</p>
          </div>
          <button onClick={onClose} className="text-[13px] leading-none px-1 text-nv-faint hover:text-nv-text transition-fast" aria-label="Close">×</button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          <p className="text-[11.5px] text-nv-muted leading-relaxed">
            Ask an agent for a day-by-day plan and press <b>Start this plan</b> under its answer. From then on this
            panel shows what today's job is, keeps your To-do updated by date, and logs what actually got done —
            including anyone who asked for a meeting while you were in the copilot.
          </p>
          {/* THE ONE THING IT CANNOT KNOW IS WHAT YOU ARE TRYING TO DO. Everything else — the
              product note, the lists and their columns, the working hours, the campaigns already
              running — is already here, so the button asks for the goal and nothing else. */}
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="What are you trying to achieve? e.g. 20 paying clients on the ₹5k plan this month, non-tech companies of 50–200 people"
            className="mt-3 w-full rounded-lg px-2.5 py-2 text-[11px] bg-nv-bg border border-nv-border focus:border-accent outline-none text-nv-text resize-y"
          />
          <button
            onClick={() => { onAskForPlan(goal.trim()); onClose(); }}
            className="mt-2 w-full text-[11px] font-semibold px-3 py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast"
          >Ask for a plan →</button>
          <p className="text-[10px] text-nv-faint leading-relaxed mt-3">
            It already has your product note, your saved lists and their columns, the outreach you have
            running and the hours you work — so it will not ask you to type any of that out again. Leave the
            box empty and it will plan from what it can see.
          </p>
        </div>
      </div>
      </div>
    );
  }

  const { today, overdue } = todayView(plan);
  const prog = planProgress(plan);
  // Meetings first, then newest — a meeting request buried under twelve "messaged X" lines is a
  // meeting request the user misses.
  const log = notesForDay(plan, currentDay(plan))
    .sort((a, b) => (a.kind === 'meeting' ? 0 : 1) - (b.kind === 'meeting' ? 0 : 1) || b.at - a.at);

  const update = (fn: (p: ActionPlan) => void) => {
    const next: ActionPlan = JSON.parse(JSON.stringify(plan));
    fn(next);
    savePlan(next);
    setPlan(next);
  };

  const toggle = (id: string) => update((p) => {
    const s = p.steps.find((x) => x.id === id);
    if (s) { s.done = !s.done; s.doneAt = s.done ? Date.now() : undefined; }
  });

  /** Push the open steps into the To-do panel, dated, so they show up on the right day. */
  const sendToTodo = (steps: PlanStep[], label: string) => {
    let n = 0;
    for (const s of steps) {
      // sourceKey makes this idempotent — pressing it twice must not double the list.
      const made = todos.add(s.action, {
        dueAt: stepDate(plan, s).getTime(),
        priority: 'med',
        sourceKey: `plan:${plan.id}:${s.id}`,
      });
      if (made) n++;
    }
    setNote(n ? `Added ${n} task${n === 1 ? '' : 's'} to your To-do — ${label}.` : 'Those are already on your To-do.');
    setTimeout(() => setNote(''), 3500);
  };

  /**
   * The part of the original answer this step came from.
   *
   * Steps are parsed down to one line, which throws away the paragraph or table row that explained
   * them. The whole answer is kept on the plan, so find the line the step was taken from and hand
   * back what surrounds it — the deliverable column, the owner, the note in brackets. Falls back to
   * nothing rather than showing an unrelated chunk of text.
   */
  const stepContext = (s: PlanStep): string => {
    const src = plan.source || '';
    if (!src) return '';
    const needle = s.action.toLowerCase().slice(0, 30);
    const lines = src.split('\n');
    const i = lines.findIndex((l) => l.toLowerCase().includes(needle));
    if (i < 0) return '';
    const row = lines[i].trim();
    // A table row carries its own detail in the other cells — show them as labelled pairs, using
    // the table's real header so "Deliverable" says Deliverable and not "column 4".
    if (row.startsWith('|')) {
      const cells = row.split('|').map((c) => c.trim()).filter((c, ci, arr) => !(ci === 0 && !c) && !(ci === arr.length - 1 && !c));
      const hdrLine = lines.slice(0, i).reverse().find((l) => l.trim().startsWith('|') && /day|action|task/i.test(l));
      const hdr = hdrLine ? hdrLine.split('|').map((c) => c.trim()).filter(Boolean) : [];
      const out = cells
        .map((c, ci) => ({ k: hdr[ci] || '', v: c.replace(/\*\*/g, '').replace(/<br\s*\/?>/gi, ' · ').trim() }))
        .filter((x) => x.v && !/^\d{1,2}(-\d{1,2})?$/.test(x.v) && x.v.toLowerCase() !== needle.slice(0, x.v.length).toLowerCase())
        .map((x) => (x.k ? `${x.k}: ${x.v}` : x.v));
      return out.join('\n');
    }
    // Prose: the line plus whatever immediately follows it, which is usually the explanation.
    return lines.slice(i, i + 4).join('\n').trim().slice(0, 600);
  };

  const StepRow = ({ s, dim }: { s: PlanStep; dim?: boolean }) => {
    const d = stepDate(plan, s);
    const isToday = isSameDay(d, new Date());
    return (
      // TWO TASKS MUST NOT READ AS ONE. Rows were flush against each other with a transparent
      // border, so a day carrying three steps looked like a single paragraph of checkboxes and the
      // eye had nothing to separate them on. A gap and a faint surface on every row — not only
      // today's — is what makes the boundary visible.
      <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg mb-1.5 ${dim ? 'opacity-55' : ''} ${
        isToday && !s.done
          ? 'bg-accent/5 border border-accent/25'
          : 'bg-nv-bg/60 border border-nv-border/50'
      }`}>
        <button
          onClick={() => toggle(s.id)}
          aria-label={s.done ? 'Mark as not done' : 'Mark as done'}
          className={`mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-fast ${s.done ? 'bg-accent border-accent' : 'border-nv-border hover:border-accent'}`}
        >
          {s.done && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-[11.5px] leading-snug ${s.done ? 'line-through text-nv-faint' : 'text-nv-text'}`}>{s.action}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[9px] font-mono text-nv-faint">Day {s.day} · {fmtDate(d)}</span>
            {s.doneWhen && <span className="text-[9px] text-nv-faint">· done when: {s.doneWhen}</span>}
          </div>
          {/* THE DETAIL BEHIND THE TASK. "Rewrite homepage with new positioning (use pillars
              above)" is unusable on its own — the pillars ARE the task, and they were in the answer
              this step came from. The plan already keeps that answer, so the reasoning is one tap
              away instead of lost in a chat scroll. */}
          {expanded === s.id && (
            <div className="mt-1.5 p-2 rounded-lg bg-nv-bg border border-nv-border">
              {/* The agreed work order, when there is one — this is the DETAIL behind the title,
                  and it is the reason a task in the calendar is now something you can read rather
                  than a headline you have to remember the meaning of. */}
              {s.brief && (
                <div className="mb-2 pb-2 border-b border-nv-border">
                  <p className="text-[9px] font-semibold uppercase tracking-wide text-accent">
                    {s.handedOverAt ? 'The work order · handed over' : 'The work order'}
                  </p>
                  <WorkOrderFlow brief={s.brief} action={s.action} />
                </div>
              )}
              {stepContext(s) && (
                <p className="text-[10px] text-nv-muted leading-relaxed whitespace-pre-wrap">{stepContext(s)}</p>
              )}
              {/* WHO WOULD DO THIS, AND WITH WHAT.
                  Worked out from the task itself, with no model call — the user is reading a panel,
                  not asking a question, and a table answers "who makes decks" faster and more
                  reliably than a request would. Absent entirely when nothing matches: a confident
                  wrong name on a task that agent cannot do is worse than no suggestion, because it
                  will be acted on. */}
              {(() => {
                const r = routeTask(`${s.action} ${s.brief ?? ''}`);
                if (!r) return null;
                const named = r.agents.map((k) => AGENT_BY_KEY[k]).filter(Boolean);
                return (
                  <div className={s.brief || stepContext(s) ? 'mt-2 pt-2 border-t border-nv-border' : ''}>
                    {named.length > 0 && (
                      <>
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-nv-faint">Best suited — this task {r.why}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {named.map((a) => (
                            <span key={a.key} className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-accent/30 bg-accent/[0.07] text-accent">
                              {agentHandle(a)}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {r.tools.length > 0 && (
                      <>
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-nv-faint mt-2">What they will use</p>
                        <ul className="mt-0.5 space-y-0.5">
                          {r.tools.map((t) => (
                            <li key={t.name} className="text-[9.5px] text-nv-muted leading-snug">
                              <code className="text-[9px] font-mono text-nv-text">{t.name}</code> — {t.what}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                );
              })()}
              {/* THIS LINE HAS TO AGREE WITH WHAT IS ABOVE IT.
                  It used to read "No detail was written for this one" while sitting directly under
                  a list of suggested agents and tools — so the panel showed you detail and then
                  told you there wasn't any. Both halves were true and together they read as a bug.
                  What is above is INFERRED from the task's wording; what is missing is the written
                  work order. Saying which is which is the whole fix. */}
              {!s.brief && !stepContext(s) && (
                <p className="text-[10px] text-nv-faint leading-relaxed mt-2 pt-2 border-t border-nv-border">
                  {routeTask(s.action)
                    ? <>That is worked out from how the task is worded — nobody has written the real work order yet. </>
                    : <>Nothing has been written about this task yet. </>}
                  <b className="text-nv-text">Hand to Krew</b> drafts it — what it means for you, the steps, what it will use and what done looks like — for you to edit before anything runs.
                </p>
              )}
              <button
                onClick={() => onRunStep(`About this step in my plan: "${s.action}". Explain exactly what it means for MY situation and what "good" looks like — check what I have already done before you answer (my lead lists, my outreach progress, my Brain notes) rather than assuming I am starting fresh. Then offer to do the parts you can.`)}
                className="mt-1.5 text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast"
              >Ask Krew about this →</button>
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {/* HAND IT OVER — the office version of doing a task. It opens the work order for
                this job, drafted from the plan's own reasoning, and NOTHING runs until the user
                has read it, fixed it and pressed the button. "Do this with Krew" below is still
                here for when you just want an agent to get on with it. */}
            {!s.done && (
              <button
                onClick={() => setHandover(s)}
                className="text-[9.5px] font-medium px-1.5 py-0.5 rounded-md bg-accent/[0.12] border border-accent/50 text-accent hover:bg-accent/20 transition-fast"
              >{s.brief ? '⇄ Work order' : '⇄ Hand to Krew'}</button>
            )}
            {s.handedOverAt && (
              <span className="text-[9px] text-nv-faint" title={new Date(s.handedOverAt).toLocaleString()}>handed over</span>
            )}
            {/* SAME INSTRUCTION, JUST WITHOUT THE REVIEW STEP.
                This used to send a much thinner prompt than the handover did — so the quick button
                quietly got worse work, which is the opposite of what a shortcut should do. It now
                builds the identical work order from whatever the task already knows (its detail,
                its done-when, the agents that suit it) and skips only the part where you read it
                first. */}
            {!s.done && (
              <button
                onClick={() => {
                  const order = s.brief
                    ? parseWorkOrder(s.brief, s.action)
                    : { ...blankWorkOrder(s.action), doneWhen: s.doneWhen ?? '' };
                  if (s.doneWhen && !order.doneWhen) order.doneWhen = s.doneWhen;
                  // Routed per unit of work, exactly as the handover sheet does it. This button
                  // builds the SAME instruction, so it was quietly the last place left where one
                  // blob route picked the team — three writers for a task that needed an analyst
                  // and a tester, and then one of them did the lot.
                  const units = order.steps.filter((x) => x.trim());
                  const crew = routeTeam([s.action, ...(units.length ? units : deriveSteps(order.summary))])
                    .map((k) => AGENT_BY_KEY[k]).filter(Boolean)
                    .map((a) => ({ key: a.key, handle: agentHandle(a) }));
                  onRunStep(
                    `${workOrderInstruction(order, s.action, s.day, crew)}\n\n`
                    + 'Check what I have ALREADY done first — my outreach lists, my lead lists in the Brain, my LinkedIn — and pick up from there instead of starting over.',
                  );
                }}
                className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast"
              >Just do it →</button>
            )}
            <button
              onClick={() => setExpanded((v) => (v === s.id ? null : s.id))}
              className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast"
            >{expanded === s.id ? 'Hide detail' : 'Details'}</button>
            {/* YOUR OWN NOTE ON THIS TASK. What you tried, who you spoke to, what to remember —
                kept on the step, so it follows the task if the day moves and is still there when
                you come back to it a week later. Available on done steps too: what happened is
                usually worth writing down precisely when it is finished. */}
            <button
              onClick={() => { setNoteFor((v) => (v === s.id ? null : s.id)); setNoteDraft(s.note ?? ''); }}
              className={`text-[9.5px] px-1.5 py-0.5 rounded-md border transition-fast ${
                s.note ? 'border-accent/40 text-accent bg-accent/[0.07]' : 'border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2'
              }`}
            >{s.note ? '✎ Note' : '+ Note'}</button>
          </div>
          {s.note && noteFor !== s.id && (
            <p className="mt-1 text-[10px] text-nv-muted leading-relaxed whitespace-pre-wrap border-l-2 border-accent/30 pl-2">{s.note}</p>
          )}
          {noteFor === s.id && (
            <div className="mt-1.5">
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setNoteFor(null); }
                  // Ctrl/Cmd+Enter saves — a note is often several lines, so plain Enter must not.
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setStepNote(s.id, noteDraft); setNoteFor(null); setPlan(loadPlan()); }
                }}
                placeholder="What happened, what to remember, who to chase…"
                rows={3}
                className="w-full rounded-lg px-2 py-1.5 text-[11px] bg-nv-bg border border-nv-border focus:border-accent outline-none text-nv-text resize-y"
              />
              <div className="flex gap-1.5 mt-1">
                <button
                  onClick={() => { setStepNote(s.id, noteDraft); setNoteFor(null); setPlan(loadPlan()); }}
                  className="text-[9.5px] px-2 py-0.5 rounded-md bg-accent text-white hover:bg-accent-dim transition-fast"
                >Save note</button>
                <button
                  onClick={() => setNoteFor(null)}
                  className="text-[9.5px] px-2 py-0.5 rounded-md border border-nv-border text-nv-faint hover:bg-nv-surface2 transition-fast"
                >Cancel</button>
                {s.note && (
                  <button
                    onClick={() => { setStepNote(s.id, ''); setNoteFor(null); setPlan(loadPlan()); }}
                    className="text-[9.5px] px-2 py-0.5 rounded-md border border-nv-border text-nv-faint hover:text-red-500 transition-fast ml-auto"
                  >Delete</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const byWeek = new Map<number, PlanStep[]>();
  for (const s of plan.steps) {
    const w = s.week ?? Math.ceil(s.day / 7);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w)!.push(s);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-end bg-black/60 backdrop-blur-md" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-nv-surface border-l border-nv-border shadow-2xl flex flex-col animate-[slidein_.18s_ease-out] min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="px-3.5 py-2.5 border-b border-nv-border shrink-0">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-nv-text leading-snug">{plan.title}</p>
            <p className="text-[10px] text-nv-faint mt-0.5 font-mono">
              {prog.done}/{prog.total} done · started {fmtDate(new Date(plan.startDate + 'T09:00:00'))}
            </p>
          </div>
          <button onClick={onClose} className="text-[13px] leading-none px-1 text-nv-faint hover:text-nv-text transition-fast" aria-label="Close">×</button>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-nv-bg overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${prog.pct}%` }} />
        </div>
        {/* TWO WAYS TO READ THE SAME PLAN. The list answers "what now"; the month answers "what
            does this actually look like" — whether day 9 lands on a day off, whether three heavy
            steps stacked onto one Wednesday. You need both, but not at once. */}
        <div className="mt-2 flex gap-1">
          {(['list', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`text-[9.5px] px-2 py-0.5 rounded-full border transition-fast ${
                view === v ? 'border-accent bg-accent text-white' : 'border-nv-border text-nv-faint hover:bg-nv-surface2'
              }`}
            >{v === 'list' ? 'Today & steps' : 'Month'}</button>
          ))}
        </div>
        {/* ── IMPROVE THE PLAN YOU HAVE ─────────────────────────────────────────────────────
            Until now a plan could only be replaced. Both of these change it IN PLACE:
            "Refine" asks the agents to improve what is here — the merge keeps everything already
            ticked off — and "Ask the council" puts it in front of five advisers who disagree with
            each other, which is a different and more useful thing than one more opinion.
            Neither deletes a step; that is what makes them safe to press. */}
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => onRunStep(
              `Refine my existing plan "${plan.title}" — do NOT start a new one. Read the steps below, then give me an improved version of the SAME plan: sharpen anything vague, add what is missing, drop what is busywork, and keep the dates realistic. Return it as a dated step list so I can merge it in.\n\n${plan.steps.map((s) => `Day ${s.day}: ${s.action}${s.doneWhen ? ` (done when: ${s.doneWhen})` : ''}${s.done ? ' [DONE]' : ''}`).join('\n')}`,
            )}
            className="flex-1 text-[10px] px-2 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast font-medium"
          >✎ Refine this plan</button>
          <button
            onClick={() => {
              // The question itself lives in planStore, shared with /council — two entry points to
              // the same five advisers must not drift into asking two different questions.
              onCouncil(councilQuestionFor(plan));
              onClose();
            }}
            className="flex-1 text-[10px] px-2 py-1 rounded-lg border transition-fast font-medium"
            style={{ borderColor: '#e8a33d66', color: '#e8a33d' }}
          >⚖ Ask the council</button>
        </div>
        {/* THE COUNCIL, ABOUT THE THING YOU ACTUALLY WANT TO KNOW.
            "Is this the right plan?" gets a general review, which is the right default and the
            wrong tool when you have a specific worry — is 30 days enough, is the pricing wrong,
            should this be one market or three. Asked that way the panel answers the question AND
            says which days change, instead of restating the plan back at you. */}
        <div className="mt-1.5">
          {!askOpen ? (
            <button
              onClick={() => setAskOpen(true)}
              className="w-full text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-muted hover:text-nv-text hover:bg-nv-surface2 transition-fast font-medium"
            >⚖ Ask the council my own question…</button>
          ) : (
            <div className="rounded-lg border border-nv-border p-2">
              <textarea
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                autoFocus
                rows={2}
                placeholder="e.g. Is 30 days realistic with 3 hours a day? Should I charge per seat or per company?"
                className="w-full rounded-md px-2 py-1.5 text-[11px] bg-nv-bg border border-nv-border focus:border-accent outline-none text-nv-text resize-y"
              />
              <p className="text-[9.5px] text-nv-faint mt-1 leading-snug">
                They answer this against your plan, using what is actually in your Brain and how many days are really left — and say which days would change.
              </p>
              <div className="flex gap-1.5 mt-1.5">
                <button
                  disabled={askText.trim().length < 4}
                  onClick={() => {
                    // The typed question travels alongside the full brief so the chat can show
                    // what was ASKED rather than a canned "put my plan to the council" line.
                    onCouncil(councilQuestionFor(plan, askText), askText.trim());
                    setAskOpen(false);
                    setAskText('');
                    onClose();
                  }}
                  className="flex-1 text-[10px] px-2 py-1 rounded-lg border transition-fast font-medium disabled:opacity-40"
                  style={{ borderColor: '#e8a33d66', color: '#e8a33d' }}
                >Put it to the council →</button>
                <button
                  onClick={() => { setAskOpen(false); setAskText(''); }}
                  className="text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-faint hover:text-nv-text transition-fast"
                >Cancel</button>
              </div>
            </div>
          )}
        </div>
        {/* FIT THE REMAINING WORK TO THE DAYS YOU ACTUALLY HAVE.
            A plan written as Day 1…Day 30 has no idea which of those is a Sunday, or that four days
            already slipped — so the calendar stacks work on days off and grows a pile of overdue
            steps nobody will catch up on. This moves ONLY the open ones onto days you work, keeping
            their order. Finished steps are never touched: they are a record of what really happened
            on a real day, and rewriting that would make the plan lie about the past. */}
        {prog.done < prog.total && (
          <button
            onClick={() => {
              const next: ActionPlan = JSON.parse(JSON.stringify(plan));
              const r = rescheduleOpenSteps(next);
              setPlan(loadPlan());
              setNote(r.moved
                ? `Moved ${r.moved} unfinished step${r.moved === 1 ? '' : 's'} onto days you work — now running day ${r.firstDay}–${r.lastDay}. Your ${r.skippedDone} finished step${r.skippedDone === 1 ? '' : 's'} stayed exactly where they were.`
                : 'Everything unfinished is already on a day you work — nothing moved.');
              setTimeout(() => setNote(''), 6000);
            }}
            className="mt-1.5 w-full text-[10px] px-2 py-1 rounded-lg border border-nv-border text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast"
            title={avail ? 'Reschedules only unfinished steps around your working days' : 'Tell Krew your working hours first and this will also skip your days off'}
          >⇄ Refit the unfinished work to my available days</button>
        )}
      </div>

      {view === 'month' ? (
        <div className="flex-1 overflow-y-auto min-h-0 p-2.5">
          <PlanCalendar plan={plan} avail={avail} onRunStep={onRunStep} onHandOver={setHandover} />
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-3">
        {/* TODAY — the only part that matters this morning. */}
        <div>
          <p className="text-[9.5px] uppercase tracking-wide text-nv-faint mb-1 px-1">
            Today{today.length ? ` · ${today.length}` : ''}
          </p>
          {today.length === 0
            ? <p className="text-[10.5px] text-nv-faint px-1">Nothing scheduled for today. {prog.done === prog.total ? 'The whole plan is done.' : 'Pull something forward from below if you have time.'}</p>
            : today.map((s) => <StepRow key={s.id} s={s} />)}
        </div>

        {/* YOUR HOURS, SHOWN BACK TO YOU. Scheduling silently reads this, so it has to be visible
            and correctable — a wrong line here moves every event the plan books. */}
        <div className="px-1">
          {avail && avail.updatedAt ? (
            <p className="text-[9.5px] text-nv-faint leading-snug">
              Scheduling around: <span className="text-nv-muted">{describeAvailability(avail)}</span>.
              {' '}Say the correct hours in chat to change it.
            </p>
          ) : (
            <button
              onClick={() => onRunStep('Ask me when I am usually free and busy each week, then save it with set_availability so nothing gets booked over my working hours.')}
              className="text-[9.5px] text-nv-faint hover:text-accent transition-fast text-left leading-snug"
            >Tell me your working hours once → nothing gets booked over them again.</button>
          )}
        </div>

        {/* WHAT ACTUALLY HAPPENED. The copilot writes here as outreach goes out, so this is the
            one place that knows both what was planned and what was really done. Meetings float to
            the top because a request to meet decays fast if it sits unanswered. */}
        {log.length > 0 && (
          <div>
            <p className="text-[9.5px] uppercase tracking-wide text-nv-faint mb-1 px-1">Today's log · {log.length}</p>
            {log.map((n) => (
              <div key={n.id} className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg mb-0.5 ${n.kind === 'meeting' ? 'bg-teal-600/10 border border-teal-600/30' : 'border border-transparent'}`}>
                <span className={`text-[9px] font-mono mt-px shrink-0 ${n.kind === 'meeting' ? 'text-teal-600' : 'text-nv-faint'}`}>
                  {n.kind === 'meeting' ? '★' : n.kind === 'outreach' ? '→' : '·'}
                </span>
                <p className="text-[10.5px] text-nv-text leading-snug min-w-0 flex-1">
                  {n.kind === 'meeting' && n.who ? <strong>{n.who} </strong> : null}
                  {n.text}
                </p>
                <span className="text-[9px] text-nv-faint shrink-0 mt-px">
                  {new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}

        {overdue.length > 0 && (
          <div>
            <p className="text-[9.5px] uppercase tracking-wide text-amber-600 mb-1 px-1">Still open · {overdue.length}</p>
            {overdue.map((s) => <StepRow key={s.id} s={s} />)}
            <p className="text-[9.5px] text-nv-faint px-1 mt-1 leading-snug">
              Behind is normal. Tick what you did, and drop what stopped mattering — a plan you are lying to is worse than no plan.
            </p>
          </div>
        )}

        <div>
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full text-left text-[9.5px] uppercase tracking-wide text-nv-faint mb-1 px-1 hover:text-nv-text transition-fast"
          >{showAll ? '▾' : '▸'} The whole plan · {plan.steps.length} steps</button>
          {showAll && [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([w, steps]) => (
            <div key={w} className="mb-2">
              <p className="text-[9.5px] font-mono text-nv-faint px-1 mb-0.5">Week {w}</p>
              {steps.map((s) => <StepRow key={s.id} s={s} dim={s.done} />)}
            </div>
          ))}
        </div>
      </div>
      )}

      {note && <p className="px-3 py-1.5 text-[10px] text-accent border-t border-nv-border shrink-0">{note}</p>}

      <div className="px-2.5 py-2.5 border-t border-nv-border shrink-0 flex flex-wrap gap-1.5">
        <button
          onClick={() => sendToTodo(today.length ? today : plan.steps.filter((s) => !s.done).slice(0, 7), today.length ? "today's steps" : 'the next few steps')}
          className="text-[10.5px] px-2.5 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent-dim transition-fast"
        >Add to To-do</button>
        <button
          onClick={() => {
            const open = plan.steps.filter((s) => !s.done).slice(0, 10);
            if (!open.length) { setNote('Nothing left to schedule.'); setTimeout(() => setNote(''), 3000); return; }
            // Every step used to be pinned to 10:00 — which is inside most people's working
            // block, so the plan booked itself straight over the day job. Place each one in a
            // stretch the user is actually free, rolling forward past days they do not work.
            const avail = loadAvailability();
            const lines: string[] = [];
            const bumped: string[] = [];
            for (const s of open) {
              const want = stepDate(plan, s);
              let when = want;
              let time = '10:00';
              if (avail && avail.updatedAt) {
                let found = false;
                for (let i = 0; i < 14 && !found; i++) {
                  const d = new Date(want);
                  d.setDate(d.getDate() + i);
                  const slots = freeSlotsOn(avail, d, 60);
                  if (slots.length) { when = d; time = to24h(slots[0].start); found = true; }
                }
                if (!found) continue;                    // genuinely no room — say so rather than double-book
                if (when.getTime() !== want.getTime()) bumped.push(s.action.slice(0, 40));
              }
              lines.push(`- ${localISO(when)} at ${time} — ${s.action}`);
            }
            if (!lines.length) {
              setNote('Your saved hours leave no free 60-minute slot in the next two weeks. Update them and try again.');
              setTimeout(() => setNote(''), 6000);
              return;
            }
            onSchedule(
              'Put these plan steps in my calendar with create_calendar_event — one event each, 60 minutes, at exactly the date and time given. These times are already checked against my working hours, so use them as they are and do not pick your own:\n'
              + lines.join('\n')
              + '\nCreate them, then tell me which ones you created.',
            );
            if (bumped.length) {
              setNote(`${bumped.length} step${bumped.length === 1 ? '' : 's'} moved to the next day you're free.`);
              setTimeout(() => setNote(''), 5000);
            }
          }}
          className="text-[10.5px] px-2.5 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast"
        >Put in calendar</button>
        <button
          onClick={() => { if (confirm('Drop this plan? Your To-do items stay.')) { clearPlan(); setPlan(null); onClose(); } }}
          className="ml-auto text-[10.5px] px-2 py-1.5 rounded-lg text-nv-faint hover:text-nv-text transition-fast"
        >Drop plan</button>
      </div>
      </div>
      {handover && (
        <TaskHandover
          step={handover}
          planTitle={plan.title}
          draft={(onDelta) => onDraftBrief(handover, onDelta)}
          onRun={(instruction, brief) => {
            // Saved BEFORE it is sent. If the run fails, times out or the user stops it, the work
            // order they just spent five minutes agreeing is still on the task.
            setStepBrief(handover.id, brief, true);
            setPlan(loadPlan());
            setHandover(null);
            onRunStep(instruction);
          }}
          onSaveOnly={(brief) => {
            setStepBrief(handover.id, brief);
            setPlan(loadPlan());
            setHandover(null);
            setNote('Saved as this task\'s detail. It shows in the calendar and is ready to hand over whenever you are.');
            setTimeout(() => setNote(''), 6000);
          }}
          onClose={() => setHandover(null)}
        />
      )}
    </div>
  );
}
