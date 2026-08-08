import { useState } from 'react';
import { type ActionPlan, type PlanStep, stepDate, notesForDay } from '../../lib/planStore';
import { type Availability, freeSlotsOn, isOffDay, fmtMins, describeAvailability } from '../../lib/availability';
import { todos, type TodoItem } from '../../lib/todoStore';

// ─── The month, at a glance ──────────────────────────────────────────────────
//
// A list of steps answers "what is next"; it does not answer "what does my month look like", which
// is the question you actually ask before committing to anything. Without a grid there is no way to
// see that day 9 lands on a Sunday you do not work, or that three heavy steps stacked onto one
// Wednesday, until the day arrives and it is too late to move them.
//
// Everything drawn here is real: plan steps on their computed dates, the user's own busy pattern,
// their To-do items, and whatever the copilot logged. Nothing is inferred and nothing is invented —
// a calendar that shows a meeting the user does not have is worse than no calendar.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function sameYMD(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function PlanCalendar({ plan, avail, onRunStep, onHandOver }: {
  plan: ActionPlan;
  avail: Availability | null;
  /** Hand something to Krew — used by the day detail so a day is actionable, not just readable. */
  onRunStep: (instruction: string) => void;
  /** Open the work order for one task, so it can be agreed before anyone starts it. */
  onHandOver?: (step: PlanStep) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState<Date | null>(today);

  // Steps bucketed by date so a cell is one lookup rather than a scan of the whole plan.
  const byDate = new Map<string, PlanStep[]>();
  for (const s of plan.steps) {
    const d = stepDate(plan, s);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(s);
  }
  const stepsOn = (d: Date) => byDate.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) || [];

  const allTodos: TodoItem[] = (() => { try { return todos.all(); } catch { return []; } })();
  const todosOn = (d: Date) => allTodos.filter((t) => t.dueAt && sameYMD(new Date(t.dueAt), d));

  // Leading blanks so the 1st lands under its real weekday.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const dayFree = (d: Date) => {
    if (!avail || !avail.updatedAt) return null;
    if (isOffDay(avail, d)) return 'off';
    const slots = freeSlotsOn(avail, d, 30);
    return slots.length ? 'free' : 'full';
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 px-1">
        <button onClick={() => shift(-1)} aria-label="Previous month"
          className="text-[11px] leading-none px-1.5 py-1 rounded text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast">‹</button>
        <p className="text-[10.5px] font-semibold text-nv-text flex-1 text-center">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
        <button onClick={() => shift(1)} aria-label="Next month"
          className="text-[11px] leading-none px-1.5 py-1 rounded text-nv-faint hover:text-nv-text hover:bg-nv-surface2 transition-fast">›</button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 px-1">
        {DOW.map((d, i) => (
          <div key={i} className="text-[8.5px] text-nv-faint text-center py-0.5">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const steps = stepsOn(d);
          const open = steps.filter((s) => !s.done).length;
          const done = steps.length - open;
          const isToday = sameYMD(d, today);
          const isPicked = picked && sameYMD(d, picked);
          const fr = dayFree(d);
          return (
            <button
              key={i}
              onClick={() => setPicked(d)}
              title={`${d.toDateString()}${steps.length ? ` — ${steps.length} step${steps.length === 1 ? '' : 's'}` : ''}${fr === 'off' ? ' — you do not work this day' : ''}`}
              className={`relative aspect-square rounded flex flex-col items-center justify-center transition-fast border ${
                isPicked ? 'border-accent bg-accent/15'
                : isToday ? 'border-accent/50 bg-accent/5'
                : fr === 'off' ? 'border-transparent bg-nv-bg/60'
                : 'border-transparent hover:bg-nv-surface2'
              }`}
            >
              <span className={`text-[9.5px] leading-none ${
                fr === 'off' ? 'text-nv-faint/60' : isToday ? 'text-accent font-bold' : 'text-nv-text'
              }`}>{d.getDate()}</span>
              {/* One dot per open step, capped at three — beyond that the number is what matters,
                  not the exact count, and four dots in a 30px cell is unreadable. */}
              {steps.length > 0 && (
                <span className="flex gap-[1.5px] mt-[2px]">
                  {open > 0 && Array.from({ length: Math.min(open, 3) }, (_, k) => (
                    <span key={k} className="w-[3px] h-[3px] rounded-full bg-accent" />
                  ))}
                  {open === 0 && done > 0 && <span className="w-[3px] h-[3px] rounded-full bg-nv-green" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* THE DAY YOU TAPPED. This is the point of the grid — seeing what a date actually holds
          before you agree to anything on it. */}
      {picked && (() => {
        const steps = stepsOn(picked);
        const dayTodos = todosOn(picked);
        const fr = dayFree(picked);
        const slots = avail && avail.updatedAt && fr !== 'off' ? freeSlotsOn(avail, picked, 30) : [];
        const planDay = Math.round((picked.getTime() - new Date(plan.startDate + 'T00:00:00').getTime()) / 86400000) + 1;
        const notes = planDay >= 1 ? notesForDay(plan, planDay) : [];
        return (
          <div className="mt-2 mx-1 p-2.5 rounded-lg border border-nv-border bg-nv-bg">
            <div className="flex items-baseline gap-1.5 mb-1">
              <p className="text-[11px] font-semibold text-nv-text">
                {picked.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              {planDay >= 1 && planDay <= 400 && <span className="text-[9px] font-mono text-nv-faint">day {planDay}</span>}
            </div>

            {/* When you are free, in your own words. */}
            <p className="text-[9.5px] text-nv-faint mb-1.5">
              {fr === 'off' ? "You don't work this day."
                : fr === 'full' ? 'Fully booked under your usual hours.'
                : slots.length ? `Free ${slots.map((s) => `${fmtMins(s.start)}–${fmtMins(s.end)}`).join(', ')}.`
                : 'No working hours saved — tell Krew when you\'re usually free and this fills in.'}
            </p>

            {steps.length === 0 && dayTodos.length === 0 && notes.length === 0 && (
              <p className="text-[10px] text-nv-faint">Nothing planned. {fr === 'free' ? 'Room to pull something forward.' : ''}</p>
            )}

            {steps.map((s) => (
              <div key={s.id} className="flex items-start gap-1.5 mb-1.5">
                <span className={`mt-[3px] w-1.5 h-1.5 rounded-full shrink-0 ${s.done ? 'bg-nv-green' : 'bg-accent'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-[10.5px] leading-snug ${s.done ? 'line-through text-nv-faint' : 'text-nv-text'}`}>{s.action}</p>
                  {s.doneWhen && <p className="text-[9px] text-nv-faint leading-snug">done when: {s.doneWhen}</p>}
                  {/* THE DETAIL, ON THE DAY. A calendar showing only titles means opening the plan
                      panel to remember what "publish the comparison page" was supposed to be. Once a
                      work order exists for a task, the day itself can answer that. */}
                  {s.brief && (
                    <details className="mt-0.5">
                      <summary className="text-[9px] text-accent cursor-pointer select-none">
                        {s.handedOverAt ? 'Work order · handed over' : 'Work order'}
                      </summary>
                      <p className="text-[9.5px] text-nv-muted leading-relaxed whitespace-pre-wrap mt-0.5 pl-1.5 border-l border-accent/30">{s.brief}</p>
                    </details>
                  )}
                  {!s.done && onHandOver && (
                    <button
                      onClick={() => onHandOver(s)}
                      className="mt-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-accent/[0.12] border border-accent/50 text-accent hover:bg-accent/20 transition-fast"
                    >{s.brief ? '⇄ Work order' : '⇄ Hand to Krew'}</button>
                  )}
                </div>
              </div>
            ))}

            {/* To-dos that are NOT plan steps — anything else you dated onto this day. */}
            {dayTodos.filter((t) => !t.sourceKey?.startsWith(`plan:${plan.id}`)).map((t) => (
              <div key={t.id} className="flex items-start gap-1.5 mb-1">
                <span className="mt-[3px] w-1.5 h-1.5 rounded-full bg-nv-faint shrink-0" />
                <p className={`text-[10.5px] leading-snug ${t.done ? 'line-through text-nv-faint' : 'text-nv-muted'}`}>{t.text}</p>
              </div>
            ))}

            {/* Meetings and outreach the copilot logged for that day — including the Meet link,
                which is the one thing you need at the moment the meeting starts. */}
            {notes.map((n) => (
              <div key={n.id} className={`mt-1 px-2 py-1 rounded ${n.kind === 'meeting' ? 'bg-teal-600/10 border border-teal-600/25' : ''}`}>
                <p className="text-[10px] leading-snug text-nv-text">
                  {n.kind === 'meeting' ? '★ ' : '· '}{n.who ? <b>{n.who} </b> : null}{n.text}
                </p>
                {/(https?:\/\/\S+)/.test(n.text) && (
                  <a href={n.text.match(/(https?:\/\/\S+)/)![1]} target="_blank" rel="noreferrer"
                    className="text-[9.5px] text-accent hover:underline">Open link →</a>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-1 mt-1.5">
              {steps.some((s) => !s.done) && (
                <button
                  onClick={() => onRunStep(`Help me get through everything on my plan for ${picked.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}: ${steps.filter((s) => !s.done).map((s) => `"${s.action}"`).join(', ')}. Check what I have already done first — my outreach list, my lead lists, my Brain — and pick up from there. Do the parts you can rather than describing them.`)}
                  className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-accent/40 text-accent hover:bg-accent/10 transition-fast"
                >Work on this day →</button>
              )}
              <button
                onClick={() => onRunStep(`Book something in my calendar on ${picked.getFullYear()}-${String(picked.getMonth() + 1).padStart(2, '0')}-${String(picked.getDate()).padStart(2, '0')}. ${slots.length ? `I am free ${slots.map((s) => `${fmtMins(s.start)}–${fmtMins(s.end)}`).join(', ')} that day — pick a time inside that and nowhere else.` : avail && avail.updatedAt ? `Careful: my usual pattern is ${describeAvailability(avail)}, and that day looks full — tell me rather than booking over something.` : 'Ask me what time suits before you create anything.'} Ask me what the event is for first if you do not already know.`)}
                className="text-[9.5px] px-1.5 py-0.5 rounded-md border border-nv-border text-nv-muted hover:bg-nv-surface2 transition-fast"
              >Book on this day →</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
