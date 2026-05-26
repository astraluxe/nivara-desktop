import { KREW_AGENTS, CATEGORIES, CATEGORY_COLOR, agentHandle, agentInitials, type KrewAgent, type KrewCategory } from '../../lib/krewAgents';

interface Props {
  onSelect: (agent: KrewAgent) => void;
  onClose?: () => void;
}

function CategorySection({ cat, onSelect }: { cat: KrewCategory; onSelect: (a: KrewAgent) => void }) {
  const agents = KREW_AGENTS.filter((a) => a.category === cat);
  const colorCls = CATEGORY_COLOR[cat];

  return (
    <div className="mb-5">
      <p className="text-[9px] uppercase tracking-widest text-nv-faint font-mono mb-2 px-1">{cat}</p>
      <div className="grid grid-cols-2 gap-2">
        {agents.map((agent) => (
          <button
            key={agent.key}
            onClick={() => onSelect(agent)}
            className="flex items-start gap-2.5 p-2.5 rounded-xl border border-nv-border
              bg-nv-surface hover:border-accent/60 hover:bg-nv-surface2 transition-fast text-left group"
          >
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${colorCls}`}>
              {agentInitials(agent)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-nv-text truncate group-hover:text-accent transition-fast">
                {agentHandle(agent)}
              </p>
              <p className="text-[10px] text-nv-faint leading-snug mt-0.5 line-clamp-2">
                {agent.description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AgentGrid({ onSelect, onClose }: Props) {
  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-4">
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        {onClose && (
          <button onClick={onClose} className="text-nv-faint hover:text-nv-text transition-fast shrink-0">
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <div className="flex-1 text-center">
          <h2 className="text-[15px] font-semibold text-nv-text">Browse the team</h2>
          <p className="text-[11px] text-nv-faint mt-0.5">
            {KREW_AGENTS.length} specialists · click any to chat directly
          </p>
        </div>
        {onClose && <div className="w-4 shrink-0" />}
      </div>

      {/* Categories */}
      {CATEGORIES.map((cat) => (
        <CategorySection key={cat} cat={cat} onSelect={onSelect} />
      ))}
    </div>
  );
}
