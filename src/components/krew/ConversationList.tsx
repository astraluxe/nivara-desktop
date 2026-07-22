import { useEffect, useState, useCallback } from 'react';
import { krewDb, type KrewSession } from '../../lib/krewDb';
import { AGENT_BY_KEY, CATEGORY_COLOR } from '../../lib/krewAgents';

interface Props {
  activeId: string | null;
  onSelect:    (id: string, agentKey: string) => void;
  onNew:       () => void;
  onOpenApps:  () => void;
  onDelete:    (id: string) => void;
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

export default function ConversationList({ activeId, onSelect, onNew, onOpenApps, onDelete }: Props) {
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
    <aside className="flex flex-col w-[200px] shrink-0 border-r border-nv-border bg-nv-bg h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-nv-border shrink-0">
        <span className="nv-eyebrow text-nv-muted">Krew</span>
        <button
          onClick={onNew}
          title="New conversation"
          className="text-nv-faint hover:text-accent transition-fast text-lg leading-none"
        >+</button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 ? (
          <p className="text-center text-nv-faint text-[10px] pt-6 px-4 leading-relaxed">
            No conversations yet.<br />Ask Krew anything.
          </p>
        ) : (
          ordered.map((s) => (
            editingId === s.id ? (
              // Rendered instead of the row, not inside it — an <input> nested in a <button> is
              // invalid and swallows its own clicks.
              <div key={s.id} className="px-3 py-2">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(s.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="w-full bg-nv-surface border border-accent/50 rounded px-1.5 py-1 text-[11px] text-nv-text outline-none"
                  placeholder="Name this chat"
                />
              </div>
            ) : (
            <button
              key={s.id}
              onClick={() => onSelect(s.id, s.agent_key)}
              onDoubleClick={(e) => startRename(e, s)}
              className={`
                w-full text-left px-3 py-2 group flex items-start justify-between gap-1
                hover:bg-nv-surface transition-fast
                ${s.id === activeId ? 'bg-nv-surface border-l-2 border-accent' : ''}
              `}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] truncate ${s.id === activeId ? 'text-nv-text' : 'text-nv-muted'}`}>
                  {pinned.includes(s.id) && <span className="text-accent mr-1">▪</span>}
                  {s.title || 'New Chat'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {(() => {
                    const ag = AGENT_BY_KEY[s.agent_key];
                    return ag ? (
                      <span className={`text-[8px] px-1 py-0.5 rounded font-mono ${CATEGORY_COLOR[ag.category]}`}>
                        {ag.humanName}
                      </span>
                    ) : null;
                  })()}
                  <span className="text-[9px] text-nv-faint font-mono">
                    {s.message_count} msgs · {relTime(s.last_active)}
                  </span>
                </div>
              </div>
              <span className="flex items-center gap-1 shrink-0 mt-0.5">
                <button
                  onClick={(e) => togglePin(e, s.id)}
                  title={pinned.includes(s.id) ? 'Unpin' : 'Pin to top'}
                  className={`text-[10px] transition-fast ${pinned.includes(s.id)
                    ? 'text-accent'
                    : 'opacity-0 group-hover:opacity-100 text-nv-faint hover:text-accent'}`}
                >▪</button>
                <button
                  onClick={(e) => startRename(e, s)}
                  title="Rename (or double-click)"
                  className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-text text-[10px] transition-fast"
                >✎</button>
                <button
                  onClick={(e) => del(e, s.id)}
                  title="Delete"
                  className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-red text-[10px] transition-fast"
                >×</button>
              </span>
            </button>
            )
          ))
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
          <span className="text-[10px] font-mono">Connect Apps</span>
        </button>
      </div>
    </aside>
  );
}
