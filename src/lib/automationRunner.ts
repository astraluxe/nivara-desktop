import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { credentialStore } from './krewDb';
import { buildTwitterOAuthHeader } from './krewTools';

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
  } catch { /* no credentials — fall back to local */ }

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
      baseUrl: null, sessionToken: null,
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
      } catch { /* file not found */ }
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
          if (emails && !emails.startsWith('No emails')) triggerContent = emails;
        }
      } catch { /* Gmail not connected */ }
    }

    if (!overrideContext && automation.trigger_type === 'file_watch' && cfg.folder) {
      triggerContent = `Files monitored in: ${cfg.folder}`;
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
        }
      } catch { /* X not connected */ }
    }

    // ── RSS feed trigger ──────────────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'rss' && cfg.rss_url) {
      try {
        const rssRaw = await invoke<string>('krew_http_call', {
          method: 'GET', url: cfg.rss_url,
          headers: { 'User-Agent': 'adris.tech/1.0' }, body: null,
        }).catch(() => '');
        if (rssRaw) {
          const titleMatch = rssRaw.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
          const descMatch  = rssRaw.match(/<description[^>]*>([\s\S]{1,1000})<\/description>/i);
          const linkMatch  = rssRaw.match(/<link[^>]*>(https?:[^<]{1,300})<\/link>/i);
          const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
          const desc  = descMatch  ? descMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 800) : '';
          const link  = linkMatch  ? linkMatch[1].trim() : cfg.rss_url;
          if (title) triggerContent = `RSS: ${title}\nURL: ${link}\n\n${desc}`;
        }
      } catch { /* RSS fetch failed */ }
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
      } catch { /* GitHub fetch failed */ }
    }

    // ── Stripe trigger ────────────────────────────────────────────────────────
    if (!overrideContext && automation.trigger_type === 'stripe') {
      try {
        const stripeCred = await credentialStore.get('stripe').catch(() => null);
        if (stripeCred?.api_key) {
          const eventType = cfg.stripe_event ?? 'payment_intent.succeeded';
          const stripeRaw = await invoke<string>('krew_http_call', {
            method: 'GET',
            url: `https://api.stripe.com/v1/events?type=${eventType}&limit=3`,
            headers: { 'Authorization': `Bearer ${stripeCred.api_key}` },
            body: null,
          }).catch(() => '{}');
          const stripeData = JSON.parse(stripeRaw) as { data?: { object?: Record<string, unknown> }[] };
          if (stripeData.data?.length) {
            const event = stripeData.data[0].object ?? {};
            triggerContent = `Stripe ${eventType}:\n${JSON.stringify(event, null, 2).slice(0, 1000)}`;
          }
        }
      } catch { /* Stripe fetch failed */ }
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
      } catch { /* Calendar fetch failed */ }
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
      } catch { /* Notion not connected or search failed */ }
    }

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
      } catch { /* credentials missing or API error — run still logged */ }
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
          const meRaw     = await invoke<string>('krew_http_call', { method: 'GET', url: 'https://api.linkedin.com/v2/me', headers: liHeaders, body: null }).catch(() => '{}');
          const meData    = JSON.parse(meRaw) as { id?: string };
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
          }).catch(() => {});
        }
      } catch { /* credentials missing — run still logged */ }
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
      } catch { /* Slack not connected */ }
    }

    if (lastStep?.output === 'reddit_post' && oc.reddit_subreddit && finalOutput) {
      try {
        const rd = await credentialStore.get('reddit').catch(() => null);
        if (rd?.client_id && rd?.client_secret && rd?.username && rd?.password) {
          const title = oc.reddit_post_title || finalOutput.split('\n')[0].slice(0, 300);
          const text  = oc.reddit_post_title ? finalOutput : finalOutput.split('\n').slice(1).join('\n').trim() || finalOutput;
          await invoke('reddit_post', {
            subreddit:    oc.reddit_subreddit,
            title,
            text:         text.slice(0, 40000),
            clientId:     rd.client_id,
            clientSecret: rd.client_secret,
            username:     rd.username,
            password:     rd.password,
          }).catch(() => {});
        }
      } catch { /* Reddit not connected */ }
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
            }).catch(() => {});
          }
        }
      } catch { /* Google Sheets not connected */ }
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
      } catch { /* Twilio not connected */ }
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
      } catch { /* Telegram not connected */ }
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
      } catch { /* HubSpot not connected */ }
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
      } catch { /* Notion not connected */ }
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
