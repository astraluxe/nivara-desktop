import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface AutomationProposal {
  name:               string;
  description?:       string;
  trigger_type:       'schedule' | 'email' | 'file_watch' | 'webhook';
  trigger_config:     Record<string, unknown>;
  steps:              Array<{ action: string; prompt: string; output: string }>;
  is_temp:            boolean;
  max_runs?:          number;
  knowledge_context?: string;   // company docs / FAQs embedded into every step at runtime
}

interface Props {
  proposal:    AutomationProposal;
  agentName:   string;
  userId:      string;
  onAccept:    () => void;
  onDecline:   () => void;
}

const TRIGGER_ICONS: Record<string, string> = {
  schedule:   '⏰',
  email:      '✉',
  file_watch: '📁',
  webhook:    '🔗',
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule:   'Schedule',
  email:      'Email received',
  file_watch: 'File added',
  webhook:    'Webhook',
};

const ACTION_ICONS: Record<string, string> = {
  summarise: '📝', reply: '↩', extract: '🔍',
  classify: '🏷', report: '📊', translate: '🌐',
};
const ACTION_LABELS: Record<string, string> = {
  summarise: 'Summarise', reply: 'Draft reply', extract: 'Extract data',
  classify: 'Classify', report: 'Generate report', translate: 'Translate',
};

const OUTPUT_ICONS: Record<string, string> = {
  notification: '🔔', file: '💾', email_reply: '✉', notion: 'N', slack: '#',
};
const OUTPUT_LABELS: Record<string, string> = {
  notification: 'Desktop alert', file: 'Save to file',
  email_reply: 'Send email', notion: 'Notion page', slack: 'Slack message',
};

function triggerSummary(type: string, config: Record<string, unknown>): string {
  if (type === 'schedule' && config.cron) return humanCron(String(config.cron));
  if (type === 'email') {
    const parts: string[] = [];
    if (config.email_from)    parts.push(`from ${config.email_from}`);
    if (config.email_subject) parts.push(`subject contains "${config.email_subject}"`);
    return parts.length ? parts.join(' · ') : 'Any incoming email';
  }
  if (type === 'file_watch') return String(config.folder || 'Watched folder');
  if (type === 'webhook') return `POST ${config.webhook_path || '/webhook'}`;
  return '';
}

function humanCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron;
  const [min, hour, day, , wday] = p;
  const pad = (s: string) => s.padStart(2, '0');
  const t = `${pad(hour)}:${pad(min)}`;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (hour === '*') return `Every hour at :${pad(min)}`;
  if (wday === '1-5') return `Every weekday at ${t}`;
  if (wday !== '*') { const d = parseInt(wday); return `Every ${DAYS[d] ?? wday} at ${t}`; }
  if (day !== '*') return `Monthly on the ${day}th at ${t}`;
  return `Every day at ${t}`;
}

export default function AutomationProposalModal({ proposal, agentName, userId, onAccept, onDecline }: Props) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function accept() {
    setLoading(true);
    setError('');
    try {
      const id = crypto.randomUUID();
      const triggerConfig = JSON.stringify({
        ...proposal.trigger_config,
        is_temp:  true,
        max_runs: proposal.max_runs ?? 1,
      });
      const steps = proposal.steps.map((s, i) => ({
        id:     `${id}-${i}`,
        action: s.action,
        prompt: s.prompt,
        output: s.output,
        output_config: {},
      }));
      await invoke('automation_create', {
        id, userId,
        name:          proposal.name,
        triggerType:   proposal.trigger_type,
        triggerConfig,
        steps:         JSON.stringify(steps),
      });
      onAccept();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const maxRuns = proposal.max_runs ?? 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-nv-bg border border-nv-border rounded-2xl w-full max-w-md mx-4 flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nv-border">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center text-accent text-sm">🤖</div>
            <div>
              <p className="text-[11px] text-nv-faint font-mono">{agentName} proposes an automation</p>
              <p className="text-sm font-semibold text-nv-text">{proposal.name}</p>
            </div>
          </div>
          <span className="text-[9px] font-mono px-2 py-1 rounded-full bg-nv-yellow/15 text-nv-yellow border border-nv-yellow/30">
            Temp · auto-deletes after {maxRuns} run{maxRuns !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {proposal.description && (
            <p className="text-xs text-nv-muted leading-relaxed">{proposal.description}</p>
          )}

          {/* Flow preview */}
          <div className="space-y-1.5">
            {/* Trigger */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-nv-surface border border-nv-border">
              <span className="text-lg shrink-0">{TRIGGER_ICONS[proposal.trigger_type] ?? '⚡'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-nv-faint font-mono uppercase">Trigger</p>
                <p className="text-xs font-semibold text-nv-text">{TRIGGER_LABELS[proposal.trigger_type]}</p>
                <p className="text-[10px] text-nv-muted truncate">{triggerSummary(proposal.trigger_type, proposal.trigger_config)}</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center text-nv-faint text-xs">↓</div>

            {/* Steps */}
            {proposal.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-nv-surface border border-nv-border">
                <span className="text-lg shrink-0 mt-0.5">{ACTION_ICONS[step.action] ?? '🤖'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-nv-faint font-mono uppercase">Step {i + 1} · AI Action</p>
                  <p className="text-xs font-semibold text-nv-text">{ACTION_LABELS[step.action] ?? step.action}</p>
                  <p className="text-[10px] text-nv-muted line-clamp-2 mt-0.5">{step.prompt}</p>
                </div>
              </div>
            ))}

            {/* Arrow */}
            <div className="flex justify-center text-nv-faint text-xs">↓</div>

            {/* Output (last step's output) */}
            {proposal.steps.length > 0 && (() => {
              const out = proposal.steps[proposal.steps.length - 1].output;
              return (
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-nv-surface border border-nv-border">
                  <span className="text-lg shrink-0">{OUTPUT_ICONS[out] ?? '📤'}</span>
                  <div>
                    <p className="text-[10px] text-nv-faint font-mono uppercase">Output</p>
                    <p className="text-xs font-semibold text-nv-text">{OUTPUT_LABELS[out] ?? out}</p>
                  </div>
                </div>
              );
            })()}
          </div>

          {error && (
            <p className="text-[11px] text-nv-red bg-nv-red/10 border border-nv-red/20 rounded-lg px-3 py-2 font-mono">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-nv-border">
          <button onClick={onDecline} disabled={loading}
            className="text-sm text-nv-muted hover:text-nv-text transition-fast font-mono disabled:opacity-40">
            Decline
          </button>
          <button onClick={accept} disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-accent hover:bg-accent-dim text-white text-sm font-semibold transition-fast disabled:opacity-50">
            {loading
              ? <><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg> Saving…</>
              : <>✓ Accept &amp; Go Live</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
