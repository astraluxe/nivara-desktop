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

export default function ConversationList({ activeId, onSelect, onNew, onOpenApps, onDelete }: Props) {
  const [sessions, setSessions] = useState<KrewSession[]>([]);

  const reload = useCallback(() => {
    krewDb.getSessions().then(setSessions).catch(() => {});
  }, []);

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
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id, s.agent_key)}
              className={`
                w-full text-left px-3 py-2 group flex items-start justify-between gap-1
                hover:bg-nv-surface transition-fast
                ${s.id === activeId ? 'bg-nv-surface border-l-2 border-accent' : ''}
              `}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] truncate ${s.id === activeId ? 'text-nv-text' : 'text-nv-muted'}`}>
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
              <button
                onClick={(e) => del(e, s.id)}
                className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-red text-[10px] shrink-0 transition-fast mt-0.5"
              >×</button>
            </button>
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
