import { useState } from 'react';

type Status = 'active' | 'idle' | 'off';

interface ModuleInfo {
  id: string;
  name: string;
  tagline: string;
  status: Status;
  icon: React.ReactNode;
  desc: string;
  features: string[];
  tip?: string;
}

const STATUS_DOT: Record<Status, string> = {
  active: 'bg-nv-green',
  idle:   'bg-nv-yellow',
  off:    'bg-nv-faint',
};
const STATUS_TEXT: Record<Status, string> = {
  active: 'text-nv-green',
  idle:   'text-yellow-400',
  off:    'text-nv-faint',
};
const STATUS_LABEL: Record<Status, string> = { active: 'Live', idle: 'Beta', off: 'Planned' };

const MODULES: ModuleInfo[] = [
  {
    id: 'home',
    name: 'Home',
    tagline: 'Dashboard & quick access',
    status: 'active',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
        <path d="M3 12L12 3l9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 21V12h6v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 10v11h14V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    desc: 'Your starting point inside Nivara. See all 9 modules at a glance, launch the guided tour, and jump straight to where you left off.',
    features: [
      'Overview of every module with live status',
      'Quick navigation — one click to any section',
      'Interactive first-run tour for new users',
      'Smart shortcuts based on recent activity',
    ],
  },
  {
    id: 'automation',
    name: 'Automation',
    tagline: 'No-code workflows that run 24/7',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M16 3l-9 13h8l-3 9 9-13h-8l3-9z" fill="currentColor" />
      </svg>
    ),
    desc: 'Build workflows that run automatically — even when Nivara is closed. Set a trigger, add AI steps, and choose where the output goes.',
    features: [
      'Triggers: schedule (cron), email arrival, file change',
      'AI steps: summarise, reply, extract, classify, report, translate',
      'Outputs: desktop notification, Slack, Notion, email reply, file',
      'Visual drag-and-drop flow canvas',
      'Runs 24/7 as a background process',
      'Offline run history — see what ran and what failed',
    ],
    tip: 'Ask Arjun.Boss or Kai.Ops in Krew to design and propose an automation for you — they build the flow and you just review before activating.',
  },
  {
    id: 'krew',
    name: 'Krew',
    tagline: '45+ specialized AI agents',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <circle cx="14" cy="14" r="5" fill="currentColor"/>
        <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" fill="none" opacity=".5"/>
        <circle cx="25" cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="3"  cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="3"  r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="25" r="2" fill="currentColor" opacity=".7"/>
      </svg>
    ),
    desc: 'Your AI-powered office. Chat with 45+ specialist agents across 10 departments — from a Boss who delegates to experts, to coders, researchers, marketers, legal, and ops agents.',
    features: [
      'Boss agent (Arjun) — orchestrates multi-step work by delegating to specialists',
      'Content & Marketing — captions, blogs, ads, email campaigns, SEO, social scheduling',
      'Sales & Support — cold outreach, proposals, pricing, customer replies',
      'Engineering — code writing, bug hunting, code review, docs, tests, deployments',
      'Research — live web search, cited findings, competitor analysis',
      'Data & Ops — data analysis, reports, automation management',
      'Company Research screen — deep multi-source company intelligence',
      'Creator Studio — AI-designed social media graphics and banners',
      'Office View — see your whole Krew working together visually',
      'All agents can use tools: web search, file access, terminal, connected apps',
    ],
    tip: 'Connect your apps (Gmail, Notion, Slack, GitHub…) in Connect Apps to unlock full agent capabilities — agents can then read, write, and post on your behalf.',
  },
  {
    id: 'connect',
    name: 'Connect Apps',
    tagline: 'Link external services to your Krew',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M10 4v7M18 4v7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        <rect x="7" y="11" width="14" height="8" rx="3" fill="currentColor"/>
        <path d="M14 19v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    ),
    desc: 'Connect your external services once — every Krew agent then has access to read, write, and act through them in real time.',
    features: [
      'Gmail — search emails, read threads, send replies',
      'Notion — search pages, read databases, create pages',
      'Slack — list channels, send messages, read history',
      'GitHub — list repos, read files, create issues',
      'Google Calendar — view events, create meetings',
      'Google Drive & Sheets — read and append data',
      'Twitter/X — post tweets, reply, search, DMs',
      'Airtable & Linear — manage records and issues',
      'Brave Search API — give agents live web results',
      'Gemini, OpenAI, Claude — bring your own LLM key',
      'Sarvam AI — Indian language voice and text AI',
    ],
    tip: 'Connect at minimum: Brave Search (for live web data) and one LLM (Gemini is free tier). That unlocks 80% of Krew\'s capability.',
  },
  {
    id: 'coder',
    name: 'Coder',
    tagline: 'AI-assisted coding terminal',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M8 4H2v6m0 8v6h6M20 4h6v6m0 8v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
        <rect x="10" y="12" width="8" height="4" fill="currentColor" />
      </svg>
    ),
    desc: 'A full coding environment inside Nivara. Browse your file system, edit code, run a terminal, and have an AI assistant that can read, write, and run code on your machine.',
    features: [
      'File tree browser — navigate any folder on your machine',
      'Code editor with syntax highlighting',
      'Integrated terminal — run commands, scripts, tests',
      'AI chat sidebar — ask about code, request edits, debug',
      'AI can read your files and suggest changes',
      'Supports Ollama (local), Own Key, or Nivara plan',
      'Connection bar — switch between AI providers mid-session',
    ],
    tip: 'The AI in Coder uses the same models as Krew. Switch to Local mode + Ollama for fully private coding sessions.',
  },
  {
    id: 'models',
    name: 'Models',
    tagline: 'Download & run local AI models',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 26 8 14 14 2 8 14 2Z" fill="currentColor" />
        <path d="M2 14l12 6 12-6" stroke="currentColor" strokeWidth="2.2" />
        <path d="M2 20l12 6 12-6" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    ),
    desc: 'Browse, download, and run open-source LLMs directly on your machine via Ollama. No internet required once downloaded — full privacy guaranteed.',
    features: [
      'Curated model catalogue with size, capability, and speed ratings',
      'One-click download via Ollama',
      'VRAM and RAM requirement indicators',
      'Model cards showing benchmark scores and best use cases',
      'Runs on CPU or GPU automatically',
      'Works with Coder and Krew in Local mode',
    ],
    tip: 'Requires Ollama to be installed and running on localhost:11434. Download Ollama from ollama.com — it\'s free.',
  },
  {
    id: 'vault',
    name: 'Vault',
    tagline: 'DNS-level network protection',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 4 6v8c0 6.5 4.3 11.5 10 12 5.7-.5 10-5.5 10-12V6L14 2Z" fill="currentColor" />
        <path d="M10 14l3 3 5-5" stroke="var(--nv-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    desc: 'Block ads, trackers, and malware at the DNS level — before they reach your browser or apps. Works system-wide without a VPN.',
    features: [
      'DNS-based ad and tracker blocking',
      'Malware and phishing domain protection',
      'Curated blocklists with auto-updates',
      'System-wide coverage (not just one browser)',
      'No VPN overhead — zero impact on speed',
      'Toggle on/off with one click',
    ],
    tip: 'Vault runs at the OS network layer. It protects every app on your machine — not just Nivara.',
  },
  {
    id: 'guard',
    name: 'Guard',
    tagline: 'Security intelligence suite',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 3 6v10c0 5 4.5 9.5 11 10 6.5-.5 11-5 11-10V6L14 2Z" fill="currentColor" />
        <rect x="11" y="11" width="6" height="8" fill="var(--nv-bg)" />
        <circle cx="14" cy="14" r="1.2" fill="currentColor" />
      </svg>
    ),
    desc: 'Four security tools in one module: scan contracts for risk, get live vulnerability briefings, check compliance, and monitor threats.',
    features: [
      'Contract Scanner — paste any contract, get plain-English risk flags',
      'Vulnerability Briefing — latest CVEs and security advisories for your stack',
      'Threat Dashboard — real-time threat intelligence feed',
      'Compliance Checker — check against GDPR, ISO 27001, SOC2, DPDP',
      'Powered by Krew agents (Raj.PM, Nora.PM) under the hood',
    ],
    tip: 'Guard\'s contract scanner uses AI — not a lawyer. Always have a qualified legal professional review before signing.',
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'AI visual creator — banners, videos, graphics',
    status: 'active',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <rect x="3" y="6" width="22" height="14" rx="2" stroke="currentColor" strokeWidth="2"/>
        <circle cx="14" cy="13" r="3.5" fill="currentColor" opacity=".6"/>
        <path d="M3 20h22" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M11 24h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    desc: 'Generate social media banners, animated videos, YouTube thumbnails, and promotional graphics — powered by AI. Describe what you want, pick a format, and get a finished, editable HTML asset in seconds.',
    features: [
      'AI-powered generation from a plain English brief',
      '4 output types: Social Banner, Animated Video, Screen/Slide, Infographic',
      '5 format presets: Instagram Square, Facebook/LinkedIn, Twitter Header, YouTube Thumbnail, 16:9 Widescreen',
      'Connected mode: auto-uses your Gemini, OpenAI, or Claude key from Connect Apps',
      'Refinement loop — iterate in natural language ("make it darker", "add a CTA")',
      'Code view — inspect and edit the raw HTML/CSS directly',
      'Save anywhere: OS file dialog to save as a .html file you can open in any browser',
      'Krew integration: Boss can delegate visual asset creation to Pixel.Design',
    ],
    tip: 'Connect your Gemini key in Connect Apps for the best results. Studio also works with OpenAI and Claude keys. The output is pure HTML/CSS — no proprietary format, no lock-in.',
  },
  {
    id: 'mesh',
    name: 'Mesh',
    tagline: 'Distributed RAM pooling (experimental)',
    status: 'off',
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <circle cx="4"  cy="14" r="2.5" fill="currentColor" />
        <circle cx="14" cy="4"  r="2.5" fill="currentColor" />
        <circle cx="24" cy="14" r="2.5" fill="currentColor" />
        <circle cx="14" cy="24" r="2.5" fill="currentColor" />
        <circle cx="14" cy="14" r="2"   fill="currentColor" opacity=".6" />
        <path d="M6 14h5M17 14h5M14 6v5M14 17v5" stroke="currentColor" strokeWidth="1.4" opacity=".4" />
      </svg>
    ),
    desc: 'Pool RAM and compute across your local devices. Run large models that don\'t fit in a single machine\'s memory by distributing the load over Wi-Fi.',
    features: [
      'Auto-discovers Nivara devices on the same network',
      'Pools unused RAM from each connected device',
      'Run LLMs larger than any single machine can handle',
      'Zero-config local discovery — no server needed',
      'Works alongside Ollama for distributed inference',
    ],
    tip: 'Mesh requires Nivara installed on at least two devices on the same Wi-Fi. Currently in planned phase — relay server coming in a future update.',
  },
];

function ModuleCard({ mod }: { mod: ModuleInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-nv-surface border border-nv-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-nv-surface2 transition-fast text-left"
      >
        <span className="text-nv-muted mt-0.5 shrink-0">{mod.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-nv-text">{mod.name}</span>
            <span className={`flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider ${STATUS_TEXT[mod.status]}`}>
              <span className={`w-1 h-1 rounded-full ${STATUS_DOT[mod.status]}`} />
              {STATUS_LABEL[mod.status]}
            </span>
          </div>
          <p className="text-[10px] text-nv-faint mt-0.5 font-mono">{mod.tagline}</p>
        </div>
        <svg
          viewBox="0 0 16 16" fill="none"
          className={`w-3.5 h-3.5 text-nv-faint shrink-0 mt-1 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 border-t border-nv-border/50">
          <p className="text-[12px] text-nv-muted leading-relaxed mt-3 mb-3">{mod.desc}</p>
          <ul className="space-y-1 mb-3">
            {mod.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-nv-muted">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-accent/60 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          {mod.tip && (
            <div className="flex items-start gap-2 bg-accent/5 border border-accent/15 rounded-lg px-3 py-2">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M8 5v1M8 7.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <p className="text-[11px] text-nv-muted leading-relaxed">{mod.tip}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InfoModule() {
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? MODULES.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.tagline.toLowerCase().includes(search.toLowerCase()) ||
          m.desc.toLowerCase().includes(search.toLowerCase()) ||
          m.features.some((f) => f.toLowerCase().includes(search.toLowerCase())),
      )
    : MODULES;

  return (
    <div className="h-full overflow-y-auto bg-nv-bg">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-nv-bg border-b border-nv-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[15px] font-semibold text-nv-text tracking-tight">What's Inside Nivara</h1>
            <p className="text-[10px] text-nv-faint font-mono mt-0.5">
              {MODULES.length} modules · tap any card to expand
            </p>
          </div>
          <div className="relative">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-nv-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search modules…"
              className="bg-nv-surface border border-nv-border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-nv-text placeholder-nv-faint outline-none focus:border-accent transition-fast w-48"
            />
          </div>
        </div>
      </div>

      {/* Module grid */}
      <div className="px-6 py-5 grid grid-cols-1 gap-3 max-w-3xl">
        {filtered.length === 0 && (
          <p className="text-[12px] text-nv-faint text-center py-12">No modules match "{search}"</p>
        )}
        {filtered.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>

      {/* Footer note */}
      <div className="px-6 pb-8 max-w-3xl">
        <div className="flex items-center gap-2 text-[10px] text-nv-faint font-mono">
          <span className="w-1 h-1 rounded-full bg-nv-faint" />
          Nivara v1.x · All AI processing is local or through your own keys unless you use the Nivara plan
          <span className="w-1 h-1 rounded-full bg-nv-faint" />
        </div>
      </div>
    </div>
  );
}
