import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../contexts/AuthContext';
import { credentialStore } from '../lib/krewDb';
import type { Provider } from '../lib/ai';

// ─── Project types & formats ───────────────────────────────────────────────────

type ProjectType = 'video' | 'screen' | 'banner' | 'component';

interface Format {
  id: string;
  label: string;
  w: number;
  h: number;
}

const FORMATS: Record<ProjectType, Format[]> = {
  video: [
    { id: 'story',  label: 'Story · 9:16',   w: 1080, h: 1920 },
    { id: 'square', label: 'Square · 1:1',   w: 1080, h: 1080 },
    { id: 'wide',   label: 'Wide · 16:9',    w: 1280, h:  720 },
  ],
  screen: [
    { id: 'desktop', label: 'Desktop',       w: 1440, h:  900 },
    { id: 'mobile',  label: 'Mobile',        w:  390, h:  844 },
    { id: 'tablet',  label: 'Tablet',        w:  768, h: 1024 },
  ],
  banner: [
    { id: 'fb',   label: 'Facebook / LinkedIn', w: 1200, h: 630  },
    { id: 'ig',   label: 'Instagram Post',      w: 1080, h: 1080 },
    { id: 'tw',   label: 'X / Twitter Header',  w: 1500, h: 500  },
  ],
  component: [
    { id: 'card',  label: 'Card / Widget',  w: 600, h: 400 },
    { id: 'hero',  label: 'Hero Section',   w: 1200, h: 600 },
    { id: 'modal', label: 'Modal Dialog',   w: 480, h: 360 },
  ],
};

const DURATIONS = [5, 10, 15, 20, 30, 45, 60];

// ─── Animations framework path ────────────────────────────────────────────────

const ANIMATIONS_PATH = "C:\\Users\\amogh\\OneDrive\\Desktop\\NIVARA\\video (for ref. only)\\animations.jsx";

// ─── HTML builders ─────────────────────────────────────────────────────────────

function buildVideoHtml(sceneCode: string, animationsJs: string, fmt: Format, duration: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;height:100%;background:#0a0a0a;font-family:'Inter Tight',system-ui,sans-serif;overflow:hidden}
  #root{position:absolute;inset:0}
</style>
</head>
<body>
<div id="root" data-w="${fmt.w}" data-h="${fmt.h}" data-dur="${duration}"></div>
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin></script>
<script type="text/babel">
// ── Animations framework ──────────────────────────────────────────────────────
${animationsJs}
// ── Scene ─────────────────────────────────────────────────────────────────────
${sceneCode}
</script>
</body>
</html>`;
}

function buildStaticHtml(code: string): string {
  if (code.trimStart().startsWith('<!DOCTYPE') || code.trimStart().startsWith('<html')) return code;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%}</style></head><body>${code}</body></html>`;
}

// ─── AI helpers ───────────────────────────────────────────────────────────────

async function loadAllCreds(): Promise<Record<string, Record<string, string>>> {
  const services = await credentialStore.list().catch(() => [] as string[]);
  const out: Record<string, Record<string, string>> = {};
  for (const s of services) {
    const d = await credentialStore.get(s).catch(() => null);
    if (d) out[s] = d as Record<string, string>;
  }
  return out;
}

// ─── System prompts ───────────────────────────────────────────────────────────

function buildVideoPrompt(fmt: Format, duration: number, desc: string): string {
  return `You are an expert at creating animated marketing videos using React with the Stage/Sprite animations framework.

Available window globals (already loaded):
• Stage({width,height,duration,background,fps,loop,autoplay}) — root container
• Sprite({start,end,children}) — time-window renderer. children fn: ({localTime,progress,duration})=>JSX
• TextSprite({text,x,y,size,color,font,weight,entryDur,exitDur,align,letterSpacing}) — animated text
• RectSprite({x,y,width,height,color,radius,entryDur,exitDur}) — animated rectangle
• ImageSprite({x,y,width,height,placeholder:{label},entryDur,exitDur,kenBurns}) — animated image/placeholder
• useTime() → current playhead seconds
• useTimeline() → { time, duration, playing }
• useSprite() → inside Sprite: { localTime, progress, duration }
• Easing → { easeOutCubic,easeInCubic,easeInOutCubic,easeOutBack,easeOutElastic,linear,easeInQuad,easeOutQuad }
• animate({from,to,start,end,ease}) — single-segment tween factory (t)=>value
• interpolate([t0,t1,...],[v0,v1,...],ease?) — multi-keyframe tween
• clamp(v,min,max)

Fonts available: 'Inter Tight' (display/headlines), 'JetBrains Mono' (monospace/code)
Brand palette: PURPLE=#6d4cff  DARK=#0c0b14  PAPER=#f7f5f1  INK2=#3a3548  INK3=#7a7388

Canvas: ${fmt.w}×${fmt.h}px   Duration: ${duration}s
Content: ${desc}

Rules:
1. Output ONLY valid JavaScript/JSX — no import/export, no HTML, no markdown fences
2. Use Sprites for ALL animated elements — position elements in 0,0 → ${fmt.w},${fmt.h} space
3. Make it smooth and professional — use easeOutBack for entries, easeInCubic for exits
4. Must end with EXACTLY:
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));`;
}

function buildScreenPrompt(fmt: Format, desc: string, style: string): string {
  return `You are an expert UI designer. Generate a complete, self-contained HTML document for a ${fmt.label} (${fmt.w}×${fmt.h}px) UI screen.

Requirements:
- Complete HTML with all CSS embedded in <style> tag
- Canvas exactly ${fmt.w}×${fmt.h}px — set on body or a root div
- Style: ${style}
- Use Google Fonts via @import for premium typography
- Interactive if it makes sense (hover states, basic JS)
- Pixel-perfect, publication-ready quality

Content/purpose: ${desc}

Output ONLY the complete HTML document starting with <!DOCTYPE html>.`;
}

function buildBannerPrompt(fmt: Format, desc: string, style: string): string {
  return `You are an expert graphic designer. Generate a complete, self-contained HTML document for a ${fmt.label} social media banner (${fmt.w}×${fmt.h}px).

Requirements:
- Complete HTML with all CSS in <style> — no external dependencies except Google Fonts
- Exact dimensions: ${fmt.w}×${fmt.h}px on body/root
- Add subtle CSS animations (fade-in, slight motion) for polish
- Style direction: ${style}
- Use Google Fonts @import for typography
- No JavaScript beyond basic animation

Design intent: ${desc}

Output ONLY the complete HTML starting with <!DOCTYPE html>.`;
}

function buildComponentPrompt(fmt: Format, desc: string, style: string): string {
  return `You are a senior frontend developer. Generate a complete, self-contained HTML document with a polished UI component.

Requirements:
- Complete HTML, CSS in <style>, JavaScript in <script> tags
- The component is displayed centered inside ${fmt.w}×${fmt.h}px canvas
- Fully interactive where appropriate
- Use CSS custom properties for theming
- Clean, modern code
- Style: ${style}

Component to build: ${desc}

Output ONLY the complete HTML starting with <!DOCTYPE html>.`;
}

const STYLES = [
  { id: 'brand',     label: 'Nivara Brand',  desc: 'Purple #6d4cff, dark ink, Inter Tight — match Nivara visual identity' },
  { id: 'minimal',   label: 'Minimal',       desc: 'Clean white/light, generous space, sharp type, no decoration' },
  { id: 'bold',      label: 'Bold',          desc: 'High contrast, dominant typography, strong accent colors' },
  { id: 'dark',      label: 'Dark Glass',    desc: 'Deep dark background, glassmorphism, glowing accents' },
  { id: 'vibrant',   label: 'Vibrant',       desc: 'Colorful gradients, energetic, social-first visual' },
  { id: 'corporate', label: 'Corporate',     desc: 'Professional, blue/navy palette, trustworthy, serif accents' },
];

// ─── History entry ────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  prompt: string;
  html: string;
  type: ProjectType;
  format: Format;
  at: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StudioModule() {
  const { session } = useAuth();
  const callIdRef = useRef(0);

  const [type,       setType]       = useState<ProjectType>('video');
  const [format,     setFormat]     = useState<Format>(FORMATS.video[0]);
  const [duration,   setDuration]   = useState(15);
  const [style,      setStyle]      = useState(STYLES[0].id);
  const [prompt,     setPrompt]     = useState('');
  const [generating, setGenerating] = useState(false);
  const [html,       setHtml]       = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [copied,     setCopied]     = useState(false);
  const [streamLog,  setStreamLog]  = useState('');

  function handleTypeChange(t: ProjectType) {
    setType(t);
    setFormat(FORMATS[t][0]);
    setHtml(null);
    setError(null);
  }

  async function streamAI(
    systemPrompt: string,
    userMessage: string,
    onChunk: (t: string) => void,
  ): Promise<string> {
    const callId = String(++callIdRef.current);
    let full = '';
    const done = { cleanup: () => {} };

    const creds = await loadAllCreds();
    let mode: string = 'nivara';
    let apiKey: string | null = null;
    let provider: Provider | null = null;

    for (const [svc, p] of [['gemini', 'gemini'], ['openai', 'openai'], ['claude', 'claude']] as [string, Provider][]) {
      if (creds[svc]?.api_key) { mode = 'own_key'; apiKey = creds[svc].api_key; provider = p; break; }
    }

    return new Promise<string>(async (resolve, reject) => {
      const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
        if (e.payload.id !== callId) return;
        full += e.payload.text;
        onChunk(e.payload.text);
      });
      const u2 = await listen<{ id: string }>('krew-done', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); resolve(full);
      });
      const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
        if (e.payload.id !== callId) return;
        done.cleanup(); reject(new Error(e.payload.error));
      });
      done.cleanup = () => { u1(); u2(); u3(); };

      invoke('krew_ai_stream', {
        callId, mode,
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        apiKey, provider,
        localModel: null, modelName: null, baseUrl: null,
        sessionToken: session?.access_token ?? null,
      }).catch((e: unknown) => { done.cleanup(); reject(e); });
    });
  }

  function extractCode(raw: string): string {
    // Strip markdown code fences if AI wrapped them
    const fenced = raw.match(/```(?:html|jsx?|tsx?)?\n([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    // Strip doctype if AI included it for video (we don't need it — it's scene code)
    return raw.trim();
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setStreamLog('');

    const selectedStyle = STYLES.find((s) => s.id === style)!;
    let raw = '';

    try {
      if (type === 'video') {
        // Load animations.jsx from disk
        let animationsJs: string;
        try {
          animationsJs = await invoke<string>('krew_read_file', { path: ANIMATIONS_PATH });
        } catch {
          throw new Error('animations.jsx not found. Make sure the "video (for ref. only)" folder is at C:\\Users\\amogh\\OneDrive\\Desktop\\NIVARA\\');
        }

        const sysPrompt = buildVideoPrompt(format, duration, prompt);
        await streamAI(sysPrompt, `Create the animation now. Duration: ${duration}s, Canvas: ${format.w}x${format.h}px. Content: ${prompt}`, (chunk) => {
          raw += chunk;
          setStreamLog(raw.slice(-300));
        });

        const sceneCode = extractCode(raw);
        const finalHtml = buildVideoHtml(sceneCode, animationsJs, format, duration);
        setHtml(finalHtml);
        setHistory((h) => [{ id: Date.now().toString(), prompt, html: finalHtml, type, format, at: Date.now() }, ...h.slice(0, 19)]);

      } else {
        const sysPrompt =
          type === 'screen'    ? buildScreenPrompt(format, prompt, `${selectedStyle.label} — ${selectedStyle.desc}`) :
          type === 'banner'    ? buildBannerPrompt(format, prompt, `${selectedStyle.label} — ${selectedStyle.desc}`) :
                                 buildComponentPrompt(format, prompt, `${selectedStyle.label} — ${selectedStyle.desc}`);

        await streamAI(sysPrompt, prompt, (chunk) => {
          raw += chunk;
          setStreamLog(raw.slice(-300));
        });

        const code = extractCode(raw);
        const finalHtml = buildStaticHtml(code);
        setHtml(finalHtml);
        setHistory((h) => [{ id: Date.now().toString(), prompt, html: finalHtml, type, format, at: Date.now() }, ...h.slice(0, 19)]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
      setStreamLog('');
    }
  }

  function handleDownload() {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio_${type}_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    if (!html) return;
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const previewScale = html && format
    ? Math.min(1, 560 / format.w, 400 / format.h)
    : 1;

  const TYPE_ICONS: Record<ProjectType, React.ReactNode> = {
    video: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <rect x="1" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M11 5.5l4-2v9l-4-2V5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      </svg>
    ),
    screen: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 14h6M8 12v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    ),
    banner: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="5" cy="8" r="1.5" fill="currentColor" opacity=".5"/>
        <path d="M8 7h5M8 9h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    ),
    component: (
      <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
        <path d="M8 2L14 5.5v5L8 14 2 10.5v-5L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity=".4"/>
      </svg>
    ),
  };

  return (
    <div className="flex h-full overflow-hidden bg-nv-bg">

      {/* ── LEFT PANEL: type + format + style ─────────────────────────────────── */}
      <div className="w-52 shrink-0 flex flex-col border-r border-nv-border overflow-y-auto">
        {/* Brand strip */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-nv-border shrink-0">
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-accent">
            <path d="M8 1l1.5 4.5H14l-3.7 2.7 1.4 4.3L8 10 4.3 12.5 5.7 8.2 2 5.5h4.5z" fill="currentColor"/>
          </svg>
          <span className="text-[12px] font-semibold text-nv-text">Studio</span>
        </div>

        <div className="p-3 space-y-4 flex-1">
          {/* Project type */}
          <div>
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5">Type</p>
            {(['video', 'screen', 'banner', 'component'] as ProjectType[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg mb-1 text-left transition-fast ${
                  type === t ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:bg-nv-surface2 hover:text-nv-text'
                }`}
              >
                {TYPE_ICONS[t]}
                <span className="text-[12px] font-medium capitalize">{t === 'component' ? 'Component' : t === 'screen' ? 'UI Screen' : t === 'banner' ? 'Banner / Poster' : 'Video / Animation'}</span>
              </button>
            ))}
          </div>

          {/* Format */}
          <div>
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5">Format</p>
            {FORMATS[type].map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg mb-1 text-left transition-fast ${
                  format.id === f.id ? 'bg-accent/10 text-accent' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2'
                }`}
              >
                <span className="text-[11px]">{f.label}</span>
                <span className="text-[9px] font-mono opacity-60">{f.w}×{f.h}</span>
              </button>
            ))}
          </div>

          {/* Duration (video only) */}
          {type === 'video' && (
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5">Duration</p>
              <div className="flex flex-wrap gap-1">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`px-2 py-1 rounded text-[10px] font-mono border transition-fast ${
                      duration === d ? 'border-accent/50 bg-accent/10 text-accent' : 'border-nv-border text-nv-faint hover:border-nv-muted'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Style (non-video) */}
          {type !== 'video' && (
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5">Style</p>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg mb-1 text-left transition-fast ${
                    style === s.id ? 'bg-accent/10 text-accent' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2'
                  }`}
                >
                  {style === s.id && <span className="text-[9px] mt-0.5">✓</span>}
                  <span className="text-[11px]">{s.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5">History</p>
              {history.slice(0, 8).map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHtml(h.html)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg mb-1 hover:bg-nv-surface2 transition-fast"
                >
                  <p className="text-[10px] text-nv-muted truncate">{h.prompt}</p>
                  <p className="text-[9px] text-nv-faint font-mono">{h.type} · {h.format.label}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── CENTER PANEL: preview ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 h-9 border-b border-nv-border shrink-0">
          <span className="text-[10px] text-nv-faint font-mono flex-1">
            {format.label} · {format.w}×{format.h}px
            {type === 'video' && ` · ${duration}s`}
          </span>
          {html && (
            <>
              <button
                onClick={handleCopy}
                className="text-[10px] text-nv-faint hover:text-nv-text font-mono px-2 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
              >
                {copied ? '✓ Copied' : 'Copy HTML'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 text-[10px] text-accent font-mono px-2 py-1 rounded border border-accent/30 hover:bg-accent/10 transition-fast"
              >
                <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                  <path d="M5 1v6M2 5l3 2 3-2M1 9h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download
              </button>
            </>
          )}
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-hidden flex items-center justify-center bg-[#080808] relative">
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#080808]">
              <div className="w-8 h-8 rounded-full border-2 border-nv-border border-t-accent animate-spin" />
              <p className="text-[11px] text-nv-faint font-mono">Generating {type}…</p>
              {streamLog && (
                <pre className="text-[9px] text-nv-faint/50 font-mono max-w-xs text-center opacity-60 line-clamp-3 overflow-hidden">
                  {streamLog}
                </pre>
              )}
            </div>
          )}

          {!generating && !html && !error && (
            <div className="flex flex-col items-center gap-3 text-nv-faint opacity-30 pointer-events-none select-none">
              <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16">
                <rect x="8" y="8" width="48" height="48" rx="8" stroke="currentColor" strokeWidth="2"/>
                <path d="M8 40l14-14 10 10 10-10 14 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="22" cy="22" r="5" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <p className="text-[13px] font-medium">Describe → Generate</p>
            </div>
          )}

          {error && (
            <div className="max-w-sm mx-auto p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
              <p className="text-[12px] text-red-400 font-mono mb-1">Generation failed</p>
              <p className="text-[11px] text-nv-faint leading-relaxed">{error}</p>
            </div>
          )}

          {html && !generating && (
            <div
              className="shadow-2xl overflow-hidden rounded"
              style={{ width: format.w * previewScale, height: format.h * previewScale }}
            >
              <iframe
                key={html.length}
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin"
                scrolling={type === 'screen' || type === 'component' ? 'auto' : 'no'}
                style={{
                  width: format.w,
                  height: format.h,
                  border: 'none',
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                  pointerEvents: type === 'video' ? 'auto' : 'none',
                }}
                title="Studio preview"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: prompt ───────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-l border-nv-border">
        <div className="px-4 py-3 border-b border-nv-border shrink-0">
          <p className="text-[11px] font-semibold text-nv-text">Prompt</p>
          <p className="text-[9px] text-nv-faint font-mono mt-0.5">Describe what to create</p>
        </div>

        <div className="flex-1 p-3">
          <PromptExamples type={type} onSelect={setPrompt} />
        </div>

        <div className="p-3 border-t border-nv-border shrink-0">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
            placeholder={
              type === 'video'
                ? 'Animated product launch video — dark background, purple accents, show the Nivara logo entering from top, text reveals…'
                : type === 'screen'
                ? 'Modern SaaS dashboard with sidebar, data charts, dark theme…'
                : type === 'banner'
                ? 'Instagram post announcing a new product launch — bold headline, vibrant gradient…'
                : 'Glassmorphism pricing card with monthly/yearly toggle…'
            }
            rows={6}
            className="w-full bg-nv-surface border border-nv-border rounded-xl px-3 py-2.5 text-[12px] text-nv-text placeholder-nv-faint/70 outline-none focus:border-accent transition-fast resize-none leading-relaxed mb-3"
          />

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5">
                  <path d="M7 1l1.3 3.9H12l-3.2 2.3 1.2 3.7L7 8.8l-3 2.2 1.2-3.7L2 5l3.7-.1L7 1z" fill="currentColor"/>
                </svg>
                Generate
                <span className="text-[10px] opacity-60 ml-0.5">⌘↵</span>
              </>
            )}
          </button>

          {html && !generating && (
            <button
              onClick={() => { setHtml(null); }}
              className="w-full mt-2 text-[11px] text-nv-faint hover:text-nv-muted font-mono py-1.5 rounded-xl border border-nv-border hover:border-nv-muted transition-fast"
            >
              Clear preview
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Prompt examples ──────────────────────────────────────────────────────────

function PromptExamples({ type, onSelect }: { type: ProjectType; onSelect: (p: string) => void }) {
  const examples: Record<ProjectType, string[]> = {
    video: [
      'Nivara product launch — dark bg, purple logo entrance, text reveals "The AI OS for India", CTA at end',
      'Krew module showcase — agents appearing one by one, animated connections, 15 second story format',
      'Minimal marketing video — clean white bg, headline fades in, three feature bullets appear, logo close',
    ],
    screen: [
      'SaaS analytics dashboard — sidebar, line charts, KPI cards, dark theme, Inter font',
      'Mobile app onboarding — 3 steps with illustrations, progress dots, CTA button',
      'Landing page hero — big headline, subtext, two CTA buttons, subtle gradient bg',
    ],
    banner: [
      'Product launch Instagram post — "Nivara v1.0 is live" bold headline, purple gradient',
      'LinkedIn post announcing a new AI feature — professional, clean, company colors',
      'YouTube thumbnail — bold red/black, big text, face placeholder, high contrast',
    ],
    component: [
      'Glassmorphism pricing card with monthly/yearly toggle and gradient CTA button',
      'Notification toast component — success/error/info variants with animations',
      'Feature comparison table — two plans, checkmarks, highlighted recommended column',
    ],
  };

  return (
    <div>
      <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">Examples</p>
      {examples[type].map((ex, i) => (
        <button
          key={i}
          onClick={() => onSelect(ex)}
          className="w-full text-left px-2.5 py-2 rounded-lg mb-1.5 border border-nv-border/60 hover:border-accent/30 hover:bg-accent/5 transition-fast"
        >
          <p className="text-[10px] text-nv-muted leading-relaxed">{ex}</p>
        </button>
      ))}
    </div>
  );
}
