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

export function planProgress(plan: ActionPlan): { done: number; total: number; pct: number } {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
