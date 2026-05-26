import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuth } from '../contexts/AuthContext';
import type { Node, Edge } from '@xyflow/react';
import FlowCanvas, { type FlowCanvasHandle } from '../components/automation/FlowCanvas';
import { executeAutomation, callAutomationAI, type AutomationRow } from '../lib/automationRunner';
import { credentialStore } from '../lib/krewDb';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type TriggerType = 'schedule' | 'file_watch' | 'email' | 'webhook' | 'twitter_mention' | 'rss' | 'github' | 'stripe' | 'google_calendar' | 'canvas_flow';
type OutputType  = 'notification' | 'file' | 'email_reply' | 'notion' | 'slack' | 'twitter_post' | 'twitter_reply' | 'linkedin_post' | 'reddit_post' | 'discord' | 'google_sheets' | 'twilio_sms' | 'telegram' | 'hubspot';
type ActionType  = 'summarise' | 'reply' | 'extract' | 'classify' | 'report' | 'translate';

interface TriggerConfig {
  cron?: string;
  folder?: string;
  file_types?: string;
  email_filter?: string;
  email_from?: string;
  email_subject?: string;
  webhook_path?: string;
  twitter_filter?: string;
  weekdays_only?: boolean;
  business_hours?: boolean;
  dedupe_daily?: boolean;
  is_temp?: boolean;
  max_runs?: number;
  knowledge_context?: string;
  notion_crm_db?: string;
  pitch_file_path?: string;
  // New triggers
  rss_url?: string;
  github_repo?: string;
  github_event?: string;
  stripe_event?: string;
  calendar_id?: string;
  lookahead_mins?: number;
}

interface OutputConfig {
  notif_title?: string;
  file_path?: string;
  file_format?: string;
  file_append?: boolean;
  email_to?: string;
  notion_db_url?: string;
  slack_channel?: string;
  twitter_reply_to_id?: string;
  linkedin_visibility?: string;
  linkedin_person_urn?: string;
  discord_webhook?: string;
  sheet_id?: string;
  sheet_name?: string;
  sms_to?: string;
  telegram_chat_id?: string;
  hubspot_action?: string;
  reddit_subreddit?: string;
  reddit_post_title?: string;
}

interface Step {
  id: string;
  action: ActionType;
  prompt: string;
  output: OutputType;
  output_config?: OutputConfig;
}

interface Automation {
  id: string;
  user_id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: string;
  steps: string;
  enabled: boolean;
  cloud_enabled: boolean;
  run_count: number;
  last_run_at: number | null;
  created_at: number;
}

interface AutomationRun {
  id: string;
  automation_id: string;
  triggered_at: number;
  completed_at: number | null;
  tokens_used: number;
  status: 'running' | 'success' | 'failed';
  output_summary: string | null;
  error: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

function fmtTs(ts: number | null) {
  if (!ts) return 'Never';
  return new Date(ts * 1000).toLocaleString();
}

function fmtRelative(ts: number) {
  const d = Date.now() - ts * 1000;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  schedule: 'Schedule', file_watch: 'File added', email: 'Email received', webhook: 'Webhook URL',
  twitter_mention: 'X mention', rss: 'RSS Feed', github: 'GitHub event',
  stripe: 'Stripe payment', google_calendar: 'Calendar event', canvas_flow: 'Canvas Flow',
};
const ACTION_LABELS: Record<ActionType, string> = {
  summarise: 'Summarise', reply: 'Draft reply', extract: 'Extract data',
  classify: 'Classify', report: 'Generate report', translate: 'Translate',
};

// ─── Schedule helpers ─────────────────────────────────────────────────────────

type FreqType = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';

function nth(n: number): string {
  if (n >= 11 && n <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd', 'th'][Math.min(n % 10, 4)];
}

function cronToHuman(cron: string): string {
  if (!cron) return 'Not configured';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, day, , wday] = parts;
  const pad = (s: string) => s.padStart(2, '0');
  const timeStr = `${pad(hour)}:${pad(min)}`;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (hour === '*') return `Every hour at :${pad(min)}`;
  if (wday === '1-5') return `Every weekday at ${timeStr}`;
  if (wday !== '*') { const d = parseInt(wday); return `Every ${DAYS[d] ?? wday} at ${timeStr}`; }
  if (day !== '*') { const d = parseInt(day); return `Monthly on the ${d}${nth(d)} at ${timeStr}`; }
  return `Every day at ${timeStr}`;
}

function scheduleToCron(s: { freq: FreqType; hour: number; minute: number; weekday: number; monthDay: number; customCron: string }): string {
  const m = s.minute.toString();
  const h = s.hour.toString();
  switch (s.freq) {
    case 'hourly':   return `${m} * * * *`;
    case 'daily':    return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly':   return `${m} ${h} * * ${s.weekday}`;
    case 'monthly':  return `${m} ${h} ${s.monthDay} * *`;
    case 'custom':   return s.customCron || '0 9 * * *';
  }
}

function parseCron(cron: string): { freq: FreqType; hour: number; minute: number; weekday: number; monthDay: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { freq: 'custom', hour: 9, minute: 0, weekday: 1, monthDay: 1 };
  const [min, hour, day, , wday] = parts;
  const h = parseInt(hour);
  const m = parseInt(min);
  const safeH = isNaN(h) ? 9 : h;
  const safeM = isNaN(m) ? 0 : m;
  if (hour === '*') return { freq: 'hourly', hour: safeH, minute: safeM, weekday: 1, monthDay: 1 };
  if (wday === '1-5') return { freq: 'weekdays', hour: safeH, minute: safeM, weekday: 1, monthDay: 1 };
  if (wday !== '*') { const d = parseInt(wday); if (!isNaN(d)) return { freq: 'weekly', hour: safeH, minute: safeM, weekday: d, monthDay: 1 }; }
  if (day !== '*') { const dom = parseInt(day); if (!isNaN(dom)) return { freq: 'monthly', hour: safeH, minute: safeM, weekday: 1, monthDay: dom }; }
  return { freq: 'daily', hour: safeH, minute: safeM, weekday: 1, monthDay: 1 };
}

// ─── AI Stream Helper ─────────────────────────────────────────────────────────

async function callAI(
  userMessage: string,
  systemPrompt: string,
  forceLocal = false,
): Promise<string> {
  if (forceLocal) {
    // Local-only path for canvas AI builder
    const { listen } = await import('@tauri-apps/api/event');
    const callId = uuid();
    return new Promise<string>(async (resolve, reject) => {
      let fullText = '';
      let cleanup = () => {};
      const u1 = await listen<{ id: string; text: string }>('krew-chunk', e => {
        if (e.payload.id !== callId) return; fullText += e.payload.text;
      });
      const u2 = await listen<{ id: string }>('krew-done', e => {
        if (e.payload.id !== callId) return; cleanup(); resolve(fullText);
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', e => {
        if (e.payload.id !== callId) return; cleanup(); reject(new Error(e.payload.error));
      });
      cleanup = () => { u1(); u2(); u3(); };
      invoke('krew_ai_stream', {
        callId, mode: 'local', systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        apiKey: null, provider: null, modelName: null,
        localModel: 'llama3', baseUrl: null, sessionToken: null,
      }).catch(e => { cleanup(); reject(e); });
    });
  }
  return callAutomationAI(userMessage, systemPrompt);
}

// ─── Automation / Template → Flow Diagram ────────────────────────────────────

function buildFlow(
  triggerType: TriggerType,
  triggerConfig: TriggerConfig,
  steps: Array<Pick<Step, 'action' | 'prompt' | 'output'>>,
): { nodes: Node[]; edges: Edge[] } {
  const X = 280;
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const tSubtitle = triggerConfig.cron
    ? cronToHuman(triggerConfig.cron)
    : triggerConfig.folder || triggerConfig.email_filter || triggerConfig.webhook_path
      || (triggerConfig.twitter_filter ? `filter: ${triggerConfig.twitter_filter}` : undefined)
      || '';
  const tExtraData = triggerType === 'twitter_mention'
    ? { twitter_filter: triggerConfig.twitter_filter, pitch_file_path: triggerConfig.pitch_file_path, notion_crm_db: triggerConfig.notion_crm_db }
    : {};
  nodes.push({
    id: 'n0', type: 'trigger',
    position: { x: 80, y: 200 },
    data: { label: TRIGGER_LABELS[triggerType] ?? triggerType, subtitle: tSubtitle, triggerType, ...tExtraData },
  });

  steps.forEach((step, i) => {
    const id = `n${i + 1}`;
    nodes.push({
      id, type: 'ai_action',
      position: { x: 80 + (i + 1) * X, y: 200 },
      data: { label: ACTION_LABELS[step.action] ?? step.action, action: step.action, prompt: step.prompt },
    });
    edges.push({ id: `e${i}`, source: i === 0 ? 'n0' : `n${i}`, target: id, type: 'dot', data: { srcType: i === 0 ? 'trigger' : 'ai_action' } });
  });

  if (steps.length > 0) {
    const lastStep = steps[steps.length - 1];
    const outLabels: Record<OutputType, string> = {
      notification: 'Notification', file: 'Save to file',
      email_reply: 'Send email', notion: 'Notion page', slack: 'Slack post',
      twitter_post: 'X post', twitter_reply: 'X reply', linkedin_post: 'LinkedIn post', reddit_post: 'Reddit post',
      discord: 'Discord', google_sheets: 'Google Sheets', twilio_sms: 'SMS',
      telegram: 'Telegram', hubspot: 'HubSpot CRM',
    };
    nodes.push({
      id: 'nout', type: 'output',
      position: { x: 80 + (steps.length + 1) * X, y: 200 },
      data: { label: outLabels[lastStep.output] ?? lastStep.output, outputType: lastStep.output, subtitle: '' },
    });
    edges.push({ id: 'eout', source: `n${steps.length}`, target: 'nout', type: 'dot', data: { srcType: 'ai_action' } });
  }

  return { nodes, edges };
}

function automationToFlow(automation: Automation) {
  if (automation.trigger_type === 'canvas_flow') {
    try {
      return JSON.parse(automation.trigger_config) as { nodes: Node[]; edges: Edge[] };
    } catch {
      return { nodes: [], edges: [] };
    }
  }
  return buildFlow(
    automation.trigger_type,
    JSON.parse(automation.trigger_config) as TriggerConfig,
    JSON.parse(automation.steps) as Step[],
  );
}

function templateToFlow(t: Template) {
  return buildFlow(t.trigger_type, t.trigger_config, t.steps);
}

const FLOW_SYSTEM_PROMPT = `You are a workflow automation builder. The user will describe an automation.
Return ONLY valid JSON (no markdown, no explanation, no code fences) with this exact shape:
{"nodes":[{"id":"n1","type":"trigger","position":{"x":100,"y":200},"data":{"label":"Schedule","subtitle":"Every Monday at 09:00","triggerType":"schedule"}}],"edges":[]}

Node types:
- "trigger": data needs label, subtitle (human-readable description), triggerType ("schedule"|"email"|"file_watch"|"webhook"|"twitter_mention"|"rss"|"github"|"stripe"|"google_calendar")
- "ai_action": data needs label, action ("summarise"|"reply"|"extract"|"classify"|"report"|"translate"), prompt
- "condition": data needs label, filter ("contains"|"not_contains"|"starts_with"|"not_empty"|"always"), keyword (optional string). Has two output handles: yes (green) and no (red).
- "loop": data needs label, loopSource ("previous step"|"json_array"|"lines"|"csv_rows"), loopField (optional dot-path for json_array). Has "each" handle (per-item) and "done" handle (after all).
- "http": data needs label, method ("GET"|"POST"|"PUT"|"PATCH"|"DELETE"), url, headers (JSON string, optional), body (JSON string, optional).
- "transform": data needs label, transformType ("json_extract"|"regex"|"text_trim"|"to_lowercase"|"to_uppercase"|"number_round"|"split_lines"|"first_n_chars"), expression (optional).
- "approval": data needs label, notifyEmail, message, timeoutHours. Has "approved" and "rejected" handles.
- "subagent": data needs label, goal, agentCount (number), strategy ("parallel"|"sequential"|"debate").
- "output": data needs label, outputType ("notification"|"email_reply"|"file"|"notion"|"slack"|"twitter_post"|"twitter_reply"|"linkedin_post"|"discord"|"google_sheets"|"twilio_sms"|"telegram"|"hubspot"), subtitle

Layout: x starts at 100 and increases by 280 per step. y=200. For branches (condition/approval): yes/approved branch y=80, no/rejected branch y=320. Loop body steps offset y by +120.
Edge shape: {"id":"e1","source":"n1","target":"n2","type":"line","data":{"srcType":"trigger"}}
For condition/loop/approval edges, add "sourceHandle":"yes" or "sourceHandle":"no" or "sourceHandle":"each" etc. to the edge.
srcType in edge data matches the source node's type.

CRITICAL: Return ONLY the raw JSON object. Nothing else.`;

// ─── Templates ────────────────────────────────────────────────────────────────

interface Template {
  id: string; name: string; description: string;
  trigger_type: TriggerType; trigger_config: TriggerConfig;
  steps: Omit<Step, 'id'>[]; tags: string[];
}

const TEMPLATES: Template[] = [
  {
    id: 'auto-reply-leads', name: 'Auto-reply to leads',
    description: 'When a new email arrives, research the sender and draft a personalised reply.',
    trigger_type: 'email', trigger_config: { email_filter: 'subject:inquiry OR subject:interested' },
    steps: [
      { action: 'extract', prompt: 'Extract the sender name, company, and what they are asking for.', output: 'notification' },
      { action: 'reply', prompt: 'Write a warm, professional reply addressing their specific ask. Keep it under 150 words.', output: 'email_reply' },
    ], tags: ['Email', 'Sales'],
  },
  {
    id: 'weekly-client-report', name: 'Weekly client report',
    description: 'Every Monday, summarise progress and email the client.',
    trigger_type: 'schedule', trigger_config: { cron: '0 9 * * 1' },
    steps: [
      { action: 'summarise', prompt: 'Summarise the key updates from this week. Use bullet points.', output: 'email_reply' },
    ], tags: ['Schedule', 'Reports'],
  },
  {
    id: 'invoice-tracker', name: 'Invoice tracker',
    description: 'Watch inbox for invoices, extract amounts and due dates, alert if overdue.',
    trigger_type: 'email', trigger_config: { email_filter: 'subject:invoice OR subject:payment' },
    steps: [
      { action: 'extract', prompt: 'Extract: invoice number, amount, due date, sender company. Return as JSON.', output: 'file' },
      { action: 'classify', prompt: 'Is this invoice overdue? If yes, flag it urgently.', output: 'notification' },
    ], tags: ['Email', 'Finance'],
  },
  {
    id: 'support-router', name: 'Support ticket router',
    description: 'New email → classify intent → route to the right person or auto-respond.',
    trigger_type: 'email', trigger_config: { email_filter: 'subject:support OR subject:help' },
    steps: [
      { action: 'classify', prompt: 'Classify this request: billing / technical / feature request / complaint. Output: category + urgency.', output: 'notification' },
      { action: 'reply', prompt: 'Write a helpful acknowledgement email with a realistic response time.', output: 'email_reply' },
    ], tags: ['Email', 'Support'],
  },
  {
    id: 'daily-standup', name: 'Daily standup digest',
    description: 'Every morning, summarise activity and post to Slack.',
    trigger_type: 'schedule', trigger_config: { cron: '0 8 * * 1-5' },
    steps: [
      { action: 'report', prompt: 'Write a brief standup update: done yesterday, planned today. Under 10 lines.', output: 'slack' },
    ], tags: ['Schedule', 'Team'],
  },
  {
    id: 'file-processor', name: 'File drop processor',
    description: 'When a file is added to a folder, summarise or extract its contents.',
    trigger_type: 'file_watch', trigger_config: { folder: '' },
    steps: [
      { action: 'summarise', prompt: 'Summarise the key information from this document in 3-5 bullet points.', output: 'file' },
    ], tags: ['Files', 'AI'],
  },
  {
    id: 'linkedin-weekly-post', name: 'Weekly LinkedIn post',
    description: 'Every Monday, AI drafts and publishes a thought leadership post to LinkedIn.',
    trigger_type: 'schedule', trigger_config: { cron: '0 9 * * 1' },
    steps: [
      { action: 'report', prompt: 'Write a professional thought leadership post for LinkedIn. 3–4 short paragraphs with a key insight, a personal reflection, and a question for the audience. Include 3–5 relevant hashtags at the end. Write in first person, natural voice — no AI disclosure.', output: 'linkedin_post', output_config: { linkedin_visibility: 'PUBLIC' } },
    ], tags: ['Schedule', 'Social'],
  },
  {
    id: 'tweet-email-insight', name: 'Email insight → X tweet',
    description: 'When a key email arrives, extract the insight and tweet it automatically.',
    trigger_type: 'email', trigger_config: { email_filter: 'subject:report OR subject:update OR subject:insight' },
    steps: [
      { action: 'extract', prompt: 'Extract the single most interesting insight from this email in one sharp sentence. Be specific and concrete.', output: 'notification' },
      { action: 'reply', prompt: 'Rewrite the insight as a tweet (max 240 chars). Make it direct and engaging. Add 2–3 hashtags. Write in first person — no disclaimers, no "AI wrote this".', output: 'twitter_post' },
    ], tags: ['Email', 'Social'],
  },
  {
    id: 'mention-auto-reply', name: 'X mention auto-reply',
    description: 'Periodically check X mentions and draft personalised replies.',
    trigger_type: 'schedule', trigger_config: { cron: '0 */4 * * *', weekdays_only: true },
    steps: [
      { action: 'classify', prompt: 'Read these X mentions. Identify the top 1–2 that deserve a reply (questions, genuine feedback, partner accounts). Output: tweet ID + reason.', output: 'notification' },
      { action: 'reply', prompt: 'Write a warm, concise reply (max 230 chars) to the most important mention. Sound like the user, not a bot. No AI disclosure.', output: 'twitter_reply' },
    ], tags: ['Social', 'Support'],
  },
  {
    id: 'founder-outreach-pipeline', name: 'Founder/CEO outreach pipeline',
    description: 'When someone @mentions you on X, research them, check your Notion CRM for conversation history, then reply with the right tone — build the relationship first (convos 1–3), pitch later (convo 4+). Logs everything back to Notion.',
    trigger_type: 'twitter_mention',
    trigger_config: {
      twitter_filter: 'founder OR CEO OR startup OR building',
      notion_crm_db: '',
      pitch_file_path: '',
      weekdays_only: true,
    },
    steps: [
      {
        action: 'extract',
        prompt: 'Extract from the X mention content: (1) Person name or handle (2) Their company/role if mentioned (3) What they said or asked (4) Any pain point or interest they expressed. Return as: Name: ... | Handle: @... | Company/Role: ... | Context: ...',
        output: 'notification',
      },
      {
        action: 'classify',
        prompt: 'You have the person\'s details and the CRM data (if any). Determine: (A) Is this person a founder, CEO, or executive? (B) How many times have we interacted? Check CRM records — count entries for this person\'s name or handle. (C) Set the engagement mode: RELATIONSHIP if interaction count is 0–2, PITCH if 3 or more. Output: Mode = [RELATIONSHIP/PITCH] | Interaction count: N | Company: ... | Why: one-line reasoning',
        output: 'notification',
      },
      {
        action: 'reply',
        prompt: 'Write a tweet reply (max 220 chars). Use the mode from the previous step and the product context (if provided). RELATIONSHIP mode: Be warm and genuinely curious. Ask ONE thoughtful question about their work, challenge, or what they\'re building. NO product mention. Sound like a peer founder, not a salesperson. PITCH mode: Reference our past chats briefly. In one line, connect their specific challenge to how our product solves it (use product context). Invite them to a quick 15-min call or DM. Keep it conversational — not a pitch. Sign with first name only. Zero AI disclosure.',
        output: 'twitter_reply',
      },
      {
        action: 'report',
        prompt: 'Create a Notion CRM log entry for this interaction. Format as: Person: [name] | Handle: [@handle] | Company: [company] | Stage: [RELATIONSHIP/PITCH] | Interaction #: [N+1] | Date: [today] | Summary: [one sentence about what was discussed] | Next action: [what to do next time]',
        output: 'notion',
        output_config: { notion_db_url: '' },
      },
    ],
    tags: ['Social', 'Sales'],
  },
  {
    id: 'linkedin-thought-leader', name: 'LinkedIn thought leadership autopilot',
    description: 'Every weekday morning, AI reads your product pitch file and generates a compelling thought leadership post — published directly to LinkedIn.',
    trigger_type: 'schedule',
    trigger_config: { cron: '0 9 * * 1-5', pitch_file_path: '', weekdays_only: true },
    steps: [
      {
        action: 'report',
        prompt: 'Write a LinkedIn thought leadership post for a tech founder. Use the product context (if provided) for accurate details. Pick one angle (rotate based on today\'s date mod 4): 0 = hot AI industry trend + your take; 1 = a founder lesson learned; 2 = a real user story showing impact; 3 = behind-the-scenes product insight. Format: 3–4 short paragraphs, end with a question to drive comments. Add 3–5 hashtags at the end. Write in first person. Sound like a real founder. Zero AI disclosure, no generic sign-offs.',
        output: 'linkedin_post',
        output_config: { linkedin_visibility: 'PUBLIC' },
      },
    ],
    tags: ['Schedule', 'Social'],
  },
  {
    id: 'rss-to-discord', name: 'RSS → Discord digest',
    description: 'Watch an RSS feed and post a summary of new articles to your Discord channel.',
    trigger_type: 'rss',
    trigger_config: { cron: '0 8 * * *', rss_url: '' },
    steps: [
      { action: 'summarise', prompt: 'Summarise this article in 2-3 sentences. Include the key insight and a link if available. Write in a clear, direct style.', output: 'discord', output_config: { discord_webhook: '' } },
    ],
    tags: ['RSS', 'Discord'],
  },
  {
    id: 'github-pr-summary', name: 'GitHub PR → Slack summary',
    description: 'When a new PR is opened, summarise it and post to Slack for the team.',
    trigger_type: 'github',
    trigger_config: { github_repo: '', github_event: 'pull_request' },
    steps: [
      { action: 'summarise', prompt: 'Summarise this GitHub PR in 3 bullet points: what it changes, why, and any risks. Keep it under 200 words.', output: 'slack', output_config: { slack_channel: 'dev' } },
    ],
    tags: ['GitHub', 'Slack', 'Team'],
  },
  {
    id: 'stripe-payment-sms', name: 'Stripe payment → SMS alert',
    description: 'Get an SMS notification when a Stripe payment is received.',
    trigger_type: 'stripe',
    trigger_config: { stripe_event: 'payment_intent.succeeded' },
    steps: [
      { action: 'extract', prompt: 'Extract: amount, currency, customer email or ID, payment ID. Format as a short one-line summary.', output: 'twilio_sms', output_config: { sms_to: '' } },
    ],
    tags: ['Stripe', 'SMS', 'Finance'],
  },
  {
    id: 'calendar-meeting-prep', name: 'Calendar event → meeting prep',
    description: 'Before a meeting, AI drafts a brief agenda and talking points and sends to your email.',
    trigger_type: 'google_calendar',
    trigger_config: { calendar_id: 'primary', lookahead_mins: 30 },
    steps: [
      { action: 'report', prompt: 'Based on the meeting title and description, draft: (1) a 3-point agenda, (2) 2-3 talking points, (3) any prep needed. Keep it short and actionable.', output: 'email_reply', output_config: { email_to: '' } },
    ],
    tags: ['Calendar', 'Email', 'Productivity'],
  },
  {
    id: 'new-connection-welcome', name: 'Daily outreach research digest',
    description: 'Every morning, research your target audience (founders in your niche) and generate personalised outreach messages using your product pitch file.',
    trigger_type: 'schedule',
    trigger_config: { cron: '0 8 * * 1-5', pitch_file_path: '', notion_crm_db: '' },
    steps: [
      {
        action: 'report',
        prompt: 'Using the CRM data and product context provided, identify the 2–3 people in the CRM who are most ready to hear a product pitch (stage = RELATIONSHIP with 3+ interactions OR marked as warm lead). For each person, write a personalised outreach message: Reference something specific about their work, connect it to the product value prop, suggest a 15-min call. Format each message as: --- Person: [name] | Platform: X or LinkedIn | Message: [the message, under 200 chars for X / 500 for LinkedIn] ---',
        output: 'file',
        output_config: { file_path: '', file_format: 'md', file_append: true },
      },
    ],
    tags: ['Schedule', 'Sales'],
  },
];

// ─── Schedule Picker ─────────────────────────────────────────────────────────

const FREQ_OPTIONS: { value: FreqType; label: string }[] = [
  { value: 'hourly',   label: 'Hourly'    },
  { value: 'daily',    label: 'Daily'     },
  { value: 'weekdays', label: 'Weekdays'  },
  { value: 'weekly',   label: 'Weekly'    },
  { value: 'monthly',  label: 'Monthly'   },
  { value: 'custom',   label: 'Advanced'  },
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const selectCls = 'px-2 py-1.5 rounded-lg bg-nv-surface border border-nv-border text-nv-text text-xs font-mono focus:outline-none focus:border-accent transition-fast';

function SchedulePicker({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const init = parseCron(value || '0 9 * * *');
  const [freq, setFreqS] = useState<FreqType>(init.freq);
  const [hour, setHourS] = useState(init.hour);
  const [minute, setMinuteS] = useState(init.minute);
  const [weekday, setWeekdayS] = useState(init.weekday);
  const [monthDay, setMonthDayS] = useState(init.monthDay);
  const [customCron, setCustomCronS] = useState(init.freq === 'custom' ? value : '0 9 * * *');

  function emit(ov: Partial<{ freq: FreqType; hour: number; minute: number; weekday: number; monthDay: number; customCron: string }> = {}) {
    const s = { freq, hour, minute, weekday, monthDay, customCron, ...ov };
    onChange(s.freq === 'custom' ? s.customCron : scheduleToCron(s));
  }
  function setFreq(f: FreqType)   { setFreqS(f);    emit({ freq: f }); }
  function setHour(h: number)     { setHourS(h);    emit({ hour: h }); }
  function setMinute(m: number)   { setMinuteS(m);  emit({ minute: m }); }
  function setWeekday(d: number)  { setWeekdayS(d); emit({ weekday: d }); }
  function setMonthDay(d: number) { setMonthDayS(d); emit({ monthDay: d }); }
  function setCustom(c: string)   { setCustomCronS(c); emit({ customCron: c }); }

  const displayCron = freq === 'custom' ? customCron : scheduleToCron({ freq, hour, minute, weekday, monthDay, customCron });

  return (
    <div className="space-y-3">
      {/* Frequency chips */}
      <div className="flex gap-1.5 flex-wrap">
        {FREQ_OPTIONS.map(opt => (
          <button key={opt.value} type="button" onClick={() => setFreq(opt.value)}
            className={`px-3 py-1 rounded-full text-xs font-mono transition-fast ${freq === opt.value ? 'bg-accent text-white' : 'bg-nv-surface border border-nv-border text-nv-muted hover:text-nv-text'}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {/* Time picker */}
      {freq !== 'hourly' && freq !== 'custom' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-nv-muted w-8">at</span>
          <select value={hour} onChange={e => setHour(+e.target.value)} className={selectCls}>
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
            ))}
          </select>
          <select value={minute} onChange={e => setMinute(+e.target.value)} className={selectCls}>
            {[0, 15, 30, 45].map(m => (
              <option key={m} value={m}>:{m.toString().padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly — day of week */}
      {freq === 'weekly' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-nv-muted w-8">on</span>
          <select value={weekday} onChange={e => setWeekday(+e.target.value)} className={selectCls}>
            {WEEKDAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
      )}

      {/* Monthly — day of month */}
      {freq === 'monthly' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-nv-muted w-8">on the</span>
          <select value={monthDay} onChange={e => setMonthDay(+e.target.value)} className={selectCls}>
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}{nth(i + 1)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Advanced cron */}
      {freq === 'custom' && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-nv-yellow font-mono">For developers only — use the options above if you're unsure.</p>
          <input value={customCron} onChange={e => setCustom(e.target.value)} placeholder="0 9 * * 1"
            className="w-full px-3 py-2 rounded-lg bg-nv-surface border border-nv-border text-nv-text text-xs font-mono placeholder:text-nv-faint focus:outline-none focus:border-accent transition-fast" />
          <p className="text-[10px] text-nv-muted font-mono">minute · hour · day-of-month · month · day-of-week</p>
        </div>
      )}

      {/* Human-readable summary */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/5 border border-accent/20">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-accent/60 shrink-0">
          <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a.75.75 0 01.75.75v3.5l2.25 1.35a.75.75 0 01-.75 1.3L7.25 11.5A.75.75 0 017 10.85V7.25A.75.75 0 018 5z"/>
        </svg>
        <p className="text-[11px] text-nv-text font-mono">{cronToHuman(displayCron)}</p>
      </div>
    </div>
  );
}

// ─── Workflow Builder constants ───────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { type: 'schedule'        as TriggerType, icon: '⏰', label: 'Schedule',        desc: 'Run at a set time — daily, weekly, hourly' },
  { type: 'file_watch'      as TriggerType, icon: '📁', label: 'File added',      desc: 'New file lands in a folder you choose' },
  { type: 'email'           as TriggerType, icon: '✉',  label: 'Email received',  desc: 'Incoming email matches your filters' },
  { type: 'webhook'         as TriggerType, icon: '🔗', label: 'Webhook',         desc: 'Another app sends a signal to Nivara' },
  { type: 'twitter_mention' as TriggerType, icon: '𝕏',  label: 'X mention',       desc: 'Someone @mentions you on X (Twitter)' },
  { type: 'rss'             as TriggerType, icon: '📡', label: 'RSS Feed',        desc: 'New article published on a website' },
  { type: 'github'          as TriggerType, icon: '⚙',  label: 'GitHub',          desc: 'New PR, issue, or push in a repo' },
  { type: 'stripe'          as TriggerType, icon: '💳', label: 'Stripe payment',  desc: 'Payment received or subscription event' },
  { type: 'google_calendar' as TriggerType, icon: '📅', label: 'Google Calendar', desc: 'Event starting soon on your calendar' },
];

const ACTION_OPTIONS = [
  { action: 'summarise' as ActionType, icon: '📝', label: 'Summarise',      desc: 'Turn content into bullet points',    ph: 'e.g. Summarise the key points in 3–5 bullets. Focus on decisions made and action items.' },
  { action: 'reply'     as ActionType, icon: '↩',  label: 'Draft reply',    desc: 'Write a response to a message',      ph: 'e.g. Write a warm, professional reply. Acknowledge their request and give a realistic timeline. Under 150 words.' },
  { action: 'extract'   as ActionType, icon: '🔍', label: 'Extract data',   desc: 'Pull out specific info',             ph: 'e.g. Extract: sender name, company, invoice amount, due date. Return as a simple list.' },
  { action: 'classify'  as ActionType, icon: '🏷',  label: 'Classify',      desc: 'Sort into categories or priority',   ph: 'e.g. Classify as: billing / technical / feature request / complaint. Add urgency: low / medium / high.' },
  { action: 'report'    as ActionType, icon: '📊', label: 'Generate report', desc: 'Create a structured document',       ph: 'e.g. Write a weekly report: Summary, Key metrics, Blockers, Next steps.' },
  { action: 'translate' as ActionType, icon: '🌐', label: 'Translate',      desc: 'Convert to another language',        ph: 'e.g. Translate to Spanish. Keep the tone professional and formal.' },
];

const OUTPUT_OPTIONS = [
  { type: 'notification'  as OutputType, icon: '🔔', label: 'Desktop alert',  desc: 'Pop-up on your screen' },
  { type: 'file'          as OutputType, icon: '💾', label: 'Save to file',   desc: 'Write result to a file' },
  { type: 'email_reply'   as OutputType, icon: '✉',  label: 'Send email',     desc: 'Reply or send to an address' },
  { type: 'notion'        as OutputType, icon: 'N',  label: 'Notion page',    desc: 'Create a page in Notion' },
  { type: 'slack'         as OutputType, icon: '#',  label: 'Slack message',  desc: 'Post to a channel' },
  { type: 'twitter_post'  as OutputType, icon: '𝕏',  label: 'X post',         desc: 'Tweet from your X account' },
  { type: 'twitter_reply' as OutputType, icon: '𝕏↩', label: 'X reply',        desc: 'Reply to a specific tweet' },
  { type: 'linkedin_post' as OutputType, icon: 'in', label: 'LinkedIn post',  desc: 'Publish to LinkedIn' },
  { type: 'reddit_post'   as OutputType, icon: '👽', label: 'Reddit post',    desc: 'Submit a text post to a subreddit' },
  { type: 'discord'       as OutputType, icon: '💬', label: 'Discord',        desc: 'Post to a Discord channel' },
  { type: 'google_sheets' as OutputType, icon: '📊', label: 'Google Sheets',  desc: 'Append a row to a spreadsheet' },
  { type: 'twilio_sms'    as OutputType, icon: '📱', label: 'SMS (Twilio)',    desc: 'Send an SMS message' },
  { type: 'telegram'      as OutputType, icon: '✈',  label: 'Telegram',       desc: 'Send a Telegram bot message' },
  { type: 'hubspot'       as OutputType, icon: '🏷',  label: 'HubSpot CRM',    desc: 'Create or update a contact' },
];

const CONDITIONS = [
  { key: 'weekdays_only' as const, label: 'Only on weekdays (Mon–Fri)',     desc: 'Skip Saturday and Sunday' },
  { key: 'business_hours' as const, label: 'Only between 8am and 8pm',     desc: 'Skip runs outside business hours' },
  { key: 'dedupe_daily' as const, label: 'Skip if already ran today',      desc: 'Run at most once per day' },
];

const iCls = (err: boolean) =>
  `w-full px-3 py-2 rounded-lg bg-nv-surface border text-nv-text text-sm placeholder:text-nv-faint focus:outline-none transition-fast ${err ? 'border-nv-red/60 focus:border-nv-red' : 'border-nv-border focus:border-accent'}`;
const lCls = 'text-xs font-medium text-nv-muted uppercase tracking-wider';

function RequiredBadge() {
  return <span className="ml-1.5 text-[9px] font-bold text-nv-red bg-nv-red/10 px-1.5 py-0.5 rounded font-mono">! required</span>;
}

// ─── Workflow Builder (modal) ─────────────────────────────────────────────────

function WorkflowBuilder({
  initial, onSave, onCancel,
}: {
  initial?: Automation;
  onSave: (name: string, tt: TriggerType, tc: TriggerConfig, steps: Step[]) => void;
  onCancel: () => void;
}) {
  const [step, setStep]           = useState(0);
  const [showErr, setShowErr]     = useState(false);
  const [name, setName]           = useState(initial?.name ?? '');
  const dragOver                  = useRef<number | null>(null);

  const initCfg: TriggerConfig = initial ? JSON.parse(initial.trigger_config) : { cron: '0 9 * * *' };
  const [triggerType, setTriggerType]     = useState<TriggerType>(initial?.trigger_type ?? 'schedule');
  const [triggerConfig, setTriggerConfig] = useState<TriggerConfig>(initCfg);
  const [aiSteps, setAiSteps] = useState<Step[]>(
    initial ? JSON.parse(initial.steps) : [{ id: uuid(), action: 'summarise', prompt: '', output: 'notification', output_config: {} }]
  );

  const patchTC = (p: Partial<TriggerConfig>) => setTriggerConfig(c => ({ ...c, ...p }));

  function changeTriggerType(t: TriggerType) {
    setTriggerType(t);
    setTriggerConfig(t === 'schedule' ? { cron: '0 9 * * *' } : {});
    setShowErr(false);
  }

  function addStep()                     { setAiSteps(s => [...s, { id: uuid(), action: 'summarise', prompt: '', output: 'notification', output_config: {} }]); }
  function removeStep(id: string)        { setAiSteps(s => s.filter(x => x.id !== id)); }
  function updateStep(id: string, p: Partial<Step>) { setAiSteps(s => s.map(x => x.id === id ? { ...x, ...p } : x)); }
  function patchOC(id: string, p: Partial<OutputConfig>) {
    setAiSteps(s => s.map(x => x.id === id ? { ...x, output_config: { ...x.output_config, ...p } } : x));
  }

  function errsFor(s: number): string[] {
    if (s === 0) {
      const e: string[] = [];
      if (!name.trim()) e.push('name');
      if (triggerType === 'file_watch' && !triggerConfig.folder?.trim()) e.push('folder');
      if (triggerType === 'webhook' && !triggerConfig.webhook_path?.trim()) e.push('webhook_path');
      return e;
    }
    if (s === 2) return aiSteps.flatMap((st, i) => st.prompt.trim() ? [] : [`step_${i}_prompt`]);
    if (s === 3) {
      const e: string[] = [];
      aiSteps.forEach((st, i) => {
        if (st.output === 'file'   && !st.output_config?.file_path?.trim())    e.push(`step_${i}_file`);
        if (st.output === 'notion' && !st.output_config?.notion_db_url?.trim()) e.push(`step_${i}_notion`);
        if (st.output === 'slack'  && !st.output_config?.slack_channel?.trim()) e.push(`step_${i}_slack`);
      });
      return e;
    }
    return [];
  }

  function tryAdvance() {
    const errs = errsFor(step);
    if (errs.length) { setShowErr(true); return; }
    setShowErr(false);
    setStep(s => s + 1);
  }

  const STEPS = ['Trigger', 'Conditions', 'Actions', 'Output'];
  const stepHasErr = STEPS.map((_, i) => errsFor(i).length > 0);
  const e0 = showErr ? errsFor(0) : [];
  const e2 = showErr ? errsFor(2) : [];
  const e3 = showErr ? errsFor(3) : [];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-nv-bg border border-nv-border rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nv-border shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-nv-text">{initial ? 'Edit automation' : 'New automation'}</h2>
            <p className="text-xs text-nv-muted font-mono mt-0.5">Step {step + 1} of {STEPS.length} — {STEPS[step]}</p>
          </div>
          <button onClick={onCancel} className="text-nv-muted hover:text-nv-text transition-fast">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4"><path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Progress + step labels */}
        <div className="flex items-start gap-0 px-5 pt-3 pb-2 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 flex flex-col items-center gap-1 cursor-pointer" onClick={() => i < step && setStep(i)}>
              <div className={`h-0.5 w-full rounded-full transition-fast ${i <= step ? 'bg-accent' : 'bg-nv-border'}`} />
              <div className="flex items-center gap-0.5">
                <span className={`text-[9px] font-mono ${i === step ? 'text-accent' : i < step ? 'text-nv-muted' : 'text-nv-faint'}`}>{s}</span>
                {stepHasErr[i] && i !== step && <span className="text-nv-red text-[10px] font-bold leading-none">!</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ══ Step 0 — Trigger ══════════════════════════════════════════ */}
          {step === 0 && <>
            <div className="space-y-1.5">
              <div className="flex items-center">
                <label className={lCls}>Automation name</label>
                {e0.includes('name') && <RequiredBadge />}
              </div>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Invoice tracker, Weekly digest, Lead reply…"
                className={iCls(e0.includes('name'))} />
            </div>

            <div className="space-y-2">
              <label className={lCls}>When should this run?</label>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_OPTIONS.map(opt => (
                  <button key={opt.type} type="button" onClick={() => changeTriggerType(opt.type)}
                    className={`p-3 rounded-xl border text-left transition-fast ${triggerType === opt.type ? 'border-accent bg-accent/10' : 'border-nv-border bg-nv-surface hover:border-accent/40'}`}>
                    <span className="text-lg mb-1 block">{opt.icon}</span>
                    <span className={`text-xs font-semibold block ${triggerType === opt.type ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</span>
                    <span className="text-[10px] text-nv-muted leading-tight block mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {triggerType === 'schedule' && (
              <div className="space-y-1.5">
                <label className={lCls}>Schedule</label>
                <SchedulePicker value={triggerConfig.cron ?? '0 9 * * *'} onChange={cron => patchTC({ cron })} />
              </div>
            )}

            {triggerType === 'file_watch' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center">
                    <label className={lCls}>Which folder to watch?</label>
                    {e0.includes('folder') && <RequiredBadge />}
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nv-muted text-sm">📁</span>
                    <input value={triggerConfig.folder ?? ''} onChange={e => patchTC({ folder: e.target.value })}
                      placeholder="C:\Users\you\Downloads"
                      className={`${iCls(e0.includes('folder'))} pl-8 font-mono`} />
                  </div>
                  <p className="text-[10px] text-nv-muted">Paste the full path to a folder on your computer. Nivara watches for new files here.</p>
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>File types to watch</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: 'All files', val: '*' },
                      { label: 'PDF', val: 'pdf' },
                      { label: 'Word (.docx)', val: 'docx' },
                      { label: 'Images', val: 'images' },
                      { label: 'CSV', val: 'csv' },
                      { label: 'Text (.txt)', val: 'txt' },
                    ].map(ft => {
                      const active = (triggerConfig.file_types ?? '*').split(',').includes(ft.val);
                      return (
                        <button key={ft.val} type="button" onClick={() => {
                          if (ft.val === '*') { patchTC({ file_types: '*' }); return; }
                          const curr = (triggerConfig.file_types ?? '*').split(',').filter(v => v && v !== '*');
                          const next = active ? curr.filter(v => v !== ft.val) : [...curr, ft.val];
                          patchTC({ file_types: next.length ? next.join(',') : '*' });
                        }}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-mono border transition-fast ${active ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-nv-surface border-nv-border text-nv-muted hover:text-nv-text'}`}>
                          {ft.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {triggerType === 'email' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-nv-surface border border-nv-border">
                  <span className="text-base mt-0.5">✉</span>
                  <p className="text-[11px] text-nv-muted leading-relaxed">Watches your Gmail inbox. Leave both filters blank to process all incoming emails. <span className="text-nv-faint">(Connect Gmail in Connect Apps)</span></p>
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Only from this email address <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                  <input value={triggerConfig.email_from ?? ''} onChange={e => patchTC({ email_from: e.target.value })}
                    type="email" placeholder="client@company.com"
                    className={iCls(false)} />
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Subject line contains <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                  <input value={triggerConfig.email_subject ?? ''} onChange={e => patchTC({ email_subject: e.target.value })}
                    placeholder="e.g. invoice, payment due, urgent"
                    className={iCls(false)} />
                  <p className="text-[10px] text-nv-muted">Separate multiple keywords with commas. Triggers on any match.</p>
                </div>
              </div>
            )}

            {triggerType === 'webhook' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center">
                    <label className={lCls}>Webhook path</label>
                    {e0.includes('webhook_path') && <RequiredBadge />}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border bg-nv-surface overflow-hidden border-nv-border">
                    <span className="text-[10px] text-nv-faint font-mono px-3 py-2 bg-nv-bg border-r border-nv-border shrink-0 whitespace-nowrap">localhost:3141</span>
                    <input value={triggerConfig.webhook_path ?? ''} onChange={e => patchTC({ webhook_path: e.target.value.startsWith('/') ? e.target.value : '/' + e.target.value })}
                      placeholder="/my-flow"
                      className="flex-1 px-3 py-2 bg-transparent text-nv-text text-sm font-mono placeholder:text-nv-faint focus:outline-none" />
                  </div>
                  <p className="text-[10px] text-nv-muted">Call this URL from Zapier, Make, or any HTTP client to trigger this automation.</p>
                </div>
              </div>
            )}

            {triggerType === 'twitter_mention' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-nv-surface border border-nv-border">
                  <span className="text-base mt-0.5">𝕏</span>
                  <p className="text-[11px] text-nv-muted leading-relaxed">Polls your X @mentions each time this automation runs. Connect X in Connect Apps first.</p>
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Filter by keyword <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                  <input value={triggerConfig.twitter_filter ?? ''} onChange={e => patchTC({ twitter_filter: e.target.value })}
                    placeholder="e.g. AI, automation, product launch"
                    className={iCls(false)} />
                  <p className="text-[10px] text-nv-muted">Only process mentions containing this keyword. Leave blank to process all mentions.</p>
                </div>
              </div>
            )}

            {triggerType === 'rss' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={lCls}>RSS / Atom feed URL</label>
                  <input value={triggerConfig.rss_url ?? ''} onChange={e => patchTC({ rss_url: e.target.value })}
                    placeholder="https://example.com/feed.xml"
                    className={iCls(false)} />
                  <p className="text-[10px] text-nv-muted">Checks the feed each run and processes the latest article(s) not yet seen.</p>
                </div>
              </div>
            )}

            {triggerType === 'github' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={lCls}>Repository (owner/repo)</label>
                  <input value={triggerConfig.github_repo ?? ''} onChange={e => patchTC({ github_repo: e.target.value })}
                    placeholder="octocat/hello-world" className={`${iCls(false)} font-mono`} />
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Event type</label>
                  <select value={triggerConfig.github_event ?? 'pull_request'} onChange={e => patchTC({ github_event: e.target.value })} className={iCls(false)}>
                    <option value="pull_request">Pull request opened</option>
                    <option value="issue">Issue created</option>
                    <option value="push">Push to default branch</option>
                    <option value="release">New release published</option>
                  </select>
                  <p className="text-[10px] text-nv-muted">Connect GitHub in Connect Apps.</p>
                </div>
              </div>
            )}

            {triggerType === 'stripe' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={lCls}>Event type</label>
                  <select value={triggerConfig.stripe_event ?? 'payment_intent.succeeded'} onChange={e => patchTC({ stripe_event: e.target.value })} className={iCls(false)}>
                    <option value="payment_intent.succeeded">Payment succeeded</option>
                    <option value="customer.subscription.created">Subscription created</option>
                    <option value="invoice.payment_failed">Payment failed</option>
                    <option value="checkout.session.completed">Checkout completed</option>
                  </select>
                  <p className="text-[10px] text-nv-muted">Connect Stripe in Connect Apps.</p>
                </div>
              </div>
            )}

            {triggerType === 'google_calendar' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className={lCls}>Calendar ID <span className="normal-case font-normal text-nv-faint">(optional, default: primary)</span></label>
                  <input value={triggerConfig.calendar_id ?? ''} onChange={e => patchTC({ calendar_id: e.target.value })}
                    placeholder="primary" className={iCls(false)} />
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Look-ahead window (minutes)</label>
                  <input type="number" value={triggerConfig.lookahead_mins ?? 30} onChange={e => patchTC({ lookahead_mins: parseInt(e.target.value) || 30 })}
                    placeholder="30" className={iCls(false)} />
                  <p className="text-[10px] text-nv-muted">Fires when an event starts within this many minutes. Connect Google Calendar in Connect Apps.</p>
                </div>
              </div>
            )}

            {/* ── Advanced context (for all trigger types) ─────────────────── */}
            <details className="group">
              <summary className="flex items-center gap-2 cursor-pointer text-[10px] font-mono text-nv-muted uppercase tracking-widest select-none list-none py-1">
                <svg viewBox="0 0 10 10" fill="currentColor" className="w-2 h-2 group-open:rotate-90 transition-fast text-nv-faint"><path d="M3 1l4 4-4 4"/></svg>
                Advanced context
              </summary>
              <div className="pt-3 space-y-3">
                <div className="space-y-1.5">
                  <label className={lCls}>Pitch / product file <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                  <input value={triggerConfig.pitch_file_path ?? ''} onChange={e => patchTC({ pitch_file_path: e.target.value })}
                    placeholder="C:\Users\you\PRODUCT-DETAILS.MD"
                    className={`${iCls(false)} font-mono`} />
                  <p className="text-[10px] text-nv-muted">File is read at run time and injected into every AI step as product context. Great for outreach and pitch automations.</p>
                </div>
                <div className="space-y-1.5">
                  <label className={lCls}>Notion CRM database <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                  <input value={triggerConfig.notion_crm_db ?? ''} onChange={e => patchTC({ notion_crm_db: e.target.value })}
                    placeholder="https://notion.so/your-crm-database-id"
                    className={iCls(false)} />
                  <p className="text-[10px] text-nv-muted">Your contact/CRM database in Notion. Records are fetched before each run so AI steps know your conversation history with each person.</p>
                </div>
              </div>
            </details>
          </>}

          {/* ══ Step 1 — Conditions ═══════════════════════════════════════ */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-nv-muted">Optional filters — the automation only fires when all checked conditions are true. Skip this step to always run.</p>
              {CONDITIONS.map(cond => {
                const active = !!triggerConfig[cond.key];
                return (
                  <button key={cond.key} type="button"
                    onClick={() => patchTC({ [cond.key]: !active } as Partial<TriggerConfig>)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-fast ${active ? 'border-accent/50 bg-accent/5' : 'border-nv-border bg-nv-surface hover:border-accent/20'}`}>
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-fast ${active ? 'border-accent bg-accent' : 'border-nv-border'}`}>
                      {active && <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5"><path d="M1.5 5l2.5 2.5 4.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${active ? 'text-nv-text' : 'text-nv-muted'}`}>{cond.label}</p>
                      <p className="text-[10px] text-nv-faint mt-0.5">{cond.desc}</p>
                    </div>
                  </button>
                );
              })}
              <p className="text-[10px] text-nv-faint font-mono text-center pt-1">More condition types — coming soon</p>
            </div>
          )}

          {/* ══ Step 2 — AI Actions ═══════════════════════════════════════ */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-nv-muted">What should the AI do? Add multiple steps — each one runs in order.</p>
              {aiSteps.map((s, i) => {
                const aOpt = ACTION_OPTIONS.find(a => a.action === s.action);
                const promptErr = e2.includes(`step_${i}_prompt`);
                return (
                  <div key={s.id} draggable
                    onDragStart={() => { dragOver.current = i; }}
                    onDragEnter={() => {
                      if (dragOver.current === null || dragOver.current === i) return;
                      setAiSteps(prev => {
                        const next = [...prev];
                        const [moved] = next.splice(dragOver.current!, 1);
                        next.splice(i, 0, moved);
                        dragOver.current = i;
                        return next;
                      });
                    }}
                    onDragEnd={() => { dragOver.current = null; }}
                    className="rounded-xl border border-nv-border bg-nv-surface p-4 space-y-3 cursor-grab active:cursor-grabbing">

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 12 16" fill="currentColor" className="w-2.5 h-3 text-nv-faint shrink-0">
                          <circle cx="3" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/>
                          <circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/>
                          <circle cx="3" cy="13" r="1.2"/><circle cx="9" cy="13" r="1.2"/>
                        </svg>
                        <span className="text-xs font-mono text-nv-muted">Step {i + 1}</span>
                      </div>
                      {aiSteps.length > 1 && (
                        <button onClick={() => removeStep(s.id)} className="text-nv-faint hover:text-nv-red transition-fast text-[10px] font-mono">remove</button>
                      )}
                    </div>

                    {/* Action type grid */}
                    <div>
                      <label className={`${lCls} mb-2 block`}>What should the AI do?</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {ACTION_OPTIONS.map(opt => (
                          <button key={opt.action} type="button" onClick={() => updateStep(s.id, { action: opt.action })}
                            className={`p-2.5 rounded-lg border text-left transition-fast ${s.action === opt.action ? 'border-accent bg-accent/10' : 'border-nv-border bg-nv-bg hover:border-accent/30'}`}>
                            <span className="text-base block mb-1">{opt.icon}</span>
                            <span className={`text-[10px] font-semibold block leading-tight ${s.action === opt.action ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</span>
                            <span className="text-[9px] text-nv-faint block mt-0.5 leading-tight">{opt.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Prompt */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <label className={lCls}>Instructions for the AI</label>
                          {promptErr && <RequiredBadge />}
                        </div>
                        <span className="text-[9px] text-nv-faint font-mono">{s.prompt.length} chars</span>
                      </div>
                      <textarea value={s.prompt} onChange={e => updateStep(s.id, { prompt: e.target.value })} rows={3}
                        placeholder={aOpt?.ph ?? 'Tell the AI exactly what to do…'}
                        className={`w-full px-3 py-2 rounded-lg bg-nv-bg border text-nv-text text-sm placeholder:text-nv-faint focus:outline-none transition-fast resize-none ${promptErr ? 'border-nv-red/60 focus:border-nv-red' : 'border-nv-border focus:border-accent'}`} />
                    </div>
                  </div>
                );
              })}
              <button onClick={addStep}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-nv-border text-nv-faint hover:text-nv-muted hover:border-accent/40 transition-fast text-xs font-mono">
                + Add another step
              </button>
            </div>
          )}

          {/* ══ Step 3 — Output ═══════════════════════════════════════════ */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-nv-muted">For each AI step, choose where the result should go — then fill in the details.</p>
              {aiSteps.map((s, i) => {
                const aOpt = ACTION_OPTIONS.find(a => a.action === s.action);
                return (
                  <div key={s.id} className="rounded-xl border border-nv-border bg-nv-surface p-4 space-y-3">
                    <div>
                      <p className="text-[10px] font-mono text-nv-muted">Step {i + 1} — {aOpt?.icon} {aOpt?.label} result goes to…</p>
                    </div>

                    {/* Output type cards */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {OUTPUT_OPTIONS.map(opt => (
                        <button key={opt.type} type="button"
                          onClick={() => updateStep(s.id, { output: opt.type, output_config: {} })}
                          className={`p-2 rounded-lg border text-center transition-fast ${s.output === opt.type ? 'border-accent bg-accent/10' : 'border-nv-border bg-nv-bg hover:border-accent/30'}`}>
                          <span className="text-base block mb-0.5">{opt.icon}</span>
                          <span className={`text-[9px] font-semibold leading-tight block ${s.output === opt.type ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Desktop alert */}
                    {s.output === 'notification' && (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <label className={lCls}>Notification title <span className="normal-case font-normal text-nv-faint">(optional)</span></label>
                          <input value={s.output_config?.notif_title ?? ''} onChange={e => patchOC(s.id, { notif_title: e.target.value })}
                            placeholder="e.g. New invoice received" className={iCls(false)} />
                        </div>
                        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-nv-bg border border-nv-border">
                          <span className="text-xl shrink-0">🔔</span>
                          <div>
                            <p className="text-xs font-medium text-nv-text">{s.output_config?.notif_title || 'Automation result'}</p>
                            <p className="text-[10px] text-nv-muted">AI result will appear here as the notification body</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Save to file */}
                    {s.output === 'file' && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center">
                            <label className={lCls}>Save to this file path</label>
                            {e3.includes(`step_${i}_file`) && <RequiredBadge />}
                          </div>
                          <input value={s.output_config?.file_path ?? ''} onChange={e => patchOC(s.id, { file_path: e.target.value })}
                            placeholder="C:\Users\you\Documents\output.md"
                            className={`${iCls(e3.includes(`step_${i}_file`))} font-mono`} />
                          <p className="text-[10px] text-nv-muted">Full path including filename. Nivara creates the file if it doesn't exist.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className={lCls}>File format</label>
                            <select value={s.output_config?.file_format ?? 'md'} onChange={e => patchOC(s.id, { file_format: e.target.value })}
                              className={iCls(false)}>
                              {[['md','Markdown (.md)'],['txt','Plain text (.txt)'],['json','JSON (.json)'],['csv','CSV (.csv)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          <div className="space-y-1.5">
                            <label className={lCls}>If file exists</label>
                            <select value={s.output_config?.file_append ? 'append' : 'overwrite'} onChange={e => patchOC(s.id, { file_append: e.target.value === 'append' })}
                              className={iCls(false)}>
                              <option value="append">Append to end</option>
                              <option value="overwrite">Overwrite</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Send email */}
                    {s.output === 'email_reply' && (
                      <div className="space-y-2">
                        <label className={lCls}>Send to</label>
                        {[
                          { val: 'sender', label: '↩ Reply to original sender', desc: 'Automatically replies to whoever sent the trigger email' },
                          { val: 'custom', label: '✉ A specific email address', desc: 'Always sends to the same address you specify' },
                        ].map(opt => {
                          const isSender = !s.output_config?.email_to || s.output_config.email_to === 'sender';
                          const active = opt.val === 'sender' ? isSender : !isSender;
                          return (
                            <button key={opt.val} type="button"
                              onClick={() => patchOC(s.id, { email_to: opt.val === 'sender' ? 'sender' : '' })}
                              className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-fast ${active ? 'border-accent/40 bg-accent/5' : 'border-nv-border bg-nv-bg hover:border-accent/20'}`}>
                              <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-fast ${active ? 'border-accent' : 'border-nv-border'}`}>
                                {active && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                              </div>
                              <div>
                                <p className={`text-xs font-medium ${active ? 'text-nv-text' : 'text-nv-muted'}`}>{opt.label}</p>
                                <p className="text-[10px] text-nv-faint">{opt.desc}</p>
                              </div>
                            </button>
                          );
                        })}
                        {s.output_config?.email_to !== 'sender' && s.output_config?.email_to !== undefined && (
                          <input value={s.output_config?.email_to ?? ''} onChange={e => patchOC(s.id, { email_to: e.target.value })}
                            type="email" placeholder="team@company.com"
                            className={iCls(false)} />
                        )}
                      </div>
                    )}

                    {/* Notion */}
                    {s.output === 'notion' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center">
                          <label className={lCls}>Notion database URL</label>
                          {e3.includes(`step_${i}_notion`) && <RequiredBadge />}
                        </div>
                        <input value={s.output_config?.notion_db_url ?? ''} onChange={e => patchOC(s.id, { notion_db_url: e.target.value })}
                          placeholder="https://notion.so/your-database-id"
                          className={iCls(e3.includes(`step_${i}_notion`))} />
                        <p className="text-[10px] text-nv-muted">In Notion: right-click the database → Copy link → paste here. Also connect Notion in Connect Apps.</p>
                      </div>
                    )}

                    {/* Slack */}
                    {s.output === 'slack' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center">
                          <label className={lCls}>Channel name</label>
                          {e3.includes(`step_${i}_slack`) && <RequiredBadge />}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nv-muted text-sm font-bold">#</span>
                          <input value={s.output_config?.slack_channel ?? ''} onChange={e => patchOC(s.id, { slack_channel: e.target.value.replace(/^#/, '') })}
                            placeholder="general"
                            className={`${iCls(e3.includes(`step_${i}_slack`))} pl-7`} />
                        </div>
                        <p className="text-[10px] text-nv-muted">The channel your Slack bot is in. Connect Slack in Connect Apps.</p>
                      </div>
                    )}

                    {/* X (Twitter) post */}
                    {s.output === 'twitter_post' && (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-nv-surface border border-nv-border">
                          <span className="text-base mt-0.5">𝕏</span>
                          <div>
                            <p className="text-xs font-medium text-nv-text">Post as tweet</p>
                            <p className="text-[10px] text-nv-muted leading-relaxed">AI output will be posted to your X account (max 280 chars). Connect X in Connect Apps.</p>
                          </div>
                        </div>
                        <p className="text-[10px] text-nv-muted px-1">The AI step above should produce content under 280 characters. Longer content will be trimmed.</p>
                      </div>
                    )}

                    {/* X (Twitter) reply */}
                    {s.output === 'twitter_reply' && (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <label className={lCls}>Reply to tweet ID <span className="normal-case font-normal text-nv-faint">(optional — leave blank to post as standalone tweet)</span></label>
                          <input value={s.output_config?.twitter_reply_to_id ?? ''}
                            onChange={e => patchOC(s.id, { twitter_reply_to_id: e.target.value })}
                            placeholder="e.g. 1234567890123456789"
                            className={`${iCls(false)} font-mono`} />
                          <p className="text-[10px] text-nv-muted">Find the tweet ID from the tweet URL: twitter.com/user/status/<strong>ID</strong>. Connect X in Connect Apps.</p>
                        </div>
                      </div>
                    )}

                    {/* LinkedIn post */}
                    {s.output === 'linkedin_post' && (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <label className={lCls}>Post visibility</label>
                          <select value={s.output_config?.linkedin_visibility ?? 'PUBLIC'}
                            onChange={e => patchOC(s.id, { linkedin_visibility: e.target.value })}
                            className={iCls(false)}>
                            <option value="PUBLIC">Anyone (public)</option>
                            <option value="CONNECTIONS">Connections only (1st-degree)</option>
                            <option value="LOGGED_IN">LinkedIn members only</option>
                          </select>
                        </div>
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-nv-surface border border-nv-border">
                          <span className="text-base mt-0.5">in</span>
                          <p className="text-[11px] text-nv-muted leading-relaxed">AI output will be published as a LinkedIn post under your account. Connect LinkedIn in Connect Apps.</p>
                        </div>
                      </div>
                    )}

                    {/* Reddit post */}
                    {s.output === 'reddit_post' && (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <label className={lCls}>Subreddit</label>
                          <input value={s.output_config?.reddit_subreddit ?? ''}
                            onChange={e => patchOC(s.id, { reddit_subreddit: e.target.value })}
                            placeholder="e.g. startups or r/IndieHackers"
                            className={iCls(false)} />
                          <p className="text-[10px] text-nv-muted">Enter the subreddit name (with or without r/). Always check the subreddit rules before automating.</p>
                        </div>
                        <div className="space-y-1.5">
                          <label className={lCls}>Post title (optional)</label>
                          <input value={s.output_config?.reddit_post_title ?? ''}
                            onChange={e => patchOC(s.id, { reddit_post_title: e.target.value })}
                            placeholder="Leave blank to use first line of AI output as title"
                            className={iCls(false)} />
                        </div>
                        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-orange-500/8 border border-orange-500/20">
                          <span className="text-base mt-0.5">👽</span>
                          <p className="text-[11px] text-nv-muted leading-relaxed">Reddit allows 60 req/min via OAuth. Repeated identical posts = ban. Always follow subreddit rules. Connect Reddit in Connect Apps.</p>
                        </div>
                      </div>
                    )}

                    {/* Discord */}
                    {s.output === 'discord' && (
                      <div className="space-y-1.5">
                        <label className={lCls}>Discord webhook URL</label>
                        <input value={s.output_config?.discord_webhook ?? ''} onChange={e => patchOC(s.id, { discord_webhook: e.target.value })}
                          placeholder="https://discord.com/api/webhooks/..."
                          className={iCls(false)} />
                        <p className="text-[10px] text-nv-muted">Server Settings → Integrations → Webhooks → Copy URL.</p>
                      </div>
                    )}

                    {/* Google Sheets */}
                    {s.output === 'google_sheets' && (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <label className={lCls}>Spreadsheet ID</label>
                          <input value={s.output_config?.sheet_id ?? ''} onChange={e => patchOC(s.id, { sheet_id: e.target.value })}
                            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                            className={`${iCls(false)} font-mono`} />
                          <p className="text-[10px] text-nv-muted">From the spreadsheet URL: docs.google.com/spreadsheets/d/<strong>ID</strong>/edit</p>
                        </div>
                        <div className="space-y-1.5">
                          <label className={lCls}>Sheet tab name</label>
                          <input value={s.output_config?.sheet_name ?? 'Sheet1'} onChange={e => patchOC(s.id, { sheet_name: e.target.value })}
                            placeholder="Sheet1" className={iCls(false)} />
                        </div>
                      </div>
                    )}

                    {/* Twilio SMS */}
                    {s.output === 'twilio_sms' && (
                      <div className="space-y-1.5">
                        <label className={lCls}>Send SMS to</label>
                        <input value={s.output_config?.sms_to ?? ''} onChange={e => patchOC(s.id, { sms_to: e.target.value })}
                          placeholder="+15551234567" className={iCls(false)} />
                        <p className="text-[10px] text-nv-muted">Connect Twilio (Account SID + Auth Token) in Connect Apps.</p>
                      </div>
                    )}

                    {/* Telegram */}
                    {s.output === 'telegram' && (
                      <div className="space-y-1.5">
                        <label className={lCls}>Chat ID</label>
                        <input value={s.output_config?.telegram_chat_id ?? ''} onChange={e => patchOC(s.id, { telegram_chat_id: e.target.value })}
                          placeholder="-100123456789" className={`${iCls(false)} font-mono`} />
                        <p className="text-[10px] text-nv-muted">Connect your Telegram bot token in Connect Apps.</p>
                      </div>
                    )}

                    {/* HubSpot */}
                    {s.output === 'hubspot' && (
                      <div className="space-y-1.5">
                        <label className={lCls}>Action</label>
                        <select value={s.output_config?.hubspot_action ?? 'create_contact'} onChange={e => patchOC(s.id, { hubspot_action: e.target.value })}
                          className={iCls(false)}>
                          <option value="create_contact">Create / update contact</option>
                          <option value="create_deal">Create deal</option>
                          <option value="add_note">Add note to contact</option>
                        </select>
                        <p className="text-[10px] text-nv-muted">Connect HubSpot in Connect Apps.</p>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-nv-surface border border-nv-border">
                <span className="text-sm">⚡</span>
                <p className="text-xs text-nv-muted">Estimated cost per run: <span className="text-nv-text font-mono font-semibold">~{aiSteps.length * 800} tokens</span></p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-nv-border shrink-0">
          <button onClick={() => step > 0 ? setStep(s => s - 1) : onCancel()}
            className="text-sm text-nv-muted hover:text-nv-text transition-fast font-mono">
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={tryAdvance}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-dim text-white text-sm font-semibold transition-fast">
              {showErr && errsFor(step).length > 0 && <span className="text-white/80 text-xs font-mono">!</span>}
              Next →
            </button>
          ) : (
            <button
              onClick={() => { if (errsFor(3).length) { setShowErr(true); return; } onSave(name, triggerType, triggerConfig, aiSteps); }}
              className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-dim text-white text-sm font-semibold transition-fast">
              Save automation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Automation Card ──────────────────────────────────────────────────────────

function AutomationCard({ automation, onToggle, onCloudToggle, onEdit, onDelete, onRunNow, running }: {
  automation: Automation; onToggle: () => void; onCloudToggle: () => void; onEdit: () => void;
  onDelete: () => void; onRunNow: () => void; running: boolean;
}) {
  const isCanvas = automation.trigger_type === 'canvas_flow';
  const cfg = isCanvas ? {} as TriggerConfig : JSON.parse(automation.trigger_config) as TriggerConfig;
  const steps = isCanvas ? [] : JSON.parse(automation.steps) as Step[];
  const triggerLabel = (TRIGGER_LABELS as Record<string, string>)[automation.trigger_type] ?? 'Canvas Flow';
  return (
    <div className={`rounded-lg border bg-nv-surface p-4 transition-fast ${automation.enabled ? 'border-nv-border' : 'border-nv-border/50 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${automation.enabled ? 'bg-nv-green' : 'bg-nv-faint'}`} />
            <h3 className="text-sm font-semibold text-nv-text truncate">{automation.name}</h3>
            {automation.cloud_enabled && (
              <span title="Runs in cloud when PC is off" className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                ☁ Cloud
              </span>
            )}
            {cfg.is_temp && (
              <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-nv-yellow/15 text-nv-yellow border border-nv-yellow/30">
                Temp · {cfg.max_runs ?? 1} run{(cfg.max_runs ?? 1) !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-nv-muted font-mono">
            {triggerLabel}{cfg.cron ? ` · ${cronToHuman(cfg.cron)}` : ''}{cfg.folder ? ` · ${cfg.folder}` : ''}
          </p>
          <p className="text-xs text-nv-muted mt-1">
            {isCanvas ? 'Visual canvas flow' : `${steps.length} step${steps.length !== 1 ? 's' : ''}`} · {automation.run_count} run{automation.run_count !== 1 ? 's' : ''} · last {fmtTs(automation.last_run_at)}
          </p>
        </div>
        <button onClick={onToggle} className={`relative w-9 h-5 rounded-full transition-fast shrink-0 mt-0.5 ${automation.enabled ? 'bg-accent' : 'bg-nv-border'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-fast ${automation.enabled ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-nv-border">
        <button onClick={onRunNow} disabled={running}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent text-xs font-mono transition-fast disabled:opacity-50">
          {running ? <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/></svg>
            : <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3"><path d="M2 1l9 5-9 5V1z"/></svg>}
          {running ? 'Running…' : 'Run now'}
        </button>
        <button onClick={onEdit}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-nv-muted hover:text-violet-400 hover:bg-violet-500/10 text-xs font-mono transition-fast">
          <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M8.5 1.5l2 2-7 7H1.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
          Edit in Canvas
        </button>
        {!isCanvas && (
          <button onClick={onCloudToggle}
            title={automation.cloud_enabled ? 'Disable cloud run (PC-off)' : 'Enable cloud run when PC is off'}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono transition-fast ${automation.cloud_enabled ? 'text-sky-400 bg-sky-500/10 hover:bg-sky-500/20' : 'text-nv-faint hover:text-sky-400 hover:bg-sky-500/10'}`}>
            ☁
          </button>
        )}
        <button onClick={onDelete} className="px-2.5 py-1 rounded-md text-nv-faint hover:text-nv-red hover:bg-nv-red/10 text-xs font-mono transition-fast ml-auto">Delete</button>
      </div>
    </div>
  );
}

// ─── Log Entry ────────────────────────────────────────────────────────────────

function LogEntry({ run, automationName }: { run: AutomationRun; automationName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-nv-border rounded-lg bg-nv-surface overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-nv-surface2 transition-fast">
        <span className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'success' ? 'bg-nv-green' : run.status === 'failed' ? 'bg-nv-red' : 'bg-nv-yellow'}`} />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-nv-text font-medium truncate">{automationName}</span>
          <span className="text-xs text-nv-muted ml-2">{fmtRelative(run.triggered_at)}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {run.tokens_used > 0 && <span className="text-xs text-nv-muted font-mono">{run.tokens_used} tok</span>}
          <span className={`text-xs font-mono ${run.status === 'success' ? 'text-nv-green' : run.status === 'failed' ? 'text-nv-red' : 'text-nv-yellow'}`}>{run.status}</span>
          <svg viewBox="0 0 12 12" fill="none" className={`w-3 h-3 text-nv-faint transition-fast ${open ? 'rotate-180' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-nv-border bg-nv-bg/50">
          {run.output_summary && <p className="text-xs text-nv-muted mt-2 whitespace-pre-wrap">{run.output_summary}</p>}
          {run.error && <p className="text-xs text-nv-red mt-2 font-mono">{run.error}</p>}
          <p className="text-xs text-nv-muted mt-2 font-mono">{fmtTs(run.triggered_at)} → {run.completed_at ? fmtTs(run.completed_at) : 'in progress'}</p>
        </div>
      )}
    </div>
  );
}

// ─── AI Chat Bar (for Canvas tab) ────────────────────────────────────────────

type AIMode = 'auto' | 'local';

function AIChatBar({ canvasRef }: { canvasRef: React.RefObject<FlowCanvasHandle | null> }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [aiMode, setAiMode] = useState<AIMode>('auto');
  const [showModeMenu, setShowModeMenu] = useState(false);

  async function handleSend() {
    const msg = input.trim();
    if (!msg || loading) return;
    setLoading(true);
    setError('');

    // Check for an existing flow on canvas — if so, edit it instead of replacing
    const existing = canvasRef.current?.getFlow();
    const hasExisting = (existing?.nodes.length ?? 0) > 0;

    let systemPrompt = FLOW_SYSTEM_PROMPT;
    if (hasExisting) {
      setHint('Editing your existing flow…');
      systemPrompt = `${FLOW_SYSTEM_PROMPT}

IMPORTANT — EDIT MODE: The canvas already has this flow:
${JSON.stringify(existing, null, 2)}

The user wants to modify it. Apply their change to the existing flow and return the complete updated flow JSON.
Keep all existing nodes and edges that the user has not asked to change.`;
    } else {
      setHint('Building your flow…');
    }

    try {
      const raw = await callAI(msg, systemPrompt, aiMode === 'local');
      // Strip code fences, then extract the outermost JSON object (handles prose wrapping)
      const stripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      const cleaned = jsonMatch ? jsonMatch[0] : stripped.trim();
      const flow = JSON.parse(cleaned) as { nodes: Node[]; edges: Edge[] };

      if (!Array.isArray(flow.nodes)) throw new Error('Invalid flow structure');

      canvasRef.current?.applyFlow(flow.nodes, flow.edges);
      setInput('');
      setHint(hasExisting ? `Flow updated — ${flow.nodes.length} nodes.` : `Built ${flow.nodes.length} nodes. Refine it on the canvas.`);
      setTimeout(() => setHint(''), 4000);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('No AI') || errMsg.includes('connect') || errMsg.includes('local') || errMsg.includes('Ollama')) {
        setError('No AI connected. Go to Connect Apps to add your Gemini or OpenAI key.');
      } else if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('invalid') || errMsg.includes('API key')) {
        setError('API key error. Check your key in Connect Apps.');
      } else {
        setError('Could not build flow — try describing it differently, e.g. "Email me a summary every Monday at 9am".');
      }
      setTimeout(() => setError(''), 6000);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div className="shrink-0 border-t border-nv-border bg-nv-bg px-4 py-3">
      {(error || hint) && (
        <p className={`text-[11px] font-mono mb-2 px-1 ${error ? 'text-red-400' : 'text-nv-green'}`}>
          {error || hint}
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* AI mode selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowModeMenu(m => !m)}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-nv-surface border border-nv-border hover:border-nv-muted/40 text-nv-muted text-[10px] font-mono transition-fast"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${aiMode === 'local' ? 'bg-nv-green' : 'bg-accent'}`} />
            {aiMode === 'local' ? 'Local' : 'Auto'}
            <svg viewBox="0 0 8 8" fill="currentColor" className="w-2 h-2 opacity-50"><path d="M1 2l3 4 3-4H1z"/></svg>
          </button>
          {showModeMenu && (
            <div className="absolute bottom-full mb-1 left-0 bg-nv-surface border border-nv-border rounded-lg overflow-hidden shadow-xl z-50 w-48">
              <button onClick={() => { setAiMode('auto'); setShowModeMenu(false); }}
                className={`w-full px-3 py-2 text-left text-[11px] font-mono flex items-center gap-2 hover:bg-nv-surface2 transition-fast ${aiMode === 'auto' ? 'text-accent' : 'text-nv-muted'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <div>
                  <p className="font-semibold">Auto</p>
                  <p className="text-nv-faint text-[9px]">Uses your connected API key</p>
                </div>
              </button>
              <button onClick={() => { setAiMode('local'); setShowModeMenu(false); }}
                className={`w-full px-3 py-2 text-left text-[11px] font-mono flex items-center gap-2 hover:bg-nv-surface2 transition-fast ${aiMode === 'local' ? 'text-nv-green' : 'text-nv-muted'}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-nv-green shrink-0" />
                <div>
                  <p className="font-semibold">Local (Ollama)</p>
                  <p className="text-nv-faint text-[9px]">Runs on your machine · free</p>
                </div>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 flex items-center gap-2 bg-nv-surface border border-nv-border rounded-xl px-3 py-2 focus-within:border-accent/40 transition-fast">
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-accent/60 shrink-0">
            <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z"/>
          </svg>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Describe your automation… e.g. 'Email arrives → AI summarises → send to Slack'"
            disabled={loading}
            className="flex-1 bg-transparent text-nv-text text-[12px] focus:outline-none placeholder:text-nv-faint disabled:opacity-50"
          />
        </div>
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-dim disabled:opacity-40 text-white text-[12px] font-semibold shrink-0 transition-fast"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"/>
            </svg>
          ) : 'Build'}
        </button>
      </div>
      <p className="text-[9px] font-mono text-nv-faint mt-1.5 px-1">
        AI builds the canvas · click any node to edit · connect multiple nodes to one box freely
      </p>
    </div>
  );
}

// ─── Main Module ──────────────────────────────────────────────────────────────

interface AutomationModuleProps {
  canvasFlow?: { nodes: Node[]; edges: Edge[] } | null;
  onCanvasFlowConsumed?: () => void;
}

export default function AutomationModule({ canvasFlow, onCanvasFlowConsumed }: AutomationModuleProps = {}) {
  const { user } = useAuth();
  const [tab, setTab] = useState<'canvas' | 'automations' | 'templates' | 'logs'>('canvas');
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editTarget, setEditTarget] = useState<Automation | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState('All');
  const [connectedServices, setConnectedServices] = useState<string[]>([]);
  const canvasRef = useRef<FlowCanvasHandle | null>(null);
  const [canvasPending, setCanvasPending] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [canvasName, setCanvasName] = useState('');

  const userId = user?.id ?? '';

  useEffect(() => {
    credentialStore.list().then(setConnectedServices).catch(() => setConnectedServices([]));
  }, []);

  useEffect(() => {
    if (canvasFlow) {
      canvasRef.current?.applyFlow(canvasFlow.nodes, canvasFlow.edges);
      setTab('canvas');
      onCanvasFlowConsumed?.();
    }
  }, [canvasFlow]);

  const loadAutomations = useCallback(async () => {
    if (!userId) return;
    try { setAutomations(await invoke<Automation[]>('automation_list', { userId })); } catch {}
  }, [userId]);

  const loadLogs = useCallback(async () => {
    if (!userId) return;
    try { setRuns(await invoke<AutomationRun[]>('automation_get_logs', { automationId: null, limit: 100 })); } catch {}
  }, [userId]);

  useEffect(() => { loadAutomations(); }, [loadAutomations]);

  // Listen for background trigger fires from Rust
  useEffect(() => {
    if (!userId) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ id: string; trigger_type: string; context: string }>(
        'automation_fired',
        async ({ payload }) => {
          // Re-fetch fresh automation list so we always have latest state
          let list: Automation[] = [];
          try { list = await invoke<Automation[]>('automation_list', { userId }); } catch { return; }
          setAutomations(list);
          const auto = list.find(a => a.id === payload.id);
          if (!auto || !auto.enabled || auto.trigger_type === 'canvas_flow') return;
          setRunningId(payload.id);
          try {
            await executeAutomation(auto as unknown as AutomationRow, userId, payload.context);
          } finally {
            setRunningId(null);
            loadAutomations();
            loadLogs();
          }
        }
      ).then(u => { unlisten = u; });
    });
    return () => { unlisten?.(); };
  }, [userId]);
  useEffect(() => { if (tab === 'logs') loadLogs(); }, [tab, loadLogs]);

  async function handleSave(name: string, trigger_type: TriggerType, trigger_config: TriggerConfig, steps: Step[]) {
    if (!userId) return;
    const config = JSON.stringify(trigger_config);
    const stepsJson = JSON.stringify(steps);
    if (editTarget) {
      await invoke('automation_update', { id: editTarget.id, name, triggerType: trigger_type, triggerConfig: config, steps: stepsJson });
    } else {
      await invoke('automation_create', { id: uuid(), userId, name, triggerType: trigger_type, triggerConfig: config, steps: stepsJson });
    }
    setShowBuilder(false); setEditTarget(null); loadAutomations();
  }

  function handleCanvasSave(nodes: Node[], edges: Edge[]) {
    setCanvasName('');
    setCanvasPending({ nodes, edges });
  }

  async function confirmCanvasSave() {
    if (!userId || !canvasPending) return;
    const name = canvasName.trim() || 'Untitled flow';
    await invoke('automation_create', {
      id: uuid(), userId, name,
      triggerType: 'canvas_flow',
      triggerConfig: JSON.stringify({ nodes: canvasPending.nodes, edges: canvasPending.edges }),
      steps: '[]',
    });
    setCanvasPending(null);
    loadAutomations();
  }

  async function handleToggle(a: Automation) {
    await invoke('automation_toggle', { id: a.id, enabled: !a.enabled }); loadAutomations();
  }

  async function handleCloudToggle(a: Automation) {
    const enable = !a.cloud_enabled;
    await invoke('automation_cloud_toggle', { id: a.id, cloudEnabled: enable });

    if (enable) {
      // Sync automation record to Supabase
      const trigCfg = JSON.parse(a.trigger_config);
      const steps   = JSON.parse(a.steps) as Step[];
      await supabase.from('automations').upsert({
        id: a.id, user_id: a.user_id, name: a.name,
        trigger_type: a.trigger_type, trigger_config: trigCfg,
        steps, enabled: a.enabled, cloud_enabled: true,
      }, { onConflict: 'id' });

      // Sync relevant service credentials to user_integrations
      const outputs = steps.map(s => s.output);
      const syncs: Promise<unknown>[] = [];

      if (outputs.includes('linkedin_post')) {
        syncs.push((async () => {
          const li = await credentialStore.get('linkedin');
          if (!li?.access_token) return;
          // Fetch person URN via LinkedIn userinfo
          let personUrn = li.person_urn ?? '';
          if (!personUrn) {
            try {
              const r = await fetch('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${li.access_token}` },
              });
              if (r.ok) {
                const info = await r.json() as { sub?: string };
                personUrn = `urn:li:person:${info.sub ?? ''}`;
              }
            } catch { /* best-effort */ }
          }
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'linkedin',
            access_token: li.access_token,
            extra_data: { person_urn: personUrn },
          }, { onConflict: 'user_id,service' });
        })());
      }

      if (outputs.includes('twitter_post') || outputs.includes('twitter_reply')) {
        syncs.push((async () => {
          const tw = await credentialStore.get('twitter');
          if (!tw?.consumer_key) return;
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'twitter',
            access_token: JSON.stringify({
              consumer_key: tw.consumer_key,
              consumer_secret: tw.consumer_secret,
              access_token: tw.access_token,
              access_token_secret: tw.access_token_secret,
            }),
          }, { onConflict: 'user_id,service' });
        })());
      }

      if (outputs.includes('notion')) {
        syncs.push((async () => {
          const n = await credentialStore.get('notion');
          if (!n) return;
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'notion',
            access_token: n.access_token ?? n.token ?? '',
          }, { onConflict: 'user_id,service' });
        })());
      }

      if (outputs.includes('slack')) {
        syncs.push((async () => {
          const sl = await credentialStore.get('slack');
          if (!sl) return;
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'slack',
            access_token: sl.bot_token ?? sl.access_token ?? '',
          }, { onConflict: 'user_id,service' });
        })());
      }

      if (outputs.includes('discord')) {
        syncs.push((async () => {
          const dc = await credentialStore.get('discord');
          if (!dc?.webhook_url) return;
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'discord',
            access_token: dc.webhook_url,
          }, { onConflict: 'user_id,service' });
        })());
      }

      if (outputs.includes('telegram')) {
        syncs.push((async () => {
          const tg = await credentialStore.get('telegram');
          if (!tg?.bot_token) return;
          await supabase.from('user_integrations').upsert({
            user_id: a.user_id, service: 'telegram',
            access_token: tg.bot_token,
          }, { onConflict: 'user_id,service' });
        })());
      }

      await Promise.all(syncs);
    } else {
      // Disable cloud in Supabase
      await supabase.from('automations').update({ cloud_enabled: false }).eq('id', a.id);
    }
    loadAutomations();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this automation?')) return;
    await invoke('automation_delete', { id }); loadAutomations();
  }

  async function handleRunNow(automation: Automation) {
    setRunningId(automation.id);
    await executeAutomation(automation as unknown as AutomationRow, userId);
    setRunningId(null);
    loadAutomations();
    if (tab === 'logs') loadLogs();
  }

  function useTemplate(t: Template) {
    const flow = templateToFlow(t);
    canvasRef.current?.applyFlow(flow.nodes, flow.edges);
    setTab('canvas');
  }

  const allTags = ['All', ...Array.from(new Set(TEMPLATES.flatMap(t => t.tags)))];
  const filteredTemplates = templateFilter === 'All' ? TEMPLATES : TEMPLATES.filter(t => t.tags.includes(templateFilter));

  const TAB_LABELS: Record<typeof tab, string> = { canvas: 'Canvas', automations: 'My Flows', templates: 'Templates', logs: 'Logs' };

  return (
    <div className="flex flex-col h-full bg-nv-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-nv-border shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-nv-text">Automation</h1>
          <p className="text-xs text-nv-muted">Visual workflow builder · runs on your machine</p>
        </div>
        <button onClick={() => { setEditTarget(null); setShowBuilder(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-dim text-white text-xs font-semibold transition-fast">
          <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          New flow
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-nv-border shrink-0 px-6">
        {(['canvas', 'automations', 'templates', 'logs'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2.5 px-1 mr-5 text-xs font-medium border-b-2 transition-fast ${tab === t ? 'border-accent text-accent' : 'border-transparent text-nv-faint hover:text-nv-muted'}`}>
            {TAB_LABELS[t]}
            {t === 'automations' && automations.length > 0 && (
              <span className="ml-1.5 bg-nv-surface2 text-nv-muted text-[10px] font-mono px-1.5 py-0.5 rounded-full">{automations.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Canvas — always mounted so canvasRef is never null when switching from other tabs */}
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${tab !== 'canvas' ? 'hidden' : ''}`}>
        <FlowCanvas ref={canvasRef} connectedServices={connectedServices} onSave={handleCanvasSave} />
        <AIChatBar canvasRef={canvasRef} />
      </div>

      {/* My Flows tab */}
      {tab === 'automations' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-3">
            {automations.length === 0 ? (
              <div className="text-center py-16">
                <svg viewBox="0 0 28 28" fill="none" className="w-10 h-10 text-nv-faint mx-auto mb-4"><path d="M16 3l-9 13h8l-3 9 9-13h-8l3-9z" fill="currentColor"/></svg>
                <p className="text-sm text-nv-muted">No saved flows yet</p>
                <p className="text-xs text-nv-muted mt-1">Build one in Canvas or pick a template</p>
                <button onClick={() => setTab('templates')} className="mt-4 text-xs text-accent hover:underline font-mono">Browse templates →</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {automations.map(a => (
                  <AutomationCard key={a.id} automation={a} onToggle={() => handleToggle(a)}
                    onCloudToggle={() => handleCloudToggle(a)}
                    onEdit={() => {
                      const flow = automationToFlow(a);
                      canvasRef.current?.applyFlow(flow.nodes, flow.edges);
                      setTab('canvas');
                    }}
                    onDelete={() => handleDelete(a.id)} onRunNow={() => handleRunNow(a)} running={runningId === a.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Templates tab */}
      {tab === 'templates' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div>
            <div className="flex gap-2 mb-5 flex-wrap">
              {allTags.map(tag => (
                <button key={tag} onClick={() => setTemplateFilter(tag)}
                  className={`px-3 py-1 rounded-full text-xs font-mono transition-fast ${templateFilter === tag ? 'bg-accent text-white' : 'bg-nv-surface border border-nv-border text-nv-muted hover:text-nv-text'}`}>
                  {tag}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredTemplates.map(t => (
                <div key={t.id} className="rounded-lg border border-nv-border bg-nv-surface p-4 flex flex-col gap-3 hover:border-accent/40 transition-fast">
                  <div>
                    <h3 className="text-sm font-semibold text-nv-text">{t.name}</h3>
                    <p className="text-xs text-nv-muted mt-1 leading-relaxed">{t.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {t.tags.map(tag => <span key={tag} className="px-2 py-0.5 rounded-full bg-nv-surface2 text-nv-muted text-[10px] font-mono">{tag}</span>)}
                    <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-mono ml-auto">{TRIGGER_LABELS[t.trigger_type]}</span>
                  </div>
                  <button onClick={() => useTemplate(t)} className="w-full py-1.5 rounded-md bg-nv-bg border border-nv-border hover:border-accent hover:text-accent text-nv-muted text-xs font-mono transition-fast">
                    Use template
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {runs.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm text-nv-muted">No runs yet</p>
                <p className="text-xs text-nv-muted mt-1">Run an automation to see logs here</p>
              </div>
            ) : (
              runs.map(r => {
                const auto = automations.find(a => a.id === r.automation_id);
                return <LogEntry key={r.id} run={r} automationName={auto?.name ?? r.automation_id.slice(0, 8)} />;
              })
            )}
          </div>
        </div>
      )}

      {showBuilder && (
        <WorkflowBuilder initial={editTarget ?? undefined} onSave={handleSave} onCancel={() => { setShowBuilder(false); setEditTarget(null); }} />
      )}

      {canvasPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-nv-surface border border-nv-border rounded-xl shadow-2xl p-6 w-80 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-nv-text">Save canvas flow</h2>
            <input
              autoFocus
              value={canvasName}
              onChange={e => setCanvasName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCanvasSave(); if (e.key === 'Escape') setCanvasPending(null); }}
              placeholder="Flow name…"
              className="w-full px-3 py-2 rounded-lg bg-nv-bg border border-nv-border text-nv-text text-sm placeholder:text-nv-faint outline-none focus:border-accent transition-fast"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCanvasPending(null)}
                className="px-4 py-1.5 rounded-lg text-xs text-nv-muted hover:text-nv-text transition-fast">
                Cancel
              </button>
              <button onClick={confirmCanvasSave}
                className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-dim text-white text-xs font-semibold transition-fast">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
