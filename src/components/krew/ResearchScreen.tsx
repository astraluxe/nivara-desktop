import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../../contexts/AuthContext';
import { credentialStore } from '../../lib/krewDb';
import type { Provider } from '../../lib/ai';

// ─── Constants ─────────────────────────────────────────────────────────────────

const WEBSITE_PATH = "C:\\Users\\amogh\\OneDrive\\Desktop\\NIVARA\\NIVARA.html";
const WEBSITE_REPO  = "C:\\Users\\amogh\\OneDrive\\Desktop\\NIVARA";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'searching' | 'analyzing' | 'done' | 'error';
type WsStage = 'idle' | 'reading' | 'updating' | 'pushing' | 'done' | 'error';

interface SearchResult {
  query: string;
  data: string;
  done: boolean;
}

const FOCUS_OPTIONS = [
  { id: 'funding',     label: 'Funding & Valuation' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'leadership',  label: 'Leadership & Team' },
  { id: 'products',    label: 'Products & Services' },
  { id: 'news',        label: 'Latest News' },
];

// ─── Markdown renderer (minimal inline) ────────────────────────────────────────

function renderLine(line: string, i: number): React.ReactNode {
  if (/^## /.test(line)) return <h2 key={i} className="text-[13px] font-semibold text-nv-text mt-5 mb-1.5">{line.slice(3)}</h2>;
  if (/^### /.test(line)) return <h3 key={i} className="text-[12px] font-semibold text-nv-text mt-3 mb-1">{line.slice(4)}</h3>;
  if (/^- /.test(line) || /^\* /.test(line)) return <li key={i} className="text-[12px] text-nv-muted ml-4 list-disc leading-relaxed">{line.slice(2)}</li>;
  if (/^\d+\. /.test(line)) return <li key={i} className="text-[12px] text-nv-muted ml-4 list-decimal leading-relaxed">{line.replace(/^\d+\. /, '')}</li>;
  if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-[12px] font-semibold text-nv-text mt-2">{line.slice(2, -2)}</p>;
  if (!line.trim()) return <div key={i} className="h-2" />;
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p key={i} className="text-[12px] text-nv-muted leading-relaxed">
      {parts.map((p, j) =>
        p.startsWith('**') && p.endsWith('**')
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
      {text && (
        <button
          onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="absolute top-0 right-0 text-[10px] text-nv-faint hover:text-nv-text font-mono transition-fast"
        >
          {copied ? '✓ copied' : 'copy report'}
        </button>
      )}
      <div className="pr-16">
        {lines.map((line, i) => renderLine(line, i))}
        {streaming && (
          <span className="inline-flex items-center gap-1 ml-1 mt-1">
            {[0,1,2].map(j => (
              <span key={j} className="w-1 h-1 rounded-full bg-accent/70"
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

  const [company,  setCompany]  = useState('');
  const [focus,    setFocus]    = useState<string[]>([]);
  const [stage,    setStage]    = useState<Stage>('idle');
  const [searches, setSearches] = useState<SearchResult[]>([]);
  const [report,   setReport]   = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [wsStage, setWsStage] = useState<WsStage>('idle');
  const [wsLog,   setWsLog]   = useState('');
  const [wsError, setWsError] = useState<string | null>(null);

  function toggleFocus(id: string) {
    setFocus((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
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
      const topics = (data.RelatedTopics ?? []).filter((t) => t.Text).slice(0, 5);
      if (topics.length) parts.push('Related:\n' + topics.map((t) => `- ${t.Text}`).join('\n'));
      return parts.join('\n\n') || '[No results found — AI will use training knowledge]';
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
      const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
        if (e.payload.id !== callId) return;
        fullText += e.payload.text;
        onChunk(e.payload.text);
      });
      const u2 = await listen<{ id: string }>('krew-done', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); resolve(fullText);
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); reject(new Error(e.payload.error));
      });
      done.cleanup = () => { u1(); u2(); u3(); };

      invoke('krew_ai_stream', {
        callId, mode, systemPrompt, messages,
        apiKey:       apiKey,
        provider:     provider,
        localModel:   null,
        modelName:    null,
        baseUrl:      null,
        sessionToken: session?.access_token ?? null,
      }).catch((e: unknown) => { done.cleanup(); reject(e); });
    });
  }

  async function handleResearch() {
    if (!company.trim()) return;
    setStage('searching');
    setSearches([]);
    setReport('');
    setError(null);

    const queries: string[] = [
      `${company} company overview business model products services`,
      `${company} latest news 2025 funding valuation growth`,
      `${company} competitors market position industry analysis`,
    ];

    if (focus.includes('leadership'))  queries.push(`${company} CEO founder leadership team executives`);
    if (focus.includes('funding'))     queries.push(`${company} funding rounds investors valuation 2024 2025`);
    if (focus.includes('competitors')) queries.push(`${company} vs competitors alternative comparison`);

    const initialSearches = queries.map((q) => ({ query: q, data: '', done: false }));
    setSearches(initialSearches);

    const results: string[] = [];

    for (let i = 0; i < queries.length; i++) {
      try {
        const data = await doSearch(queries[i]);
        results.push(data);
        setSearches((prev) => prev.map((s, j) => j === i ? { ...s, data, done: true } : s));
      } catch {
        results.push('[Search failed]');
        setSearches((prev) => prev.map((s, j) => j === i ? { ...s, data: '[failed]', done: true } : s));
      }
    }

    setStage('analyzing');

    const focusNote = focus.length
      ? `\nUser requested extra focus on: ${focus.map((f) => FOCUS_OPTIONS.find((o) => o.id === f)?.label ?? f).join(', ')}.`
      : '';

    const systemPrompt = `You are a senior business research analyst. Synthesize the provided web search data into a comprehensive, structured company research report.

Write clearly and concisely. Use headers and bullet points. Cite data from the search results where available. Note when information is limited or may be outdated.

Report structure:
## Company Overview
## Products & Services
## Market Position & Competitors
## Financial Highlights
## Leadership & Team
## Recent Developments
## Key Takeaways

Be specific — avoid vague statements. If data is missing for a section, note it briefly and move on.`;

    const searchContext = queries.map((q, i) => `### Search: "${q}"\n${results[i] || '[no data]'}`).join('\n\n');
    const userMsg = `Research the company: **${company}**${focusNote}

Here is the gathered web data:

${searchContext}

Produce the full research report now.`;

    try {
      await streamAI(systemPrompt, [{ role: 'user', content: userMsg }], (chunk) => {
        setReport((prev) => prev + chunk);
      });
      setStage('done');
    } catch (err) {
      setError(String(err));
      setStage('error');
    }
  }

  async function handleWebsiteSync() {
    setWsStage('reading');
    setWsLog('Reading NIVARA.html…');
    setWsError(null);
    try {
      const currentHtml = await invoke<string>('krew_read_file', { path: WEBSITE_PATH });

      setWsStage('updating');
      setWsLog('Analyzing and generating content updates…');

      const sysPr = `You are a web content editor. Given a company research report and an HTML file, propose minimal targeted text replacements to update the website copy.

Return ONLY a valid JSON object — no markdown, no explanation:
{"changes": [{"find": "exact string to find", "replace": "replacement string"}]}

Rules:
- Only change visible text (headlines, taglines, body copy) — never change class names, IDs, or code
- Maximum 5 targeted changes
- "find" must be an EXACT substring present in the provided HTML
- Keep the existing tone and style
- If nothing needs updating, return {"changes": []}`;

      const userMsg = `Website HTML (excerpt):\n${currentHtml.slice(0, 8000)}\n\nResearch report about ${company}:\n${report.slice(0, 3000)}\n\nGenerate targeted content updates to reflect the research.`;

      let changesJson = '';
      await streamAI(sysPr, [{ role: 'user', content: userMsg }], (chunk) => {
        changesJson += chunk;
      });

      // Extract JSON if wrapped in fences
      const jsonMatch = changesJson.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : changesJson) as { changes: { find: string; replace: string }[] };

      let updatedHtml = currentHtml;
      let appliedCount = 0;
      for (const { find, replace } of parsed.changes) {
        if (find && updatedHtml.includes(find)) {
          updatedHtml = updatedHtml.split(find).join(replace);
          appliedCount++;
        }
      }

      if (appliedCount === 0) {
        setWsLog('No changes needed — website content is already accurate.');
        setWsStage('done');
        return;
      }

      setWsLog(`Applied ${appliedCount} update${appliedCount !== 1 ? 's' : ''}. Writing file…`);
      await invoke('write_file', { path: WEBSITE_PATH, content: updatedHtml });

      setWsStage('pushing');
      setWsLog('Committing and pushing to GitHub → Vercel…');

      await invoke('krew_execute_command', {
        command: `cd "${WEBSITE_REPO}" && git add -A && git commit -m "website: update content from ${company} research" && git push origin master`,
      });

      setWsLog(`${appliedCount} change${appliedCount !== 1 ? 's' : ''} pushed — live on Vercel in ~30s.`);
      setWsStage('done');
    } catch (err) {
      setWsError(String(err));
      setWsStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setSearches([]);
    setReport('');
    setError(null);
    setCompany('');
    setFocus([]);
    setWsStage('idle');
    setWsLog('');
    setWsError(null);
  }

  const isRunning = stage === 'searching' || stage === 'analyzing';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-nv-border shrink-0">
        <div className="flex-1">
          <h2 className="text-[13px] font-semibold text-nv-text">Company Research</h2>
          <p className="text-[10px] text-nv-faint font-mono">Multi-source business intelligence</p>
        </div>
        {stage !== 'idle' && (
          <button
            onClick={reset}
            className="text-[11px] text-nv-faint hover:text-nv-text font-mono px-2.5 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
          >
            New research
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* Form — show when idle */}
        {stage === 'idle' && (
          <div className="max-w-xl">
            <p className="text-[12px] text-nv-muted mb-5 leading-relaxed">
              Enter a company name to get a structured research report — overview, products, competitors, financials, news, and key takeaways — generated from live web searches.
            </p>

            <label className="text-[10px] text-nv-faint uppercase tracking-widest font-mono block mb-1.5">Company name</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && company.trim()) handleResearch(); }}
              placeholder="e.g. Razorpay, Stripe, Zepto…"
              autoFocus
              className="w-full bg-nv-surface border border-nv-border rounded-xl px-4 py-3 text-[13px] text-nv-text placeholder-nv-faint outline-none focus:border-accent transition-fast mb-4"
            />

            {/* Focus areas */}
            <div className="mb-5">
              <button
                onClick={() => setSearchOpen((o) => !o)}
                className="flex items-center gap-1.5 text-[10px] text-nv-faint hover:text-nv-muted font-mono uppercase tracking-widest mb-2 transition-fast"
              >
                <svg viewBox="0 0 12 12" fill="none" className={`w-3 h-3 transition-transform ${searchOpen ? 'rotate-90' : ''}`}>
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Focus areas (optional)
                {focus.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[9px]">{focus.length}</span>}
              </button>
              {searchOpen && (
                <div className="flex flex-wrap gap-2">
                  {FOCUS_OPTIONS.map((opt) => {
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
              )}
            </div>

            <button
              onClick={handleResearch}
              disabled={!company.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Research
            </button>
          </div>
        )}

        {/* Pipeline progress */}
        {(stage === 'searching' || stage === 'analyzing' || stage === 'done' || stage === 'error') && (
          <div className="max-w-2xl space-y-4">
            {/* Step 1: Searches */}
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
                  {stage === 'searching' ? 'Searching…' : 'Search complete'}
                </span>
              </div>
              <div className="ml-6 space-y-1.5">
                {searches.map((s, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${s.done ? 'bg-nv-green' : 'bg-nv-faint'}`} />
                    <span className="text-[11px] text-nv-muted font-mono truncate">{s.query}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 2: Analysis */}
            {(stage === 'analyzing' || stage === 'done' || stage === 'error') && (
              <div>
                <div className="flex items-center gap-2 mb-2">
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
                    {stage === 'analyzing' ? 'Analyzing & writing report…' : stage === 'done' ? 'Report ready' : 'Error'}
                  </span>
                </div>
              </div>
            )}

            {/* Report */}
            {(report || stage === 'analyzing') && (
              <div className="bg-nv-surface border border-nv-border rounded-xl p-5 mt-2">
                <ReportView text={report} streaming={stage === 'analyzing'} />
              </div>
            )}

            {/* Error */}
            {stage === 'error' && error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <p className="text-[12px] text-red-400 font-mono">{error}</p>
                <p className="text-[11px] text-nv-faint mt-1">
                  Make sure you have a valid plan or connect an API key (Gemini/OpenAI) in Connect Apps.
                </p>
              </div>
            )}

            {/* Website Sync — shown after report is complete */}
            {stage === 'done' && (
              <div className="mt-4 border border-nv-border rounded-xl p-4 bg-nv-surface">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-[12px] font-semibold text-nv-text flex items-center gap-1.5">
                      <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5 text-accent">
                        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                        <path d="M4.5 7l1.8 1.8L9.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Sync to Website
                    </p>
                    <p className="text-[10px] text-nv-faint font-mono mt-0.5">Update NIVARA.html with research insights → push to Vercel</p>
                  </div>
                  {wsStage === 'idle' && (
                    <button
                      onClick={handleWebsiteSync}
                      className="shrink-0 flex items-center gap-1.5 text-[11px] px-3 py-1.5 bg-accent text-white rounded-lg hover:bg-accent-dim transition-fast font-mono"
                    >
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                        <path d="M6 1v7M3.5 5.5L6 8l2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M1.5 9.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                      Push live
                    </button>
                  )}
                </div>

                {wsStage !== 'idle' && (
                  <div className={`flex items-center gap-2 text-[11px] font-mono px-3 py-2.5 rounded-lg border ${
                    wsStage === 'done'  ? 'bg-nv-green/10 border-nv-green/20 text-nv-green' :
                    wsStage === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                         'bg-accent/5 border-accent/20 text-nv-muted'
                  }`}>
                    {(wsStage === 'reading' || wsStage === 'updating' || wsStage === 'pushing') && (
                      <span className="w-3 h-3 rounded-full border border-accent/30 border-t-accent animate-spin shrink-0" />
                    )}
                    {wsStage === 'done' && (
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {wsStage === 'error' && <span className="shrink-0 text-[10px]">✕</span>}
                    <span>{wsError || wsLog}</span>
                    {wsStage === 'error' && (
                      <button
                        onClick={() => { setWsStage('idle'); setWsError(null); setWsLog(''); }}
                        className="ml-auto text-nv-faint hover:text-nv-text transition-fast"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Running indicator */}
      {isRunning && (
        <div className="shrink-0 px-5 py-2 border-t border-nv-border flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
          <span className="text-[11px] text-nv-faint font-mono">
            {stage === 'searching' ? `Gathering data about ${company}…` : `Writing research report…`}
          </span>
        </div>
      )}
    </div>
  );
}
