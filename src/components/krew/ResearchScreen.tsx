import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../../contexts/AuthContext';
import { credentialStore } from '../../lib/krewDb';
import type { Provider } from '../../lib/ai';
import Icon from '../Icon';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'idle' | 'planning' | 'searching' | 'reading' | 'analyzing' | 'done' | 'error';

// Files we can read reliably and instantly. Everything here is plain text under the hood, so it
// goes straight into the model with no conversion step and no parsing that can silently fail.
// Binary formats (PDF, DOCX, images) are deliberately excluded — a half-decoded PDF produces
// garbage context that quietly poisons the report, which is worse than not attaching anything.
const ATTACH_ACCEPT = '.md,.markdown,.txt,.csv,.tsv,.json,.yml,.yaml,.html';
const ATTACH_LABEL  = 'MD, TXT, CSV, TSV, JSON, YAML, HTML';
const ATTACH_MAX    = 200_000; // characters kept per file

interface AttachedDoc { name: string; content: string }

/** One competitor's public branding, read from their live homepage. */
interface BrandSignal {
  domain: string;
  title: string;
  description: string;
  colors: string[];
  headline: string;
}

/** Domains that are never competitors — directories, social, marketplaces, news aggregators. */
const SKIP_DOMAINS = /(google|bing|duckduckgo|wikipedia|youtube|facebook|twitter|x|linkedin|instagram|reddit|medium|quora|github|g2|capterra|crunchbase|producthunt|glassdoor|indeed|amazon|flipkart|yelp|tracxn|owler|zaubacorp)\./i;

/** Pull candidate competitor homepages out of the raw search results. */
function extractDomains(blobs: string[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const blob of blobs) {
    for (const m of blob.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const host = m[1].toLowerCase().replace(/^www\./, '');
      if (SKIP_DOMAINS.test(host + '.')) continue;
      if (host.split('.').length > 3) continue;           // deep subdomains are rarely the brand
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([d]) => d);
}

/** Normalise the colours a site actually paints itself with, most-used first. */
function extractColors(html: string): string[] {
  const counts = new Map<string, number>();
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (theme) counts.set(theme.trim().toLowerCase(), 100); // declared brand colour outranks any usage count
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let hex = m[1].toLowerCase();
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    // Ignore near-black/near-white/greys — every site uses them, so they say nothing about a brand.
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 25) continue;
    counts.set(`#${hex}`, (counts.get(`#${hex}`) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

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

/** **bold**, `code`, and markdown escapes like \$ — rendered inline. */
function renderInline(text: string): React.ReactNode[] {
  const unescaped = text.replace(/\\([$*_`~#])/g, '$1');
  // Bold, italic and code. `*italic*` was previously unhandled, so single asterisks leaked through
  // as literal "*" characters in the report; the bold pattern also now tolerates an inner "*".
  const parts = unescaped.split(/(\*\*[\s\S]+?\*\*|\*[^*\n]+\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, j) => {
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) {
      return <strong key={j} className="text-nv-text font-semibold">{p.slice(2, -2)}</strong>;
    }
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) {
      return <em key={j} className="italic">{p.slice(1, -1)}</em>;
    }
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) {
      return <code key={j} className="text-[12px] font-mono text-accent bg-accent/10 border border-accent/20 rounded px-1">{p.slice(1, -1)}</code>;
    }
    // Any ** that never found a partner would otherwise render as literal asterisks mid-sentence.
    return <span key={j}>{p.replace(/\*\*/g, '')}</span>;
  });
}

/** Split one markdown table row into cells, dropping the empty edges from the outer pipes. */
function splitRow(line: string): string[] {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return cells.map((c) => c.trim());
}
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-');

interface ListItem { text: string; depth: number }

/**
 * Block-level renderer.
 *
 * The previous version emitted bare <li> elements with no <ol>/<ul> around them. Browsers still
 * drew them, but the numbering ran CONTINUOUSLY through the whole document — which is why the
 * "5 Key Takeaways" section came out numbered 26–30. Consecutive items are now collected into a
 * real list element, so every list restarts at 1.
 *
 * It also accepts INDENTED bullets ("  * Pricing: …"). The old pattern was anchored with /^\* /,
 * so nested lines fell through to the paragraph branch and showed their raw asterisk.
 */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;

  const listBlock = (ordered: boolean, items: ListItem[], key: number) => {
    const Tag = ordered ? 'ol' : 'ul';
    return (
      <Tag key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1`}>
        {items.map((it, n) => (
          <li key={n} className="nv-prose" style={it.depth > 0 ? { marginLeft: it.depth * 16 } : undefined}>
            {renderInline(it.text)}
          </li>
        ))}
      </Tag>
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Tables ────────────────────────────────────────────────────────────────
    // Previously absent entirely: every "| a | b |" line fell through to the paragraph branch and
    // rendered as raw pipe text, which is why report tables looked broken while the same content
    // saved to the Brain looked fine. Blank lines BETWEEN rows are tolerated because the model
    // routinely emits them, which would otherwise end the table after its header.
    if (isTableRow(line) && !isTableSep(line)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;      // skip blanks before the separator
      if (j < lines.length && isTableSep(lines[j])) {
        const header = splitRow(line);
        const rows: string[][] = [];
        let k = j + 1;
        while (k < lines.length) {
          if (!lines[k].trim()) {                            // blank line — continue only if more rows follow
            let n = k + 1;
            while (n < lines.length && !lines[n].trim()) n++;
            if (n < lines.length && isTableRow(lines[n]) && !isTableSep(lines[n])) { k = n; continue; }
            break;
          }
          if (!isTableRow(lines[k])) break;
          if (!isTableSep(lines[k])) rows.push(splitRow(lines[k]));
          k++;
        }
        out.push(
          <div key={i} className="my-3 overflow-x-auto rounded-lg border border-nv-border">
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="bg-nv-surface2/60">
                  {header.map((h, n) => (
                    <th key={n} className="text-left font-semibold text-nv-text px-2.5 py-1.5 border-b border-nv-border whitespace-nowrap">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rn) => (
                  <tr key={rn} className="border-b border-nv-border/50 last:border-0 align-top">
                    {header.map((_, cn) => (
                      <td key={cn} className="px-2.5 py-1.5 text-nv-muted">{renderInline(r[cn] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        i = k;
        continue;
      }
    }

    const bullet  = line.match(/^(\s*)[-*•]\s+(.*)$/);
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);

    if (bullet || ordered) {
      const isOrdered = !!ordered && !bullet;
      const items: ListItem[] = [];
      // Consume the whole run, including blank lines that merely separate items.
      while (i < lines.length) {
        const b = lines[i].match(/^(\s*)[-*•]\s+(.*)$/);
        const o = lines[i].match(/^(\s*)\d+[.)]\s+(.*)$/);
        const m = b || o;
        if (m) {
          if (!!o && !b !== isOrdered) break;   // a different list kind starts — close this one
          items.push({ text: m[2], depth: Math.min(2, Math.floor(m[1].length / 2)) });
          i++;
        } else if (!lines[i].trim() && (lines[i + 1]?.match(/^(\s*)([-*•]|\d+[.)])\s+/))) {
          i++;                                   // blank line inside the list
        } else break;
      }
      out.push(listBlock(isOrdered, items, i));
      continue;
    }

    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^(#{1,6}) /)![1].length;
      const body = line.replace(/^#{1,6} /, '');
      out.push(level <= 2
        ? <h2 key={i} className="nv-heading mt-7 mb-2.5 pb-1.5 border-b border-nv-border">{body}</h2>
        : <h3 key={i} className="text-[13px] font-semibold text-nv-text mt-5 mb-1.5">{body}</h3>);
      i++; continue;
    }

    if (!line.trim()) { out.push(<div key={i} className="h-2" />); i++; continue; }

    out.push(<p key={i} className="nv-prose mb-2">{renderInline(line)}</p>);
    i++;
  }
  return out;
}

function ReportView({ text, streaming }: { text: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
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
        {renderMarkdown(text)}
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

interface SavedResearch {
  id: string;
  name: string;
  report: string;
  ts: number;
}

const HISTORY_KEY = 'nv-research-history';

function loadHistory(): SavedResearch[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); }
  catch { return []; }
}

export default function ResearchScreen({ initialQuery }: { initialQuery?: string }) {
  const { session } = useAuth();
  const callIdRef = useRef(0);

  const [businessName, setBusinessName] = useState('');

  useEffect(() => {
    if (initialQuery) setBusinessName(initialQuery);
  }, [initialQuery]);
  const [description,      setDescription]      = useState('');
  const [geo,              setGeo]              = useState<'india' | 'global'>('india');
  const [focus,            setFocus]            = useState<string[]>([]);
  const [stage,            setStage]            = useState<Stage>('idle');
  const [searches,         setSearches]         = useState<SearchResult[]>([]);
  const [report,           setReport]           = useState('');
  const [error,            setError]            = useState<string | null>(null);
  const [planStatus,       setPlanStatus]       = useState('');
  const [savedResearches,  setSavedResearches]  = useState<SavedResearch[]>(loadHistory);
  const [brands,           setBrands]           = useState<BrandSignal[]>([]);
  const [docs,             setDocs]             = useState<AttachedDoc[]>([]);
  const [attachError,      setAttachError]      = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setAttachError(null);
    const next: AttachedDoc[] = [];
    for (const f of Array.from(list)) {
      if (!new RegExp(`(${ATTACH_ACCEPT.split(',').join('|')})$`, 'i').test(f.name)) {
        setAttachError(`“${f.name}” isn't a readable text file. Allowed: ${ATTACH_LABEL}.`);
        continue;
      }
      try {
        const text = await f.text();
        next.push({ name: f.name, content: text.slice(0, ATTACH_MAX) });
      } catch {
        setAttachError(`Couldn't read “${f.name}”.`);
      }
    }
    if (next.length) setDocs((prev) => [...prev.filter((p) => !next.some((n) => n.name === p.name)), ...next]);
  }

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

  /**
   * Visit each competitor's homepage and read what they actually say and how they look. Search
   * snippets tell you a company exists; the homepage tells you how they position themselves and
   * what their brand looks like — which is what makes the report specific rather than generic.
   * Failures are silent by design: one unreachable site must never stop the research.
   */
  async function readBrandSignals(domains: string[]): Promise<BrandSignal[]> {
    const out: BrandSignal[] = [];
    for (const domain of domains) {
      try {
        const html = await invoke<string>('krew_http_call', {
          method: 'GET',
          url: `https://${domain}`,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; adris-research/1.0)', 'Accept': 'text/html' },
          body: null,
        });
        if (!html || html.length < 200) continue;
        const title = stripTags(html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1] ?? '').slice(0, 120);
        const description = stripTags(
          html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})["']/i)?.[1]
          ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,300})["']/i)?.[1]
          ?? '',
        ).slice(0, 240);
        const headline = stripTags(html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1] ?? '').slice(0, 140);
        out.push({ domain, title, description, headline, colors: extractColors(html) });
        setBrands([...out]);
      } catch { /* unreachable or blocked — skip this one */ }
    }
    return out;
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
    setBrands([]);
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

    // Read the competitors' own sites before analysing — positioning and branding come from the
    // homepage, not from a search snippet.
    setStage('reading');
    const brandSignals = await readBrandSignals(extractDomains(results)).catch(() => [] as BrandSignal[]);

    setStage('analyzing');

    const focusNote = focus.length
      ? `\nExtra focus areas requested: ${focus.map(f => FOCUS_OPTIONS.find(o => o.id === f)?.label ?? f).join(', ')}.`
      : '';

    const nameContext = businessName.trim() ? `Business name: ${businessName.trim()}\n` : '';

    // Only ask for the branding section when homepages were ACTUALLY read. Without this guard the
    // model happily produced confident hex codes it had never been given — the search fallback can
    // return no usable URLs, so brandSignals comes back empty and the whole section was invented.
    const brandSection = brandSignals.length > 0
      ? `\nALSO include this section before the takeaways:

## How They Present Themselves
(You have been given ${brandSignals.length} competitor homepage(s) — headline, description and brand
colours read from the live sites. Say what they have in COMMON: the words they all lean on, the
promises they all make, the palette the category defaults to. Then name the shared cliché and tell
the founder how to look different, in language and in visual identity. Refer to colours by the hex
values you were given, e.g. "#1a73e8 — the same corporate blue two of them use". Use ONLY the
domains, taglines and colours supplied below. Do not add a competitor or a colour that is not in
that list.)`
      : `\nNo competitor homepages could be read this run. DO NOT include a "How They Present
Themselves" section, and do NOT state any brand colours, hex codes or homepage taglines anywhere in
the report — you have not seen them and guessing them would be presented to the founder as fact.`;

    // Sections the user explicitly asked for. Without these the chosen focus areas only steered the
    // SEARCH queries; the report itself had nowhere to put funding or news, so they vanished.
    const wants = (id: string) => focus.includes(id);
    const focusSections = [
      wants('funding')  ? '\n\n## Funding & Investors\n(Who has raised what, from whom, and when — with amounts and dates where the data supports it. Say plainly if funding data was not found rather than guessing.)' : '',
      wants('news')     ? '\n\n## Recent News\n(Launches, pivots, price changes and announcements from the last 12–18 months, newest first, each with roughly when it happened.)' : '',
      wants('pricing')  ? '\n\n## Pricing Teardown\n(Every competitor\'s actual price points and packaging side by side, and where this founder can undercut or out-package them.)' : '',
      wants('products') ? '\n\n## Feature Comparison\n(A markdown TABLE: features as rows, competitors as columns, this founder\'s product as the first column. Mark gaps honestly.)' : '',
      wants('india')    ? '\n\n## India Specifics\n(Local pricing expectations, payment rails, compliance such as DPDP, language needs, and which competitors actually have an India presence.)' : '',
    ].join('');

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
(Five actionable bullets. Things the founder can act on this week or this month.)

${brandSection}${focusSections}`;

    const searchContext = queries.map((q, i) => `### Query: "${q}"\n${results[i] || '[no data]'}`).join('\n\n');

    const brandContext = brandSignals.length
      ? `\n\nCompetitor homepages I read directly (live sites):\n\n${brandSignals.map((b) =>
          `### ${b.domain}\nPage title: ${b.title || '—'}\nHeadline: ${b.headline || '—'}\nDescription: ${b.description || '—'}\nBrand colours: ${b.colors.length ? b.colors.join(', ') : '—'}`,
        ).join('\n\n')}`
      : '';

    const docContext = docs.length
      ? `\n\nMy own documents (treat as authoritative about MY business):\n\n${docs.map((d) =>
          `### ${d.name}\n${d.content.slice(0, 12000)}`).join('\n\n')}`
      : '';

    const userMsg = `${nameContext}My business: ${description.trim()}
Geography: ${geography}${focusNote}

Here is the gathered market data:

${searchContext}${brandContext}${docContext}

Write the competitive intelligence report now.`;

    try {
      const finalReport = await streamAI(systemPrompt, [{ role: 'user', content: userMsg }], chunk => {
        setReport(prev => prev + chunk);
      });
      setStage('done');
      // Persist to history
      const item: SavedResearch = {
        id: Date.now().toString(),
        name: businessName.trim() || description.trim().slice(0, 50),
        report: finalReport,
        ts: Date.now(),
      };
      const updated = [item, ...loadHistory()].slice(0, 15);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setSavedResearches(updated);
      // ALSO save the report to the Brain so agents can recall it later instead of
      // re-researching (this screen previously had zero Brain integration — reports
      // vanished from the agents' perspective the moment you left the screen).
      // One node per business name, updated in place — repeated research on the same
      // business refreshes the note rather than piling up duplicates.
      import('../../lib/knowledgeStore').then(({ brain }) => {
        const title = `Research · ${item.name}`.slice(0, 80);
        const existing = brain.findByTitle(title);
        if (existing) brain.updateNode(existing.id, { body: finalReport.slice(0, 16000) });
        else brain.addNode({ title, kind: 'note', body: finalReport.slice(0, 16000) });
      }).catch(() => {});
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

  function loadSaved(item: SavedResearch) {
    setBusinessName(item.name);
    setReport(item.report);
    setStage('done');
    setSearches([]);
    setError(null);
  }

  function deleteSaved(id: string) {
    const updated = savedResearches.filter(r => r.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setSavedResearches(updated);
  }

  const isRunning = stage === 'planning' || stage === 'searching' || stage === 'reading' || stage === 'analyzing';

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
          <div className="max-w-[680px] mx-auto">

            {/* Title block — reads like a page, not a form */}
            <p className="text-[10px] font-mono uppercase tracking-wider text-accent mb-2">Competitive intelligence</p>
            <h1 className="text-[26px] font-semibold text-nv-text leading-tight mb-2.5">Know exactly who you're up against</h1>
            <p className="text-[13px] leading-[1.7] text-nv-muted mb-8">
              Tell us what you do. We plan targeted searches, read your competitors' own websites — their
              positioning, their language, even their brand colours — and write you a report on where you
              stand and how to win. It's saved to your Brain so your agents can use it later.
            </p>

            {/* Business name */}
            <label className="block mb-5">
              <span className="text-[12px] font-medium text-nv-text block mb-1.5">
                Your business name <span className="text-nv-faint font-normal">— optional</span>
              </span>
              <input
                value={businessName}
                onChange={e => setBusinessName(e.target.value)}
                placeholder="adris.tech"
                className="w-full bg-nv-surface border border-nv-border rounded-xl px-3.5 py-2.5 text-[13px] text-nv-text placeholder:text-nv-faint outline-none focus:border-accent transition-fast"
              />
            </label>

            {/* Description */}
            <label className="block mb-5">
              <span className="text-[12px] font-medium text-nv-text block mb-1.5">
                What does your business do? <span className="text-accent">*</span>
              </span>
              <span className="text-[11.5px] leading-[1.6] text-nv-muted block mb-2">
                Who is your customer, what problem do you solve, and what are your main features? The more
                specific you are, the more specific the report — a vague description produces vague advice.
              </span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={'We\'re building an AI productivity app for Indian SMBs — workflow automation, AI agents for marketing, and running AI models locally. Target: 10–200 person companies in India who want AI but can\'t afford enterprise tools.'}
                rows={5}
                autoFocus
                className="w-full bg-nv-surface border border-nv-border rounded-xl px-3.5 py-3 text-[13px] leading-[1.65] text-nv-text placeholder:text-nv-faint outline-none focus:border-accent transition-fast resize-none"
              />
            </label>

            {/* Attachments */}
            <div className="mb-5">
              <span className="text-[12px] font-medium text-nv-text block mb-1.5">
                Attach your own documents <span className="text-nv-faint font-normal">— optional</span>
              </span>
              <span className="text-[11.5px] leading-[1.6] text-nv-muted block mb-2">
                A product brief, pitch notes or a pricing sheet makes the analysis far sharper. Accepted:{' '}
                <span className="text-nv-text">{ATTACH_LABEL}</span> — plain-text formats we can read instantly
                and exactly. PDFs and Word files aren't accepted, because partially-decoded text quietly
                corrupts the report; paste the relevant part into the box above instead.
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 text-[12px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
                Choose files
              </button>
              {attachError && <p className="text-[11px] text-red-400 mt-2">{attachError}</p>}
              {docs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {docs.map((d) => (
                    <span key={d.name} className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-nv-surface border border-nv-border text-nv-muted">
                      <Icon name="file" size={12} className="text-accent" />
                      <span className="max-w-[180px] truncate">{d.name}</span>
                      <span className="text-nv-faint font-mono text-[9px]">{Math.max(1, Math.round(d.content.length / 1000))}k</span>
                      <button onClick={() => setDocs((p) => p.filter((x) => x.name !== d.name))} className="text-nv-faint hover:text-red-400 ml-0.5">✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Geography */}
            <div className="mb-5">
              <span className="text-[12px] font-medium text-nv-text block mb-2">Which market?</span>
              <div className="flex gap-2">
                {(['india', 'global'] as const).map(g => (
                  <button
                    key={g}
                    onClick={() => setGeo(g)}
                    className={`flex items-center gap-2 text-[12px] px-4 py-2 rounded-lg border transition-fast ${
                      geo === g
                        ? 'border-accent bg-accent/10 text-accent font-medium'
                        : 'border-nv-border text-nv-muted hover:border-nv-faint hover:text-nv-text'
                    }`}
                  >
                    <Icon name={g === 'india' ? 'india' : 'globe'} size={13} />
                    {g === 'india' ? 'India' : 'Global'}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus areas */}
            <div className="mb-8">
              <span className="text-[12px] font-medium text-nv-text block mb-1.5">
                Go deeper on <span className="text-nv-faint font-normal">— optional</span>
              </span>
              <span className="text-[11.5px] leading-[1.6] text-nv-muted block mb-2">
                Pick any that matter and we'll aim the searches at them.
              </span>
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map(opt => {
                  const active = focus.includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleFocus(opt.id)}
                      className={`text-[12px] px-3 py-1.5 rounded-lg border transition-fast ${
                        active
                          ? 'border-accent/50 bg-accent/10 text-accent font-medium'
                          : 'border-nv-border text-nv-muted hover:border-nv-faint hover:text-nv-text'
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
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-[12.5px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6"/>
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
              Research my market
            </button>
            <p className="text-[11px] text-nv-faint mt-2">Usually takes one to two minutes.</p>

            {savedResearches.length > 0 && (
              <div className="mt-8">
                <p className="nv-eyebrow text-nv-muted mb-2">Previous research</p>
                <div className="space-y-1.5">
                  {savedResearches.map(item => (
                    <div key={item.id} className="flex items-center gap-2 group">
                      <button
                        onClick={() => loadSaved(item)}
                        className="flex-1 text-left px-3 py-2 rounded-lg bg-nv-surface border border-nv-border hover:border-accent/40 transition-fast"
                      >
                        <p className="text-[12px] text-nv-text truncate">{item.name}</p>
                        <p className="text-[10px] text-nv-faint font-mono">
                          {new Date(item.ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </button>
                      <button
                        onClick={() => deleteSaved(item.id)}
                        className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-red text-[12px] transition-fast px-1"
                        title="Delete"
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
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

            {/* Step 2: Reading competitor sites */}
            {/* Say so when no homepage could be read — otherwise the step silently vanishes and it
                looks like the browser stage never ran. */}
            {(stage === 'analyzing' || stage === 'done') && brands.length === 0 && (
              <div className="flex items-start gap-2">
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 bg-nv-yellow/20 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-nv-yellow" />
                </div>
                <p className="text-[11px] text-nv-muted leading-relaxed max-w-[520px]">
                  Couldn't read any competitor homepages this run — the search step returned no usable
                  site links. The report is written from search results only, and deliberately leaves out
                  brand colours and taglines rather than guessing them.
                  {' '}Adding a Brave Search key in Connect Apps gives far richer results here.
                </p>
              </div>
            )}
            {(stage === 'reading' || stage === 'analyzing' || stage === 'done' || stage === 'error') && brands.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${stage === 'reading' ? 'bg-accent/20' : 'bg-nv-green/20'}`}>
                    {stage === 'reading' ? (
                      <span className="w-2 h-2 rounded-full bg-accent" style={{ animation: 'pulse 1s ease-in-out infinite' }} />
                    ) : (
                      <svg viewBox="0 0 12 12" fill="none" className="w-2.5 h-2.5">
                        <path d="M2 6l3 3 5-5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-nv-text font-mono">
                    {stage === 'reading' ? 'Reading competitor websites…' : `Read ${brands.length} competitor site${brands.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="ml-6 space-y-1.5">
                  {brands.map((b) => (
                    <div key={b.domain} className="flex items-center gap-2">
                      <div className="mt-0 w-1.5 h-1.5 rounded-full shrink-0 bg-nv-green" />
                      <span className="text-[11px] text-nv-muted font-mono truncate max-w-[220px]">{b.domain}</span>
                      {/* Their actual palette, so the report's colour claims are visibly grounded */}
                      <span className="flex gap-1 shrink-0">
                        {b.colors.map((c) => (
                          <span key={c} title={c} className="w-3 h-3 rounded-sm border border-nv-border" style={{ background: c }} />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Analysis */}
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
