import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../contexts/AuthContext';
import { credentialStore } from '../lib/krewDb';
import type { Provider } from '../lib/ai';

// ─── Project types & formats ────────────────────────────────────────────────

type ProjectType = 'video' | 'screen' | 'banner' | 'component';

interface Format {
  id: string;
  label: string;
  w: number;
  h: number;
}

const FORMATS: Record<ProjectType, Format[]> = {
  video: [
    { id: 'story',  label: 'Story · 9:16',  w: 1080, h: 1920 },
    { id: 'square', label: 'Square · 1:1',  w: 1080, h: 1080 },
    { id: 'wide',   label: 'Wide · 16:9',   w: 1280, h: 720  },
  ],
  screen: [
    { id: 'desktop', label: 'Desktop',  w: 1440, h: 900  },
    { id: 'mobile',  label: 'Mobile',   w: 390,  h: 844  },
    { id: 'tablet',  label: 'Tablet',   w: 768,  h: 1024 },
  ],
  banner: [
    { id: 'ig',   label: 'Instagram Post',      w: 1080, h: 1080 },
    { id: 'fb',   label: 'Facebook / LinkedIn',  w: 1200, h: 630  },
    { id: 'tw',   label: 'Twitter Header',       w: 1500, h: 500  },
    { id: 'yt',   label: 'YouTube Thumbnail',    w: 1280, h: 720  },
  ],
  component: [
    { id: 'card',  label: 'Card / Widget', w: 600,  h: 400 },
    { id: 'hero',  label: 'Hero Section',  w: 1200, h: 600 },
    { id: 'modal', label: 'Modal Dialog',  w: 480,  h: 360 },
  ],
};

const DURATIONS = [5, 10, 15, 20, 30, 45, 60];

const STYLES = [
  { id: 'brand',     label: 'Nivara Brand',  desc: 'Purple #6d4cff, dark ink, Inter Tight — Nivara identity' },
  { id: 'minimal',   label: 'Minimal',       desc: 'Clean white, generous space, sharp type' },
  { id: 'bold',      label: 'Bold',          desc: 'High contrast, dominant typography' },
  { id: 'dark',      label: 'Dark Glass',    desc: 'Deep background, glassmorphism, glowing accents' },
  { id: 'vibrant',   label: 'Vibrant',       desc: 'Colorful gradients, energetic, social-first' },
  { id: 'corporate', label: 'Corporate',     desc: 'Professional, blue/navy, trustworthy' },
];

// ─── Built-in NV animation runtime (embedded — no external file needed) ──────

const NV_RUNTIME = `
const NV=(()=>{
  const stage=document.getElementById('stage');
  let t0=null,dur=__DUR__*1000,cbs=[],looping=false;
  const ease={
    out:(t)=>1-Math.pow(1-t,3),
    in:(t)=>t*t*t,
    inOut:(t)=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
    back:(t)=>{const c=1.70158+1;return 1+c*Math.pow(t-1,3)+1.70158*Math.pow(t-1,2)},
    elastic:(t)=>{if(t===0||t===1)return t;return Math.pow(2,-10*t)*Math.sin((t*10-0.75)*(2*Math.PI)/3)+1},
    linear:(t)=>t,
  };
  function lerp(a,b,t){return a+(b-a)*t}
  function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
  function el(tag,css,parent){
    const e=document.createElement(tag||'div');
    Object.assign(e.style,{position:'absolute',...(css||{})});
    (parent||stage).appendChild(e);return e;
  }
  function text(txt,x,y,opts){
    opts=opts||{};
    const d=el('div',{left:x+'px',top:y+'px',transform:'translate(-50%,-50%)',
      color:opts.color||'#fff',fontSize:(opts.size||48)+'px',fontWeight:opts.weight||700,
      fontFamily:opts.font||"'Inter Tight',system-ui,sans-serif",textAlign:opts.align||'center',
      whiteSpace:'nowrap',lineHeight:1.1,opacity:'0',...(opts.css||{})});
    d.textContent=txt;return d;
  }
  function rect(x,y,w,h,opts){
    opts=opts||{};
    return el('div',{left:x+'px',top:y+'px',width:w+'px',height:h+'px',
      background:opts.bg||'#6d4cff',borderRadius:(opts.r||0)+'px',opacity:'0',...(opts.css||{})});
  }
  function animate(elem,from,to,s,e,easeFn){
    easeFn=easeFn||ease.out;
    cbs.push(t=>{
      const lo=clamp((t-(s||0))/((e||1)-(s||0)),0,1),eased=easeFn(lo);
      const merged={};
      for(const k in to){
        const fv=parseFloat(from[k]),tv=parseFloat(to[k]);
        if(!isNaN(fv)&&!isNaN(tv)){
          const unit=(to[k]+'').replace(/[\d. -]/g,'');
          merged[k]=lerp(fv,tv,eased)+unit;
        }else merged[k]=eased>.5?to[k]:from[k];
      }
      Object.assign(elem.style,merged);
      if(t<(s||0))Object.assign(elem.style,from);
    });
    return elem;
  }
  function onFrame(fn){cbs.push(fn)}
  function start(){
    requestAnimationFrame(function tick(ts){
      if(!t0)t0=ts;
      const t=clamp((ts-t0)/dur,0,1);
      cbs.forEach(fn=>fn(t,(ts-t0)/1000));
      if(t<1||(looping&&(t0=ts)))requestAnimationFrame(tick);
    });
  }
  return{stage,el,text,rect,animate,onFrame,start,lerp,clamp,ease,
    loop:()=>{looping=true;return NV;}
  };
})();
`.trim();

// ─── HTML builders ───────────────────────────────────────────────────────────

function buildVideoHtml(sceneCode: string, fmt: Format, duration: number): string {
  const runtime = NV_RUNTIME.replace('__DUR__', String(duration));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:#0c0b14;overflow:hidden;font-family:'Inter Tight',system-ui,sans-serif}
  #stage{position:relative;width:${fmt.w}px;height:${fmt.h}px;overflow:hidden}
</style>
</head>
<body>
<div id="stage"></div>
<script>
// ── NV Animation Runtime ──
${runtime}
// ── Scene ─────────────────
${sceneCode}
</script>
</body>
</html>`;
}

function buildStaticHtml(code: string): string {
  if (/^<!DOCTYPE/i.test(code.trimStart()) || /^<html/i.test(code.trimStart())) return code;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;font-family:'Inter Tight',system-ui,sans-serif}</style></head><body>${code}</body></html>`;
}

// ─── AI helpers ──────────────────────────────────────────────────────────────

async function loadAllCreds(): Promise<Record<string, Record<string, string>>> {
  const services = await credentialStore.list().catch(() => [] as string[]);
  const out: Record<string, Record<string, string>> = {};
  for (const s of services) {
    const d = await credentialStore.get(s).catch(() => null);
    if (d) out[s] = d as Record<string, string>;
  }
  return out;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function buildVideoPrompt(fmt: Format, duration: number, desc: string, context: string): string {
  const cx = Math.round(fmt.w / 2);
  const cy = Math.round(fmt.h / 2);
  const margin = 80;
  return `You are an expert motion graphics engineer. Generate an animated video using the built-in NV runtime.

CANVAS: ${fmt.w}×${fmt.h}px  |  Duration: ${duration}s
${context ? `\nBRAND/PRODUCT CONTEXT (use this for copy, colors, and messaging):\n${context}\n` : ''}
COORDINATE REFERENCE — use EXACT pixel values (never guess):
  Center point:    (${cx}, ${cy})
  Left third:      x=${Math.round(fmt.w * 0.33)}   Center third: x=${cx}   Right third: x=${Math.round(fmt.w * 0.67)}
  Top area:        y=${Math.round(fmt.h * 0.25)}   Mid-upper: y=${Math.round(fmt.h * 0.38)}   Center: y=${cy}   Mid-lower: y=${Math.round(fmt.h * 0.62)}   Bottom: y=${Math.round(fmt.h * 0.75)}
  Safe zone:       ${margin}px from all edges
  Typical layout:  Logo/icon at y=${Math.round(fmt.h * 0.25)}, Headline at y=${Math.round(fmt.h * 0.42)}, Subtext at y=${Math.round(fmt.h * 0.53)}, CTA at y=${Math.round(fmt.h * 0.70)}

NV API (already loaded — do not redeclare):
  NV.stage                         — root container
  NV.el(tag, cssObj, parent?)      — create element at absolute position
  NV.text(text, x, y, opts)        — centered text. opts: {color,size(px),weight,font,css:{}}
  NV.rect(x, y, w, h, opts)        — rectangle. opts: {bg,r(radius px),css:{}}
  NV.animate(elem, from, to, s, e, easeFn?)  — tween. s/e are 0–1 fractions of total duration
  NV.onFrame(fn(t, secs))          — per-frame hook
  NV.ease.out / .in / .inOut / .back / .elastic / .linear
  NV.lerp(a,b,t)  NV.clamp(v,min,max)  NV.loop()
  NV.start()  ← MUST be the last line

CONCRETE EXAMPLE (for a 1080×1920 story):
  NV.stage.style.background='#0c0b14';
  const logo=NV.text('ACME',540,300,{color:'#6d4cff',size:52,weight:800});
  const title=NV.text('Headline Here',540,520,{color:'#fff',size:72,weight:700});
  NV.animate(logo,{opacity:'0',transform:'scale(0.7)'},{opacity:'1',transform:'scale(1)'},0,0.18,NV.ease.back);
  NV.animate(title,{opacity:'0',transform:'translateY(40px)'},{opacity:'1',transform:'translateY(0px)'},0.12,0.32,NV.ease.out);
  NV.start();

RULES:
1. Output ONLY valid JavaScript — no HTML, no markdown fences, no import/export
2. Set NV.stage.style.background first
3. Every element starts opacity:'0' — animate each in using NV.animate()
4. Entrance: NV.animate(e,{opacity:'0',transform:'translateY(30px)'},{opacity:'1',transform:'translateY(0px)'},0.0,0.15,NV.ease.back)
5. Exit: NV.animate(e,{opacity:'1'},{opacity:'0'},0.85,1.0,NV.ease.in)
6. All positions use EXACT coordinates from the reference above — never guess or use vague values
7. Last line MUST be exactly: NV.start();

BRAND PALETTE: PURPLE=#6d4cff  DARK=#0c0b14  PAPER=#f7f5f1  ACCENT=#a78bfa  GREEN=#22c55e

Content to animate: ${desc}`;
}

function buildScreenPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  return `You are an expert UI designer. Create a pixel-perfect ${fmt.label} UI mockup (${fmt.w}×${fmt.h}px).
${context ? `\nBrand/product context (use for copy, colors, and data):\n${context}\n` : ''}
Requirements:
- Complete, self-contained HTML document with all CSS in <style> tags
- Canvas exactly ${fmt.w}×${fmt.h}px (set on a root wrapper div with overflow:hidden)
- Import fonts via Google Fonts @import inside <style> (Sora or Inter)
- Hover states, micro-interactions, subtle CSS transitions
- Style direction: ${styleName}
- NO JavaScript unless essential for the UI interaction
- Publication-ready quality — no placeholder text like "Lorem ipsum"
- All elements must stay within the ${fmt.w}×${fmt.h}px canvas bounds

Purpose: ${desc}

Output ONLY the complete HTML document starting with <!DOCTYPE html>.`;
}

function buildBannerPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  return `You are an expert graphic designer specialising in social media visuals. Create a ${fmt.label} (${fmt.w}×${fmt.h}px) graphic.
${context ? `\nBrand/product context (use for copy and brand colors):\n${context}\n` : ''}
Requirements:
- Complete self-contained HTML with all CSS in <style> — no external dependencies except Google Fonts
- Fixed canvas: <body> and root div exactly ${fmt.w}×${fmt.h}px, overflow:hidden, no margin/padding
- All elements must be positioned within the ${fmt.w}×${fmt.h}px bounds using absolute positioning
- CSS entrance animations (opacity/transform) for a polished feel — auto-play, no JS needed
- Bold typography, strong visual hierarchy, high contrast
- Style: ${styleName}
- Every text element must be meaningful — no filler, use real product/brand copy from the context

Design intent: ${desc}

Output ONLY the complete HTML starting with <!DOCTYPE html>.`;
}

function buildComponentPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  return `You are a senior UI engineer. Build a polished, production-ready interactive UI component.
${context ? `\nProduct context (use for real copy, data, and brand colors):\n${context}\n` : ''}
Requirements:
- Complete self-contained HTML with CSS in <style> and JS in <script>
- Component centered within a ${fmt.w}×${fmt.h}px viewport
- Fully functional: all buttons work, toggles toggle, inputs accept input
- CSS custom properties for theming
- Smooth transitions and micro-animations
- Style: ${styleName}
- No Lorem ipsum — use realistic content from the context if provided

Component: ${desc}

Output ONLY the complete HTML starting with <!DOCTYPE html>.`;
}

function buildRefinePrompt(currentHtml: string, instruction: string): string {
  return `You are refining an existing HTML/JS design. Here is the current code:

\`\`\`html
${currentHtml.slice(0, 6000)}
\`\`\`

The user wants this change: "${instruction}"

Rules:
- Return the COMPLETE updated HTML document (full file, not just the diff)
- Keep everything that wasn't mentioned — only change what was asked
- Maintain the same framework/structure
- Output ONLY the complete HTML starting with <!DOCTYPE html> (or the JS scene for video files)`;
}

// ─── History ─────────────────────────────────────────────────────────────────

interface HistoryEntry {
  id: string;
  prompt: string;
  html: string;
  type: ProjectType;
  format: Format;
  at: number;
}

// ─── Prompt examples ─────────────────────────────────────────────────────────

const EXAMPLES: Record<ProjectType, string[]> = {
  video: [
    'Nivara product launch — dark bg, purple logo entrance from top, headline "India\'s AI OS" fades in, three feature lines appear one by one, purple CTA button pulses at end',
    'SaaS pricing reveal — animated card slides up, features appear with checkmarks, price number counts up, CTA glows',
    'Minimal brand opener — clean white background, company name writes itself letter by letter, tagline fades below, subtle particle effect',
  ],
  screen: [
    'Analytics dashboard — dark theme, sidebar nav, KPI cards row, line chart, recent activity table',
    'Mobile app onboarding — step 1 of 3, illustration placeholder, headline, subtext, progress dots, Next CTA',
    'SaaS landing page hero — large headline, subtext, two CTA buttons, floating device mockup',
  ],
  banner: [
    'Instagram post: "Nivara v1.0 is live 🚀" — bold purple gradient, white text, app screenshot',
    'LinkedIn post: new AI feature announcement — professional, clean layout, brand colors',
    'YouTube thumbnail: dark red/black, bold title, face placeholder circle, high-contrast text',
  ],
  component: [
    'Glassmorphism pricing card with monthly/yearly toggle, feature list, highlighted CTA button',
    'Toast notification system — success/error/warning/info variants, smooth slide-in animation',
    'Data table with sortable columns, search input, pagination, row hover effects',
  ],
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function StudioModule() {
  const { session } = useAuth();
  const callIdRef  = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type,           setType]           = useState<ProjectType>('video');
  const [format,         setFormat]         = useState<Format>(FORMATS.video[0]);
  const [duration,       setDuration]       = useState(15);
  const [style,          setStyle]          = useState(STYLES[0].id);
  const [prompt,         setPrompt]         = useState('');
  const [refine,         setRefine]         = useState('');
  const [generating,     setGenerating]     = useState(false);
  const [html,           setHtml]           = useState<string | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [history,        setHistory]        = useState<HistoryEntry[]>([]);
  const [copied,         setCopied]         = useState(false);
  const [streamLog,      setStreamLog]      = useState('');
  const [showCode,       setShowCode]       = useState(false);
  const [editedHtml,     setEditedHtml]     = useState('');
  const [connMode,       setConnMode]       = useState<string>('');
  const [contextFile,    setContextFile]    = useState<{ name: string; content: string } | null>(null);
  const [showContext,    setShowContext]     = useState(false);

  function handleTypeChange(t: ProjectType) {
    setType(t);
    setFormat(FORMATS[t][0]);
    setHtml(null);
    setError(null);
    setShowCode(false);
  }

  async function resolveMode() {
    const creds = await loadAllCreds();
    for (const [svc, p] of [['gemini', 'gemini'], ['openai', 'openai'], ['claude', 'claude']] as [string, Provider][]) {
      if (creds[svc]?.api_key) {
        setConnMode(`Own Key · ${svc.charAt(0).toUpperCase() + svc.slice(1)}`);
        return { mode: 'own_key' as const, apiKey: creds[svc].api_key, provider: p };
      }
    }
    setConnMode('Nivara AI');
    return { mode: 'nivara' as const, apiKey: null as string | null, provider: null as Provider | null };
  }

  async function streamAI(
    systemPrompt: string,
    userMessage: string,
    onChunk: (t: string) => void,
  ): Promise<string> {
    const callId = String(++callIdRef.current);
    let full = '';
    const done = { cleanup: () => {} };
    const { mode, apiKey, provider } = await resolveMode();

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
        callId, mode, systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        apiKey, provider,
        localModel: null, modelName: null, baseUrl: null,
        sessionToken: session?.access_token ?? null,
      }).catch((e: unknown) => { done.cleanup(); reject(e); });
    });
  }

  function stripFences(raw: string): string {
    const m = raw.match(/```(?:html|jsx?|tsx?|js)?\n?([\s\S]*?)```/i);
    if (m) return m[1].trim();
    return raw.trim();
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setStreamLog('Preparing…');
    setShowCode(false);

    const selectedStyle = STYLES.find((s) => s.id === style)!;
    const ctx = contextFile?.content ?? '';
    let raw = '';

    try {
      if (type === 'video') {
        const sysPrompt = buildVideoPrompt(format, duration, prompt, ctx);
        const userMsg = ctx
          ? `Brand/product context:\n${ctx}\n\nCreate this animation:\n${prompt}`
          : `Create this animation:\n${prompt}`;
        await streamAI(sysPrompt, userMsg, (chunk) => {
          raw += chunk;
          setStreamLog(raw.slice(-400));
        });
        const sceneCode = stripFences(raw);
        const finalHtml = buildVideoHtml(sceneCode, format, duration);
        setHtml(finalHtml);
        setEditedHtml(finalHtml);
        setHistory((h) => [{ id: Date.now().toString(), prompt, html: finalHtml, type, format, at: Date.now() }, ...h.slice(0, 19)]);
      } else {
        const styleDesc = `${selectedStyle.label} — ${selectedStyle.desc}`;
        const sysPrompt =
          type === 'screen'    ? buildScreenPrompt(format, prompt, styleDesc, ctx) :
          type === 'banner'    ? buildBannerPrompt(format, prompt, styleDesc, ctx) :
                                 buildComponentPrompt(format, prompt, styleDesc, ctx);
        const userMsg = ctx ? `Brand/product context:\n${ctx}\n\n${prompt}` : prompt;
        await streamAI(sysPrompt, userMsg, (chunk) => {
          raw += chunk;
          setStreamLog(raw.slice(-400));
        });
        const finalHtml = buildStaticHtml(stripFences(raw));
        setHtml(finalHtml);
        setEditedHtml(finalHtml);
        setHistory((h) => [{ id: Date.now().toString(), prompt, html: finalHtml, type, format, at: Date.now() }, ...h.slice(0, 19)]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
      setStreamLog('');
    }
  }

  async function handleRefine() {
    if (!refine.trim() || !html || generating) return;
    setGenerating(true);
    setError(null);
    setStreamLog('Refining…');

    let raw = '';
    const sysPrompt = type === 'video'
      ? buildVideoPrompt(format, duration, refine, contextFile?.content ?? '')
      : `You are a web design expert. Modify the provided HTML as instructed. Return the complete updated file.`;

    try {
      await streamAI(sysPrompt, buildRefinePrompt(html, refine), (chunk) => {
        raw += chunk;
        setStreamLog(raw.slice(-400));
      });
      const updated = type === 'video'
        ? buildVideoHtml(stripFences(raw), format, duration)
        : buildStaticHtml(stripFences(raw));
      setHtml(updated);
      setEditedHtml(updated);
      setRefine('');
      setHistory((h) => [{ id: Date.now().toString(), prompt: `↺ ${refine}`, html: updated, type, format, at: Date.now() }, ...h.slice(0, 19)]);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
      setStreamLog('');
    }
  }

  function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = (ev.target?.result as string) ?? '';
      setContextFile({ name: file.name, content: content.slice(0, 8000) });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function applyCodeEdit() {
    setHtml(editedHtml);
    setShowCode(false);
  }

  async function handleSave() {
    if (!html) return;
    const defaultName = `studio_${type}_${Date.now()}.html`;
    try {
      await invoke('studio_save_file', { defaultName, content: html });
    } catch {
      // fallback: browser download
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = defaultName; a.click();
      URL.revokeObjectURL(url);
    }
  }

  function handleCopy() {
    if (!html) return;
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const previewBg = type === 'video' ? '#0c0b14' : '#ffffff';
  const previewScale = html && format
    ? Math.min(1, 580 / format.w, 440 / format.h)
    : 1;

  const TYPE_META: Record<ProjectType, { label: string; icon: React.ReactNode }> = {
    video:     { label: 'Video / Animation', icon: <VideoIcon /> },
    screen:    { label: 'UI Screen',         icon: <ScreenIcon /> },
    banner:    { label: 'Banner / Poster',   icon: <BannerIcon /> },
    component: { label: 'Component',         icon: <ComponentIcon /> },
  };

  return (
    <div className="flex h-full overflow-hidden bg-nv-bg">

      {/* ── LEFT PANEL ───────────────────────────────────────────────────────── */}
      <div className="w-52 shrink-0 flex flex-col border-r border-nv-border overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-nv-border shrink-0">
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-accent shrink-0">
            <path d="M8 1l1.5 4.5H14l-3.7 2.7 1.4 4.3L8 10 4.3 12.5 5.7 8.2 2 5.5h4.5z" fill="currentColor"/>
          </svg>
          <span className="text-[12px] font-semibold text-nv-text">Studio</span>
          {connMode && (
            <span className="ml-auto text-[8px] font-mono text-nv-faint truncate">{connMode}</span>
          )}
        </div>

        <div className="p-2.5 space-y-4 flex-1">
          {/* Project type */}
          <section>
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">Type</p>
            {(['video', 'screen', 'banner', 'component'] as ProjectType[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg mb-0.5 text-left transition-fast ${
                  type === t ? 'bg-accent/15 text-accent' : 'text-nv-muted hover:bg-nv-surface2 hover:text-nv-text'
                }`}
              >
                <span className="w-4 h-4 shrink-0">{TYPE_META[t].icon}</span>
                <span className="text-[11px] font-medium">{TYPE_META[t].label}</span>
              </button>
            ))}
          </section>

          {/* Format */}
          <section>
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">Format</p>
            {FORMATS[type].map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg mb-0.5 transition-fast ${
                  format.id === f.id ? 'bg-accent/10 text-accent' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2'
                }`}
              >
                <span className="text-[11px]">{f.label}</span>
                <span className="text-[9px] font-mono opacity-50">{f.w}×{f.h}</span>
              </button>
            ))}
          </section>

          {/* Duration (video only) */}
          {type === 'video' && (
            <section>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">Duration</p>
              <div className="flex flex-wrap gap-1">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-fast ${
                      duration === d ? 'border-accent/50 bg-accent/10 text-accent' : 'border-nv-border text-nv-faint hover:border-nv-muted'
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Style (non-video) */}
          {type !== 'video' && (
            <section>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">Style</p>
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg mb-0.5 text-left transition-fast ${
                    style === s.id ? 'bg-accent/10 text-accent' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2'
                  }`}
                >
                  {style === s.id && <span className="text-[9px]">✓</span>}
                  <span className="text-[11px]">{s.label}</span>
                </button>
              ))}
            </section>
          )}

          {/* History */}
          {history.length > 0 && (
            <section>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">History</p>
              {history.slice(0, 8).map((h) => (
                <button
                  key={h.id}
                  onClick={() => { setHtml(h.html); setEditedHtml(h.html); setShowCode(false); }}
                  className="w-full text-left px-2 py-1.5 rounded-lg mb-0.5 hover:bg-nv-surface2 transition-fast"
                >
                  <p className="text-[10px] text-nv-muted truncate">{h.prompt}</p>
                  <p className="text-[9px] text-nv-faint font-mono">{h.type} · {h.format.label}</p>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* ── CENTER PANEL ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 h-9 border-b border-nv-border shrink-0 bg-nv-surface/50">
          <span className="text-[10px] text-nv-faint font-mono flex-1">
            {format.label} · {format.w}×{format.h}
            {type === 'video' && ` · ${duration}s`}
          </span>
          {html && !generating && (
            <>
              <button
                onClick={() => setShowCode((v) => !v)}
                className={`text-[10px] font-mono px-2 py-1 rounded border transition-fast ${
                  showCode ? 'bg-accent/10 text-accent border-accent/30' : 'text-nv-faint border-nv-border hover:text-nv-text hover:border-nv-muted'
                }`}
              >
                {showCode ? 'Preview' : '&lt;/&gt; Code'}
              </button>
              <button
                onClick={handleCopy}
                className="text-[10px] text-nv-faint hover:text-nv-text font-mono px-2 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 text-[10px] text-white bg-accent font-mono px-2.5 py-1 rounded hover:bg-accent-dim transition-fast"
              >
                <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                  <path d="M5 1v6M2 5l3 2 3-2M1 9h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Save
              </button>
            </>
          )}
        </div>

        {/* Preview / Code area */}
        <div
          className="flex-1 overflow-hidden flex items-center justify-center relative"
          style={{ background: generating || !html ? '#0c0b14' : (showCode ? 'var(--nv-surface)' : previewBg) }}
        >
          {/* Generating overlay */}
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[#080808]">
              <div className="w-8 h-8 rounded-full border-2 border-nv-border border-t-accent animate-spin" />
              <p className="text-[11px] text-nv-faint font-mono">Generating {type}…</p>
              {streamLog && (
                <pre className="text-[9px] text-nv-faint/40 font-mono max-w-sm text-center overflow-hidden line-clamp-3">
                  {streamLog}
                </pre>
              )}
            </div>
          )}

          {/* Empty state */}
          {!generating && !html && !error && (
            <div className="flex flex-col items-center gap-3 text-white/10 pointer-events-none select-none">
              <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16">
                <rect x="8" y="8" width="48" height="48" rx="8" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 40l14-14 10 10 10-10 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="22" cy="22" r="5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <p className="text-[13px] font-medium">Describe → Generate</p>
            </div>
          )}

          {/* Error */}
          {error && !generating && (
            <div className="max-w-sm mx-auto p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-center">
              <p className="text-[12px] text-red-400 font-mono mb-1">Generation failed</p>
              <p className="text-[11px] text-nv-faint leading-relaxed">{error}</p>
              <p className="text-[10px] text-nv-faint/60 mt-2 font-mono">Connect a key in Connect Apps → Gemini/OpenAI/Claude</p>
            </div>
          )}

          {/* Code view */}
          {html && showCode && !generating && (
            <div className="absolute inset-0 flex flex-col overflow-hidden">
              <textarea
                value={editedHtml}
                onChange={(e) => setEditedHtml(e.target.value)}
                className="flex-1 w-full bg-nv-surface text-[11px] text-nv-text font-mono p-4 resize-none outline-none leading-relaxed"
                spellCheck={false}
              />
              <div className="flex items-center gap-2 px-3 py-2 border-t border-nv-border bg-nv-surface shrink-0">
                <p className="text-[10px] text-nv-faint font-mono flex-1">Edit the code above, then click Apply to update the preview</p>
                <button
                  onClick={applyCodeEdit}
                  className="text-[11px] text-white bg-accent px-3 py-1 rounded-lg hover:bg-accent-dim transition-fast font-mono"
                >
                  Apply
                </button>
              </div>
            </div>
          )}

          {/* Live preview */}
          {html && !showCode && !generating && (
            <div
              className="shadow-2xl overflow-hidden rounded"
              style={{
                width: format.w * previewScale,
                height: format.h * previewScale,
                outline: type !== 'video' ? '1px solid rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <iframe
                key={html.slice(0, 40)}
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin"
                scrolling={type === 'screen' || type === 'component' ? 'auto' : 'no'}
                style={{
                  width: format.w,
                  height: format.h,
                  border: 'none',
                  transform: `scale(${previewScale})`,
                  transformOrigin: 'top left',
                }}
                title="Studio preview"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-l border-nv-border">
        {/* Prompt section */}
        <div className="px-3 py-2.5 border-b border-nv-border shrink-0">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-[11px] font-semibold text-nv-text">Prompt</p>
            {/* File attach */}
            <div className="flex items-center gap-1.5">
              {contextFile ? (
                <div className="flex items-center gap-1 bg-accent/10 border border-accent/25 rounded px-1.5 py-0.5">
                  <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5 text-accent shrink-0">
                    <path d="M2 1h4.5L9 3.5V9H2V1z" stroke="currentColor" strokeWidth="1.1"/>
                  </svg>
                  <span className="text-[9px] text-accent font-mono truncate max-w-[70px]">{contextFile.name}</span>
                  <button
                    onClick={() => setContextFile(null)}
                    className="text-[10px] text-accent/60 hover:text-accent leading-none ml-0.5"
                  >×</button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-[9px] text-nv-faint hover:text-accent font-mono transition-fast px-1.5 py-0.5 rounded border border-nv-border hover:border-accent/30"
                  title="Attach a .md, .txt, or .json context file"
                >
                  <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                    <path d="M5 1v6M2 5l3 2 3-2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 9h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                  Attach
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.csv"
                className="hidden"
                onChange={handleFileAttach}
              />
            </div>
          </div>
          <p className="text-[9px] text-nv-faint font-mono">
            {contextFile ? `Using "${contextFile.name}" as context` : 'Describe what to create · attach a brand/product file'}
          </p>
          {/* Context preview toggle */}
          {contextFile && (
            <button
              onClick={() => setShowContext(v => !v)}
              className="text-[9px] text-nv-faint hover:text-accent font-mono mt-1 transition-fast"
            >
              {showContext ? 'Hide context ▲' : 'Preview context ▼'}
            </button>
          )}
          {contextFile && showContext && (
            <pre className="mt-1.5 text-[9px] text-nv-faint font-mono bg-nv-bg border border-nv-border rounded p-2 max-h-24 overflow-y-auto whitespace-pre-wrap">
              {contextFile.content.slice(0, 600)}{contextFile.content.length > 600 ? '…' : ''}
            </pre>
          )}
        </div>

        {/* Examples */}
        <div className="flex-1 overflow-y-auto p-2.5">
          <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2 px-1">Examples</p>
          {EXAMPLES[type].map((ex, i) => (
            <button
              key={i}
              onClick={() => setPrompt(ex)}
              className="w-full text-left px-2.5 py-2 rounded-lg mb-1.5 border border-nv-border/60 hover:border-accent/30 hover:bg-accent/5 transition-fast"
            >
              <p className="text-[10px] text-nv-muted leading-relaxed">{ex}</p>
            </button>
          ))}
        </div>

        {/* Input + Actions */}
        <div className="p-2.5 border-t border-nv-border shrink-0 space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
            placeholder={
              type === 'video'     ? 'Product launch video — dark bg, purple logo entrance, headline reveals…' :
              type === 'screen'    ? 'Analytics dashboard, dark theme, sidebar + KPI cards…' :
              type === 'banner'    ? 'Instagram post announcing product launch — bold headline…' :
                                     'Glassmorphism pricing card with toggle…'
            }
            rows={5}
            className="w-full bg-nv-surface border border-nv-border rounded-xl px-3 py-2.5 text-[12px] text-nv-text placeholder-nv-faint/60 outline-none focus:border-accent transition-fast resize-none leading-relaxed"
          />

          <button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <><span className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white animate-spin" />Generating…</>
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

          {/* Refine row */}
          {html && !generating && (
            <div className="flex gap-1.5">
              <input
                value={refine}
                onChange={(e) => setRefine(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRefine(); }}
                placeholder="Refine: make CTA bigger…"
                className="flex-1 bg-nv-surface border border-nv-border rounded-lg px-2.5 py-1.5 text-[11px] text-nv-text placeholder-nv-faint/60 outline-none focus:border-accent transition-fast"
              />
              <button
                onClick={handleRefine}
                disabled={!refine.trim() || generating}
                className="shrink-0 px-2.5 py-1.5 bg-nv-surface2 border border-nv-border text-nv-muted hover:text-nv-text hover:border-nv-muted text-[10px] font-mono rounded-lg transition-fast disabled:opacity-40"
              >
                ↺
              </button>
            </div>
          )}

          {html && !generating && (
            <button
              onClick={() => { setHtml(null); setEditedHtml(''); setShowCode(false); setError(null); }}
              className="w-full text-[11px] text-nv-faint hover:text-nv-muted font-mono py-1.5 rounded-xl border border-nv-border hover:border-nv-muted transition-fast"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function VideoIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <rect x="1" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M11 5.5l4-2v9l-4-2V5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  );
}
function ScreenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 14h6M8 12v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
function BannerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="5" cy="8" r="1.5" fill="currentColor" opacity=".5"/>
      <path d="M8 7h5M8 9h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}
function ComponentIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
      <path d="M8 2L14 5.5v5L8 14 2 10.5v-5L8 2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity=".4"/>
    </svg>
  );
}
