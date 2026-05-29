import { useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../../contexts/AuthContext';
import { credentialStore } from '../../lib/krewDb';
import type { Provider } from '../../lib/ai';

// ─── Formats & Styles ──────────────────────────────────────────────────────────

interface Format {
  id: string;
  label: string;
  platform: string;
  w: number;
  h: number;
  icon: React.ReactNode;
  previewW: number;
  previewH: number;
}

const FORMATS: Format[] = [
  {
    id: 'instagram_post',
    label: 'Instagram Post',
    platform: 'Instagram',
    w: 1080, h: 1080,
    previewW: 200, previewH: 200,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.6"/>
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6"/>
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'instagram_story',
    label: 'Instagram Story',
    platform: 'Instagram',
    w: 1080, h: 1920,
    previewW: 110, previewH: 195,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.6"/>
        <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.6"/>
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    id: 'facebook_post',
    label: 'Facebook Post',
    platform: 'Facebook',
    w: 1200, h: 630,
    previewW: 220, previewH: 115,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'linkedin_post',
    label: 'LinkedIn Post',
    platform: 'LinkedIn',
    w: 1200, h: 628,
    previewW: 220, previewH: 115,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="2" y="9" width="4" height="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.6"/>
      </svg>
    ),
  },
  {
    id: 'youtube_thumbnail',
    label: 'YouTube Thumbnail',
    platform: 'YouTube',
    w: 1280, h: 720,
    previewW: 220, previewH: 124,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58a2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" stroke="currentColor" strokeWidth="1.6"/>
        <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'twitter_header',
    label: 'X / Twitter Header',
    platform: 'X / Twitter',
    w: 1500, h: 500,
    previewW: 240, previewH: 80,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4">
        <path d="M4 4l16 16M20 4L4 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    ),
  },
];

const STYLES = [
  { id: 'minimal',   label: 'Minimal',   desc: 'Clean white/light, lots of space, sharp typography' },
  { id: 'bold',      label: 'Bold',      desc: 'High contrast, strong colors, dominant text' },
  { id: 'dark',      label: 'Dark',      desc: 'Deep dark background, glowing accents' },
  { id: 'vibrant',   label: 'Vibrant',   desc: 'Colorful gradients, energetic, social-first' },
  { id: 'corporate', label: 'Corporate', desc: 'Professional blues, serif accents, trustworthy' },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CreatorScreen() {
  const { session } = useAuth();
  const callIdRef = useRef(0);

  const [format,      setFormat]      = useState<Format>(FORMATS[0]);
  const [style,       setStyle]       = useState(STYLES[0].id);
  const [description, setDescription] = useState('');
  const [generating,  setGenerating]  = useState(false);
  const [html,        setHtml]        = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  async function streamAI(
    systemPrompt: string,
    messages: { role: string; content: string }[],
    onChunk: (t: string) => void,
  ): Promise<string> {
    const callId = String(++callIdRef.current);
    let fullText = '';
    const done = { cleanup: () => {} };

    const services = await credentialStore.list().catch(() => [] as string[]);
    const creds: Record<string, Record<string, string>> = {};
    for (const s of services) {
      const d = await credentialStore.get(s).catch(() => null);
      if (d) creds[s] = d as Record<string, string>;
    }

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
        apiKey, provider,
        localModel: null, modelName: null, baseUrl: null,
        sessionToken: session?.access_token ?? null,
      }).catch((e: unknown) => { done.cleanup(); reject(e); });
    });
  }

  function extractHtml(raw: string): string {
    const m = raw.match(/```html\s*([\s\S]*?)```/i) ?? raw.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i);
    if (m) return m[1].trim();
    const docStart = raw.indexOf('<!DOCTYPE');
    if (docStart !== -1) return raw.slice(docStart).trim();
    return raw.trim();
  }

  async function handleGenerate() {
    if (!description.trim()) return;
    setGenerating(true);
    setHtml(null);
    setError(null);

    const selectedStyle = STYLES.find((s) => s.id === style)!;

    const systemPrompt = `You are an expert web designer who creates stunning social media graphics as self-contained HTML documents.

You produce ONLY valid, complete HTML — no explanation, no markdown, no commentary outside the HTML document itself.
The HTML must start with <!DOCTYPE html> and be a complete, self-contained document with all CSS embedded in a <style> tag.
Use Google Fonts via @import in the style tag for premium typography if appropriate.
No JavaScript, no external CSS files, no images that require a URL (use CSS gradients, shapes, and text only, or inline SVG).

Design guidelines:
- The canvas must be exactly ${format.w}×${format.h}px (set on the body/main element)
- Center all content using CSS flexbox
- Make it visually polished enough to publish directly
- Match the style: ${selectedStyle.label} — ${selectedStyle.desc}
- Platform: ${format.platform} (${format.label})

Output ONLY the HTML document. Nothing else.`;

    const userMsg = `Create a ${format.label} (${format.w}×${format.h}px) in ${selectedStyle.label} style.

Content/theme: ${description}`;

    try {
      let raw = '';
      await streamAI(systemPrompt, [{ role: 'user', content: userMsg }], (chunk) => {
        raw += chunk;
      });
      setHtml(extractHtml(raw));
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }

  function handleCopyHtml() {
    if (!html) return;
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload() {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${format.id}_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const previewScale = Math.min(
    (format.previewW * 2) / format.w,
    (format.previewH * 2) / format.h,
    0.25,
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-nv-border shrink-0">
        <div>
          <h2 className="text-[13px] font-semibold text-nv-text">Creator Studio</h2>
          <p className="text-[10px] text-nv-faint font-mono">AI-designed social media graphics</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: controls */}
        <div className="w-72 shrink-0 flex flex-col border-r border-nv-border overflow-y-auto">
          <div className="p-4 space-y-5">

            {/* Format picker */}
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">Format</p>
              <div className="grid grid-cols-1 gap-1.5">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-fast ${
                      format.id === f.id
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-nv-border text-nv-muted hover:border-nv-muted hover:text-nv-text'
                    }`}
                  >
                    <span className="shrink-0">{f.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{f.label}</p>
                      <p className="text-[9px] font-mono opacity-60">{f.w}×{f.h}</p>
                    </div>
                    {format.id === f.id && (
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Style picker */}
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">Style</p>
              <div className="grid grid-cols-1 gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-fast ${
                      style === s.id
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-nv-border text-nv-muted hover:border-nv-muted hover:text-nv-text'
                    }`}
                  >
                    <div className="flex-1">
                      <p className="text-[11px] font-medium">{s.label}</p>
                      <p className="text-[9px] opacity-60 leading-tight mt-0.5">{s.desc}</p>
                    </div>
                    {style === s.id && (
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2">Content description</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={`Describe your design…\n\ne.g. "Launch announcement for our new SaaS product with a bold headline and CTA button"`}
                rows={5}
                className="w-full bg-nv-surface border border-nv-border rounded-xl px-3 py-2.5 text-[12px] text-nv-text placeholder-nv-faint outline-none focus:border-accent transition-fast resize-none leading-relaxed"
              />
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={generating || !description.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? (
                <>
                  <span className="w-3 h-3 rounded-full border border-white/40 border-t-white animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                    <path d="M8 1l1.5 4.5H14l-3.7 2.7 1.4 4.3L8 10 4.3 12.5 5.7 8.2 2 5.5h4.5z" fill="currentColor"/>
                  </svg>
                  Generate
                </>
              )}
            </button>

          </div>
        </div>

        {/* Right: preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Preview toolbar */}
          {html && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-nv-border shrink-0">
              <span className="text-[10px] text-nv-faint font-mono flex-1">
                {format.label} · {format.w}×{format.h}px
              </span>
              <button
                onClick={handleCopyHtml}
                className="flex items-center gap-1.5 text-[11px] text-nv-faint hover:text-nv-text font-mono px-2.5 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
              >
                {copied ? '✓ Copied' : 'Copy HTML'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 text-[11px] text-accent font-mono px-2.5 py-1 rounded border border-accent/30 hover:bg-accent/10 transition-fast"
              >
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M6 1v7M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M1 10h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                Download
              </button>
            </div>
          )}

          {/* Preview area */}
          <div className="flex-1 overflow-auto flex items-center justify-center bg-nv-bg p-6">
            {generating && (
              <div className="flex flex-col items-center gap-3 text-nv-faint">
                <div className="w-8 h-8 rounded-full border-2 border-nv-border border-t-accent animate-spin" />
                <p className="text-[11px] font-mono">Designing your {format.label}…</p>
              </div>
            )}

            {!generating && !html && !error && (
              <div className="flex flex-col items-center gap-3 text-nv-faint max-w-xs text-center">
                <svg viewBox="0 0 48 48" fill="none" className="w-12 h-12 opacity-20">
                  <rect x="4" y="4" width="40" height="40" rx="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="M4 32l10-10 8 8 8-8 14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="2"/>
                </svg>
                <p className="text-[12px]">
                  Choose a format, pick a style, describe your design, then hit Generate.
                </p>
              </div>
            )}

            {error && (
              <div className="max-w-sm bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                <p className="text-[12px] text-red-400 font-mono mb-1">Generation failed</p>
                <p className="text-[11px] text-nv-faint">{error}</p>
                <p className="text-[11px] text-nv-faint mt-2">
                  Make sure you have a valid plan or connect an API key in Connect Apps.
                </p>
              </div>
            )}

            {html && !generating && (
              <div
                className="rounded-xl overflow-hidden shadow-2xl"
                style={{
                  width: format.w * previewScale,
                  height: format.h * previewScale,
                  transform: `scale(1)`,
                  transformOrigin: 'center center',
                }}
              >
                <iframe
                  srcDoc={html}
                  sandbox="allow-scripts allow-same-origin"
                  scrolling="no"
                  style={{
                    width:  format.w,
                    height: format.h,
                    border: 'none',
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top left',
                    pointerEvents: 'none',
                  }}
                  title="Design preview"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
