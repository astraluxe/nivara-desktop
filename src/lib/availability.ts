// ─── When is this person actually free? ──────────────────────────────────────
//
// Every part of the app that proposes a time was guessing. The copilot offered meeting slots it
// invented, the plan put work on days the user was in meetings, and the only fix on offer was to
// create a calendar block by hand for every single day — which nobody does, so the guessing never
// stopped.
//
// One sentence should be enough: "I'm busy weekdays 10 to 6, free after 7, and I don't work
// Sundays." That is a recurring fact about a person, not an event, so it belongs here rather than
// in a calendar — a calendar is for the exceptions.
//
// Deliberately no AI. Parsing is a regex over a handful of shapes people actually type, and every
// consumer is arithmetic. That means it behaves identically on adris.tech, NVIDIA free BYOK, and a
// local model, and it costs nothing to consult.

const KEY = 'nv-availability-v1';
export const AVAIL_EVENT = 'nv-availability-changed';

/** Minutes from midnight. 9:30am is 570. */
export type Mins = number;

export interface Block {
  /** 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
  day: number;
  start: Mins;
  end: Mins;
}

export interface Availability {
  /** Recurring blocks the user is NOT available. */
  busy: Block[];
  /** Days that are entirely off (0–6). Weekends for most people, but never assumed. */
  offDays: number[];
  /** Earliest / latest they want anything scheduled at all. */
  dayStart: Mins;
  dayEnd: Mins;
  timezone: string;
  updatedAt: number;
  /** What the user actually said, so the UI can show it back in their own words. */
  saidIt?: string;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS = [1, 2, 3, 4, 5];

export function defaultAvailability(): Availability {
  // 9–6 with nothing marked busy. Chosen so an app with no availability set behaves exactly as it
  // did before this existed: it proposes ordinary working hours and claims nothing about the user.
  return { busy: [], offDays: [], dayStart: 9 * 60, dayEnd: 18 * 60, timezone: 'Asia/Kolkata', updatedAt: 0 };
}

export function loadAvailability(): Availability | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Availability;
    if (!a || !Array.isArray(a.busy)) return null;
    return { ...defaultAvailability(), ...a, busy: a.busy.filter((b) => b && b.day >= 0 && b.day <= 6 && b.end > b.start) };
  } catch { return null; }
}

export function saveAvailability(a: Availability): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...a, updatedAt: Date.now() }));
    window.dispatchEvent(new CustomEvent(AVAIL_EVENT));
  } catch { /* quota or private mode — availability is an optimisation, never a hard failure */ }
}

export function clearAvailability(): void {
  try { localStorage.removeItem(KEY); window.dispatchEvent(new CustomEvent(AVAIL_EVENT)); } catch { /* ignore */ }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtMins(m: Mins): string {
  const h = Math.floor(m / 60), mm = m % 60;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

/** "HH:MM" in 24-hour form — what create_calendar_event wants. */
export function to24h(m: Mins): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Collapse a set of blocks into "Mon–Fri 10am–6pm" style phrases. */
function describeBlocks(blocks: Block[]): string[] {
  const byRange = new Map<string, number[]>();
  for (const b of blocks) {
    const k = `${b.start}-${b.end}`;
    if (!byRange.has(k)) byRange.set(k, []);
    byRange.get(k)!.push(b.day);
  }
  const out: string[] = [];
  for (const [k, days] of byRange) {
    const [s, e] = k.split('-').map(Number);
    const set = new Set(days);
    const isWeekdays = WEEKDAYS.every((d) => set.has(d)) && set.size === 5;
    const label = isWeekdays
      ? 'Mon–Fri'
      : days.sort((a, b) => a - b).map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
    out.push(`${label} ${fmtMins(s)}–${fmtMins(e)}`);
  }
  return out;
}

export function describeAvailability(a: Availability): string {
  const bits: string[] = [];
  if (a.busy.length) bits.push(`busy ${describeBlocks(a.busy).join('; ')}`);
  if (a.offDays.length) bits.push(`off on ${a.offDays.sort((x, y) => x - y).map((d) => DAY_NAMES[d]).join(' and ')}`);
  bits.push(`otherwise ${fmtMins(a.dayStart)}–${fmtMins(a.dayEnd)}`);
  return bits.join(', ');
}

// ─── Parsing what the user typed ──────────────────────────────────────────────

/** "10", "10am", "10:30", "10.30pm", "18:00" → minutes from midnight, or null. */
function parseTime(raw: string, meridiemHint?: string): Mins | null {
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3] || meridiemHint;
  if (h > 24 || mm > 59) return null;
  if (mer === 'pm' && h < 12) h += 12;
  else if (mer === 'am' && h === 12) h = 0;
  // No am/pm at all: a bare 1–7 in a working-hours sentence means the afternoon. "busy 10 to 6"
  // is 10am–6pm, never 10am–6am, and reading it the other way produces a negative-length day.
  else if (!mer && h >= 1 && h <= 7) h += 12;
  return h * 60 + mm;
}

function daysFromWords(s: string): number[] {
  const out = new Set<number>();
  const weekdays = /\bweekdays?\b|\bmon(day)?s?\s*[-–—]\s*fri(day)?s?\b|\bmon(day)?s?\s+to\s+fri(day)?s?\b|\bworking days\b/i.test(s);
  const weekends = /\bweekends?\b/i.test(s);
  if (weekdays) WEEKDAYS.forEach((d) => out.add(d));
  if (weekends) { out.add(0); out.add(6); }
  // "daily"/"every day" is usually a filler adverb sitting next to the real answer — "I'm busy
  // DAILY on WEEKDAYS from 10 to 6" means five days, not seven. Only let it mean all seven when
  // nothing more specific was said, or it silently adds the weekend back.
  if (!weekdays && !weekends && /\bevery ?day\b|\ball week\b|\bdaily\b/i.test(s)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => out.add(d));
  const named: [RegExp, number][] = [
    [/\bsun(day)?s?\b/i, 0], [/\bmon(day)?s?\b/i, 1], [/\btue(s|sday)?s?\b/i, 2],
    [/\bwed(nesday)?s?\b/i, 3], [/\bthu(r|rs|rsday)?s?\b/i, 4], [/\bfri(day)?s?\b/i, 5], [/\bsat(urday)?s?\b/i, 6],
  ];
  for (const [re, d] of named) if (re.test(s)) out.add(d);
  return [...out];
}

/**
 * Turn a sentence into availability, or null when it does not actually say anything about time.
 *
 * Handles the shapes people really write:
 *   "I'm busy on weekdays from 10am to 6pm"
 *   "busy mon-fri 10-6, free after 7"
 *   "I don't work Sundays"
 *   "available 9am to 5pm"
 *
 * Returning null for anything ambiguous is the point — a wrong availability is worse than none,
 * because it silently moves every meeting the app ever proposes.
 */
export function parseAvailability(text: string, base?: Availability | null): Availability | null {
  const s = (text || '').toLowerCase();
  if (!s.trim()) return null;
  const next: Availability = base ? { ...base, busy: [...base.busy], offDays: [...base.offDays] } : defaultAvailability();
  let touched = false;

  // Whole days off: "I don't work Sundays", "closed on Sunday", "off on weekends".
  const offRe = /(?:don'?t work|do not work|not working|off|closed|holiday|no work)\s*(?:on\s*)?((?:sun|mon|tue|wed|thu|fri|sat|weekend|weekday)[a-z]*(?:\s*(?:and|,|&)\s*(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)*)/gi;
  for (const m of s.matchAll(offRe)) {
    const days = daysFromWords(m[1]);
    if (days.length) { for (const d of days) if (!next.offDays.includes(d)) next.offDays.push(d); touched = true; }
  }

  // Busy / available ranges: "busy weekdays from 10am to 6pm", "free 9 to 5".
  const rangeRe = /\b(busy|blocked|unavailable|occupied|booked|free|available|open|work(?:ing)?)\b([^.;\n]{0,60}?)\b(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to|till|until|untill)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/gi;
  for (const m of s.matchAll(rangeRe)) {
    const kind = m[1].toLowerCase();
    const mid = m[2] || '';
    const endMer = (m[4].match(/am|pm/) || [])[0];
    const end = parseTime(m[4]);
    // The end's am/pm is a HINT for a start that omitted its own, but only when it produces a
    // sensible day. Applying it blindly turned "10 to 6pm" into 10pm–6pm, which is backwards, so
    // the whole sentence was thrown away as unparseable. Try the plain reading first and fall
    // back to the hinted one; between two valid readings, prefer the shorter day.
    const plain = parseTime(m[3]);
    const hinted = endMer ? parseTime(m[3], endMer) : null;
    const ok = (v: Mins | null) => v != null && end != null && end > v;
    let start: Mins | null = null;
    if (ok(plain) && ok(hinted)) start = (end! - hinted!) < (end! - plain!) ? hinted : plain;
    else if (ok(plain)) start = plain;
    else if (ok(hinted)) start = hinted;
    if (start == null || end == null || end <= start) continue;
    // Days named between the keyword and the times ("busy WEEKDAYS from 10 to 6"), else the whole
    // sentence, else assume the working week — which is what "I'm busy 10 to 6" means.
    let days = daysFromWords(mid);
    if (!days.length) days = daysFromWords(s);
    if (!days.length) days = [...WEEKDAYS];

    if (/busy|blocked|unavailable|occupied|booked/.test(kind)) {
      for (const d of days) next.busy.push({ day: d, start, end });
      touched = true;
    } else {
      // "free 9 to 5" / "I work 9 to 6" describes the WINDOW, not a busy block. Everything outside
      // it is simply not scheduled, which is what dayStart/dayEnd already mean.
      next.dayStart = start; next.dayEnd = end;
      touched = true;
    }
  }

  // Open-ended: "free after 7", "available before 11".
  for (const m of s.matchAll(/\b(?:free|available|open)\s*(?:from\s*)?after\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/gi)) {
    const t = parseTime(m[1]);
    if (t != null) { next.dayEnd = Math.max(next.dayEnd, Math.min(23 * 60 + 59, t + 180)); touched = true; }
  }
  for (const m of s.matchAll(/\bbusy\s*(?:until|till|before)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/gi)) {
    const t = parseTime(m[1]);
    if (t != null) {
      const days = daysFromWords(s).length ? daysFromWords(s) : [...WEEKDAYS];
      for (const d of days) next.busy.push({ day: d, start: Math.min(next.dayStart, 0), end: t });
      touched = true;
    }
  }

  if (!touched) return null;
  // Merge duplicates so saying the same thing twice does not double the blocks.
  const seen = new Set<string>();
  next.busy = next.busy.filter((b) => {
    const k = `${b.day}:${b.start}:${b.end}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  next.saidIt = text.trim().slice(0, 200);
  return next;
}

/** Does a sentence look like the user telling us their hours? Used to offer to save it. */
export function looksLikeAvailability(text: string): boolean {
  const s = (text || '').toLowerCase();
  if (s.length > 400) return false;                       // a long message is about something else
  if (!/\b(busy|free|available|unavailable|off|don'?t work|working hours|availability)\b/.test(s)) return false;
  return parseAvailability(text) != null;
}

// ─── Using it ─────────────────────────────────────────────────────────────────

function blocksOn(a: Availability, weekday: number): Block[] {
  return a.busy.filter((b) => b.day === weekday).sort((x, y) => x.start - y.start);
}

export function isOffDay(a: Availability, d: Date): boolean {
  return a.offDays.includes(d.getDay());
}

/**
 * Open stretches on a given date, in minutes-from-midnight.
 *
 * Only the recurring picture — real calendar events are checked separately by whoever is booking,
 * because reading a live calendar costs a browser trip and most callers only need "roughly when".
 */
export function freeSlotsOn(a: Availability, date: Date, minMinutes = 30): { start: Mins; end: Mins }[] {
  if (isOffDay(a, date)) return [];
  const out: { start: Mins; end: Mins }[] = [];
  let cursor = a.dayStart;
  for (const b of blocksOn(a, date.getDay())) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, a.dayEnd) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < a.dayEnd) out.push({ start: cursor, end: a.dayEnd });
  return out.filter((s) => s.end - s.start >= minMinutes && s.start < a.dayEnd);
}

/**
 * The next N times this person could actually take a meeting.
 *
 * This is what replaces inventing slots. `from` defaults to now, and today is only offered if
 * there is still a sensible amount of it left — proposing 4:30 today at 4:25 is not a real offer.
 */
export function nextFreeSlots(a: Availability, count = 3, durationMinutes = 30, from = new Date()): { date: Date; start: Mins; end: Mins }[] {
  const out: { date: Date; start: Mins; end: Mins }[] = [];
  const cur = new Date(from);
  const nowMins = from.getHours() * 60 + from.getMinutes();
  for (let i = 0; i < 21 && out.length < count; i++) {
    const d = new Date(cur);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const isToday = i === 0;
    for (const slot of freeSlotsOn(a, d, durationMinutes)) {
      // 60 minutes of notice, rounded up to the next half hour — nobody takes a meeting starting
      // four minutes from now.
      let start = slot.start;
      if (isToday) {
        const earliest = Math.ceil((nowMins + 60) / 30) * 30;
        if (earliest > slot.end - durationMinutes) continue;
        start = Math.max(start, earliest);
      }
      if (start + durationMinutes > slot.end) continue;
      out.push({ date: d, start, end: start + durationMinutes });
      if (out.length >= count) break;
    }
  }
  return out;
}

/**
 * What the agent is told about the user's time.
 *
 * Empty string when nothing has been saved — so an app where the user never mentioned their hours
 * behaves exactly as before, and no agent is handed made-up constraints to reason from.
 */
export function availabilityNote(): string {
  const a = loadAvailability();
  if (!a || !a.updatedAt) return '';
  const slots = nextFreeSlots(a, 3, 30);
  const lines = [
    `THE USER'S REAL AVAILABILITY (they told us this themselves): ${describeAvailability(a)}. Timezone ${a.timezone}.`,
  ];
  if (slots.length) {
    lines.push(`Genuinely open slots coming up: ${slots.map((s) => `${s.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtMins(s.start)}`).join(', ')}.`);
  }
  lines.push(
    'Propose times from THIS, never from a guess, and never offer a slot inside their busy hours or on a day they are off.',
    'This is a recurring pattern, not their calendar — a specific clash is still possible, so offer times as options rather than confirming a booking.',
  );
  return lines.join('\n');
}
