import BrandLogo from '../ui/BrandLogo';
import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from '../../lib/krewDb';
import ServiceSetupModal from './ServiceSetupModal';
import { peekServiceRequest, requestServiceSetup, clearServiceRequest } from '../../lib/connectAppsRequest';
import { listMcpServers, connectMcpServer, removeMcpServer, refreshMcpServer, type McpServer } from '../../lib/krewMcp';
import { useAuth } from '../../contexts/AuthContext';
import { getPlanConfig } from '../../lib/planConfig';

interface ServiceDef {
  id:     string;
  name:   string;
  desc:   string;
  note?:  string;
  tags:   string[];
  usedBy: string[];
}

// Brand marks live in components/ui/BrandLogo so the title-bar AI menu can use the same ones.
const PlatformLogo = BrandLogo;

// ─── Brand accent colors ──────────────────────────────────────────────────────

const BRAND_COLOR: Record<string, string> = {
  gemini:   'text-blue-400',
  openai:   'text-emerald-400',
  claude:   'text-orange-400',
  nvidia:   'text-green-500',
  groq:     'text-orange-300',
  brave:    'text-orange-500',
  gmail:    'text-red-400',
  google:   'text-blue-400',
  notion:   'text-nv-text',
  slack:    'text-purple-400',
  github:   'text-nv-text',
  linear:   'text-violet-400',
  airtable: 'text-cyan-400',
  twitter:  'text-nv-text',
  linkedin: 'text-blue-500',
  reddit:   'text-orange-500',
  telegram:   'text-sky-400',
  twilio:     'text-red-400',
  hubspot:    'text-orange-400',
  stripe:     'text-violet-400',
  discord:    'text-indigo-400',
  figma:      'text-pink-400',
  shopify:    'text-emerald-400',
  serper:     'text-blue-400',
  crunchbase: 'text-orange-400',
  jira:       'text-blue-500',
  vercel:     'text-nv-text',
  runway:     'text-sky-400',
  heygen:     'text-violet-400',
  elevenlabs: 'text-amber-400',
  did:        'text-pink-400',
  higgsfield: 'text-cyan-400',
  instagram:  'text-pink-500',
};

// ─── Service definitions ──────────────────────────────────────────────────────

const SERVICES: ServiceDef[] = [
  // AI providers
  { id: 'gemini',   name: 'Gemini (Google AI)',  desc: 'Powers Krew, Guard and Automation. Free tier — generous Flash model allowance.',       tags: ['ai','llm','google'],                     usedBy: ['Krew','Automation','Guard'] },
  { id: 'openai',   name: 'OpenAI (GPT-4o)',     desc: 'Powers Krew and Automation with GPT-4o mini. Pay-per-use, very affordable.',            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  { id: 'claude',   name: 'Claude (Anthropic)',  desc: 'Powers Krew and Automation with Claude Haiku. Pay-per-use.',                            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  { id: 'nvidia',   name: 'NVIDIA (free API)',   desc: 'Free API key from build.nvidia.com — fast, GPU-hosted open models. A quick, free alternative to a slow local model, at no adris.tech token cost.', tags: ['ai','llm','free','nvidia'],       usedBy: ['Krew','Automation','Guard'] },
  { id: 'groq',     name: 'Groq (free · fastest)', desc: 'Free API key from console.groq.com — the fastest free option, usually answering in a second or two. No adris.tech tokens used.', tags: ['ai','llm','free','fast'],           usedBy: ['Krew','Automation','Guard'] },
  // Tools
  { id: 'brave',    name: 'Web Search',          desc: 'Brave Search API (paid) — more reliable web & lead lookups than the built-in keyless search.', tags: ['search'],                                usedBy: ['Krew'] },
  { id: 'gmail',    name: 'Gmail',               desc: 'Read and search inbox via IMAP. Used by Automation email triggers and Guard.',           note: 'Read-only. Connect Google Suite below to send emails.',           tags: ['email','google'],                        usedBy: ['Krew','Automation','Guard'] },
  { id: 'google',   name: 'Google Suite',        desc: 'Calendar, Sheets, Drive, Slides — connected once, works across all four.',              note: 'Also required to send emails via Krew agents.',                   tags: ['calendar','sheets','drive','slides'],     usedBy: ['Krew','Automation'] },
  { id: 'notion',   name: 'Notion',              desc: 'Search pages, read databases, create pages. Also used by Automation → Notion output.',  tags: ['notes','docs'],                          usedBy: ['Krew','Automation'] },
  { id: 'slack',    name: 'Slack',               desc: 'Read channels, send messages, search workspace. Used by Automation → Slack output.',    tags: ['chat','messaging'],                      usedBy: ['Krew','Automation'] },
  { id: 'github',   name: 'GitHub',              desc: 'List repos, read files, create issues, search code. Used by Guard vuln scanner.',       tags: ['code','git'],                            usedBy: ['Krew','Guard'] },
  { id: 'linear',   name: 'Linear',              desc: 'Fetch and create issues in your Linear workspace.',                                      tags: ['issues','project'],                      usedBy: ['Krew'] },
  { id: 'airtable', name: 'Airtable',            desc: 'Read and write records in any Airtable base.',                                          tags: ['data','spreadsheet'],                    usedBy: ['Krew','Automation'] },
  // Social / Marketing
  { id: 'twitter',  name: 'X (Twitter)',         desc: 'Post tweets, read timeline, search mentions. Used by Krew and Automation.',             tags: ['social','twitter','x','marketing'],      usedBy: ['Krew','Automation'] },
  { id: 'linkedin', name: 'LinkedIn',            desc: 'Post to your feed, read your profile. Used by Krew for content publishing.',            tags: ['social','linkedin','marketing'],          usedBy: ['Krew','Automation'] },
  // Automation outputs
  { id: 'telegram', name: 'Telegram',            desc: 'Send messages via a Telegram bot. Used by Automation → Telegram output.',               tags: ['chat','messaging','automation'],          usedBy: ['Automation'] },
  { id: 'twilio',   name: 'Twilio (SMS)',        desc: 'Send SMS messages via Twilio. Used by Automation → SMS output.',                         tags: ['sms','messaging','automation'],           usedBy: ['Automation'] },
  { id: 'hubspot',  name: 'HubSpot CRM',         desc: 'Create contacts, deals, and notes in HubSpot. Used by Automation → HubSpot output.',     tags: ['crm','sales','automation'],              usedBy: ['Automation'] },
  // Payments & E-commerce
  { id: 'stripe',   name: 'Stripe',              desc: 'Payment triggers — fire automations on payment success, failure, refund, or churn events.',  tags: ['payments','automation'],                 usedBy: ['Automation'] },
  { id: 'shopify',  name: 'Shopify',             desc: 'Read products, orders, and customer data from your Shopify store.',                           tags: ['ecommerce','sales'],                     usedBy: ['Krew'] },
  // Communication
  { id: 'discord',  name: 'Discord',             desc: 'Post to a Discord channel via webhook. Used by Automation → Discord output.',                tags: ['chat','messaging','automation'],          usedBy: ['Automation'] },
  // Design
  { id: 'figma',    name: 'Figma',               desc: 'Read design files, inspect components, and export assets from your Figma workspace.',         tags: ['design','ui'],                           usedBy: ['Krew'] },
  // Project management
  { id: 'jira',     name: 'Jira (Atlassian)',    desc: 'Create and read issues, update sprint tickets, and track bugs in Jira Cloud.',                tags: ['issues','project','engineering'],         usedBy: ['Krew'] },
  // Search & Data
  { id: 'serper',   name: 'Serper (Google Search)', desc: 'Google Search API — better results for Research agent. 2.5K free searches/month.',      note: 'Improves research quality over the default DuckDuckGo fallback.', tags: ['search'],  usedBy: ['Krew','Research'] },
  { id: 'crunchbase', name: 'Crunchbase',        desc: 'Startup and company data — funding rounds, investors, headcount. Used by Research agent.',   tags: ['data','research','startups'],            usedBy: ['Research'] },
  // Deployment
  { id: 'vercel',    name: 'Vercel',             desc: 'Deploy websites to a live URL in seconds. Krew\'s deploy agent pushes your site and returns a real vercel.app link.', note: 'Required for "deploy my website" tasks.', tags: ['deploy','hosting','website'],            usedBy: ['Krew'] },
  // Video AI MCPs
  { id: 'runway',    name: 'Runway ML',          desc: 'AI video generation — turn images or text into cinematic video clips. Used by Krew to create marketing videos.',      tags: ['video','ai','marketing','creative'],     usedBy: ['Krew'] },
  { id: 'heygen',    name: 'HeyGen',             desc: 'AI avatar video creation — generate talking-head marketing videos with a digital spokesperson using your brand.',     tags: ['video','ai','avatar','marketing'],        usedBy: ['Krew'] },
  { id: 'elevenlabs', name: 'ElevenLabs',        desc: 'AI voice synthesis — generate professional voiceovers for marketing videos, product demos, and ads.',                  tags: ['audio','voice','ai','marketing'],         usedBy: ['Krew'] },
  { id: 'did',        name: 'D-ID',               desc: 'Talking avatar videos — upload a photo and generate a realistic video with lip-sync audio. Great for product promos.', tags: ['video','ai','avatar','marketing'],        usedBy: ['Krew'] },
  { id: 'higgsfield', name: 'Higgsfield AI',      desc: 'MCP server with 30+ video models — Veo 3.1, Sora 2, Kling 3.0, Runway, and more. Best single MCP for video generation. URL: https://mcp.higgsfield.ai/mcp', note: 'Authenticate with your Higgsfield account when connecting.', tags: ['video','ai','mcp','marketing','creative'], usedBy: ['Krew'] },
  // Social publishing
  { id: 'instagram',  name: 'Instagram',          desc: 'Post photos, videos, Reels and Stories to your Instagram Business or Creator account. Krew can publish generated videos here.', note: 'Requires an Instagram Business or Creator account linked to a Facebook Page.', tags: ['social','video','marketing','publishing'],  usedBy: ['Krew','Automation'] },
];

interface Props { onClose?: () => void }

export default function ConnectApps({ onClose }: Props) {
  const [connected, setConnected] = useState<string[]>([]);
  const [setup,     setSetup]     = useState<string | null>(null);
  const [search,    setSearch]    = useState('');

  const reload = useCallback(() => {
    credentialStore.list()
      .then((ids) => setConnected(ids.filter((id) => !id.startsWith('__'))))
      .catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Auto-open setup modal if a tool pre-selected a service — PEEK (not consume), so switching to
  // another tab and back re-opens the same wizard instead of losing it (see connectAppsRequest.ts).
  useEffect(() => {
    const pending = peekServiceRequest();
    if (pending) setSetup(pending);
  }, []);

  async function disconnect(service: string) {
    await credentialStore.delete(service).catch(() => {});
    reload();
  }

  async function disconnectAll() {
    await Promise.all(connected.map(s => credentialStore.delete(s).catch(() => {})));
    reload();
  }

  // Higgsfield is a real MCP server — route its tile into the MCP connect flow
  // (the live protocol path) instead of the static credential modal.
  function openService(id: string) {
    if (id === 'higgsfield') {
      window.dispatchEvent(new CustomEvent('nv-mcp-prefill', {
        detail: { name: 'Higgsfield AI', url: 'https://mcp.higgsfield.ai/mcp' },
      }));
      return;
    }
    setSetup(id);
    requestServiceSetup(id); // persist so a tab switch + return resumes on this same service
  }

  const filtered = SERVICES.filter(s => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.tags.some(t => t.includes(q));
  });

  const connectedServices = filtered.filter(s =>  connected.includes(s.id));
  const availableServices = filtered.filter(s => !connected.includes(s.id));

  return (
    <>
      <div className="flex flex-col h-full bg-nv-bg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-nv-border shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold text-nv-text">Connect Apps</h2>
            <p className="text-[10px] text-nv-faint">
              Used by Krew · Guard · Automation &nbsp;·&nbsp; Stored locally, never sent to adris.tech servers
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-nv-faint hover:text-nv-text text-xl transition-fast">×</button>
          )}
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-nv-border shrink-0 flex items-center gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-nv-faint pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full bg-nv-surface border border-nv-border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-nv-text outline-none focus:border-accent transition-fast placeholder:text-nv-faint"
            />
          </div>
          <span className="text-[10px] font-mono text-nv-faint shrink-0">{connected.length} connected</span>
        </div>

        {/* Token savings banner */}
        <div className="mx-5 mt-3 mb-1 flex items-start gap-3 rounded-xl bg-nv-surface border border-nv-border px-4 py-3 shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-nv-green mt-0.5 shrink-0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <p className="text-[11px] text-nv-muted leading-relaxed">
            <span className="text-nv-text font-medium">Connected apps use up to 4× fewer AI tokens.</span>
            {' '}Direct API calls are faster and more accurate than browser navigation — Gmail, LinkedIn, Notion, and Slack cost far less quota when connected.
          </p>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          <McpSection />

          {connectedServices.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-nv-green" />
                  <p className="text-[11px] font-mono text-nv-muted uppercase tracking-widest">Connected · {connectedServices.length}</p>
                </div>
                <button onClick={disconnectAll} className="text-[10px] font-mono text-nv-muted hover:text-nv-bad transition-fast">Disconnect all</button>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {connectedServices.map(s => (
                  <ServiceCard key={s.id} service={s} isConnected onConnect={() => openService(s.id)} onDisconnect={() => disconnect(s.id)} />
                ))}
              </div>
            </section>
          )}

          {availableServices.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-nv-faint" />
                <p className="text-[11px] font-mono text-nv-faint uppercase tracking-widest">Available · {availableServices.length}</p>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {availableServices.map(s => (
                  <ServiceCard key={s.id} service={s} isConnected={false} onConnect={() => openService(s.id)} onDisconnect={() => {}} />
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-nv-faint text-[11px]">No apps match your search.</p>
            </div>
          )}
        </div>
      </div>

      {setup && (
        <ServiceSetupModal service={setup} onDone={() => { setSetup(null); clearServiceRequest(); reload(); }} onClose={() => { setSetup(null); clearServiceRequest(); }} />
      )}
    </>
  );
}

type TestState = 'idle' | 'testing' | 'ok' | 'error';

function ServiceCard({ service, isConnected, onConnect, onDisconnect }: {
  service: ServiceDef; isConnected: boolean; onConnect: () => void; onDisconnect: () => void;
}) {
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMsg,   setTestMsg]   = useState('');
  const color = BRAND_COLOR[service.id] ?? 'text-nv-faint';

  async function runTest() {
    setTestState('testing');
    setTestMsg('');
    try {
      const creds = await credentialStore.get(service.id);
      const result = await invoke<string>('ping_service', {
        serviceId:  service.id,
        credsJson:  JSON.stringify(creds ?? {}),
      });
      setTestState('ok');
      setTestMsg(result);
    } catch (err: unknown) {
      const msg = String(err);
      // ── A DEAD MODEL SHOULD BE SWAPPED, NOT JUST REPORTED ──────────────────────────────────
      //
      // The test already worked out the truth: "Your API key is VALID, but the selected model
      // nvidia/nemotron-3-ultra-550b-a55b never answered ... choose another". Measured against the
      // live endpoint, that model does not respond inside sixty seconds while the same key answers
      // in under two on others. But the test only SAID so — the dead model stayed selected, so the
      // next message went straight back to it and came back "the model accepted the request and
      // sent nothing back". The user was left reading a diagnosis and being asked to go and fix it
      // by hand, having already pressed the button whose whole job is to find this out.
      //
      // The working model the test just proved is now written to the credential, so the next
      // message actually works. Said plainly, because silently changing someone's model would be
      // its own kind of wrong.
      const dead = msg.match(/selected model "([^"]+)" never answered/i);
      const alive = msg.match(/choose another — "([^"]+)" works/i);
      if (dead && alive) {
        try {
          const { setByokModel } = await import('../../lib/byokKeys');
          await setByokModel(service.id, alive[1]);
          setTestState('ok');
          setTestMsg(`"${dead[1]}" never answers on your account — NVIDIA lists models it will not actually serve. Switched you to "${alive[1]}", which answered. You can pick a different one in the model list any time.`);
          return;
        } catch { /* fall through to the plain error below */ }
      }
      setTestState('error');
      setTestMsg(msg);
    }
  }

  // Reset test state when connection changes
  useEffect(() => { setTestState('idle'); setTestMsg(''); }, [isConnected]);

  return (
    <div className={`flex flex-col gap-2 p-3 rounded-xl border transition-fast ${
      isConnected ? 'bg-nv-surface border-nv-green/30' : 'bg-nv-surface border-nv-border hover:border-accent/40'
    }`}>
      {/* Logo + name + dot */}
      <div className="flex items-center gap-2.5">
        <div className={`w-8 h-8 rounded-lg bg-nv-bg flex items-center justify-center shrink-0 border border-nv-border ${color}`}>
          <PlatformLogo id={service.id} className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <p className="text-[12px] font-semibold text-nv-text leading-tight truncate">{service.name}</p>
          {isConnected && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nv-green/15 text-nv-green font-mono leading-none shrink-0">●</span>}
        </div>
      </div>

      {/* Desc */}
      <p className="text-[11px] text-nv-muted leading-snug line-clamp-2">{service.desc}</p>
      {service.note && (
        <p className="text-[10px] text-nv-yellow leading-snug mt-1">
          <span className="font-semibold">Note:</span> {service.note}
        </p>
      )}

      {/* Test result */}
      {testState !== 'idle' && (
        <div className={`flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono leading-snug ${
          testState === 'testing' ? 'bg-nv-bg text-nv-muted' :
          testState === 'ok'      ? 'bg-nv-green/10 text-nv-green border border-nv-green/20' :
                                    'bg-nv-bad/10 text-nv-bad border border-nv-bad/20'
        }`}>
          <span className="shrink-0 mt-px">
            {testState === 'testing' ? '⟳' : testState === 'ok' ? '✓' : '✕'}
          </span>
          <span>{testState === 'testing' ? 'Testing connection…' : testMsg}</span>
        </div>
      )}

      {/* Tags + buttons */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex gap-1 flex-wrap">
          {service.usedBy.map(m => (
            <span key={m} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-nv-bg border border-nv-border text-nv-faint">{m}</span>
          ))}
        </div>
        {isConnected ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={runTest}
              disabled={testState === 'testing'}
              className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-mono transition-fast ${
                testState === 'ok'    ? 'border-nv-green/40 text-nv-green bg-nv-green/8' :
                testState === 'error' ? 'border-nv-bad/40 text-nv-bad bg-nv-bad/8' :
                                        'border-nv-border text-nv-muted hover:border-accent/50 hover:text-accent'
              }`}
            >
              {testState === 'testing' ? '…' : testState === 'ok' ? '✓ OK' : testState === 'error' ? '✕ Retry' : 'Test'}
            </button>
            <button onClick={onDisconnect} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-border shrink-0 text-nv-muted hover:border-nv-bad hover:text-nv-bad transition-fast font-mono">
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={onConnect} className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white shrink-0 hover:bg-accent/85 transition-fast font-mono font-medium">
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Custom MCP servers ───────────────────────────────────────────────────────
// Connect Krew to ANY Model Context Protocol server by URL. The server's tools
// are discovered automatically and handed to every Krew agent.

// Popular hosted MCP servers that work with a plain URL (+ optional token) — no
// developer setup, no GitHub. One click prefills the form. Users can still paste
// any other server URL manually.
interface McpPreset { name: string; url: string; desc: string; auth: 'none' | 'optional' | 'token' }
const MCP_PRESETS: McpPreset[] = [
  { name: 'DeepWiki',      url: 'https://mcp.deepwiki.com/mcp',  desc: 'Ask anything about any public GitHub repo', auth: 'none' },
  { name: 'Hugging Face',  url: 'https://huggingface.co/mcp',    desc: 'Search AI models, datasets & spaces',        auth: 'optional' },
  { name: 'Context7',      url: 'https://mcp.context7.com/mcp',  desc: 'Up-to-date docs for any code library',       auth: 'optional' },
  { name: 'Higgsfield AI', url: 'https://mcp.higgsfield.ai/mcp', desc: '30+ video models — Veo, Sora, Kling…',        auth: 'token' },
  // OpenSEO (MIT, github.com/every-app/open-seo) ships an MCP server, which is why it belongs here
  // rather than in the codebase: connecting it hands every agent real keyword, rank, backlink and
  // site-audit data with no code of ours to maintain. It is SELF-HOSTED — the URL is wherever the
  // user runs it — and its data comes from DataForSEO, which is paid and needs the user's own key,
  // so this is listed honestly as bring-your-own rather than as a free feature.
  { name: 'OpenSEO',       url: 'http://localhost:3000/mcp',     desc: 'Keyword research, rank tracking, backlinks, site audits — self-host it, then point this at your instance (needs a DataForSEO key)', auth: 'optional' },
];

function McpSection() {
  const { profile } = useAuth();
  const cap = getPlanConfig(profile?.plan ?? 'explore').mcpConnections;

  const [servers,    setServers]    = useState<McpServer[]>([]);
  const [showForm,   setShowForm]   = useState(false);
  const [name,       setName]       = useState('');
  const [url,        setUrl]        = useState('');
  const [token,      setToken]      = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');

  const reload = useCallback(() => {
    listMcpServers().then(setServers).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Prefill the form when another card (e.g. the Higgsfield tile) routes here.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const d = (e as CustomEvent<{ name?: string; url?: string }>).detail || {};
      setName(d.name ?? ''); setUrl(d.url ?? ''); setToken(''); setError('');
      setShowForm(true);
    };
    window.addEventListener('nv-mcp-prefill', onPrefill);
    return () => window.removeEventListener('nv-mcp-prefill', onPrefill);
  }, []);

  function prefill(p: McpPreset) {
    setName(p.name); setUrl(p.url); setToken(''); setError(''); setShowForm(true);
  }

  const atCap = servers.length >= cap;
  const connectedUrls = new Set(servers.map((s) => s.url));

  async function add() {
    setError('');
    setBusy(true);
    try {
      await connectMcpServer({ name, url, authValue: token });
      setName(''); setUrl(''); setToken('');
      setShowForm(false);
      reload();
      window.dispatchEvent(new Event('nv-mcp-changed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await removeMcpServer(id).catch(() => {});
    reload();
    window.dispatchEvent(new Event('nv-mcp-changed'));
  }

  const [refreshing, setRefreshing] = useState<string | null>(null);
  async function refresh(id: string) {
    setRefreshing(id);
    try {
      await refreshMcpServer(id);
      reload();
      window.dispatchEvent(new Event('nv-mcp-changed'));
    } catch { /* leave existing tools as-is on failure */ }
    finally { setRefreshing(null); }
  }

  const totalTools = servers.reduce((n, s) => n + s.tools.length, 0);

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <p className="text-[11px] font-mono text-nv-muted uppercase tracking-widest">
            MCP Servers · {servers.length}{totalTools > 0 ? ` · ${totalTools} tools` : ''}
          </p>
        </div>
        <span className="text-[10px] font-mono text-nv-faint">{servers.length}/{cap === 999 ? '∞' : cap} on your plan</span>
      </div>

      <div className="rounded-xl bg-nv-surface border border-nv-border p-3 flex flex-col gap-3">
        <p className="text-[11px] text-nv-muted leading-relaxed">
          Connect any <span className="text-nv-text font-medium">MCP server</span> by URL and Krew agents instantly gain its tools —
          Notion, Linear, Zapier, Composio, Higgsfield, or your own. Paste the server URL, add a token if it needs one, and we discover everything it can do.
        </p>

        {/* Connected MCP servers */}
        {servers.map((s) => (
          <div key={s.id} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-nv-bg border border-nv-border">
            <div className="w-7 h-7 rounded-lg bg-nv-surface flex items-center justify-center shrink-0 border border-nv-border text-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="8" height="8" rx="1.5"/><rect x="14" y="2" width="8" height="8" rx="1.5"/><rect x="8" y="14" width="8" height="8" rx="1.5"/>
                <path d="M6 10v2a2 2 0 0 0 2 2h0M18 10v2a2 2 0 0 1-2 2h0"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-[12px] font-semibold text-nv-text leading-tight truncate">{s.name}</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-nv-green/15 text-nv-green font-mono leading-none shrink-0">{s.tools.length} tools</span>
              </div>
              <p className="text-[10px] text-nv-faint font-mono truncate">{s.url}</p>
            </div>
            <button onClick={() => refresh(s.id)} disabled={refreshing === s.id} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-border shrink-0 text-nv-muted hover:border-accent/50 hover:text-accent transition-fast font-mono disabled:opacity-50">
              {refreshing === s.id ? '…' : 'Refresh'}
            </button>
            <button onClick={() => remove(s.id)} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-nv-border shrink-0 text-nv-muted hover:border-nv-bad hover:text-nv-bad transition-fast font-mono">
              Remove
            </button>
          </div>
        ))}

        {/* Add form */}
        {showForm ? (
          <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-nv-bg border border-nv-border">
            <input
              value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. Notion)"
              className="w-full bg-nv-surface border border-nv-border rounded-lg px-3 py-1.5 text-[12px] text-nv-text outline-none focus:border-accent transition-fast placeholder:text-nv-faint"
            />
            <input
              value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="MCP server URL (https://…/mcp)"
              className="w-full bg-nv-surface border border-nv-border rounded-lg px-3 py-1.5 text-[12px] text-nv-text outline-none focus:border-accent transition-fast placeholder:text-nv-faint font-mono"
            />
            <input
              value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="Access token — optional (only if the server needs auth)"
              type="password"
              className="w-full bg-nv-surface border border-nv-border rounded-lg px-3 py-1.5 text-[12px] text-nv-text outline-none focus:border-accent transition-fast placeholder:text-nv-faint"
            />
            {error && <p className="text-[10px] text-nv-bad leading-snug font-mono">{error}</p>}
            {/* WHAT TO ACTUALLY PLUG IN HERE.
                A blank URL box is only useful to someone who already knows an MCP server exists and
                what its address is. Naming a real one that suits this app's users turns the field
                from a developer feature into something with an obvious first use — and a connected
                server's tools reach the boss, every delegation and every pipeline stage, so it is
                usable inside a task rather than only from the chat.
                No URL is hardcoded on purpose: it belongs to the provider, it changes, and a
                plausible-looking address that turns out to be wrong is worse than none. */}
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--nv-faint)' }}>
              Any MCP server works here, and its tools become available to every agent — including
              inside a plan or a work order. For lead work, <span className="text-nv-text">Vibe
              Prospecting</span> (Explorium) is a good one: conversational access to a large B2B
              contact and company database. Its free tier is a limited trial rather than an ongoing
              free allowance, so it sits here as a connection rather than inside the built-in lead
              search — copy the server URL from the provider's own setup page and paste it above.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={add}
                disabled={busy || !url.trim()}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/85 transition-fast font-mono font-medium disabled:opacity-40"
              >
                {busy ? 'Connecting…' : 'Connect & discover tools'}
              </button>
              <button onClick={() => { setShowForm(false); setError(''); }} className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:text-nv-text transition-fast font-mono">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Popular servers — one click prefills the form */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-mono text-nv-faint uppercase tracking-widest">Popular — one click to add</p>
              <div className="grid grid-cols-2 gap-2">
                {MCP_PRESETS.filter((p) => !connectedUrls.has(p.url)).map((p) => (
                  <button
                    key={p.url}
                    onClick={() => atCap ? undefined : prefill(p)}
                    disabled={atCap}
                    className="text-left p-2.5 rounded-lg bg-nv-bg border border-nv-border hover:border-accent/40 transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[12px] font-semibold text-nv-text truncate">{p.name}</span>
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                        p.auth === 'none' ? 'bg-nv-green/15 text-nv-green' : 'bg-nv-yellow/15 text-nv-yellow'
                      }`}>{p.auth === 'none' ? 'no key' : p.auth === 'optional' ? 'key optional' : 'needs token'}</span>
                    </div>
                    <p className="text-[10px] text-nv-muted leading-snug mt-0.5 line-clamp-2">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => atCap ? undefined : setShowForm(true)}
              disabled={atCap}
              className="self-start text-[11px] px-3 py-1.5 rounded-lg border border-dashed border-accent/50 text-accent hover:bg-accent/8 transition-fast font-mono font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {atCap ? `Plan limit reached (${cap}) — upgrade for more` : '+ Add another by URL'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
