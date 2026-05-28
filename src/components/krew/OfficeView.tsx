import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { KREW_AGENTS, CATEGORIES, CATEGORY_COLOR, agentHandle, agentInitials, type KrewAgent, type KrewCategory } from '../../lib/krewAgents';
import { executeAutomation, type AutomationRow } from '../../lib/automationRunner';

interface Props {
  userId: string;
  onSelectAgent: (agent: KrewAgent) => void;
  onClose: () => void;
  onOpenAutomations?: () => void;
}

// ─── Category metadata ─────────────────────────────────────────────────────────

const CAT_ICON: Record<KrewCategory, string> = {
  Boss:      '◎',
  Content:   '✏',
  Marketing: '📡',
  Sales:     '🤝',
  Support:   '💬',
  Designer:  '🎨',
  Data:      '📊',
  Engineer:  '⚙',
  PM:        '📋',
  Ops:       '⚡',
};

const CAT_DESC: Record<KrewCategory, string> = {
  Boss:      'Strategy & routing',
  Content:   'Writing & captions',
  Marketing: 'Ads, email & SEO',
  Sales:     'Outreach & proposals',
  Support:   'DMs & replies',
  Designer:  'Visuals & prompts',
  Data:      'Analysis & reports',
  Engineer:  'Code & debugging',
  PM:        'Research & planning',
  Ops:       'Automation control',
};

// ─── Automation status helpers ──────────────────────────────────────────────────

function fmtRelative(ts: number | null): string {
  if (!ts) return 'Never';
  const d = Date.now() - ts * 1000;
  if (d < 60000) return 'Just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

const TRIGGER_ICON: Record<string, string> = {
  schedule: '⏰', email: '✉', file_watch: '📁', webhook: '🔗',
  twitter_mention: '𝕏', rss: '📡', github: '⚙', stripe: '💳',
  google_calendar: '📅', canvas_flow: '🎨',
};

// ─── Department Card ───────────────────────────────────────────────────────────

function DeptCard({
  cat, selected, onClick,
}: { cat: KrewCategory; selected: boolean; onClick: () => void }) {
  const agents = KREW_AGENTS.filter(a => a.category === cat);
  const color  = CATEGORY_COLOR[cat];
  const icon   = CAT_ICON[cat] ?? '◇';
  const desc   = CAT_DESC[cat] ?? '';

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-2 p-3.5 rounded-xl border text-left transition-all duration-150 group overflow-hidden ${
        selected
          ? 'border-accent/60 bg-accent/8 shadow-lg shadow-accent/10'
          : 'border-nv-border bg-nv-surface hover:border-accent/30 hover:bg-nv-surface2'
      }`}
    >
      {/* Top connector line */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-px h-3 ${selected ? 'bg-accent/60' : 'bg-nv-border'} -translate-y-full`} />

      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0 ${color}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold truncate ${selected ? 'text-accent' : 'text-nv-text'}`}>{cat}</p>
          <p className="text-[10px] text-nv-faint truncate">{desc}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-nv-faint">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        <div className="flex -space-x-1.5">
          {agents.slice(0, 4).map(a => (
            <div key={a.key} className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold ring-1 ring-nv-bg ${color}`}>
              {agentInitials(a)}
            </div>
          ))}
          {agents.length > 4 && (
            <div className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold ring-1 ring-nv-bg bg-nv-surface text-nv-faint">
              +{agents.length - 4}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div className="absolute inset-0 rounded-xl border border-accent/20 pointer-events-none" />
      )}
    </button>
  );
}

// ─── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, onSelect }: { agent: KrewAgent; onSelect: (a: KrewAgent) => void }) {
  const color = CATEGORY_COLOR[agent.category];
  return (
    <button
      onClick={() => onSelect(agent)}
      className="flex items-start gap-2.5 p-2.5 rounded-xl border border-nv-border bg-nv-bg
        hover:border-accent/50 hover:bg-nv-surface transition-fast text-left group"
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${color}`}>
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
      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0 text-nv-faint group-hover:text-accent mt-0.5 transition-fast">
        <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ─── Automation Tile ────────────────────────────────────────────────────────────

function AutomationTile({
  auto, onRunNow, onToggle, running,
}: {
  auto: AutomationRow;
  onRunNow: () => void;
  onToggle: () => void;
  running: boolean;
}) {
  return (
    <div className={`shrink-0 w-52 p-3 rounded-xl border transition-fast ${
      running ? 'border-accent/40 bg-accent/5' : auto.enabled ? 'border-nv-border bg-nv-surface' : 'border-nv-border/50 bg-nv-surface opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs shrink-0">{TRIGGER_ICON[auto.trigger_type] ?? '▶'}</span>
          <p className="text-[11px] font-medium text-nv-text truncate">{auto.name}</p>
        </div>
        {running ? (
          <span className="flex items-center gap-1 text-[9px] font-mono text-accent shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            running
          </span>
        ) : (
          <span className={`text-[9px] font-mono shrink-0 ${auto.enabled ? 'text-green-400' : 'text-nv-faint'}`}>
            {auto.enabled ? 'on' : 'off'}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-auto">
        <span className="text-[9px] text-nv-faint font-mono">{fmtRelative(auto.last_run_at)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            className="text-[9px] font-mono text-nv-faint hover:text-nv-muted transition-fast px-1.5 py-0.5 rounded border border-nv-border/50 hover:border-nv-border"
          >
            {auto.enabled ? 'pause' : 'enable'}
          </button>
          <button
            onClick={onRunNow}
            disabled={running}
            className="text-[9px] font-mono text-accent hover:text-accent-dim disabled:opacity-40 transition-fast px-1.5 py-0.5 rounded border border-accent/30 hover:border-accent/60"
          >
            ▶ run
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main OfficeView ─────────────────────────────────────────────────────────────

export default function OfficeView({ userId, onSelectAgent, onClose, onOpenAutomations }: Props) {
  const [selectedCat, setSelectedCat]   = useState<KrewCategory | null>(null);
  const [automations,  setAutomations]  = useState<AutomationRow[]>([]);
  const [runningId,    setRunningId]    = useState<string | null>(null);
  const [loadingAutos, setLoadingAutos] = useState(true);

  const deptCategories = CATEGORIES.filter(c => c !== 'Boss');
  const bossAgent      = KREW_AGENTS.find(a => a.category === 'Boss')!;
  const selectedAgents = selectedCat ? KREW_AGENTS.filter(a => a.category === selectedCat) : [];

  const loadAutomations = useCallback(async () => {
    try {
      const rows = await invoke<AutomationRow[]>('automation_list', { userId });
      setAutomations(rows.filter(r => r.trigger_type !== 'canvas_flow'));
    } catch { /* no automations yet */ }
    setLoadingAutos(false);
  }, [userId]);

  useEffect(() => { loadAutomations(); }, [loadAutomations]);

  async function handleRunNow(auto: AutomationRow) {
    if (runningId) return;
    setRunningId(auto.id);
    try {
      await executeAutomation(auto, userId);
    } catch { /* errors are logged inside executeAutomation */ }
    setRunningId(null);
    loadAutomations();
  }

  async function handleToggle(auto: AutomationRow) {
    try {
      await invoke('automation_toggle', { id: auto.id, enabled: !auto.enabled });
      loadAutomations();
    } catch { /* ignore */ }
  }

  const enabledCount  = automations.filter(a => a.enabled).length;
  const totalCount    = automations.length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-nv-border shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-nv-faint hover:text-nv-text transition-fast">
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div>
            <h2 className="text-sm font-semibold text-nv-text">Office</h2>
            <p className="text-[10px] text-nv-faint font-mono">
              {KREW_AGENTS.length} agents · {deptCategories.length} departments
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAutomations && (
            <button
              onClick={onOpenAutomations}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-nv-border bg-nv-surface hover:border-accent/40 text-nv-muted hover:text-nv-text transition-fast text-[11px] font-mono"
            >
              <span className="text-accent">⚡</span>
              Automations
              {enabledCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-[9px] font-bold">{enabledCount}</span>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Org chart ────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-y-auto px-5 py-5 gap-5 min-w-0">

          {/* Boss node */}
          <div className="flex flex-col items-center gap-0">
            <button
              onClick={() => { setSelectedCat(null); onSelectAgent(bossAgent); }}
              className="relative flex items-center gap-3 px-5 py-3.5 rounded-2xl border border-accent/40 bg-accent/5
                hover:bg-accent/10 transition-all group w-full max-w-xs mx-auto
                shadow-[0_0_24px_rgba(var(--accent-rgb),0.12)] hover:shadow-[0_0_32px_rgba(var(--accent-rgb),0.2)]"
            >
              {/* Glow ring */}
              <div className="absolute inset-0 rounded-2xl border border-accent/20 scale-105 opacity-40 pointer-events-none" />
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${CATEGORY_COLOR['Boss']}`}>
                {agentInitials(bossAgent)}
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-nv-text group-hover:text-accent transition-fast">
                  {agentHandle(bossAgent)}
                </p>
                <p className="text-[10px] text-nv-faint">{CAT_DESC['Boss']} · {KREW_AGENTS.length} reports</p>
              </div>
              <span className="text-[10px] font-mono text-accent/60 bg-accent/10 px-2 py-0.5 rounded-full shrink-0">CHIEF</span>
            </button>

            {/* Vertical connector from boss */}
            <div className="w-px h-5 bg-gradient-to-b from-accent/40 to-nv-border/40" />
          </div>

          {/* Horizontal rail */}
          <div className="relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-nv-border/60" />
          </div>

          {/* Department grid */}
          <div className="grid grid-cols-2 gap-x-2.5 gap-y-5 pt-2">
            {deptCategories.map(cat => (
              <DeptCard
                key={cat}
                cat={cat}
                selected={selectedCat === cat}
                onClick={() => setSelectedCat(selectedCat === cat ? null : cat)}
              />
            ))}
          </div>

          {/* Automation control panel */}
          <div className="mt-2 rounded-xl border border-nv-border/80 bg-nv-surface overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-nv-border/60">
              <div className="flex items-center gap-2">
                <span className="text-accent text-sm">⚡</span>
                <span className="text-[11px] font-semibold text-nv-text">Automation Control</span>
                <span className="text-[9px] font-mono text-nv-faint">
                  {loadingAutos ? '…' : `${enabledCount}/${totalCount} active`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {runningId && (
                  <span className="flex items-center gap-1 text-[9px] text-accent font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    running
                  </span>
                )}
                {onOpenAutomations && (
                  <button onClick={onOpenAutomations} className="text-[10px] font-mono text-nv-faint hover:text-accent transition-fast">
                    manage →
                  </button>
                )}
              </div>
            </div>

            {loadingAutos ? (
              <div className="px-4 py-4 text-[11px] text-nv-faint font-mono">Loading…</div>
            ) : automations.length === 0 ? (
              <div className="px-4 py-4 text-[11px] text-nv-faint">
                No automations yet.{' '}
                {onOpenAutomations && (
                  <button onClick={onOpenAutomations} className="text-accent hover:underline">Create one →</button>
                )}
              </div>
            ) : (
              <div className="flex gap-2.5 overflow-x-auto px-4 py-3 scrollbar-thin">
                {automations.map(auto => (
                  <AutomationTile
                    key={auto.id}
                    auto={auto}
                    running={runningId === auto.id}
                    onRunNow={() => handleRunNow(auto)}
                    onToggle={() => handleToggle(auto)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Agent panel (visible when dept selected) ───────────── */}
        {selectedCat && (
          <div className="w-64 shrink-0 border-l border-nv-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-nv-border">
              <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs ${CATEGORY_COLOR[selectedCat]}`}>
                {CAT_ICON[selectedCat]}
              </div>
              <div>
                <p className="text-xs font-semibold text-nv-text">{selectedCat}</p>
                <p className="text-[10px] text-nv-faint">{selectedAgents.length} specialists</p>
              </div>
              <button onClick={() => setSelectedCat(null)} className="ml-auto text-nv-faint hover:text-nv-text transition-fast">
                <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {selectedAgents.map(agent => (
                <AgentCard key={agent.key} agent={agent} onSelect={a => { onSelectAgent(a); setSelectedCat(null); }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
