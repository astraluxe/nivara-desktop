import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from '../../lib/krewDb';

interface Props {
  service: string;
  onDone:  () => void;
  onClose: () => void;
}

// ─── Per-service step guides ─────────────────────────────────────────────────

interface CopyItem { label: string; text: string }
interface Step { title: string; body: string; link?: string; copyText?: string; copyItems?: CopyItem[]; field?: string; fieldLabel?: string; fieldPlaceholder?: string; secret?: boolean }

const GUIDES: Record<string, { title: string; icon: string; steps: Step[] }> = {
  // ── AI Providers ─────────────────────────────────────────────────────────
  gemini: {
    title: 'Connect Gemini (Google AI)',
    icon: '✦',
    steps: [
      { title: 'Get a free Gemini API key', body: 'Go to Google AI Studio and create an API key. The free tier gives you millions of tokens per month on the Flash model — more than enough for daily use.', link: 'https://aistudio.google.com/app/apikey' },
      { title: 'Create the key', body: 'Click "Create API key" → "Create API key in new project" (or select an existing project). Copy the key shown — it starts with "AIza".' },
      { title: 'Paste your API key', body: '', field: 'api_key', fieldLabel: 'Gemini API Key', fieldPlaceholder: 'AIzaSy...', secret: true },
    ],
  },
  openai: {
    title: 'Connect OpenAI (GPT-4o)',
    icon: '⬡',
    steps: [
      { title: 'Get an OpenAI API key', body: 'Go to platform.openai.com → API keys → Create new secret key. You\'ll need a small amount of credit added to your account first (even $5 lasts a long time).', link: 'https://platform.openai.com/api-keys' },
      { title: 'Create and copy the key', body: 'Click "Create new secret key", paste the name below, then immediately copy the key — OpenAI only shows it once. It starts with "sk-".', copyItems: [{ label: 'Key name', text: 'Nivara' }] },
      { title: 'Paste your API key', body: '', field: 'api_key', fieldLabel: 'OpenAI API Key', fieldPlaceholder: 'sk-...', secret: true },
    ],
  },
  claude: {
    title: 'Connect Claude (Anthropic)',
    icon: '◎',
    steps: [
      { title: 'Get an Anthropic API key', body: 'Go to console.anthropic.com → Settings → API Keys → Create Key. You\'ll need a small amount of credit added first — Haiku is very affordable.', link: 'https://console.anthropic.com/settings/keys' },
      { title: 'Create and copy the key', body: 'Click "Create Key", paste the name below, then copy the key — it starts with "sk-ant-".', copyItems: [{ label: 'Key name', text: 'Nivara' }] },
      { title: 'Paste your API key', body: '', field: 'api_key', fieldLabel: 'Anthropic API Key', fieldPlaceholder: 'sk-ant-...', secret: true },
    ],
  },
  gmail: {
    title: 'Connect Gmail',
    icon:  '✉',
    steps: [
      { title: 'Enable 2-Step Verification', body: 'Gmail App Passwords require 2-Step Verification to be turned on. If you already have it, skip to the next step.', link: 'https://myaccount.google.com/security' },
      {
        title: 'Create an App Password',
        body: 'Go to your Google Account → Security → "App Passwords". Select "Other (Custom name)" as the app type, paste the name below, and click Generate. Copy the 16-character password shown.',
        link: 'https://myaccount.google.com/apppasswords',
        copyItems: [{ label: 'App name', text: 'Nivara' }],
      },
      { title: 'Enter your Gmail address', body: '', field: 'email', fieldLabel: 'Gmail address', fieldPlaceholder: 'you@gmail.com' },
      { title: 'Paste the App Password', body: 'Paste the 16-character App Password you just generated. Spaces are fine — Nivara will clean them up.', field: 'app_password', fieldLabel: 'App Password', fieldPlaceholder: 'xxxx xxxx xxxx xxxx', secret: true },
    ],
  },
  google: {
    title: 'Connect Google (Calendar, Sheets, Drive, Slides)',
    icon:  'G',
    steps: [
      { title: 'Create a Google Cloud project', body: 'Go to console.cloud.google.com and create a new project (or use an existing one). This is free.', link: 'https://console.cloud.google.com/projectcreate' },
      { title: 'Enable APIs', body: 'In your project, go to APIs & Services → Library. Search for and enable each of these APIs one by one.', link: 'https://console.cloud.google.com/apis/library', copyItems: [{ label: 'Google Calendar API', text: 'Google Calendar API' }, { label: 'Google Sheets API', text: 'Google Sheets API' }, { label: 'Google Drive API', text: 'Google Drive API' }] },
      { title: 'Create OAuth credentials', body: 'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID. Choose "Desktop App" as the application type. Paste the name below and click Create.', link: 'https://console.cloud.google.com/apis/credentials/oauthclient', copyItems: [{ label: 'Application name', text: 'Nivara' }] },
      { title: 'Add redirect URI', body: 'In the OAuth client settings, click "Add URI" under Authorized redirect URIs. Copy from below and paste it in, then click Save.', copyItems: [{ label: 'Authorized Redirect URI', text: 'http://127.0.0.1:54322/callback' }] },
      { title: 'Enter your credentials', body: '', field: 'client_id', fieldLabel: 'Client ID', fieldPlaceholder: '123456-abc.apps.googleusercontent.com' },
      { title: 'Enter Client Secret', body: '', field: 'client_secret', fieldLabel: 'Client Secret', fieldPlaceholder: 'GOCSPX-...', secret: true },
    ],
  },
  notion: {
    title: 'Connect Notion',
    icon:  'N',
    steps: [
      {
        title: 'Create a Notion integration',
        body: 'Click the link below. Then:\n\n1. Click "+ New integration"\n2. Set the name (copy from below)\n3. "Authentication method" → choose Access token  ← important\n   (NOT OAuth — that one needs redirect URLs and is for public apps)\n4. Click Submit',
        link: 'https://www.notion.so/my-integrations',
        copyItems: [{ label: 'Integration name', text: 'Nivara' }],
      },
      {
        title: 'Copy your token',
        body: 'On the next page you\'ll see your integration token.\n\nClick "Show" next to "Internal Integration Secret" and copy the value. It starts with "secret_".\n\nPaste it below.',
        field: 'token',
        fieldLabel: 'Integration Token',
        fieldPlaceholder: 'secret_...',
        secret: true,
      },
      {
        title: 'Give Nivara access to a page',
        body: 'Create a page in Notion for Nivara to store automation results, then grant access:\n\n1. In Notion, click "+ New page" in the left sidebar and name it (copy from below)\n2. In Notion, go to Settings → Connections → All Connections\n3. Find "Nivara (Internal)" → click the ··· next to it\n4. Click "Manage Connection" → in the popup click "Go to Manage Page Access"\n5. Select the page you just created → click Save\n\nNivara will automatically create databases inside that page — you never need to touch it again.',
        copyItems: [{ label: 'Page name', text: 'Nivara' }],
      },
    ],
  },
  slack: {
    title: 'Connect Slack',
    icon:  '#',
    steps: [
      { title: 'Create a Slack App', body: 'Go to api.slack.com/apps and click "Create New App" → "From scratch". Paste the app name below, pick your workspace, and click Create App.', link: 'https://api.slack.com/apps/new', copyItems: [{ label: 'App name', text: 'Nivara' }] },
      {
        title: 'Add OAuth scopes',
        body: 'Go to "OAuth & Permissions" → "Scopes" → "Bot Token Scopes". Click "Add an OAuth Scope" and add each scope below one by one.',
        copyItems: [
          { label: 'Scope 1', text: 'channels:read' },
          { label: 'Scope 2', text: 'channels:history' },
          { label: 'Scope 3', text: 'chat:write' },
          { label: 'Scope 4', text: 'search:read' },
          { label: 'Scope 5', text: 'users:read' },
          { label: 'Scope 6', text: 'files:read' },
        ],
      },
      { title: 'Install the app', body: 'Scroll up to "OAuth Tokens for Your Workspace" and click "Install to Workspace". Approve the permissions. Copy the "Bot User OAuth Token" (starts with "xoxb-").' },
      { title: 'Paste the Bot Token', body: '', field: 'bot_token', fieldLabel: 'Bot Token', fieldPlaceholder: 'xoxb-...', secret: true },
    ],
  },
  github: {
    title: 'Connect GitHub',
    icon:  '⌥',
    steps: [
      { title: 'Generate a Personal Access Token', body: 'Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic).', link: 'https://github.com/settings/tokens/new', copyItems: [{ label: 'Note (token name)', text: 'Nivara' }] },
      {
        title: 'Select scopes',
        body: 'Check the scopes below (tick the top-level checkbox for each — it selects all sub-scopes). Set expiration to 90 days. Click Generate token.',
        copyItems: [
          { label: 'Scope 1', text: 'repo' },
          { label: 'Scope 2', text: 'read:user' },
          { label: 'Scope 3', text: 'read:org' },
        ],
      },
      { title: 'Paste the token', body: 'Copy the token immediately — GitHub only shows it once. It starts with "ghp_".', field: 'token', fieldLabel: 'Personal Access Token', fieldPlaceholder: 'ghp_...', secret: true },
    ],
  },
  linear: {
    title: 'Connect Linear',
    icon:  '◈',
    steps: [
      { title: 'Generate an API key', body: 'Go to Linear Settings → API → Personal API keys → Create key. Paste the label below and click Create.', link: 'https://linear.app/settings/api', copyItems: [{ label: 'Key label', text: 'Nivara' }] },
      { title: 'Paste the API key', body: 'Copy and paste the key below. It starts with "lin_api_".', field: 'api_key', fieldLabel: 'API Key', fieldPlaceholder: 'lin_api_...', secret: true },
    ],
  },
  airtable: {
    title: 'Connect Airtable',
    icon:  '▦',
    steps: [
      { title: 'Create a Personal Access Token', body: 'Go to airtable.com/create/tokens (link below). Click "Create new token" and paste the name below.', link: 'https://airtable.com/create/tokens', copyItems: [{ label: 'Token name', text: 'Nivara' }] },
      {
        title: 'Select scopes and bases',
        body: 'Under "Scopes", click "Add a scope" and add each scope below. Under "Access", click "Add a base" and select the bases you want Krew to use.',
        copyItems: [
          { label: 'Scope 1', text: 'data.records:read' },
          { label: 'Scope 2', text: 'data.records:write' },
          { label: 'Scope 3', text: 'schema.bases:read' },
        ],
      },
      { title: 'Paste the token', body: 'Click "Create token", then copy and paste it below. It starts with "pat".', field: 'token', fieldLabel: 'Personal Access Token', fieldPlaceholder: 'pat...', secret: true },
    ],
  },
  brave: {
    title: 'Connect Web Search (Brave)',
    icon:  '⌕',
    steps: [
      { title: 'Get a free Brave Search API key', body: 'Go to api.search.brave.com and sign up. The free tier gives you 2,000 searches/month — more than enough for daily use.', link: 'https://api.search.brave.com/' },
      { title: 'Paste the API key', body: 'After signing up, copy your subscription token from the dashboard and paste it below.', field: 'api_key', fieldLabel: 'Subscription Token', fieldPlaceholder: 'BSA...', secret: true },
    ],
  },
  twitter: {
    title: 'Connect X (Twitter)',
    icon:  '𝕏',
    steps: [
      {
        title: 'Open the X Developer Portal',
        body: 'Click the link below. Sign in with the X account you want Nivara to post from. You\'ll land on a page titled "Tap Into What\'s Happening" with a form to apply for developer access.',
        link: 'https://developer.x.com/en/portal/petition/essential/basic-info',
      },
      {
        title: 'Fill in the application form',
        body: 'Account Name: enter your X username (without the @).\n\nFor the use case description, copy the text below and paste it into the box. Then check all three agreement checkboxes and click Submit.',
        copyItems: [{ label: 'Use case description (paste into the box)', text: 'I use X to share my thoughts, follow developers, and stay updated on tech. I want to connect my personal X account to a private desktop app I use only on my own computer, so I can post from it, read my own mentions, and reply to people who tag me. I am not selling or sharing any data — this is for my personal account only and no one else will have access.' }],
      },
      {
        title: 'Create an App',
        body: 'In the left sidebar click "Apps", then click "+ Add App" or "Create App". Paste the app name below and click Create.\n\nX will show an "Application Created Successfully" screen with 3 values — keep that screen open.',
        link: 'https://developer.x.com/en/portal/apps/new',
        copyItems: [{ label: 'App name', text: 'Nivara' }],
      },
      {
        title: 'Paste your Consumer Key',
        body: 'From the success screen, copy the Consumer Key and paste it below. This is your API Key. Ignore the Bearer Token — you don\'t need it.',
        field: 'api_key',
        fieldLabel: 'Consumer Key (API Key)',
        fieldPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: true,
      },
      {
        title: 'Paste your Secret Key',
        body: 'From the same success screen, copy the Secret Key and paste it below. Then click Done or close the success screen.',
        field: 'api_secret',
        fieldLabel: 'Secret Key (API Secret)',
        fieldPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: true,
      },
      {
        title: 'Enable OAuth 1.0a with Read + Write',
        body: 'Apps → click your app name → scroll to User authentication settings → click the pencil icon.\n\n• App permissions → Read and write\n• Type of App → Native App\n• Callback URI → copy from below\n• Website URL → copy from below\n\nLeave everything else empty. Click Save Changes.',
        copyItems: [
          { label: 'Callback URI / Redirect URL', text: 'http://localhost/' },
          { label: 'Website URL', text: 'https://nivara.tech' },
        ],
      },
      {
        title: 'Generate Access Token and Secret',
        body: 'Apps → click your app name → "Keys and tokens" tab at the top.\n\nUnder "OAuth 1.0 Keys", click the Generate button next to "Access Token — For @yourusername". A popup shows two values — copy both immediately.',
      },
      {
        title: 'Paste Access Token',
        body: 'Paste the Access Token from the popup. It has a dash in it and looks like: 1234567890-AbCdEf...',
        field: 'access_token',
        fieldLabel: 'Access Token',
        fieldPlaceholder: '1234567890-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: true,
      },
      {
        title: 'Paste Access Token Secret',
        body: 'Paste the Access Token Secret — the second value from the same popup.',
        field: 'access_token_secret',
        fieldLabel: 'Access Token Secret',
        fieldPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: true,
      },
    ],
  },
  reddit: {
    title: 'Connect Reddit',
    icon: '👽',
    steps: [
      {
        title: 'Accept the Developer Policy',
        body: 'Reddit requires you to read their policy before creating an app. Open the link below, scroll to the bottom of the page, then come back here and continue.',
        link: 'https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy',
      },
      {
        title: 'Create a Reddit "script" app',
        body: 'Now go to reddit.com/prefs/apps (link below) and scroll to the bottom. Click "create another app…". Fill in each field using the copy buttons below. Select "script" as the type. Click "create app".',
        link: 'https://www.reddit.com/prefs/apps',
        copyItems: [
          { label: 'Name', text: 'Nivara' },
          { label: 'Description', text: 'Personal use script' },
          { label: 'About URL', text: 'http://localhost' },
          { label: 'Redirect URI', text: 'http://localhost' },
        ],
      },
      {
        title: 'Copy your Client ID',
        body: 'After creating the app, you\'ll see it listed. The Client ID is the short string directly under the app name (under "personal use script"). It looks like a random 14-character string.',
        field: 'client_id',
        fieldLabel: 'Client ID',
        fieldPlaceholder: 'xxxxxxxxxxxxxx',
      },
      {
        title: 'Copy your Client Secret',
        body: 'In the same app card, find the row labelled "secret" and copy the value next to it.',
        field: 'client_secret',
        fieldLabel: 'Client Secret',
        fieldPlaceholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        secret: true,
      },
      {
        title: 'Enter your Reddit username',
        body: 'Enter the Reddit username (without u/) of the account that owns the app. This account will be used to post.',
        field: 'username',
        fieldLabel: 'Reddit username',
        fieldPlaceholder: 'your_username',
      },
      {
        title: 'Enter your Reddit password',
        body: 'Enter the password for that Reddit account. Stored locally on your device only — never sent to Nivara servers.',
        field: 'password',
        fieldLabel: 'Reddit password',
        fieldPlaceholder: '••••••••••••',
        secret: true,
      },
    ],
  },
  linkedin: {
    title: 'Connect LinkedIn',
    icon:  'in',
    steps: [
      {
        title: 'Log into LinkedIn first',
        body: 'The LinkedIn developer portal requires you to be logged in. Open LinkedIn in your browser and sign in before continuing — otherwise you\'ll get a broken redirect.',
        link: 'https://www.linkedin.com/login',
      },
      {
        title: 'Find or create your LinkedIn Company Page',
        body: 'LinkedIn requires a Company Page (not a personal profile) linked to every developer app.\n\nIf you already have a company or brand page on LinkedIn, skip to the next step — you\'ll use that.\n\nIf you don\'t have one yet, click the link below to create a free one in 30 seconds. Use your own brand or business name (not "Nivara"). After creating it, copy the page URL from your browser — you\'ll need it next.',
        link: 'https://www.linkedin.com/company/setup/new/',
      },
      {
        title: 'Create the Developer App',
        body: 'Go to the LinkedIn Developer portal (link below). On the create form:\n\n• App name → copy from below\n• LinkedIn Page → type your company/brand name and select your page from the dropdown (this is YOUR company page, not Nivara\'s)\n• Privacy policy URL → copy from below\n• App logo → skip (optional)\n• Check the "I have read and agree" checkbox\n\nClick "Create app".',
        link: 'https://www.linkedin.com/developers/apps/new',
        copyItems: [
          { label: 'App name', text: 'Nivara' },
          { label: 'Privacy policy URL', text: 'https://nivara.tech/privacy' },
        ],
      },
      {
        title: 'Request the required products',
        body: 'In your new app, click the "Products" tab. Find and click "Request access" for both products below. Both are approved instantly — no review needed.',
        copyItems: [
          { label: 'Product 1', text: 'Share on LinkedIn' },
          { label: 'Product 2', text: 'Sign In with LinkedIn using OpenID Connect' },
        ],
      },
      {
        title: 'Add the redirect URL',
        body: 'Click the "Auth" tab → scroll to "OAuth 2.0 settings" → "Authorized Redirect URLs for your app". Click the pencil icon or "Add redirect URL", paste from below, then click Save.',
        copyItems: [{ label: 'Redirect URL', text: 'http://127.0.0.1:54323/linkedin/callback' }],
      },
      {
        title: 'Copy your Client ID',
        body: 'Still on the "Auth" tab, copy the Client ID shown at the top of the page.',
        field: 'client_id',
        fieldLabel: 'Client ID',
        fieldPlaceholder: '86xxxxxxxxxxxxxxxx',
      },
      {
        title: 'Copy your Client Secret',
        body: 'Still on the "Auth" tab, click "Generate and copy" under Primary Client Secret. Paste it below.',
        field: 'client_secret',
        fieldLabel: 'Client Secret',
        fieldPlaceholder: 'xxxxxxxxxxxxxx',
        secret: true,
      },
    ],
  },
};

export default function ServiceSetupModal({ service, onDone, onClose }: Props) {
  const guide = GUIDES[service];
  if (!guide) return null;

  const [step,   setStep]   = useState(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error,  setError]  = useState('');
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [linkedInConnecting, setLinkedInConnecting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const currentStep = guide.steps[step];
  const isLast      = step === guide.steps.length - 1;
  const hasField    = !!currentStep.field;

  async function handleNext() {
    setError('');
    if (isLast) {
      await finish();
    } else {
      if (hasField && !fields[currentStep.field!]?.trim()) {
        setError('This field is required.');
        return;
      }
      setStep((s) => s + 1);
    }
  }

  async function finish() {
    setLoading(true);
    try {
      if (service === 'google') {
        await startGoogleOAuth();
      } else if (service === 'linkedin') {
        await startLinkedInOAuth();
      } else {
        await credentialStore.save(service, fields);
        onDone();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function startGoogleOAuth() {
    const { client_id, client_secret } = fields;
    if (!client_id || !client_secret) { setError('Client ID and Client Secret are required.'); return; }

    setGoogleConnecting(true);

    // Start callback server
    await invoke('start_google_oauth_server');

    // Build OAuth URL
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/presentations.readonly',
    ].join(' ');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: 'http://127.0.0.1:54322/callback',
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
    });
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

    // Open in browser
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(oauthUrl);

    // Poll for code
    const poll = setInterval(async () => {
      const result = await invoke<string | null>('poll_google_auth_code');
      if (!result) return;
      clearInterval(poll);
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) { setError(parsed.error); setGoogleConnecting(false); return; }
        if (parsed.code) {
          const tokenJson = await invoke<string>('google_exchange_code', {
            clientId: client_id, clientSecret: client_secret, code: parsed.code,
          });
          const tokens = JSON.parse(tokenJson);
          await credentialStore.save('google', {
            client_id,
            client_secret,
            access_token:  tokens.access_token  ?? '',
            refresh_token: tokens.refresh_token ?? '',
            expires_at:    String(Date.now() + (tokens.expires_in ?? 3600) * 1000),
          });
          setGoogleConnecting(false);
          onDone();
        }
      } catch (e) {
        setError(String(e));
        setGoogleConnecting(false);
      }
    }, 1000);
  }

  async function startLinkedInOAuth() {
    const { client_id, client_secret } = fields;
    if (!client_id || !client_secret) { setError('Client ID and Client Secret are required.'); return; }

    setLinkedInConnecting(true);
    await invoke('start_linkedin_oauth_server');

    const params = new URLSearchParams({
      client_id,
      redirect_uri:  'http://127.0.0.1:54323/linkedin/callback',
      response_type: 'code',
      scope:         'openid profile email w_member_social',
      state:         crypto.randomUUID(),
    });
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(`https://www.linkedin.com/oauth/v2/authorization?${params}`);

    const poll = setInterval(async () => {
      const result = await invoke<string | null>('poll_linkedin_auth_code');
      if (!result) return;
      clearInterval(poll);
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) { setError(parsed.error); setLinkedInConnecting(false); return; }
        if (parsed.code) {
          const tokenJson = await invoke<string>('linkedin_exchange_code', {
            clientId: client_id, clientSecret: client_secret, code: parsed.code,
          });
          const tokens = JSON.parse(tokenJson);
          await credentialStore.save('linkedin', {
            client_id,
            client_secret,
            access_token: tokens.access_token ?? '',
            expires_at:   String(Date.now() + (tokens.expires_in ?? 5183944) * 1000),
          });
          setLinkedInConnecting(false);
          onDone();
        }
      } catch (e) {
        setError(String(e));
        setLinkedInConnecting(false);
      }
    }, 1000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-nv-surface border border-nv-border rounded-2xl w-[460px] max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-nv-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-accent text-sm font-bold">
              {guide.icon}
            </span>
            <span className="text-[13px] font-semibold text-nv-text">{guide.title}</span>
          </div>
          <button onClick={onClose} className="text-nv-faint hover:text-nv-text text-xl transition-fast">×</button>
        </div>

        {/* Step progress */}
        <div className="flex gap-1 px-5 pt-4 shrink-0">
          {guide.steps.map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full transition-all ${i <= step ? 'bg-accent' : 'bg-nv-border'}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[11px] text-nv-faint font-mono uppercase tracking-wider mb-1">
            Step {step + 1} of {guide.steps.length}
          </p>
          <h3 className="text-[14px] font-semibold text-nv-text mb-3">{currentStep.title}</h3>

          {currentStep.body && (
            <p className="text-[12px] text-nv-muted leading-relaxed mb-3 whitespace-pre-wrap">
              {currentStep.body.split(/(\*\*[^*]+\*\*)/).map((chunk, i) =>
                chunk.startsWith('**') && chunk.endsWith('**')
                  ? <span key={i} className="font-semibold text-nv-text">{chunk.slice(2, -2)}</span>
                  : chunk
              )}
            </p>
          )}

          {currentStep.link && (
            <a
              href={currentStep.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-accent hover:underline mb-4"
            >
              Open in browser →
            </a>
          )}

          {[
            ...(currentStep.copyItems ?? []),
            ...(currentStep.copyText ? [{ label: 'Copy and paste this', text: currentStep.copyText }] : []),
          ].map(({ label, text }) => (
            <div key={label} className="mb-3 rounded-lg border border-nv-border bg-nv-bg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-nv-border bg-nv-surface2">
                <span className="text-[10px] text-nv-faint font-mono uppercase tracking-wider">{label}</span>
                <button
                  onClick={() => copyToClipboard(text, label)}
                  className="flex items-center gap-1 text-[10px] font-mono text-accent hover:text-accent-dim transition-fast"
                >
                  {copiedKey === label ? (
                    <><svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Copied!</>
                  ) : (
                    <><svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><rect x="1" y="3" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/><path d="M4 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.2"/></svg>Copy</>
                  )}
                </button>
              </div>
              <p className="px-3 py-2.5 text-[11px] text-nv-muted leading-relaxed whitespace-pre-wrap font-mono select-all">
                {text}
              </p>
            </div>
          ))}

          {currentStep.field && (
            <div className="mt-2">
              <label className="block text-[11px] text-nv-faint mb-1">{currentStep.fieldLabel}</label>
              <input
                type={currentStep.secret ? 'password' : 'text'}
                value={fields[currentStep.field] ?? ''}
                onChange={(e) => setFields((f) => ({ ...f, [currentStep.field!]: e.target.value }))}
                placeholder={currentStep.fieldPlaceholder}
                autoFocus
                className="w-full bg-nv-bg border border-nv-border rounded-lg px-3 py-2 text-[12px]
                  text-nv-text outline-none focus:border-accent transition-fast font-mono"
              />
            </div>
          )}

          {error && (
            <p className="mt-3 text-[11px] text-nv-red bg-nv-red/10 border border-nv-red/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {googleConnecting && (
            <div className="mt-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
              <p className="text-[11px] text-accent font-mono">
                Waiting for Google sign-in… complete it in your browser, then come back here.
              </p>
            </div>
          )}

          {linkedInConnecting && (
            <div className="mt-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
              <p className="text-[11px] text-accent font-mono">
                Waiting for LinkedIn sign-in… approve the permissions in your browser, then come back here.
              </p>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-nv-border shrink-0">
          <button
            onClick={() => step > 0 ? setStep((s) => s - 1) : onClose()}
            className="text-[12px] text-nv-muted hover:text-nv-text transition-fast"
          >{step > 0 ? '← Back' : 'Cancel'}</button>
          <button
            onClick={handleNext}
            disabled={loading || googleConnecting || linkedInConnecting}
            className="text-[12px] px-4 py-1.5 rounded-lg bg-accent text-white
              hover:bg-accent-dim transition-fast disabled:opacity-50"
          >
            {loading ? 'Connecting…' : isLast
              ? service === 'google' ? 'Open Google Sign-in →'
              : service === 'linkedin' ? 'Open LinkedIn Sign-in →'
              : 'Connect'
              : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
