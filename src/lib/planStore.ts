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
import { loadAvailability, isOffDay } from './availability';

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
  /**
   * The user's own note against this task — what they tried, who they spoke to, what to remember
   * next time. Kept ON the step rather than in the plan-wide log so it stays attached to the thing
   * it is about, and survives the step being moved to another day.
   */
  note?: string;
  /**
   * The work order: what this task ACTUALLY means, step by step, agreed with the user before
   * anyone starts.
   *
   * A plan line is a title — "Day 8: Publish the comparison page" — and a title is not enough to
   * work from or to hand to anyone. This is the detail behind it, drafted by an agent, edited and
   * signed off by the user, and then kept ON the step so the calendar shows the real job rather
   * than the headline, and so handing it over twice does not mean writing it twice.
   */
  brief?: string;
  /** When the user last handed this to the team — drives the badge, nothing else. */
  handedOverAt?: number;
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
    // A heading like "**Day 1 (Mon) — Write the positioning**" is split by the day pattern, which
    // takes the opening ** with it and strands the closing pair on the end of the action. The
    // paired-** rule above cannot match a lone one, so it survived into the step text and every
    // task read "…positioning**".
    .replace(/\*+\s*$/, '')
    .replace(/^\s*\*+/, '')
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

    // "Day 3: post video #2" / "- Day 12 — comment on 15 posts" /
    // "**Day 1 (Mon) — Write the positioning**" / "### Day 4 (Wed, after 1pm): send batch 2"
    //
    // The bracketed part matters: agents habitually annotate a day with its weekday or a time
    // window, and requiring the dash to follow the NUMBER meant an entire 30-day plan written as
    // "**Day 1 (Mon) — …**" parsed to zero steps, so no button appeared under it at all. Leading
    // #'s are allowed for the same reason — a plan whose days are headings is still a plan.
    const bullet = line.match(/^(?:#{1,6}\s*)?[-•*]?\s*\**day\s*(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s*(?:\([^)]*\))?\s*\**\s*[:—–-]\s*(.+)$/i);
    if (bullet) {
      const day = Number(bullet[1]);
      const action = clean(bullet[2]);
      if (day >= 1 && day <= 120 && action.length > 3) {
        const key = day + '|' + action.toLowerCase().slice(0, 40);
        if (!seen.has(key)) { seen.add(key); steps.push({ id: uid(), day, week, action, done: false }); }
      }
      continue;
    }

    // ── A DAY HEADER WITH NOTHING AFTER THE COLON ─────────────────────────────────────────────
    //
    // The rule above needs an action on the SAME line. The council's Executor does not write that
    // way; it writes a heading and puts the work underneath:
    //
    //     Day 1 (today, Wed 13 Aug):
    //
    //     research_agent runs /enrich on "Mainly Non-tech Indian companies"
    //     research_agent runs /verify on the same list
    //
    // Measured on a real council answer naming Days 1, 2, 3, 4 and 6: this parsed TWO steps, and
    // the two it found were a buffer day and a bare "LAUNCH DAY:" heading — every day whose work
    // sat on the lines below was dropped. The user watched the app say "5 new steps added" and then
    // found their plan essentially unchanged, because what landed was the empty days.
    //
    // So a bare header adopts the first real line beneath it as its action. attachDetail below then
    // gathers the remaining lines as the brief, exactly as it does for a single-line day.
    const bare = line.match(/^(?:#{1,6}\s*)?[-•*]?\s*\**day\s*(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s*(?:\([^)]*\))?\s*\**\s*[:—–-]?\s*\**\s*$/i);
    if (bare) {
      const day = Number(bare[1]);
      if (day < 1 || day > 120) continue;
      // The next line that is actual work — skipping blanks, and anything that is plainly the
      // user's own note or a completion test rather than the task itself.
      let action = '';
      for (let k = lines.indexOf(raw) + 1; k < lines.length; k++) {
        const t = clean(lines[k].trim().replace(/^[-•*]\s*/, ''));
        if (!t) continue;
        if (endsDetail(lines[k])) break;                       // ran into the next day
        if (/^(you|done when|deliverable|output)\b/i.test(t)) continue;
        if (t.length > 3) { action = t; }
        break;
      }
      if (action) {
        const key = day + '|' + action.toLowerCase().slice(0, 40);
        if (!seen.has(key)) { seen.add(key); steps.push({ id: uid(), day, week, action, done: false }); }
      }
    }
  }

  // ── THE LINES UNDER EACH DAY ARE THE TASK, and they were all being thrown away ──
  //
  // Agents do not write "Day 3: do the thing" and stop. They write the day, and then the three or
  // four lines that say WHICH list, what to filter it to, what to send, and how long it should
  // take. Parsing kept the headline and discarded every one of those lines — so a plan the user had
  // just watched their council reason out arrived in the calendar as a row of titles with nothing
  // behind them, and the Details panel had genuinely nothing to show.
  //
  // Those lines are attached to their step here. Done separately from the loop above so the
  // headline matching is untouched: a plan written as a flat "Day 1: …/Day 2: …" list still parses
  // exactly as it did, and simply has no detail to attach.
  attachDetail(lines, steps);

  return steps.sort((a, b) => a.day - b.day);
}

/** A line that ends the detail belonging to the day above it. */
function endsDetail(line: string): boolean {
  const t = line.trim();
  if (!t) return false;                                  // blank lines sit INSIDE a day's detail
  if (/^#{1,6}\s/.test(t)) return true;                  // a new heading
  if (t.startsWith('|')) return true;                    // a table
  if (/^\**week\s*\d/i.test(t)) return true;             // a week heading
  if (/^(?:#{1,6}\s*)?[-•*]?\s*\**day\s*\d{1,2}\b/i.test(t)) return true;   // the next day
  // A closing section — models habitually end a plan with these, and without this the whole
  // epilogue is glued onto the last day as if it were part of that morning's work.
  if (/^\**\s*(what to drop|what not to do|what to cut|key changes?|bottom line|why this works|notes?|summary|caveats?|assumptions?|risks?|next steps?|in short)\b/i.test(t)) return true;
  return false;
}

/** Give each step the lines written underneath its day heading. */
function attachDetail(lines: string[], steps: PlanStep[]): void {
  if (!steps.length) return;
  // Index by the line each step's headline came from, matching on day + opening words so two steps
  // on the same day cannot swap their detail.
  const byDay = new Map<number, PlanStep[]>();
  for (const s of steps) {
    const list = byDay.get(s.day) ?? [];
    list.push(s);
    byDay.set(s.day, list);
  }
  const used = new Set<PlanStep>();

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(?:#{1,6}\s*)?[-•*]?\s*\**day\s*(\d{1,2})\b/i);
    if (!m) continue;
    const candidates = (byDay.get(Number(m[1])) ?? []).filter((s) => !used.has(s));
    if (!candidates.length) continue;
    const step = candidates[0];

    const detail: string[] = [];
    for (let j = i + 1; j < lines.length && detail.length < 14; j++) {
      if (endsDetail(lines[j])) break;
      const t = lines[j].trim();
      if (!t) { if (detail.length) detail.push(''); continue; }
      detail.push(t.replace(/^[-•*]\s*/, '').trim());
    }
    while (detail.length && !detail[detail.length - 1]) detail.pop();
    const text = detail.join('\n').trim();
    if (text.length > 3) {
      step.brief = text.slice(0, 1600);
      used.add(step);
      // "Done when: …" / "Success: …" written among the detail is the step's definition of done —
      // the plan already has a field for that, and it belongs there rather than buried in prose.
      if (!step.doneWhen) {
        const dw = detail.find((d) => /^(done when|finished when|success|deliverable|output)\s*[:—-]/i.test(d));
        if (dw) step.doneWhen = clean(dw.replace(/^[^:—-]*[:—-]\s*/, '')).slice(0, 200) || undefined;
      }
    }
  }
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
export function mergeIntoPlan(
  plan: ActionPlan,
  text: string,
  opts?: { rebase?: boolean },
): { added: number; updated: number; unchanged: number; detailed: number; read: number; kept: number; shifted: number } {
  const incomingRaw = parsePlanSteps(text);
  if (!incomingRaw.length) return { added: 0, updated: 0, unchanged: 0, detailed: 0, read: 0, kept: plan.steps.length, shifted: 0 };
  const norm = (a: string) => a.toLowerCase().replace(/\s+/g, ' ').trim();

  // ── A NEW PLAN STARTS TODAY, NOT ON A DAY THAT HAS ALREADY GONE ──────────────
  //
  // The plan's day numbers are counted from its start date, so "Day 3" on a plan that began last
  // Thursday means last Saturday. Ask for a re-plan today and the council quite reasonably writes
  // "Day 3: …" for the first thing to do — which lands three days in the past and arrives in the
  // calendar already overdue, work the user never had a chance to do. Shift the whole revision so
  // its FIRST day is today; the order and the spacing between days are untouched.
  //
  // Skipped when the revision already starts today or later (nothing to fix), and when the user
  // has said to keep the dates as they are — see keepDatesRequested.
  const today = Math.max(1, currentDay(plan));
  const minDay = Math.min(...incomingRaw.map((s) => s.day));
  const shift = opts?.rebase === false || minDay >= today ? 0 : today - minDay;
  const incoming = shift ? incomingRaw.map((s) => ({ ...s, day: s.day + shift })) : incomingRaw;

  // Once the days have moved, day+action can no longer identify a step the plan already has, so
  // "Day 3: message 20 founders" would be added a second time as "Day 6". Fall back to matching on
  // the ACTION alone — but only where that is unambiguous on both sides, because a real plan
  // repeats "Buffer" and "Reply handling" across several days and collapsing those would delete
  // work. Both counts must be exactly one for a match to be trusted.
  const countBy = (list: Array<{ action: string }>) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(norm(x.action), (m.get(norm(x.action)) ?? 0) + 1);
    return m;
  };
  const inCount = countBy(incoming);
  const planCount = countBy(plan.steps);
  const uniqueMatch = (s: { action: string }) =>
    shift > 0 && inCount.get(norm(s.action)) === 1 && planCount.get(norm(s.action)) === 1
      ? plan.steps.find((x) => norm(x.action) === norm(s.action))
      : undefined;

  let added = 0, updated = 0, shifted = 0;
  // Tracked separately from `updated`: filling in a missing "done when" is worth PERSISTING but is
  // not a change the user needs to be told about, and it must not be reported as a reworded step.
  let enriched = false;

  let unchanged = 0;
  let detailed = 0;

  for (const s of incoming) {
    // The same step, moved to a new day by the rebase above. Move it rather than clone it — and
    // never touch one that is already ticked off, because that day really happened.
    const moved = uniqueMatch(s);
    if (moved) {
      if (moved.done) { unchanged++; continue; }
      if (moved.day !== s.day) { moved.day = s.day; shifted++; }
      if (s.doneWhen) { moved.doneWhen = s.doneWhen; enriched = true; }
      if (s.week != null) moved.week = s.week;
      if (s.brief && s.brief !== moved.brief) {
        moved.brief = moved.handedOverAt && moved.brief
          ? `${moved.brief}

— revised plan says —
${s.brief}`
          : s.brief;
        detailed++;
        enriched = true;
      }
      if (norm(moved.action) !== norm(s.action)) { moved.action = s.action; updated++; }
      else unchanged++;
      continue;
    }
    const sameDay = plan.steps.filter((x) => x.day === s.day);
    const identical = sameDay.find((x) => norm(x.action) === norm(s.action));
    if (identical) {
      // Unchanged. Leave it completely alone — including its tick and the date it was ticked.
      // A "done when" the new plan spells out more clearly is still worth taking.
      if (s.doneWhen && !identical.doneWhen) { identical.doneWhen = s.doneWhen; enriched = true; }
      // THE DETAIL IS WORTH TAKING EVEN WHEN THE HEADLINE DID NOT MOVE. A council that restates a
      // step word for word but finally spells out which list to filter and what to send has given
      // the user the most useful thing in the whole answer, and reporting that as "unchanged" and
      // dropping it is why a re-planned task still had an empty Details panel.
      if (s.brief && s.brief !== identical.brief) {
        identical.brief = identical.handedOverAt && identical.brief
          // An order the user has already edited and handed over is theirs. Do not overwrite it —
          // add underneath, so nothing they agreed is silently replaced by a fresh draft.
          ? `${identical.brief}\n\n— revised plan says —\n${s.brief}`
          : s.brief;
        detailed++;
        enriched = true;
      }
      unchanged++;
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
      if (s.brief) {
        openSameDay[0].brief = openSameDay[0].handedOverAt && openSameDay[0].brief
          ? `${openSameDay[0].brief}\n\n— revised plan says —\n${s.brief}`
          : s.brief;
        detailed++;
      }
      updated++;
      continue;
    }
    plan.steps.push({ ...s, id: uid(), done: false });
    added++;
  }

  // Steps the new plan dropped are KEPT when they are already done (that work really happened) and
  // when they are open (silently deleting someone's plan is not a refinement — they can tick or
  // drop it themselves). Nothing is ever removed here.
  if (added || updated || shifted || enriched) {
    plan.steps.sort((a, b) => a.day - b.day);
    // THE REASONING BEHIND THE NEW STEPS HAS TO TRAVEL WITH THEM.
    //
    // `source` is the answer the plan was written from, and it is what the work-order drafter
    // reads to find out what a one-line task actually means (see draftPrompt's planSource). A
    // merge changed the steps and left source pointing at the ORIGINAL answer — so a day the
    // council had just re-planned, in detail, was drafted from a document that never mentioned
    // it, and the draft went back to guessing. Append the revision instead, newest last, and
    // keep it bounded so a plan revised ten times does not carry ten full transcripts.
    const stamp = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    plan.source = `${plan.source || ''}\n\n--- revision (${stamp}) ---\n${text.trim()}`.slice(-40000);
    savePlan(plan);
  }
  // `read` and `unchanged` exist so the user can be told whether the WHOLE revision landed. "6
  // sharpened" left them asking "is all of it in?" — and it was not answerable, because a step the
  // revision restated word for word was skipped silently and counted nowhere. Now every incoming
  // step is accounted for: added, sharpened, or already there.
  return { added, updated, unchanged, detailed, read: incoming.length, kept: plan.steps.length, shifted };
}

/** Write (or clear) the user's note on one step. */
export function setStepNote(stepId: string, note: string): void {
  const plan = loadPlan();
  if (!plan) return;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return;
  const t = note.trim();
  if (t) step.note = t.slice(0, 2000); else delete step.note;
  savePlan(plan);
}

/** "20 Aug" — a day number immediately before a month. */
const DAY_MONTH_RE = /\b(\d{1,2})\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
/** "August 20" — a month immediately before a day number. */
const MONTH_DAY_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*(\d{1,2})\b/i;

/**
 * Say what actually happened to a revision, in one sentence the user can check.
 *
 * "6 sharpened" was true and useless: it accounted for six of the twenty-eight steps the revision
 * contained and said nothing about the other twenty-two, so the only honest response was the one
 * the user gave — "is all of it in?" — and nothing on screen could answer it. Every step read is
 * now accounted for, which is the difference between a report and a number.
 */
/**
 * Did the user ask for the day numbers to stay exactly as they are?
 *
 * The default is to rebase a revision onto today, because a plan re-planned this morning should
 * start this morning. Someone who is deliberately keeping a fixed calendar — a launch date, a
 * conference — says so, and then the dates are theirs and must not be touched.
 */
/**
 * A date the user has FIXED, in their own words.
 *
 * "from 20th i want to start mailing" is a hard constraint, and the plan quietly moved it. The
 * merge rebases a revision so its first day is today — right when a council re-plans a schedule
 * that has drifted into the past, and completely wrong when the user has named the day the work
 * must land on. The Executor wrote Day 9 = 20 Aug; rebasing shifted every day, and the launch left
 * the 20th without anyone saying so.
 *
 * So a named date turns rebasing OFF. The dates the plan was written with are the dates the user
 * asked for, and moving them is not a refinement — it is losing the one instruction they repeated.
 *
 * Deliberately narrow: a bare number is not a date. It has to read like a day somebody is planning
 * around — an ordinal, a month name, or an explicit "launch/start/send on".
 */
export function launchDateRequested(text: string): boolean {
  const t = String(text || '');
  // "on the 20th", "from 20th", "by the 3rd" — an ordinal is almost always a calendar day.
  if (/\b(on|from|by|starting|start|launch(?:ing)?|send(?:ing)?|go live)\b[^.\n]{0,24}\b\d{1,2}(st|nd|rd|th)\b/i.test(t)) return true;
  // "20 Aug", "on August 20", "launch 20/08"
  // WHOLE-WORD MONTHS ONLY. `dec` with a loose suffix matched inside "deck", so "make the deck
  // 10 slides" was read as a launch date and would have frozen the whole schedule.
  // WHOLE-WORD MONTHS ONLY. A loose suffix let `dec` match inside "deck", so "make the deck 10
  // slides" read as a launch date and would have frozen the entire schedule in place.
  if (DAY_MONTH_RE.test(t)) return true;
  if (MONTH_DAY_RE.test(t)) return true;
  if (/\b(on|from|by|launch(?:ing)?|start(?:ing)?)\b[^.\n]{0,16}\b\d{1,2}[/-]\d{1,2}\b/i.test(t)) return true;
  return false;
}

/**
 * The day of the month the user named, if they named one. Null when they did not.
 *
 * Used to tell the plan what "the 20th" means rather than making the reader work it out, and to
 * check afterwards that the launch really did land there.
 */
export function namedDayOfMonth(text: string): number | null {
  const t = String(text || '');
  const m = t.match(/\b(?:on|from|by|starting|start|launch(?:ing)?|send(?:ing)?|go live)\b[^.\n]{0,24}?\b(\d{1,2})(?:st|nd|rd|th)\b/i)
    ?? t.match(DAY_MONTH_RE)
    ?? (() => { const m = t.match(MONTH_DAY_RE); return m ? ([m[0], m[2]] as unknown as RegExpMatchArray) : null; })();
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 1 && d <= 31 ? d : null;
}

export function keepDatesRequested(text: string): boolean {
  const t = text || '';
  return /\b(keep|same|unchanged|as (?:they|it) (?:are|is)|do ?n[o']?t (?:change|move|shift))\b[^.\n]{0,40}\b(dates?|days?|day numbers?|schedule|calendar)\b/i.test(t)
      || /\b(dates?|days?|schedule)\b[^.\n]{0,30}\b(stay|remain|unchanged|as (?:they|it) (?:are|is))\b/i.test(t);
}

export function describeMerge(r: { added: number; updated: number; unchanged: number; detailed: number; read: number; shifted?: number }, title: string): string {
  if (!r.read) return `I could not find any dated steps in that, so **${title}** is unchanged. A plan needs lines like "Day 3: …" to merge.`;
  const bits = [
    r.added ? `**${r.added}** new step${r.added === 1 ? '' : 's'} added` : '',
    r.updated ? `**${r.updated}** rewritten` : '',
    r.shifted ? `**${r.shifted}** moved to their new day` : '',
    r.unchanged ? `**${r.unchanged}** already matched what you had` : '',
    r.detailed ? `**${r.detailed}** now carry the full detail behind the task` : '',
  ].filter(Boolean);
  return `Read all **${r.read}** steps of that revision into **${title}** — ${bits.join(', ')}. `
    + (r.shifted ? 'The revision starts from today rather than from a day that has already gone past. ' : '')
    + 'Nothing you had ticked off changed, and nothing was deleted.';
}

/**
 * What the council is asked about a plan.
 *
 * Finished and unfinished work go in SEPARATELY and labelled. Handing the council one
 * undifferentiated list is how it starts re-planning days that are already behind the user — and a
 * plan that rewrites its own past stops being a record of what happened.
 *
 * Shared by the Plan panel's button and /council so the two cannot drift into asking different
 * questions and getting different answers.
 */
/**
 * WHAT THE PANEL IS ANSWERING ABOUT — the user's real situation, not a hypothetical one.
 *
 * A council that answers from general business knowledge produces the advice you could have got
 * from a search: "validate with customers", "consider paid channels". Useful advice needs the
 * things only this app knows — what is already in their Brain, what their machine and their
 * connected accounts can actually do, how many days are genuinely left — and needs to say which
 * parts are estimates. Both entry points share this, so /council and the plan button cannot drift.
 */
const REAL_FACTORS =
  '\n\nANSWER FROM MY REAL SITUATION, NOT A GENERIC ONE:\n'
  // THE COUNCIL HAS NO TOOLS. Each member is one model call with a briefing — it cannot run
  // query_table, and telling it that it can produced exactly the wrong ending: a panel that
  // finished by asking the user to go and count the rows themselves, in an app whose whole promise
  // is that it does that for them. What it CAN do is name the check and say who runs it.
  + '- Use what I actually have. My lists, notes and sheets are summarised for you above, with their real columns, and my product, market and location are in the shared profile. Never ask me to describe my own business back to you.\n'
  + '- You cannot run tools yourself — you are advising, not executing. So never ask me to go and count rows, export a sheet or paste data. If a number would change your answer and it is not in your briefing, say which ONE check settles it and which agent should run it as a plan step (e.g. "Day 1: research_agent runs query_table on <list> to count the rows with an email"), then give your advice both ways.\n'
  + '- Count the real constraints: how many days are genuinely left, which steps are already done, how much of the work needs my hands rather than an agent, and what one person can actually do in a day.\n'
  + '- Recommend things this app can really carry out. The team can browse and fill in sites, read and filter my sheets, draft and send email, research and verify people, generate documents, decks and images, run automations on a schedule, and save files to my own folder. Prefer a plan the agents can execute over one that reads well.\n'
  + '- THE AGENTS DO THE WORK, NOT ME. Default every step to an agent with a real tool — research, filtering my sheets, drafting, verifying, generating documents and decks, driving the browser to fill in and publish on sites I am already signed in to, and the free web tools they know. Put something in MY hands only when it truly cannot be done without me: my face on camera, my voice, a password, a payment, a decision. Say in one line what I personally have to do each day and keep it small.' + '\n'
  + '- NEVER invent numbers. No made-up conversion rates, market sizes, CACs or benchmarks. If a figure matters and you do not have it, say it is an estimate and say what it rests on — or say how to measure it this week.\n'
  + '- Disagree with the plan where it is wrong, and say what you would drop. A review that approves everything is worth nothing.';

/**
 * The month that actually happened, as opposed to the month that was planned.
 *
 * A council asked "review my plan" was shown a list of step titles and nothing else — not what the
 * user had written against those steps, not what the copilot logged (who replied, who asked for a
 * meeting), not how many days had really gone by. So it reviewed the DOCUMENT and could not review
 * the MONTH, and its "what would you change" was an opinion about wording rather than a reading of
 * what worked. All of this is already stored; none of it was ever put in front of them.
 *
 * Capped hard: it goes into five prompts at once, so the log is the last 18 entries and the notes
 * the 8 most recent, both trimmed. Meetings and replies come first because they are the evidence
 * that anything is landing.
 */
export function planHistoryBlock(plan: ActionPlan): string {
  const out: string[] = [];
  const day = currentDay(plan);
  const last = plan.steps.reduce((m, s) => Math.max(m, s.day), 0);
  const { done, total } = planProgress(plan);
  const overdue = plan.steps.filter((s) => !s.done && s.day < day).length;
  out.push(`\nWHERE THIS PLAN ACTUALLY IS: today is day ${day} of a ${last}-day plan that started ${plan.startDate}.`
    + ` ${done} of ${total} steps are ticked off${overdue ? `, and ${overdue} are open and past their day` : ''}.`
    + (day > last ? ' THE PLAN HAS RUN OUT — every remaining day is already in the past.' : ''));

  // The log the copilot writes back into the plan: sends, replies, meetings.
  const notes = (plan.notes || []).slice();
  if (notes.length) {
    const rank = (k: string) => (k === 'meeting' ? 0 : k === 'reply' ? 1 : k === 'outreach' ? 2 : 3);
    const picked = notes
      .sort((a, b) => (rank(a.kind) - rank(b.kind)) || (b.at - a.at))
      .slice(0, 18)
      .sort((a, b) => a.day - b.day);
    out.push('\nWHAT ACTUALLY HAPPENED (logged by the app while they worked — this is evidence, not opinion):\n'
      + picked.map((n) => `- Day ${n.day} [${n.kind}]${n.who ? ` ${n.who}:` : ''} ${n.text.slice(0, 160)}`).join('\n'));
  } else {
    out.push('\nWHAT ACTUALLY HAPPENED: nothing has been logged against this plan — no sends, replies or meetings recorded.'
      + ' Either the work has not started or it happened outside the app. Say which you are assuming.');
  }

  // What the USER wrote against individual steps. Their own words about their own month.
  const written = plan.steps.filter((s) => (s.note || '').trim()).slice(-8);
  if (written.length) {
    out.push('\nTHEIR OWN NOTES ON INDIVIDUAL DAYS (read these before you re-plan anything):\n'
      + written.map((s) => `- Day ${s.day} (${s.action.slice(0, 60)}): ${s.note!.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n'));
  }

  // Steps that were handed to the team and carry an agreed work order — the detail behind a title.
  const handed = plan.steps.filter((s) => s.handedOverAt).slice(-6);
  if (handed.length) {
    out.push('\nALREADY HANDED TO THE TEAM (a work order exists for these — do not re-specify them from scratch):\n'
      + handed.map((s) => `- Day ${s.day}: ${s.action.slice(0, 80)}`).join('\n'));
  }
  return out.join('\n');
}

/**
 * True when the sensible thing to ask for is the NEXT month, not a tweak to this one.
 *
 * A plan whose last day is behind the user cannot be "re-planned" — every day in it is history.
 * Asked the ordinary review question, the council rewrites days that have already gone past, which
 * is how a review ends in a calendar full of dates nobody can act on.
 */
export function planIsSpent(plan: ActionPlan): boolean {
  const day = currentDay(plan);
  const last = plan.steps.reduce((m, s) => Math.max(m, s.day), 0);
  const { done, total } = planProgress(plan);
  return day > last || (total > 0 && done === total);
}

export function councilQuestionFor(plan: ActionPlan, ask = ''): string {
  const done = plan.steps.filter((s) => s.done).map((s) => `- Day ${s.day}: ${s.action}`).join('\n');
  const todo = plan.steps.filter((s) => !s.done).map((s) => `- Day ${s.day}: ${s.action}`).join('\n');
  const q = ask.trim();
  const spent = planIsSpent(plan);
  return (q
    // The user's own question leads, and is repeated at the end as the thing to actually answer —
    // a specific question buried above a long plan gets answered as "here are my thoughts on the
    // plan", which is the generic review they were trying to avoid asking for.
    ? `${q}\n\nAnswer THAT, against the plan below. If the plan needs to change to fit it, say exactly which days change and how.`
    : 'Is this the right plan for what I am trying to do, and what would you change?')
    + `\n\nTHE PLAN — ${plan.title}\n\n`
    + 'ALREADY FINISHED (do not re-plan, repeat or move these):\n'
    + (done || '- (nothing yet)')
    + '\n\nSTILL TO DO (only these may be re-planned):\n'
    + (todo || '- (nothing left)')
    + planHistoryBlock(plan)
    // REVIEW THE MONTH THAT HAPPENED, THEN PLAN THE NEXT ONE.
    //
    // Asked to "review the plan" at the end of a month, a council rewrites days that are already
    // in the past — a calendar full of dates nobody can act on. When the plan has run out (or
    // everything in it is ticked), the honest question is a different one, and it is asked here.
    + (spent
      ? '\n\nTHIS PLAN IS FINISHED OR OUT OF DAYS. So do TWO things, in this order:'
        + '\n1. REVIEW THE MONTH THAT JUST HAPPENED — from the log and their notes above, not from theory. What actually moved, what produced nothing, and what you now believe that you did not believe at the start. Name the numbers you can see, and say plainly where there are none.'
        + '\n2. PLAN THE NEXT MONTH from that. Start again at "Day 1:" — it is a new plan, not a continuation — and carry forward only what the evidence supports. Say explicitly what you are dropping from last month and why.'
      : '\n\nBefore you re-plan anything, READ the log and their notes above and say what they tell you — what is working, what is not, and what has quietly not been done at all. A review that ignores what actually happened is worth nothing.')
    + REAL_FACTORS
    + (q ? `\n\nTHE QUESTION I ACTUALLY WANT ANSWERED: ${q}` : '');
}

/**
 * Store the agreed work order against a step, and optionally record that it went to the team.
 *
 * Kept separate from the note because they answer different questions: a note is what the USER
 * wants to remember about this task, the brief is what the task IS. Merging them would mean either
 * a handover overwrites a note the user wrote by hand, or a note quietly changes the instructions
 * an agent is about to act on. Both are bad in ways that are hard to notice.
 */
export function setStepBrief(stepId: string, brief: string, handedOver = false): void {
  const plan = loadPlan();
  if (!plan) return;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return;
  const t = brief.trim();
  if (t) step.brief = t.slice(0, 6000); else delete step.brief;
  if (handedOver) step.handedOverAt = Date.now();
  savePlan(plan);
}

// ─── Moving open work to when the user is actually free ───────────────────────
//
// A plan is written as "Day 1…Day 30" with no idea whether day 6 is a Sunday, whether the user
// works weekends, or whether four days have already slipped. So the calendar shows work stacked on
// days off and a pile of overdue steps that will never be caught up, and the plan slowly becomes
// something the user ignores rather than follows.
//
// THE ONE INVARIANT: a DONE step is never touched. Not moved, not renumbered, not removed, not
// re-added. Work that really happened on a real day is a record, and rewriting it would make the
// plan lie about the past — which is worse than a badly scheduled future. Everything here operates
// strictly on `!step.done`.

export interface RescheduleResult { moved: number; firstDay: number; lastDay: number; skippedDone: number }

/**
 * Push OPEN steps forward onto days the user actually works, keeping their order.
 *
 * Overdue steps come first (they are the ones being ignored), then the rest in their existing
 * sequence. Density is preserved: however many steps a day carried before, it carries after.
 */
export function rescheduleOpenSteps(plan: ActionPlan, opts?: { perDay?: number; from?: Date }): RescheduleResult {
  const done = plan.steps.filter((s) => s.done);
  const open = plan.steps.filter((s) => !s.done);
  if (!open.length) return { moved: 0, firstDay: 0, lastDay: 0, skippedDone: done.length };

  // Days off come from the user's own stated working hours. Absent, every day is workable —
  // never a made-up assumption about weekends.
  const avail = (() => { try { return loadAvailability(); } catch { return null; } })();

  const start = new Date(plan.startDate + 'T00:00:00');
  const today = opts?.from ? new Date(opts.from) : new Date();
  today.setHours(0, 0, 0, 0);
  // Day numbers are 1-based offsets from startDate, so today's day number is the floor of the gap.
  const dayOfDate = (d: Date) => Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1;
  const dateOfDay = (n: number) => { const d = new Date(start); d.setDate(d.getDate() + (n - 1)); return d; };

  // Never schedule onto a day already occupied by finished work — that day is spent.
  const doneDays = new Set(done.map((s) => s.day));
  const perDay = Math.max(1, opts?.perDay ?? Math.max(1, Math.round(open.length / Math.max(1, new Set(open.map((s) => s.day)).size))));

  // Start from today (or the plan start, if it has not begun), never in the past.
  let cursor = Math.max(1, dayOfDate(today));
  let placedToday = 0;
  const isWorkable = (n: number) => {
    if (doneDays.has(n)) return false;
    if (!avail) return true;
    try { return !isOffDay(avail, dateOfDay(n)); } catch { return true; }
  };
  while (!isWorkable(cursor)) cursor++;

  // Overdue first — those are the ones actually being dropped — then the rest in order.
  const overdue = open.filter((s) => s.day < cursor).sort((a, b) => a.day - b.day);
  const ahead = open.filter((s) => s.day >= cursor).sort((a, b) => a.day - b.day);
  let moved = 0, firstDay = cursor, lastDay = cursor;
  for (const s of [...overdue, ...ahead]) {
    if (placedToday >= perDay) { cursor++; placedToday = 0; while (!isWorkable(cursor)) cursor++; }
    if (s.day !== cursor) { s.day = cursor; moved++; }
    placedToday++;
    lastDay = cursor;
  }
  plan.steps.sort((a, b) => a.day - b.day);
  savePlan(plan);
  return { moved, firstDay, lastDay, skippedDone: done.length };
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
