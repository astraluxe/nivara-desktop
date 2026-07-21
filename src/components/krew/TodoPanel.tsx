import { useState, useEffect, useMemo } from 'react';
import Icon from '../Icon';
import { todos, isOverdue, isDueToday, isSameDay, parseTodoShorthand as parseShorthand, TODO_EVENT, type TodoItem, type TodoPriority } from '../../lib/todoStore';

type Filter = 'all' | 'today' | 'overdue' | 'done';
type Sort = 'due' | 'priority' | 'created';

const PRIORITY_META: Record<TodoPriority, { label: string; cls: string }> = {
  high: { label: '!high', cls: 'text-red-400 border-red-500/40' },
  med:  { label: '!med',  cls: 'text-nv-yellow border-nv-yellow/40' },
  low:  { label: '!low',  cls: 'text-nv-faint border-nv-border' },
};
const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, med: 1, low: 2 };

function openLink(url: string): void {
  import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => window.open(url, '_blank'));
}

/** "today" / "tomorrow" / "18 Jul" — short enough to sit inline on a row. */
function dueLabel(ms: number): string {
  const now = Date.now();
  if (isSameDay(ms, now)) return 'today';
  if (isSameDay(ms, now + 86400000)) return 'tomorrow';
  if (isSameDay(ms, now - 86400000)) return 'yesterday';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function TodoPanel({ onResume }: { onResume: (item: TodoItem) => void }) {
  const [items, setItems] = useState<TodoItem[]>(() => todos.all());
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('due');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Single source of truth: re-read the store on every change event, including changes made
  // from elsewhere in the app (a finished outreach run dropping its resume card).
  useEffect(() => {
    const sync = () => setItems(todos.all());
    window.addEventListener(TODO_EVENT, sync);
    return () => window.removeEventListener(TODO_EVENT, sync);
  }, []);

  const shown = useMemo(() => {
    const now = Date.now();
    let list = items;
    if (filter === 'today')        list = items.filter((t) => isDueToday(t, now) || (t.resume && !t.done));
    else if (filter === 'overdue') list = items.filter((t) => isOverdue(t, now));
    else if (filter === 'done')    list = items.filter((t) => t.done);
    else                           list = items.filter((t) => !t.done);

    const arr = [...list];
    arr.sort((a, b) => {
      // Resume cards ride at the top of the open list — they are "where you left off".
      if (!a.done && !b.done && !!a.resume !== !!b.resume) return a.resume ? -1 : 1;
      if (sort === 'due') {
        const av = a.dueAt ?? Number.MAX_SAFE_INTEGER, bv = b.dueAt ?? Number.MAX_SAFE_INTEGER;
        if (av !== bv) return av - bv;
      } else if (sort === 'priority') {
        const av = a.priority ? PRIORITY_RANK[a.priority] : 3, bv = b.priority ? PRIORITY_RANK[b.priority] : 3;
        if (av !== bv) return av - bv;
      }
      return b.createdAt - a.createdAt;
    });
    return arr;
  }, [items, filter, sort]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      open:    items.filter((t) => !t.done).length,
      today:   items.filter((t) => isDueToday(t, now)).length,
      overdue: items.filter((t) => isOverdue(t, now)).length,
      done:    items.filter((t) => t.done).length,
    };
  }, [items]);

  function addTask() {
    const { text, priority, dueAt } = parseShorthand(input);
    if (!text) return;
    todos.add(text, { priority, dueAt });
    setInput('');
    setItems(todos.all());
  }

  return (
    <div className="flex flex-col border-b border-nv-border bg-nv-surface/60 shrink-0 max-h-[320px]">
      {/* Filters + sort */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 shrink-0">
        {([
          ['all', `All${counts.open ? ` ${counts.open}` : ''}`],
          ['today', `Today${counts.today ? ` ${counts.today}` : ''}`],
          ['overdue', `Overdue${counts.overdue ? ` ${counts.overdue}` : ''}`],
          ['done', `Done${counts.done ? ` ${counts.done}` : ''}`],
        ] as [Filter, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-fast whitespace-nowrap ${
              filter === k
                ? 'border-accent text-accent bg-accent/10'
                : k === 'overdue' && counts.overdue > 0
                  ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                  : 'border-nv-border text-nv-faint hover:border-nv-faint'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="flex-1" />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          title="Sort"
          className="text-[10px] bg-nv-surface2 border border-nv-border rounded px-1 py-0.5 text-nv-faint outline-none focus:border-accent"
        >
          <option value="due">due</option>
          <option value="priority">priority</option>
          <option value="created">newest</option>
        </select>
      </div>

      {/* Add a task */}
      <div className="px-2 pb-1.5 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }}
          placeholder="Add a task…  (try: Reply to Sonali !high today)"
          className="w-full bg-nv-surface2 border border-nv-border focus:border-accent rounded-lg px-2.5 py-1.5 text-[12px] text-nv-text placeholder:text-nv-faint outline-none transition-fast"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-1.5">
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-nv-faint">
            {filter === 'done' ? 'Nothing completed yet.'
              : filter === 'overdue' ? 'Nothing overdue — you\'re on top of it.'
              : filter === 'today' ? 'Nothing due today.'
              : 'No tasks yet. Type one above — unfinished work from Krew shows up here too.'}
          </p>
        ) : shown.map((t) => {
          const overdue = isOverdue(t);
          return (
            <div
              key={t.id}
              className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-nv-surface2/60 transition-fast ${(t.resume || t.url) && !t.done ? 'border border-accent/30 bg-accent/[0.06] mb-1' : ''}`}
            >
              <button
                onClick={() => { todos.toggle(t.id); setItems(todos.all()); }}
                title={t.done ? 'Mark as not done' : 'Mark as done'}
                className={`mt-0.5 w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-fast ${
                  t.done ? 'bg-accent border-accent text-white' : 'border-nv-border hover:border-accent'
                }`}
              >
                {t.done && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                {editingId === t.id ? (
                  <input
                    autoFocus
                    defaultValue={t.text}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) todos.update(t.id, { text: v }); setEditingId(null); setItems(todos.all()); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                      if (e.key === 'Escape') { setEditingId(null); }
                    }}
                    className="w-full bg-nv-surface2 border border-accent rounded px-1.5 py-0.5 text-[12px] text-nv-text outline-none"
                  />
                ) : (
                  <div className="flex items-start gap-1.5 flex-wrap">
                    <span
                      onDoubleClick={() => !t.resume && setEditingId(t.id)}
                      title={t.resume ? t.text : 'Double-click to edit'}
                      className={`text-[12px] leading-snug break-words ${t.done ? 'line-through text-nv-faint' : 'text-nv-text'}`}
                    >
                      {t.text}
                    </span>
                    {t.priority && !t.done && (
                      <span className={`text-[8px] font-mono border rounded px-1 shrink-0 mt-0.5 ${PRIORITY_META[t.priority].cls}`}>
                        {PRIORITY_META[t.priority].label}
                      </span>
                    )}
                    {t.dueAt !== undefined && !t.done && (
                      <span className={`text-[9px] font-mono shrink-0 mt-0.5 ${overdue ? 'text-red-400' : 'text-nv-faint'}`}>
                        {overdue ? 'overdue · ' : 'due '}{dueLabel(t.dueAt)}
                      </span>
                    )}
                    {t.remindAt !== undefined && !t.done && !t.remindedAt && (
                      <Icon name="bell" size={10} className="shrink-0 mt-1 text-nv-faint" />
                    )}
                  </div>
                )}
              </div>

              {(t.resume || t.url) && !t.done && (
                <button
                  onClick={() => { if (t.resume) onResume(t); else if (t.url) openLink(t.url); }}
                  title={t.url && !t.resume ? t.url : undefined}
                  className="text-[10px] px-2 py-0.5 rounded-md bg-accent text-white hover:bg-accent-dim transition-fast shrink-0 font-medium"
                >
                  Continue
                </button>
              )}
              {/* Ticking something off never deletes it — it moves to Done and stays there until
                  the user removes it. So on a done row the ✕ is always visible (it's the only way
                  to clear that one item); on an open row it stays hover-only to keep things quiet. */}
              <button
                onClick={() => { todos.remove(t.id); setItems(todos.all()); }}
                title={t.done ? 'Remove from Done' : 'Delete'}
                className={`text-[11px] text-nv-faint hover:text-red-400 transition-fast shrink-0 px-0.5 ${
                  t.done ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {counts.done > 0 && (
        <div className="px-3 py-1 border-t border-nv-border/50 shrink-0">
          <button
            onClick={() => { todos.clearCompleted(); setItems(todos.all()); }}
            className="text-[10px] text-nv-faint hover:text-accent transition-fast"
          >
            Clear {counts.done} completed
          </button>
        </div>
      )}
    </div>
  );
}
