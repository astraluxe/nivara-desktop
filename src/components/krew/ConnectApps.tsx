import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from '../../lib/krewDb';
import ServiceSetupModal from './ServiceSetupModal';

interface ServiceDef {
  id:     string;
  name:   string;
  desc:   string;
  note?:  string;
  tags:   string[];
  usedBy: string[];
}

// ─── Real brand SVG logos ─────────────────────────────────────────────────────

function PlatformLogo({ id, className = 'w-5 h-5' }: { id: string; className?: string }) {
  const base = { fill: 'currentColor', className, 'aria-hidden': true };
  switch (id) {
    case 'gemini':
      return <svg {...base} viewBox="0 0 28 28"><path d="M14 2C14 2 13.1 9.2 10 12.8 6.9 16.4 0 16 0 16c0 0 6.9.4 10 4 3.1 3.6 4 10 4 10s.9-6.4 4-10c3.1-3.6 10-4 10-4s-6.9.4-10-3.2C14.9 9.2 14 2 14 2z"/></svg>;
    case 'openai':
      return <svg {...base} viewBox="0 0 24 24"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.83 14.18A4.485 4.485 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387 2.02-1.168a.076.076 0 0 1 .071 0l4.003 2.309a4.485 4.485 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.385-.681zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.003-2.309a4.476 4.476 0 0 1 6.937 4.144zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.476 4.476 0 0 1 7.339-3.44l-.141.085L8.97 5.49a.798.798 0 0 0-.396.681zm1.097-2.365l2.602-1.5 2.607 1.496v2.999l-2.597 1.5-2.607-1.5z"/></svg>;
    case 'claude':
      return <svg {...base} viewBox="0 0 46 46"><path d="M32.73 0h-8.31L14.13 27.31h8.31L32.73 0zm-19.18 0H5.24L0 14.9h8.31L13.55 0zM40.76 0h-8.03L27.5 13.89l4.02 11.01L40.76 0zM23 32.11l-4.18-11.45H10.5L23 46l12.5-25.34h-8.32L23 32.11z"/></svg>;
    case 'brave':
      return <svg {...base} viewBox="0 0 24 24"><path d="M21.86 5.17l-1.35-1.27a.85.85 0 0 0-1.16 0L18 5.17a.43.43 0 0 1-.58 0l-1.35-1.27a.85.85 0 0 0-1.16 0l-1.35 1.27a.43.43 0 0 1-.58 0l-1.35-1.27a.85.85 0 0 0-1.16 0L9.12 5.17a.43.43 0 0 1-.58 0L7.19 3.9a.85.85 0 0 0-1.16 0L3.79 6.06l2.09 7.56L8 22.08C8.72 24.17 10.14 24 12 24h12c1.86 0 3.28.17 4-1.92l2.12-8.46 2.09-7.56-2.24-2.16a.85.85 0 0 0-1.16 0l-1.35 1.27a.43.43 0 0 1-.58 0zm-7.66 13.47l-2.48-7.36h-.01L10.47 8.5h13.06l-1.24 2.78h.01l-2.48 7.36-.06.16L18 21.5l-3.76-2.7-.04-.16z"/></svg>;
    case 'gmail':
      return <svg {...base} viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>;
    case 'google':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg>;
    case 'notion':
      return <svg {...base} viewBox="0 0 24 24"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.62c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933z"/></svg>;
    case 'slack':
      return <svg {...base} viewBox="0 0 24 24"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522zm2.521-10.123a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.123 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.123a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>;
    case 'github':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>;
    case 'linear':
      return <svg {...base} viewBox="0 0 100 100"><path d="M1.22 61.4 38.6 98.78a3.56 3.56 0 0 0 5-.18L98.6 43.6a3.56 3.56 0 0 0-.18-5.18L1.4 56.4a3.56 3.56 0 0 0-.18 5zM0 47.09 52.91 100a50 50 0 0 1-52.91-52.91zM6.27 37.2l56.53 56.53a50 50 0 0 0 30.63-30.63L6.27 6.57A50 50 0 0 0 6.27 37.2z"/></svg>;
    case 'airtable':
      return <svg {...base} viewBox="0 0 24 24"><path d="M11.984.024L.145 5.258a.48.48 0 0 0 0 .87l11.913 5.234a.48.48 0 0 0 .384 0l11.913-5.234a.48.48 0 0 0 0-.87L12.368.024a.48.48 0 0 0-.384 0zM.048 8.393v6.961c0 .275.296.459.544.343l10.8-5.016a.48.48 0 0 0 .272-.435V3.284a.384.384 0 0 0-.544-.342L.32 7.958a.48.48 0 0 0-.272.435zm23.904 0a.48.48 0 0 0-.272-.435L13.368 2.942a.384.384 0 0 0-.544.342v6.962c0 .188.109.36.272.435l10.8 5.016a.384.384 0 0 0 .544-.343V8.393z"/></svg>;
    case 'twitter':
      return <svg {...base} viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
    case 'linkedin':
      return <svg {...base} viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>;
    case 'reddit':
      return <svg {...base} viewBox="0 0 24 24"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>;
    default:
      return <span className="text-sm font-bold leading-none">{id[0].toUpperCase()}</span>;
  }
}

// ─── Brand accent colors ──────────────────────────────────────────────────────

const BRAND_COLOR: Record<string, string> = {
  gemini:   'text-blue-400',
  openai:   'text-emerald-400',
  claude:   'text-orange-400',
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
};

// ─── Service definitions ──────────────────────────────────────────────────────

const SERVICES: ServiceDef[] = [
  // AI providers
  { id: 'gemini',   name: 'Gemini (Google AI)',  desc: 'Powers Krew, Guard and Automation. Free tier — generous Flash model allowance.',       tags: ['ai','llm','google'],                     usedBy: ['Krew','Automation','Guard'] },
  { id: 'openai',   name: 'OpenAI (GPT-4o)',     desc: 'Powers Krew and Automation with GPT-4o mini. Pay-per-use, very affordable.',            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  { id: 'claude',   name: 'Claude (Anthropic)',  desc: 'Powers Krew and Automation with Claude Haiku. Pay-per-use.',                            tags: ['ai','llm'],                              usedBy: ['Krew','Automation','Guard'] },
  // Tools
  { id: 'brave',    name: 'Web Search',          desc: 'Brave Search — 2K free searches/month. Krew uses this for any web lookup.',             tags: ['search'],                                usedBy: ['Krew'] },
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
];

interface Props { onClose?: () => void }

export default function ConnectApps({ onClose }: Props) {
  const [connected, setConnected] = useState<string[]>([]);
  const [setup,     setSetup]     = useState<string | null>(null);
  const [search,    setSearch]    = useState('');

  const reload = useCallback(() => {
    credentialStore.list().then(setConnected).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function disconnect(service: string) {
    await credentialStore.delete(service).catch(() => {});
    reload();
  }

  async function disconnectAll() {
    await Promise.all(connected.map(s => credentialStore.delete(s).catch(() => {})));
    reload();
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

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
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
                  <ServiceCard key={s.id} service={s} isConnected onConnect={() => setSetup(s.id)} onDisconnect={() => disconnect(s.id)} />
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
                  <ServiceCard key={s.id} service={s} isConnected={false} onConnect={() => setSetup(s.id)} onDisconnect={() => {}} />
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
        <ServiceSetupModal service={setup} onDone={() => { setSetup(null); reload(); }} onClose={() => setSetup(null)} />
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
      setTestState('error');
      setTestMsg(String(err));
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
