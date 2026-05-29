import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../../contexts/AuthContext';
import { credentialStore } from '../../lib/krewDb';
import type { Provider } from '../../lib/ai';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'planning' | 'searching' | 'analyzing' | 'done' | 'error';

interface SearchResult {
  query: string;
  data:  string;
  done:  boolean;
}

const FOCUS_OPTIONS = [
  { id: 'funding',     label: 'Funding & Investors' },
  { id: 'pricing',     label: 'Pricing Strategy' },
  { id: 'india',       label: 'India-specific' },
  { id: 'products',    label: 'Feature Comparison' },
  { id: 'news',        label: 'Recent News' },
];

// ─── Minimal markdown renderer ──────────────────────────────────────────────────

function renderLine(line: string, i: number): React.ReactNode {
  if (/^## /.test(line))  return <h2 key={i} className="text-[14px] font-bold text-nv-text mt-6 mb-2">{line.slice(3)}</h2>;
  if (/^### /.test(line)) return <h3 key={i} className="text-[12px] font-semibold text-nv-text mt-4 mb-1">{line.slice(4)}</h3>;
  if (/^- /.test(line) || /^\* /.test(line)) {
    const text = line.slice(2);
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <li key={i} className="text-[12px] text-nv-muted ml-4 list-disc leading-relaxed">
        {parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
          ? <strong key={j} className="text-nv-text font-semibold">{p.slice(2, -2)}</strong>
          : p
        )}
      </li>
    );
  }
  if (/^\d+\. /.test(line)) {
    const text = line.replace(/^\d+\. /, '');
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <li key={i} className="text-[12px] text-nv-muted ml-4 list-decimal leading-relaxed">
        {parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
          ? <strong key={j} className="text-nv-text font-semibold">{p.slice(2, -2)}</strong>
          : p
        )}
      </li>
    );
  }
  if (!line.trim()) return <div key={i} className="h-2" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-[12px] text-nv-muted leading-relaxed">
      {parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
        ? <strong key={j} className="text-nv-text font-semibold">{p.slice(2, -2)}</strong>
        : p
      )}
    </p>
  );
}

function ReportView({ text, streaming }: { text: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const lines = text.split('\n');
  return (
    <div className="relative">
      {text && !streaming && (
        <button
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="absolute top-0 right-0 text-[10px] text-nv-faint hover:text-nv-text font-mono transition-fast"
        >
          {copied ? '✓ copied' : 'copy report'}
        </button>
      )}
      <div className="pr-20">
        {lines.map((line, i) => renderLine(line, i))}
        {streaming && (
          <span className="inline-flex items-center gap-1 ml-1 mt-2">
            {[0, 1, 2].map(j => (
              <span key={j} className="w-1.5 h-1.5 rounded-full bg-accent/70"
                style={{ animation: `pulse 1.2s ease-in-out ${j * 0.2}s infinite` }} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function ResearchScreen() {
  const { session } = useAuth();
  const callIdRef = useRef(0);

  const [businessName, setBusinessName] = useState('');
  const [description,  setDescription]  = useState('');
  const [geo,          setGeo]          = useState<'india' | 'global'>('india');
  const [focus,        setFocus]        = useState<string[]>([]);
  const [stage,        setStage]        = useState<Stage>('idle');
  const [searches,     setSearches]     = useState<SearchResult[]>([]);
  const [report,       setReport]       = useState('');
  const [error,        setError]        = useState<string | null>(null);
  const [planStatus,   setPlanStatus]   = useState('');

  function toggleFocus(id: string) {
    setFocus(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function loadAllCreds(): Promise<Record<string, Record<string, string>>> {
    const services = await credentialStore.list().catch(() => [] as string[]);
    const entries: Record<string, Record<string, string>> = {};
    for (const s of services) {
      const d = await credentialStore.get(s).catch(() => null);
      if (d) entries[s] = d as Record<string, string>;
    }
    return entries;
  }

  async function doSearch(query: string): Promise<string> {
    const creds = await loadAllCreds();
    const braveKey = creds.brave?.api_key ?? '';

    if (braveKey) {
      return invoke<string>('krew_web_search', { query, apiKey: braveKey });
    }

    try {
      const raw = await invoke<string>('krew_http_call', {
        method:  'GET',
        url:     `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        headers: { 'Accept': 'application/json' },
        body:    null,
      });
      const data = JSON.parse(raw) as {
        AbstractText?: string;
        Answer?: string;
        AbstractURL?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string }[];
      };
      const parts: string[] = [];
      if (data.Answer)       parts.push(`Answer: ${data.Answer}`);
      if (data.AbstractText) parts.push(`Summary: ${data.AbstractText}${data.AbstractURL ? ` (${data.AbstractURL})` : ''}`);
      const topics = (data.RelatedTopics ?? []).filter(t => t.Text).slice(0, 6);
      if (topics.length) parts.push('Related:\n' + topics.map(t => `- ${t.Text}`).join('\n'));
      return parts.join('\n\n') || '[No results — AI will use training knowledge]';
    } catch {
      return '[Search unavailable — AI will use training knowledge]';
    }
  }

  async function streamAI(
    systemPrompt: string,
    messages: { role: string; content: string }[],
    onChunk: (t: string) => void,
  ): Promise<string> {
    const callId = String(++callIdRef.current);
    let fullText = '';
    const done = { cleanup: () => {} };

    const creds = await loadAllCreds();
    let mode: string = 'nivara';
    let apiKey: string | null = null;
    let provider: Provider | null = null;

    for (const [svc, p] of [['gemini', 'gemini'], ['openai', 'openai'], ['claude', 'claude']] as [string, Provider][]) {
      if (creds[svc]?.api_key) {
        mode     = 'own_key';
        apiKey   = creds[svc].api_key;
        provider = p;
        break;
      }
    }

    return new Promise<string>(async (resolve, reject) => {
      const u1 = await listen<{ id: string; text: string }>('krew-chunk', e => {
        if (e.payload.id !== callId) return;
        fullText += e.payload.text;
        onChunk(e.payload.text);
      });
      const u2 = await listen<{ id: string }>('krew-done', e => {
        if (e.payload.id !== callId) return;
        done.cleanup(); resolve(fullText);
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', e => {
        if (e.payload.id !== callId) return;
        done.cleanup(); reject(new Error(e.payload.error));
      });
      done.cleanup = () => { u1(); u2(); u3(); };

      invoke('krew_ai_stream', {
        callId, mode, systemPrompt, messages,
        apiKey,
        provider,
        localModel:   null,
        modelName:    null,
        baseUrl:      null,
        sessionToken: session?.access_token ?? null,
      }).catch((e: unknown) => { done.cleanup(); reject(e); });
    });
  }

  // Step 1: AI-planned research queries
  async function planQueries(desc: string, name: string, geography: string, focusAreas: string[]): Promise<string[]> {
    const focusLabels = focusAreas.map(f => FOCUS_OPTIONS.find(o => o.id === f)?.label ?? f);
    const geoTag = geography === 'India' ? 'India' : 'global market';

    const focusInstruction = focusLabels.length > 0
      ? `\nThe user specifically wants depth on: ${focusLabels.join(', ')}. At least 2 of the 6 queries MUST directly address these areas.`
      : '';

    const q5 = focusLabels.includes('Funding & Investors')
      ? `Startup funding rounds and investors in this space 2024–2025 (${geoTag})`
      : focusLabels.includes('Recent News')
        ? `Recent news, product launches, and announcements in this category 2024–2025 (${geoTag})`
        : `Recent trends and market opportunities in this space (${geoTag}) 2025`;

    const q6 = focusLabels.includes('Pricing Strategy')
      ? `Pricing models, price points, and monetization strategies for competitors in this space (${geoTag})`
      : focusLabels.includes('Feature Comparison')
        ? `Feature comparison between top products in this category (${geoTag})`
        : name
          ? `"${name}" company market position, traction, and differentiation (${geoTag})`
          : `Best go-to-market strategies for this type of product in ${geoTag}`;

    const planSys = `You are a market research planner. Given a business description, output exactly 6 targeted Google-style search queries to gather competitive intelligence.

Return ONLY a valid JSON array of 6 strings. No markdown, no explanation. Just the array.

CRITICAL RULES:
- Every single query MUST include "${geoTag}" explicitly — geographic context is mandatory in ALL queries
- Include year (2024 or 2025) in queries where relevant
- Queries must be specific enough to return useful results on Google${focusInstruction}

Cover these 6 angles (use these as the basis for your queries):
1. Direct competitors in this category (${geoTag})
2. Market size, growth rate, key trends (${geoTag}) 2024–2025
3. Top competitor pricing, features, and customer reviews (${geoTag})
4. Customer pain points and complaints in this space — Reddit, G2, Capterra (${geoTag})
5. ${q5}
6. ${q6}`;

    const nameHint = name ? `Business name: ${name}\n` : '';
    let json = '';
    await streamAI(planSys, [{ role: 'user', content: `${nameHint}Business description: ${desc}\nGeography: ${geography}` }], chunk => { json += chunk; });

    const match = json.match(/\[[\s\S]*?\]/);
    if (!match) {
      const cat = desc.slice(0, 60);
      return [
        `${cat} competitors ${geoTag} 2025`,
        `${cat} market size growth ${geoTag} 2024`,
        `top ${cat} companies pricing reviews ${geoTag}`,
        `${cat} customer complaints pain points ${geoTag}`,
        focusLabels.includes('Funding & Investors') ? `${cat} startup funding investors 2024 2025 ${geoTag}` : `${cat} market trends opportunities ${geoTag} 2025`,
        focusLabels.includes('Pricing Strategy') ? `${cat} pricing strategy monetization ${geoTag}` : name ? `"${name}" company traction ${geoTag}` : `${cat} go-to-market strategy ${geoTag}`,
      ];
    }
    return JSON.parse(match[0]) as string[];
  }

  async function handleResearch() {
    if (!description.trim()) return;
    setStage('planning');
    setSearches([]);
    setReport('');
    setError(null);
    setPlanStatus('Planning research strategy…');

    const geography = geo === 'india' ? 'India' : 'Global';
    let queries: string[];

    try {
      queries = await planQueries(description.trim(), businessName.trim(), geography, focus);
    } catch {
      // Graceful fallback
      const cat = description.trim().slice(0, 50);
      queries = [
        `${cat} competitors ${geography} 2025`,
        `${cat} market size trends`,
        `${cat} top companies comparison`,
        `${cat} customer pain points problems`,
        `${cat} startup news funding 2025`,
        `${cat} differentiation strategy`,
      ];
    }

    setStage('searching');
    setSearches(queries.map(q => ({ query: q, data: '', done: false })));

    const results: string[] = [];

    for (let i = 0; i < queries.length; i++) {
      try {
        const data = await doSearch(queries[i]);
        results.push(data);
        setSearches(prev => prev.map((s, j) => j === i ? { ...s, data, done: true } : s));
      } catch {
        results.push('[Search failed]');
        setSearches(prev => prev.map((s, j) => j === i ? { ...s, data: '[failed]', done: true } : s));
      }
    }

    setStage('analyzing');

    const focusNote = focus.length
      ? `\nExtra focus areas requested: ${focus.map(f => FOCUS_OPTIONS.find(o => o.id === f)?.label ?? f).join(', ')}.`
      : '';

    const nameContext = businessName.trim() ? `Business name: ${businessName.trim()}\n` : '';

    const systemPrompt = `You are a senior market intelligence analyst advising a startup founder on their competitive landscape.

The user has described THEIR OWN business. Your job is NOT to research some other company — it is to map the competitive landscape for THIS founder and give them actionable intelligence about who they're competing against and how to win.

Write in markdown. Be specific — name real companies, real features, real numbers when available. Do not give generic advice. Every sentence should be directly useful to this specific founder.

Report structure (use these exact headers):
## Market at a Glance
(Size, growth, key dynamics, why this space is interesting or difficult right now)

## Who You're Up Against
(Name the main competitors. For each: 1-2 lines on what they do, their pricing if known, their biggest strength, their main weakness)

## What's Working for Your Competitors
(What strategies, features, messaging, or distribution is driving success for the leaders in this space)

## Gaps & Opportunities
(What are customers complaining about? What's missing? What problems are unsolved? Where can this founder win?)

## How to Position Against Them
(Concrete positioning advice for THIS business — not generic "differentiate yourself" — but specific angles against specific competitors)

## 5 Key Takeaways
(Five actionable bullets. Things the founder can act on this week or this month.)`;

    const searchContext = queries.map((q, i) => `### Query: "${q}"\n${results[i] || '[no data]'}`).join('\n\n');

    const userMsg = `${nameContext}My business: ${description.trim()}
Geography: ${geography}${focusNote}

Here is the gathered market data:

${searchContext}

Write the competitive intelligence report now.`;

    try {
      await streamAI(systemPrompt, [{ role: 'user', content: userMsg }], chunk => {
        setReport(prev => prev + chunk);
      });
      setStage('done');
    } catch (err) {
      setError(String(err));
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setSearches([]);
    setReport('');
    setError(null);
    setPlanStatus('');
  }

  const isRunning = stage === 'planning' || stage === 'searching' || stage === 'analyzing';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-nv-border shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-[13px] font-semibold text-nv-text">Business Research</h2>
          <p className="text-[10px] text-nv-faint font-mono">Understand your market · find your competitors · know where to win</p>
        </div>
        {stage !== 'idle' && !isRunning && (
          <button
            onClick={reset}
            className="shrink-0 text-[11px] text-nv-faint hover:text-nv-text font-mono px-2.5 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
          >
            New research
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* ── Idle form ── */}
        {stage === 'idle' && (
          <div className="max-w-xl">

            <p className="text-[12px] text-nv-muted mb-5 leading-relaxed">
              Describe your business below. We'll plan targeted searches, find your competitors, and generate a report that tells you exactly where you stand and how to win.
            </p>

            {/* Business name — optional */}
            <div className="mb-3">
              <label className="text-[10px] text-nv-faint uppercase tracking-widest font-mono block mb-1.5">
                Your business name <span className="normal-case text-nv-faint/60">(optional)</span>
              </label>
              <input
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                placeholder="e.g. Nivara, Meesho, Cred…"
                className="w-full bg-nv-surface border border-nv-border rounded-xl px-4 py-2.5 text-[13px] text-nv-text placeholder-nv-faint outline-none focus:border-accent transition-fast"
              />
            </div>

            {/* Description — main input */}
            <div className="mb-4">
              <label className="text-[10px] text-nv-faint uppercase tracking-widest font-mono block mb-1.5">
                Describe your business <span className="text-red-400/70">*</span>
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={`What does your business do? Who's your customer? What problem do you solve?\n\ne.g. "We're building an AI productivity app for Indian SMBs — helps with workflow automation, AI agents for marketing tasks, and running AI models locally. Target: 10–200 person companies in India who want AI but can't afford enterprise tools."`}
                rows={5}
                autoFocus
                className="w-full bg-nv-surface border border-nv-border rounded-xl px-4 py-3 text-[13px] text-nv-text placeholder-nv-faint outline-none focus:border-accent transition-fast resize-none leading-relaxed"
              />
              <p className="text-[10px] text-nv-faint mt-1.5 font-mono">
                More detail = better competitor analysis. Include your target customer, problem you solve, and key features.
              </p>
            </div>

            {/* Geography */}
            <div className="mb-4">
              <label className="text-[10px] text-nv-faint uppercase tracking-widest font-mono block mb-1.5">Geography focus</label>
              <div className="flex gap-2">
                {(['india', 'global'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGeo(g)}
                    className={`text-[11px] px-4 py-2 rounded-lg border font-mono transition-fast capitalize ${
                      geo === g
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-nv-border text-nv-faint hover:border-nv-muted hover:text-nv-muted'
                    }`}
                  >
                    {g === 'india' ? '🇮🇳 India' : '🌍 Global'}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus areas */}
            <div className="mb-6">
              <p className="text-[10px] text-nv-faint uppercase tracking-widest font-mono mb-2">
                Extra focus areas <span className="normal-case text-nv-faint/60">(optional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map(opt => {
                  const active = focus.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleFocus(opt.id)}
                      className={`text-[11px] px-3 py-1.5 rounded-lg border transition-fast font-mono ${
                        active
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-nv-border text-nv-faint hover:border-nv-muted hover:text-nv-muted'
                      }`}
                    >
                      {active && <span className="mr-1">✓</span>}{opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={handleResearch}
              disabled={!description.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Research my market
            </button>
          </div>
        )}

        {/* ── Pipeline progress + results ── */}
        {stage !== 'idle' && (
          <div className="max-w-2xl space-y-4">

            {/* Step 0: Planning */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                  stage === 'planning' ? 'bg-accent/20' : 'bg-nv-green/20'
                }`}>
                  {stage === 'planning' ? (
                    <span className="w-2 h-2 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                  ) : (
                    <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                      <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span className="text-[11px] font-semibold text-nv-text font-mono">
                  {stage === 'planning' ? planStatus || 'Planning research strategy…' : 'Research plan ready'}
                </span>
              </div>
            </div>

            {/* Step 1: Searches */}
            {(stage === 'searching' || stage === 'analyzing' || stage === 'done' || stage === 'error') && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                    stage === 'searching' ? 'bg-accent/20' : 'bg-nv-green/20'
                  }`}>
                    {stage === 'searching' ? (
                      <span className="w-2 h-2 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                    ) : (
                      <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                        <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-nv-text font-mono">
                    {stage === 'searching' ? 'Gathering market data…' : 'Data gathered'}
                  </span>
                </div>
                <div className="ml-6 space-y-1">
                  {searches.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${s.done ? 'bg-nv-green' : 'bg-nv-faint'}`} />
                      <span className="text-[11px] text-nv-muted font-mono">{s.query}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Analysis */}
            {(stage === 'analyzing' || stage === 'done' || stage === 'error') && (
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                    stage === 'analyzing' ? 'bg-accent/20' : stage === 'done' ? 'bg-nv-green/20' : 'bg-red-500/20'
                  }`}>
                    {stage === 'analyzing' ? (
                      <span className="w-2 h-2 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                    ) : stage === 'done' ? (
                      <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                        <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <span className="text-[8px] text-red-400">!</span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-nv-text font-mono">
                    {stage === 'analyzing' ? 'Writing competitive intelligence report…' : stage === 'done' ? 'Report ready' : 'Error'}
                  </span>
                </div>
              </div>
            )}

            {/* Report */}
            {(report || stage === 'analyzing') && (
              <div className="bg-nv-surface border border-nv-border rounded-xl p-5 mt-1">
                {businessName.trim() && (
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-nv-border/60">
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-accent shrink-0">
                      <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                    <span className="text-[11px] font-semibold text-nv-text">{businessName.trim()}</span>
                    <span className="text-[10px] text-nv-faint font-mono">· competitive intelligence report</span>
                  </div>
                )}
                <ReportView text={report} streaming={stage === 'analyzing'} />
              </div>
            )}

            {/* Error */}
            {stage === 'error' && error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <p className="text-[12px] text-red-400 font-mono">{error}</p>
                <p className="text-[11px] text-nv-faint mt-1">
                  Make sure you have a valid plan or connect an API key (Gemini/OpenAI/Claude) in Connect Apps.
                </p>
                <button
                  onClick={reset}
                  className="mt-2 text-[11px] text-accent hover:underline font-mono"
                >Try again</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Running footer */}
      {isRunning && (
        <div className="shrink-0 px-5 py-2 border-t border-nv-border flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
          <span className="text-[11px] text-nv-faint font-mono">
            {stage === 'planning'  && 'Planning tailored research queries…'}
            {stage === 'searching' && `Searching ${searches.filter(s => s.done).length} / ${searches.length} queries…`}
            {stage === 'analyzing' && 'Synthesizing competitive intelligence…'}
          </span>
        </div>
      )}
    </div>
  );
}
