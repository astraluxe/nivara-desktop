import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  KREW_AGENTS, CATEGORIES, agentHandle, agentInitials,
  type KrewAgent, type KrewCategory,
} from '../../lib/krewAgents';
import { executeAutomation, type AutomationRow } from '../../lib/automationRunner';

// ─── Stage constants ──────────────────────────────────────────────────────────
const STAGE_W = 1240, STAGE_H = 860;
const CENTER  = { x: STAGE_W / 2, y: STAGE_H / 2 };
const R_OUT   = 360;
const R_IN    = 285;
const TAU     = Math.PI * 2;

// ─── Per-department metadata ──────────────────────────────────────────────────
const DEPT_META: Record<KrewCategory, { color: string; tagline: string; icon: string }> = {
  Boss:      { color: '#7C5CFF', tagline: 'Strategy & routing',   icon: 'zap' },
  Content:   { color: '#f5853f', tagline: 'Writing & captions',   icon: 'pen' },
  Marketing: { color: '#3f8cf5', tagline: 'Ads, email & SEO',     icon: 'megaphone' },
  Sales:     { color: '#2bb673', tagline: 'Outreach & proposals', icon: 'trending' },
  Support:   { color: '#15b8c4', tagline: 'DMs & replies',        icon: 'chat' },
  Designer:  { color: '#e15ba8', tagline: 'Visuals & prompts',    icon: 'palette' },
  Data:      { color: '#e0a317', tagline: 'Analysis & reports',   icon: 'bars' },
  Engineer:  { color: '#10b0c9', tagline: 'Code & debugging',     icon: 'code' },
  PM:        { color: '#6c63f5', tagline: 'Research & planning',  icon: 'clipboard' },
  Ops:       { color: '#9b6cf5', tagline: 'Automation control',   icon: 'zap' },
};

// ─── SVG icon paths ───────────────────────────────────────────────────────────
const ICON_PATHS: Record<string, string> = {
  pen:       'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  megaphone: 'm3 11 18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6',
  trending:  'M22 7 13.5 15.5l-5-5L2 17 M16 7h6v6',
  chat:      'M7.9 20A9 9 0 1 0 4 16.1L2 22Z',
  palette:   'M12 2a10 10 0 1 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a3 3 0 0 0 3-3 10 10 0 0 0-10-9z M8 9h.01 M12 7h.01 M16 9h.01',
  bars:      'M3 3v18h18 M8 17v-5 M13 17V8 M18 17v-9',
  code:      'm16 18 6-6-6-6 M8 6l-6 6 6 6',
  clipboard: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6v4H9z',
  zap:       'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
};

function SvgIcon({ name, size = 18 }: { name: string; size?: number }) {
  const d = ICON_PATHS[name] ?? '';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  );
}

// ─── Layout computation ───────────────────────────────────────────────────────
interface LayoutAgent {
  agent: KrewAgent;
  dept: KrewCategory;
  color: string;
  x: number; y: number;
  idx: number;
}
interface LayoutLink { a: LayoutAgent; b: LayoutAgent; color: string; boundary: boolean; weak?: boolean; key: string }
interface Layout { agents: LayoutAgent[]; links: LayoutLink[] }

function computeLayout(): Layout {
  const agents: LayoutAgent[] = [];
  CATEGORIES.filter(c => c !== 'Boss').forEach(cat => {
    KREW_AGENTS.filter(a => a.category === cat).forEach(a => {
      agents.push({ agent: a, dept: cat, color: DEPT_META[cat].color, x: 0, y: 0, idx: agents.length });
    });
  });

  const N = agents.length;
  const step = TAU / N;
  agents.forEach((a, k) => {
    const angle = -Math.PI / 2 + k * step;
    const r = k % 2 === 0 ? R_OUT : R_IN;
    a.x = CENTER.x + r * Math.cos(angle);
    a.y = CENTER.y + r * Math.sin(angle);
  });

  const links: LayoutLink[] = [];
  for (let k = 0; k < N; k++) {
    const a = agents[k], b = agents[(k + 1) % N];
    links.push({ a, b, color: b.color, boundary: a.dept !== b.dept, key: `n${k}` });
    const c = agents[(k + 2) % N];
    if (a.dept === c.dept)
      links.push({ a, b: c, color: a.color, boundary: false, weak: true, key: `s${k}` });
  }
  return { agents, links };
}

// ─── Edges (SVG layer) ────────────────────────────────────────────────────────
function Edges({ layout, activeDept, showLinks }: {
  layout: Layout; activeDept: KrewCategory | null; showLinks: boolean;
}) {
  const { agents, links } = layout;
  const bossAgent = KREW_AGENTS.find(a => a.category === 'Boss')!;
  const bx = CENTER.x, by = CENTER.y;

  return (
    <svg className="absolute inset-0" width={STAGE_W} height={STAGE_H}
      style={{ overflow: 'visible', pointerEvents: 'none' }}>
      <defs>
        {agents.map(a => (
          <linearGradient key={a.idx} id={`sp-${a.idx}`}
            x1={bx} y1={by} x2={a.x} y2={a.y} gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#7C5CFF" stopOpacity="0.55" />
            <stop offset="100%" stopColor={a.color} />
          </linearGradient>
        ))}
      </defs>

      {/* agent ↔ agent mesh links */}
      {showLinks && links.map(l => {
        const onActive = activeDept && (l.a.dept === activeDept || l.b.dept === activeDept);
        const dim = activeDept && !onActive;
        return (
          <line key={l.key}
            x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
            stroke={l.boundary ? 'var(--nv-border)' : l.color}
            strokeWidth={l.weak ? 1.2 : onActive ? 2.4 : 1.6}
            strokeLinecap="round"
            opacity={l.boundary ? 0.4 : dim ? 0.08 : onActive ? 0.8 : 0.35} />
        );
      })}

      {/* boss → every agent spokes */}
      {agents.map(a => {
        const len = Math.hypot(a.x - bx, a.y - by);
        const active = activeDept === a.dept;
        const dim = activeDept && !active;
        return (
          <g key={a.idx}>
            <line x1={bx} y1={by} x2={a.x} y2={a.y}
              stroke={`url(#sp-${a.idx})`} strokeLinecap="round"
              strokeWidth={active ? 2.6 : 1.4}
              opacity={dim ? 0.08 : active ? 0.9 : 0.45}
              className="ov-edge-draw"
              style={{ '--ov-len': len } as React.CSSProperties} />
            {active && (
              <line x1={bx} y1={by} x2={a.x} y2={a.y}
                stroke={a.color} strokeWidth="2.4" strokeLinecap="round"
                opacity="0.8" className="ov-edge-flow" />
            )}
          </g>
        );
      })}

      {/* invisible hover hit areas (helps trigger hover on thin lines) */}
      {false && bossAgent && null}
    </svg>
  );
}

// ─── Agent box ────────────────────────────────────────────────────────────────
function AgentBox({ la, active, dim, onEnter, onLeave, onClick }: {
  la: LayoutAgent; active: boolean; dim: boolean;
  onEnter: () => void; onLeave: () => void; onClick: () => void;
}) {
  return (
    <button
      className="absolute -translate-x-1/2 -translate-y-1/2 ov-node-pop"
      style={{
        left: la.x, top: la.y, zIndex: active ? 25 : 8,
        animationDelay: `${220 + la.idx * 18}ms`,
        opacity: dim ? 0.25 : 1,
        transition: 'opacity .25s',
      }}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onClick}>
      <span
        className="flex items-center gap-1.5 rounded-lg pl-2 pr-2.5 py-1 whitespace-nowrap transition-all duration-150"
        style={{
          background: 'var(--nv-surface)',
          border: `1.5px solid ${active ? la.color : 'var(--nv-border)'}`,
          boxShadow: active
            ? `0 6px 20px ${la.color}44`
            : '0 3px 10px rgba(0,0,0,.18)',
          transform: active ? 'scale(1.1)' : 'scale(1)',
        }}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: la.color }} />
        <span className="text-[11.5px] font-medium" style={{ color: 'var(--nv-text)' }}>
          {la.agent.humanName}
        </span>
      </span>
    </button>
  );
}

// ─── Boss node ────────────────────────────────────────────────────────────────
function BossNode({ onClick }: { onClick: () => void }) {
  const boss = KREW_AGENTS.find(a => a.category === 'Boss')!;
  return (
    <button
      className="absolute -translate-x-1/2 -translate-y-1/2 ov-node-pop group"
      style={{ left: CENTER.x, top: CENTER.y, zIndex: 30, animationDelay: '0ms' }}
      onClick={onClick}>
      <div
        className="flex items-center gap-3 rounded-2xl pl-3 pr-5 py-3 transition-transform duration-150 group-hover:-translate-y-0.5"
        style={{
          background: 'var(--nv-surface)',
          border: '1.5px solid #7C5CFF',
          boxShadow: '0 10px 34px rgba(124,92,255,.28)',
        }}>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: 'rgba(124,92,255,0.15)', color: '#7C5CFF' }}>
          {agentInitials(boss)}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[14px]" style={{ color: 'var(--nv-text)' }}>
              {agentHandle(boss)}
            </span>
            <span
              className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(124,92,255,0.15)', color: '#7C5CFF' }}>
              CHIEF
            </span>
          </div>
          <div className="text-[11px]" style={{ color: 'var(--nv-muted)' }}>
            Strategy & routing · {KREW_AGENTS.length} agents
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Side panel ───────────────────────────────────────────────────────────────
function SidePanel({ dept, focusHandle, onClose, onSelectAgent }: {
  dept: KrewCategory | null; focusHandle: string | null;
  onClose: () => void; onSelectAgent: (a: KrewAgent) => void;
}) {
  const open = !!dept;
  const meta = dept ? DEPT_META[dept] : null;
  const agents = dept ? KREW_AGENTS.filter(a => a.category === dept) : [];

  return (
    <div className="absolute top-0 right-0 h-full z-50 flex" style={{ pointerEvents: open ? 'auto' : 'none' }}>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.22)',
          opacity: open ? 1 : 0,
          transition: 'opacity .25s',
          pointerEvents: open ? 'auto' : 'none',
        }} />
      <aside
        className="relative h-full w-[320px] flex flex-col"
        style={{
          background: 'var(--nv-surface)',
          borderLeft: '1px solid var(--nv-border)',
          transform: open ? 'translateX(0)' : 'translateX(110%)',
          transition: 'transform .28s cubic-bezier(.2,.8,.2,1)',
          boxShadow: '-14px 0 40px rgba(0,0,0,.22)',
        }}>
        {dept && meta && (
          <>
            {/* header */}
            <div className="flex items-start justify-between p-4" style={{ borderBottom: '1px solid var(--nv-border)' }}>
              <div className="flex items-center gap-3">
                <div
                  className="rounded-xl flex items-center justify-center shrink-0"
                  style={{ width: 42, height: 42, background: `${meta.color}20`, color: meta.color }}>
                  <SvgIcon name={meta.icon} size={20} />
                </div>
                <div>
                  <div className="font-semibold text-[15px]" style={{ color: 'var(--nv-text)' }}>{dept}</div>
                  <div className="text-[11px]" style={{ color: 'var(--nv-muted)' }}>
                    {meta.tagline} · {agents.length} agents
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-fast hover:opacity-70 shrink-0 mt-0.5"
                style={{ color: 'var(--nv-faint)' }}>
                ✕
              </button>
            </div>

            {/* agent list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {agents.map((a, i) => {
                const hot = agentHandle(a) === focusHandle;
                return (
                  <button
                    key={i}
                    onClick={() => onSelectAgent(a)}
                    className="w-full flex items-start gap-3 p-3 rounded-xl text-left transition-fast"
                    style={{
                      background: hot ? `${meta.color}18` : 'transparent',
                      boxShadow: hot ? `inset 0 0 0 1.5px ${meta.color}` : 'none',
                    }}>
                    <div
                      className="rounded-lg flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5"
                      style={{ width: 32, height: 32, background: `${meta.color}20`, color: meta.color }}>
                      {agentInitials(a)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-[13px]" style={{ color: 'var(--nv-text)' }}>
                        {agentHandle(a)}
                      </div>
                      <div className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--nv-muted)' }}>
                        {a.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* CTA */}
            <div className="p-4" style={{ borderTop: '1px solid var(--nv-border)' }}>
              <button
                onClick={() => { onSelectAgent(agents[0]); onClose(); }}
                className="w-full py-2.5 rounded-xl font-semibold text-[12.5px] text-white transition-fast hover:opacity-90"
                style={{ background: meta.color }}>
                Open {dept} channel
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

// ─── Automation strip (bottom) ────────────────────────────────────────────────
const TRIGGER_ICON: Record<string, string> = {
  schedule: '⏰', email: '✉', file_watch: '📁', webhook: '🔗',
  twitter_mention: '𝕏', rss: '📡', github: '⚙', stripe: '💳',
  google_calendar: '📅',
};

function fmtRel(ts: number | null): string {
  if (!ts) return 'Never';
  const d = Date.now() - ts * 1000;
  if (d < 60000) return 'Just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function AutomationStrip({
  automations, runningId, loadingAutos,
  onRunNow, onToggle, onOpenAutomations,
}: {
  automations: AutomationRow[]; runningId: string | null; loadingAutos: boolean;
  onRunNow: (a: AutomationRow) => void; onToggle: (a: AutomationRow) => void;
  onOpenAutomations?: () => void;
}) {
  const enabled = automations.filter(a => a.enabled).length;

  return (
    <div
      className="shrink-0 border-t"
      style={{ borderColor: 'var(--nv-border)', background: 'var(--nv-surface)' }}>
      <div className="flex items-center justify-between px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-accent text-xs">⚡</span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--nv-text)' }}>Automations</span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--nv-faint)' }}>
            {loadingAutos ? '…' : `${enabled}/${automations.length} active`}
          </span>
          {runningId && (
            <span className="flex items-center gap-1 text-[9px] text-accent font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> running
            </span>
          )}
        </div>
        {onOpenAutomations && (
          <button
            onClick={onOpenAutomations}
            className="text-[10px] font-mono transition-fast hover:text-accent"
            style={{ color: 'var(--nv-faint)' }}>
            manage →
          </button>
        )}
      </div>

      {loadingAutos ? (
        <div className="px-4 pb-2 text-[11px] font-mono" style={{ color: 'var(--nv-faint)' }}>Loading…</div>
      ) : automations.length === 0 ? (
        <div className="px-4 pb-2 text-[11px]" style={{ color: 'var(--nv-faint)' }}>
          No automations yet.{' '}
          {onOpenAutomations && (
            <button onClick={onOpenAutomations} className="text-accent hover:underline">Create one →</button>
          )}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-thin">
          {automations.map(auto => {
            const running = runningId === auto.id;
            return (
              <div
                key={auto.id}
                className="shrink-0 w-48 p-2.5 rounded-xl border transition-fast"
                style={{
                  background: running ? 'rgba(124,92,255,.07)' : 'var(--nv-bg)',
                  borderColor: running ? '#7C5CFF66' : 'var(--nv-border)',
                  opacity: !auto.enabled && !running ? 0.55 : 1,
                }}>
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs shrink-0">{TRIGGER_ICON[auto.trigger_type] ?? '▶'}</span>
                    <span className="text-[11px] font-medium truncate" style={{ color: 'var(--nv-text)' }}>
                      {auto.name}
                    </span>
                  </div>
                  {running ? (
                    <span className="flex items-center gap-1 text-[9px] font-mono text-accent shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" /> on
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono shrink-0"
                      style={{ color: auto.enabled ? '#22c55e' : 'var(--nv-faint)' }}>
                      {auto.enabled ? 'on' : 'off'}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono" style={{ color: 'var(--nv-faint)' }}>
                    {fmtRel(auto.last_run_at)}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onToggle(auto)}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded border transition-fast"
                      style={{
                        color: 'var(--nv-faint)', borderColor: 'var(--nv-border)',
                      }}>
                      {auto.enabled ? 'pause' : 'on'}
                    </button>
                    <button
                      onClick={() => onRunNow(auto)}
                      disabled={!!runningId}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded border transition-fast disabled:opacity-40"
                      style={{ color: '#7C5CFF', borderColor: '#7C5CFF44' }}>
                      ▶ run
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend() {
  const depts = CATEGORIES.filter(c => c !== 'Boss');
  return (
    <div
      className="absolute left-4 bottom-4 z-20 rounded-xl px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5"
      style={{
        background: 'var(--nv-surface)',
        border: '1px solid var(--nv-border)',
        boxShadow: '0 4px 16px rgba(0,0,0,.18)',
      }}>
      {depts.map(d => (
        <div key={d} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DEPT_META[d].color }} />
          <span className="text-[10.5px]" style={{ color: 'var(--nv-muted)' }}>{d}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  userId: string;
  onSelectAgent: (agent: KrewAgent) => void;
  onClose: () => void;
  onOpenAutomations?: () => void;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OfficeView({ userId, onSelectAgent, onClose, onOpenAutomations }: Props) {
  const [showLinks,    setShowLinks]   = useState(true);
  const [hoverDept,    setHoverDept]   = useState<KrewCategory | null>(null);
  const [panel,        setPanel]       = useState<{ dept: KrewCategory; handle: string } | null>(null);
  const [automations,  setAutomations] = useState<AutomationRow[]>([]);
  const [runningId,    setRunningId]   = useState<string | null>(null);
  const [loadingAutos, setLoadingAutos]= useState(true);
  const [scale,        setScale]       = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => computeLayout(), []);
  const activeDept = hoverDept ?? (panel?.dept ?? null);

  // ── scale the virtual stage to fit the container ──────────────────────────
  useEffect(() => {
    const fit = () => {
      const el = stageRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      setScale(Math.min(width / STAGE_W, height / STAGE_H, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  // ── load automations ──────────────────────────────────────────────────────
  const loadAutomations = useCallback(async () => {
    try {
      const rows = await invoke<AutomationRow[]>('automation_list', { userId });
      setAutomations(rows.filter(r => r.trigger_type !== 'canvas_flow'));
    } catch { /* none yet */ }
    setLoadingAutos(false);
  }, [userId]);

  useEffect(() => { loadAutomations(); }, [loadAutomations]);

  async function handleRunNow(auto: AutomationRow) {
    if (runningId) return;
    setRunningId(auto.id);
    try { await executeAutomation(auto, userId); } catch { /* logged inside */ }
    setRunningId(null);
    loadAutomations();
  }

  async function handleToggle(auto: AutomationRow) {
    try {
      await invoke('automation_toggle', { id: auto.id, enabled: !auto.enabled });
      loadAutomations();
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--nv-bg)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--nv-border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="transition-fast hover:opacity-70" style={{ color: 'var(--nv-faint)' }}>
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--nv-text)' }}>Office</h2>
            <p className="text-[11px] font-mono" style={{ color: 'var(--nv-faint)' }}>
              {KREW_AGENTS.length} agents · {CATEGORIES.filter(c => c !== 'Boss').length} departments
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* mesh / spokes toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: 'var(--nv-surface)' }}>
            {(['Mesh', 'Spokes'] as const).map(label => (
              <button
                key={label}
                onClick={() => setShowLinks(label === 'Mesh')}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-fast"
                style={{
                  background: (label === 'Mesh') === showLinks ? 'var(--nv-text)' : 'transparent',
                  color:      (label === 'Mesh') === showLinks ? 'var(--nv-bg)'   : 'var(--nv-muted)',
                }}>
                {label}
              </button>
            ))}
          </div>

          {onOpenAutomations && (
            <button
              onClick={onOpenAutomations}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-fast text-[11px] font-mono"
              style={{ borderColor: 'var(--nv-border)', background: 'var(--nv-surface)', color: 'var(--nv-muted)' }}>
              <span className="text-accent">⚡</span>
              Automations
              {automations.filter(a => a.enabled).length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-accent text-[9px] font-bold"
                  style={{ background: 'rgba(124,92,255,.18)' }}>
                  {automations.filter(a => a.enabled).length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Graph stage ────────────────────────────────────────────────── */}
      <div ref={stageRef} className="relative flex-1 overflow-hidden">
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: STAGE_W, height: STAGE_H,
            transform: `translate(-50%, -50%) scale(${scale})`,
          }}>
          <Edges layout={layout} activeDept={activeDept} showLinks={showLinks} />

          {layout.agents.map(la => (
            <AgentBox
              key={la.idx} la={la}
              active={activeDept === la.dept}
              dim={!!activeDept && activeDept !== la.dept}
              onEnter={() => setHoverDept(la.dept)}
              onLeave={() => setHoverDept(null)}
              onClick={() => setPanel({ dept: la.dept, handle: agentHandle(la.agent) })}
            />
          ))}

          <BossNode onClick={() => setPanel(null)} />
        </div>

        <Legend />

        <div
          className="absolute right-4 bottom-4 z-20 text-[10.5px] px-3 py-1.5 rounded-lg"
          style={{
            background: 'var(--nv-surface)',
            border: '1px solid var(--nv-border)',
            color: 'var(--nv-faint)',
          }}>
          Hover to highlight · click to open
        </div>
      </div>

      {/* ── Automation strip ───────────────────────────────────────────── */}
      <AutomationStrip
        automations={automations}
        runningId={runningId}
        loadingAutos={loadingAutos}
        onRunNow={handleRunNow}
        onToggle={handleToggle}
        onOpenAutomations={onOpenAutomations}
      />

      {/* ── Side panel ─────────────────────────────────────────────────── */}
      <SidePanel
        dept={panel?.dept ?? null}
        focusHandle={panel?.handle ?? null}
        onClose={() => setPanel(null)}
        onSelectAgent={a => { onSelectAgent(a); setPanel(null); }}
      />
    </div>
  );
}
