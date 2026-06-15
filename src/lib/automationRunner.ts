import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { credentialStore } from './krewDb';
import { buildTwitterOAuthHeader } from './krewTools';
import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AutomationStep {
  id: string;
  action: string;
  prompt: string;
  output: string;
  output_config?: {
    notif_title?: string;
    file_path?: string;
    file_format?: string;
    file_append?: boolean;
    email_to?: string;
    notion_db_url?: string;
    slack_channel?: string;
    twitter_reply_to_id?: string;
    linkedin_person_urn?: string;
    linkedin_visibility?: string;
    reddit_subreddit?: string;
    reddit_post_title?: string;
    // New outputs
    discord_webhook?: string;
    sheet_id?: string;
    sheet_name?: string;
    sms_to?: string;
    telegram_chat_id?: string;
    hubspot_action?: string;
  };
}

export interface TriggerConfig {
  cron?: string;
  folder?: string;
  file_types?: string;
  email_from?: string;
  email_subject?: string;
  email_filter?: string;
  webhook_path?: string;
  weekdays_only?: boolean;
  business_hours?: boolean;
  dedupe_daily?: boolean;
  is_temp?: boolean;
  max_runs?: number;
  knowledge_context?: string;
  twitter_filter?: string;
  linkedin_filter?: string;
  notion_crm_db?: string;
  pitch_file_path?: string;
  // New trigger types
  rss_url?: string;
  github_repo?: string;
  github_event?: string;
  stripe_event?: string;
  calendar_id?: string;
  lookahead_mins?: number;
  data_source?: string; // 'gmail' = fetch unread emails before running (for schedule triggers)
}

export interface AutomationRow {
  id: string;
  user_id: string;
  name: string;
  trigger_type: string;
  trigger_config: string;
  steps: string;
  enabled: boolean;
  cloud_enabled: boolean;
  run_count: number;
  last_run_at: number | null;
  created_at: number;
}

// ─── AI caller ────────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

export async function callAutomationAI(userMessage: string, systemPrompt: string): Promise<string> {
  const callId = uuid();
  let mode = 'local';
  let apiKey: string | null = null;
  let provider: string | null = null;
  let modelName: string | null = null;

  try {
    const services = await credentialStore.list();
    const preferred = ['gemini', 'openai', 'claude'];
    for (const svc of preferred) {
      if (services.includes(svc)) {
        const d = await credentialStore.get(svc).catch(() => null);
        const key = d?.api_key || d?.access_token;
        if (key) {
          mode = 'own_key'; apiKey = key; provider = svc;
          if (svc === 'gemini') modelName = 'gemini-2.5-flash-lite';
          if (svc === 'openai') modelName = 'gpt-4o-mini';
          if (svc === 'claude') modelName = 'claude-3-5-haiku-20241022';
          break;
        }
      }
    }
  } catch (_e) { /* no credentials — fall back below */ }

  // No BYOK key found — use adris.tech AI if user is logged in
  let sessionToken: string | null = null;
  if (mode === 'local') {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        mode = 'nivara';
        sessionToken = session.access_token;
      }
    } catch (_e) { /* not logged in — stay on local */ }
  }

  return new Promise<string>(async (resolve, reject) => {
    let fullText = '';
    let cleanup = () => {};

    const u1 = await listen<{ id: string; text: string }>('krew-chunk', e => {
      if (e.payload.id !== callId) return;
      fullText += e.payload.text;
    });
    const u2 = await listen<{ id: string }>('krew-done', e => {
      if (e.payload.id !== callId) return;
      cleanup(); resolve(fullText);
    });
    const u3 = await listen<{ id: string; error: string }>('krew-error', e => {
      if (e.payload.id !== callId) return;
      cleanup(); reject(new Error(e.payload.error));
    });
    cleanup = () => { u1(); u2(); u3(); };

    invoke('krew_ai_stream', {
      callId, mode, systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      apiKey, provider, modelName,
      localModel: mode === 'local' ? 'llama3' : null,
      baseUrl: null, sessionToken,
    }).catch(e => { cleanup(); reject(e); });
  });
}

// ─── Auto-provision Notion database ──────────────────────────────────────────

async function ensureNotionDatabase(token: string, automationName: string, isOAuth = false): Promise<string> {
  const headers = { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

  const dbProps = {
    Name:    { title: {} },
    Content: { rich_text: {} },
    Date:    { date: {} },
    Source:  { select: { options: [{ name: automationName, color: 'purple' }] } },
    Status:  { select: { options: [{ name: 'New', color: 'green' }, { name: 'Reviewed', color: 'gray' }] } },
  };

  // Search for existing adris.tech Automations DB first
  const searchRaw = await invoke<string>('krew_http_call', {
    method: 'POST', url: 'https://api.notion.com/v1/search',
    headers, body: JSON.stringify({ query: 'adris.tech Automations', filter: { value: 'database', property: 'object' } }),
  }).catch(() => '{}');
  const searchData = JSON.parse(searchRaw) as { results?: { id?: string; title?: { plain_text?: string }[] }[] };
  const existing = searchData.results?.find(r => r.title?.[0]?.plain_text === 'adris.tech Automations');
  if (existing?.id) return existing.id.replace(/-/g, '');

  // With OAuth token, create a top-level "adris.tech" page then the DB under it
  if (isOAuth) {
    // Try to find existing adris.tech root page
    const pageSearchRaw = await invoke<string>('krew_http_call', {
      method: 'POST', url: 'https://api.notion.com/v1/search',
      headers, body: JSON.stringify({ query: 'adris.tech', filter: { value: 'page', property: 'object' }, page_size: 5 }),
    }).catch(() => '{}');
    const pageSearch = JSON.parse(pageSearchRaw) as { results?: { id?: string; properties?: { title?: { title?: { plain_text?: string }[] } } }[] };
    let rootPageId = pageSearch.results?.find(r => {
      const t = r.properties?.title?.title?.[0]?.plain_text ?? '';
      return t === 'adris.tech';
    })?.id ?? '';

    // Create root page if not found
    if (!rootPageId) {
      const rootRaw = await invoke<string>('krew_http_call', {
        method: 'POST', url: 'https://api.notion.com/v1/pages',
        headers,
        body: JSON.stringify({
          parent: { workspace: true },
          properties: { title: { title: [{ text: { content: 'adris.tech' } }] } },
        }),
      }).catch(() => '{}');
      const rootPage = JSON.parse(rootRaw) as { id?: string };
      rootPageId = rootPage.id ?? '';
    }
    if (!rootPageId) return '';

    const createRaw = await invoke<string>('krew_http_call', {
      method: 'POST', url: 'https://api.notion.com/v1/databases',
      headers,
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: rootPageId },
        title: [{ type: 'text', text: { content: 'adris.tech Automations' } }],
        properties: dbProps,
      }),
    }).catch(() => '{}');
    const createData = JSON.parse(createRaw) as { id?: string };
    return (createData.id ?? '').replace(/-/g, '');
  }

  // Internal token: find any accessible page as parent
  const pagesRaw = await invoke<string>('krew_http_call', {
    method: 'POST', url: 'https://api.notion.com/v1/search',
    headers, body: JSON.stringify({ filter: { value: 'page', property: 'object' }, page_size: 1 }),
  }).catch(() => '{}');
  const pagesData = JSON.parse(pagesRaw) as { results?: { id?: string }[] };
  const parentPageId = pagesData.results?.[0]?.id ?? '';
  if (!parentPageId) return '';

  const createRaw = await invoke<string>('krew_http_call', {
    method: 'POST', url: 'https://api.notion.com/v1/databases',
    headers,
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'adris.tech Automations' } }],
      properties: dbProps,
    }),
  }).catch(() => '{}');
  const createData = JSON.parse(createRaw) as { id?: string };
  return (createData.id ?? '').replace(/-/g, '');
}

// ─── Auto-provision Google Sheet ──────────────────────────────────────────────

async function ensureGoogleSheet(accessToken: string, automationName: string): Promise<string> {
  const headers = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // Search Drive for existing adris.tech sheet
  const searchRaw = await invoke<string>('krew_http_call', {
    method: 'GET',
    url: `https://www.googleapis.com/drive/v3/files?q=name%3D'adris.tech+Automations'+and+mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id,name)`,
    headers, body: null,
  }).catch(() => '{}');
  const searchData = JSON.parse(searchRaw) as { files?: { id?: string }[] };
  if (searchData.files?.length) return searchData.files[0].id ?? '';

  // Create spreadsheet
  const createRaw = await invoke<string>('krew_http_call', {
    method: 'POST', url: 'https://sheets.googleapis.com/v4/spreadsheets',
    headers,
    body: JSON.stringify({
      properties: { title: 'adris.tech Automations' },
      sheets: [{ properties: { title: automationName.slice(0, 100) }, data: [{ rowData: [{ values: [
        { userEnteredValue: { stringValue: 'Date' } },
        { userEnteredValue: { stringValue: 'Automation' } },
        { userEnteredValue: { stringValue: 'Content' } },
      ] }] }] }],
    }),
  }).catch(() => '{}');
  const createData = JSON.parse(createRaw) as { spreadsheetId?: string };
  return createData.spreadsheetId ?? '';
}

// ─── Auth-error delivery notification ────────────────────────────────────────

async function emitDeliveryError(service: string, err: unknown): Promise<void> {
  const msg = String(err ?? '').toLowerCase();
  const isAuth = msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')
    || msg.includes('forbidden') || msg.includes('invalid_token') || msg.includes('expired');
  try {
    await emit('automation-error', {
      title: isAuth ? `${service} — token expired` : `${service} — delivery failed`,
      body: isAuth
        ? `Your ${service} access token has expired. Open Connect Apps and reconnect ${service} to fix this.`
        : `Could not deliver automation output to ${service}. Check your credentials in Connect Apps.`,
    });
  } catch (_e) { /* ignore */ }
}

// ─── Retry with exponential backoff ──────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError;
}

// ─── Condition checks ─────────────────────────────────────────────────────────

function passesConditions(cfg: TriggerConfig, lastRunAt: number | null): boolean {
  const now = new Date();
  if (cfg.weekdays_only && (now.getDay() === 0 || now.getDay() === 6)) return false;
  if (cfg.business_hours && (now.getHours() < 8 || now.getHours() >= 20)) return false;
  if (cfg.dedupe_daily && lastRunAt) {
    const lastRun = new Date(lastRunAt * 1000);
    if (lastRun.toDateString() === now.toDateString()) return false;
  }
  return true;
}

// ─── Main execution function ──────────────────────────────────────────────────

export async function executeAutomation(
  automation: AutomationRow,
  userId: string,
  overrideContext?: string,
): Promise<void> {
  const runId = uuid();
  const cfg = JSON.parse(automation.trigger_config) as TriggerConfig;

  // Check conditions before running
  if (!passesConditions(cfg, automation.last_run_at)) return;

  try {
    const steps = JSON.parse(automation.steps) as AutomationStep[];

    // ── Pitch file context (read PRODUCT-DETAILS.MD or any pitch doc at runtime) ─
    let pitchContext = '';
    if (!overrideContext && cfg.pitch_file_path) {
      try {
        const fileContent = await invoke<string>('read_file', { path: cfg.pitch_file_path }).catch(() => '');
        if (fileContent) pitchContext = `## Product / Pitch Context\n${fileContent.slice(0, 4000)}\n\n---\n\n`;
      } catch (_e) { /* file not found */ }
    }

    const knowledgeBlock = [
      cfg.knowledge_context ? `## Company Knowledge Base\n${cfg.knowledge_context}\n\n---\n\n` : '',
      pitchContext,
    ].filter(Boolean).join('');

    const knowledgeRule = (cfg.knowledge_context || pitchContext)
      ? ' Use the context sections above to inform your response. All produced content must sound like the user wrote it — never disclose AI involvement.'
      : '';

    // ── Build trigger content ─────────────────────────────────────────────────
    let triggerContent = overrideContext || `Automation "${automation.name}" fired at ${new Date().toLocaleString()}.`;

    if (!overrideContext && automation.trigger_type === 'email') {
      try {
        const gmailCred = await credentialStore.get('gmail').catch(() => null);
        if (gmailCred?.email && gmailCred?.app_password) {
          const query = [
            cfg.email_from    ? `from:${cfg.email_from}` : '',
            cfg.email_subject ? `subject:${cfg.email_subject}` : '',
            cfg.email_filter  ?? '',
          ].filter(Boolean).join(' ').trim() || 'is:unread';
          const emails = await invoke<string>('gmail_fetch_emails', {
            email: gmailCred.email,
            appPassword: gmailCred.app_password,
            query, limit: 3,
          }).catch(() => null);
          if (emails && !emails.startsWith('No emails')) {
            const emailKey = `nv-email-seen-${automation.id}`;
            const emailFingerprint = emails.slice(0, 200);
            const lastSeen = localStorage.getItem(emailKey) ?? '';
            if (emailFingerprint === lastSeen) {
              // Same emails as last run — skip
            } else {
              triggerContent = emails;
              try { localStorage.setItem(emailKey, emailFingerprint); } catch { /* quota */ }
            }
          }
        }
      } catch (_e) { /* Gmail not connected */ }
    }
    // ── Schedule + Gmail data source (fetch emails on a schedule) ────────────
    if (!overrideContext && automation.trigger_type === 'schedule' && cfg.data_source === 'gmail') {
      try {
        const gmailCred = await credentialStore.get('gmail').catch(() => null);
        if (gmailCred?.email && gmailCred?.app_password) {
          const emails = await invoke<string>('gmail_fetch_emails', {
            email: gmailCred.email,
            appPassword: gmailCred.app_password,
            query: 'is:unread',
            limit: 10,
          }).catch(() => null);
          if (emails && !emails.startsWith('No emails')) {
            triggerContent = `Unread emails fetched at ${new Date().toLocaleString()}:\n\n${emails}`;
          } else {
            triggerContent = `No unread emails found at ${new Date().toLocaleString()}.`;
          }
        } else {
          triggerContent = `Gmail not connected. Connect Gmail in Connect Apps to fetch emails.`;
        }
      } catch (_e) { /* Gmail not connected */ }
    }

    // ── Schedule + X mentions data source ────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'schedule' && cfg.data_source === 'x_mentions') {
      try {
        const twCred = await credentialStore.get('twitter').catch(() => null);
        if (twCred?.api_key && twCred?.api_secret && twCred?.access_token && twCred?.access_token_secret) {
          const meUrl = 'https://api.twitter.com/2/users/me';
          const meAuth = await buildTwitterOAuthHeader('GET', meUrl, {}, twCred.api_key, twCred.api_secret, twCred.access_token, twCred.access_token_secret);
          const meRaw = await invoke<string>('krew_http_call', { method: 'GET', url: meUrl, headers: { Authorization: meAuth }, body: null }).catch(() => '{}');
          const uid = (JSON.parse(meRaw) as { data?: { id: string } }).data?.id;
          if (uid) {
            const mUrl = `https://api.twitter.com/2/users/${uid}/mentions?max_results=10&tweet.fields=created_at,author_id,text`;
            const mAuth = await buildTwitterOAuthHeader('GET', mUrl, {}, twCred.api_key, twCred.api_secret, twCred.access_token, twCred.access_token_secret);
            const mRaw = await invoke<string>('krew_http_call', { method: 'GET', url: mUrl, headers: { Authorization: mAuth }, body: null }).catch(() => '{}');
            const tweets = (JSON.parse(mRaw) as { data?: { id: string; text: string; author_id: string; created_at: string }[] }).data ?? [];
            const filtered = cfg.twitter_filter
              ? tweets.filter(t => t.text.toLowerCase().includes(cfg.twitter_filter!.toLowerCase()))
              : tweets;
            if (filtered.length) {
              triggerContent = `Recent X @mentions (${new Date().toLocaleString()}):\n\n` +
                filtered.slice(0, 10).map((t, i) => `${i + 1}. Author: ${t.author_id} | ${t.created_at}\n   "${t.text}"`).join('\n\n');
            } else {
              triggerContent = `No X @mentions found at ${new Date().toLocaleString()}.`;
            }
          }
        } else {
          triggerContent = `X/Twitter not connected. Connect X in Connect Apps to fetch mentions.`;
        }
      } catch (_e) { /* X fetch failed */ }
    }

    // ── Schedule + RSS data source ────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'schedule' && cfg.data_source === 'rss' && cfg.rss_url) {
      try {
        const rssRaw = await invoke<string>('krew_http_call', { method: 'GET', url: cfg.rss_url, headers: { 'User-Agent': 'adris.tech/1.0' }, body: null }).catch(() => '');
        if (rssRaw) {
          const clean = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
          const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
          const items: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = itemRegex.exec(rssRaw)) && items.length < 10) {
            const block = m[1];
            const t = clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
            const l = (block.match(/<link[^>]*>(https?:[^<]*)<\/link>/i)?.[1] ?? '').trim();
            const d = clean((block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] ?? '')).slice(0, 300);
            if (t) items.push(`${items.length + 1}. ${t}${l ? `\n   ${l}` : ''}${d ? `\n   ${d}` : ''}`);
          }
          triggerContent = items.length
            ? `RSS Feed: ${cfg.rss_url}\nFetched at ${new Date().toLocaleString()}\nLatest ${items.length} item(s):\n\n${items.join('\n\n')}`
            : `RSS feed returned no items at ${new Date().toLocaleString()}.`;
        }
      } catch (_e) { /* RSS fetch failed */ }
    }

    // ── Schedule + GitHub data source ─────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'schedule' && cfg.data_source === 'github' && cfg.github_repo) {
      try {
        const ghCred = await credentialStore.get('github').catch(() => null);
        const headers: Record<string, string> = { 'User-Agent': 'adris.tech/1.0', Accept: 'application/vnd.github+json' };
        if (ghCred?.api_key) headers['Authorization'] = `Bearer ${ghCred.api_key}`;
        const event = cfg.github_event ?? 'pull_request';
        const urls: Record<string, string> = {
          pull_request: `https://api.github.com/repos/${cfg.github_repo}/pulls?state=open&per_page=5`,
          issue:        `https://api.github.com/repos/${cfg.github_repo}/issues?state=open&per_page=5`,
          push:         `https://api.github.com/repos/${cfg.github_repo}/commits?per_page=5`,
          release:      `https://api.github.com/repos/${cfg.github_repo}/releases?per_page=3`,
        };
        const ghUrl = urls[event] ?? urls.pull_request;
        const ghRaw = await invoke<string>('krew_http_call', { method: 'GET', url: ghUrl, headers, body: null }).catch(() => '[]');
        const ghData = JSON.parse(ghRaw) as { title?: string; body?: string; message?: string; html_url?: string }[];
        if (Array.isArray(ghData) && ghData.length) {
          triggerContent = `GitHub ${event} digest — ${cfg.github_repo} (${new Date().toLocaleString()}):\n\n` +
            ghData.slice(0, 5).map((item, i) =>
              `${i + 1}. ${item.title || item.message || ''}\n   ${item.html_url ?? ''}\n   ${(item.body || '').slice(0, 200)}`
            ).join('\n\n');
        } else {
          triggerContent = `No GitHub ${event}s found for ${cfg.github_repo} at ${new Date().toLocaleString()}.`;
        }
      } catch (_e) { /* GitHub fetch failed */ }
    }

    // ── Schedule + Google Calendar data source ────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'schedule' && cfg.data_source === 'calendar') {
      try {
        const calCred = await credentialStore.get('google_calendar').catch(() => null);
        if (calCred?.access_token) {
          const calId = cfg.calendar_id ?? 'primary';
          const now = new Date().toISOString();
          const lookahead = (cfg.lookahead_mins ?? 480) * 60_000;
          const later = new Date(Date.now() + lookahead).toISOString();
          const calUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${now}&timeMax=${later}&singleEvents=true&orderBy=startTime&maxResults=10`;
          const calRaw = await invoke<string>('krew_http_call', { method: 'GET', url: calUrl, headers: { Authorization: `Bearer ${calCred.access_token}` }, body: null })
            .catch(async (e) => { await emitDeliveryError('Google Calendar', e); return '{}'; });
          const calData = JSON.parse(calRaw) as { items?: { summary?: string; start?: { dateTime?: string; date?: string }; description?: string; location?: string }[] };
          if (calData.items?.length) {
            triggerContent = `Calendar events for today (${new Date().toLocaleDateString()}):\n\n` +
              calData.items.slice(0, 10).map((ev, i) =>
                `${i + 1}. ${ev.summary ?? 'Untitled'}\n   Time: ${ev.start?.dateTime ?? ev.start?.date ?? 'All day'}${ev.location ? `\n   Location: ${ev.location}` : ''}${ev.description ? `\n   ${ev.description.slice(0, 150)}` : ''}`
              ).join('\n\n');
          } else {
            triggerContent = `No calendar events in the next ${cfg.lookahead_mins ?? 480} minutes at ${new Date().toLocaleString()}.`;
          }
        } else {
          triggerContent = `Google Calendar not connected. Connect it in Connect Apps.`;
        }
      } catch (_e) { /* Calendar fetch failed */ }
    }

    // ── File watch — read actual file content from Rust-provided path ────────
    if (automation.trigger_type === 'file_watch') {
      if (overrideContext && overrideContext.match(/\.[a-zA-Z0-9]{1,6}$/)) {
        // overrideContext is a file path sent by Rust — read the file content
        try {
          const fileContent = await invoke<string>('read_file', { path: overrideContext }).catch(() => null);
          if (fileContent && fileContent.trim()) {
            triggerContent = `File added: ${overrideContext}\n\nContents:\n${fileContent.slice(0, 8000)}`;
          } else {
            triggerContent = `File added: ${overrideContext}\n(File is empty or could not be read.)`;
          }
        } catch (_e) {
          triggerContent = `File added: ${overrideContext}\n(Could not read file content.)`;
        }
      } else if (!overrideContext) {
        triggerContent = `File watch active on folder: ${cfg.folder || '(no folder set)'}. Drop a file in the folder to trigger processing.`;
      }
    }

    // ── X (Twitter) mention trigger ───────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'twitter_mention') {
      try {
        const tw = await credentialStore.get('twitter').catch(() => null);
        if (tw?.api_key && tw?.api_secret && tw?.access_token && tw?.access_token_secret) {
          const meUrl     = 'https://api.twitter.com/2/users/me';
          const meAuthHdr = await buildTwitterOAuthHeader('GET', meUrl, {}, tw.api_key, tw.api_secret, tw.access_token, tw.access_token_secret);
          const meRes     = JSON.parse(await invoke<string>('krew_http_call', { method: 'GET', url: meUrl, headers: { Authorization: meAuthHdr }, body: null }).catch(() => '{}')) as { data?: { id?: string } };
          const uid       = meRes.data?.id ?? '';
          if (uid) {
            const mentionUrl = `https://api.twitter.com/2/users/${uid}/mentions?max_results=10&tweet.fields=created_at,author_id,text,conversation_id`;
            const mentionHdr = await buildTwitterOAuthHeader('GET', mentionUrl, {}, tw.api_key, tw.api_secret, tw.access_token, tw.access_token_secret);
            const mentionRaw = await invoke<string>('krew_http_call', { method: 'GET', url: mentionUrl, headers: { Authorization: mentionHdr }, body: null }).catch(() => '{}');
            const mentionData = JSON.parse(mentionRaw) as { data?: { text?: string; author_id?: string; id?: string; created_at?: string }[] };
            if (mentionData.data?.length) {
              const filter = cfg.twitter_filter?.toLowerCase() ?? '';
              const filtered = filter
                ? mentionData.data.filter(t => t.text?.toLowerCase().includes(filter))
                : mentionData.data;
              if (filtered.length) {
                triggerContent = `Latest X mentions (${filtered.length}):\n` + filtered.map(t =>
                  `- Tweet ID: ${t.id} | Author: ${t.author_id} | Time: ${t.created_at}\n  Text: "${t.text}"`
                ).join('\n');
              }
            }
          }
        } else {
          triggerContent = `X/Twitter not connected — no credentials found. Connect X in Connect Apps to use this trigger.`;
        }
      } catch (_e) { /* X not connected */ }
    }

    // ── RSS feed trigger ──────────────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'rss' && cfg.rss_url) {
      try {
        const rssRaw = await invoke<string>('krew_http_call', {
          method: 'GET', url: cfg.rss_url,
          headers: { 'User-Agent': 'adris.tech/1.0' }, body: null,
        }).catch(() => '');
        if (rssRaw) {
          // Extract multiple <item> or <entry> blocks
          const clean = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
          const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
          const seenKey = `nv-rss-seen-${automation.id}`;
          let seenIds: string[] = [];
          try { seenIds = JSON.parse(localStorage.getItem(seenKey) ?? '[]'); } catch { seenIds = []; }
          const allItems: { id: string; text: string }[] = [];
          let itemMatch: RegExpExecArray | null;
          while ((itemMatch = itemRegex.exec(rssRaw)) && allItems.length < 10) {
            const block = itemMatch[1];
            const t = clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
            const l = (block.match(/<link[^>]*>(https?:[^<]*)<\/link>/i)?.[1] ?? '').trim();
            const d = clean((block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1] ?? '')).slice(0, 300);
            if (t) {
              const itemId = (t + l).slice(0, 50);
              const itemText = `${allItems.length + 1}. ${t}${l ? `\n   ${l}` : ''}${d ? `\n   ${d}` : ''}`;
              allItems.push({ id: itemId, text: itemText });
            }
          }
          const newItems = allItems.filter(item => !seenIds.includes(item.id));
          if (newItems.length) {
            triggerContent = `RSS Feed: ${cfg.rss_url}\nLatest ${newItems.length} new item(s):\n\n${newItems.map(i => i.text).join('\n\n')}`;
            const updatedSeen = [...seenIds, ...newItems.map(i => i.id)].slice(-50);
            try { localStorage.setItem(seenKey, JSON.stringify(updatedSeen)); } catch { /* quota */ }
          }
        }
      } catch (_e) { /* RSS fetch failed */ }
    }
    // ── GitHub trigger ────────────────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'github' && cfg.github_repo) {
      try {
        const ghCred = await credentialStore.get('github').catch(() => null);
        const headers: Record<string, string> = {
          'User-Agent': 'adris.tech/1.0',
          'Accept': 'application/vnd.github+json',
        };
        if (ghCred?.api_key) headers['Authorization'] = `Bearer ${ghCred.api_key}`;
        const event = cfg.github_event ?? 'pull_request';
        let ghUrl = '';
        if (event === 'pull_request') ghUrl = `https://api.github.com/repos/${cfg.github_repo}/pulls?state=open&per_page=5`;
        else if (event === 'issue')   ghUrl = `https://api.github.com/repos/${cfg.github_repo}/issues?state=open&per_page=5`;
        else if (event === 'push')    ghUrl = `https://api.github.com/repos/${cfg.github_repo}/commits?per_page=5`;
        else if (event === 'release') ghUrl = `https://api.github.com/repos/${cfg.github_repo}/releases?per_page=3`;
        if (ghUrl) {
          const ghRaw = await invoke<string>('krew_http_call', { method: 'GET', url: ghUrl, headers, body: null }).catch(() => '[]');
          const ghData = JSON.parse(ghRaw) as { title?: string; body?: string; message?: string; html_url?: string }[];
          if (Array.isArray(ghData) && ghData.length) {
            triggerContent = `GitHub ${event} — ${cfg.github_repo}:\n` + ghData.slice(0, 3).map((item, i) =>
              `${i + 1}. ${item.title || item.message || ''}\n   ${item.html_url ?? ''}\n   ${(item.body || '').slice(0, 200)}`
            ).join('\n');
          }
        }
      } catch (_e) { /* GitHub fetch failed */ }
    }

    // ── Canvas flow trigger ──────────────────────────────────────────────────
    if (automation.trigger_type === 'canvas_flow') {
      triggerContent = overrideContext || `Canvas flow triggered at ${new Date().toLocaleString()}. Run your automation steps on the canvas data provided by the user.`;
    }

    // ── Stripe trigger (server-side only — throws) ───────────────────────────
    if (!overrideContext && automation.trigger_type === 'stripe') {
      throw new Error('Stripe triggers require a server-side webhook endpoint and cannot run from the desktop app. Remove this automation or switch to a schedule trigger that checks Stripe via API.');
    }
        // ── Google Calendar trigger ───────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'google_calendar') {
      try {
        const gcalCred = await credentialStore.get('google_calendar').catch(() => null);
        if (gcalCred?.access_token) {
          const lookahead = cfg.lookahead_mins ?? 30;
          const now = new Date();
          const timeMin = now.toISOString();
          const timeMax = new Date(now.getTime() + lookahead * 60 * 1000).toISOString();
          const calId = encodeURIComponent(cfg.calendar_id ?? 'primary');
          const gcalRaw = await invoke<string>('krew_http_call', {
            method: 'GET',
            url: `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=5`,
            headers: { 'Authorization': `Bearer ${gcalCred.access_token}` },
            body: null,
          }).catch(() => '{}');
          const gcalData = JSON.parse(gcalRaw) as { items?: { summary?: string; description?: string; start?: { dateTime?: string }; htmlLink?: string }[] };
          if (gcalData.items?.length) {
            triggerContent = `Google Calendar — upcoming events:\n` + gcalData.items.map((ev, i) =>
              `${i + 1}. ${ev.summary ?? 'Untitled'}\n   Starts: ${ev.start?.dateTime ?? ''}\n   ${(ev.description ?? '').slice(0, 200)}`
            ).join('\n');
          }
        }
      } catch (_e) { /* Calendar fetch failed */ }
    }

    // ── Notion CRM pre-fetch (inject records as context before AI runs) ─────────
    let crmContext = '';
    if (!overrideContext) {
      try {
        const notionCred = await credentialStore.get('notion').catch(() => null);
        if (notionCred?.token) {
          const headers = { 'Authorization': `Bearer ${notionCred.token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };

          // Resolve the database ID: prefer explicit URL, fall back to auto-discover "adris.tech Automations"
          let dbId = '';
          if (cfg.notion_crm_db) {
            const urlMatch = cfg.notion_crm_db.match(/([a-f0-9]{32})/i);
            dbId = urlMatch ? urlMatch[1] : '';
          }
          if (!dbId) {
            // Auto-discover the "adris.tech Automations" database created by the notion output step
            const searchRaw = await invoke<string>('krew_http_call', {
              method: 'POST', url: 'https://api.notion.com/v1/search',
              headers, body: JSON.stringify({ query: 'adris.tech Automations', filter: { value: 'database', property: 'object' } }),
            }).catch(() => '{}');
            const searchData = JSON.parse(searchRaw) as { results?: { id?: string }[] };
            const found = searchData.results?.[0]?.id;
            if (found) dbId = found.replace(/-/g, '');
          }

          if (dbId) {
            const crmRaw = await invoke<string>('krew_http_call', {
              method: 'POST',
              url:    `https://api.notion.com/v1/databases/${dbId}/query`,
              headers,
              body:   JSON.stringify({ page_size: 30, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }),
            }).catch(() => '{}');
            const crmData = JSON.parse(crmRaw) as { results?: { properties?: Record<string, unknown> }[] };
            if (crmData.results?.length) {
              const rows = crmData.results.map((p, i) => {
                const props = p.properties ?? {};
                const getTitle = (v: unknown): string => {
                  if (!v || typeof v !== 'object') return '';
                  const arr = (v as Record<string, unknown>).title as { plain_text?: string }[] | undefined;
                  return arr?.[0]?.plain_text ?? '';
                };
                const getRich = (v: unknown): string => {
                  if (!v || typeof v !== 'object') return '';
                  const arr = (v as Record<string, unknown>).rich_text as { plain_text?: string }[] | undefined;
                  return arr?.[0]?.plain_text ?? '';
                };
                const getNum = (v: unknown): string => {
                  if (!v || typeof v !== 'object') return '0';
                  return String((v as Record<string, unknown>).number ?? 0);
                };
                const entries = Object.entries(props).map(([k, v]) => `${k}: ${getTitle(v) || getRich(v) || getNum(v)}`).filter(Boolean).join(' | ');
                return `${i + 1}. ${entries}`;
              }).join('\n');
              crmContext = `\n\n## Previous Automation Records (Notion — ${crmData.results.length} entries)\n${rows}\n\nDo NOT repeat topics, angles, or content already listed above.`;
            }
          }
        }
      } catch (_e) { /* Notion not connected or search failed */ }
    }

    // Guard: if triggerContent is empty (dedup skipped this run), bail early
    if (!triggerContent.trim()) return;

    // Chain steps: output of step N → input of step N+1
    const fullTriggerContext = triggerContent + crmContext;
    let stepInput = fullTriggerContext;
    let finalOutput = '';
    let totalTokens = 0;

    for (const step of steps) {
      const userMsg = `${knowledgeBlock}Task: ${step.prompt}\n\nContent to process:\n${stepInput}`;
      const systemMsg = `You are an AI automation assistant running the workflow "${automation.name}".${knowledgeRule} Return only the output — no explanations, no preamble.`;
      const result = await withRetry(() => callAutomationAI(userMsg, systemMsg), 3, 1500).catch(() => '');
      finalOutput = result;
      stepInput = result;
      totalTokens += Math.round((userMsg.length + result.length) / 4);
    }

    // ── Deliver output for the last step ──────────────────────────────────
    const lastStep = steps[steps.length - 1];
    const oc = lastStep?.output_config ?? {};

    // ── Desktop notification ──────────────────────────────────────────────
    if (lastStep?.output === 'notification' && finalOutput) {
      const title = oc.notif_title || automation.name;
      const body  = finalOutput.slice(0, 300);
      try {
        if (typeof Notification !== 'undefined') {
          const perm = Notification.permission === 'default'
            ? await Notification.requestPermission()
            : Notification.permission;
          if (perm === 'granted') {
            new Notification(title, { body, silent: false });
          }
        }
      } catch (_e) { /* Notification API not available */ }
      // Also emit in-app event so AutomationModule can show a toast
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('automation-notification', { title, body });
      } catch (_e) { /* ignore */ }
    }

    // ── Email reply / send ────────────────────────────────────────────────────
    if (lastStep?.output === 'email_reply' && finalOutput) {
      try {
        const goCred = await credentialStore.get('google').catch(() => null);
        const accessToken = goCred?.access_token ?? '';
        if (accessToken) {
          // Resolve recipient: explicit address or extract sender from trigger content
          let toAddr = oc.email_to ?? '';
          if (!toAddr || toAddr === 'sender') {
            const fromMatch = triggerContent.match(/From:\s*([^\s<]+@[^\s>]+)/i);
            toAddr = fromMatch ? fromMatch[1].replace(/[<>]/g, '') : '';
          }
          if (toAddr && toAddr !== 'sender') {
            const subject = `Re: ${automation.name}`;
            const rawEmail = [
              `To: ${toAddr}`,
              `Subject: ${subject}`,
              `Content-Type: text/plain; charset=utf-8`,
              '',
              finalOutput.slice(0, 2000),
            ].join('\r\n');
            const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            await invoke('krew_http_call', {
              method: 'POST',
              url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw: encoded }),
            }).catch(e => emitDeliveryError('Gmail', e));
          }
        }
      } catch (_e) { /* Google not connected */ }
    }

    if (lastStep?.output === 'file' && oc.file_path && finalOutput) {
      const separator = `\n\n---\n${new Date().toLocaleString()}\n\n`;
      const content   = oc.file_append ? separator + finalOutput : finalOutput;
      await invoke('write_file', { path: oc.file_path, content }).catch(() => {});
    }

    if ((lastStep?.output === 'twitter_post' || lastStep?.output === 'twitter_reply') && finalOutput) {
      try {
        const tw = await credentialStore.get('twitter').catch(() => null);
        if (tw?.api_key && tw?.api_secret && tw?.access_token && tw?.access_token_secret) {
          const text: string = finalOutput.slice(0, 280);
          const body: Record<string, unknown> = { text };
          if (lastStep.output === 'twitter_reply' && oc.twitter_reply_to_id) {
            body.reply = { in_reply_to_tweet_id: oc.twitter_reply_to_id };
          }
          const url     = 'https://api.twitter.com/2/tweets';
          const authHdr = await buildTwitterOAuthHeader('POST', url, {}, tw.api_key, tw.api_secret, tw.access_token, tw.access_token_secret);
          await invoke('krew_http_call', {
            method:  'POST',
            url,
            headers: { Authorization: authHdr, 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
          }).catch(() => {});
        }
      } catch (_e) { /* credentials missing or API error — run still logged */ }
    }

    if (lastStep?.output === 'linkedin_post' && finalOutput) {
      try {
        const li = await credentialStore.get('linkedin').catch(() => null);
        if (li?.access_token) {
          const liHeaders = {
            'Authorization':             `Bearer ${li.access_token}`,
            'Content-Type':              'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          };
          const meRaw     = await invoke<string>('krew_http_call', { method: 'GET', url: 'https://api.linkedin.com/v2/me', headers: liHeaders, body: null })
            .catch(async (e) => { await emitDeliveryError('LinkedIn', e); return '{}'; });
          const meData    = JSON.parse(meRaw) as { id?: string; message?: string; status?: number };
          if (meData.status === 401 || meData.status === 403 || meData.message?.toLowerCase().includes('expired')) {
            await emitDeliveryError('LinkedIn', `${meData.status} ${meData.message ?? ''}`);
          } else {
          const personUrn = oc.linkedin_person_urn ?? `urn:li:person:${meData.id ?? ''}`;
          const vis       = oc.linkedin_visibility ?? 'PUBLIC';
          await invoke('krew_http_call', {
            method:  'POST',
            url:     'https://api.linkedin.com/v2/ugcPosts',
            headers: liHeaders,
            body:    JSON.stringify({
              author: personUrn,
              lifecycleState: 'PUBLISHED',
              specificContent: {
                'com.linkedin.ugc.ShareContent': {
                  shareCommentary:    { text: finalOutput },
                  shareMediaCategory: 'NONE',
                },
              },
              visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': vis },
            }),
          }).catch(e => emitDeliveryError('LinkedIn', e));
          }
        }
      } catch (_e) { /* credentials missing — run still logged */ }
    }

    if (lastStep?.output === 'slack' && oc.slack_channel && finalOutput) {
      try {
        const sl = await credentialStore.get('slack').catch(() => null);
        if (sl?.bot_token) {
          await invoke('krew_http_call', {
            method:  'POST',
            url:     'https://slack.com/api/chat.postMessage',
            headers: { 'Authorization': `Bearer ${sl.bot_token}`, 'Content-Type': 'application/json; charset=utf-8' },
            body:    JSON.stringify({ channel: oc.slack_channel, text: finalOutput }),
          }).catch(() => {});
        }
      } catch (_e) { /* Slack not connected */ }
    }

    if (lastStep?.output === 'discord' && oc.discord_webhook && finalOutput) {
      await invoke('krew_http_call', {
        method: 'POST',
        url: oc.discord_webhook,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: finalOutput.slice(0, 2000) }),
      }).catch(() => {});
    }

    if (lastStep?.output === 'google_sheets' && finalOutput) {
      try {
        const gsCred = await credentialStore.get('google_drive').catch(() => null);
        if (gsCred?.access_token) {
          // Auto-provision spreadsheet if no sheet_id provided
          let sheetId = oc.sheet_id ?? '';
          if (!sheetId) sheetId = await ensureGoogleSheet(gsCred.access_token, automation.name).catch(() => '');
          if (sheetId) {
            const sheetName = oc.sheet_name ?? automation.name.slice(0, 100);
            await invoke('krew_http_call', {
              method: 'POST',
              url: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(sheetName)}!A1:append?valueInputOption=USER_ENTERED`,
              headers: { 'Authorization': `Bearer ${gsCred.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ values: [[new Date().toLocaleString(), automation.name, finalOutput.slice(0, 500)]] }),
            }).catch(e => emitDeliveryError('Google Sheets', e));
          }
        }
      } catch (_e) { /* Google Sheets not connected */ }
    }

    if (lastStep?.output === 'twilio_sms' && oc.sms_to && finalOutput) {
      try {
        const twilioCred = await credentialStore.get('twilio').catch(() => null);
        if (twilioCred?.account_sid && twilioCred?.auth_token && twilioCred?.from_number) {
          const auth = btoa(`${twilioCred.account_sid}:${twilioCred.auth_token}`);
          const body = new URLSearchParams({
            To: oc.sms_to,
            From: twilioCred.from_number,
            Body: finalOutput.slice(0, 1600),
          }).toString();
          await invoke('krew_http_call', {
            method: 'POST',
            url: `https://api.twilio.com/2010-04-01/Accounts/${twilioCred.account_sid}/Messages.json`,
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          }).catch(() => {});
        }
      } catch (_e) { /* Twilio not connected */ }
    }

    if (lastStep?.output === 'telegram' && oc.telegram_chat_id && finalOutput) {
      try {
        const tgCred = await credentialStore.get('telegram').catch(() => null);
        if (tgCred?.bot_token) {
          await invoke('krew_http_call', {
            method: 'POST',
            url: `https://api.telegram.org/bot${tgCred.bot_token}/sendMessage`,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: oc.telegram_chat_id, text: finalOutput.slice(0, 4096) }),
          }).catch(() => {});
        }
      } catch (_e) { /* Telegram not connected */ }
    }

    if (lastStep?.output === 'hubspot' && finalOutput) {
      try {
        const hubCred = await credentialStore.get('hubspot').catch(() => null);
        if (hubCred?.api_key) {
          const action = oc.hubspot_action ?? 'create_contact';
          const headers = { 'Authorization': `Bearer ${hubCred.api_key}`, 'Content-Type': 'application/json' };
          if (action === 'create_contact') {
            const emailMatch = finalOutput.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
            const email = emailMatch ? emailMatch[0] : `auto-${Date.now()}@unknown.com`;
            await invoke('krew_http_call', {
              method: 'POST',
              url: 'https://api.hubapi.com/crm/v3/objects/contacts',
              headers,
              body: JSON.stringify({ properties: { email, notes_last_activity: finalOutput.slice(0, 500) } }),
            }).catch(() => {});
          } else if (action === 'add_note') {
            await invoke('krew_http_call', {
              method: 'POST',
              url: 'https://api.hubapi.com/crm/v3/objects/notes',
              headers,
              body: JSON.stringify({ properties: { hs_note_body: finalOutput.slice(0, 1000), hs_timestamp: Date.now().toString() } }),
            }).catch(() => {});
          }
        }
      } catch (_e) { /* HubSpot not connected */ }
    }

    if (lastStep?.output === 'notion' && finalOutput) {
      try {
        const no = await credentialStore.get('notion').catch(() => null);
        const notionToken = no?.access_token ?? no?.token ?? '';
        if (notionToken) {
          const isOAuth = no?.token_type === 'oauth';
          const notionHeaders = { 'Authorization': `Bearer ${notionToken}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
          // Auto-provision DB if no URL provided
          let dbId = oc.notion_db_url?.match(/([a-f0-9]{32})/i)?.[1] ?? '';
          if (!dbId) dbId = await ensureNotionDatabase(notionToken, automation.name, isOAuth).catch(() => '');
          if (dbId) {
            await invoke('krew_http_call', {
              method:  'POST',
              url:     'https://api.notion.com/v1/pages',
              headers: notionHeaders,
              body:    JSON.stringify({
                parent: { database_id: dbId },
                properties: {
                  Name:    { title: [{ text: { content: automation.name + ' — ' + new Date().toLocaleDateString() } }] },
                  Source:  { select: { name: automation.name } },
                  Date:    { date: { start: new Date().toISOString().slice(0, 10) } },
                  Status:  { select: { name: 'New' } },
                },
                children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: finalOutput.slice(0, 2000) } }] } }],
              }),
            }).catch(() => {});
          }
        }
      } catch (_e) { /* Notion not connected */ }
    }

    await invoke('automation_log_run', {
      runId,
      automationId: automation.id,
      userId,
      status: finalOutput ? 'success' : 'failed',
      tokensUsed: totalTokens,
      outputSummary: finalOutput ? finalOutput.slice(0, 500) : null,
      error: finalOutput ? null : 'AI returned empty. Check your API key in Connect Apps.',
    });

    // Auto-delete temp automations after max_runs
    if (cfg.is_temp && automation.run_count + 1 >= (cfg.max_runs ?? 1)) {
      setTimeout(async () => {
        await invoke('automation_delete', { id: automation.id }).catch(() => {});
      }, 3000);
    }
  } catch (e) {
    await invoke('automation_log_run', {
      runId,
      automationId: automation.id,
      userId,
      status: 'failed',
      tokensUsed: 0,
      outputSummary: null,
      error: String(e),
    }).catch(() => {});
  }
}

