import {
  useCallback, useEffect, useRef, useState,
  forwardRef, useImperativeHandle, Component,
} from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeTypes,
  EdgeTypes,
  EdgeProps,
  getBezierPath,
  useReactFlow,
  ReactFlowProvider,
  OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ─── Global flow-space mouse tracker ──────────────────────────────────────
const gMouse = { x: 0, y: 0 };

// ─── Connected services (updated from AutomationModule, read by node components) ─
let gConnected: Set<string> | null = null;   // null = not loaded yet

function checkConnected(services: string[]): boolean {
  if (!gConnected) return true;              // not loaded → no alerts
  return services.some(s => gConnected!.has(s));
}

const AI_SERVICES = ['gemini', 'openai', 'claude'];

const TRIGGER_SERVICE_REQ: Record<string, string[]> = {
  schedule: [], file_watch: [], webhook: [],
  email:            ['gmail'],
  twitter_mention:  ['twitter'],
  rss:              [],
  github:           ['github'],
  stripe:           ['stripe'],
  google_calendar:  ['google_calendar'],
};
const OUTPUT_SERVICE_REQ: Record<string, string[]> = {
  notification: [], file: [],
  email_reply:    ['gmail'],
  notion:         ['notion'],
  slack:          ['slack'],
  twitter_post:   ['twitter'],
  twitter_reply:  ['twitter'],
  linkedin_post:  ['linkedin'],
  discord:        ['discord'],
  google_sheets:  ['google_sheets'],
  twilio_sms:     ['twilio'],
  telegram:       ['telegram'],
  hubspot:        ['hubspot'],
};

function NotConnectedBadge({ label }: { label: string }) {
  return (
    <span
      title={`${label} not connected — go to Connect Apps`}
      className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-nv-red/20 border border-nv-red/50 shrink-0"
    >
      <span className="text-[8px] font-bold text-nv-red leading-none">!</span>
    </span>
  );
}

// ─── Pointer-based drag state (replaces HTML5 DnD — works in Tauri WebView2) ─
// Tauri's WebView2 on Windows routes DnD through OLE, causing the OS 🚫 cursor
// regardless of e.preventDefault(). Pointer events bypass this entirely.
let gDrag: { type: string; data: Record<string, unknown> } | null = null;
let gDragGhost: HTMLElement | null = null;
let gOverCanvas = false;
let gDropCallback: ((x: number, y: number) => void) | null = null;
let gDeleteNode: ((id: string) => void) | null = null;

function startPaletteDrag(
  e: React.MouseEvent,
  type: string,
  data: Record<string, unknown>,
  _accentVar: string,
) {
  e.preventDefault();
  gDrag = { type, data };

  // Create floating ghost that follows cursor
  const ghost = document.createElement('div');
  ghost.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'pointer-events:none',
    'background:var(--nv-surface)',
    'border:1.5px solid var(--nv-border)',
    'border-radius:10px',
    'padding:5px 12px',
    'font-size:11px',
    'font-family:inherit',
    'font-weight:600',
    `color:var(--nv-text)`,
    'opacity:0.9',
    'box-shadow:0 8px 28px rgba(0,0,0,0.35)',
    'white-space:nowrap',
    `left:${e.clientX}px`,
    `top:${e.clientY}px`,
    'transform:translate(-50%,-130%)',
    'transition:none',
  ].join(';');
  ghost.textContent = String(data.label ?? type);
  document.body.appendChild(ghost);
  gDragGhost = ghost;
  document.body.style.cursor = 'grabbing';

  const onMove = (ev: MouseEvent) => {
    if (gDragGhost) {
      gDragGhost.style.left = ev.clientX + 'px';
      gDragGhost.style.top  = ev.clientY + 'px';
    }
  };

  const onUp = (ev: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (gDragGhost) { document.body.removeChild(gDragGhost); gDragGhost = null; }
    document.body.style.cursor = '';

    if (gDrag && gOverCanvas && gDropCallback) {
      gDropCallback(ev.clientX, ev.clientY);
    }
    gDrag = null;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ─── Theme-aware colorMode hook ────────────────────────────────────────────
function useColorMode(): 'dark' | 'light' {
  const [mode, setMode] = useState<'dark' | 'light'>(() =>
    document.documentElement.classList.contains('paper') ? 'light' : 'dark'
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setMode(document.documentElement.classList.contains('paper') ? 'light' : 'dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

// ─── Node type accent colours (for type identification only) ──────────────
const NODE_ACCENT: Record<string, string> = {
  trigger:   '#22c55e',
  ai_action: '#7C5CFF',
  condition: '#eab308',
  output:    '#38bdf8',
  loop:      '#f97316',
  http:      '#06b6d4',
  transform: '#a855f7',
  approval:  '#ec4899',
  subagent:  '#14b8a6',
};

// ─── Line Edge ─────────────────────────────────────────────────────────────
function LineEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const color = NODE_ACCENT[(data as Record<string, string>)?.srcType ?? 'ai_action'] ?? '#7C5CFF';
  const markerId = `arrow-${color.replace('#', '')}`;

  return (
    <g>
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={color} opacity={0.85} />
        </marker>
      </defs>
      {/* fat invisible path for easier click/hover targeting */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={20} className="react-flow__edge-interaction" />
      {/* visible line */}
      <path
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeOpacity={0.75}
        markerEnd={`url(#${markerId})`}
        style={{ filter: `drop-shadow(0 0 3px ${color}40)` }}
      />
    </g>
  );
}

// ─── Handle style (accent colour) ─────────────────────────────────────────
const H = { width: 9, height: 9, background: '#7C5CFF', border: '2px solid var(--nv-bg)', borderRadius: '50%' };

// ─── Shared delete button ──────────────────────────────────────────────────
function NodeDeleteBtn({ id }: { id: string }) {
  return (
    <button
      onMouseDown={e => { e.stopPropagation(); gDeleteNode?.(id); }}
      className="ml-auto text-nv-faint hover:text-nv-red text-[13px] leading-none transition-fast px-0.5"
      title="Delete node"
    >×</button>
  );
}

// ─── Service icon maps ─────────────────────────────────────────────────────
const TRIGGER_ICON: Record<string, string> = {
  schedule: '⏰', email: '✉', file_watch: '📁', webhook: '🔗', twitter_mention: '𝕏',
  rss: '📡', github: '⚙', stripe: '💳', google_calendar: '📅',
};
const TRIGGER_SERVICE: Record<string, string> = {
  schedule: 'Scheduler', email: 'Gmail', file_watch: 'File System', webhook: 'HTTP', twitter_mention: 'X (Twitter)',
  rss: 'RSS Feed', github: 'GitHub', stripe: 'Stripe', google_calendar: 'Google Calendar',
};
const OUTPUT_ICON: Record<string, string> = {
  notification: '🔔', file: '💾', email_reply: '✉', notion: 'N', slack: '#',
  twitter_post: '𝕏', twitter_reply: '𝕏↩', linkedin_post: 'in',
  discord: '💬', google_sheets: '📊', twilio_sms: '📱', telegram: '✈', hubspot: '🏷',
};
const OUTPUT_SERVICE: Record<string, string> = {
  notification: 'Desktop', file: 'File', email_reply: 'Gmail', notion: 'Notion', slack: 'Slack',
  twitter_post: 'X (Twitter)', twitter_reply: 'X (Twitter)', linkedin_post: 'LinkedIn',
  discord: 'Discord', google_sheets: 'Google Sheets', twilio_sms: 'Twilio', telegram: 'Telegram', hubspot: 'HubSpot',
};
const ACTION_ICON: Record<string, string> = {
  summarise: '📝', reply: '↩', extract: '🔍', classify: '🏷', report: '📊', translate: '🌐',
};

// ─── Node components ───────────────────────────────────────────────────────
function TriggerNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  const tType   = String(data.triggerType ?? '');
  const icon    = TRIGGER_ICON[tType] ?? '⚡';
  const service = TRIGGER_SERVICE[tType] ?? tType;
  const req     = TRIGGER_SERVICE_REQ[tType] ?? [];
  const missing = req.length > 0 && !checkConnected(req);
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[172px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-nv-green shadow-[0_0_18px_rgba(34,197,94,0.2)]' : missing ? 'border-nv-red/40 hover:border-nv-red/60' : 'border-nv-border hover:border-nv-green/40'
    }`}>
      {/* Service badge strip */}
      <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b ${missing ? 'border-nv-red/20 bg-nv-red/5' : 'border-nv-green/15 bg-nv-green/5'}`}>
        <span className="text-[11px] leading-none">{icon}</span>
        <span className={`text-[9px] font-mono font-semibold ${missing ? 'text-nv-red' : 'text-nv-green'}`}>{service}</span>
        {missing && <NotConnectedBadge label={req.join(', ')} />}
        <div className="flex-1" />
        <svg viewBox="0 0 12 12" fill="currentColor" className={`w-2.5 h-2.5 shrink-0 ${missing ? 'text-nv-red/60' : 'text-nv-green/60'}`}>
          <path d="M7 1L2 7h4l-1 4L11 5H7z"/>
        </svg>
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Trigger</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.subtitle && <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.subtitle)}</p>}
        {missing && <p className="text-[9px] text-nv-red font-mono mt-1">Connect {req.join(', ')} in Connect Apps</p>}
      </div>
      <Handle type="source" position={Position.Right} style={H} />
    </div>
  );
}

function AIActionNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  const action  = String(data.action ?? '');
  const icon    = ACTION_ICON[action] ?? '🤖';
  const service = String(data.service ?? '');
  const noAI    = gConnected !== null && !checkConnected(AI_SERVICES);
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[172px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-accent shadow-[0_0_18px_rgba(124,92,255,0.2)]' : noAI ? 'border-nv-yellow/40 hover:border-nv-yellow/60' : 'border-nv-border hover:border-accent/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      {/* Header strip */}
      <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b ${noAI ? 'border-nv-yellow/20 bg-nv-yellow/5' : 'border-accent/15 bg-accent/5'}`}>
        <span className="text-[11px] leading-none">{icon}</span>
        {service && <span className="text-[9px] font-mono text-accent/80 font-semibold">{service}</span>}
        {noAI && <NotConnectedBadge label="AI key" />}
        <div className="flex-1" />
        <svg viewBox="0 0 12 12" fill="currentColor" className={`w-2.5 h-2.5 shrink-0 ${noAI ? 'text-nv-yellow/60' : 'text-accent/60'}`}>
          <path d="M6 1l1.1 3.6L11 6 7.1 7.4 6 11 4.9 7.4 1 6l3.9-1.4z"/>
        </svg>
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">AI Step</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.prompt && <p className="text-[10px] text-nv-muted mt-0.5 line-clamp-2 leading-relaxed">{String(data.prompt)}</p>}
        {noAI && <p className="text-[9px] text-nv-yellow font-mono mt-1">Add an AI key in Connect Apps</p>}
      </div>
      <Handle type="source" position={Position.Right} style={H} />
    </div>
  );
}

// ─── Condition node — two clearly-labelled branch handles ─────────────────
// Layout (approx px): header≈56px + border 1px + Yes row 32px + No row 32px = 121px
// Handle top% = row-centre / total → Yes ≈ 59%, No ≈ 86%
const H_YES = { ...H, background: '#22c55e' };
const H_NO  = { ...H, background: 'rgb(239,68,68)' };

function ConditionNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-nv-yellow shadow-[0_0_18px_rgba(234,179,8,0.2)]' : 'border-nv-border hover:border-nv-yellow/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />

      {/* Header */}
      <div className="px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-nv-yellow text-[10px] leading-none">◆</span>
          <span className="text-[9px] font-mono text-nv-muted uppercase tracking-widest">Condition</span>
          {selected && <NodeDeleteBtn id={id} />}
        </div>
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
      </div>

      {/* Branch rows — each row aligns with its coloured handle */}
      <div className="border-t border-nv-border/60">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-nv-border/40">
          <div className="w-2 h-2 rounded-full bg-nv-green shrink-0" />
          <span className="text-[10px] text-nv-green font-mono font-semibold flex-1">Yes</span>
          <span className="text-[9px] text-nv-green/60 font-mono">→</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-nv-red shrink-0" />
          <span className="text-[10px] text-nv-red font-mono font-semibold flex-1">No</span>
          <span className="text-[9px] text-nv-red/60 font-mono">→</span>
        </div>
      </div>

      {/* Handles aligned to the centre of each branch row */}
      <Handle type="source" position={Position.Right} id="yes" style={{ ...H_YES, top: '59%' }} />
      <Handle type="source" position={Position.Right} id="no"  style={{ ...H_NO,  top: '84%' }} />
    </div>
  );
}

// ─── Loop / Iterator node ──────────────────────────────────────────────────
const H_EACH = { ...H, background: '#f97316' };
const H_DONE = { ...H, background: '#6b7280' };

function LoopNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-orange-400 shadow-[0_0_18px_rgba(249,115,22,0.2)]' : 'border-nv-border hover:border-orange-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-orange-400/15 bg-orange-400/5">
        <span className="text-[11px] leading-none">↻</span>
        <span className="text-[9px] font-mono text-orange-400 font-semibold">Loop</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Iterator</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.loopSource && <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.loopSource)}</p>}
      </div>
      {/* Two source handles: "each" and "done" */}
      <Handle type="source" position={Position.Right} id="each" style={{ ...H_EACH, top: '40%' }} />
      <Handle type="source" position={Position.Right} id="done" style={{ ...H_DONE, top: '75%' }} />
    </div>
  );
}

// ─── HTTP Request node ────────────────────────────────────────────────────
function HTTPRequestNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  const method = String(data.method ?? 'GET');
  const methodColors: Record<string, string> = { GET: 'text-cyan-400', POST: 'text-green-400', PUT: 'text-yellow-400', PATCH: 'text-orange-400', DELETE: 'text-red-400' };
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-cyan-400 shadow-[0_0_18px_rgba(6,182,212,0.2)]' : 'border-nv-border hover:border-cyan-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-cyan-400/15 bg-cyan-400/5">
        <span className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded bg-nv-bg ${methodColors[method] ?? 'text-cyan-400'}`}>{method}</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">HTTP Request</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.url && <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.url).slice(0, 30)}</p>}
      </div>
      <Handle type="source" position={Position.Right} style={H} />
    </div>
  );
}

// ─── Data Transform node ──────────────────────────────────────────────────
function DataTransformNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-purple-400 shadow-[0_0_18px_rgba(168,85,247,0.2)]' : 'border-nv-border hover:border-purple-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-purple-400/15 bg-purple-400/5">
        <span className="text-[11px] leading-none">⚡</span>
        <span className="text-[9px] font-mono text-purple-400 font-semibold">Transform</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Transform</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.transformType && <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.transformType).replace('_', ' ')}</p>}
      </div>
      <Handle type="source" position={Position.Right} style={H} />
    </div>
  );
}

// ─── Human Approval node ──────────────────────────────────────────────────
const H_APPROVED = { ...H, background: '#ec4899' };
const H_REJECTED = { ...H, background: 'rgb(239,68,68)' };

function HumanApprovalNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-pink-400 shadow-[0_0_18px_rgba(236,72,153,0.2)]' : 'border-nv-border hover:border-pink-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-pink-400/15 bg-pink-400/5">
        <span className="text-[11px] leading-none">👤</span>
        <span className="text-[9px] font-mono text-pink-400 font-semibold">Approval</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Human Approval</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        <p className="text-[9px] text-nv-faint font-mono mt-0.5">Flow pauses here</p>
      </div>
      <Handle type="source" position={Position.Right} id="approved" style={{ ...H_APPROVED, top: '40%' }} />
      <Handle type="source" position={Position.Right} id="rejected" style={{ ...H_REJECTED, top: '75%' }} />
    </div>
  );
}

// ─── Sub-Agent node ───────────────────────────────────────────────────────
function SubAgentNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[180px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-teal-400 shadow-[0_0_18px_rgba(20,184,166,0.2)]' : 'border-nv-border hover:border-teal-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b border-teal-400/15 bg-teal-400/5">
        <span className="text-[11px] leading-none">🤖</span>
        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full bg-teal-400/10 text-teal-400">{data.agentCount ?? 2} agents</span>
        <div className="flex-1" />
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Manager Agent</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {(data.goal || data.strategy) && (
          <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.goal || data.strategy)}</p>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={H} />
    </div>
  );
}

function OutputNode({ id, data, selected }: { id: string; data: Record<string, any>; selected: boolean }) {
  const oType   = String(data.outputType ?? '');
  const icon    = OUTPUT_ICON[oType] ?? '📤';
  const service = OUTPUT_SERVICE[oType] ?? oType;
  const req     = OUTPUT_SERVICE_REQ[oType] ?? [];
  const missing = req.length > 0 && !checkConnected(req);
  return (
    <div className={`rounded-xl border-2 bg-nv-surface min-w-[172px] max-w-[220px] select-none transition-all overflow-hidden ${
      selected ? 'border-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.2)]' : missing ? 'border-nv-red/40 hover:border-nv-red/60' : 'border-nv-border hover:border-sky-400/40'
    }`}>
      <Handle type="target" position={Position.Left} style={H} />
      {/* Service badge strip */}
      <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1.5 border-b ${missing ? 'border-nv-red/20 bg-nv-red/5' : 'border-sky-400/15 bg-sky-400/5'}`}>
        <span className="text-[11px] leading-none">{icon}</span>
        <span className={`text-[9px] font-mono font-semibold ${missing ? 'text-nv-red' : 'text-sky-400'}`}>{service}</span>
        {missing && <NotConnectedBadge label={req.join(', ')} />}
        <div className="flex-1" />
        <svg viewBox="0 0 12 12" fill="none" className={`w-2.5 h-2.5 shrink-0 ${missing ? 'text-nv-red/60' : 'text-sky-400/60'}`}>
          <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-[8px] font-mono text-nv-muted uppercase tracking-widest">Output</span>
        {selected && <NodeDeleteBtn id={id} />}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold text-nv-text leading-snug">{String(data.label)}</p>
        {data.subtitle && <p className="text-[10px] text-nv-muted font-mono mt-0.5 truncate">{String(data.subtitle)}</p>}
        {missing && <p className="text-[9px] text-nv-red font-mono mt-1">Connect {req.join(', ')} in Connect Apps</p>}
      </div>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  trigger:   TriggerNode as any,
  ai_action: AIActionNode as any,
  condition: ConditionNode as any,
  output:    OutputNode as any,
  loop:      LoopNode as any,
  http:      HTTPRequestNode as any,
  transform: DataTransformNode as any,
  approval:  HumanApprovalNode as any,
  subagent:  SubAgentNode as any,
};

const EDGE_TYPES: EdgeTypes = { line: LineEdge };

// ─── Palette ───────────────────────────────────────────────────────────────
interface PaletteItem { type: string; label: string; sub: string; accent: string; defaultData: Record<string, unknown> }

const PALETTE: PaletteItem[] = [
  // Triggers
  { type: 'trigger',   label: 'Schedule',        sub: 'set time',       accent: 'nv-green', defaultData: { label: 'Schedule',        subtitle: 'Every day at 09:00', triggerType: 'schedule'       } },
  { type: 'trigger',   label: 'Email received',  sub: 'inbox filter',   accent: 'nv-green', defaultData: { label: 'Email received',  subtitle: 'inbox filter',      triggerType: 'email'          } },
  { type: 'trigger',   label: 'File added',      sub: 'watch folder',   accent: 'nv-green', defaultData: { label: 'File added',      subtitle: 'watch folder',      triggerType: 'file_watch'     } },
  { type: 'trigger',   label: 'Webhook',         sub: '/my-hook',       accent: 'nv-green', defaultData: { label: 'Webhook',         subtitle: '/my-hook',          triggerType: 'webhook'        } },
  { type: 'trigger',   label: 'X mention',       sub: '@mention',       accent: 'nv-green', defaultData: { label: 'X mention',       subtitle: 'X (Twitter)',       triggerType: 'twitter_mention'} },
  { type: 'trigger',   label: 'RSS Feed',        sub: 'new article',    accent: 'nv-green', defaultData: { label: 'RSS Feed',        subtitle: 'new article',       triggerType: 'rss'            } },
  { type: 'trigger',   label: 'GitHub',          sub: 'PR / issue',     accent: 'nv-green', defaultData: { label: 'GitHub event',    subtitle: 'PR or issue',       triggerType: 'github'         } },
  { type: 'trigger',   label: 'Stripe payment',  sub: 'new payment',    accent: 'nv-green', defaultData: { label: 'Stripe payment',  subtitle: 'payment received',  triggerType: 'stripe'         } },
  { type: 'trigger',   label: 'Google Calendar', sub: 'event starts',   accent: 'nv-green', defaultData: { label: 'Calendar event',  subtitle: 'event starts',      triggerType: 'google_calendar'} },
  // AI Actions
  { type: 'ai_action', label: 'Summarise',       sub: 'AI action',      accent: 'accent',   defaultData: { label: 'Summarise',       action: 'summarise', prompt: '' } },
  { type: 'ai_action', label: 'Draft reply',     sub: 'AI action',      accent: 'accent',   defaultData: { label: 'Draft reply',     action: 'reply',     prompt: '' } },
  { type: 'ai_action', label: 'Extract data',    sub: 'AI action',      accent: 'accent',   defaultData: { label: 'Extract data',    action: 'extract',   prompt: '' } },
  { type: 'ai_action', label: 'Classify',        sub: 'AI action',      accent: 'accent',   defaultData: { label: 'Classify',        action: 'classify',  prompt: '' } },
  { type: 'ai_action', label: 'Generate report', sub: 'AI action',      accent: 'accent',   defaultData: { label: 'Generate report', action: 'report',    prompt: '' } },
  // Logic
  { type: 'condition', label: 'If / Else',       sub: 'branch logic',   accent: 'nv-yellow',defaultData: { label: 'If / Else',       condition: '', filter: 'contains', keyword: '' } },
  { type: 'loop',      label: 'Loop / Iterator', sub: 'each item',      accent: 'orange-400',defaultData: { label: 'For each item',  loopSource: 'previous step', loopField: '' } },
  // Outputs
  { type: 'output',    label: 'Notification',    sub: 'desktop alert',  accent: 'sky-400',  defaultData: { label: 'Notification',    outputType: 'notification',  subtitle: 'desktop alert'  } },
  { type: 'output',    label: 'Send email',      sub: 'email reply',    accent: 'sky-400',  defaultData: { label: 'Send email',      outputType: 'email_reply',   subtitle: 'email reply'    } },
  { type: 'output',    label: 'Save to file',    sub: 'write file',     accent: 'sky-400',  defaultData: { label: 'Save to file',    outputType: 'file',          subtitle: 'write file'     } },
  { type: 'output',    label: 'Notion page',     sub: 'create page',    accent: 'sky-400',  defaultData: { label: 'Notion page',     outputType: 'notion',        subtitle: 'create page'    } },
  { type: 'output',    label: 'Slack post',      sub: 'post message',   accent: 'sky-400',  defaultData: { label: 'Slack post',      outputType: 'slack',         subtitle: 'post message'   } },
  { type: 'output',    label: 'X post',          sub: 'tweet',          accent: 'sky-400',  defaultData: { label: 'X post',          outputType: 'twitter_post',  subtitle: 'X (Twitter)'    } },
  { type: 'output',    label: 'X reply',         sub: 'reply tweet',    accent: 'sky-400',  defaultData: { label: 'X reply',         outputType: 'twitter_reply', subtitle: 'X (Twitter)'    } },
  { type: 'output',    label: 'LinkedIn post',   sub: 'publish post',   accent: 'sky-400',  defaultData: { label: 'LinkedIn post',   outputType: 'linkedin_post', subtitle: 'LinkedIn'       } },
  { type: 'output',    label: 'Discord',         sub: 'post message',   accent: 'sky-400',  defaultData: { label: 'Discord',         outputType: 'discord',       subtitle: 'Discord channel'} },
  { type: 'output',    label: 'Google Sheets',   sub: 'append row',     accent: 'sky-400',  defaultData: { label: 'Google Sheets',   outputType: 'google_sheets', subtitle: 'append row'     } },
  { type: 'output',    label: 'SMS (Twilio)',     sub: 'send SMS',       accent: 'sky-400',  defaultData: { label: 'SMS',             outputType: 'twilio_sms',    subtitle: 'Twilio SMS'     } },
  { type: 'output',    label: 'Telegram',        sub: 'bot message',    accent: 'sky-400',  defaultData: { label: 'Telegram',        outputType: 'telegram',      subtitle: 'Telegram bot'   } },
  { type: 'output',    label: 'HubSpot CRM',     sub: 'create contact', accent: 'sky-400',  defaultData: { label: 'HubSpot',         outputType: 'hubspot',       subtitle: 'HubSpot CRM'    } },
  // Utility
  { type: 'http',      label: 'HTTP Request',    sub: 'GET / POST',     accent: 'cyan-400', defaultData: { label: 'HTTP Request',    method: 'GET', url: '', headers: '', body: '' } },
  { type: 'transform', label: 'Data Transform',  sub: 'parse / format', accent: 'purple-400',defaultData: { label: 'Data Transform', transformType: 'json_extract', expression: '' } },
  { type: 'approval',  label: 'Human Approval',  sub: 'pause + review', accent: 'pink-400', defaultData: { label: 'Human Approval',  notifyEmail: '', message: '' } },
  { type: 'subagent',  label: 'Manager Agent',   sub: 'multi-agent',    accent: 'teal-400', defaultData: { label: 'Manager Agent',   goal: '', agentCount: 2, strategy: 'parallel' } },
];

const GROUPS: Record<string, { label: string; accentClass: string }> = {
  trigger:   { label: 'Triggers',    accentClass: 'text-nv-green'   },
  ai_action: { label: 'AI Actions',  accentClass: 'text-accent'     },
  condition: { label: 'Logic',       accentClass: 'text-nv-yellow'  },
  loop:      { label: 'Loop',        accentClass: 'text-orange-400' },
  output:    { label: 'Outputs',     accentClass: 'text-sky-400'    },
  http:      { label: 'HTTP',        accentClass: 'text-cyan-400'   },
  transform: { label: 'Transform',   accentClass: 'text-purple-400' },
  approval:  { label: 'Approval',    accentClass: 'text-pink-400'   },
  subagent:  { label: 'Multi-Agent', accentClass: 'text-teal-400'   },
};

function NodePalette() {
  const grouped: Record<string, PaletteItem[]> = {};
  for (const item of PALETTE) { (grouped[item.type] ??= []).push(item); }
  const order = ['trigger', 'ai_action', 'condition', 'loop', 'output', 'http', 'transform', 'approval', 'subagent'];

  return (
    <div className="w-[168px] shrink-0 border-r border-nv-border bg-nv-surface flex flex-col overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-nv-border">
        <p className="text-[10px] font-mono text-nv-muted uppercase tracking-widest">Nodes</p>
        <p className="text-[9px] text-nv-muted mt-0.5">Hold + drag onto canvas</p>
      </div>
      {order.map(type => (
        <div key={type} className="px-2 pt-3 pb-1">
          <p className={`text-[9px] font-mono uppercase tracking-widest px-1 mb-1.5 ${GROUPS[type].accentClass}`}>
            {GROUPS[type].label}
          </p>
          <div className="flex flex-col gap-1">
            {grouped[type]?.map(item => (
              <div
                key={`${item.type}-${item.label}`}
                onMouseDown={e => startPaletteDrag(e, item.type, item.defaultData, item.accent)}
                className="rounded-lg border border-nv-border bg-nv-bg px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-nv-border/80 hover:bg-nv-surface2 transition-fast select-none"
              >
                <p className="text-[11px] font-semibold text-nv-text leading-snug">{item.label}</p>
                <p className="text-[9px] text-nv-muted mt-0.5">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Canvas schedule helpers ───────────────────────────────────────────────
const CANVAS_DAY_OPTS = [
  { label: 'Every day',          val: 'daily'    },
  { label: 'Weekdays (Mon–Fri)', val: 'weekdays' },
  { label: 'Every Monday',       val: '1'        },
  { label: 'Every Tuesday',      val: '2'        },
  { label: 'Every Wednesday',    val: '3'        },
  { label: 'Every Thursday',     val: '4'        },
  { label: 'Every Friday',       val: '5'        },
  { label: 'Every Saturday',     val: '6'        },
  { label: 'Every Sunday',       val: '0'        },
];
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function buildSchedSubtitle(freq: string, hour: string): string {
  const t = `${hour}:00`;
  if (freq === 'daily')    return `Every day at ${t}`;
  if (freq === 'weekdays') return `Weekdays at ${t}`;
  const d = parseInt(freq);
  return `Every ${DAY_NAMES[d] ?? 'day'} at ${t}`;
}

function parseSchedSubtitle(sub: string): { freq: string; hour: string } {
  const hm = sub.match(/at (\d{2}):/);
  const hour = hm ? hm[1] : '09';
  if (sub.startsWith('Every day'))  return { freq: 'daily',    hour };
  if (sub.startsWith('Weekday'))    return { freq: 'weekdays', hour };
  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (sub.includes(DAY_NAMES[i])) return { freq: String(i), hour };
  }
  return { freq: 'daily', hour };
}

const cfgInputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-nv-bg border border-nv-border text-nv-text text-[10px] font-mono focus:outline-none focus:border-accent placeholder:text-nv-faint transition-fast';
const cfgSelectCls = 'w-full px-2.5 py-1.5 rounded-lg bg-nv-bg border border-nv-border text-nv-text text-[11px] focus:outline-none focus:border-accent transition-fast';
const cfgLabelCls = 'text-[9px] font-mono text-nv-muted uppercase tracking-wider block';

// ─── Node Config Panel ─────────────────────────────────────────────────────
function NodeConfig({
  node, onUpdate, onDelete,
}: { node: Node | null; onUpdate: (id: string, data: Record<string, any>) => void; onDelete: (id: string) => void }) {
  if (!node) {
    return (
      <div className="w-[196px] shrink-0 border-l border-nv-border bg-nv-surface flex items-center justify-center">
        <p className="text-[10px] text-nv-muted font-mono text-center px-4 leading-relaxed">
          Click a node<br/>to configure it
        </p>
      </div>
    );
  }

  const d = node.data as Record<string, any>;
  const type = node.type as string;

  return (
    <div className="w-[196px] shrink-0 border-l border-nv-border bg-nv-surface overflow-y-auto">
      <div className="px-3 py-2.5 border-b border-nv-border flex items-center justify-between">
        <p className="text-[10px] font-mono text-nv-muted uppercase tracking-widest">{type.replace('_', ' ')}</p>
        <button onClick={() => onDelete(node.id)} className="text-[9px] font-mono text-nv-muted hover:text-nv-red transition-fast">delete</button>
      </div>
      <div className="px-3 py-3 space-y-3">
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-nv-muted uppercase tracking-wider block">Label</label>
          <input value={String(d.label ?? '')} onChange={e => onUpdate(node.id, { ...d, label: e.target.value })}
            className="w-full px-2.5 py-1.5 rounded-lg bg-nv-bg border border-nv-border text-nv-text text-[11px] focus:outline-none focus:border-accent transition-fast" />
        </div>

        {type === 'trigger' && (() => {
          const trigType = String(d.triggerType ?? 'schedule');
          const { freq, hour } = parseSchedSubtitle(String(d.subtitle ?? ''));
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Trigger type</label>
                <select value={trigType} onChange={e => onUpdate(node.id, { ...d, triggerType: e.target.value, subtitle: e.target.value === 'schedule' ? buildSchedSubtitle(freq, hour) : d.subtitle })}
                  className={cfgSelectCls}>
                  <option value="schedule">Schedule</option>
                  <option value="email">Email received</option>
                  <option value="file_watch">File added</option>
                  <option value="webhook">Webhook</option>
                  <option value="twitter_mention">X @mention</option>
                  <option value="rss">RSS Feed</option>
                  <option value="github">GitHub event</option>
                  <option value="stripe">Stripe payment</option>
                  <option value="google_calendar">Google Calendar</option>
                </select>
              </div>

              {trigType === 'schedule' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Run on</label>
                    <select value={freq}
                      onChange={e => onUpdate(node.id, { ...d, subtitle: buildSchedSubtitle(e.target.value, hour) })}
                      className={cfgSelectCls}>
                      {CANVAS_DAY_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>At time</label>
                    <select value={hour}
                      onChange={e => onUpdate(node.id, { ...d, subtitle: buildSchedSubtitle(freq, e.target.value) })}
                      className={cfgSelectCls}>
                      {Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')).map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {trigType === 'email' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>From email (optional)</label>
                  <input value={String(d.subtitle ?? '')} onChange={e => onUpdate(node.id, { ...d, subtitle: e.target.value })}
                    type="email" placeholder="client@company.com" className={cfgInputCls} />
                </div>
              )}

              {trigType === 'file_watch' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Folder path</label>
                  <input value={String(d.subtitle ?? '')} onChange={e => onUpdate(node.id, { ...d, subtitle: e.target.value })}
                    placeholder="C:\Users\you\Downloads" className={cfgInputCls} />
                </div>
              )}

              {trigType === 'webhook' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Path</label>
                  <div className="flex items-center rounded-lg bg-nv-bg border border-nv-border overflow-hidden">
                    <span className="text-[8px] text-nv-faint font-mono px-2 py-1.5 bg-nv-surface border-r border-nv-border shrink-0">:3141</span>
                    <input value={String(d.subtitle ?? '')} onChange={e => onUpdate(node.id, { ...d, subtitle: e.target.value.startsWith('/') ? e.target.value : '/' + e.target.value })}
                      placeholder="/my-hook" className="flex-1 px-2 py-1.5 bg-transparent text-nv-text text-[10px] font-mono focus:outline-none" />
                  </div>
                </div>
              )}

              {trigType === 'rss' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Feed URL</label>
                  <input value={String(d.subtitle ?? '')} onChange={e => onUpdate(node.id, { ...d, subtitle: e.target.value })}
                    placeholder="https://example.com/feed.xml" className={cfgInputCls} />
                  <p className="text-[9px] text-nv-faint font-mono">Polls for new articles each run.</p>
                </div>
              )}

              {trigType === 'github' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Repository (owner/repo)</label>
                    <input value={String(d.githubRepo ?? '')} onChange={e => onUpdate(node.id, { ...d, githubRepo: e.target.value })}
                      placeholder="octocat/hello-world" className={cfgInputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Event type</label>
                    <select value={String(d.githubEvent ?? 'pull_request')} onChange={e => onUpdate(node.id, { ...d, githubEvent: e.target.value })} className={cfgSelectCls}>
                      <option value="pull_request">Pull request opened</option>
                      <option value="issue">Issue created</option>
                      <option value="push">Push to branch</option>
                      <option value="release">New release</option>
                    </select>
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect GitHub in Connect Apps.</p>
                </>
              )}

              {trigType === 'stripe' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Event filter</label>
                  <select value={String(d.stripeEvent ?? 'payment_intent.succeeded')} onChange={e => onUpdate(node.id, { ...d, stripeEvent: e.target.value })} className={cfgSelectCls}>
                    <option value="payment_intent.succeeded">Payment succeeded</option>
                    <option value="customer.subscription.created">Subscription created</option>
                    <option value="invoice.payment_failed">Payment failed</option>
                    <option value="checkout.session.completed">Checkout completed</option>
                  </select>
                  <p className="text-[9px] text-nv-faint font-mono">Connect Stripe in Connect Apps.</p>
                </div>
              )}

              {trigType === 'google_calendar' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Calendar ID (optional)</label>
                    <input value={String(d.calendarId ?? '')} onChange={e => onUpdate(node.id, { ...d, calendarId: e.target.value })}
                      placeholder="primary" className={cfgInputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Look-ahead (minutes)</label>
                    <input type="number" value={String(d.lookaheadMins ?? '30')} onChange={e => onUpdate(node.id, { ...d, lookaheadMins: e.target.value })}
                      placeholder="30" className={cfgInputCls} />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Fires when an event starts within the look-ahead window. Connect Google Calendar in Connect Apps.</p>
                </>
              )}

              {trigType === 'twitter_mention' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Filter keyword <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                    <input
                      value={String(d.twitter_filter ?? '')}
                      onChange={e => onUpdate(node.id, { ...d, twitter_filter: e.target.value, subtitle: e.target.value || 'X (Twitter)' })}
                      placeholder="e.g. founder, startup, AI"
                      className={cfgInputCls}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Pitch file path <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                    <input
                      value={String(d.pitch_file_path ?? '')}
                      onChange={e => onUpdate(node.id, { ...d, pitch_file_path: e.target.value })}
                      placeholder="C:\Users\you\PRODUCT-DETAILS.MD"
                      className={`${cfgInputCls} font-mono`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Notion CRM database <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                    <input
                      value={String(d.notion_crm_db ?? '')}
                      onChange={e => onUpdate(node.id, { ...d, notion_crm_db: e.target.value })}
                      placeholder="https://notion.so/your-crm-id"
                      className={cfgInputCls}
                    />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono pt-1">
                    Polls your X @mentions each run. Connect X in Connect Apps first.
                  </p>
                </>
              )}
            </>
          );
        })()}

        {type === 'ai_action' && (() => {
          const action = String(d.action ?? 'summarise');
          const placeholders: Record<string, string> = {
            summarise: 'e.g. Keep it under 3 bullet points, focus on action items',
            reply:     'e.g. Reply professionally, ask for a follow-up meeting',
            extract:   'e.g. Pull out: name, date, total amount',
            classify:  'e.g. Label as: urgent / normal / low priority',
            report:    'e.g. Weekly summary with key metrics and next steps',
            translate: 'e.g. Translate to Hindi, keep a professional tone',
          };
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>What should AI do?</label>
                <select value={action} onChange={e => onUpdate(node.id, { ...d, action: e.target.value })} className={cfgSelectCls}>
                  <option value="summarise">Summarise the content</option>
                  <option value="reply">Draft a reply</option>
                  <option value="extract">Extract key data</option>
                  <option value="classify">Classify / label it</option>
                  <option value="report">Generate a report</option>
                  <option value="translate">Translate</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Extra instructions (optional)</label>
                <textarea value={String(d.prompt ?? '')} onChange={e => onUpdate(node.id, { ...d, prompt: e.target.value })}
                  rows={4} placeholder={placeholders[action] ?? 'Add any extra instructions…'}
                  className={`${cfgInputCls} resize-none leading-relaxed`} style={{ height: 'auto' }} />
              </div>
            </>
          );
        })()}

        {type === 'condition' && (() => {
          const filter = String(d.filter ?? 'contains');
          const keyword = String(d.keyword ?? '');
          const needsKeyword = ['contains', 'not_contains', 'starts_with', 'ends_with'].includes(filter);
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>If the content…</label>
                <select value={filter} onChange={e => onUpdate(node.id, { ...d, filter: e.target.value })} className={cfgSelectCls}>
                  <option value="contains">Contains a keyword</option>
                  <option value="not_contains">Does NOT contain keyword</option>
                  <option value="starts_with">Starts with</option>
                  <option value="ends_with">Ends with</option>
                  <option value="not_empty">Is not empty (any content)</option>
                  <option value="always">Always pass through</option>
                </select>
              </div>
              {needsKeyword && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Keyword</label>
                  <input value={keyword} onChange={e => onUpdate(node.id, { ...d, keyword: e.target.value })}
                    placeholder={filter === 'starts_with' ? 'e.g. Hi,' : filter === 'ends_with' ? 'e.g. invoice' : 'e.g. urgent'}
                    className={cfgInputCls} />
                </div>
              )}
              <p className="text-[9px] text-nv-faint font-mono pt-1">
                {filter === 'always' ? 'All items will pass to the next step.' : filter === 'not_empty' ? 'Only non-empty items continue.' : `Items where content ${filter.replace('_', ' ')} the keyword continue.`}
              </p>
            </>
          );
        })()}

        {type === 'output' && (() => {
          const outType = String(d.outputType ?? 'notification');
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Deliver result as</label>
                <select value={outType} onChange={e => onUpdate(node.id, { ...d, outputType: e.target.value })} className={cfgSelectCls}>
                  <option value="notification">Desktop notification</option>
                  <option value="email_reply">Send email</option>
                  <option value="file">Save to file</option>
                  <option value="notion">Notion page</option>
                  <option value="slack">Slack message</option>
                  <option value="twitter_post">X post (tweet)</option>
                  <option value="twitter_reply">X reply (tweet reply)</option>
                  <option value="linkedin_post">LinkedIn post</option>
                  <option value="discord">Discord message</option>
                  <option value="google_sheets">Google Sheets row</option>
                  <option value="twilio_sms">Twilio SMS</option>
                  <option value="telegram">Telegram message</option>
                  <option value="hubspot">HubSpot contact</option>
                </select>
              </div>

              {outType === 'notification' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Notification title</label>
                  <input value={String(d.notifTitle ?? '')} onChange={e => onUpdate(node.id, { ...d, notifTitle: e.target.value })}
                    placeholder="e.g. Weekly summary ready" className={cfgInputCls} />
                </div>
              )}

              {outType === 'email_reply' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Send to</label>
                    <select value={String(d.emailMode ?? 'sender')} onChange={e => onUpdate(node.id, { ...d, emailMode: e.target.value })} className={cfgSelectCls}>
                      <option value="sender">Reply to original sender</option>
                      <option value="specific">Specific email address</option>
                    </select>
                  </div>
                  {String(d.emailMode ?? 'sender') === 'specific' && (
                    <div className="space-y-1">
                      <label className={cfgLabelCls}>Email address</label>
                      <input value={String(d.emailAddr ?? '')} onChange={e => onUpdate(node.id, { ...d, emailAddr: e.target.value })}
                        placeholder="hello@example.com" className={cfgInputCls} />
                    </div>
                  )}
                </>
              )}

              {outType === 'file' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Save to folder</label>
                    <input value={String(d.filePath ?? '')} onChange={e => onUpdate(node.id, { ...d, filePath: e.target.value })}
                      placeholder="e.g. Documents/Reports" className={cfgInputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>File format</label>
                    <select value={String(d.fileFormat ?? 'md')} onChange={e => onUpdate(node.id, { ...d, fileFormat: e.target.value })} className={cfgSelectCls}>
                      <option value="md">Markdown (.md)</option>
                      <option value="txt">Plain text (.txt)</option>
                      <option value="json">JSON (.json)</option>
                      <option value="csv">CSV (.csv)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>If file exists</label>
                    <select value={String(d.fileMode ?? 'append')} onChange={e => onUpdate(node.id, { ...d, fileMode: e.target.value })} className={cfgSelectCls}>
                      <option value="append">Append (add to end)</option>
                      <option value="overwrite">Overwrite</option>
                    </select>
                  </div>
                </>
              )}

              {outType === 'notion' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Notion database URL</label>
                  <input value={String(d.notionUrl ?? '')} onChange={e => onUpdate(node.id, { ...d, notionUrl: e.target.value })}
                    placeholder="notion.so/your-db" className={cfgInputCls} />
                  <p className="text-[9px] text-nv-faint font-mono">Connect Notion first in Connect Apps.</p>
                </div>
              )}

              {outType === 'slack' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Slack channel</label>
                  <div className="flex items-center rounded-lg bg-nv-bg border border-nv-border overflow-hidden">
                    <span className="text-[10px] text-nv-faint font-mono px-2 py-1.5 bg-nv-surface border-r border-nv-border shrink-0">#</span>
                    <input value={String(d.slackChannel ?? '')} onChange={e => onUpdate(node.id, { ...d, slackChannel: e.target.value.replace(/^#/, '') })}
                      placeholder="general" className="flex-1 px-2 py-1.5 bg-transparent text-nv-text text-[10px] font-mono focus:outline-none" />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect Slack first in Connect Apps.</p>
                </div>
              )}

              {outType === 'twitter_post' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Post template (optional)</label>
                    <textarea
                      value={String(d.postPrompt ?? '')}
                      onChange={e => onUpdate(node.id, { ...d, postPrompt: e.target.value })}
                      placeholder="e.g. Write a tweet about {topic} in a direct, punchy tone. Max 240 chars. No AI disclosure."
                      rows={3}
                      className="w-full px-2 py-1.5 bg-nv-bg border border-nv-border rounded-md text-[10px] text-nv-text font-mono focus:outline-none focus:border-accent/60 resize-none"
                    />
                    <p className="text-[9px] text-nv-faint font-mono">Overrides AI Action prompt for this output. Leave blank to use upstream content.</p>
                  </div>
                </>
              )}

              {outType === 'twitter_reply' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Reply to tweet ID (optional)</label>
                  <input value={String(d.twitterReplyToId ?? '')} onChange={e => onUpdate(node.id, { ...d, twitterReplyToId: e.target.value })}
                    placeholder="1234567890123456789" className={cfgInputCls} />
                  <p className="text-[9px] text-nv-faint font-mono">Leave blank to post as standalone tweet.</p>
                </div>
              )}

              {outType === 'linkedin_post' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Post template (optional)</label>
                    <textarea
                      value={String(d.postPrompt ?? '')}
                      onChange={e => onUpdate(node.id, { ...d, postPrompt: e.target.value })}
                      placeholder="e.g. Write a LinkedIn post about {topic}. 3 short paragraphs, professional tone, end with a question. No AI disclosure."
                      rows={3}
                      className="w-full px-2 py-1.5 bg-nv-bg border border-nv-border rounded-md text-[10px] text-nv-text font-mono focus:outline-none focus:border-accent/60 resize-none"
                    />
                    <p className="text-[9px] text-nv-faint font-mono">Overrides AI Action prompt for this output. Leave blank to use upstream content.</p>
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Visibility</label>
                    <select value={String(d.linkedinVisibility ?? 'PUBLIC')} onChange={e => onUpdate(node.id, { ...d, linkedinVisibility: e.target.value })} className={cfgSelectCls}>
                      <option value="PUBLIC">Anyone (public)</option>
                      <option value="CONNECTIONS">Connections only</option>
                      <option value="LOGGED_IN">LinkedIn members</option>
                    </select>
                    <p className="text-[9px] text-nv-faint font-mono">Connect LinkedIn first in Connect Apps.</p>
                  </div>
                </div>
              )}

              {outType === 'discord' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Webhook URL</label>
                    <input value={String(d.discordWebhook ?? '')} onChange={e => onUpdate(node.id, { ...d, discordWebhook: e.target.value })}
                      placeholder="https://discord.com/api/webhooks/..." className={cfgInputCls} />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Server Settings → Integrations → Webhooks → Copy URL.</p>
                </>
              )}

              {outType === 'google_sheets' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Spreadsheet ID</label>
                    <input value={String(d.sheetId ?? '')} onChange={e => onUpdate(node.id, { ...d, sheetId: e.target.value })}
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" className={cfgInputCls} />
                  </div>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Sheet name (tab)</label>
                    <input value={String(d.sheetName ?? 'Sheet1')} onChange={e => onUpdate(node.id, { ...d, sheetName: e.target.value })}
                      placeholder="Sheet1" className={cfgInputCls} />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect Google Drive in Connect Apps.</p>
                </>
              )}

              {outType === 'twilio_sms' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>To phone number</label>
                    <input value={String(d.smsTo ?? '')} onChange={e => onUpdate(node.id, { ...d, smsTo: e.target.value })}
                      placeholder="+15551234567" className={cfgInputCls} />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect Twilio (Account SID + Auth Token) in Connect Apps.</p>
                </>
              )}

              {outType === 'telegram' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Chat ID</label>
                    <input value={String(d.telegramChatId ?? '')} onChange={e => onUpdate(node.id, { ...d, telegramChatId: e.target.value })}
                      placeholder="-100123456789" className={cfgInputCls} />
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect Telegram bot in Connect Apps.</p>
                </>
              )}

              {outType === 'hubspot' && (
                <>
                  <div className="space-y-1">
                    <label className={cfgLabelCls}>Action</label>
                    <select value={String(d.hubspotAction ?? 'create_contact')} onChange={e => onUpdate(node.id, { ...d, hubspotAction: e.target.value })} className={cfgSelectCls}>
                      <option value="create_contact">Create / update contact</option>
                      <option value="create_deal">Create deal</option>
                      <option value="add_note">Add note to contact</option>
                    </select>
                  </div>
                  <p className="text-[9px] text-nv-faint font-mono">Connect HubSpot in Connect Apps.</p>
                </>
              )}
            </>
          );
        })()}
        {type === 'loop' && (() => {
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Loop over</label>
                <select value={String(d.loopSource ?? 'previous step')} onChange={e => onUpdate(node.id, { ...d, loopSource: e.target.value })} className={cfgSelectCls}>
                  <option value="previous step">Items from previous step</option>
                  <option value="json_array">JSON array field</option>
                  <option value="lines">Lines of text</option>
                  <option value="csv_rows">CSV rows</option>
                </select>
              </div>
              {String(d.loopSource ?? '') === 'json_array' && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Field name (dot path)</label>
                  <input value={String(d.loopField ?? '')} onChange={e => onUpdate(node.id, { ...d, loopField: e.target.value })}
                    placeholder="e.g. data.items" className={cfgInputCls} />
                </div>
              )}
              <div className="space-y-1">
                <label className={cfgLabelCls}>Max iterations</label>
                <input type="number" value={String(d.maxIterations ?? '50')} onChange={e => onUpdate(node.id, { ...d, maxIterations: e.target.value })}
                  placeholder="50" className={cfgInputCls} />
              </div>
              <p className="text-[9px] text-nv-faint font-mono leading-relaxed">The "Each" handle connects to the per-item steps. The "Done" handle runs after all items finish.</p>
            </>
          );
        })()}

        {type === 'http' && (() => {
          const method = String(d.method ?? 'GET');
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Method</label>
                <select value={method} onChange={e => onUpdate(node.id, { ...d, method: e.target.value, label: `${e.target.value} Request` })} className={cfgSelectCls}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>URL</label>
                <input value={String(d.url ?? '')} onChange={e => onUpdate(node.id, { ...d, url: e.target.value })}
                  placeholder="https://api.example.com/endpoint" className={cfgInputCls} />
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Headers (JSON, optional)</label>
                <textarea value={String(d.headers ?? '')} onChange={e => onUpdate(node.id, { ...d, headers: e.target.value })}
                  rows={3} placeholder='{"Authorization": "Bearer {{token}}"}' className={`${cfgInputCls} resize-none`} />
              </div>
              {['POST', 'PUT', 'PATCH'].includes(method) && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>Body (JSON, optional)</label>
                  <textarea value={String(d.body ?? '')} onChange={e => onUpdate(node.id, { ...d, body: e.target.value })}
                    rows={3} placeholder='{"key": "{{previous_output}}"}' className={`${cfgInputCls} resize-none`} />
                </div>
              )}
              <p className="text-[9px] text-nv-faint font-mono leading-relaxed">Use {'{{previous_output}}'} to inject the previous step's result into URL, headers, or body.</p>
            </>
          );
        })()}

        {type === 'transform' && (() => {
          const tType = String(d.transformType ?? 'json_extract');
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Transform type</label>
                <select value={tType} onChange={e => onUpdate(node.id, { ...d, transformType: e.target.value })} className={cfgSelectCls}>
                  <option value="json_extract">JSON field extract</option>
                  <option value="regex">Regex extract</option>
                  <option value="text_trim">Trim whitespace</option>
                  <option value="to_lowercase">To lowercase</option>
                  <option value="to_uppercase">To uppercase</option>
                  <option value="number_round">Round number</option>
                  <option value="split_lines">Split into lines</option>
                  <option value="first_n_chars">First N characters</option>
                </select>
              </div>
              {['json_extract', 'regex', 'first_n_chars'].includes(tType) && (
                <div className="space-y-1">
                  <label className={cfgLabelCls}>{tType === 'json_extract' ? 'Field path' : tType === 'regex' ? 'Pattern' : 'N characters'}</label>
                  <input value={String(d.expression ?? '')} onChange={e => onUpdate(node.id, { ...d, expression: e.target.value })}
                    placeholder={tType === 'json_extract' ? 'data.user.name' : tType === 'regex' ? '\\d+' : '280'} className={cfgInputCls} />
                </div>
              )}
              <p className="text-[9px] text-nv-faint font-mono">Input is the previous step's output. Transformed value passes to the next node.</p>
            </>
          );
        })()}

        {type === 'approval' && (() => {
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Notify email</label>
                <input value={String(d.notifyEmail ?? '')} onChange={e => onUpdate(node.id, { ...d, notifyEmail: e.target.value })}
                  type="email" placeholder="you@company.com" className={cfgInputCls} />
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Approval message</label>
                <textarea value={String(d.message ?? '')} onChange={e => onUpdate(node.id, { ...d, message: e.target.value })}
                  rows={3} placeholder="Please review the AI-generated content before it is sent." className={`${cfgInputCls} resize-none`} />
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Timeout (hours)</label>
                <input type="number" value={String(d.timeoutHours ?? '24')} onChange={e => onUpdate(node.id, { ...d, timeoutHours: e.target.value })}
                  placeholder="24" className={cfgInputCls} />
                <p className="text-[9px] text-nv-faint font-mono">Flow resumes when approved. Auto-rejects after timeout.</p>
              </div>
            </>
          );
        })()}

        {type === 'subagent' && (() => {
          return (
            <>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Goal</label>
                <textarea value={String(d.goal ?? '')} onChange={e => onUpdate(node.id, { ...d, goal: e.target.value })}
                  rows={3} placeholder="e.g. Research competitor pricing, draft a response, and summarise findings" className={`${cfgInputCls} resize-none`} />
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Sub-agents</label>
                <input type="number" min={1} max={8} value={String(d.agentCount ?? 2)} onChange={e => onUpdate(node.id, { ...d, agentCount: parseInt(e.target.value) || 2 })}
                  placeholder="2" className={cfgInputCls} />
              </div>
              <div className="space-y-1">
                <label className={cfgLabelCls}>Strategy</label>
                <select value={String(d.strategy ?? 'parallel')} onChange={e => onUpdate(node.id, { ...d, strategy: e.target.value })} className={cfgSelectCls}>
                  <option value="parallel">Parallel (all at once)</option>
                  <option value="sequential">Sequential (one by one)</option>
                  <option value="debate">Debate (agents critique each other)</option>
                </select>
              </div>
              <p className="text-[9px] text-nv-faint font-mono leading-relaxed">Manager agent breaks the goal into tasks, spawns sub-agents, and merges their outputs.</p>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Error Boundary — prevents render crashes from white-screening the app ──
class FlowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  componentDidCatch(_e: Error, _info: ErrorInfo) { /* errors are shown in UI */ }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
          <p className="text-nv-red text-sm font-semibold">Canvas error</p>
          <p className="text-nv-muted text-xs font-mono">{(this.state.error as Error).message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-nv-surface border border-nv-border text-nv-muted hover:text-nv-text transition-fast"
          >Reset canvas</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────
export interface FlowCanvasHandle {
  applyFlow: (nodes: Node[], edges: Edge[]) => void;
  getFlow: () => { nodes: Node[]; edges: Edge[] };
  fitView: () => void;
}

interface FlowCanvasProps {
  onSave?: (nodes: Node[], edges: Edge[]) => void;
  connectedServices?: string[];
}

// ─── Inner (needs ReactFlowProvider) ──────────────────────────────────────
function FlowCanvasInner({
  nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onSave, connectedServices, fitViewSignal,
}: {
  nodes: Node[]; edges: Edge[];
  setNodes: (n: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (e: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  onNodesChange: (c: any) => void;
  onEdgesChange: (c: any) => void;
  onSave?: (nodes: Node[], edges: Edge[]) => void;
  connectedServices?: string[];
  fitViewSignal: number;
}) {
  // Sync connected services to module-level variable so node components can read it
  useEffect(() => {
    if (connectedServices) gConnected = new Set(connectedServices);
  }, [connectedServices]);
  const instance = useReactFlow();
  const colorMode = useColorMode();

  // When outer FlowCanvas increments fitViewSignal (via applyFlow or fitView()),
  // call instance.fitView() after a short delay so ReactFlow has rendered the new nodes.
  useEffect(() => {
    if (fitViewSignal === 0) return;
    const t = setTimeout(() => instance.fitView({ padding: 0.3 }), 100);
    return () => clearTimeout(t);
  }, [fitViewSignal, instance]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const nodeCounter = useRef(10);

  // Register drop + delete callbacks
  useEffect(() => {
    gDropCallback = (clientX: number, clientY: number) => {
      const drag = gDrag;
      if (!drag) return;
      const pos = instance.screenToFlowPosition({ x: clientX, y: clientY });
      const id  = `node-${++nodeCounter.current}`;
      setNodes(ns => [...ns, { id, type: drag.type, position: pos, data: drag.data }]);
    };
    gDeleteNode = (id: string) => {
      setNodes(ns => ns.filter(n => n.id !== id));
      setEdges(es => es.filter(e => e.source !== id && e.target !== id));
      setSelectedNode(null);
    };
    return () => { gDropCallback = null; gDeleteNode = null; };
  }, [instance]);

  const onConnect = useCallback((conn: Connection) => {
    const src = nodes.find(n => n.id === conn.source);
    setEdges(es => addEdge({ ...conn, type: 'line', data: { srcType: src?.type ?? 'ai_action' } }, es));
  }, [nodes]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    gMouse.x = pos.x;
    gMouse.y = pos.y;
  }, [instance]);

  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    setSelectedNode(sel.length === 1 ? sel[0] : null);
  }, []);

  function updateNodeData(id: string, data: Record<string, any>) {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data } : n));
    setSelectedNode(prev => prev?.id === id ? { ...prev, data } : prev);
  }

  function deleteNode(id: string) {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      <NodePalette />

      {/* Canvas drop zone — tracks pointer entry/exit for gOverCanvas */}
      <div
        className="flex-1 relative min-w-0"
        onMouseEnter={() => { gOverCanvas = true; }}
        onMouseLeave={() => { gOverCanvas = false; }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onMouseMove={onMouseMove}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          colorMode={colorMode}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          defaultEdgeOptions={{ type: 'line' }}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--nv-bg)' }}
        >
          <Background color="var(--nv-border)" gap={28} size={1} />
          <Controls showInteractive={false} />
          {onSave && (
            <div className="absolute top-3 right-3 z-10">
              <button onClick={() => onSave(nodes, edges)}
                className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-dim text-white text-[11px] font-semibold shadow-lg transition-fast">
                Save flow
              </button>
            </div>
          )}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-1.5">
                <p className="text-nv-muted text-sm font-mono">Drag nodes from the left panel</p>
                <p className="text-nv-muted text-xs font-mono">or describe your automation in the AI chat below</p>
                <p className="text-nv-faint text-[10px] font-mono mt-3">Click a node to select · Delete or ← Backspace to remove</p>
              </div>
            </div>
          )}
        </ReactFlow>
      </div>

      <NodeConfig node={selectedNode} onUpdate={updateNodeData} onDelete={deleteNode} />
    </div>
  );
}

// ─── Public FlowCanvas with forwardRef ────────────────────────────────────
const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvas({ onSave, connectedServices }, ref) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [fitViewSignal, setFitViewSignal] = useState(0);

  useImperativeHandle(ref, () => ({
    applyFlow(newNodes, newEdges) {
      setNodes(newNodes);
      setEdges(newEdges);
      // Signal FlowCanvasInner to fitView after ReactFlow has rendered the new nodes
      setFitViewSignal(v => v + 1);
    },
    getFlow() { return { nodes, edges }; },
    fitView() { setFitViewSignal(v => v + 1); },
  }), [nodes, edges]);

  return (
    <FlowErrorBoundary>
      <ReactFlowProvider>
        <FlowCanvasInner
          nodes={nodes} edges={edges}
          setNodes={setNodes} setEdges={setEdges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onSave={onSave}
          connectedServices={connectedServices}
          fitViewSignal={fitViewSignal}
        />
      </ReactFlowProvider>
    </FlowErrorBoundary>
  );
});

export default FlowCanvas;
