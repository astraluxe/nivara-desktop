import { useState } from 'react';
import ConversationList from '../components/krew/ConversationList';
import KrewChat from '../components/krew/KrewChat';
import ConnectApps from '../components/krew/ConnectApps';
import AgentGrid from '../components/krew/AgentGrid';
import { AGENT_BY_KEY, KREW_AGENTS, type KrewAgent } from '../lib/krewAgents';
import type { Node, Edge } from '@xyflow/react';

const DEFAULT_AGENT = KREW_AGENTS[0]; // Arjun.Boss

interface KrewModuleProps {
  onViewOnCanvas?: (nodes: Node[], edges: Edge[]) => void;
}

export default function KrewModule({ onViewOnCanvas }: KrewModuleProps) {
  const [sessionId,    setSessionId]    = useState<string | null>(null);
  const [agent,        setAgent]        = useState<KrewAgent>(DEFAULT_AGENT);
  const [showApps,     setShowApps]     = useState(false);
  const [showGrid,     setShowGrid]     = useState(false); // chat is the default view
  const [refreshToken, setRefreshToken] = useState(0);

  function handleSelectAgent(a: KrewAgent) {
    setAgent(a);
    setSessionId(null);
    setShowGrid(false);
    setShowApps(false);
  }

  function handleNewSession() {
    setSessionId(null);
    setAgent(DEFAULT_AGENT); // reset to Boss for new conversations
    setShowGrid(false);
    setShowApps(false);
  }

  function handleSessionCreated(id: string) {
    setSessionId(id);
    setRefreshToken((t) => t + 1);
  }

  function handleSelectSession(id: string, agentKey: string) {
    const a = AGENT_BY_KEY[agentKey];
    if (a) setAgent(a);
    setSessionId(id);
    setShowGrid(false);
    setShowApps(false);
  }

  function handleDelete(id: string) {
    // Clear proposal sessionStorage for the deleted session
    sessionStorage.removeItem(`krew-proposal-${id}`);
    // Clear choice localStorage entries for this session
    Object.keys(localStorage).filter((k) => k.startsWith(`nv-choice:${id}:`)).forEach((k) => localStorage.removeItem(k));
    // If the active session was deleted, start fresh
    if (id === sessionId) handleNewSession();
  }

  return (
    <div className="flex h-full overflow-hidden">
      <ConversationList
        key={refreshToken}
        activeId={sessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onOpenApps={() => { setShowApps(true); setShowGrid(false); }}
        onDelete={handleDelete}
      />

      <div className="flex-1 overflow-hidden relative">
        {showApps ? (
          <ConnectApps onClose={() => setShowApps(false)} />
        ) : showGrid ? (
          <AgentGrid onSelect={handleSelectAgent} onClose={() => setShowGrid(false)} />
        ) : (
          <KrewChat
            sessionId={sessionId}
            agent={agent}
            onSessionCreated={handleSessionCreated}
            onOpenConnectApps={() => { setShowApps(true); setShowGrid(false); }}
            onBrowseAgents={() => setShowGrid(true)}
            onAgentChange={setAgent}
            onViewOnCanvas={onViewOnCanvas}
          />
        )}
      </div>
    </div>
  );
}
