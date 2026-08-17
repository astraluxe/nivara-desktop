import { useEffect, useState, useCallback } from 'react';
import { krewDb, type KrewSession } from '../../lib/krewDb';
import { AGENT_BY_KEY, deptColor, deptTint } from '../../lib/krewAgents';

interface Props {
  activeId: string | null;
  onSelect:    (id: string, agentKey: string) => void;
  onNew:       () => void;
  onOpenApps:  () => void;
  onDelete:    (id: string) => void;
  /** Fold the whole column away so the chat has the window to itself. */
  onHide?:     () => void;
}

function relTime(epoch: number) {
  const diff = Math.floor(Date.now() / 1000) - epoch;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Pinned chats live in localStorage rather than the sessions table: it needs no migration, and a
// pin is a per-machine preference about how someone likes their own sidebar, not shared data.
const PIN_KEY = 'nv-krew-pinned';
function readPins(): string[] {
  try { const v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

export default function ConversationList({ activeId, onSelect, onNew, onOpenApps, onDelete, onHide }: Props) {
  const [sessions, setSessions] = useState<KrewSession[]>([]);
  const [pinned, setPinned] = useState<string[]>(readPins);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const reload = useCallback(() => {
    krewDb.getSessions().then(setSessions).catch(() => {});
  }, []);

  function togglePin(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }

  function startRename(e: React.MouseEvent, s: KrewSession) {
    e.stopPropagation();
    setEditingId(s.id);
    setDraftTitle(s.title || '');
  }

  async function commitRename(id: string) {
    const t = draftTitle.trim();
    setEditingId(null);
    if (!t) return;
    // Update on screen immediately — waiting for the round trip makes renaming feel broken.
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: t } : s)));
    await krewDb.updateTitle(id, t).catch(() => {});
    reload();
  }

  // Pinned first, each group newest-first. Sorting a copy keeps the fetched order untouched.
  const ordered = [...sessions].sort((a, b) => {
    const pa = pinned.includes(a.id) ? 1 : 0;
    const pb = pinned.includes(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return b.last_active - a.last_active;
  });

  // ── WHEN, not just how long ago ────────────────────────────────────────────
  //
  // A flat run of forty identical rows, each ending "3d ago", is a list you scan rather than read.
  // Grouping by day is what turns it back into a history: the two chats from this morning sit
  // together under a heading, and everything older gets out of their way. Pinned keeps its own
  // group at the top, because a pin means "regardless of when".
  const dayBucket = (epoch: number): string => {
    const d = new Date(epoch * 1000);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = d.getTime();
    if (t >= midnight) return 'Today';
    if (t >= midnight - 86400000) return 'Yesterday';
    if (t >= midnight - 7 * 86400000) return 'Earlier this week';
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'long' });
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  };

  const groups: Array<{ label: string; rows: KrewSession[] }> = [];
  for (const s of ordered) {
    const label = pinned.includes(s.id) ? 'Pinned' : dayBucket(s.last_active);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(s);
    else groups.push({ label, rows: [s] });
  }

  useEffect(() => {
    reload();
    const id = setInterval(reload, 5000);
    return () => clearInterval(id);
  }, [reload]);

  async function del(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await krewDb.deleteSession(id).catch(() => {});
    onDelete(id);
    reload();
  }

  return (
    <aside className="flex flex-col w-[224px] shrink-0 border-r border-nv-border bg-nv-bg h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-11 border-b border-nv-border shrink-0">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-nv-text leading-none">Chats</p>
          <p className="text-[9.5px] text-nv-faint leading-none mt-1">
            {sessions.length === 0 ? 'nothing yet' : `${sessions.length} conversation${sessions.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onNew}
            title="New conversation"
            className="text-nv-faint hover:text-accent transition-fast text-lg leading-none"
          >+</button>
          {onHide && (
            <button
              onClick={onHide}
              title="Hide past chats"
              aria-label="Hide past chats"
              className="text-nv-faint hover:text-accent transition-fast leading-none"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.5 2.5v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="px-2 pt-8 text-center">
            <p className="text-[11.5px] text-nv-muted leading-relaxed">Nothing here yet.</p>
            <p className="text-[10.5px] text-nv-faint leading-relaxed mt-1">
              Every conversation you start is kept here — rename one by double-clicking it, and pin the ones you keep coming back to.
            </p>
          </div>
        ) : (
          groups.flatMap((g) => [
            <p key={`h-${g.label}`} className="text-[9px] font-semibold uppercase tracking-[0.08em] text-nv-faint px-1.5 pt-2 pb-1 first:pt-0">
              {g.label}
            </p>,
            ...g.rows.map((s) => (
            editingId === s.id ? (
              // Rendered instead of the row, not inside it — an <input> nested in a <button> is
              // invalid and swallows its own clicks.
              <div key={s.id} className="px-0.5 py-1 mb-1">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(s.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="w-full bg-nv-surface border border-accent/50 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-nv-text outline-none"
                  placeholder="Name this chat"
                />
              </div>
            ) : (
            <button
              key={s.id}
              onClick={() => onSelect(s.id, s.agent_key)}
              onDoubleClick={(e) => startRename(e, s)}
              className={`
                w-full text-left px-2.5 py-2 mb-1 rounded-lg group flex items-start justify-between gap-1.5
                border transition-fast
                ${s.id === activeId
                  ? 'bg-accent/[0.09] border-accent/35'
                  : 'bg-transparent border-transparent hover:bg-nv-surface hover:border-nv-border/60'}
              `}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-[11.5px] leading-snug truncate ${s.id === activeId ? 'text-nv-text font-semibold' : 'text-nv-text/90 font-medium'}`}>
                  {/* A pin, drawn as a pin. The square bullet read as a status dot rather than
                      "this chat is pinned", which is a lot of meaning to hang on a shape nobody
                      recognises. */}
                  {pinned.includes(s.id) && (
                    <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor"
                      className="inline-block text-accent mr-1 -mt-px" aria-label="Pinned">
                      <path d="M14.4 2.6a1 1 0 0 0-1.7.7v5.3L8.5 11a3 3 0 0 0-1.3 2.5v.4a1 1 0 0 0 1 1h3.6v5.3a1 1 0 0 0 2 0v-5.3h3.6a1 1 0 0 0 1-1v-.4A3 3 0 0 0 17 11l-4.2-2.4V3.3a1 1 0 0 0-.3-.7z"/>
                    </svg>
                  )}
                  {s.title || 'New Chat'}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  {(() => {
                    const ag = AGENT_BY_KEY[s.agent_key];
                    return ag ? (
                      <span className="text-[8.5px] px-1.5 py-[1px] rounded-full font-medium tracking-wide"
                            style={{ background: deptTint(ag.category, 0.18), color: deptColor(ag.category) }}>
                        {ag.humanName}
                      </span>
                    ) : null;
                  })()}
                  <span className="text-[9.5px] text-nv-faint tabular-nums truncate">
                    {s.message_count} {s.message_count === 1 ? 'message' : 'messages'} · {relTime(s.last_active)}
                  </span>
                </div>
              </div>
              <span className="flex items-center gap-1 shrink-0 mt-0.5">
                <button
                  onClick={(e) => togglePin(e, s.id)}
                  title={pinned.includes(s.id) ? 'Unpin' : 'Pin to top'}
                  className={`transition-fast leading-none ${pinned.includes(s.id)
                    ? 'text-accent'
                    : 'opacity-0 group-hover:opacity-100 text-nv-faint hover:text-accent'}`}
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" className="block">
                    <path d="M14.4 2.6a1 1 0 0 0-1.7.7v5.3L8.5 11a3 3 0 0 0-1.3 2.5v.4a1 1 0 0 0 1 1h3.6v5.3a1 1 0 0 0 2 0v-5.3h3.6a1 1 0 0 0 1-1v-.4A3 3 0 0 0 17 11l-4.2-2.4V3.3a1 1 0 0 0-.3-.7z"/>
                  </svg>
                </button>
                <button
                  onClick={(e) => startRename(e, s)}
                  title="Rename (or double-click)"
                  className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-text text-[11px] leading-none transition-fast"
                >✎</button>
                <button
                  onClick={(e) => del(e, s.id)}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-red text-[13px] leading-none transition-fast"
                >×</button>
              </span>
            </button>
            )
          )),
          ])
        )}
      </div>

      {/* Footer — connect apps */}
      <div className="p-2 border-t border-nv-border shrink-0">
        <button
          onClick={onOpenApps}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg
            text-nv-faint hover:bg-nv-surface hover:text-nv-text transition-fast"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0">
            <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor"/>
            <rect x="13" y="3" width="8" height="8" rx="1.5" fill="currentColor" opacity=".6"/>
            <rect x="3" y="13" width="8" height="8" rx="1.5" fill="currentColor" opacity=".6"/>
            <rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor" opacity=".4"/>
          </svg>
          <span className="text-[11px] font-medium">Connect apps</span>
        </button>
      </div>
    </aside>
  );
}
