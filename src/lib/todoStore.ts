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
  resume?: { kind: 'outreach' | 'coder' | 'module'; label: string; target?: string };
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

export const todos = {
  all(): TodoItem[] { return read(); },

  /** Open (not-done) count — what the tab badge shows. */
  openCount(): number { return read().filter((t) => !t.done).length; },

  add(text: string, extra: Partial<TodoItem> = {}): TodoItem | null {
    const clean = text.trim();
    if (!clean) return null;
    const item: TodoItem = { id: uid(), text: clean.slice(0, 300), done: false, createdAt: Date.now(), ...extra };
    write([item, ...read()]);
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
