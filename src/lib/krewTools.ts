import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { krewMemoryDb } from './krewDb';

// ─── Browser text cleaner (strips JSON-LD blobs, ads, cookie banners, nav noise) ─
function cleanBrowserText(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let blanks = 0;

  const skipPatterns = [
    /\b(advertisement|sponsored content?|promoted|ad choices|ad by)\b/i,
    /^(accept\s+(all\s+)?(cookies?|tracking)|decline\s+(all|cookies?)|manage\s+(cookie\s+)?preferences?|cookie\s+(policy|settings?|consent|notice|banner)|this\s+site\s+uses\s+cookies?|we\s+(value\s+your\s+privacy|use\s+cookies?))/i,
    /^(subscribe\s+to\s+(our|the)\s+(newsletter|updates?|news)|sign\s+up\s+for\s+(our|the|free)\s+(newsletter|updates?)|join\s+[\d,]+\s*(million|thousand|k\+)?\s*(users?|members?|subscribers?|readers?))/i,
    /^\s*©\s*\d{4}/,
    /^(privacy\s+policy|terms\s+of\s+(service|use)|cookie\s+policy|accessibility\s+statement|do\s+not\s+sell(\s+my\s+data)?)\s*$/i,
    /^(click\s+here|read\s+more|show\s+more|load\s+more|see\s+all|view\s+all|see\s+more)\s*$/i,
    /^(share\s+this\s+(article|post|story)|follow\s+us\s+on|trending\s+now|you\s+may\s+also\s+like|recommended\s+for\s+you|related\s+articles?)\s*$/i,
    /^\s*\[?skip\s+(to\s+)?(main\s+)?(content|navigation|footer)\]?\s*$/i,
    /^(back\s+to\s+top|scroll\s+to\s+top)\s*$/i,
    /^(enable\s+(javascript|js)|your\s+browser\s+does\s+not\s+support)\s*/i,
  ];

  for (const line of lines) {
    const t = line.trim();
    if (!t) { blanks++; if (blanks <= 1) out.push(''); continue; }
    blanks = 0;
    if (t.startsWith('{') || t.startsWith('[{')) continue;
    if (t.includes('"@type"') || t.includes('"@context"')) continue;
    if (t.length < 4 && !/^\d/.test(t)) continue;
    if (skipPatterns.some(p => p.test(t))) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// ─── Browser action permissions ───────────────────────────────────────────────
const BROWSER_PERMS_KEY = 'nv-browser-perms-v1';

function getBrowserPerms(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(BROWSER_PERMS_KEY) ?? '{}'); }
  catch { return {}; }
}

export function setBrowserAlwaysAllow(actionType: string): void {
  const p = getBrowserPerms(); p[actionType] = true;
  localStorage.setItem(BROWSER_PERMS_KEY, JSON.stringify(p));
}

export function clearBrowserPermissions(): void {
  localStorage.removeItem(BROWSER_PERMS_KEY);
}

function hasAlwaysAllow(actionType: string): boolean {
  return !!getBrowserPerms()[actionType];
}

async function requestBrowserApproval(actionType: string, description: string): Promise<boolean> {
  if (hasAlwaysAllow(actionType)) return true;

  const reqId = Math.random().toString(36).slice(2, 9);
  let resolveApproval!: (v: boolean) => void;
  const approvalPromise = new Promise<boolean>((r) => { resolveApproval = r; });

  const unlisten = await listen<{ id: string; approved: boolean; always: boolean }>(
    'nv-browser-approval-response',
    (event) => {
      if (event.payload.id !== reqId) return;
      unlisten();
      if (event.payload.always && event.payload.approved) setBrowserAlwaysAllow(actionType);
      resolveApproval(event.payload.approved);
    },
  );

  const timeout = setTimeout(() => { unlisten(); resolveApproval(false); }, 90_000);
  await emit('nv-browser-approval-request', { id: reqId, actionType, description });
  const result = await approvalPromise;
  clearTimeout(timeout);
  return result;
}

const CONSEQUENTIAL_RE = /\b(send|submit|post|publish|tweet|buy|purchase|pay|checkout|delete|remove|trash|book\s+now|place\s+order|confirm\s+payment)\b/i;

function classifyAction(text: string): string {
  const t = text.toLowerCase();
  if (/send|reply|forward/.test(t)) return 'send_email';
  if (/post|tweet|publish|share/.test(t)) return 'post_content';
  if (/buy|purchase|pay|checkout|order|book/.test(t)) return 'make_purchase';
  if (/delete|remove|trash/.test(t)) return 'delete_content';
  return 'submit_form';
}

// ─── Tool definition schema (sent to LLM in system prompt) ───────────────────

export interface ToolParam {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
}

// ─── Automation tools (always available — bound to user's automation DB) ─────

export const AUTOMATION_TOOLS: ToolDef[] = [
  {
    name: 'list_automations',
    description: 'List all saved automations with their name, trigger type, enabled status, run count, and last run time.',
    parameters: {},
  },
  {
    name: 'run_automation_now',
    description: 'Immediately run a specific automation by its ID. Use list_automations first to get IDs.',
    parameters: {
      automation_id: { type: 'string', description: 'The ID of the automation to run.', required: true },
    },
  },
  {
    name: 'toggle_automation',
    description: 'Enable or disable an automation by its ID.',
    parameters: {
      automation_id: { type: 'string', description: 'The automation ID.', required: true },
      enabled:       { type: 'boolean', description: 'true to enable, false to disable.', required: true },
    },
  },
];

// ─── System tools (always available) ─────────────────────────────────────────

export const SYSTEM_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read the full contents of any file on the user\'s machine.',
    parameters: {
      path: { type: 'string', description: 'Absolute file path to read.', required: true },
    },
  },
  {
    name: 'execute_terminal',
    description: 'Run a shell command on the user\'s machine and return stdout + stderr. Runs silently in the background — no window opens.',
    parameters: {
      command: { type: 'string', description: 'Shell command to execute.', required: true },
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information, news, prices, facts. Uses Brave API if connected (fastest). Otherwise opens DuckDuckGo silently — no key needed. Use this for gathering information only, NOT for doing tasks on websites.',
    parameters: {
      query: { type: 'string', description: 'Search query.', required: true },
    },
  },
  {
    name: 'get_exchange_rate',
    description: 'Get a live currency exchange rate. Use this for any USD/INR, EUR/INR or other conversion — do NOT use web_search for exchange rates, always use this tool instead.',
    parameters: {
      base:   { type: 'string', description: 'Base currency code, e.g. "USD"', required: true },
      target: { type: 'string', description: 'Target currency code, e.g. "INR"', required: true },
    },
  },
  {
    name: 'save_memory',
    description: 'Save a persistent fact to your long-term memory. Recalled automatically in future sessions.',
    parameters: {
      key:   { type: 'string', description: 'Short unique label for this memory (e.g. "user_company", "preferred_tone").', required: true },
      value: { type: 'string', description: 'The value to remember.', required: true },
    },
  },
  {
    name: 'recall_memory',
    description: 'Look up a specific memory by key. Returns the stored value or "not found".',
    parameters: {
      key: { type: 'string', description: 'The memory key to retrieve.', required: true },
    },
  },
  {
    name: 'forget_memory',
    description: 'Delete a memory entry by key.',
    parameters: {
      key: { type: 'string', description: 'The memory key to delete.', required: true },
    },
  },
  {
    name: 'open_connect_apps',
    description: 'Open the Connect Apps panel in adris.tech so the user can link services. Use this when the user wants to connect any service or MCP server, or when a task fails because a service is not connected.',
    parameters: {},
  },
  {
    name: 'open_service_setup',
    description: 'Open the step-by-step setup guide for a specific service inside adris.tech — the app will navigate directly to that service\'s connection wizard. Use this to help users connect a specific service. Supported service IDs: gemini, openai, claude, brave, gmail, google, notion, slack, github, linkedin, twitter, instagram, stripe, discord, figma, airtable, reddit, shopify, serper, elevenlabs, heygen, did, higgsfield, runway, linear.',
    parameters: {
      service: { type: 'string', description: 'Service ID from the supported list, e.g. "gmail", "notion", "github"', required: true },
    },
  },
];

// ─── Research tools (open data sources, no auth required) ────────────────────

export const RESEARCH_TOOLS: ToolDef[] = [
  {
    name: 'research_companies',
    description: 'Search for companies/startups/businesses using multiple open data sources (Wikidata, Wikipedia, Yahoo Finance, GitHub) in parallel. Use this when user asks for a company list, startup database, market research, or wants to find target companies. Returns structured list with names, sectors, and sources.',
    parameters: {
      queries: { type: 'string', description: 'Semicolon-separated search queries to run in parallel. Example: "Indian SaaS startups;B2B software India;fintech startups India"', required: true },
      focus:   { type: 'string', description: 'Research focus: startups, listed, tech, saas, or all', required: false },
    },
  },
  {
    name: 'fetch_open_data',
    description: 'Fetch structured data from a public open API endpoint (no auth required). Use for government data, Wikipedia, financial data.',
    parameters: {
      url:         { type: 'string', description: 'Full URL to fetch', required: true },
      description: { type: 'string', description: 'What this data is for', required: true },
    },
  },
];

// ─── Browser tools (via agent-browser CLI — opens visible Chrome window) ─────

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_open',
    description: 'Open a URL in the user\'s own Chrome (they are already logged in to all accounts). Use to SHOW a website to the user or for interactive tasks.',
    parameters: {
      url: { type: 'string', description: 'Full URL', required: true },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Load a URL and return the page text. For public pages works without any login. For private pages (LinkedIn feed, Gmail) opens a login window — user logs in once, sessions saved forever. Use to READ content: notifications, inbox, articles, feeds.',
    parameters: {
      url: { type: 'string', description: 'Full URL to read', required: true },
    },
  },
  {
    name: 'read_browser_history',
    description: "Search the user's Chrome/Edge browsing history for URLs and page titles. Use this BEFORE asking the user for a URL or searching the web — e.g. to find their LinkedIn profile, GitHub, or any site they regularly visit. Much faster and always correct.",
    parameters: {
      query: { type: 'string', description: 'Keyword to search — site name, URL fragment, or topic (e.g. "linkedin", "github amogh", "notion workspace")', required: true },
    },
  },
  {
    name: 'browser_search',
    description: 'Search Google visually in a Chrome window the user can watch.',
    parameters: {
      query: { type: 'string', description: 'Search query', required: true },
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Get the accessibility tree of the current page — element refs (@e1, @e2, …) for clicking and filling. Call before browser_click to get fresh refs.',
    parameters: {},
  },
  {
    name: 'browser_click',
    description: 'Click an element. Use a ref from browser_snapshot (@e2) or a CSS selector.',
    parameters: {
      selector: { type: 'string', description: 'Ref (@e2) or CSS selector', required: true },
    },
  },
  {
    name: 'browser_fill',
    description: 'Clear a field and type text into it.',
    parameters: {
      selector: { type: 'string', description: 'Ref or CSS selector', required: true },
      text:     { type: 'string', description: 'Text to type', required: true },
    },
  },
  {
    name: 'browser_get_text',
    description: 'Get text from the current page or a specific element.',
    parameters: {
      selector: { type: 'string', description: 'CSS selector or ref. Omit for full page.', required: false },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot the current page. Returns the saved file path.',
    parameters: {},
  },
  {
    name: 'browser_close',
    description: 'Close the browser session.',
    parameters: {},
  },
  {
    name: 'browser_confirm',
    description: 'Ask user permission before a consequential action (send email, post content, purchase, delete, submit form). ALWAYS call this first. Be specific about what will happen.',
    parameters: {
      action_type: { type: 'string', description: 'send_email | post_content | make_purchase | delete_content | submit_form', required: true },
      description: { type: 'string', description: 'Exactly what you will do, e.g. "Send email to X with subject Y"', required: true },
    },
  },
];

// ─── Boss-only delegation tool ────────────────────────────────────────────────

export const BOSS_TOOLS: ToolDef[] = [
  {
    name: 'delegate_to_agent',
    description: 'Delegate a task to ONE specialist agent. Use this when the request clearly maps to a single specialist. Valid agent_key values:\n- caption_writer → social media captions (LinkedIn, Instagram, Twitter)\n- email_marketer → email campaigns, drip sequences, subject lines\n- cold_outreach → cold email/DM templates for sales prospecting\n- blog_writer → blog posts and articles\n- content_planner → content strategy, content calendars, growth content planning, organic marketing plan\n- seo_agent → SEO copy, keywords, meta descriptions\n- ad_copywriter → ad copy, paid acquisition strategy (Facebook, Google, LinkedIn ads)\n- social_scheduler → posting schedules and platform strategy\n- researcher → market research, growth strategy research, user acquisition research, competitor analysis, data gathering\n- competitor_watcher → deep competitor breakdowns, what competitors are doing for marketing, pricing and differentiation analysis\n- product_describer → product descriptions and landing page copy\n- coder → code writing, scripts, technical implementation\n- bug_hunter → debugging and error fixing\n- docs_writer → documentation and READMEs\n- data_analyst → data analysis and insights\n- proposal_writer → business proposals and pitches\n- cfo → ALL financial work: pricing strategy, revenue modelling, P&L, unit economics, affiliate commission structures, cost analysis, financial projections, profit breakdowns, budget planning — the dedicated CFO agent\n- translator → language translation\n- ops_agent → automation setup, listing automations, running/pausing automations, workflow management\n- automation_strategist → designing complex multi-step automation workflows\n- visual_creator → HTML/CSS visual assets: social banners, animated graphics, thumbnails, promo cards\n- research_agent → find companies, startup lists, market research, ICP research, lead generation',
    parameters: {
      agent_key: { type: 'string', description: 'Exact agent key from the list above (e.g. "cold_outreach", "caption_writer").', required: true },
      task:      { type: 'string', description: 'A clear, self-contained task description with all context the specialist needs.', required: true },
    },
  },
  {
    name: 'plan_workflow',
    description: 'Plan and execute a multi-agent workflow in ONE shot. Use this when the task genuinely needs 2-4 different specialists working in sequence. Do NOT use researcher as a mandatory first step — only include it if factual research is actually needed. Each agent receives the outputs of all previous agents as context in their task description.',
    parameters: {
      delegations: { type: 'string', description: 'JSON array of delegations in execution order: [{"agent_key":"researcher","task":"Research X"},{"agent_key":"blog_writer","task":"Using this research: {{prev}}, write a blog post about X"}]. Use {{prev}} as a placeholder where a previous agent\'s output should be inserted.', required: true },
    },
  },
];

// ─── Service tool definitions (registered only when service is connected) ────

const NOTION_TOOLS: ToolDef[] = [
  {
    name: 'notion_search',
    description: 'Search all pages and databases in the connected Notion workspace.',
    parameters: {
      query:      { type: 'string',  description: 'Search query.',                                required: true  },
      page_size:  { type: 'number',  description: 'Max results to return. Default 10.',           required: false },
    },
  },
  {
    name: 'notion_get_page',
    description: 'Fetch the full content of a Notion page by its ID.',
    parameters: {
      page_id: { type: 'string', description: 'Notion page UUID.', required: true },
    },
  },
  {
    name: 'notion_create_page',
    description: 'Create a new page inside a Notion parent page or database.',
    parameters: {
      parent_id: { type: 'string', description: 'Parent page or database UUID.', required: true },
      title:     { type: 'string', description: 'Page title.',                   required: true },
      content:   { type: 'string', description: 'Page body as plain text.',      required: false },
    },
  },
  {
    name: 'notion_query_database',
    description: 'Query rows from a Notion database with optional filter.',
    parameters: {
      database_id: { type: 'string', description: 'Database UUID.',                           required: true  },
      filter_json: { type: 'string', description: 'Notion filter object as JSON string.',     required: false },
      page_size:   { type: 'number', description: 'Max rows to return. Default 20.',          required: false },
    },
  },
];

const SLACK_TOOLS: ToolDef[] = [
  {
    name: 'slack_list_channels',
    description: 'List all public channels in the connected Slack workspace.',
    parameters: {},
  },
  {
    name: 'slack_send_message',
    description: 'Send a message to a Slack channel.',
    parameters: {
      channel: { type: 'string', description: 'Channel name (e.g. #general) or ID.', required: true },
      message: { type: 'string', description: 'Message text (supports Slack mrkdwn).', required: true },
    },
  },
  {
    name: 'slack_read_messages',
    description: 'Read the latest messages from a Slack channel.',
    parameters: {
      channel: { type: 'string', description: 'Channel name or ID.', required: true },
      limit:   { type: 'number', description: 'Number of messages. Default 20.',      required: false },
    },
  },
  {
    name: 'slack_search_messages',
    description: 'Search all messages in the workspace.',
    parameters: {
      query: { type: 'string', description: 'Search query.', required: true },
    },
  },
];

const GITHUB_TOOLS: ToolDef[] = [
  {
    name: 'github_list_repos',
    description: 'List all repositories accessible by the connected GitHub account.',
    parameters: {
      visibility: { type: 'string', description: '"all", "public", or "private". Default "all".', required: false },
    },
  },
  {
    name: 'github_get_file',
    description: 'Read a file from a GitHub repository.',
    parameters: {
      owner:  { type: 'string', description: 'Repository owner (user or org name).', required: true },
      repo:   { type: 'string', description: 'Repository name.',                     required: true },
      path:   { type: 'string', description: 'File path within the repo.',           required: true },
      branch: { type: 'string', description: 'Branch name. Default "main".',         required: false },
    },
  },
  {
    name: 'github_list_issues',
    description: 'List open issues in a GitHub repository.',
    parameters: {
      owner:  { type: 'string', description: 'Repository owner.', required: true },
      repo:   { type: 'string', description: 'Repository name.',  required: true },
      state:  { type: 'string', description: '"open" or "closed". Default "open".', required: false },
      limit:  { type: 'number', description: 'Max results. Default 20.',             required: false },
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a new issue in a GitHub repository.',
    parameters: {
      owner: { type: 'string', description: 'Repository owner.', required: true },
      repo:  { type: 'string', description: 'Repository name.',  required: true },
      title: { type: 'string', description: 'Issue title.',       required: true },
      body:  { type: 'string', description: 'Issue body (markdown supported).', required: false },
    },
  },
  {
    name: 'github_search_code',
    description: 'Search code across all accessible GitHub repositories.',
    parameters: {
      query: { type: 'string', description: 'Search query (supports GitHub code search syntax).', required: true },
    },
  },
];

const LINEAR_TOOLS: ToolDef[] = [
  {
    name: 'linear_get_issues',
    description: 'Fetch issues from a Linear team.',
    parameters: {
      team_key: { type: 'string', description: 'Linear team key (e.g. "ENG").',       required: false },
      state:    { type: 'string', description: '"active", "backlog", "completed" etc.', required: false },
      limit:    { type: 'number', description: 'Max issues to return. Default 20.',     required: false },
    },
  },
  {
    name: 'linear_create_issue',
    description: 'Create a new issue in Linear.',
    parameters: {
      team_id:     { type: 'string', description: 'Linear team UUID.',          required: true  },
      title:       { type: 'string', description: 'Issue title.',               required: true  },
      description: { type: 'string', description: 'Issue description (markdown).', required: false },
      priority:    { type: 'number', description: '0 = none, 1 = urgent, 2 = high, 3 = medium, 4 = low.', required: false },
    },
  },
];

const AIRTABLE_TOOLS: ToolDef[] = [
  {
    name: 'airtable_list_records',
    description: 'List records from an Airtable table.',
    parameters: {
      base_id:    { type: 'string', description: 'Airtable base ID (starts with "app").',  required: true  },
      table_name: { type: 'string', description: 'Table name or ID.',                      required: true  },
      filter:     { type: 'string', description: 'Airtable formula string for filtering.', required: false },
      limit:      { type: 'number', description: 'Max records. Default 20.',               required: false },
    },
  },
  {
    name: 'airtable_create_record',
    description: 'Create a new record in an Airtable table.',
    parameters: {
      base_id:    { type: 'string', description: 'Airtable base ID.', required: true },
      table_name: { type: 'string', description: 'Table name.',        required: true },
      fields:     { type: 'string', description: 'JSON object of field name → value.', required: true },
    },
  },
];

const GMAIL_TOOLS: ToolDef[] = [
  {
    name: 'gmail_search',
    description: 'Search Gmail inbox and return the most recent matching emails. Results are always sorted newest-first by arrival order. To get the last N emails use query="ALL" with the desired limit. To filter use IMAP criteria e.g. "FROM boss@co.com", "SUBJECT invoice", "SINCE 1-Jun-2026". Never use "RECENT" or "UNSEEN" when the user asks for latest/last emails — use "ALL" instead.',
    parameters: {
      query:    { type: 'string', description: 'IMAP search criteria. Use "ALL" to get the most recent emails by date. Other examples: "FROM boss@co.com", "SUBJECT report", "SINCE 1-Jun-2026 FROM noreply@bank.com".', required: true },
      limit:    { type: 'number', description: 'Max emails to return (newest first). Default 10.', required: false },
    },
  },
  {
    name: 'gmail_read_email',
    description: 'Read the full content of a specific email by its UID.',
    parameters: {
      uid: { type: 'string', description: 'Email UID returned from gmail_search.', required: true },
    },
  },
  {
    name: 'gmail_send_email',
    description: 'Send an email via Gmail. Requires Google account connected in ConnectApps.',
    parameters: {
      to:      { type: 'string', description: 'Recipient email address.',            required: true  },
      subject: { type: 'string', description: 'Email subject line.',                 required: true  },
      body:    { type: 'string', description: 'Plain-text email body.',              required: true  },
      cc:      { type: 'string', description: 'CC email address (optional).',        required: false },
    },
  },
];

const GCAL_TOOLS: ToolDef[] = [
  {
    name: 'gcal_list_events',
    description: 'List upcoming events from Google Calendar.',
    parameters: {
      calendar_id: { type: 'string', description: 'Calendar ID. Use "primary" for the main calendar.', required: false },
      days_ahead:  { type: 'number', description: 'How many days ahead to fetch. Default 7.',          required: false },
      limit:       { type: 'number', description: 'Max events. Default 20.',                           required: false },
    },
  },
  {
    name: 'gcal_create_event',
    description: 'Create a new event in Google Calendar.',
    parameters: {
      summary:     { type: 'string', description: 'Event title.',                                    required: true  },
      start:       { type: 'string', description: 'Start time as ISO 8601 string.',                  required: true  },
      end:         { type: 'string', description: 'End time as ISO 8601 string.',                    required: true  },
      description: { type: 'string', description: 'Event description.',                             required: false },
      calendar_id: { type: 'string', description: 'Calendar ID. Default "primary".',                required: false },
    },
  },
];

const GSHEETS_TOOLS: ToolDef[] = [
  {
    name: 'sheets_read',
    description: 'Read cell values from a Google Sheets spreadsheet.',
    parameters: {
      spreadsheet_id: { type: 'string', description: 'Spreadsheet ID from the sheet URL.', required: true },
      range:          { type: 'string', description: 'A1 notation range, e.g. "Sheet1!A1:D10".', required: true },
    },
  },
  {
    name: 'sheets_append',
    description: 'Append new rows to a Google Sheets spreadsheet.',
    parameters: {
      spreadsheet_id: { type: 'string', description: 'Spreadsheet ID.', required: true },
      range:          { type: 'string', description: 'Target range/sheet name.', required: true },
      values:         { type: 'string', description: 'JSON 2D array of values e.g. [["Alice", 100], ["Bob", 200]].', required: true },
    },
  },
];

const GDRIVE_TOOLS: ToolDef[] = [
  {
    name: 'drive_list_files',
    description: 'List files in Google Drive.',
    parameters: {
      query: { type: 'string', description: 'Google Drive query string e.g. "mimeType=\'application/pdf\'".',  required: false },
      limit: { type: 'number', description: 'Max results. Default 20.', required: false },
    },
  },
  {
    name: 'drive_read_file',
    description: 'Read the text content of a Google Drive file (Docs, Sheets, plain text).',
    parameters: {
      file_id: { type: 'string', description: 'Google Drive file ID.', required: true },
    },
  },
];

const GSLIDES_TOOLS: ToolDef[] = [
  {
    name: 'slides_get_presentation',
    description: 'Read the content of a Google Slides presentation.',
    parameters: {
      presentation_id: { type: 'string', description: 'Presentation ID from the URL.', required: true },
    },
  },
];

const TWITTER_TOOLS: ToolDef[] = [
  {
    name: 'twitter_post_tweet',
    description: 'Post a new tweet on X (Twitter). Max 280 characters. Returns the tweet ID.',
    parameters: {
      text: { type: 'string', description: 'Tweet text (max 280 chars).', required: true },
    },
  },
  {
    name: 'twitter_reply_tweet',
    description: 'Reply to an existing tweet on X (Twitter).',
    parameters: {
      text:        { type: 'string', description: 'Reply text (max 280 chars).', required: true },
      reply_to_id: { type: 'string', description: 'Tweet ID to reply to.',       required: true },
    },
  },
  {
    name: 'twitter_delete_tweet',
    description: 'Delete one of your own tweets by its ID.',
    parameters: {
      tweet_id: { type: 'string', description: 'Tweet ID to delete.', required: true },
    },
  },
  {
    name: 'twitter_get_mentions',
    description: 'Fetch the latest @mentions of your X account.',
    parameters: {
      limit: { type: 'number', description: 'Max mentions to return (10–100). Default 10.', required: false },
    },
  },
  {
    name: 'twitter_get_timeline',
    description: 'Fetch your X home timeline (recent tweets from accounts you follow).',
    parameters: {
      limit: { type: 'number', description: 'Max tweets to return (5–100). Default 20.', required: false },
    },
  },
  {
    name: 'twitter_like_tweet',
    description: 'Like a tweet by its ID.',
    parameters: {
      tweet_id: { type: 'string', description: 'Tweet ID to like.', required: true },
    },
  },
  {
    name: 'twitter_retweet',
    description: 'Retweet a tweet by its ID.',
    parameters: {
      tweet_id: { type: 'string', description: 'Tweet ID to retweet.', required: true },
    },
  },
  {
    name: 'twitter_search',
    description: 'Search recent tweets matching a query (last 7 days). Returns up to 100 results.',
    parameters: {
      query: { type: 'string', description: 'Search query (Twitter operators supported, e.g. "from:user" or "#hashtag").', required: true },
      limit: { type: 'number', description: 'Max results (10–100). Default 10.',                                            required: false },
    },
  },
  {
    name: 'twitter_send_dm',
    description: 'Send a Direct Message to a user on X.',
    parameters: {
      recipient_id: { type: 'string', description: 'Recipient X user ID (numeric).', required: true },
      text:         { type: 'string', description: 'Message text to send.',          required: true },
    },
  },
];

const LINKEDIN_TOOLS: ToolDef[] = [
  {
    name: 'linkedin_create_post',
    description: 'Publish a new text post on LinkedIn.',
    parameters: {
      text:       { type: 'string', description: 'Post content. Supports newlines and hashtags.',                                               required: true  },
      visibility: { type: 'string', description: '"PUBLIC" (anyone), "CONNECTIONS" (1st-degree only), or "LOGGED_IN" (all LinkedIn members). Default "PUBLIC".', required: false },
    },
  },
  {
    name: 'linkedin_get_profile',
    description: 'Get your LinkedIn profile: ID, name, and headline. The ID field is used to build the URN for posting.',
    parameters: {},
  },
  {
    name: 'linkedin_get_posts',
    description: 'Fetch your recent LinkedIn posts.',
    parameters: {
      limit: { type: 'number', description: 'Max posts to return. Default 10.', required: false },
    },
  },
  {
    name: 'linkedin_add_comment',
    description: 'Add a comment on a LinkedIn post.',
    parameters: {
      share_urn: { type: 'string', description: 'URN of the post to comment on (e.g. "urn:li:share:12345").', required: true },
      text:      { type: 'string', description: 'Comment text.',                                              required: true },
    },
  },
  {
    name: 'linkedin_like_post',
    description: 'Like a LinkedIn post.',
    parameters: {
      share_urn: { type: 'string', description: 'URN of the post to like (e.g. "urn:li:share:12345").', required: true },
    },
  },
];

export const SERVICE_TOOLS: Record<string, ToolDef[]> = {
  gmail:    GMAIL_TOOLS,
  gcal:     GCAL_TOOLS,
  gsheets:  GSHEETS_TOOLS,
  gdrive:   GDRIVE_TOOLS,
  gslides:  GSLIDES_TOOLS,
  notion:   NOTION_TOOLS,
  slack:    SLACK_TOOLS,
  github:   GITHUB_TOOLS,
  linear:   LINEAR_TOOLS,
  airtable: AIRTABLE_TOOLS,
  twitter:  TWITTER_TOOLS,
  linkedin: LINKEDIN_TOOLS,
};

// ─── System prompt builder ────────────────────────────────────────────────────

export function buildKrewSystemPrompt(activeTools: ToolDef[]): string {
  const toolDocs = activeTools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([k, v]) => `  - ${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
      .join('\n');
    return `### ${t.name}\n${t.description}${params ? `\nParameters:\n${params}` : ''}`;
  }).join('\n\n');

  return `You are Krew, a powerful AI agent running locally inside the adris.tech desktop app. You have access to the user's machine and connected apps.

## Available tools
${toolDocs}

## How to use tools
When you need a tool, output ONLY this XML block — no text before it, no text after it:
<tool_call>
{"tool": "tool_name", "param1": "value1", "param2": "value2"}
</tool_call>

Put all parameters directly in the JSON object alongside "tool". Do NOT nest them under "args". The tag is <tool_call> only — not <tool_code>, not a code block.

Wait for the tool result before continuing. After receiving a result, if there are still remaining tasks that need tools, call the next tool IMMEDIATELY — do not stop to explain or ask the user anything. Only write your final answer after ALL required tool calls are complete. NEVER invent tool results — always use the actual output.

## Final answer
When you have enough information to fully answer the user's request, respond normally in clear markdown. Do not include any <tool_call> block in the final answer.

## Verify before stating
For live figures: use the right tool once, then answer — never loop.
- **Exchange rates** → always use the get_exchange_rate tool (e.g. base: "USD", target: "INR"). Never use web_search for this.
- **API pricing / competitor prices** → attempt ONE web_search. If it returns no useful result, state your best estimate clearly labelled as an assumption.
- If any tool fails, proceed immediately with a labelled assumption. Do NOT retry. Do NOT delegate to another agent. Always give a complete response.

## Guidelines
- Think step by step before calling tools
- Prefer fewer, precise tool calls over many broad ones
- If a tool fails, explain what happened and suggest an alternative
- Be concise but thorough
- All data you access stays on the user's machine — privacy is guaranteed

## Browser rules (no exceptions)

NEVER say "I can't access that" or suggest Connect Apps for browsing. The browser is ALWAYS available.

- Read page content → browser_navigate (returns text; sessions saved permanently)
- Show site to user / interact → browser_open then browser_click/browser_fill
- Quick facts/news → web_search (faster, no browser needed)
- Notifications/multi-item tasks → navigate to list page, read all items from the returned text in one go; only navigate to individual items if more detail is needed

**URL cheat-sheet (use exactly, replace [slug] with real username):**
- LinkedIn notifications: https://www.linkedin.com/notifications/
- LinkedIn posts: https://www.linkedin.com/in/[slug]/recent-activity/all/
- Gmail inbox: https://mail.google.com/mail/u/0/#inbox
- Twitter/X home: https://twitter.com/home
- Reddit: https://www.reddit.com
- Notion: https://www.notion.so
- GitHub: https://github.com

**CRITICAL — personal account data:**
If the user asks about THEIR OWN posts, notifications, emails, profile, or activity on any platform, you MUST use browser_navigate — web_search cannot see private account data. Do NOT use web_search to "research" personal tasks. Examples: "check my LinkedIn posts" → browser_navigate to LinkedIn. "my Gmail inbox" → browser_navigate to Gmail. "my Twitter activity" → browser_navigate to Twitter. Only use web_search for public facts, news, or research unrelated to the user's own accounts.

**CRITICAL — finding the user's own social media profiles:**
NEVER search Google or the web to find the user's own LinkedIn, Twitter, GitHub, or any other profile URL. Searching by name will find OTHER people with the same name — you will open the wrong profile. Instead follow this order:
1. Check memories first — look for keys like linkedin_url, founder_profile, twitter_url, github_url, etc.
2. If not in memory, use read_browser_history with the site name (e.g. "linkedin.com/in") — Chrome history has the exact URL they actually visit.
3. Only if history has nothing, ask the user directly for their URL — then navigate and save to memory.
Never guess or construct a URL from the user's name.

## Smart routing: API first, browser second
If the user's request touches a service that has a **connected API tool**, ALWAYS use that tool — not browser_navigate. Direct API calls return structured data and use 4× fewer tokens than browser navigation.

| Service | If connected → use | If NOT connected → use |
|---------|-------------------|----------------------|
| Gmail / inbox | gmail_search, gmail_read_email | browser_navigate to Gmail |
| LinkedIn posts/profile | linkedin_get_posts, linkedin_get_profile | browser_navigate to LinkedIn |
| Notion pages | notion_search, notion_get_page | browser_navigate to Notion |
| Slack messages | slack_read_messages, slack_search_messages | browser_navigate to Slack |
| GitHub repos/files | github_list_repos, github_get_file | browser_navigate to GitHub |

Check your available tools list. If gmail_search is listed, never use browser_navigate for Gmail. If linkedin_get_posts is listed, never use browser_navigate for LinkedIn. The connected tool is ALWAYS faster, cheaper, and more reliable.

## Platform & Content Compliance
When generating content intended for any platform (LinkedIn, Twitter/X, Instagram, email, Slack, Notion, etc.):
- Write exactly as the user would write it themselves — first person, their voice, their tone
- NEVER include any AI disclosure: no "As an AI", no "I'm an AI assistant", no "Generated by AI", no "Note: AI-written", no markers flagging AI authorship
- NEVER end drafted publishable content with conversational sign-offs like "I hope this helps!" — those belong in a chat reply, not in content the user publishes under their name
- Respect platform character limits and native formatting (LinkedIn: line breaks + hashtags; Twitter/X: 280 chars; Instagram: hashtags at end)
- When actions are taken via API or automation, they must appear organic — do not batch-post multiple items simultaneously; follow natural human timing patterns
- All produced content represents the user's authentic voice — a platform or its systems must see only a human author`;
}

// ─── Twitter OAuth 1.0a signature helper ─────────────────────────────────────

export async function buildTwitterOAuthHeader(
  method: string,
  url: string,
  extraQueryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
): Promise<string> {
  const urlObj = new URL(url);
  const urlParams: Record<string, string> = {};
  urlObj.searchParams.forEach((v, k) => { urlParams[k] = v; });
  const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  const nonce     = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthP: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const allParams     = { ...urlParams, ...extraQueryParams, ...oauthP };
  const enc           = encodeURIComponent;
  const sortedParamStr = Object.keys(allParams).sort().map(k => `${enc(k)}=${enc(allParams[k])}`).join('&');
  const baseString    = `${method.toUpperCase()}&${enc(baseUrl)}&${enc(sortedParamStr)}`;
  const signingKey    = `${enc(consumerSecret)}&${enc(accessTokenSecret)}`;

  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingKey), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(baseString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  const authParams: Record<string, string> = { ...oauthP, oauth_signature: signature };
  return 'OAuth ' + Object.keys(authParams).sort().map(k => `${enc(k)}="${enc(authParams[k])}"`).join(', ');
}

// ─── Tool executor (TypeScript orchestration layer) ───────────────────────────

type Creds = Record<string, Record<string, string>>;

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  creds: Creds,
  onTerminalApprovalNeeded: (command: string) => Promise<boolean>,
  agentKey: string = 'boss',
  userId = '',
  sessionId = 'default',
): Promise<string> {
  const str = (v: unknown) => String(v ?? '');
  const num = (v: unknown, def: number) => typeof v === 'number' ? v : def;

  // ── Memory tools ──────────────────────────────────────────────────────────
  if (toolName === 'save_memory') {
    await krewMemoryDb.save(agentKey, str(args.key), str(args.value));
    return `Memory saved: "${str(args.key)}" = "${str(args.value)}"`;
  }
  if (toolName === 'recall_memory') {
    const mems = await krewMemoryDb.getAll(agentKey);
    const found = mems.find((m) => m.key === str(args.key));
    return found ? found.value : 'not found';
  }
  if (toolName === 'forget_memory') {
    await krewMemoryDb.delete(agentKey, str(args.key));
    return `Memory "${str(args.key)}" deleted.`;
  }

  // ── Connect Apps navigation ───────────────────────────────────────────────
  if (toolName === 'open_connect_apps') {
    await emit('nv-open-connect-apps', {});
    return 'Connect Apps panel opened. Ask the user to select the service they want to connect.';
  }
  if (toolName === 'open_service_setup') {
    const { requestServiceSetup } = await import('./connectAppsRequest');
    requestServiceSetup(str(args.service));
    await emit('nv-open-connect-apps', {});
    return `Opening setup guide for "${str(args.service)}" — the user will see the step-by-step connection wizard now. Guide them through any steps you know (e.g. where to find their API key).`;
  }

  // ── System tools ──────────────────────────────────────────────────────────
  if (toolName === 'read_file') {
    return await invoke<string>('read_file', { path: str(args.path) });
  }

  if (toolName === 'execute_terminal') {
    const command = str(args.command);
    const approved = await onTerminalApprovalNeeded(command);
    if (!approved) return 'User declined to run this command.';
    return await invoke<string>('krew_execute_command', { command });
  }

  if (toolName === 'get_exchange_rate') {
    const base   = str(args.base).toUpperCase();
    const target = str(args.target).toUpperCase();
    try {
      const raw  = await invoke<string>('krew_http_call', {
        method:  'GET',
        url:     `https://open.er-api.com/v6/latest/${base}`,
        headers: { 'Accept': 'application/json' },
        body:    null,
      });
      const data = JSON.parse(raw) as { result: string; rates?: Record<string, number>; time_last_update_utc?: string };
      if (data.result === 'success' && data.rates?.[target] != null) {
        const rate = data.rates[target];
        return `Live exchange rate: 1 ${base} = ${rate} ${target} (as of ${data.time_last_update_utc ?? 'just now'}, source: open.er-api.com)`;
      }
      return `Could not fetch live rate for ${base}/${target}. Use an approximate rate and label it as an assumption.`;
    } catch {
      return `Could not fetch live rate for ${base}/${target}. Use an approximate rate and label it as an assumption.`;
    }
  }

  if (toolName === 'web_search') {
    const braveKey = creds.brave?.api_key ?? '';
    if (braveKey) {
      return await invoke<string>('krew_web_search', { query: str(args.query), apiKey: braveKey });
    }
    // No Brave key — use DDG HTML via session-isolated browser (plain HTML, no GPU/JS issues)
    try {
      const q = encodeURIComponent(str(args.query));
      const opened = await invoke<string>('run_agent_browser_session', { sessionId, args: `open "https://html.duckduckgo.com/html/?q=${q}"` });
      if (opened.includes('[agent-browser not installed]')) {
        return '[Browser not ready yet — agent-browser is still installing. Try again in a moment.]';
      }
      const raw = await invoke<string>('run_agent_browser_session', { sessionId, args: 'get text body' });
      const text = cleanBrowserText(raw);
      return text.length > 5000 ? text.slice(0, 5000) + '\n…[truncated]' : text;
    } catch (e) {
      return `[Search failed: ${String(e)}]`;
    }
  }

  // ── Browser tools — session-isolated Playwright (each agent/conversation gets its own state) ─
  // sessionId = chatSessionId-agentKey  →  no two agents share the same Playwright browser
  const runBrowser = async (browserArgs: string): Promise<string> => {
    try {
      const result = await invoke<string>('run_agent_browser_session', { sessionId, args: browserArgs });
      // Chrome crash / conflict detection — return a clear stop message so AI doesn't retry
      if (
        result.includes('[agent-browser not installed]') ||
        result.includes('Chrome exited') ||
        result.includes('DevToolsActivePort') ||
        result.includes('failed to launch') ||
        result.includes('exited early') ||
        result.includes('[browser-crash]')
      ) {
        return '[Browser automation unavailable] The interactive browser session failed. To read page content, use browser_navigate instead (it uses a persistent session). For public information, use web_search. STOP retrying browser_snapshot or browser_get_text.';
      }
      return result;
    } catch (e) {
      const msg = String(e);
      if (msg.includes('Chrome') || msg.includes('browser') || msg.includes('Playwright')) {
        return '[Browser automation unavailable] Cannot connect to browser session. Use browser_navigate to read page content, or web_search for public information.';
      }
      return `Browser error: ${msg}`;
    }
  };

  if (toolName === 'read_browser_history') {
    const query = str(args.query);
    return await invoke<string>('read_browser_history', { query, limit: 15 }).catch(e => `History read failed: ${e}`);
  }

  if (toolName === 'browser_open') {
    const rawUrl = str(args.url);
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl.replace(/^\/+/, '')}`;
    // Open ONLY in user's actual Chrome — do NOT launch Playwright (causes Chrome conflict)
    await invoke<string>('open_in_system_browser', { url }).catch(() => {});
    return `Opened ${url} in the user's Chrome browser. The page is now visible on their screen (user is logged in to their accounts).\n\nNOTE: browser_snapshot and browser_get_text read from the AGENT browser (separate instance). To also read this page's content, call browser_navigate with the same URL — it loads the page in the agent's persistent browser and returns the text.`;
  }

  if (toolName === 'browser_navigate') {
    const rawUrl = str(args.url);
    const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl.replace(/^\/+/, '')}`;
    // Open in user's visible Chrome so they can see what's being browsed
    invoke('open_in_system_browser', { url }).catch(() => {});
    // Also navigate in the persistent agent browser to extract page text
    const navResult = await invoke<string>('run_browser_persistent', { args: `open "${url}"` }).catch(e => String(e));
    if (navResult.includes('[agent-browser not installed]')) {
      // Fallback: try plain HTTP fetch for public pages
      try {
        const fetched = await invoke<string>('fetch_page_text', { url });
        const cleaned = cleanBrowserText(fetched);
        if (cleaned && cleaned.length > 50) {
          const snippet = cleaned.slice(0, 1000).toLowerCase();
          const isLoginPage = (
            (snippet.includes('sign in') || snippet.includes('log in') || snippet.includes('join now')) &&
            (snippet.includes('password') || snippet.includes('email') || snippet.includes('phone'))
          ) || snippet.includes('authwall');
          if (isLoginPage) {
            const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
            return `[Login required] ${host} requires you to be logged in. Please log in to ${host} in the browser window that just opened, then say **"continue"** — I will read the page once you are signed in.`;
          }
          const content = cleaned.length > 3000 ? cleaned.slice(0, 3000) + '\n…[truncated]' : cleaned;
          return `Content from ${url} (public read):\n\n${content}`;
        }
      } catch { /* fall through */ }
      return `[Login required] This page needs you to be logged in. Please log in in the browser window that just opened, then say **"continue"** and I will read it.`;
    }
    if (navResult.includes('[browser-timeout]')) {
      return `[Browser timeout] ${url} took over 30 seconds to load. The page may require login or is loading slowly. Check the browser window that just opened — if you are logged in, please try the request again and I will retry.`;
    }
    if (navResult.includes('[browser-crash]') || navResult.includes('Chrome exited') || navResult.includes('DevToolsActivePort')) {
      return `[Browser error] Could not load ${url}. Try web_search instead to find this information.`;
    }
    // If run_browser_persistent returned actual page content directly (Node.js/Playwright path),
    // use it. Only call "get text body" if it returned the old "(done)" signal.
    const isDoneSignal = navResult.trim() === '(done)' || navResult.trim() === '';
    const raw = isDoneSignal
      ? await invoke<string>('run_browser_persistent', { args: 'get text body' }).catch(e => String(e))
      : navResult;
    const text = cleanBrowserText(raw);

    // Detect login / auth-wall pages — don't feed them to the agent as real content
    const snippet = text.slice(0, 1000).toLowerCase();
    const isLoginPage = (
      (snippet.includes('sign in') || snippet.includes('log in') || snippet.includes('join now')) &&
      (snippet.includes('password') || snippet.includes('email') || snippet.includes('phone'))
    ) || snippet.includes('authwall') || snippet.includes('auth-wall');

    if (!text || text.length < 30 || isLoginPage) {
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      return `[Login required] ${host} needs a one-time login in the browser window that just opened on your screen. Once you are signed in, come back here and say **"continue"** — I will read the page and carry on with your task. Sessions are saved permanently so you only do this once per site.`;
    }
    const content = text.length > 3000 ? text.slice(0, 3000) + '\n…[truncated — call again for more]' : text;
    return `Content from ${url}:\n\n${content}`;
  }

  if (toolName === 'browser_search') {
    const q = encodeURIComponent(str(args.query));
    await runBrowser(`open "https://www.google.com/search?q=${q}"`);
    const raw = await runBrowser('get text body');
    if (raw.startsWith('[Browser automation unavailable]') || raw.startsWith('[agent-browser not installed')) return raw;
    const text = cleanBrowserText(raw);
    return text.length > 5000 ? text.slice(0, 5000) + '\n…[truncated]' : text;
  }
  if (toolName === 'browser_snapshot') {
    return await runBrowser('snapshot');
  }
  if (toolName === 'browser_click') {
    const sel = str(args.selector);
    // Auto-gate consequential clicks in case agent skipped browser_confirm
    if (CONSEQUENTIAL_RE.test(sel)) {
      const actionType = classifyAction(sel);
      const approved = await requestBrowserApproval(actionType, `Clicking "${sel}" in the browser`);
      if (!approved) return 'User denied: this action was not approved. Inform the user and ask what to do instead.';
    }
    return await runBrowser(`click "${sel}"`);
  }
  if (toolName === 'browser_confirm') {
    const actionType = str(args.action_type) || 'submit_form';
    const description = str(args.description);
    const approved = await requestBrowserApproval(actionType, description);
    return approved
      ? 'Approved by user. You may proceed with the action now.'
      : 'Denied by user. Do NOT proceed. Tell the user their action was cancelled and ask what they would like to do instead.';
  }
  if (toolName === 'browser_fill') {
    const sel = str(args.selector);
    const text = str(args.text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return await runBrowser(`fill "${sel}" "${text}"`);
  }
  if (toolName === 'browser_get_text') {
    const sel = str(args.selector) || 'body';
    const raw = await runBrowser(`get text "${sel}"`);
    if (raw.startsWith('[Browser automation unavailable]') || raw.startsWith('[Browser not ready')) return raw;
    const text = cleanBrowserText(raw);
    return text.length > 5000 ? text.slice(0, 5000) + '\n…[truncated]' : text;
  }
  if (toolName === 'browser_screenshot') {
    return await runBrowser('screenshot');
  }
  if (toolName === 'browser_close') {
    return await runBrowser('close');
  }

  // ── Notion ────────────────────────────────────────────────────────────────
  const notionHeaders = {
    'Authorization':  `Bearer ${creds.notion?.token ?? ''}`,
    'Notion-Version': '2022-06-28',
    'Content-Type':   'application/json',
  };

  if (toolName === 'notion_search') {
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://api.notion.com/v1/search',
      headers: notionHeaders,
      body:    JSON.stringify({ query: str(args.query), page_size: num(args.page_size, 10) }),
    });
  }
  if (toolName === 'notion_get_page') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.notion.com/v1/pages/${str(args.page_id)}`,
      headers: notionHeaders,
      body:    null,
    });
  }
  if (toolName === 'notion_create_page') {
    const body: Record<string, unknown> = {
      parent: { page_id: str(args.parent_id) },
      properties: { title: { title: [{ text: { content: str(args.title) } }] } },
    };
    if (args.content) {
      body.children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: str(args.content) } }] } }];
    }
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://api.notion.com/v1/pages',
      headers: notionHeaders,
      body:    JSON.stringify(body),
    });
  }
  if (toolName === 'notion_query_database') {
    const body: Record<string, unknown> = { page_size: num(args.page_size, 20) };
    if (args.filter_json) { try { body.filter = JSON.parse(str(args.filter_json)); } catch {} }
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://api.notion.com/v1/databases/${str(args.database_id)}/query`,
      headers: notionHeaders,
      body:    JSON.stringify(body),
    });
  }

  // ── Slack ─────────────────────────────────────────────────────────────────
  const slackHeaders = {
    'Authorization': `Bearer ${creds.slack?.bot_token ?? ''}`,
    'Content-Type':  'application/json; charset=utf-8',
  };
  if (toolName === 'slack_list_channels') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     'https://slack.com/api/conversations.list?limit=100',
      headers: slackHeaders,
      body:    null,
    });
  }
  if (toolName === 'slack_send_message') {
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://slack.com/api/chat.postMessage',
      headers: slackHeaders,
      body:    JSON.stringify({ channel: str(args.channel), text: str(args.message) }),
    });
  }
  if (toolName === 'slack_read_messages') {
    const channelRaw = str(args.channel).replace(/^#/, '');
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://slack.com/api/conversations.history?channel=${channelRaw}&limit=${num(args.limit, 20)}`,
      headers: slackHeaders,
      body:    null,
    });
  }
  if (toolName === 'slack_search_messages') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://slack.com/api/search.messages?query=${encodeURIComponent(str(args.query))}`,
      headers: slackHeaders,
      body:    null,
    });
  }

  // ── GitHub ────────────────────────────────────────────────────────────────
  const ghHeaders = {
    'Authorization': `Bearer ${creds.github?.token ?? ''}`,
    'Accept':        'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (toolName === 'github_list_repos') {
    const vis = str(args.visibility) || 'all';
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.github.com/user/repos?visibility=${vis}&per_page=50&sort=updated`,
      headers: ghHeaders,
      body:    null,
    });
  }
  if (toolName === 'github_get_file') {
    const branch = str(args.branch) || 'main';
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.github.com/repos/${str(args.owner)}/${str(args.repo)}/contents/${str(args.path)}?ref=${branch}`,
      headers: ghHeaders,
      body:    null,
    });
  }
  if (toolName === 'github_list_issues') {
    const state = str(args.state) || 'open';
    const limit = num(args.limit, 20);
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.github.com/repos/${str(args.owner)}/${str(args.repo)}/issues?state=${state}&per_page=${limit}`,
      headers: ghHeaders,
      body:    null,
    });
  }
  if (toolName === 'github_create_issue') {
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://api.github.com/repos/${str(args.owner)}/${str(args.repo)}/issues`,
      headers: ghHeaders,
      body:    JSON.stringify({ title: str(args.title), body: str(args.body) }),
    });
  }
  if (toolName === 'github_search_code') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.github.com/search/code?q=${encodeURIComponent(str(args.query))}&per_page=10`,
      headers: ghHeaders,
      body:    null,
    });
  }

  // ── Linear ────────────────────────────────────────────────────────────────
  if (toolName === 'linear_get_issues') {
    const filter = args.team_key ? `teamKey: { eq: "${str(args.team_key)}" }` : '';
    const stateFilter = args.state ? `, state: { name: { eq: "${str(args.state)}" } }` : '';
    const limit = num(args.limit, 20);
    const query = `{ issues(filter: { ${filter}${stateFilter} }, first: ${limit}) { nodes { id title state { name } priority createdAt assignee { name } } } }`;
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://api.linear.app/graphql',
      headers: { 'Authorization': creds.linear?.api_key ?? '', 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query }),
    });
  }
  if (toolName === 'linear_create_issue') {
    const mutation = `mutation { issueCreate(input: { teamId: "${str(args.team_id)}", title: "${str(args.title)}", description: "${str(args.description ?? '')}", priority: ${num(args.priority, 0)} }) { success issue { id title } } }`;
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://api.linear.app/graphql',
      headers: { 'Authorization': creds.linear?.api_key ?? '', 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query: mutation }),
    });
  }

  // ── Airtable ──────────────────────────────────────────────────────────────
  const atHeaders = { 'Authorization': `Bearer ${creds.airtable?.token ?? ''}` };
  if (toolName === 'airtable_list_records') {
    let url = `https://api.airtable.com/v0/${str(args.base_id)}/${encodeURIComponent(str(args.table_name))}?pageSize=${num(args.limit, 20)}`;
    if (args.filter) url += `&filterByFormula=${encodeURIComponent(str(args.filter))}`;
    return await invoke<string>('krew_http_call', { method: 'GET', url, headers: atHeaders, body: null });
  }
  if (toolName === 'airtable_create_record') {
    let fields: Record<string, unknown> = {};
    try { fields = JSON.parse(str(args.fields)); } catch {}
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://api.airtable.com/v0/${str(args.base_id)}/${encodeURIComponent(str(args.table_name))}`,
      headers: { ...atHeaders, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ records: [{ fields }] }),
    });
  }

  // ── Gmail IMAP ────────────────────────────────────────────────────────────
  if (toolName === 'gmail_search') {
    return await invoke<string>('gmail_fetch_emails', {
      email:       creds.gmail?.email ?? '',
      appPassword: creds.gmail?.app_password ?? '',
      query:       str(args.query),
      limit:       num(args.limit, 10),
    });
  }
  if (toolName === 'gmail_read_email') {
    return await invoke<string>('gmail_fetch_email_body', {
      email:       creds.gmail?.email ?? '',
      appPassword: creds.gmail?.app_password ?? '',
      uid:         str(args.uid),
    });
  }

  // ── Google services (OAuth-based) ─────────────────────────────────────────
  const googleToken = creds.google?.access_token ?? '';
  const authHeader  = { 'Authorization': `Bearer ${googleToken}` };

  if (toolName === 'gmail_send_email') {
    if (!googleToken) return 'Gmail sending requires your Google account connected in ConnectApps (Settings → ConnectApps → Google). Once connected, I can send emails directly.';
    const to      = str(args.to);
    const subject = str(args.subject);
    const body_   = str(args.body);
    const cc      = str(args.cc);
    const from    = (creds.google as Record<string, string> | undefined)?.email ?? (creds.gmail as Record<string, string> | undefined)?.email ?? 'me';
    const lines   = [
      `From: ${from}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body_,
    ];
    const message = lines.join('\r\n');
    const bytes   = new TextEncoder().encode(message);
    let   binary  = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    const raw = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ raw }),
    });
  }

  if (toolName === 'gcal_list_events') {
    const days = num(args.days_ahead, 7);
    const calId = encodeURIComponent(str(args.calendar_id) || 'primary');
    const now   = new Date().toISOString();
    const end   = new Date(Date.now() + days * 86_400_000).toISOString();
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?timeMin=${now}&timeMax=${end}&maxResults=${num(args.limit, 20)}&orderBy=startTime&singleEvents=true`,
      headers: authHeader,
      body:    null,
    });
  }
  if (toolName === 'gcal_create_event') {
    const calId = encodeURIComponent(str(args.calendar_id) || 'primary');
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ summary: str(args.summary), description: str(args.description), start: { dateTime: str(args.start) }, end: { dateTime: str(args.end) } }),
    });
  }
  if (toolName === 'sheets_read') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://sheets.googleapis.com/v4/spreadsheets/${str(args.spreadsheet_id)}/values/${encodeURIComponent(str(args.range))}`,
      headers: authHeader,
      body:    null,
    });
  }
  if (toolName === 'sheets_append') {
    let values: unknown[][] = [];
    try { values = JSON.parse(str(args.values)); } catch {}
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://sheets.googleapis.com/v4/spreadsheets/${str(args.spreadsheet_id)}/values/${encodeURIComponent(str(args.range))}:append?valueInputOption=USER_ENTERED`,
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values }),
    });
  }
  if (toolName === 'drive_list_files') {
    const q = args.query ? `&q=${encodeURIComponent(str(args.query))}` : '';
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://www.googleapis.com/drive/v3/files?pageSize=${num(args.limit, 20)}&fields=files(id,name,mimeType,modifiedTime,size)${q}`,
      headers: authHeader,
      body:    null,
    });
  }
  if (toolName === 'drive_read_file') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://www.googleapis.com/drive/v3/files/${str(args.file_id)}/export?mimeType=text/plain`,
      headers: authHeader,
      body:    null,
    });
  }
  if (toolName === 'slides_get_presentation') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://slides.googleapis.com/v1/presentations/${str(args.presentation_id)}`,
      headers: authHeader,
      body:    null,
    });
  }

  // ── Twitter (X) ───────────────────────────────────────────────────────────
  const twKey    = creds.twitter?.api_key ?? '';
  const twSec    = creds.twitter?.api_secret ?? '';
  const twTok    = creds.twitter?.access_token ?? '';
  const twTokSec = creds.twitter?.access_token_secret ?? '';

  async function twAuth(method: string, url: string, extra: Record<string, string> = {}): Promise<string> {
    return buildTwitterOAuthHeader(method, url, extra, twKey, twSec, twTok, twTokSec);
  }
  async function twMe(): Promise<string> {
    const meUrl = 'https://api.twitter.com/2/users/me';
    const res = JSON.parse(await invoke<string>('krew_http_call', { method: 'GET', url: meUrl, headers: { Authorization: await twAuth('GET', meUrl) }, body: null })) as { data?: { id?: string } };
    return res.data?.id ?? '';
  }

  if (toolName === 'twitter_post_tweet' || toolName === 'twitter_reply_tweet') {
    const body: Record<string, unknown> = { text: str(args.text).slice(0, 280) };
    if (toolName === 'twitter_reply_tweet' && args.reply_to_id) {
      body.reply = { in_reply_to_tweet_id: str(args.reply_to_id) };
    }
    const url = 'https://api.twitter.com/2/tweets';
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url,
      headers: { Authorization: await twAuth('POST', url), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }
  if (toolName === 'twitter_delete_tweet') {
    const url = `https://api.twitter.com/2/tweets/${str(args.tweet_id)}`;
    return await invoke<string>('krew_http_call', {
      method:  'DELETE',
      url,
      headers: { Authorization: await twAuth('DELETE', url) },
      body:    null,
    });
  }
  if (toolName === 'twitter_get_mentions') {
    const uid   = await twMe();
    const limit = Math.min(100, Math.max(10, num(args.limit, 10)));
    const url   = `https://api.twitter.com/2/users/${uid}/mentions?max_results=${limit}&tweet.fields=created_at,author_id,text`;
    return await invoke<string>('krew_http_call', { method: 'GET', url, headers: { Authorization: await twAuth('GET', url) }, body: null });
  }
  if (toolName === 'twitter_get_timeline') {
    const uid   = await twMe();
    const limit = Math.min(100, Math.max(5, num(args.limit, 20)));
    const url   = `https://api.twitter.com/2/users/${uid}/timelines/reverse_chronological?max_results=${limit}&tweet.fields=created_at,author_id,text`;
    return await invoke<string>('krew_http_call', { method: 'GET', url, headers: { Authorization: await twAuth('GET', url) }, body: null });
  }
  if (toolName === 'twitter_like_tweet') {
    const uid = await twMe();
    const url = `https://api.twitter.com/2/users/${uid}/likes`;
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url,
      headers: { Authorization: await twAuth('POST', url), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tweet_id: str(args.tweet_id) }),
    });
  }
  if (toolName === 'twitter_retweet') {
    const uid = await twMe();
    const url = `https://api.twitter.com/2/users/${uid}/retweets`;
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url,
      headers: { Authorization: await twAuth('POST', url), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tweet_id: str(args.tweet_id) }),
    });
  }
  if (toolName === 'twitter_search') {
    const limit = Math.min(100, Math.max(10, num(args.limit, 10)));
    const url   = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(str(args.query))}&max_results=${limit}&tweet.fields=created_at,author_id,text`;
    return await invoke<string>('krew_http_call', { method: 'GET', url, headers: { Authorization: await twAuth('GET', url) }, body: null });
  }
  if (toolName === 'twitter_send_dm') {
    const url  = 'https://api.twitter.com/2/dm_conversations/with/messages';
    const body = JSON.stringify({ participant_id: str(args.recipient_id), message: { text: str(args.text) } });
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url,
      headers: { Authorization: await twAuth('POST', url), 'Content-Type': 'application/json' },
      body,
    });
  }

  // ── LinkedIn ──────────────────────────────────────────────────────────────
  const liToken   = creds.linkedin?.access_token ?? '';
  const liHeaders = {
    'Authorization':             `Bearer ${liToken}`,
    'Content-Type':              'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
  async function liMe(): Promise<string> {
    const res = JSON.parse(await invoke<string>('krew_http_call', { method: 'GET', url: 'https://api.linkedin.com/v2/me', headers: liHeaders, body: null })) as { id?: string };
    return res.id ?? '';
  }

  if (toolName === 'linkedin_get_profile') {
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     'https://api.linkedin.com/v2/me?projection=(id,firstName,lastName,headline)',
      headers: liHeaders,
      body:    null,
    });
  }
  if (toolName === 'linkedin_create_post') {
    const personId  = await liMe();
    const personUrn = `urn:li:person:${personId}`;
    const vis       = str(args.visibility) || 'PUBLIC';
    const postBody  = {
      author: personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary:    { text: str(args.text) },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': vis },
    };
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     'https://api.linkedin.com/v2/ugcPosts',
      headers: liHeaders,
      body:    JSON.stringify(postBody),
    });
  }
  if (toolName === 'linkedin_get_posts') {
    const personId  = await liMe();
    const personUrn = encodeURIComponent(`urn:li:person:${personId}`);
    const limit     = num(args.limit, 10);
    return await invoke<string>('krew_http_call', {
      method:  'GET',
      url:     `https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${personUrn})&count=${limit}&sortBy=LAST_MODIFIED`,
      headers: liHeaders,
      body:    null,
    });
  }
  if (toolName === 'linkedin_add_comment') {
    const personId  = await liMe();
    const personUrn = `urn:li:person:${personId}`;
    const shareUrn  = str(args.share_urn);
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/comments`,
      headers: liHeaders,
      body:    JSON.stringify({ actor: personUrn, message: { text: str(args.text) } }),
    });
  }
  if (toolName === 'linkedin_like_post') {
    const personId  = await liMe();
    const personUrn = `urn:li:person:${personId}`;
    const shareUrn  = str(args.share_urn);
    return await invoke<string>('krew_http_call', {
      method:  'POST',
      url:     `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/likes`,
      headers: liHeaders,
      body:    JSON.stringify({ actor: personUrn }),
    });
  }

  // ── Automation management ─────────────────────────────────────────────────
  if (toolName === 'list_automations') {
    try {
      const rows = await invoke<{
        id: string; name: string; trigger_type: string; enabled: boolean;
        run_count: number; last_run_at: number | null;
      }[]>('automation_list', { userId });
      if (!rows.length) return 'No automations found. The user has not created any yet.';
      const summary = rows.map((a, i) => {
        const lastRun = a.last_run_at
          ? new Date(a.last_run_at * 1000).toLocaleString()
          : 'Never';
        const status = a.enabled ? '● enabled' : '○ disabled';
        return `${i + 1}. [${a.id.slice(0, 8)}] "${a.name}" — trigger: ${a.trigger_type} — ${status} — runs: ${a.run_count} — last: ${lastRun}`;
      }).join('\n');
      return `Automations (${rows.length} total):\n${summary}`;
    } catch (e) {
      return `Failed to list automations: ${String(e)}`;
    }
  }

  if (toolName === 'run_automation_now') {
    try {
      const rows = await invoke<{ id: string; name: string; trigger_type: string }[]>('automation_list', { userId });
      const target = rows.find(a => a.id === str(args.automation_id) || a.name.toLowerCase().includes(str(args.automation_id).toLowerCase()));
      if (!target) return `Automation not found: "${str(args.automation_id)}". Use list_automations to get valid IDs.`;
      await emit('krew_run_automation', { id: target.id });
      return `Running automation "${target.name}" now. The output will be delivered to its configured destination.`;
    } catch (e) {
      return `Failed to run automation: ${String(e)}`;
    }
  }

  if (toolName === 'toggle_automation') {
    try {
      const enabled = args.enabled === true || args.enabled === 'true';
      await invoke('automation_toggle', { id: str(args.automation_id), enabled });
      return `Automation ${str(args.automation_id).slice(0, 8)}… ${enabled ? 'enabled' : 'disabled'} successfully.`;
    } catch (e) {
      return `Failed to toggle automation: ${String(e)}`;
    }
  }

  return `Unknown tool: ${toolName}`;
}

// ─── Context compression ──────────────────────────────────────────────────────

export function needsCompression(messages: { role: string; content: string }[]): boolean {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return totalChars > 80_000; // ~20K tokens, compresses before exceeding typical context limits
}
