// ─── Turning a strategy answer into something you actually work through ──────
//
// Agents write genuinely good 30-day plans — "Day 1: finalise positioning, Day 2: record 3 demo
// videos, Day 8: post video #1" — and then the plan sits in a chat bubble and dies there. Reading
// it is not doing it. Nothing tells you what today's job is, nothing remembers what you finished,
// and by day four it has scrolled out of sight.
//
// This parses that answer into dated, tickable steps. Deliberately conservative: it only claims to
// have found a plan when the text really is one (several numbered days with actions attached), so
// an ordinary answer that happens to mention "day 2" never sprouts a button.

import { todos } from './todoStore';

export interface PlanStep {
  id: string;
  /** 1-based day number as written in the plan. */
  day: number;
  /** Week heading it sat under, when the plan had them. */
  week?: number;
  action: string;
  /** The plan's own definition of finished ("Videos in Drive"), when it gave one. */
  doneWhen?: string;
  done: boolean;
  doneAt?: number;
}

export interface ActionPlan {
  id: string;
  title: string;
  /** ISO date the plan starts — day 1. Chosen by the user, defaults to today. */
  startDate: string;
  createdAt: number;
  steps: PlanStep[];
  /** The answer it came from, so the panel can show the reasoning behind a step. */
  source: string;
  /** The running log — see PlanNote. Optional so plans saved before this existed still load. */
  notes?: PlanNote[];
}

/**
 * Anything that happened while working the plan and is worth remembering tomorrow.
 *
 * The plan is where the user looks to find out where things stand, so the copilot writes back into
 * it: how many people were messaged today, and — the one that actually matters — who asked for a
 * meeting. That used to live only in the copilot, which is a per-campaign panel the user closes;
 * a meeting request found on Tuesday was invisible by Thursday.
 */
export interface PlanNote {
  id: string;
  /** Plan day it belongs to. */
  day: number;
  at: number;
  kind: 'outreach' | 'meeting' | 'reply' | 'note';
  text: string;
  /** Who it concerns, when it is about a person. */
  who?: string;
}

const KEY = 'nv-action-plan-v1';
export const PLAN_EVENT = 'nv-plan-changed';

function uid(): string { return 'ps-' + Math.random().toString(36).slice(2, 9); }

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** "1", "6–7", "28-30", "Day 3" → the first day number, or null. */
function dayOf(cell: string): number | null {
  const m = (cell || '').replace(/–|—/g, '-').match(/(?:day\s*)?(\d{1,2})\s*(?:-\s*\d{1,2})?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 120 ? n : null;
}

function splitRow(line: string): string[] {
  let c = line.split('|').map((x) => x.trim());
  if (c.length && c[0] === '') c = c.slice(1);
  if (c.length && c[c.length - 1] === '') c = c.slice(0, -1);
  return c;
}

const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l.trim()) && l.includes('-');

/** Strip markdown decoration so a step reads as a plain instruction. */
function clean(s: string): string {
  return (s || '')
    .replace(/<br\s*\/?>/gi, ' · ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull dated steps out of a strategy answer.
 *
 * Handles the two shapes agents actually produce: a table with a Day column (the common one, often
 * under "### Week 2:" headings), and plain lines like "Day 3 — DM 10 ICP founders". Rows whose
 * action is empty or is obviously filler ("Rest / review", "Buffer") are kept, because a plan that
 * silently drops its rest days is lying about the workload.
 */
export function parsePlanSteps(text: string): PlanStep[] {
  const lines = (text || '').split('\n');
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  let week: number | undefined;
  let dayCol = -1;
  let actionCol = -1;
  let doneCol = -1;

  for (const raw of lines) {
    const line = raw.trim();

    const wk = line.match(/^#{1,6}\s*week\s*(\d+)/i) || line.match(/^\*\*week\s*(\d+)/i);
    if (wk) { week = Number(wk[1]); dayCol = -1; continue; }

    if (line.startsWith('|')) {
      const cells = splitRow(line);
      if (isSep(line)) continue;
      // A header row tells us which column is which — and resets when a new table starts.
      const lower = cells.map((c) => c.toLowerCase());
      const dIdx = lower.findIndex((c) => /^day$|^days$|^when$/.test(c));
      if (dIdx >= 0) {
        dayCol = dIdx;
        actionCol = lower.findIndex((c) => /action|task|what|activity|focus/.test(c));
        if (actionCol < 0) actionCol = dayCol === 0 ? 1 : 0;
        doneCol = lower.findIndex((c) => /done when|success|output|deliverable|complete/.test(c));
        continue;
      }
      if (dayCol < 0 || cells.length <= dayCol) continue;
      const day = dayOf(cells[dayCol]);
      if (day == null) continue;
      const action = clean(cells[actionCol] ?? '');
      if (!action || action === '—' || action === '-') continue;
      const key = day + '|' + action.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push({
        id: uid(), day, week, action,
        doneWhen: doneCol >= 0 ? clean(cells[doneCol] ?? '') || undefined : undefined,
        done: false,
      });
      continue;
    }

    // "Day 3: post video #2" / "- Day 12 — comment on 15 posts"
    const bullet = line.match(/^[-•*]?\s*\**day\s*(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\**\s*[:—–-]\s*(.+)$/i);
    if (bullet) {
      const day = Number(bullet[1]);
      const action = clean(bullet[2]);
      if (day >= 1 && day <= 120 && action.length > 3) {
        const key = day + '|' + action.toLowerCase().slice(0, 40);
        if (!seen.has(key)) { seen.add(key); steps.push({ id: uid(), day, week, action, done: false }); }
      }
    }
  }

  return steps.sort((a, b) => a.day - b.day);
}

/**
 * Is this answer a plan worth offering to schedule?
 *
 * Three separate days minimum, spanning more than one. One "Day 1: think about it" in a paragraph
 * is not a plan, and putting a button under every answer that says "day" would train the user to
 * ignore the button.
 */
export function looksLikeActionPlan(text: string): boolean {
  if (!text || text.length < 300) return false;
  const steps = parsePlanSteps(text);
  if (steps.length < 3) return false;
  return new Set(steps.map((s) => s.day)).size >= 3;
}

/** A title for the plan, taken from the answer's own heading when it has a usable one. */
export function derivePlanTitle(text: string): string {
  const h = (text || '').split('\n')
    .map((l) => l.trim())
    .find((l) => /^#{1,3}\s+\S/.test(l) && l.length < 90 && !/^#{1,3}\s*(research question|key findings)/i.test(l));
  const t = h ? clean(h.replace(/^#{1,3}\s*/, '')) : '';
  return t || 'Action plan';
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export function loadPlan(): ActionPlan | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ActionPlan;
    return p && Array.isArray(p.steps) ? p : null;
  } catch { return null; }
}

export function savePlan(p: ActionPlan): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* quota */ }
  try { window.dispatchEvent(new Event(PLAN_EVENT)); } catch { /* no window */ }
}

export function clearPlan(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(PLAN_EVENT)); } catch { /* no window */ }
}

export function createPlan(source: string, startDate?: string): ActionPlan {
  const d = startDate ?? new Date().toISOString().slice(0, 10);
  return {
    id: 'plan-' + Date.now().toString(36),
    title: derivePlanTitle(source),
    startDate: d,
    createdAt: Date.now(),
    steps: parsePlanSteps(source),
    source,
  };
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/** The real calendar date a step falls on — day 1 is the start date. */
export function stepDate(plan: ActionPlan, step: PlanStep): Date {
  const d = new Date(plan.startDate + 'T09:00:00');
  d.setDate(d.getDate() + (step.day - 1));
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Steps due today, and anything still open from before it — the two things you act on. */
export function todayView(plan: ActionPlan): { today: PlanStep[]; overdue: PlanStep[] } {
  const now = new Date();
  const today: PlanStep[] = [];
  const overdue: PlanStep[] = [];
  for (const s of plan.steps) {
    if (s.done) continue;
    const d = stepDate(plan, s);
    if (isSameDay(d, now)) today.push(s);
    else if (d < now) overdue.push(s);
  }
  return { today, overdue };
}

/**
 * Fold a revised plan back into the one already running.
 *
 * When an agent reworks a plan ("push the launch to week 3", "add a partner track"), starting over
 * would throw away every step the user has already ticked off — so the sensible action is a merge,
 * not a replace. Steps already present on the same day with the same action are left exactly as
 * they are, including their done state; genuinely new ones are added. Returns how many were added.
 */
export function mergeIntoPlan(plan: ActionPlan, text: string): { added: number; updated: number; kept: number } {
  const incoming = parsePlanSteps(text);
  if (!incoming.length) return { added: 0, updated: 0, kept: plan.steps.length };
  const norm = (a: string) => a.toLowerCase().replace(/\s+/g, ' ').trim();
  let added = 0, updated = 0;
  // Tracked separately from `updated`: filling in a missing "done when" is worth PERSISTING but is
  // not a change the user needs to be told about, and it must not be reported as a reworded step.
  let enriched = false;

  for (const s of incoming) {
    const sameDay = plan.steps.filter((x) => x.day === s.day);
    const identical = sameDay.find((x) => norm(x.action) === norm(s.action));
    if (identical) {
      // Unchanged. Leave it completely alone — including its tick and the date it was ticked.
      // A "done when" the new plan spells out more clearly is still worth taking.
      if (s.doneWhen && !identical.doneWhen) { identical.doneWhen = s.doneWhen; enriched = true; }
      continue;
    }
    // A REWORDED STEP IS A REVISION, NOT A NEW ONE. If that day has an open step and the new plan
    // gives exactly one action for the same day, the user asked for a refinement — so rewrite the
    // step in place rather than leaving the old wording sitting next to the new one, which is how
    // a "refined" plan ends up with two contradictory instructions for the same morning.
    const openSameDay = sameDay.filter((x) => !x.done);
    const oneEach = openSameDay.length === 1 && incoming.filter((x) => x.day === s.day).length === 1;
    if (oneEach) {
      openSameDay[0].action = s.action;
      if (s.doneWhen) openSameDay[0].doneWhen = s.doneWhen;
      if (s.week != null) openSameDay[0].week = s.week;
      updated++;
      continue;
    }
    plan.steps.push({ ...s, id: uid(), done: false });
    added++;
  }

  // Steps the new plan dropped are KEPT when they are already done (that work really happened) and
  // when they are open (silently deleting someone's plan is not a refinement — they can tick or
  // drop it themselves). Nothing is ever removed here.
  if (added || updated || enriched) {
    plan.steps.sort((a, b) => a.day - b.day);
    savePlan(plan);
  }
  return { added, updated, kept: plan.steps.length };
}

/** Which plan day today is (1-based). 0 if the plan has not started yet. */
export function currentDay(plan: ActionPlan): number {
  const start = new Date(plan.startDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * Record something into the plan's log. Never throws and never blocks the caller — the copilot
 * calls this in the middle of sending messages, and a failed note must not cost a real send.
 * Deduped on (kind, who, text) within the same day so a re-scan of the same reply logs once.
 */
export function addPlanNote(n: Omit<PlanNote, 'id' | 'at' | 'day'> & { day?: number }): void {
  try {
    const plan = loadPlan();
    if (!plan) return;                       // no plan running — nothing to attach to, that's fine
    const day = n.day ?? currentDay(plan);
    const notes = plan.notes || [];
    const dup = notes.some((x) => x.day === day && x.kind === n.kind && x.who === n.who && x.text === n.text);
    if (dup) return;
    plan.notes = [...notes, { id: uid(), at: Date.now(), day, kind: n.kind, text: n.text, who: n.who }].slice(-300);
    savePlan(plan);
  } catch { /* the plan log is a convenience; it must never break outreach */ }
}

export function notesForDay(plan: ActionPlan, day: number): PlanNote[] {
  return (plan.notes || []).filter((n) => n.day === day).sort((a, b) => b.at - a.at);
}

/**
 * Read today's outreach quota out of the plan: "Day 3: message 15 founders on LinkedIn" → 15.
 *
 * This is what keeps the two halves honest with each other. The copilot asks the plan how many
 * people today calls for instead of the user guessing, and the plan can show how many actually
 * went out. Returns null when today's steps are not about outreach, which is most days.
 */
export function outreachTargetToday(plan?: ActionPlan | null): { count: number; step: PlanStep; who: string } | null {
  const p = plan ?? loadPlan();
  if (!p) return null;
  const { today, overdue } = todayView(p);
  for (const s of [...today, ...overdue]) {
    const a = s.action;
    // Must actually be an outreach instruction, not just any sentence with a number in it.
    if (!/\b(messag|dm|outreach|reach out|connect with|invite|follow[- ]?up|email)\w*\b/i.test(a)) continue;
    const m = a.match(/\b(\d{1,3})\b/);
    if (!m) continue;
    const count = parseInt(m[1], 10);
    if (!count || count > 500) continue;
    // Whatever the plan says to target — "15 D2C founders in Pune" → "D2C founders in Pune".
    const who = a.slice(a.indexOf(m[1]) + m[1].length).replace(/^\s*(people|persons|contacts)?\s*/i, '').trim();
    return { count, step: s, who: who.replace(/\s+(on|via|through)\s+(linkedin|email|twitter|x)\b.*$/i, '').trim() };
  }
  return null;
}

/**
 * Put today's steps (and anything still open from earlier) on the To-do list, automatically.
 *
 * Called on launch and whenever the plan changes, so the user never has to open the panel to find
 * out what today is. Safe to call as often as you like: `todos.add` refuses a duplicate sourceKey,
 * so a task the user already ticked off does not come back, and today's task is not re-added the
 * second time the app opens. Returns how many were genuinely new — for callers that want to say so.
 */
export function syncPlanToTodos(plan: ActionPlan): number {
  const { today, overdue } = todayView(plan);
  let added = 0;
  // Check the sourceKey OURSELVES rather than leaning on todos.add's de-duplication. Two reasons:
  // add() de-dupes on normalised text and lets a task recur once its completion is over a day old
  // — right for a repeating chore, wrong for a plan step, which would otherwise re-appear every
  // morning until the user also ticked it in the plan. And add() returns the EXISTING item when it
  // de-dupes, so counting its truthy result would report work that was already there as new.
  const existing = new Set(todos.all().map((t) => t.sourceKey).filter(Boolean) as string[]);
  for (const s of [...overdue, ...today]) {
    const sourceKey = `plan:${plan.id}:${s.id}`;
    if (existing.has(sourceKey)) continue;
    const made = todos.add(s.action, { dueAt: stepDate(plan, s).getTime(), priority: 'med', sourceKey });
    if (made) { existing.add(sourceKey); added++; }
  }
  return added;
}

/**
 * What the agent is told about the plan. Kept short on purpose — this rides on EVERY turn, and a
 * 30-day plan pasted into the prompt would eat the budget on free keys for no benefit. Today and
 * overdue are the only steps that can be acted on right now.
 */
export function todayPlanNote(): string {
  const plan = loadPlan();
  if (!plan) return '';
  const { today, overdue } = todayView(plan);
  if (!today.length && !overdue.length) return '';
  const { done, total } = planProgress(plan);
  const lines = [
    `ACTIVE PLAN — "${plan.title}" (${done}/${total} steps done). Today is day ${Math.floor((Date.now() - new Date(plan.startDate + 'T00:00:00').getTime()) / 86400000) + 1}.`,
  ];
  if (today.length) lines.push(`Due today: ${today.map((s) => s.action).join(' | ')}`);
  if (overdue.length) lines.push(`Still open from earlier: ${overdue.slice(0, 4).map((s) => s.action).join(' | ')}`);
  // What already happened today, so the agent does not tell the user to do something they finished
  // an hour ago in the copilot — and so a meeting request is never dropped on the floor.
  const log = notesForDay(plan, currentDay(plan));
  const meetings = log.filter((n) => n.kind === 'meeting');
  const outreach = log.filter((n) => n.kind === 'outreach');
  if (outreach.length) lines.push(`Already done today: ${outreach.slice(0, 3).map((n) => n.text).join(' | ')}`);
  if (meetings.length) {
    lines.push(
      `NEEDS A REPLY — asked for a meeting: ${meetings.slice(0, 3).map((n) => `${n.who || 'someone'} (${n.text})`).join(' | ')}.`,
      'Bring these up yourself. Do not state a meeting time you were not given — offer to check the calendar or ask the user for their slots.',
    );
  }
  lines.push(
    'If the user asks what to do today, what is next, or asks for help with the plan, use these — do not invent different steps.',
    'Help them FINISH the step (draft it, research it, open the browser, make the file), do not just restate it. When a step is done, say so plainly so they can tick it off.',
  );
  return lines.join('\n');
}

export function planProgress(plan: ActionPlan): { done: number; total: number; pct: number } {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
