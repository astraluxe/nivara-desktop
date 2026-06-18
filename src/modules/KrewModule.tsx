import { useState } from 'react';
import ConversationList from '../components/krew/ConversationList';
import KrewChat from '../components/krew/KrewChat';
import ConnectApps from '../components/krew/ConnectApps';
import AgentGrid from '../components/krew/AgentGrid';
import OfficeView from '../components/krew/OfficeView';
import ResearchScreen from '../components/krew/ResearchScreen';
import CreatorScreen from '../components/krew/CreatorScreen';
import { AGENT_BY_KEY, KREW_AGENTS, type KrewAgent } from '../lib/krewAgents';
import { useAuth } from '../contexts/AuthContext';
import type { Node, Edge } from '@xyflow/react';

const DEFAULT_AGENT = KREW_AGENTS[0]; // Arjun.Boss

type View = 'chat' | 'office' | 'grid' | 'apps' | 'research' | 'creator';

interface StudioRequest {
  prompt: string;
  formatId: string;
  duration: number;
  context: string;
}

interface KrewModuleProps {
  onViewOnCanvas?: (nodes: Node[], edges: Edge[]) => void;
  onOpenAutomations?: () => void;
  onOpenStudio?: (req: StudioRequest) => void;
}

export default function KrewModule({ onViewOnCanvas, onOpenAutomations, onOpenStudio }: KrewModuleProps) {
  const { user } = useAuth();
  const [sessionId,    setSessionId]    = useState<string | null>(null);
  const [agent,        setAgent]        = useState<KrewAgent>(DEFAULT_AGENT);
  const [view,         setView]         = useState<View>('chat');
  const [refreshToken, setRefreshToken] = useState(0);

  function handleSelectAgent(a: KrewAgent) {
    setAgent(a);
    setSessionId(null);
    setView('chat');
  }

  function handleNewSession() {
    setSessionId(null);
    setAgent(DEFAULT_AGENT);
    setView('chat');
  }

  function handleSessionCreated(id: string) {
    setSessionId(id);
    setRefreshToken((t) => t + 1);
  }

  function handleSelectSession(id: string, agentKey: string) {
    const a = AGENT_BY_KEY[agentKey];
    if (a) setAgent(a);
    setSessionId(id);
    setView('chat');
  }

  function handleDelete(id: string) {
    sessionStorage.removeItem(`krew-proposal-${id}`);
    Object.keys(localStorage).filter((k) => k.startsWith(`nv-choice:${id}:`)).forEach((k) => localStorage.removeItem(k));
    if (id === sessionId) handleNewSession();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <ConversationList
        key={refreshToken}
        activeId={sessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onOpenApps={() => setView('apps')}
        onDelete={handleDelete}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* ── Tab bar ────────────────────────────────────────────────── */}
        {(view === 'chat' || view === 'office' || view === 'research' || view === 'creator') && (
          <div className="flex items-center gap-0 px-4 pt-2 pb-0 shrink-0 border-b border-nv-border/60">
            <button
              onClick={() => setView('chat')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono transition-fast border-b-2 -mb-px ${
                view === 'chat' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
              }`}
            >
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                <path d="M1 1.5h10M1 4.5h7M1 7.5h10M1 10.5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Chat
            </button>
            <button
              onClick={() => setView('office')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono transition-fast border-b-2 -mb-px ${
                view === 'office' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
              }`}
            >
              <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3 opacity-70">
                <rect x="1" y="1" width="4" height="4" rx="0.8"/>
                <rect x="7" y="1" width="4" height="4" rx="0.8"/>
                <rect x="1" y="7" width="4" height="4" rx="0.8"/>
                <rect x="7" y="7" width="4" height="4" rx="0.8"/>
              </svg>
              Office
            </button>
            <button
              onClick={() => setView('research')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono transition-fast border-b-2 -mb-px ${
                view === 'research' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
              }`}
            >
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Research
            </button>
            <button
              onClick={() => setView('creator')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono transition-fast border-b-2 -mb-px ${
                view === 'creator' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
              }`}
            >
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                <path d="M6 1l1.2 3.6H11l-3 2.2 1.1 3.5L6 8 3 10.3l1.1-3.5L1 4.6h3.8z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
              </svg>
              Studio
            </button>
          </div>
        )}

        {/* ── Views ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden relative">
          {/* Persistent views — stay mounted across tab switches to preserve state */}
          <div className={`absolute inset-0 overflow-hidden ${view === 'research' ? '' : 'hidden'}`}>
            <ResearchScreen />
          </div>
          <div className={`absolute inset-0 overflow-hidden ${view === 'creator' ? '' : 'hidden'}`}>
            <CreatorScreen />
          </div>
          {/* Transient views — remount on switch */}
          {view === 'apps' && <ConnectApps onClose={() => setView('chat')} />}
          {view === 'grid' && <AgentGrid onSelect={handleSelectAgent} onClose={() => setView('chat')} />}
          {view === 'office' && (
            <OfficeView
              userId={user?.id ?? ''}
              onSelectAgent={handleSelectAgent}
              onClose={() => setView('chat')}
              onOpenAutomations={onOpenAutomations}
            />
          )}
          {view === 'chat' && (
            <KrewChat
              sessionId={sessionId}
              agent={agent}
              onSessionCreated={handleSessionCreated}
              onOpenConnectApps={() => setView('apps')}
              onBrowseAgents={() => setView('grid')}
              onAgentChange={setAgent}
              onViewOnCanvas={onViewOnCanvas}
              onOpenStudio={onOpenStudio}
            />
          )}
        </div>
      </div>
    </div>
  );
}
