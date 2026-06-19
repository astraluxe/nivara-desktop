import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import { chatDb, type ChatSession } from '../lib/chatDb';
import { getMonthlyUsage } from '../lib/tokenTracker';
import { getPlanConfig } from '../lib/planConfig';
import type { Module } from '../components/Sidebar';
import { Skeleton } from '../components/Skeleton';

interface Props {
  onNavigate:   (m: Module) => void;
  onStartTour?: () => void;
}

interface SystemInfo {
  total_ram_gb: number;
  available_ram_gb: number;
  cpu_count: number;
  os_name: string;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function relativeTime(epochSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSecs;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const PLAN_STYLE: Record<string, string> = {
  explore: 'text-nv-faint  border-nv-border',
  solo:    'text-accent    border-accent/40',
  growth:  'text-blue-400  border-blue-400/40',
  builder: 'text-nv-green  border-nv-green/40',
  pro:     'text-yellow-400 border-yellow-400/40',
  custom:  'text-nv-muted  border-nv-border',
};

const PLAN_TOKENS: Record<string, { monthly: number | null; label: string; lifetime?: boolean }> = {
  free:     { monthly: 100_000,    label: '50 tasks lifetime', lifetime: true },
  explore:  { monthly: 100_000,    label: '50 tasks lifetime', lifetime: true },
  solo:     { monthly: 2_000_000,  label: '~2,000 tasks/mo'  },
  builder:  { monthly: 8_000_000,  label: '~8,000 tasks/mo'  },
  business: { monthly: 30_000_000, label: '~30,000 tasks/mo' },
  custom:   { monthly: null,       label: 'Unlimited'        },
};

interface ModuleCard {
  id: Module;
  label: string;
  sub: string;
  desc: string;
  coming?: boolean;
  icon: React.ReactNode;
  guide: string[];  // step-by-step detail bullets
}

const MODULE_CARDS: ModuleCard[] = [
  {
    id: 'automation', label: 'Automation', sub: 'Workflows · Triggers',
    desc: 'Build trigger-based workflows. Schedule tasks, watch folders, reply to emails, and chain AI actions — runs on your machine.',
    guide: [
      'Click "New Automation" to start. Give it a name and pick a trigger: Schedule (cron), Email, Folder Watch, or Webhook.',
      'Add AI steps to process the trigger content. Each step\'s output feeds into the next — chain summarization, classification, drafting, and more.',
      'Set an output: Notification, File, Email reply, Notion page, or Slack message.',
      'Automations run automatically based on their trigger — even when you\'re away from the screen.',
      'Connect your AI provider (Gemini, OpenAI, or Claude) in Connect Apps to power the steps.',
      'Use the AI Builder (⚡ button) to describe what you want in plain English and let adris.tech build the flow for you.',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <path d="M16 3l-9 13h8l-3 9 9-13h-8l3-9z" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'krew', label: 'Krew', sub: 'AI Agent · Tools · Apps',
    desc: 'Conversational AI agent that searches the web, reads files, runs commands, and connects to Gmail, Notion, Slack, GitHub and more.',
    guide: [
      'Krew is your AI agent. Open it and start chatting — ask it to search the web, read a file, run a terminal command, or manage your apps.',
      'Connect apps in "Connect Apps" (top-right): add Gemini/OpenAI/Claude API key to power the agent with your own model.',
      'Connect Gmail to read and search your inbox. Connect Notion to read and write pages. Connect Slack to send messages.',
      'Attach a file to your message by clicking the paperclip icon — Krew will read and analyse it.',
      'Browse AI agents (grid icon) to switch between specialist agents: Boss, Coder, Writer, Researcher, and more.',
      'Krew can build Automation workflows for you — just describe what you want and click "Accept & Go Live".',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <circle cx="14" cy="14" r="5" fill="currentColor"/>
        <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" fill="none" opacity=".5"/>
        <circle cx="25" cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="3"  cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="3"  r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="25" r="2" fill="currentColor" opacity=".7"/>
      </svg>
    ),
  },
  {
    id: 'coder', label: 'Coder', sub: 'Terminal · Editor · AI',
    desc: 'Real terminal, Monaco editor, and AI chat. Connect any model or your own API key.',
    guide: [
      'Open a project folder with the folder icon (top-left). Coder remembers your last project.',
      'The left panel is a full terminal — run any command, install packages, run servers.',
      'The right panel is a Monaco code editor with syntax highlighting for all major languages.',
      'Use AI Chat (bottom) to ask questions about your code, generate snippets, or debug errors.',
      'Connect your AI provider in Connect Apps, or use the connection bar in Coder to choose a model.',
      'Coder runs entirely on your machine — files are never uploaded anywhere.',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <path d="M8 4H2v6m0 8v6h6M20 4h6v6m0 8v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square"/>
        <rect x="10" y="12" width="8" height="4" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'models', label: 'Models', sub: 'Download · Run local',
    desc: 'Browse and download open-source models. Run Mistral, Qwen, Phi, and more locally.',
    guide: [
      'Browse the Models library to find open-source models sorted by size, speed, and capability.',
      'Click Download on any model to pull it to your machine — no account or API key needed.',
      'Smaller models (1–4B parameters) run on most laptops. Larger models need 8GB+ RAM.',
      'Once downloaded, models are available in Krew and Coder as local AI options.',
      'Models are stored in your adris.tech data folder and never sent to any server.',
      'Mesh integration lets you pool RAM with other devices on your network to run much larger models.',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <path d="M14 2 26 8 14 14 2 8 14 2Z" fill="currentColor"/>
        <path d="M2 14l12 6 12-6M2 20l12 6 12-6" stroke="currentColor" strokeWidth="2.2"/>
      </svg>
    ),
  },
  {
    id: 'vault', label: 'Vault', sub: 'DNS · Ad blocking',
    desc: 'System-wide ad and tracker blocking. Encrypted DNS so your ISP sees nothing.',
    guide: [
      'Vault routes your DNS queries through encrypted servers so your ISP cannot log your browsing.',
      'Choose from five modes: Swift (fast), Block (no ads), Guard (strict), Core (plain), Family (safe).',
      'The Block mode removes ads and trackers from every app on your device — not just the browser.',
      'DNS provider names are never shown — all modes use adris.tech-branded names for simplicity.',
      'Vault works at the system level and requires no browser extension.',
      'Vault integrates with Guard for a full privacy + security stack — enable both for maximum protection.',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <path d="M14 2 4 6v8c0 6.5 4.3 11.5 10 12 5.7-.5 10-5.5 10-12V6L14 2Z" fill="currentColor"/>
        <path d="M10 14l3 3 5-5" stroke="var(--nv-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'guard', label: 'Guard', sub: 'Security · Monitoring',
    desc: 'Threat monitoring, contract scanning via AI, and SOC2-ready audit trails.',
    guide: [
      'Guard monitors your system for threats: unusual processes, suspicious network connections, and file changes.',
      'Paste any contract or legal document and Guard uses AI to flag risky clauses, missing terms, and red flags.',
      'All audit events are stored in a local SQLite database with tamper-evident logs — ready for SOC2 review.',
      'Export audit reports as PDF for compliance or team review.',
      'Guard requires Builder plan or above for contract scanning.',
      'Guard works alongside Vault for a full privacy and security stack — enable Vault to add DNS-level blocking.',
    ],
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-7 h-7">
        <path d="M14 2 3 6v10c0 5 4.5 9.5 11 10 6.5-.5 11-5 11-10V6L14 2Z" fill="currentColor"/>
        <rect x="11" y="11" width="6" height="8" fill="var(--nv-bg)"/>
        <circle cx="14" cy="14" r="1.2" fill="currentColor"/>
      </svg>
    ),
  },
];

function ProgressBar({ pct, color = 'bg-accent' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-nv-surface2 overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export default function HomeModule({ onNavigate, onStartTour }: Props) {
  const { profile, user } = useAuth();
  const firstName = profile?.first_name ?? user?.email?.split('@')[0] ?? 'there';
  const plan      = profile?.plan ?? 'explore';
  const planMeta  = PLAN_TOKENS[plan] ?? PLAN_TOKENS.explore;

  const [lastProject,     setLastProject]     = useState<{ path: string; file: string | null } | null>(null);
  const [sessions,        setSessions]        = useState<ChatSession[]>([]);
  const [sessionsLoaded,  setSessionsLoaded]  = useState(false);
  const [sysInfo,         setSysInfo]         = useState<SystemInfo | null>(null);
  const [monthlyUsed,     setMonthlyUsed]     = useState<number>(0);
  const [detailCard,      setDetailCard]      = useState<ModuleCard | null>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem('nv-coder-state') ?? '{}');
      if (s.projectPath) setLastProject({ path: s.projectPath, file: s.openFile ?? null });
    } catch {}
    chatDb.getRecentSessions(3).then((s) => { setSessions(s); setSessionsLoaded(true); }).catch(() => setSessionsLoaded(true));
    invoke<SystemInfo>('get_system_info').then(setSysInfo).catch(() => {});
    const pl = profile?.plan ?? 'free';
    const isLifetime = pl === 'free' || pl === 'explore';
    getMonthlyUsage(isLifetime).then(setMonthlyUsed).catch(() => {});
  }, []);

  const projectName  = lastProject?.path.split(/[/\\]/).pop() ?? null;
  const fileName     = lastProject?.file?.split(/[/\\]/).pop() ?? null;
  const ramUsedPct   = sysInfo
    ? ((sysInfo.total_ram_gb - sysInfo.available_ram_gb) / sysInfo.total_ram_gb) * 100
    : 0;
  const planCfg      = getPlanConfig(plan);
  const tokenCap     = planCfg.monthlyTokens;

  return (
    <div className="h-full overflow-hidden bg-nv-bg flex flex-col">

      {/* ── Greeting strip ── */}
      <div id="tour-home-greeting" className="flex items-center justify-between px-6 py-3 border-b border-nv-border shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-nv-text text-[18px] font-semibold tracking-tight leading-tight">
              {timeGreeting()}, {firstName}.
            </h1>
            <p className="text-nv-muted text-[11px] font-mono">India's AI operating system</p>
          </div>
          {onStartTour && (
            <button onClick={onStartTour} className="text-[10px] text-nv-faint hover:text-accent transition-fast font-mono">
              Show me around →
            </button>
          )}
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-full border font-mono uppercase tracking-wider shrink-0
          ${PLAN_STYLE[plan] ?? PLAN_STYLE.explore}`}>
          {plan}
        </span>
      </div>

      {/* ── Main: 3-column layout ── */}
      <div className="flex-1 overflow-hidden grid grid-cols-[220px_1fr_200px] gap-0">

        {/* LEFT col — Continue + Recent sessions */}
        <div className="flex flex-col gap-3 p-4 border-r border-nv-border overflow-hidden">

          {/* Continue project */}
          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 flex flex-col shrink-0">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-3">Continue</p>
            {lastProject ? (
              <>
                <div className="flex items-center gap-2 mb-0.5 min-w-0">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="text-accent shrink-0">
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="currentColor"/>
                  </svg>
                  <span className="text-nv-text text-[12px] font-medium truncate">{projectName}</span>
                </div>
                {fileName && <p className="text-nv-muted text-[10px] font-mono truncate pl-4 mb-0.5">{fileName}</p>}
                <p className="text-nv-muted text-[9px] pl-4 mb-3 truncate opacity-60">
                  {lastProject.path.length > 26 ? '…' + lastProject.path.slice(-24) : lastProject.path}
                </p>
                <button onClick={() => onNavigate('coder')} className="w-full text-[10px] py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast">
                  Open in Coder →
                </button>
              </>
            ) : (
              <div className="text-center py-2">
                <p className="text-nv-muted text-[10px] mb-2">No project yet</p>
                <button onClick={() => onNavigate('coder')} className="text-[10px] px-3 py-1 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast">
                  Open Coder
                </button>
              </div>
            )}
          </div>

          {/* Tasks */}
          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono">Tasks</p>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${PLAN_STYLE[plan] ?? PLAN_STYLE.explore}`}>{plan}</span>
            </div>
            {(() => {
              const tokPerTask = (plan === 'free' || plan === 'explore') ? 2000 : 1000;
              const totalTasks = tokenCap === null ? null : Math.floor(tokenCap / tokPerTask);
              const tasksUsed  = Math.floor(monthlyUsed / tokPerTask);
              const tasksLeft  = totalTasks === null ? null : Math.max(0, totalTasks - tasksUsed);
              const taskPct    = totalTasks ? Math.min(100, (tasksUsed / totalTasks) * 100) : 0;
              return (
                <>
                  {tasksLeft === null ? (
                    <p className="text-nv-text text-[13px] font-semibold mb-1.5">Unlimited</p>
                  ) : (
                    <p className="text-nv-text text-[13px] font-semibold mb-1.5">{tasksLeft.toLocaleString()} tasks left</p>
                  )}
                  <ProgressBar pct={tasksLeft === null ? 5 : taskPct} color={taskPct > 85 ? 'bg-nv-red' : 'bg-accent'} />
                  <p className="text-[9px] text-nv-muted mt-1.5">
                    {tasksLeft === null
                      ? planMeta.label
                      : `${tasksUsed.toLocaleString()} / ${totalTasks!.toLocaleString()} done${planMeta.lifetime ? ' (lifetime)' : '/mo'}`}
                  </p>
                </>
              );
            })()}
          </div>

          {/* Recent sessions */}
          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 flex-1 min-h-0 overflow-hidden flex flex-col">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2 shrink-0">Recent sessions</p>
            <div className="flex-1 overflow-y-auto space-y-2">
              {!sessionsLoaded ? (
                <>
                  <Skeleton className="w-full h-3 rounded" />
                  <Skeleton className="w-4/5 h-3 rounded" />
                  <Skeleton className="w-3/5 h-3 rounded" />
                </>
              ) : sessions.length === 0 ? (
                <p className="text-[10px] text-nv-muted">No sessions yet</p>
              ) : (
                sessions.map((s) => (
                  <button key={s.id} onClick={() => onNavigate('coder')} className="w-full flex items-center justify-between gap-2 group">
                    <span className="text-[10px] text-nv-muted group-hover:text-nv-text truncate transition-fast">
                      {s.project_path.split(/[/\\]/).pop() ?? s.id.slice(0, 8)}
                    </span>
                    <span className="text-[9px] text-nv-muted shrink-0 font-mono">{relativeTime(s.last_active)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* CENTRE — Module grid (2×3) */}
        <div className="p-4 overflow-hidden">
          <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-3">Modules</p>
          <div className="grid grid-cols-3 gap-3 overflow-y-auto content-start" style={{ maxHeight: 'calc(100% - 28px)' }}>
            {MODULE_CARDS.map((card) => (
              <div
                key={card.id}
                className="group bg-nv-surface border border-nv-border rounded-xl p-4 flex flex-col hover:border-accent/50 hover:bg-nv-surface2 transition-fast overflow-hidden cursor-pointer"
                onClick={() => onNavigate(card.id)}
              >
                <div className="text-nv-muted mb-3 group-hover:text-accent transition-fast w-fit">
                  {card.icon}
                </div>
                <p className="text-nv-text text-[13px] font-semibold group-hover:text-accent transition-fast">{card.label}</p>
                <p className="text-nv-muted text-[10px] font-mono mt-0.5 mb-1.5">{card.sub}</p>
                <p className="text-nv-muted text-[10px] leading-relaxed flex-1 line-clamp-3">{card.desc}</p>
                <div className="mt-2 pt-2 border-t border-nv-border/60 flex items-center justify-between">
                  {card.coming ? (
                    <span className="text-[9px] text-nv-muted font-mono">Coming soon</span>
                  ) : (
                    <span className="text-[10px] text-accent font-mono group-hover:underline">Open →</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDetailCard(card); }}
                    className="text-[9px] text-nv-faint hover:text-accent font-mono transition-fast px-1.5 py-0.5 rounded hover:bg-accent/10"
                  >Details</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT col — System info */}
        <div className="flex flex-col gap-3 p-4 border-l border-nv-border overflow-hidden">
          <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono shrink-0">System</p>

          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 shrink-0">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">RAM</p>
            {sysInfo ? (
              <>
                <div className="flex items-baseline justify-between mb-1.5">
                  <p className="text-nv-text text-[13px] font-semibold">{sysInfo.available_ram_gb.toFixed(1)} GB</p>
                  <span className="text-nv-faint text-[9px] font-mono">of {sysInfo.total_ram_gb.toFixed(0)} GB</span>
                </div>
                <ProgressBar pct={ramUsedPct} color={ramUsedPct > 80 ? 'bg-nv-red' : ramUsedPct > 60 ? 'bg-nv-yellow' : 'bg-nv-green'} />
                <p className="text-[9px] text-nv-faint mt-1">free</p>
              </>
            ) : (
              <>
                <Skeleton className="w-20 h-3 mb-1.5" />
                <Skeleton className="w-full h-1.5 rounded-full" />
              </>
            )}
          </div>

          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 shrink-0">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">CPU</p>
            {sysInfo ? (
              <>
                <p className="text-nv-text text-[13px] font-semibold">{sysInfo.cpu_count} cores</p>
                <p className="text-nv-faint text-[10px] font-mono mt-1 truncate">{sysInfo.os_name}</p>
              </>
            ) : (
              <>
                <Skeleton className="w-16 h-3 mb-1" />
                <Skeleton className="w-24 h-2.5" />
              </>
            )}
          </div>

          <div className="bg-nv-surface border border-nv-border rounded-xl p-4 shrink-0">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">Sessions</p>
            <p className="text-nv-text text-[13px] font-semibold">{sessions.length}</p>
            <p className="text-nv-faint text-[10px] mt-1">local only</p>
          </div>

          <div className="flex-1" />
          <p className="text-[9px] text-nv-faint font-mono text-center">Built in India</p>
        </div>
      </div>

      {/* Details modal */}
      {detailCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setDetailCard(null)}
        >
          <div
            className="bg-nv-surface border border-nv-border rounded-2xl w-[440px] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-nv-border shrink-0">
              <div className="text-accent">{detailCard.icon}</div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-nv-text">{detailCard.label}</p>
                <p className="text-[10px] text-nv-muted font-mono">{detailCard.sub}</p>
              </div>
              <button onClick={() => setDetailCard(null)} className="text-nv-faint hover:text-nv-text text-xl transition-fast">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <p className="text-[11px] text-nv-muted leading-relaxed">{detailCard.desc}</p>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono pt-1">How to use</p>
              <ol className="space-y-2.5">
                {detailCard.guide.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-[9px] font-mono text-accent/70 pt-0.5 shrink-0 w-4">{i + 1}.</span>
                    <p className="text-[11px] text-nv-muted leading-relaxed">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-nv-border shrink-0">
              {detailCard.coming ? (
                <span className="text-[10px] text-nv-faint font-mono">Coming soon — stay tuned</span>
              ) : (
                <span className="text-[10px] text-nv-faint font-mono">{detailCard.label} is ready to use</span>
              )}
              <div className="flex gap-2">
                <button onClick={() => setDetailCard(null)} className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:text-nv-text transition-fast">Close</button>
                {!detailCard.coming && (
                  <button
                    onClick={() => { setDetailCard(null); onNavigate(detailCard.id); }}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast"
                  >Open {detailCard.label} →</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
