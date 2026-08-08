import { useEffect, useState } from 'react';
import {
  type ActionPlan, type PlanStep,
  loadPlan, savePlan, clearPlan, stepDate, isSameDay, todayView, planProgress, PLAN_EVENT,
  notesForDay, currentDay, setStepNote, setStepBrief, rescheduleOpenSteps, councilQuestionFor,
} from '../../lib/planStore';
import { todos } from '../../lib/todoStore';
import PlanCalendar from './PlanCalendar';
import TaskHandover from './TaskHandover';
import { routeTask } from '../../lib/taskRouting';
import { AGENT_BY_KEY, agentHandle } from '../../lib/krewAgents';
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

export default function PlanPanel({ onClose, onRunStep, onSchedule, onCouncil, onDraftBrief }: {
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
  onCouncil: (question: string) => void;
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
          <button
            onClick={() => onRunStep('Write me a day-by-day action plan I can actually work through. Ask me anything you need about my business, my goal and how much time I have each day before you write it. Lay it out as "Day 1: …", "Day 2: …" with one concrete action per day and how I know it is finished.')}
            className="mt-3 w-full text-[11px] font-semibold px-3 py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast"
          >Ask for a plan →</button>
          <p className="text-[10px] text-nv-faint leading-relaxed mt-3">
            It will ask about your goal first rather than guessing — a plan built on the wrong assumption wastes
            the whole month.
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
      <div className={`flex items-start gap-2 px-2.5 py-2 rounded-lg ${dim ? 'opacity-55' : ''} ${isToday && !s.done ? 'bg-accent/5 border border-accent/25' : 'border border-transparent'}`}>
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
                  <p className="text-[10px] text-nv-muted leading-relaxed whitespace-pre-wrap mt-0.5">{s.brief}</p>
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
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-nv-faint">Best suited — {r.why}</p>
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
              {!s.brief && !stepContext(s) && (
                <p className="text-[10px] text-nv-faint leading-relaxed mt-2">
                  No detail was written for this one. <b className="text-nv-text">Hand to Krew</b> drafts the full work order — what it means, the steps, and what done looks like — for you to edit before anything runs.
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
            {!s.done && (
              <button
                onClick={() => onRunStep(`Help me do this step from my plan, and actually do the parts you can: "${s.action}".${s.doneWhen ? ` It counts as finished when: ${s.doneWhen}.` : ''} Check what I have ALREADY done first — my outreach list, my lead lists in the Brain, my LinkedIn — and pick up from there instead of starting over. Use your tools (browser, files, calendar, connected apps) rather than just telling me how.`)}
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
