import { useState, useRef, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { Node, Edge } from '@xyflow/react';
import { krewDb, credentialStore, krewMemoryDb, type KrewMemory } from '../../lib/krewDb';
import { SYSTEM_TOOLS, AUTOMATION_TOOLS, SERVICE_TOOLS, BOSS_TOOLS, buildKrewSystemPrompt, executeTool, needsCompression, type ToolDef } from '../../lib/krewTools';
import { trackTokenUsage } from '../../lib/tokenTracker';
import { agentHandle, agentInitials, CATEGORY_COLOR, AGENT_BY_KEY, type KrewAgent } from '../../lib/krewAgents';
import { useAuth } from '../../contexts/AuthContext';
import { getPlanConfig } from '../../lib/planConfig';
import UpgradeModal from '../UpgradeModal';
import { type AutomationProposal } from './AutomationProposalModal';
import AgentStatus from './AgentStatus';
import { type ConnectionMode, type Provider } from '../../lib/ai';
import ConnectionBar from '../coder/ConnectionBar';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChoiceItem {
  id:      string;
  label:   string;
  preview: string;
  content: string;
}

interface ChoiceSet {
  title:   string;
  choices: ChoiceItem[];
}

interface DisplayMsg {
  role:      'user' | 'assistant' | 'tool_call' | 'tool_result' | 'delegation' | 'proposal' | 'choices';
  content:   string;
  toolName?: string;
  streaming?: boolean;
  proposal?: AutomationProposal;
  choices?:  ChoiceSet;
}

interface StudioRequest {
  prompt: string;
  formatId: string;
  duration: number;
  context: string;
}

interface Props {
  sessionId: string | null;
  agent: KrewAgent;
  onSessionCreated: (id: string) => void;
  onOpenConnectApps?: () => void;
  onBrowseAgents?: () => void;
  onAgentChange?: (a: KrewAgent) => void;
  onViewOnCanvas?: (nodes: Node[], edges: Edge[]) => void;
  onOpenStudio?: (req: StudioRequest) => void;
}

// ─── Terminal approval modal ──────────────────────────────────────────────────

function TerminalApprovalModal({ command, onApprove, onDeny }: { command: string; onApprove: () => void; onDeny: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nv-surface border border-nv-border rounded-2xl w-[400px] p-5 shadow-2xl">
        <p className="text-[13px] font-semibold text-nv-text mb-1">Allow terminal command?</p>
        <p className="text-[11px] text-nv-faint mb-3">Krew wants to run:</p>
        <pre className="text-[11px] font-mono text-nv-text bg-nv-bg border border-nv-border rounded-lg px-3 py-2 mb-4 overflow-x-auto">
          {command}
        </pre>
        <div className="flex gap-2 justify-end">
          <button onClick={onDeny}    className="text-[12px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:text-nv-text transition-fast">Deny</button>
          <button onClick={onApprove} className="text-[12px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast">Allow</button>
        </div>
      </div>
    </div>
  );
}

// ─── Message renderers ────────────────────────────────────────────────────────

function ToolCallBubble({ name, args }: { name: string; args: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start gap-2 my-1.5">
      <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M9 3l5 5-5 5" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div className="flex-1">
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-accent font-mono hover:underline">
          {name}() {open ? '▲' : '▼'}
        </button>
        {open && (
          <pre className="text-[10px] text-nv-muted font-mono mt-1 bg-nv-bg border border-nv-border rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
            {args}
          </pre>
        )}
      </div>
    </div>
  );
}

function ToolResultBubble({ name, content }: { name: string; content: string }) {
  const [open, setOpen] = useState(false);
  const preview = content.slice(0, 120).replace(/\n/g, ' ');
  return (
    <div className="flex items-start gap-2 my-1 ml-2">
      <div className="w-4 h-4 rounded bg-nv-green/15 flex items-center justify-center shrink-0 mt-0.5">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div className="flex-1">
        <button onClick={() => setOpen((o) => !o)} className="text-[10px] text-nv-faint font-mono hover:text-nv-muted">
          {name} result {open ? '▲' : '▼'}
        </button>
        {!open && <p className="text-[10px] text-nv-faint truncate">{preview}</p>}
        {open && (
          <pre className="text-[10px] text-nv-muted font-mono mt-1 bg-nv-bg border border-nv-border rounded-lg p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

function SearchResultBubble({ content }: { content: string }) {
  let results: { title: string; url?: string; snippet: string }[] = [];
  try { results = JSON.parse(content); } catch { return <ToolResultBubble name="web_search" content={content} />; }
  if (!Array.isArray(results) || results.length === 0) return null;
  return (
    <div className="my-2 ml-2">
      <p className="text-[10px] text-nv-faint font-mono mb-2">🔍 {results.length} sources found</p>
      <div className="space-y-1.5">
        {results.slice(0, 4).map((r, i) => (
          <div key={i} className="rounded-lg border border-nv-border bg-nv-surface px-3 py-2">
            <p className="text-[11px] font-semibold text-nv-text mb-0.5 leading-snug">{r.title}</p>
            <p className="text-[10px] text-nv-muted leading-relaxed">{r.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Markdown renderer ───────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) result.push(text.slice(last, m.index));
    if (m[1] !== undefined) result.push(<strong key={m.index} className="font-semibold text-nv-text">{m[1]}</strong>);
    else if (m[2] !== undefined) result.push(<em key={m.index}>{m[2]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

function TableBlock({ mdTable, headers, aligns, rows }: {
  mdTable: string;
  headers: string[];
  aligns: string[];
  rows: string[][];
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-nv-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 bg-nv-surface2 border-b border-nv-border">
        <span className="text-[9px] font-mono text-nv-faint uppercase tracking-wide">table</span>
        <button
          onClick={() => navigator.clipboard.writeText(mdTable).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}
          className="text-[10px] text-nv-faint hover:text-nv-muted transition-fast font-mono flex items-center gap-1"
        >
          {copied
            ? <><span className="text-emerald-400">✓</span> copied</>
            : <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> copy</>
          }
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="bg-nv-surface2/50">
              {headers.map((h, hi) => (
                <th key={hi} className="px-3 py-1.5 font-semibold text-nv-text border-b border-nv-border whitespace-nowrap"
                  style={{ textAlign: aligns[hi] as React.CSSProperties['textAlign'] }}>
                  {renderInline(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? '' : 'bg-nv-surface/40'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-nv-muted border-b border-nv-border/50 last:border-b-0"
                    style={{ textAlign: (aligns[ci] ?? 'left') as React.CSSProperties['textAlign'] }}>
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const els: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      const cls = hm[1].length === 1 ? 'text-[14px] font-bold text-nv-text mt-3 mb-1'
                : hm[1].length === 2 ? 'text-[13px] font-semibold text-nv-text mt-2 mb-1'
                :                      'text-[12px] font-semibold text-nv-text mt-1.5 mb-0.5';
      els.push(<p key={i} className={cls}>{renderInline(hm[2])}</p>);
      i++; continue;
    }
    if (line.match(/^---+$/)) { els.push(<hr key={i} className="border-nv-border my-2" />); i++; continue; }
    // Markdown table: collect all pipe-starting lines, render if separator row present
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const isSeparator = (s: string) => /^\|[\s\-:|]+\|/.test(s.trim());
      if (tableLines.length >= 2 && isSeparator(tableLines[1])) {
        const parseCells = (row: string) =>
          row.split('|').slice(1, -1).map(c => c.trim());
        const headers = parseCells(tableLines[0]);
        const aligns  = parseCells(tableLines[1]).map(a =>
          a.startsWith(':') && a.endsWith(':') ? 'center' : a.endsWith(':') ? 'right' : 'left'
        );
        const rows = tableLines.slice(2).map(parseCells);
        const tKey = `tbl-${i}`;
        // Build markdown text for clipboard copy
        const mdSep   = '| ' + headers.map((_, hi) => (aligns[hi] === 'center' ? ':---:' : aligns[hi] === 'right' ? '---:' : '---')).join(' | ') + ' |';
        const mdTable = ['| ' + headers.join(' | ') + ' |', mdSep, ...rows.map(r => '| ' + r.join(' | ') + ' |')].join('\n');
        els.push(
          <TableBlock key={tKey} mdTable={mdTable} headers={headers} aligns={aligns} rows={rows} />
        );
        continue;
      }
      // Not a real table — render as plain text
      for (const tl of tableLines) {
        els.push(<p key={tl + Math.random()} className="mb-0.5 font-mono text-[11px]">{tl}</p>);
      }
      continue;
    }
    if (line.match(/^\s*[-*]\s+/)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        const indent = (lines[i].match(/^(\s*)/)?.[1].length ?? 0) > 2;
        items.push(<li key={i} className={indent ? 'ml-3 mb-0.5' : 'mb-0.5'}>{renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>);
        i++;
      }
      els.push(<ul key={`ul-${i}`} className="list-disc list-outside ml-4 my-1">{items}</ul>);
      continue;
    }
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        items.push(<li key={i} className="mb-0.5">{renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>);
        i++;
      }
      els.push(<ol key={`ol-${i}`} className="list-decimal list-outside ml-4 my-1">{items}</ol>);
      continue;
    }
    if (!line.trim()) { if (els.length && i < lines.length - 1) els.push(<div key={i} className="h-1.5" />); i++; continue; }
    els.push(<p key={i} className="mb-0.5">{renderInline(line)}</p>);
    i++;
  }
  return <>{els}</>;
}

// ─── proposalToFlow ───────────────────────────────────────────────────────────

function proposalToFlow(proposal: AutomationProposal): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [], edges: Edge[] = [];
  const X = 200, GAP = 170;
  const tLabels: Record<string, string> = { schedule: 'Schedule', email: 'Email received', file_watch: 'File added', webhook: 'Webhook' };
  const aLabels: Record<string, string> = { summarise: 'Summarise', reply: 'Draft reply', extract: 'Extract data', classify: 'Classify', report: 'Generate report', translate: 'Translate' };
  const oLabels: Record<string, string> = { notification: 'Desktop alert', file: 'Save to file', email_reply: 'Send email', notion: 'Notion page', slack: 'Slack message' };

  nodes.push({ id: 'n-trigger', type: 'trigger', position: { x: X, y: 80 },
    data: { label: tLabels[proposal.trigger_type] ?? 'Trigger', triggerType: proposal.trigger_type, ...proposal.trigger_config } });

  proposal.steps.forEach((step, i) => {
    const id = `n-ai-${i}`, prevId = i === 0 ? 'n-trigger' : `n-ai-${i - 1}`;
    nodes.push({ id, type: 'ai_action', position: { x: X, y: 80 + (i + 1) * GAP },
      data: { label: aLabels[step.action] ?? step.action, action: step.action, prompt: step.prompt } });
    edges.push({ id: `e-${prevId}-${id}`, source: prevId, target: id, type: 'dot', data: { srcType: prevId === 'n-trigger' ? 'trigger' : 'ai_action' } });
  });

  if (proposal.steps.length > 0) {
    const lastStep = proposal.steps[proposal.steps.length - 1], lastId = `n-ai-${proposal.steps.length - 1}`;
    nodes.push({ id: 'n-output', type: 'output', position: { x: X, y: 80 + proposal.steps.length * GAP + GAP },
      data: { label: oLabels[lastStep.output] ?? 'Output', outputType: lastStep.output } });
    edges.push({ id: `e-${lastId}-n-output`, source: lastId, target: 'n-output', type: 'dot', data: { srcType: 'ai_action' } });
  }
  return { nodes, edges };
}

// ─── DelegationBubble ─────────────────────────────────────────────────────────

function DelegationBubble({ agentKey, content, streaming }: { agentKey: string; content: string; streaming?: boolean }) {
  const agent = AGENT_BY_KEY[agentKey];
  return (
    <div className="my-3">
      {/* "called by boss" label */}
      <div className="flex items-center gap-1.5 mb-2 ml-0.5">
        <span className="text-[9px] font-mono text-nv-faint uppercase tracking-wide">Arjun.Boss called</span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className="text-accent shrink-0">
          <path d="M2 5h6M5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${agent ? CATEGORY_COLOR[agent.category] : 'bg-accent/20 text-accent'}`}>
          {agent ? agentInitials(agent) : agentKey.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-nv-text leading-tight">
              {agent ? agentHandle(agent) : agentKey}
            </span>
            {streaming && (
              <span className="text-[9px] font-mono text-accent animate-pulse">working…</span>
            )}
          </div>
          {agent?.description && (
            <span className="text-[10px] text-nv-faint leading-tight">{agent.description}</span>
          )}
        </div>
      </div>
      <div className="ml-9 pl-3 border-l-2 border-accent/40">
        <AssistantBubble content={content} streaming={streaming} />
      </div>
    </div>
  );
}

// ─── ProposalCard (inline) ────────────────────────────────────────────────────

function ProposalCard({ proposal, agentName, userId, onAccept, onDecline, onViewOnCanvas }: {
  proposal: AutomationProposal;
  agentName: string; userId: string;
  onAccept: () => void; onDecline: () => void;
  onViewOnCanvas?: () => void;
}) {
  const [status,          setStatus]          = useState<'idle' | 'saving' | 'done' | 'declined'>('idle');
  const [err,             setErr]             = useState('');
  const [knowledgeCtx,   setKnowledgeCtx]    = useState(proposal.knowledge_context ?? '');
  const [showCtxInput,   setShowCtxInput]     = useState(false);

  // Show context panel for automations that involve AI replies/classification
  const needsContext = proposal.trigger_type === 'email' ||
    proposal.steps.some(s => s.action === 'reply' || s.action === 'classify' || s.action === 'summarise');

  async function accept() {
    setStatus('saving'); setErr('');
    try {
      const id = crypto.randomUUID();
      const triggerConfig = JSON.stringify({
        ...proposal.trigger_config,
        is_temp: true,
        max_runs: proposal.max_runs ?? 1,
        ...(knowledgeCtx.trim() ? { knowledge_context: knowledgeCtx.trim() } : {}),
      });
      const steps = proposal.steps.map((s, i) => ({ id: `${id}-${i}`, action: s.action, prompt: s.prompt, output: s.output, output_config: {} }));
      await invoke('automation_create', { id, userId, name: proposal.name, triggerType: proposal.trigger_type, triggerConfig, steps: JSON.stringify(steps) });
      setStatus('done'); onAccept();
    } catch (e) { setErr(String(e)); setStatus('idle'); }
  }

  const TI: Record<string, string> = { schedule: '⏰', email: '✉', file_watch: '📁', webhook: '🔗' };
  const TL: Record<string, string> = { schedule: 'Schedule', email: 'Email received', file_watch: 'File added', webhook: 'Webhook' };
  const AI: Record<string, string> = { summarise: '📝', reply: '↩', extract: '🔍', classify: '🏷', report: '📊', translate: '🌐' };
  const AL: Record<string, string> = { summarise: 'Summarise', reply: 'Draft reply', extract: 'Extract data', classify: 'Classify', report: 'Generate report', translate: 'Translate' };
  const OI: Record<string, string> = { notification: '🔔', file: '💾', email_reply: '✉', notion: 'N', slack: '#' };
  const OL: Record<string, string> = { notification: 'Desktop alert', file: 'Save to file', email_reply: 'Send email', notion: 'Notion page', slack: 'Slack message' };

  if (status === 'declined') return null;
  if (status === 'done') return (
    <div className="my-2 px-3 py-2 rounded-xl bg-nv-green/10 border border-nv-green/20">
      <p className="text-[11px] text-nv-green font-mono">✓ Automation is live · runs automatically</p>
    </div>
  );

  return (
    <div className="my-3 rounded-xl border border-accent/30 bg-nv-surface overflow-hidden text-left">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-nv-border/60 bg-nv-bg">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <div>
            <p className="text-[9px] font-mono text-nv-faint">{agentName} proposes an automation</p>
            <p className="text-[12px] font-semibold text-nv-text">{proposal.name}</p>
          </div>
        </div>
        {proposal.is_temp && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nv-yellow/15 text-nv-yellow border border-nv-yellow/30 font-mono shrink-0">Temp · {proposal.max_runs ?? 1} run</span>}
      </div>
      <div className="px-3 py-3 space-y-1.5">
        {proposal.description && <p className="text-[11px] text-nv-muted mb-2">{proposal.description}</p>}
        {needsContext && (
          <div className="rounded-lg border border-nv-border bg-nv-bg overflow-hidden mb-1">
            <button
              onClick={() => setShowCtxInput(v => !v)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm">📚</span>
                <div>
                  <p className="text-[9px] text-nv-faint font-mono uppercase">Company Context</p>
                  <p className="text-[10px] text-nv-muted">
                    {knowledgeCtx.trim() ? knowledgeCtx.slice(0, 60) + (knowledgeCtx.length > 60 ? '…' : '') : 'Optional — add your FAQs, policies, or tone guide'}
                  </p>
                </div>
              </div>
              <span className="text-[10px] text-nv-faint font-mono shrink-0 ml-2">{showCtxInput ? '▲' : '▼'}</span>
            </button>
            {showCtxInput && (
              <textarea
                value={knowledgeCtx}
                onChange={e => setKnowledgeCtx(e.target.value)}
                placeholder={"Paste your company FAQs, pricing, policies, or tone guidelines here.\nThe AI will use ONLY this context when it runs — no hallucinations."}
                rows={5}
                className="w-full bg-nv-surface border-t border-nv-border px-2.5 py-2 text-[11px] text-nv-text font-mono outline-none resize-none placeholder:text-nv-faint/60"
              />
            )}
          </div>
        )}
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-nv-bg border border-nv-border">
          <span className="text-base shrink-0">{TI[proposal.trigger_type] ?? '⚡'}</span>
          <div><p className="text-[9px] text-nv-faint font-mono uppercase">Trigger</p><p className="text-[11px] font-semibold text-nv-text">{TL[proposal.trigger_type]}</p></div>
        </div>
        <div className="text-center text-nv-faint text-xs">↓</div>
        {proposal.steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-nv-bg border border-nv-border">
            <span className="text-base shrink-0">{AI[step.action] ?? '🤖'}</span>
            <div>
              <p className="text-[9px] text-nv-faint font-mono uppercase">Step {i + 1}</p>
              <p className="text-[11px] font-semibold text-nv-text">{AL[step.action] ?? step.action}</p>
              {step.prompt && <p className="text-[10px] text-nv-muted mt-0.5 line-clamp-2">{step.prompt}</p>}
            </div>
          </div>
        ))}
        {proposal.steps.length > 0 && (() => { const out = proposal.steps[proposal.steps.length - 1].output; return (
          <><div className="text-center text-nv-faint text-xs">↓</div>
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-nv-bg border border-nv-border">
            <span className="text-base shrink-0">{OI[out] ?? '📤'}</span>
            <div><p className="text-[9px] text-nv-faint font-mono uppercase">Output</p><p className="text-[11px] font-semibold text-nv-text">{OL[out] ?? out}</p></div>
          </div></>
        ); })()}
      </div>
      {err && <p className="mx-3 mb-2 text-[10px] text-nv-red font-mono">{err}</p>}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-nv-border/60 bg-nv-bg">
        <button onClick={() => { setStatus('declined'); onDecline(); }} className="text-[11px] text-nv-faint hover:text-nv-text transition-fast font-mono">Decline</button>
        {onViewOnCanvas && <button onClick={onViewOnCanvas} className="text-[11px] text-accent hover:underline transition-fast font-mono">View on Canvas →</button>}
        <div className="flex-1" />
        <button onClick={accept} disabled={status === 'saving'} className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast disabled:opacity-50 font-semibold">
          {status === 'saving' ? 'Saving…' : '✓ Accept & Go Live'}
        </button>
      </div>
    </div>
  );
}

// ─── Email card ───────────────────────────────────────────────────────────────

function EmailCard({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const lines   = content.split('\n');
  const subIdx  = lines.findIndex((l) => /^Subject:\s/.test(l));
  const subject = subIdx >= 0 ? lines[subIdx].replace(/^Subject:\s*/, '') : '';
  const body    = lines.filter((_, i) => i !== subIdx).join('\n').replace(/^\n+/, '');

  return (
    <div className="my-2 rounded-xl border border-nv-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-nv-surface border-b border-nv-border">
        <div className="flex items-center gap-2 min-w-0">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-nv-muted shrink-0">
            <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M1 6l7 4.5L15 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span className="text-[11px] font-semibold text-nv-text truncate">{subject || 'Email'}</span>
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="text-[10px] text-nv-faint hover:text-nv-text font-mono transition-fast shrink-0 ml-2"
        >{copied ? '✓' : 'Copy'}</button>
      </div>
      <div className="px-3 py-3 bg-nv-bg">
        <pre className="text-[11px] text-nv-muted leading-relaxed whitespace-pre-wrap font-sans">{body}</pre>
      </div>
    </div>
  );
}

// Split prose text into email blocks and plain prose sections
function splitEmailSections(text: string): Array<{ type: 'email' | 'prose'; content: string }> {
  const lines = text.split('\n');
  const out: Array<{ type: 'email' | 'prose'; content: string }> = [];
  let type: 'email' | 'prose' = 'prose';
  let buf: string[] = [];

  for (const line of lines) {
    if (/^Subject:\s/.test(line)) {
      const content = buf.join('\n').trim();
      if (content) out.push({ type, content });
      buf = [];
      type = 'email';
    }
    buf.push(line);
  }
  const content = buf.join('\n').trim();
  if (content) out.push({ type, content });
  return out;
}

// ─── Studio asset bubble (renders <!DOCTYPE html> responses as live previews) ──

function StudioAssetBubble({ html }: { html: string }) {
  const [copied, setCopied] = useState(false);
  const [saved,  setSaved]  = useState(false);

  function download() {
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'asset.html';
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="my-3 rounded-xl border border-accent/30 bg-nv-surface overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-nv-border/60 bg-nv-bg">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-accent shrink-0">
            <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
            <circle cx="8" cy="7" r="2" fill="currentColor" opacity=".6"/>
            <path d="M2 12h12" stroke="currentColor" strokeWidth="1.1"/>
            <path d="M6.5 14h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span className="text-[11px] font-semibold text-nv-text">Visual asset</span>
          <span className="text-[9px] text-nv-faint font-mono">HTML · open in any browser</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { navigator.clipboard.writeText(html); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
            className="text-[10px] text-nv-faint hover:text-nv-text font-mono transition-fast"
          >{copied ? '✓ Copied' : 'Copy HTML'}</button>
          <button
            onClick={download}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast font-mono"
          >{saved ? '✓ Saved' : 'Save .html'}</button>
        </div>
      </div>
      <div className="p-3 bg-nv-bg flex justify-center items-center">
        <iframe
          srcDoc={html}
          sandbox="allow-scripts"
          className="rounded-lg border border-nv-border/40"
          style={{ width: 500, height: 280, transform: 'scale(1)', transformOrigin: 'top left', pointerEvents: 'none' }}
          title="Visual asset preview"
        />
      </div>
      <p className="px-3 pb-2 text-[9px] text-nv-faint font-mono">Save the .html file to open at full resolution in your browser</p>
    </div>
  );
}

function AssistantBubble({ content, streaming }: { content: string; streaming?: boolean }) {
  const [copied, setCopied] = useState(false);

  // If the content is HTML (visual asset from visual_creator), render preview
  const trimmed = content.trimStart();
  if (!streaming && (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html'))) {
    return <StudioAssetBubble html={content} />;
  }

  const parts = content.split(/(```[\s\S]*?```)/g);

  function copyAll() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="text-[12px] leading-relaxed text-nv-muted my-2 group">
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const m    = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
          const lang = m?.[1] ?? '';
          const code = m?.[2] ?? part.slice(3, -3);
          return (
            <div key={i} className="my-1.5 rounded-lg overflow-hidden border border-nv-border/60">
              <div className="flex items-center justify-between px-3 py-1 bg-nv-surface2">
                <span className="text-[10px] text-nv-faint font-mono">{lang || 'code'}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(code.trim())}
                  className="text-[10px] text-nv-muted hover:text-nv-text transition-fast"
                >Copy</button>
              </div>
              <pre className="p-3 overflow-x-auto text-[11px] text-nv-text bg-nv-bg font-mono whitespace-pre-wrap break-all">
                {code.trim()}
              </pre>
            </div>
          );
        }
        if (!part) return null;
        // Split prose around email blocks (Subject: lines)
        const sections = splitEmailSections(part);
        if (sections.length === 1 && sections[0].type === 'prose') {
          return <div key={i} className="mb-1">{renderMarkdown(part)}</div>;
        }
        return (
          <div key={i}>
            {sections.map((sec, j) =>
              sec.type === 'email'
                ? <EmailCard key={j} content={sec.content} />
                : <div key={j} className="mb-1">{renderMarkdown(sec.content)}</div>
            )}
          </div>
        );
      })}
      {streaming && !content && (
        <span className="flex items-center gap-1 py-1">
          {[0,1,2].map(i => (
            <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent/70"
              style={{ animation: `pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />
          ))}
          <span className="text-[11px] text-nv-faint ml-1">Thinking…</span>
        </span>
      )}
      {streaming && content && <span className="inline-block w-1.5 h-3.5 bg-accent animate-pulse ml-0.5 rounded-sm" />}
      {!streaming && content.length > 0 && (
        <button
          onClick={copyAll}
          className="mt-1.5 text-[10px] text-nv-faint hover:text-nv-muted transition-fast font-mono flex items-center gap-1"
        >
          {copied
            ? <><span className="text-emerald-400">✓</span> copied</>
            : <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> copy</>
          }
        </button>
      )}
    </div>
  );
}

function ChoicePicker({ choiceSet, onSelect, disabled, storageKey }: { choiceSet: ChoiceSet; onSelect: (content: string) => void; disabled?: boolean; storageKey?: string }) {
  const savedPick                 = storageKey ? localStorage.getItem(storageKey) : null;
  const [picked, setPicked]       = useState<string | null>(savedPick);
  const [confirmed, setConfirmed] = useState(!!savedPick);
  const [copied, setCopied]       = useState(false);

  if (confirmed) {
    const choice = choiceSet.choices.find((c) => c.id === picked);
    const content = choice?.content ?? '';
    return (
      <div className="my-3 rounded-xl border border-nv-border bg-nv-surface overflow-hidden">
        <div className="px-3 py-2 bg-accent/10 border-b border-accent/20 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-full bg-accent/30 flex items-center justify-center shrink-0">
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4" stroke="#7C5CFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <span className="text-[11px] font-semibold text-accent">{choice?.label}</span>
            <span className="text-[10px] text-nv-faint">· {choiceSet.title}</span>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="text-[10px] text-nv-faint hover:text-nv-text transition-fast font-mono"
          >{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
        <div className="px-4 py-3">
          <AssistantBubble content={content} />
        </div>
      </div>
    );
  }

  return (
    <div data-choice-card className={`my-3 rounded-xl border border-nv-border bg-nv-surface overflow-hidden text-left ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div className="px-3 py-2.5 bg-nv-bg border-b border-nv-border/60">
        <p className="text-[12px] font-semibold text-nv-text">{choiceSet.title}</p>
        <p className="text-[10px] text-nv-faint mt-0.5">
          {disabled ? '⏳ Wait for the response to finish before selecting' : 'Tap a variant to select, then confirm'}
        </p>
      </div>
      <div className="p-2 space-y-1.5">
        {choiceSet.choices.map((c) => (
          <button
            key={c.id}
            disabled={disabled}
            onClick={() => setPicked(picked === c.id ? null : c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-fast ${
              picked === c.id
                ? 'border-accent bg-accent/10 text-nv-text'
                : 'border-nv-border hover:border-accent/40 text-nv-muted hover:text-nv-text'
            }`}
          >
            <p className="text-[11px] font-semibold mb-0.5">{c.label}</p>
            <p className="text-[10px] text-nv-faint line-clamp-2 font-mono">{c.preview}</p>
          </button>
        ))}
      </div>
      {picked && (
        <div className="px-3 py-2.5 border-t border-nv-border/60 bg-nv-bg flex justify-end gap-2">
          <button
            onClick={() => setPicked(null)}
            className="text-[11px] text-nv-faint hover:text-nv-text transition-fast font-mono"
          >Cancel</button>
          <button
            onClick={() => {
              const content = choiceSet.choices.find((c) => c.id === picked)?.content ?? '';
              setConfirmed(true);
              if (storageKey && picked) localStorage.setItem(storageKey, picked);
              onSelect(content);
            }}
            className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-dim transition-fast font-semibold"
          >Use this variant →</button>
        </div>
      )}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}
      className="text-[10px] text-nv-faint hover:text-nv-muted transition-fast font-mono flex items-center gap-1 mt-1"
    >
      {copied
        ? <><span className="text-emerald-400">✓</span> copied</>
        : <><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> copy</>
      }
    </button>
  );
}

function MessageRow({ msg, agent }: { msg: DisplayMsg; agent: KrewAgent }) {
  if (msg.role === 'tool_call') return <ToolCallBubble name={msg.toolName ?? 'tool'} args={msg.content} />;
  if (msg.role === 'tool_result' && msg.toolName === 'web_search') return <SearchResultBubble content={msg.content} />;
  if (msg.role === 'tool_result') return <ToolResultBubble name={msg.toolName ?? 'tool'} content={msg.content} />;
  if (msg.role === 'delegation') return <DelegationBubble agentKey={msg.toolName ?? ''} content={msg.content} streaming={msg.streaming} />;
  if (msg.role === 'user') {
    return (
      <div className="flex flex-col items-end my-2">
        <div className="max-w-[80%] bg-accent/15 border border-accent/30 rounded-2xl rounded-tr-sm px-3 py-2">
          <p className="text-[12px] text-nv-text">{msg.content}</p>
        </div>
        <CopyBtn text={msg.content} />
      </div>
    );
  }
  return (
    <div className="my-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0 ${CATEGORY_COLOR[agent.category]}`}>
          {agentInitials(agent)}
        </div>
        <span className="text-[11px] font-semibold text-nv-text">{agentHandle(agent)}</span>
      </div>
      <div className="ml-8">
        <AssistantBubble content={msg.content} streaming={msg.streaming} />
      </div>
    </div>
  );
}

// ─── Starter prompts per category ────────────────────────────────────────────

const STARTER_PROMPTS: Record<string, string[]> = {
  boss:             ['What should I focus on this week?', 'Give me a strategy for growing my product', 'Prioritise my backlog into a 2-week sprint'],
  caption_writer:   ['Write 5 Instagram captions for my new product launch', 'Give me caption variations — professional and casual', 'Write a thread for Twitter about AI trends'],
  blog_writer:      ['Write a 600-word blog post about remote work productivity', 'Give me an SEO outline for "best project management tools"', 'Rewrite this intro to be more engaging'],
  seo_writer:       ['Research top keywords for "AI productivity app"', 'Write a meta description for my landing page', 'Audit my blog post for SEO improvements'],
  video_script:     ['Script a 60-second YouTube short on morning routines', 'Write a product explainer video script', 'Give me a hook for a video about focus techniques'],
  newsletter:       ['Draft a weekly newsletter about my SaaS launch', 'Write a subject line + preview text for high open rates', 'Structure a newsletter template for a developer audience'],
  repurpose:        ['Turn this blog post into 5 LinkedIn posts', 'Repurpose this YouTube transcript into an email', 'Break down this webinar into a Twitter thread'],
  campaign:         ['Plan a 30-day Instagram campaign for my app launch', 'Create a content calendar for Q3', 'Give me a viral post idea for my niche'],
  ads:              ['Write 3 Facebook ad variations for my SaaS', 'Create a Google ad headline + description for "project management app"', 'A/B test copy for my landing page CTA'],
  seo_researcher:   ['Find low-competition keywords for my blog', 'Analyse competitor content strategy for a productivity app', 'What SEO opportunities am I missing?'],
  community:        ['Draft a welcome message for my Discord community', 'Write a community update post for Slack', 'Plan a community engagement campaign'],
  email_marketer:   ['Write a cold outreach email for SaaS founders', 'Create a 5-email drip sequence for trial users', 'What subject line will get the most opens?'],
  lead_gen:         ['Build a list of target companies in the EdTech space', 'Write a LinkedIn outreach message for startup CTOs', 'Give me 10 ICP questions to qualify leads faster'],
  crm_manager:      ['Write a follow-up sequence for deals stuck in negotiation', 'Summarise this deal history and suggest next steps', 'Draft a re-engagement email for churned customers'],
  sales_coach:      ['Role-play a sales call where the prospect says "too expensive"', 'Give me objection-handling scripts for 5 common pushbacks', 'Evaluate this sales pitch and suggest improvements'],
  support_agent:    ['Draft a reply to an angry customer about a billing issue', 'Write a canned response for "how do I reset my password?"', 'How should I handle a customer asking for a refund?'],
  onboarding:       ['Create a 3-step onboarding email sequence', 'Write the first onboarding message a new user sees', 'Design a 7-day activation checklist for a SaaS app'],
  faq_builder:      ['Build an FAQ for a project management SaaS', 'Answer these 5 common questions as friendly support docs', 'Write a troubleshooting guide for login issues'],
  refund_handler:   ['Write a professional refund denial with empathy', 'Draft a refund approval email that keeps the customer happy', 'How do I handle a chargeback dispute?'],
  escalation:       ['Write an internal escalation report for a critical outage', 'Draft a customer-facing status update during an incident', 'Create an escalation protocol for Tier-2 issues'],
  review_responder: ['Reply to a 1-star review professionally', 'Write a thank-you reply to a 5-star review', 'How should I respond to a review that mentions a competitor?'],
  ux_writer:        ['Write microcopy for an empty state screen', 'Draft onboarding tooltip text for a dashboard', 'Rewrite these error messages to be more helpful'],
  design_doc:       ['Create a design spec for a mobile checkout flow', 'Write a design brief for a rebrand project', 'Document the UX decisions for our new onboarding screen'],
  data_analyst:     ['Analyse this sales data and give me 3 insights', 'What trends should I watch in this dataset?', 'Write a SQL query to find top customers by revenue'],
  report_builder:   ['Create a weekly KPI report template', 'Summarise this data into an executive summary', 'Build a dashboard spec for our growth metrics'],
  ab_tester:        ['Design an A/B test for my pricing page', 'What should I test first — CTA color or copy?', 'Analyse these A/B test results and recommend next steps'],
  market_research:  ['Summarise market trends in the B2B SaaS space', 'Who are the top 5 competitors to a productivity app?', 'What do users say about tools like Notion vs Linear?'],
  data_cleaner:     ['Write a Python script to deduplicate this CSV', 'How do I clean messy date formats in pandas?', 'Find and fix nulls in this dataset'],
  code_reviewer:    ['Review this PR and find bugs', 'What are the code quality issues in this function?', 'Suggest refactors for this messy component'],
  bug_hunter:       ['Help me debug this error: undefined is not a function', 'Why is my API returning 500 on this endpoint?', 'Trace this memory leak in my Node.js app'],
  devops:           ['Write a GitHub Actions CI/CD pipeline for a React app', 'Dockerfile for a Node.js + PostgreSQL app', 'Set up auto-deploy to Vercel on push to main'],
  docs_writer:      ['Write README documentation for this API endpoint', 'Create a developer quickstart guide', 'Document these TypeScript types with JSDoc'],
  test_engineer:    ['Write unit tests for this function using Vitest', 'Create E2E test cases for the login flow', 'What edge cases am I missing in my test suite?'],
  api_designer:     ['Design a REST API for a task management app', 'Write an OpenAPI spec for these 5 endpoints', 'Review my API design for consistency issues'],
  roadmap_builder:  ['Build a 90-day product roadmap for a B2B SaaS', 'Prioritise these 10 features using RICE scoring', 'Write a roadmap summary for a board update'],
  user_researcher:  ['Write 10 user interview questions for a productivity app', 'Analyse these interview notes for common themes', 'Create a user persona from this research data'],
  sprint_planner:   ['Break down this epic into sprint-sized tickets', 'Plan a 2-week sprint for a 4-person team', 'Write acceptance criteria for this user story'],
  prrd_writer:      ['Write a PRD for a notification settings feature', 'Draft user stories for a new billing page', 'Create a feature spec with success metrics'],
  stakeholder:      ['Draft a product update email for non-technical stakeholders', "Summarise last sprint's achievements in 5 bullets", 'Write an exec briefing on our Q2 feature launches'],
  launch_manager:   ['Create a product launch checklist', 'Write a launch announcement for Product Hunt', 'Plan a go-to-market strategy for a B2B feature'],
  retrospective:    ['Facilitate a retrospective for a failed sprint', 'Summarise these retro notes into action items', 'Create a retrospective template for my team'],
  okr_manager:      ['Write OKRs for a product team for Q3', 'Evaluate if these OKRs are measurable and achievable', 'Map our roadmap goals to OKR key results'],
};

// ─── Automation proposal extraction ─────────────────────────────────────────

function extractProposal(content: string): { cleanContent: string; proposal: AutomationProposal | null } {
  const match = content.match(/AUTOMATION_PROPOSAL:\s*([\s\S]*?)\s*END_PROPOSAL/);
  if (!match) return { cleanContent: content, proposal: null };
  try {
    const proposal = JSON.parse(match[1].trim()) as AutomationProposal;
    const cleanContent = content.replace(/\n*AUTOMATION_PROPOSAL:[\s\S]*?END_PROPOSAL\n*/g, '\n').trim();
    return { cleanContent, proposal };
  } catch {
    return { cleanContent: content, proposal: null };
  }
}

function extractChoices(content: string): { cleanContent: string; choices: ChoiceSet | null } {
  const match = content.match(/CHOICES_BLOCK:\s*([\s\S]*?)\s*END_CHOICES/);
  if (!match) return { cleanContent: content, choices: null };
  try {
    const choices = JSON.parse(match[1].trim()) as ChoiceSet;
    const cleanContent = content.replace(/\n*CHOICES_BLOCK:[\s\S]*?END_CHOICES\n*/g, '\n').trim();
    return { cleanContent, choices };
  } catch {
    return { cleanContent: content, choices: null };
  }
}

function getStarterPrompts(agent: KrewAgent): string[] {
  return STARTER_PROMPTS[agent.key] ?? [
    `What can ${agent.humanName} help me with?`,
    'Give me your best suggestion for my current work',
    'Show me what you can do',
  ];
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function KrewChat({ sessionId, agent, onSessionCreated, onOpenConnectApps, onBrowseAgents, onViewOnCanvas, onOpenStudio }: Props) {
  const { user, session, profile } = useAuth();
  const planCfg = getPlanConfig(profile?.plan ?? 'explore');
  type VoiceStatus = 'idle' | 'recording' | 'transcribing' | 'error';
  const [voiceStatus,       setVoiceStatus]       = useState<VoiceStatus>('idle');
  const [voiceErr,          setVoiceErr]           = useState<string | null>(null);
  const [showVoiceUpgrade,  setShowVoiceUpgrade]   = useState(false);
  const [showQuotaUpgrade,  setShowQuotaUpgrade]   = useState(false);

  async function handleMicClick() {
    setVoiceErr(null);
    if (!planCfg.voiceToCode) { setShowVoiceUpgrade(true); return; }
    if (voiceStatus === 'recording') {
      setVoiceStatus('transcribing');
      try {
        const text = await invoke<string>('voice_stop_and_transcribe');
        if (text) setInput((prev: string) => prev ? `${prev} ${text}` : text);
      } catch (e) { setVoiceErr(`${e}`); }
      setVoiceStatus('idle');
      return;
    }
    if (voiceStatus === 'idle') {
      try {
        await invoke('voice_start_recording');
        setVoiceStatus('recording');
      } catch (e) {
        setVoiceErr(`Microphone error: ${e}`);
        setVoiceStatus('error');
      }
    }
  }

  const [mode,       setMode]       = useState<ConnectionMode>('own_key');
  const [apiKey,     setApiKey]     = useState('');
  const [provider,   setProvider]   = useState<Provider>('openai');
  const [modelName,  setModelName]  = useState('gpt-4o');
  const [baseUrl,    setBaseUrl]    = useState('');
  const [localModel, setLocalModel] = useState('llama3');

  const [messages,      setMessages]      = useState<DisplayMsg[]>([]);
  const [input,         setInput]         = useState('');
  const [busy,          setBusy]          = useState(false);
  const [agentStep,     setAgentStep]     = useState<string | null>(null);
  const [agentTool,     setAgentTool]     = useState<string | null>(null);
  const [creds,         setCreds]         = useState<Record<string, Record<string, string>>>({});
  const [agentMemories, setAgentMemories] = useState<KrewMemory[]>([]);

  const [termApproval, setTermApproval] = useState<{ command: string; resolve: (ok: boolean) => void } | null>(null);
  const [studioExtracting, setStudioExtracting] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [braveNudge, setBraveNudge] = useState(false);

  const stopRef            = useRef(false);
  const bottomRef          = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const atBottomRef        = useRef(true);
  const callIdRef          = useRef(0);
  const sidRef             = useRef<string | null>(sessionId);
  const freshSessionRef    = useRef<string | null>(null);
  sidRef.current           = sessionId;

  const [showScrollBtn, setShowScrollBtn] = useState(false);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    atBottomRef.current = true;
    setShowScrollBtn(false);
  }

  function handleScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    atBottomRef.current = nearBottom;
    setShowScrollBtn(!nearBottom);
  }

  // Auto-scroll only when user is already at the bottom
  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Load session messages when sessionId changes
  useEffect(() => {
    // Skip wipe+reload if we just created this session in send() — messages are already in state
    if (sessionId && sessionId === freshSessionRef.current) {
      freshSessionRef.current = null;
      return;
    }
    setMessages([]);
    if (!sessionId) return;
    krewDb.getMessages(sessionId).then((rows) => {
      const rawMsgs: (DisplayMsg | null)[] = rows.map((r): DisplayMsg | null => {
        // Choices cards are stored as tool_result with tool_name '__choices__'
        if (r.tool_name === '__choices__') {
          try {
            const choices = JSON.parse(r.content) as ChoiceSet;
            return { role: 'choices' as const, content: '', choices };
          } catch { return null; }
        }
        return {
          role:     r.role as DisplayMsg['role'],
          content:  r.content,
          toolName: r.tool_name ?? undefined,
        };
      });
      const msgs: DisplayMsg[] = rawMsgs.filter((m): m is DisplayMsg => m !== null);
      // Restore any pending (not yet accepted/declined) proposal
      const stored = sessionStorage.getItem(`krew-proposal-${sessionId}`);
      if (stored) {
        try { msgs.push({ role: 'proposal', content: '', proposal: JSON.parse(stored) as AutomationProposal }); } catch {}
      }
      setMessages(msgs);
    }).catch(() => {});
  }, [sessionId]);

  // Load credentials
  const reloadCreds = useCallback(async () => {
    const services = await credentialStore.list().catch(() => [] as string[]);
    const entries: Record<string, Record<string, string>> = {};
    for (const s of services) {
      const d = await credentialStore.get(s).catch(() => null);
      if (d) entries[s] = d;
    }
    setCreds(entries);
  }, []);

  useEffect(() => { reloadCreds(); }, [reloadCreds]);

  // Load agent memories when agent changes
  useEffect(() => {
    krewMemoryDb.getAll(agent.key).then(setAgentMemories).catch(() => {});
  }, [agent.key]);

  // Build active toolkit based on connected services
  const getActiveTools = useCallback((): ToolDef[] => {
    const tools: ToolDef[] = [...SYSTEM_TOOLS];
    for (const service of Object.keys(creds)) {
      if (SERVICE_TOOLS[service]) tools.push(...SERVICE_TOOLS[service]);
    }
    if (agent.key === 'boss') tools.push(...BOSS_TOOLS);
    if (agent.key === 'boss' || agent.category === 'Ops') tools.push(...AUTOMATION_TOOLS);
    return tools;
  }, [creds, agent.key, agent.category]);

  function sanitiseError(raw: unknown): string {
    const msg = raw instanceof Error ? raw.message : String(raw);
    // Network / connectivity errors — hide URL, API key, provider name
    if (/sending request|connect(ion)?|network|timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|failed to fetch/i.test(msg))
      return 'Connection failed. Please check your internet connection and try again.';
    if (/401|unauthori[sz]ed|invalid.*key|api.?key/i.test(msg))
      return 'Invalid API key. Go to Connect Apps and check your key.';
    if (/429|rate.?limit|quota/i.test(msg)) {
      // Check if it's our own token-limit message from krew-stream (passes through unmodified)
      if (/monthly.*token|reached.*monthly|upgrade.*plan|adris\.tech\/pricing/i.test(msg)) return msg;
      return 'AI rate limit reached. Switch to Own Key mode in the connection bar, or upgrade your plan at adris.tech/pricing.';
    }
    if (/500|502|503|504|server.?error|internal.?error/i.test(msg))
      return 'The AI service is temporarily unavailable. Please try again shortly.';
    if (/is not found for API version|not supported for generateContent|"code": ?404|model.*not found/i.test(msg))
      return 'Nivara AI is temporarily unavailable. Please try again in a moment, or switch to Own Key mode.';
    // Strip any URL or API key that leaked through
    return msg.replace(/https?:\/\/[^\s)]+/g, '[service]').replace(/key=[A-Za-z0-9_-]{20,}/g, 'key=[hidden]');
  }

  // Stream one AI turn — returns { text, truncated }
  async function streamTurn(
    msgs: { role: string; content: string }[],
    systemPrompt: string,
    onChunk: (t: string) => void,
  ): Promise<{ text: string; truncated: boolean }> {
    const callId  = String(++callIdRef.current);
    let   fullText = '';
    let   truncated = false;
    const done = { cleanup: () => {} };

    // Auto-detect API key + provider from ConnectApps when own_key and no manual key set
    let effectiveKey       = apiKey;
    let effectiveProvider  = provider;
    let effectiveModelName = modelName;
    if (mode === 'own_key' && !effectiveKey) {
      for (const [svc, p] of [['gemini', 'gemini'], ['openai', 'openai'], ['claude', 'claude']] as [string, Provider][]) {
        if (creds[svc]?.api_key) {
          effectiveKey      = creds[svc].api_key;
          effectiveProvider = p as Provider;
          // Clear model name so Rust uses the correct default for the detected provider
          if (p !== provider) effectiveModelName = '';
          break;
        }
      }
    }

    return new Promise<{ text: string; truncated: boolean }>(async (resolve, reject) => {
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const resetStall = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          done.cleanup();
          reject(new Error('Response stopped. Please check your connection and try again.'));
        }, 90_000);
      };

      const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
        if (e.payload.id !== callId) return;
        fullText += e.payload.text;
        onChunk(e.payload.text);
        resetStall();
      });
      const u2 = await listen<{ id: string }>('krew-done', (e) => {
        if (e.payload.id !== callId) return;
        if (stallTimer) clearTimeout(stallTimer);
        done.cleanup(); resolve({ text: fullText, truncated });
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
        if (e.payload.id !== callId) return;
        if (stallTimer) clearTimeout(stallTimer);
        done.cleanup(); reject(new Error(sanitiseError(e.payload.error)));
      });
      const u4 = await listen<{ id: string }>('krew-truncated', (e) => {
        if (e.payload.id !== callId) return;
        truncated = true;
      });

      done.cleanup = () => { u1(); u2(); u3(); u4(); if (stallTimer) clearTimeout(stallTimer); };
      resetStall(); // start stall timer immediately

      invoke('krew_ai_stream', {
        callId, mode, systemPrompt, messages: msgs,
        apiKey:       effectiveKey       || null,
        provider:     effectiveProvider  || null,
        localModel:   localModel         || null,
        modelName:    effectiveModelName || null,
        baseUrl:      baseUrl            || null,
        sessionToken: session?.access_token ?? null,
      }).catch((e) => { done.cleanup(); reject(e); });
    });
  }

  // Compress conversation if too long
  async function compressIfNeeded(
    msgs: { role: string; content: string }[],
    sessionId: string,
  ): Promise<{ role: string; content: string }[]> {
    if (!needsCompression(msgs)) return msgs;

    const toSummarise = msgs.slice(0, -10);
    const keep        = msgs.slice(-10);
    const summaryPrompt = 'Summarise this conversation history concisely. Keep all important facts, decisions, and context:';
    const summaryMsgs  = [{ role: 'user', content: summaryPrompt + '\n\n' + toSummarise.map((m) => `${m.role}: ${m.content}`).join('\n') }];

    try {
      const { text: summary } = await streamTurn(summaryMsgs, '', () => {});
      await krewDb.saveSummary(sessionId, summary, 0);
      return [{ role: 'user', content: `[Previous conversation summary]\n${summary}` }, ...keep];
    } catch {
      return msgs; // fall back to full history on error
    }
  }

  // Terminal approval helper
  async function requestTerminalApproval(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      setTermApproval({ command, resolve });
    });
  }

  // ── Main send / ReAct loop ─────────────────────────────────────────────────

  async function openInStudio() {
    const content = input.trim();
    if (!content || studioExtracting || !onOpenStudio) return;
    setStudioExtracting(true);

    const EXTRACT_SYS = `You are a creative director. Extract a marketing video brief from the given content and return ONLY valid JSON (no markdown fences, no explanation):
{"prompt":"<detailed cinematic video prompt — include: hero headline with gradient white-to-purple text, 3 key features with emoji icons (⚡🤖🚀), brand color palette, CTA button text, animation style, multi-scene structure with scene descriptions>","formatId":"<wide|story|square>","duration":<15|30|45|60>}
formatId: story=portrait 9:16 (Instagram/TikTok/Reels), wide=landscape 16:9 (YouTube/landing page), square=1:1 (Instagram feed).
duration: 15=short snappy brand moment, 30=standard product showcase, 45=detailed story, 60=full narrative.
The prompt must be production-ready — specific enough for a motion designer to execute without questions.`;

    const callId = `sx-${Date.now()}`;
    let full = '';
    const done = { cleanup: () => {} };

    try {
      const result = await new Promise<string>((resolve, reject) => {
        (async () => {
          const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
            if (e.payload.id === callId) full += e.payload.text;
          });
          const u2 = await listen<{ id: string }>('krew-done', (e) => {
            if (e.payload.id !== callId) return;
            done.cleanup(); resolve(full);
          });
          const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
            if (e.payload.id !== callId) return;
            done.cleanup(); reject(new Error(sanitiseError(e.payload.error)));
          });
          done.cleanup = () => { u1(); u2(); u3(); };
          invoke('krew_ai_stream', {
            callId, mode, systemPrompt: EXTRACT_SYS,
            messages: [{ role: 'user', content: `Product content:\n\n${content.slice(0, 8000)}` }],
            apiKey: apiKey || null, provider,
            localModel: null, modelName: null, baseUrl: null,
            sessionToken: session?.access_token ?? null,
          }).catch((e: unknown) => { done.cleanup(); reject(e); });
        })();
      });

      let parsed: { prompt?: string; formatId?: string; duration?: number } = {};
      try {
        parsed = JSON.parse(result.trim().replace(/```[\w]*\n?|```/g, '').trim());
      } catch { /* use fallback */ }

      onOpenStudio({
        prompt: parsed.prompt ?? 'Design a cinematic 30s product launch video from this brief',
        formatId: parsed.formatId ?? 'wide',
        duration: typeof parsed.duration === 'number' ? parsed.duration : 30,
        context: content,
      });
    } catch {
      onOpenStudio({
        prompt: 'Design a cinematic 30s product launch video from this brief',
        formatId: 'wide',
        duration: 30,
        context: content,
      });
    } finally {
      setStudioExtracting(false);
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || busy) return;
    setInput('');
    setBusy(true);
    stopRef.current = false;

    // Capture and clear attached files
    const currentFiles = attachedFiles;
    setAttachedFiles([]);

    // Build file block injected into the API — no size limit, full content
    const fileBlock = currentFiles.length > 0
      ? currentFiles.map(f => `[File: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\`\n\n`).join('')
      : '';
    const apiText = fileBlock + text;

    // Chat bubble shows typed text + file name chips (not raw content)
    const displayText = currentFiles.length > 0
      ? (text ? text + '\n' : '') + currentFiles.map(f => `📎 ${f.name}`).join('  ')
      : text;

    // Ensure session exists
    let sid = sidRef.current;
    if (!sid) {
      sid = await krewDb.newSession((text || currentFiles[0]?.name || 'File').slice(0, 40), mode, agent.key, localModel).catch(() => null);
      if (sid) { freshSessionRef.current = sid; onSessionCreated(sid); sidRef.current = sid; }
    }

    // Add user message to display (typed text + file names only)
    addMsg({ role: 'user', content: displayText });
    if (sid) krewDb.saveMessage(sid, 'user', displayText).catch(() => {});

    const tools      = getActiveTools();
    // Inject cross-session memories into system prompt
    const memBlock   = agentMemories.length > 0
      ? '\n\n## Your memory (from past sessions)\n' + agentMemories.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : '';
    // Inject user identity so agents sign content with the real user's name
    const userName   = (user?.user_metadata?.full_name as string | undefined)
                    || (user?.user_metadata?.name as string | undefined)
                    || '';
    const userEmail  = user?.email ?? '';
    const displayName = userName || (userEmail ? userEmail.split('@')[0] : '');
    const userBlock  = `\n\n## User Identity\nEmail: ${userEmail}${userName ? `\nName: ${userName}` : ''}\nSigning name: ${displayName || '[user]'}\nIMPORTANT: When writing emails, LinkedIn posts, cold outreach, or any content on behalf of the user — sign off with "${displayName || '[Your Name]'}". Never use your own agent persona name as the sender.\n\nCOMPLIANCE RULE: All content you produce will be published by the user under their name. NEVER add any AI disclosure, watermark, or signal that the content is AI-generated or automated. The content must read as if the user wrote it naturally. Do not add phrases like "AI-assisted", "Note: drafted by AI", or any variation. Platforms must see only a human author.`;
    // Boss orchestrates — giving him "when writing content" instructions makes him write directly instead of delegating.
    // Only inject userBlock into the primary prompt for non-Boss agents.
    const systemPrt  = agent.systemPrompt + memBlock + (agent.key === 'boss' ? '' : userBlock) + '\n\n' + buildKrewSystemPrompt(tools);

    // Build history from display messages (user + assistant only, not tool calls/results)
    let history: { role: string; content: string }[] = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: apiText }); // full file content goes to AI, not display

    // Compress if needed
    if (sid) history = await compressIfNeeded(history, sid);

    const MAX_STEPS = 10;
    let steps       = 0;
    let totalChars  = 0;
    const delegatedAgents = new Set<string>();

    // Add placeholder assistant message for streaming
    addMsg({ role: 'assistant', content: '', streaming: true });

    try {
      while (steps < MAX_STEPS && !stopRef.current) {
        steps++;
        setAgentStep(`Reasoning… (step ${steps})`);
        setAgentTool(null);

        let stepText = '';

        const { text: fullResponse, truncated: wasTruncated } = await streamTurn(
          history,
          systemPrt,
          (chunk) => {
            stepText += chunk;
            totalChars += chunk.length;
            // Strip raw XML blocks from streaming display (handle both <tool_call> and <tool_code>)
            const displayText = stepText
              .replace(/<tool_call>[\s\S]*/g, '')
              .replace(/<tool_code>[\s\S]*/g, '')
              .replace(/CHOICES_BLOCK:[\s\S]*/g, '')
              .trim();
            updateLastMsg(displayText);
          },
        );

        if (stopRef.current) break;

        // Auto-continue if Gemini hit its output token limit mid-response
        if (wasTruncated && !fullResponse.includes('<tool_call>') && !fullResponse.includes('<tool_code>')) {
          history.push({ role: 'assistant', content: fullResponse });
          history.push({ role: 'user', content: 'continue' });
          // Don't break — loop naturally continues to fetch the rest
          continue;
        }

        // Check for tool call — handle <tool_call> and <tool_code> (model uses both), plus unclosed tags
        const OPEN_TAGS  = ['<tool_call>', '<tool_code>'];
        const CLOSE_TAGS = ['</tool_call>', '</tool_code>'];
        let match: RegExpMatchArray | null =
          fullResponse.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/) ??
          fullResponse.match(/<tool_code>\s*([\s\S]*?)\s*<\/tool_code>/);
        if (!match) {
          const openTag = OPEN_TAGS.find(t => fullResponse.includes(t));
          if (openTag) {
            const afterTag = fullResponse.slice(fullResponse.indexOf(openTag) + openTag.length).trim();
            // Strip closing tag if present but malformed, or handle unclosed
            const clean = CLOSE_TAGS.reduce((s, t) => s.replace(t, ''), afterTag).trim();
            if (clean.startsWith('{')) match = ['', clean] as unknown as RegExpMatchArray;
          }
        }
        if (!match) {
          // Strip any partial/orphaned tool block before showing to user
          const displayResponse = fullResponse
            .replace(/<tool_call>[\s\S]*/g, '')
            .replace(/<tool_code>[\s\S]*/g, '')
            .trim() || "No response received. Go to Connect Apps and check your API key, then try again.";
          finaliseLastMsg(displayResponse);
          if (sid) krewDb.saveMessage(sid, 'assistant', fullResponse).catch(() => {});
          history.push({ role: 'assistant', content: fullResponse });

          break;
        }

        // Preserve any planning prose Boss wrote before the tool call tag
        const proseBeforeTool = stepText
          .replace(/<tool_call>[\s\S]*/g, '')
          .replace(/<tool_code>[\s\S]*/g, '')
          .replace(/CHOICES_BLOCK:[\s\S]*/g, '')
          .trim();
        if (proseBeforeTool) {
          setMessages((prev) => {
            const copy = [...prev];
            if (copy.length) copy[copy.length - 1] = { ...copy[copy.length - 1], content: proseBeforeTool, streaming: false };
            return copy;
          });
          if (sid) krewDb.saveMessage(sid, 'assistant', proseBeforeTool).catch(() => {});
        } else {
          removeLastMsg();
        }

        let parsed: { tool: string; args?: Record<string, unknown>; [key: string]: unknown } | null = null;
        const rawJson = match[1];
        // Try increasingly lenient parsing strategies
        parsed = (() => {
          // 1. Direct parse
          try { return JSON.parse(rawJson); } catch {}
          // 2. Strip markdown fences the model sometimes wraps around JSON
          const stripped = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
          try { return JSON.parse(stripped); } catch {}
          // 3. Extract outermost {...} block
          const objMatch = stripped.match(/\{[\s\S]*\}/);
          if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
          // 4. Fix literal newlines inside string values (model writes multi-line task)
          const fixed = stripped.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (m) =>
            m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
          );
          try { return JSON.parse(fixed); } catch {}
          // 5. Regex field extraction — last resort when JSON is structurally broken
          const tool      = stripped.match(/"tool"\s*:\s*"([^"]+)"/)?.[1];
          const agentKey  = stripped.match(/"agent_key"\s*:\s*"([^"]+)"/)?.[1];
          const taskMatch = stripped.match(/"task"\s*:\s*"([\s\S]+?)"\s*[,}]/);
          const task      = taskMatch?.[1]?.replace(/\\n/g, '\n');
          if (tool) return { tool, ...(agentKey ? { agent_key: agentKey } : {}), ...(task ? { task } : {}) };
          return null;
        })();
        if (!parsed) {
          addMsg({ role: 'assistant', content: 'I tried to use a tool but the response could not be parsed. Please try rephrasing your request.' });
          break;
        }

        const { tool } = parsed!;
        // Params are at root level (flat format) — fall back to nested args if present
        const rootParams = { ...parsed! } as Record<string, unknown>;
        delete rootParams.tool;
        const args: Record<string, unknown> = (parsed!.args && typeof parsed!.args === 'object')
          ? { ...rootParams, ...(parsed!.args as Record<string, unknown>) }
          : rootParams;
        setAgentStep(`Running…`);
        setAgentTool(tool);

        // Show tool call bubble (hidden for delegation — DelegationBubble handles it)
        if (tool !== 'delegate_to_agent') {
          addMsg({ role: 'tool_call', content: JSON.stringify(args, null, 2), toolName: tool });
        }
        if (sid) krewDb.saveMessage(sid, 'tool_call', JSON.stringify(args, null, 2), tool).catch(() => {});

        // Execute the tool (Boss delegation gets special handling)
        let toolResult = '';
        let isDelegation = false;
        let delegationKey = '';  // agent key for delegations — used when saving to DB
        try {
          if (tool === 'delegate_to_agent') {
            const targetKey   = String(args.agent_key ?? '');
            const task        = String(args.task ?? '');
            const targetAgent = AGENT_BY_KEY[targetKey];
            if (!targetAgent) {
              toolResult = `Unknown agent key: "${targetKey}". Valid keys are found in krewAgents.ts.`;
            } else if (delegatedAgents.has(targetKey)) {
              // Boss tried to re-delegate to an agent that already ran — stop the loop
              removeLastMsg();
              break;
            } else {
              isDelegation = true;
              delegationKey = targetKey;
              delegatedAgents.add(targetKey);
              setAgentStep(`Delegating to ${agentHandle(targetAgent)}…`);
              addMsg({ role: 'delegation', content: '', toolName: targetKey, streaming: true });
              const delegateMemories = await krewMemoryDb.getAll(targetKey).catch(() => [] as KrewMemory[]);
              const delegateMemBlock = delegateMemories.length > 0
                ? '\n\n## Your memory\n' + delegateMemories.map((m) => `- ${m.key}: ${m.value}`).join('\n')
                : '';
              const delegateSystem = targetAgent.systemPrompt + delegateMemBlock + userBlock + '\n\n' + buildKrewSystemPrompt(getActiveTools());
              // Mini ReAct loop — lets delegated agents call web_search and other tools
              const delegateMsgsHist = [{ role: 'user', content: task }];
              let delegateAccum = '';   // clean prose accumulated across turns
              let delegateFinalResp = '';
              const DELEGATE_MAX = 8;
              for (let ds = 0; ds < DELEGATE_MAX; ds++) {
                let stepText = '';
                const { text: delegateRaw, truncated: delegateTruncated } = await streamTurn(delegateMsgsHist, delegateSystem, (chunk) => {
                  stepText += chunk;
                  const cleanStep = stepText
                    .replace(/<tool_call>[\s\S]*/g, '')
                    .replace(/<tool_code>[\s\S]*/g, '')
                    .replace(/CHOICES_BLOCK:[\s\S]*/g, '')
                    .trim();
                  updateLastMsg(delegateAccum ? delegateAccum + '\n\n' + cleanStep : cleanStep);
                });
                delegateFinalResp = delegateRaw;
                // Auto-continue delegate response if truncated mid-prose
                if (delegateTruncated && !delegateRaw.includes('<tool_call>') && !delegateRaw.includes('<tool_code>')) {
                  delegateMsgsHist.push({ role: 'assistant', content: delegateRaw });
                  delegateMsgsHist.push({ role: 'user', content: 'continue' });
                  const proseSoFar = delegateRaw.replace(/<tool_call>[\s\S]*/g, '').replace(/<tool_code>[\s\S]*/g, '').replace(/CHOICES_BLOCK:[\s\S]*/g, '').trim();
                  if (proseSoFar) delegateAccum = delegateAccum ? delegateAccum + '\n\n' + proseSoFar : proseSoFar;
                  continue;
                }
                // Extract prose before any tool call tag
                const prosePart = delegateFinalResp
                  .replace(/<tool_call>[\s\S]*/g, '')
                  .replace(/<tool_code>[\s\S]*/g, '')
                  .replace(/CHOICES_BLOCK:[\s\S]*/g, '')
                  .trim();
                if (prosePart) delegateAccum = delegateAccum ? delegateAccum + '\n\n' + prosePart : prosePart;
                // Check for tool call
                let dm = delegateFinalResp.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/) ??
                  delegateFinalResp.match(/<tool_code>\s*([\s\S]*?)\s*<\/tool_code>/);
                if (!dm) {
                  const ot = ['<tool_call>','<tool_code>'].find(t => delegateFinalResp.includes(t));
                  if (ot) {
                    const after = delegateFinalResp.slice(delegateFinalResp.indexOf(ot) + ot.length).trim();
                    const cl = ['</tool_call>','</tool_code>'].reduce((s,t) => s.split(t).join(''), after).trim();
                    if (cl.startsWith('{')) dm = ['', cl] as unknown as RegExpMatchArray;
                  }
                }
                if (!dm) break; // no tool call — final answer
                // Parse tool call
                const dRaw = dm[1];
                let dParsed: Record<string, unknown> | null = null;
                try {
                  dParsed = (() => {
                    try { return JSON.parse(dRaw) as Record<string, unknown>; } catch {}
                    const s = dRaw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
                    try { return JSON.parse(s) as Record<string, unknown>; } catch {}
                    const m2 = s.match(/\{[\s\S]*\}/); if (m2) { try { return JSON.parse(m2[0]) as Record<string, unknown>; } catch {} }
                    return null;
                  })();
                } catch {}
                if (!dParsed) break;
                const dTool = String(dParsed.tool ?? '');
                const dRoot = { ...dParsed } as Record<string, unknown>; delete dRoot.tool;
                const dArgs = (dParsed.args && typeof dParsed.args === 'object')
                  ? { ...dRoot, ...(dParsed.args as Record<string, unknown>) } : dRoot;
                updateLastMsg((delegateAccum || '') + '\n\n*Searching…*');
                let dResult = '';
                try {
                  dResult = await executeTool(dTool, dArgs, creds, requestTerminalApproval, targetKey, user?.id ?? '');
                  if (dTool === 'web_search' && !creds.brave?.api_key) setBraveNudge(true);
                } catch (e) { dResult = `Error: ${e}`; }
                delegateMsgsHist.push({ role: 'assistant', content: delegateFinalResp });
                delegateMsgsHist.push({ role: 'user', content: `<tool_result>${dResult}</tool_result>` });
              }
              const { cleanContent: delegateClean, choices: delegateChoices } = extractChoices(delegateAccum || delegateFinalResp);
              toolResult = delegateClean;
              const bubbleContent = delegateClean.trim() ||
                (delegateChoices ? `Here are ${delegateChoices.choices.length} variants — pick the one you want:` : '(no response)');
              setMessages(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === 'delegation') copy[copy.length - 1] = { ...last, content: bubbleContent, streaming: false };
                return copy;
              });
              if (delegateChoices) {
                addMsg({ role: 'choices', content: '', choices: delegateChoices });
                if (sid) krewDb.saveMessage(sid, 'tool_result', JSON.stringify(delegateChoices), '__choices__').catch(() => {});
              }
            }
          } else {
            toolResult = await executeTool(tool, args, creds, requestTerminalApproval, agent.key, user?.id ?? '');
            if (tool === 'save_memory' || tool === 'forget_memory') {
              krewMemoryDb.getAll(agent.key).then(setAgentMemories).catch(() => {});
            }
            // Show Brave nudge when web search runs without a Brave key (DuckDuckGo fallback gives stale data)
            if (tool === 'web_search' && !creds.brave?.api_key) setBraveNudge(true);
          }
        } catch (e) {
          toolResult = `Error: ${e}`;
        }

        // Show result bubble (skip for delegation — it already has its own bubble)
        if (!isDelegation) addMsg({ role: 'tool_result', content: toolResult, toolName: tool });
        // Save delegations with role 'delegation' + agent key so they restore correctly on reload
        if (isDelegation) {
          if (sid) krewDb.saveMessage(sid, 'delegation', toolResult, delegationKey).catch(() => {});
        } else {
          if (sid) krewDb.saveMessage(sid, 'tool_result', toolResult, tool).catch(() => {});
        }

        // Add to history for next AI turn
        history.push({ role: 'assistant', content: fullResponse });
        history.push({ role: 'user', content: `<tool_result>${toolResult}</tool_result>` });

        // Add next streaming placeholder
        addMsg({ role: 'assistant', content: '', streaming: true });
      }

      // Track tokens for adris.tech mode
      if (mode === 'nivara' && totalChars > 0) {
        trackTokenUsage('krew', totalChars);
      }
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/monthly.*token|reached.*monthly|token.*limit|upgrade.*plan|adris\.tech\/pricing/i.test(raw)) {
        // Server-side quota exceeded — remove streaming bubble and show upgrade modal
        setMessages(prev => {
          const copy = [...prev];
          if (copy[copy.length - 1]?.streaming) copy.pop();
          return copy;
        });
        setShowQuotaUpgrade(true);
      } else {
        finaliseLastMsg(sanitiseError(e));
      }
    } finally {
      setBusy(false);
      setAgentStep(null);
      setAgentTool(null);
      // After generation ends, scroll to the first unconfirmed choices card so it's visible
      setTimeout(() => {
        const firstChoice = document.querySelector('[data-choice-card]');
        if (firstChoice) firstChoice.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  }

  function stop() {
    stopRef.current = true;
    // Find and finalise any streaming message
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.streaming) copy[copy.length - 1] = { ...last, streaming: false };
      return copy;
    });
    setBusy(false);
    setAgentStep(null);
    setAgentTool(null);
  }

  // ── Message helpers ───────────────────────────────────────────────────────

  function addMsg(msg: DisplayMsg) {
    setMessages((prev) => [...prev, msg]);
  }

  function updateLastMsg(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length) copy[copy.length - 1] = { ...copy[copy.length - 1], content, streaming: true };
      return copy;
    });
  }

  function finaliseLastMsg(rawContent: string) {
    const { cleanContent: afterProposal, proposal: extracted } = extractProposal(rawContent);
    const { cleanContent, choices: extractedChoices } = extractChoices(afterProposal);
    setMessages((prev) => {
      const copy = [...prev];
      if (copy.length) copy[copy.length - 1] = { ...copy[copy.length - 1], content: cleanContent, streaming: false };
      // Only add a proposal if none exists yet (prevents duplicates from reflection pass or multi-step Boss)
      if (extracted && !copy.some((m) => m.role === 'proposal')) {
        copy.push({ role: 'proposal', content: '', proposal: extracted });
        if (sidRef.current) sessionStorage.setItem(`krew-proposal-${sidRef.current}`, JSON.stringify(extracted));
      }
      if (extractedChoices) {
        copy.push({ role: 'choices', content: '', choices: extractedChoices });
        if (sidRef.current) krewDb.saveMessage(sidRef.current, 'tool_result', JSON.stringify(extractedChoices), '__choices__').catch(() => {});
      }
      return copy;
    });
  }

  function removeLastMsg() {
    setMessages((prev) => prev.slice(0, -1));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeTools = getActiveTools();

  return (
    <>
      {termApproval && (
        <TerminalApprovalModal
          command={termApproval.command}
          onApprove={() => { termApproval.resolve(true);  setTermApproval(null); }}
          onDeny=   {() => { termApproval.resolve(false); setTermApproval(null); }}
        />
      )}


      <div className="flex flex-col h-full">
        {/* Agent identity header */}
        <div
          className={`flex items-center gap-2.5 px-3 py-2 border-b border-nv-border shrink-0 bg-nv-bg ${onBrowseAgents ? 'cursor-pointer hover:bg-nv-surface transition-fast' : ''}`}
          onClick={onBrowseAgents}
          title={onBrowseAgents ? 'Click to switch agent' : undefined}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${CATEGORY_COLOR[agent.category]}`}>
            {agentInitials(agent)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[12px] font-semibold text-nv-text">{agentHandle(agent)}</p>
              {onBrowseAgents && (
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" className="text-nv-faint shrink-0 mt-0.5">
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <p className="text-[10px] text-nv-faint truncate">{agent.description}</p>
          </div>
          {onBrowseAgents && (
            <span className="text-[9px] font-mono text-nv-faint bg-nv-surface border border-nv-border rounded px-1.5 py-0.5 shrink-0">
              Switch
            </span>
          )}
        </div>

        {/* Agent status bar */}
        <AgentStatus step={agentStep} tool={agentTool} />

        {/* Connection bar */}
        <div className="px-2 py-2 border-b border-nv-border shrink-0">
          <ConnectionBar
            mode={mode}               onModeChange={setMode}
            apiKey={apiKey}           onApiKeyChange={setApiKey}
            provider={provider}       onProviderChange={setProvider}
            modelName={modelName}     onModelNameChange={setModelName}
            baseUrl={baseUrl}         onBaseUrlChange={setBaseUrl}
            localModel={localModel}   onLocalModelChange={setLocalModel}
          />
        </div>

        {/* Active tools strip */}
        {activeTools.length > 3 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-nv-border overflow-x-auto shrink-0">
            {activeTools.slice(3).map((t) => (
              <span key={t.name} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono shrink-0">{t.name}</span>
            ))}
          </div>
        )}

        {/* Connect Apps nudge — shown when no service tools are active */}
        {activeTools.filter((t) => !['read_file','execute_terminal','web_search','save_memory','recall_memory','forget_memory','delegate_to_agent'].includes(t.name)).length === 0 && onOpenConnectApps && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nv-border bg-nv-surface shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-nv-faint shrink-0">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-[10px] text-nv-faint flex-1">
              No apps connected. Link Gmail, GitHub, Notion &amp; more for real actions.
            </p>
            <button
              onClick={onOpenConnectApps}
              className="text-[10px] text-accent hover:underline shrink-0 font-mono"
            >
              Connect →
            </button>
          </div>
        )}

        {/* Brave nudge banner — shown after a web search without Brave key */}
        {braveNudge && (
          <div className="mx-3 mb-1 flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-orange-500/25 bg-orange-500/8">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-orange-400 shrink-0 mt-0.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-orange-300 leading-tight">Live search not active</p>
              <p className="text-[10px] text-nv-faint mt-0.5 leading-relaxed">Results are from a basic fallback — data may be months out of date. Connect Brave Search for real-time results. Free tier includes 2,000 searches/month.</p>
            </div>
            <button
              onClick={() => { setBraveNudge(false); onOpenConnectApps?.(); }}
              className="shrink-0 text-[10px] font-mono px-2.5 py-1 rounded-lg bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 border border-orange-500/30 transition-fast whitespace-nowrap"
            >Connect Brave →</button>
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-4 relative"
          style={{ pointerEvents: 'auto' }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-[14px] font-bold ${CATEGORY_COLOR[agent.category]}`}>
                {agentInitials(agent)}
              </div>
              <div className="text-center">
                <p className="text-nv-text text-[13px] font-semibold">{agentHandle(agent)}</p>
                <p className="text-nv-faint text-[11px] mt-1 max-w-[260px] leading-relaxed">
                  {agent.description}
                </p>
                {activeTools.length > 3 && (
                  <p className="text-nv-faint text-[10px] mt-1 font-mono">
                    {activeTools.length - 3} app{activeTools.length - 3 > 1 ? 's' : ''} connected
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 w-full max-w-[280px] mt-1">
                {getStarterPrompts(agent).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setInput(ex)}
                    className="text-left text-[11px] px-3 py-2 rounded-lg border border-nv-border
                      text-nv-muted hover:border-accent hover:text-accent transition-fast"
                  >{ex}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) =>
              msg.role === 'proposal' && msg.proposal ? (
                <ProposalCard
                  key={i}
                  proposal={msg.proposal}
                  agentName={agentHandle(agent)}
                  userId={user?.id ?? ''}
                  onAccept={() => {
                    if (sidRef.current) sessionStorage.removeItem(`krew-proposal-${sidRef.current}`);
                    addMsg({ role: 'assistant', content: '✅ Automation is live! It will run automatically and you can manage it in the Automation module.' });
                  }}
                  onDecline={() => {
                    if (sidRef.current) sessionStorage.removeItem(`krew-proposal-${sidRef.current}`);
                    addMsg({ role: 'assistant', content: "Okay, dropped. Let me know if you'd like a different setup." });
                  }}
                  onViewOnCanvas={onViewOnCanvas ? () => { const f = proposalToFlow(msg.proposal!); onViewOnCanvas(f.nodes, f.edges); } : undefined}
                />
              ) : msg.role === 'choices' && msg.choices ? (
                <ChoicePicker
                  key={i}
                  choiceSet={msg.choices}
                  disabled={busy}
                  storageKey={sidRef.current ? `nv-choice:${sidRef.current}:${i}` : undefined}
                  onSelect={(content) => {
                    // Content renders inside the card itself — only persist to DB
                    if (sidRef.current) krewDb.saveMessage(sidRef.current, 'assistant', content).catch(() => {});
                  }}
                />
              ) : (
                <MessageRow key={i} msg={msg} agent={agent} />
              )
            )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <div className="flex justify-center pb-1 shrink-0">
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-nv-surface border border-nv-border text-nv-muted hover:text-nv-text hover:border-accent/40 text-[11px] font-mono shadow-sm transition-fast"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1v7M1.5 5.5L5 9l3.5-3.5"/>
              </svg>
              Scroll to bottom
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-nv-border shrink-0">
          {voiceErr && (
            <p className="text-[10px] text-red-400 mb-1.5 px-0.5">{voiceErr}
              <button className="ml-1.5 underline opacity-60" onClick={() => { setVoiceErr(null); setVoiceStatus('idle'); }}>dismiss</button>
            </p>
          )}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-accent/10 border border-accent/25 rounded-lg">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  <span className="text-[10px] font-mono text-accent max-w-[150px] truncate">{f.name}</span>
                  <button
                    onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    className="text-accent/50 hover:text-accent transition-fast text-[12px] leading-none ml-0.5"
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end">
            {/* Mic button */}
            <button
              title={voiceStatus === 'recording' ? 'Stop recording' : voiceStatus === 'transcribing' ? 'Transcribing…' : 'Voice input · Builder+ plan'}
              onClick={handleMicClick}
              disabled={voiceStatus === 'transcribing'}
              className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-fast shrink-0 mb-0.5 ${
                voiceStatus === 'recording'
                  ? 'border-red-500/60 bg-red-500/10 text-red-400 animate-pulse'
                  : voiceStatus === 'transcribing'
                  ? 'border-nv-border opacity-50 text-nv-faint cursor-not-allowed'
                  : 'border-nv-border text-nv-faint hover:text-accent hover:border-accent'
              }`}
            >
              {voiceStatus === 'recording' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              ) : voiceStatus === 'transcribing' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" opacity=".3"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" className="animate-spin origin-center"/></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>
            {/* File attach */}
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.html,.css,.xml,.yaml,.yml,.toml,.sh,.sql,.log"
              style={{ display: 'none' }}
              id="krew-file-attach"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                let pending = files.length;
                const results: { name: string; content: string }[] = new Array(files.length);
                files.forEach((file, i) => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    results[i] = { name: file.name, content: ev.target?.result as string ?? '' };
                    if (--pending === 0) setAttachedFiles(prev => [...prev, ...results]);
                  };
                  reader.readAsText(file);
                });
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => document.getElementById('krew-file-attach')?.click()}
              title="Attach a file"
              className="w-7 h-7 flex items-center justify-center rounded-lg border border-nv-border
                text-nv-faint hover:text-nv-text hover:border-accent transition-fast shrink-0 mb-0.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={`Ask ${agent.humanName} anything… (Shift+Enter for newline)`}
              rows={2}
              className="flex-1 bg-nv-bg border border-nv-border rounded-lg px-2.5 py-1.5
                text-[11px] text-nv-text outline-none focus:border-accent transition-fast
                resize-none placeholder:text-nv-faint"
            />
            {onOpenStudio && !busy && input.trim() && (
              <button
                onClick={openInStudio}
                disabled={studioExtracting}
                title="Open this content in Studio as a video"
                className="flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-lg border border-accent/40 text-accent hover:bg-accent/10 transition-fast shrink-0 font-mono disabled:opacity-50"
              >
                {studioExtracting ? (
                  <span className="w-2.5 h-2.5 rounded-full border border-accent/30 border-t-accent animate-spin" />
                ) : (
                  <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                    <path d="M5 1l.9 2.7H8.5l-2.3 1.7.9 2.7L5 6.7l-2.2 1.4.9-2.7L1.5 3.7h2.6z" fill="currentColor"/>
                  </svg>
                )}
                Studio
              </button>
            )}
            {busy ? (
              <button
                onClick={stop}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-red/50
                  text-nv-red hover:bg-nv-red/10 transition-fast shrink-0"
              >Stop</button>
            ) : (
              <button
                onClick={send}
                disabled={!input.trim()}
                className="text-[11px] px-2.5 py-1.5 rounded-lg bg-accent text-white
                  hover:bg-accent-dim transition-fast disabled:opacity-40 shrink-0"
              >Send</button>
            )}
          </div>
        </div>
      </div>
      {showVoiceUpgrade && (
        <UpgradeModal
          onClose={() => setShowVoiceUpgrade(false)}
          currentPlan={profile?.plan ?? 'explore'}
          highlightPlan="builder"
          reason="Voice input in Krew requires Builder plan or higher."
        />
      )}
      {showQuotaUpgrade && (
        <UpgradeModal
          onClose={() => setShowQuotaUpgrade(false)}
          currentPlan={profile?.plan ?? 'explore'}
          highlightPlan="solo"
          reason="You've used all your AI tasks for this period. Upgrade to keep going."
        />
      )}
    </>
  );
}
