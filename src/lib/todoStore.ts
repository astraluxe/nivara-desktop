// ─── To-do store ──────────────────────────────────────────────────────────────
// A small, self-contained task list that lives beside the chat. Two kinds of entry:
//
//   • typed tasks   — the user writes them; tick to complete (strikethrough)
//   • resume cards  — written by the app when a piece of work is left unfinished
//                     (an outreach campaign with people still to contact, a Coder
//                     session, …). Clicking one jumps straight back into it.
//
// localStorage-backed and deliberately independent of the Brain: a bug here must never
// be able to corrupt the knowledge graph.

export type TodoPriority = 'high' | 'med' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  completedAt?: number;
  priority?: TodoPriority;
  /** Epoch ms for the day this is due. Compared by calendar day, not by clock time. */
  dueAt?: number;
  /** Epoch ms for a reminder notification. Fired once, then cleared. */
  remindAt?: number;
  remindedAt?: number;
  /** Set on app-generated resume cards; clicking one runs this action. */
  /** `prompt` carries the exact instruction to hand back to Arjun — used for the real-world debt
   *  behind a message (the deck that was promised, the doc still owed) so Continue picks the work
   *  straight back up instead of only navigating somewhere. */
  /** `li-reply` types an already-drafted LinkedIn reply into that person's chat (target = their
   *  name). It is a DIRECT action rather than a `prompt`, because handing "send the reply to X"
   *  back through the chat router meant it had to be re-recognised as English — and a multi-line
   *  instruction failed that match and was swallowed by the inbox-scan route instead, re-reading
   *  the whole inbox rather than sending the one reply. A known action should never be re-parsed. */
  resume?: { kind: 'outreach' | 'coder' | 'module' | 'prompt' | 'li-reply'; label: string; target?: string; prompt?: string };
  /** Stable key so a resume card updates in place instead of piling up duplicates. */
  sourceKey?: string;
  /** External link this to-do is about (e.g. the LinkedIn chat for a confirmed meeting). If set,
   *  the "Continue" button opens it in the system browser instead of (or alongside) resume. */
  url?: string;
}

const KEY = 'nv-todos-v1';
export const TODO_EVENT = 'nv-todos-changed';

function uid(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function read(): TodoItem[] {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(r) ? (r as TodoItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: TodoItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(TODO_EVENT)); } catch { /* SSR-safe */ }
}

/** Normalise a to-do's text for duplicate detection: lowercase, strip punctuation and filler
 *  words, collapse whitespace. "Reply to Kevin once he confirms." and "reply to kevin once he
 *  confirms" become the same key, so the model re-proposing the same follow-up every turn does not
 *  stack a new row each time. */
export function normalizeTodoText(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|a|an|to|for|with|on|about|please|kindly|and|of|from|your|my)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Items that mean "there is nothing to do" should never become a task. The model sometimes turns
 *  a *finding* ("no reply came, so no need to message them") into a to-do — which is noise. This
 *  catches the common phrasings so add()/create_todo can drop them. */
export function isNoOpTodo(s: string): boolean {
  const t = (s || '').toLowerCase();
  if (t.replace(/[^a-z0-9]/g, '').length < 4) return true;
  return /\bno (need|reply|response|action|follow[- ]?up)\b/.test(t)
    || /\bnothing (to do|needed|required|pending)\b/.test(t)
    || /\b(no|not) (necessary|required|needed)\b/.test(t)
    || /\balready (done|sent|replied|handled|completed)\b/.test(t)
    || /\b(don'?t|doesn'?t|no) need to (reply|respond|message|contact|follow)/.test(t);
}

/** Midnight-to-midnight comparison — "due today" must not depend on the time of day. */
export function isSameDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}
export function isOverdue(t: TodoItem, now = Date.now()): boolean {
  return !t.done && t.dueAt !== undefined && t.dueAt < now && !isSameDay(t.dueAt, now);
}
export function isDueToday(t: TodoItem, now = Date.now()): boolean {
  return !t.done && t.dueAt !== undefined && isSameDay(t.dueAt, now);
}

/**
 * Pull "!high" / "today" shorthand out of a task's text.
 *
 * Shared so the AGENT path gets it too, not just the typed one: create_todo receives priority as
 * its own argument, but a model naturally writes "Meeting with Kevin !high" into the text as well,
 * and that literal "!high" was being stored and shown as part of the task name.
 */
export function parseTodoShorthand(raw: string): { text: string; priority?: TodoPriority; dueAt?: number } {
  let text = raw;
  let priority: TodoPriority | undefined;
  let dueAt: number | undefined;

  const p = text.match(/(?:^|\s)!(high|med|low)\b/i);
  if (p) { priority = p[1].toLowerCase() as TodoPriority; text = text.replace(p[0], ' '); }

  const startOfDay = (d: Date) => { d.setHours(9, 0, 0, 0); return d.getTime(); };
  const d = text.match(/(?:^|\s)(today|tomorrow|tmrw)\b/i);
  if (d) {
    const when = new Date();
    if (/tom|tmrw/i.test(d[1])) when.setDate(when.getDate() + 1);
    dueAt = startOfDay(when);
    text = text.replace(d[0], ' ');
  }
  return { text: text.replace(/\s+/g, ' ').trim(), priority, dueAt };
}

export const todos = {
  all(): TodoItem[] { return read(); },

  /** Open (not-done) count — what the tab badge shows. */
  openCount(): number { return read().filter((t) => !t.done).length; },

  add(text: string, extra: Partial<TodoItem> = {}): TodoItem | null {
    const clean = text.trim();
    if (!clean) return null;
    // Never create a task that means "nothing to do" — that noise is exactly what the user asked
    // us to stop generating. (Skipped for resume/app cards, which always carry a sourceKey.)
    if (!extra.sourceKey && isNoOpTodo(clean)) return null;

    const items = read();
    const norm = normalizeTodoText(clean);
    if (norm) {
      // De-dupe against what's already there. An OPEN task with the same meaning → don't add a
      // second copy (the model re-proposing the same follow-up every turn). A task the user already
      // COMPLETED → don't resurrect it as fresh work (the "I already sent the PDF, why is it back"
      // bug). Only a completion older than a day is allowed to recur, for genuinely repeating chores.
      const dupe = items.find((t) => normalizeTodoText(t.text) === norm
        && (!t.done || (t.completedAt ?? 0) > Date.now() - 24 * 60 * 60 * 1000));
      if (dupe) {
        // Refresh the existing open card's metadata (due date, url, priority) rather than duplicating.
        if (!dupe.done) {
          write(items.map((t) => (t.id === dupe.id ? { ...t, ...extra, text: t.text } : t)));
        }
        return dupe;
      }
    }

    const item: TodoItem = { id: uid(), text: clean.slice(0, 300), done: false, createdAt: Date.now(), ...extra };
    write([item, ...items]);
    return item;
  },

  update(id: string, patch: Partial<TodoItem>): void {
    write(read().map((t) => (t.id === id ? { ...t, ...patch } : t)));
  },

  toggle(id: string): void {
    write(read().map((t) => (t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? Date.now() : undefined } : t)));
  },

  remove(id: string): void { write(read().filter((t) => t.id !== id)); },

  clearCompleted(): void { write(read().filter((t) => !t.done)); },

  /**
   * Add or refresh an app-generated resume card. Keyed by `sourceKey` so re-running the same
   * work updates the existing card (and its label) instead of stacking near-identical rows.
   * A card the user already ticked off stays done — we don't nag them by resurrecting it.
   */
  upsertResume(sourceKey: string, text: string, resume: TodoItem['resume'], extra: Partial<TodoItem> = {}): void {
    const items = read();
    const i = items.findIndex((t) => t.sourceKey === sourceKey);
    if (i >= 0) {
      items[i] = { ...items[i], text: text.slice(0, 300), resume, ...extra };
      write(items);
      return;
    }
    write([{ id: uid(), text: text.slice(0, 300), done: false, createdAt: Date.now(), sourceKey, resume, ...extra }, ...items]);
  },

  /** Drop a resume card once its work is finished (e.g. every contact messaged). */
  removeBySource(sourceKey: string): void {
    write(read().filter((t) => t.sourceKey !== sourceKey));
  },

  /** Reminders that are due and haven't fired yet. */
  dueReminders(now = Date.now()): TodoItem[] {
    return read().filter((t) => !t.done && t.remindAt !== undefined && t.remindAt <= now && !t.remindedAt);
  },

  markReminded(id: string): void {
    write(read().map((t) => (t.id === id ? { ...t, remindedAt: Date.now() } : t)));
  },
};
