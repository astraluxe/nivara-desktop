import { useEffect, useState } from 'react';
import {
  type ActionPlan, type PlanStep,
  loadPlan, savePlan, clearPlan, stepDate, isSameDay, todayView, planProgress, PLAN_EVENT,
  notesForDay, currentDay,
} from '../../lib/planStore';
import { todos } from '../../lib/todoStore';
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

export default function PlanPanel({ onClose, onRunStep, onSchedule }: {
  onClose: () => void;
  /** Hand a step to Krew so it can actually DO it — with the browser, the apps, the lot. */
  onRunStep: (instruction: string) => void;
  /** Ask Krew to put a set of steps in the real calendar. */
  onSchedule: (instruction: string) => void;
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(() => loadPlan());
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState('');

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
      <div className="w-[380px] shrink-0 border-l border-nv-border bg-nv-surface flex flex-col min-h-0">
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
          {!s.done && (
            <button
              onClick={() => onRunStep(`Help me do this step from my plan, and actually do the parts you can: "${s.action}".${s.doneWhen ? ` It counts as finished when: ${s.doneWhen}.` : ''} Use your tools — browser, files, calendar, connected apps — rather than just telling me how.`)}
              className="mt-1 text-[9.5px] px-1.5 py-0.5 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-fast"
            >Do this with Krew →</button>
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
    <div className="w-[380px] shrink-0 border-l border-nv-border bg-nv-surface flex flex-col min-h-0">
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
      </div>

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
  );
}
