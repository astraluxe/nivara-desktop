// ─── Deck (presentation) spec + renderers ───────────────────────────────────
// One structured DeckSpec → two renderers:
//   • renderDeckHtml()  → self-contained keyboard-navigable HTML deck (shown in chat,
//                          present fullscreen, export to PDF via the browser print dialog)
//   • deckToPptxBlob()  → real editable .pptx (opens in PowerPoint / Google Slides / Keynote)
//
// The deck_maker agent (Krew) emits a DeckSpec as JSON. In Advanced mode each slide's
// imagePrompt is turned into a real image (Gemini "Nano Banana") and stored as a data URI.

export interface DeckSlide {
  layout: 'title' | 'section' | 'bullets' | 'quote' | 'stat' | 'two-column' | 'image-full' | 'closing' | 'chart'
        | 'agenda' | 'comparison' | 'cards' | 'process' | 'timeline' | 'pricing' | 'team' | 'logos';
  title?:       string;
  subtitle?:    string;
  bullets?:     string[];
  body?:        string;
  quote?:       string;
  attribution?: string;
  stat?:        string;   // big number, e.g. "94%"
  statLabel?:   string;
  columns?:     { heading: string; bullets: string[] }[];
  chartData?:   { label: string; value: number }[];   // 'chart' layout: a few labelled numbers → bar chart
  chartUnit?:   string;   // optional unit shown on bars/axis, e.g. "₹", "%", "hrs"
  cards?:       { heading: string; body?: string }[]; // 'cards'/'process' grid; 'process' auto-numbers
  timeline?:    { label: string; text?: string }[];   // 'timeline' milestones
  plans?:       { name: string; price?: string; bullets?: string[]; highlight?: boolean }[]; // 'pricing'
  people?:      { name: string; role?: string }[];    // 'team' grid
  logos?:       string[];                              // 'logos' wall — client/partner names
  imagePrompt?: string;   // Advanced mode: prompt for the AI image
  imageData?:   string;   // filled after generation — a data: URI (or full remote URL)
  notes?:       string;   // speaker notes (exported to pptx notes)
}

export interface DeckPalette { bg: string; surface: string; text: string; muted: string; accent: string }
export interface DeckFont    { heading: string; body: string }

export interface DeckSpec {
  title:     string;
  subtitle?: string;
  preset:    string;                 // one of the design presets (informational)
  template?: string;                 // visual treatment: aurora | gradient | editorial | flat | mono
  palette:   DeckPalette;
  font:      DeckFont;
  slides:    DeckSlide[];
  logo?:     string;                 // optional brand logo (data: URI) shown in a corner on every slide
}

// Fallback palettes per preset, used if the agent omits or under-specifies colours.
const PRESET_PALETTES: Record<string, DeckPalette> = {
  minimal:   { bg: '#ffffff', surface: '#f5f5f5', text: '#0a0a0a', muted: '#6b6b6b', accent: '#0a0a0a' },
  bold:      { bg: '#0a0a0a', surface: '#141414', text: '#ffffff', muted: '#9a9a9a', accent: '#ff4d2e' },
  dark:      { bg: '#0a0a0a', surface: '#141414', text: '#f0f0f0', muted: '#8a8a8a', accent: '#4f8cff' },
  vibrant:   { bg: '#0d0b1f', surface: '#171334', text: '#ffffff', muted: '#b7b0d8', accent: '#ff5ca8' },
  corporate: { bg: '#ffffff', surface: '#f1f5f9', text: '#0f172a', muted: '#64748b', accent: '#2563eb' },
  editorial: { bg: '#fafafa', surface: '#ffffff', text: '#111111', muted: '#666666', accent: '#e11d48' },
  saas:      { bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#6d5cff' },
  neon:      { bg: '#050505', surface: '#0e0e12', text: '#f5f5f5', muted: '#8a8a94', accent: '#39ff14' },
  // extra palettes for topic variety
  sunset:    { bg: '#1a0f12', surface: '#241419', text: '#fff5f0', muted: '#c9a8a0', accent: '#ff7a45' },
  ocean:     { bg: '#071a24', surface: '#0c2734', text: '#eaf6fb', muted: '#8fb3c2', accent: '#22d3ee' },
  forest:    { bg: '#0a1710', surface: '#112418', text: '#eef7ef', muted: '#9db8a4', accent: '#34d399' },
  royal:     { bg: '#12091f', surface: '#1c1030', text: '#f4efff', muted: '#b0a4c8', accent: '#a855f7' },
  slate:     { bg: '#0f172a', surface: '#1e293b', text: '#f1f5f9', muted: '#94a3b8', accent: '#38bdf8' },
  paper:     { bg: '#faf7f2', surface: '#ffffff', text: '#1a1a1a', muted: '#6b6b6b', accent: '#c2410c' },
  mint:      { bg: '#f0fdfa', surface: '#ffffff', text: '#0f2e2a', muted: '#5b8a83', accent: '#0d9488' },
};

const PRESET_FONTS: Record<string, DeckFont> = {
  minimal:   { heading: 'DM Sans', body: 'DM Sans' },
  bold:      { heading: 'Syne', body: 'Inter' },
  dark:      { heading: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
  vibrant:   { heading: 'Syne', body: 'Plus Jakarta Sans' },
  corporate: { heading: 'Manrope', body: 'Manrope' },
  editorial: { heading: 'Playfair Display', body: 'Inter' },
  saas:      { heading: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans' },
  neon:      { heading: 'Syne', body: 'Inter' },
  sunset:    { heading: 'Sora', body: 'Inter' },
  ocean:     { heading: 'Space Grotesk', body: 'Inter' },
  forest:    { heading: 'Sora', body: 'Inter' },
  royal:     { heading: 'Fraunces', body: 'Inter' },
  slate:     { heading: 'Space Grotesk', body: 'Inter' },
  paper:     { heading: 'Fraunces', body: 'Inter' },
  mint:      { heading: 'Sora', body: 'Inter' },
};

// The 5 visual TEMPLATES — these change the actual LOOK (backgrounds, decoration,
// typography feel), not just colours, so decks don't all look the same. Each maps to a
// default when the agent doesn't request one; the agent may set spec.template directly.
const TEMPLATES = new Set(['aurora', 'gradient', 'editorial', 'flat', 'mono', 'glass', 'grid', 'wave', 'split', 'spotlight']);
const PRESET_TEMPLATE: Record<string, string> = {
  minimal: 'mono',  bold: 'split',  dark: 'aurora',  vibrant: 'wave',
  corporate: 'grid', editorial: 'editorial', saas: 'glass', neon: 'spotlight',
  sunset: 'wave', ocean: 'glass', forest: 'grid', royal: 'spotlight',
  slate: 'editorial', paper: 'editorial', mint: 'mono',
};

// Per-template decorative CSS. Injected AFTER the base rules so it overrides the default
// aurora glow. Only the DECORATION/typography varies — the layout grid stays identical.
function templateCss(template: string, p: DeckPalette): string {
  const A = p.accent, M = p.muted;
  switch (template) {
    case 'gradient':
      return `
      .slide::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
        background:linear-gradient(135deg, ${A}1f 0%, transparent 42%, transparent 60%, ${A}12 100%); }
      .slide::after { content:''; position:absolute; top:-160px; right:-120px; width:560px; height:560px; border-radius:50%;
        background:radial-gradient(circle, ${A}30 0%, transparent 70%); filter:blur(6px); z-index:0; pointer-events:none; }
      .kicker::before { width:26px; }`;
    case 'editorial':
      return `
      .slide::before { content:''; position:absolute; top:56px; left:104px; right:104px; height:1px; background:${A}; opacity:.32; z-index:1; }
      .slide::after  { content:''; position:absolute; bottom:70px; left:104px; right:104px; height:1px; background:${M}; opacity:.22; z-index:0; }
      .kicker { letter-spacing:.26em; }
      h1, h2 { letter-spacing:-.01em; }
      .rule { height:2px; width:44px; }`;
    case 'flat':
      return `
      .slide::before { content:''; position:absolute; top:0; left:0; bottom:0; width:16px; background:${A}; z-index:2; }
      .slide::after  { content:none; }
      .kicker::before { background:${A}; height:3px; }
      .rule { height:6px; }`;
    case 'mono':
      return `
      .slide::before { content:none; }
      .slide::after  { content:''; position:absolute; top:92px; left:104px; width:46px; height:6px; background:${A}; z-index:1; }
      .kicker { color:${M}; }
      .kicker::before { background:${M}; }`;
    case 'glass':
      // Frosted, soft-focus SaaS look — big blurred colour clouds + translucent panels.
      return `
      .slide::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
        background: radial-gradient(1100px 620px at 15% -12%, ${A}2b, transparent 60%),
                    radial-gradient(900px 520px at 115% 118%, ${A}1f, transparent 60%); }
      .slide::after { content:''; position:absolute; top:-120px; right:-90px; width:380px; height:380px; border-radius:50%;
        background:radial-gradient(circle, ${A}26, transparent 70%); filter:blur(14px); z-index:0; pointer-events:none; }
      .col, .imgwrap { -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); border:1px solid ${A}33; }`;
    case 'grid':
      // Technical / blueprint — a faint accent grid with one soft glow.
      return `
      .slide::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.6;
        background-image: linear-gradient(${A}12 1px, transparent 1px), linear-gradient(90deg, ${A}12 1px, transparent 1px);
        background-size: 46px 46px; }
      .slide::after { content:''; position:absolute; top:-130px; right:-110px; width:420px; height:420px; border-radius:50%;
        background:radial-gradient(circle, ${A}22, transparent 70%); z-index:0; pointer-events:none; }
      .rule { height:3px; }`;
    case 'wave':
      // Flowing, friendly — a colour sweep rising from the bottom-left corner.
      return `
      .slide::before { content:''; position:absolute; left:0; right:0; bottom:0; height:46%; z-index:0; pointer-events:none;
        background: radial-gradient(150% 120% at 0% 100%, ${A}2e, transparent 62%); clip-path: ellipse(140% 100% at 0% 100%); }
      .slide::after { content:''; position:absolute; top:-110px; right:-90px; width:340px; height:340px; border-radius:50%;
        background:radial-gradient(circle, ${A}1e, transparent 70%); z-index:0; pointer-events:none; }`;
    case 'split':
      // Bold, high-impact — a large diagonal accent block on the right.
      return `
      .slide::before { content:''; position:absolute; top:0; right:0; bottom:0; width:42%; z-index:0; pointer-events:none;
        background:${A}; opacity:.13; clip-path: polygon(30% 0, 100% 0, 100% 100%, 0% 100%); }
      .slide::after { content:''; position:absolute; top:0; bottom:0; left:0; width:8px; background:${A}; z-index:2; }
      .kicker::before { background:${A}; height:3px; }`;
    case 'spotlight':
      // Dramatic — a single beam of accent light from the top centre.
      return `
      .slide::before { content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
        background: radial-gradient(820px 520px at 50% -14%, ${A}30, transparent 60%); }
      .slide::after { content:''; position:absolute; bottom:-160px; left:50%; transform:translateX(-50%); width:620px; height:360px; border-radius:50%;
        background:radial-gradient(circle, ${A}16, transparent 70%); z-index:0; pointer-events:none; }`;
    case 'aurora':
    default:
      return ''; // base CSS already IS aurora
  }
}

// Fill defaults + drop invalid slides. Returns null if nothing usable.
function normalizeSpec(spec: any): DeckSpec | null {
  if (!spec || !Array.isArray(spec.slides)) return null;
  spec.slides = spec.slides.filter((s: any) => s && typeof s === 'object' && typeof s.layout === 'string');
  if (spec.slides.length === 0) return null;
  const preset = String(spec.preset || 'dark').toLowerCase();
  spec.preset  = preset;
  spec.palette = { ...(PRESET_PALETTES[preset] ?? PRESET_PALETTES.dark), ...(spec.palette || {}) };
  spec.font    = { ...(PRESET_FONTS[preset] ?? PRESET_FONTS.dark), ...(spec.font || {}) };
  // Visual template: honour the agent's choice if valid, else derive one from the preset so
  // different topics/palettes get genuinely different-looking decks.
  const reqTpl = String(spec.template || '').toLowerCase();
  spec.template = TEMPLATES.has(reqTpl) ? reqTpl : (PRESET_TEMPLATE[preset] ?? 'aurora');
  spec.title   = spec.title || spec.slides[0]?.title || 'Presentation';
  return spec as DeckSpec;
}

// Return the first balanced {…} or […] substring starting at `from` (string-aware).
// Returns null if it never closes (i.e. the text was truncated).
function balancedSpan(text: string, from: number): string | null {
  const open = text[from], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return text.slice(from, i + 1); }
  }
  return null;
}

function tryParseSlide(chunk: string): any | null {
  try { const o = JSON.parse(chunk); if (o && o.layout) return o; } catch { /* try balanced prefix */ }
  const span = balancedSpan(chunk, chunk.indexOf('{'));
  if (span) { try { const o = JSON.parse(span); if (o && o.layout) return o; } catch { /* give up on this one */ } }
  return null;
}

// Last-resort recovery: every slide object starts with "layout", so anchor on those
// boundaries and parse each slide independently. A corrupted/truncated slide is dropped
// without swallowing the ones around it, so a partially-mangled stream still yields a deck.
function salvageDeckSpec(text: string): DeckSpec | null {
  const head: any = {};
  const grab = (k: string) => { const m = text.match(new RegExp('"' + k + '"\\s*:\\s*"([^"\\\\]{0,120})"')); if (m) head[k] = m[1]; };
  grab('title'); grab('subtitle'); grab('preset');
  const anchors: number[] = [];
  const re = /\{\s*"layout"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) anchors.push(m.index);
  if (anchors.length === 0) return null;
  const slides: any[] = [];
  for (let k = 0; k < anchors.length; k++) {
    const to = k + 1 < anchors.length ? anchors[k + 1] : text.length;
    let chunk = text.slice(anchors[k], to);
    const lastBrace = chunk.lastIndexOf('}');
    if (lastBrace >= 0) chunk = chunk.slice(0, lastBrace + 1); // trim trailing comma/junk
    const parsed = tryParseSlide(chunk);
    if (parsed) slides.push(parsed);
  }
  return slides.length ? normalizeSpec({ ...head, slides }) : null;
}

// Extract a DeckSpec from raw agent output. Tolerant of ```json fences and stray prose,
// and — if the JSON is corrupted/truncated — salvages whatever complete slides survived.
export function parseDeckSpec(raw: string): DeckSpec | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  const span = balancedSpan(text, start);
  if (span) {
    try { const spec = normalizeSpec(JSON.parse(span)); if (spec) return spec; } catch { /* fall through to salvage */ }
  }
  return salvageDeckSpec(text);
}

// Slides that carry an imagePrompt (Advanced mode work list).
export function slidesNeedingImages(spec: DeckSpec): number[] {
  return spec.slides.map((s, i) => (s.imagePrompt && !s.imageData ? i : -1)).filter((i) => i >= 0);
}

const esc = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fontParam(f: string) { return f.replace(/ /g, '+'); }

// ── HTML deck ────────────────────────────────────────────────────────────────
// 16:9 slides scaled to fit the viewport. Arrow keys / space to navigate, F to
// present fullscreen, P to print (→ Save as PDF). Fully self-contained.
export function renderDeckHtml(spec: DeckSpec, editable = false, editId = ''): string {
  const p = spec.palette, H = spec.font.heading, B = spec.font.body;
  const families = Array.from(new Set([H, B]));
  const fontLink = `https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${fontParam(f)}:wght@400;500;600;700;800`)
    .join('&')}&display=swap`;

  const total = spec.slides.length;
  // A brand logo (the user's own, given in chat) is drawn in the top corner of every slide.
  // Injected right after each slide's opening <section …> tag so it sits above the layout,
  // regardless of which of the 8 layouts rendered the slide.
  const logoTag = spec.logo ? `<img class="nv-logo" src="${spec.logo}" alt=""/>` : '';
  const slidesHtml = spec.slides.map((s, i) => {
    const html = renderSlideHtml(s, spec, i, total, editable);
    return logoTag ? html.replace(/(<section\b[^>]*>)/, `$1${logoTag}`) : html;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(spec.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${fontLink}" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; background:#0a0a0a; font-family:'${B}',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  #stage { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#0a0a0a; }
  .slide {
    position:absolute; width:1280px; height:720px; display:none;
    flex-direction:column; justify-content:center; background:${p.bg}; color:${p.text};
    padding:96px 104px; overflow:hidden;
  }
  .slide.active { display:flex; }
  /* Long words / URLs wrap instead of shooting off the edge; content sits ABOVE the decorations. */
  h1,h2,h3,p,li,.kicker,.pill,.stat-big,.agenda .t,.tl .txt,.card h3,.card p,.plan { overflow-wrap:anywhere; word-break:break-word; }
  /* auto-fit wrapper: the deck scales this down if the slide's content would overflow (built in JS) */
  .fitwrap { position:relative; z-index:1; display:flex; flex-direction:column; width:100%; transform-origin:center center; }
  .slide::after { content:''; position:absolute; top:-280px; right:-220px; width:640px; height:640px; border-radius:50%;
    background:radial-gradient(circle, ${p.accent}2e 0%, transparent 68%); pointer-events:none; z-index:0; }
  .slide::before { content:''; position:absolute; bottom:-220px; left:-180px; width:520px; height:520px; border-radius:50%;
    background:radial-gradient(circle, ${p.accent}18 0%, transparent 70%); pointer-events:none; z-index:0; }
  h1 { font-family:'${H}',sans-serif; font-weight:800; line-height:1.02; letter-spacing:-.025em; }
  h2 { font-family:'${H}',sans-serif; font-weight:700; line-height:1.1; letter-spacing:-.02em; }
  h3 { font-family:'${H}',sans-serif; }
  .kicker { display:inline-flex; align-items:center; gap:13px; text-transform:uppercase; letter-spacing:.18em; font-size:14px; font-weight:700; color:${p.accent}; margin-bottom:26px; }
  .kicker::before { content:''; width:30px; height:2px; background:${p.accent}; }
  .muted { color:${p.muted}; }
  .accent { color:${p.accent}; }
  .rule { width:58px; height:4px; background:${p.accent}; border-radius:2px; margin:26px 0; }
  ul { list-style:none; display:flex; flex-direction:column; gap:21px; position:relative; z-index:1; }
  li { display:flex; gap:18px; align-items:flex-start; font-size:25px; line-height:1.45; color:${p.text}; }
  li::before { content:''; flex:0 0 auto; width:9px; height:9px; margin-top:10px; background:${p.accent}; transform:rotate(45deg); }
  .foot { position:absolute; left:104px; right:104px; bottom:42px; display:flex; justify-content:space-between; align-items:center; font-size:12px; color:${p.muted}; }
  .foot .brand { font-weight:700; text-transform:uppercase; letter-spacing:.16em; }
  .foot .pg { font-variant-numeric:tabular-nums; letter-spacing:.08em; }
  .prog { position:absolute; left:0; bottom:0; height:4px; background:${p.accent}; }
  .stat-big { font-family:'${H}',sans-serif; font-weight:800; font-size:210px; line-height:.88; color:${p.accent}; letter-spacing:-.045em; position:relative; z-index:1; }
  .quote-mark { font-family:'${H}',sans-serif; font-size:210px; line-height:.5; color:${p.accent}; opacity:.2; margin-bottom:-46px; }
  .wm { position:absolute; right:60px; bottom:-40px; font-family:'${H}',sans-serif; font-weight:800; font-size:240px; color:${p.accent}; opacity:.06; line-height:1; z-index:0; pointer-events:none; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:34px; position:relative; z-index:1; }
  .col { background:${p.surface}; border:1px solid ${p.accent}26; border-radius:18px; padding:34px 36px; }
  .col h3 { font-size:23px; color:${p.accent}; margin-bottom:22px; font-weight:700; }
  .col ul { gap:15px; }
  .col li { font-size:19px; line-height:1.4; }
  .col li::before { margin-top:8px; width:7px; height:7px; }
  .imgwrap { border-radius:18px; overflow:hidden; background:${p.surface}; display:flex; align-items:center; justify-content:center; position:relative; z-index:1; }
  .imgwrap img { width:100%; height:100%; object-fit:cover; }
  /* agenda / process / cards / timeline / pricing / comparison layouts */
  .agenda { display:flex; flex-direction:column; gap:18px; position:relative; z-index:1; }
  .agenda .it { display:flex; align-items:center; gap:22px; }
  .agenda .n { font-family:'${H}',sans-serif; font-weight:800; font-size:34px; color:${p.accent}; min-width:56px; opacity:.9; }
  .agenda .t { font-size:26px; color:${p.text}; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; position:relative; z-index:1; }
  .grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:24px; position:relative; z-index:1; }
  .card { background:${p.surface}; border:1px solid ${p.accent}26; border-radius:18px; padding:28px 30px; }
  .card .cn { display:inline-flex; align-items:center; justify-content:center; width:42px; height:42px; border-radius:12px; background:${p.accent}; color:#fff; font-family:'${H}',sans-serif; font-weight:800; font-size:20px; margin-bottom:16px; }
  .card h3 { font-size:22px; color:${p.text}; margin-bottom:10px; font-weight:700; }
  .card p { font-size:17px; line-height:1.45; color:${p.muted}; }
  .steps { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:18px; align-items:stretch; position:relative; z-index:1; }
  .tl { position:relative; z-index:1; display:flex; flex-direction:column; gap:0; }
  .tl .row { display:grid; grid-template-columns:190px 1fr; gap:26px; padding:16px 0; border-left:3px solid ${p.accent}44; padding-left:30px; margin-left:8px; position:relative; }
  .tl .row::before { content:''; position:absolute; left:-9px; top:22px; width:15px; height:15px; border-radius:50%; background:${p.accent}; }
  .tl .lab { font-family:'${H}',sans-serif; font-weight:700; font-size:21px; color:${p.accent}; }
  .tl .txt { font-size:19px; color:${p.text}; line-height:1.4; }
  .plans { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:22px; position:relative; z-index:1; }
  .plan { background:${p.surface}; border:1px solid ${p.accent}26; border-radius:18px; padding:30px 28px; display:flex; flex-direction:column; }
  .plan.hl { border:2px solid ${p.accent}; box-shadow:0 24px 60px ${p.accent}22; }
  .plan .pn { font-size:20px; font-weight:700; color:${p.text}; }
  .plan .pp { font-family:'${H}',sans-serif; font-weight:800; font-size:40px; color:${p.accent}; margin:10px 0 16px; letter-spacing:-.02em; }
  .plan ul { gap:11px; }
  .plan li { font-size:16px; line-height:1.35; }
  .plan li::before { margin-top:8px; width:7px; height:7px; }
  .vs { display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; border-radius:50%; background:${p.accent}; color:#fff; font-family:'${H}',sans-serif; font-weight:800; font-size:20px; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:3; }
  .team { display:grid; grid-template-columns:repeat(4,1fr); gap:22px; position:relative; z-index:1; }
  .team .m { text-align:center; }
  .team .av { width:96px; height:96px; border-radius:50%; margin:0 auto 14px; background:${p.accent}22; border:2px solid ${p.accent}; display:flex; align-items:center; justify-content:center; font-family:'${H}',sans-serif; font-weight:800; font-size:34px; color:${p.accent}; }
  .team .nm { font-size:19px; font-weight:700; color:${p.text}; }
  .team .rl { font-size:15px; color:${p.muted}; margin-top:3px; }
  .logos { display:grid; grid-template-columns:repeat(4,1fr); gap:20px; position:relative; z-index:1; }
  .logos .lg { background:${p.surface}; border:1px solid ${p.accent}22; border-radius:14px; height:96px; display:flex; align-items:center; justify-content:center; text-align:center; padding:12px; font-family:'${H}',sans-serif; font-weight:700; font-size:19px; color:${p.text}; }
  .split { display:grid; grid-template-columns:1.05fr .95fr; gap:60px; align-items:center; }
  .split .imgwrap { border:1px solid ${p.accent}2a; box-shadow:0 34px 90px rgba(0,0,0,.5); }
  .pill { display:inline-flex; align-items:center; gap:10px; background:${p.accent}; color:#fff; font-weight:700; font-size:22px; padding:15px 30px; border-radius:999px; margin-top:6px; }
  .nv-logo { position:absolute; top:44px; right:52px; height:58px; max-width:230px; object-fit:contain; z-index:6; pointer-events:none; }
  h1, h2, .stat-big, .kicker, .rule, ul, .pill, p { position:relative; z-index:1; }
  #bar { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); display:flex; gap:8px; align-items:center;
    background:rgba(20,20,22,.86); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,.12);
    border-radius:999px; padding:8px 12px; z-index:10; font-family:system-ui,sans-serif; }
  #bar button { background:transparent; border:0; color:#eee; cursor:pointer; font-size:13px; padding:6px 10px; border-radius:999px; }
  #bar button:hover { background:rgba(255,255,255,.14); }
  #bar .count { color:#aaa; font-size:12px; font-variant-numeric:tabular-nums; min-width:52px; text-align:center; }
  /* Subtle, professional entrance — content fades/rises in when a slide becomes active */
  @keyframes nvIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }
  .slide.active h1, .slide.active h2, .slide.active .stat-big, .slide.active .kicker,
  .slide.active .rule, .slide.active ul, .slide.active .cols, .slide.active .pill,
  .slide.active p, .slide.active .quote-mark, .slide.active .imgwrap {
    animation: nvIn .52s cubic-bezier(.22,.61,.36,1) both;
  }
  .slide.active .rule { animation-delay:.07s; }
  .slide.active p, .slide.active .pill, .slide.active .stat-big { animation-delay:.10s; }
  .slide.active ul, .slide.active .cols, .slide.active .imgwrap { animation-delay:.15s; }
  /* Each slide = one full 16:9 page (no A4, no margins, no shrinking). The on-screen fit()
     scales slides to the viewport — that transform MUST be reset for print or every slide
     shrinks and several pile onto one A4 page. */
  @page { size: 1280px 720px; margin: 0; }
  @media print {
    html, body { margin:0; padding:0; background:#fff; height:auto; }
    #bar { display:none; }
    #stage { position:static; display:block; overflow:visible; height:auto; }
    .slide { display:flex !important; position:relative !important; left:auto !important; top:auto !important;
      width:1280px; height:720px; transform:none !important; overflow:hidden;
      page-break-after:always; break-after:page; page-break-inside:avoid; break-inside:avoid; }
    .slide:last-child { page-break-after:auto; break-after:auto; }
    .slide * { animation:none !important; }
  }
  /* ── template overrides (change the whole look, not just colours) ── */
  ${templateCss(spec.template || 'aurora', p)}
  ${editable ? `[data-f]{outline:none;border-radius:5px;transition:box-shadow .12s;min-width:24px} [data-f]:hover{box-shadow:0 0 0 2px ${p.accent}55} [data-f]:focus{box-shadow:0 0 0 2px ${p.accent};cursor:text;background:${p.accent}0d}
  [data-f]:empty{min-height:1em;min-width:120px;display:inline-block} [data-ph]:empty::after{content:attr(data-ph);color:${p.muted};opacity:.5;pointer-events:none}` : ''}
</style>
</head>
<body>
  <div id="stage">${slidesHtml}</div>
  <div id="bar">
    <button id="prev">‹ Prev</button>
    <span class="count" id="count"></span>
    <button id="next">Next ›</button>
    <button id="present" title="Fullscreen">⛶ Present</button>
    <button id="pdf" title="Save as PDF">⭳ PDF</button>
  </div>
<script>
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var cur = 0;
  // Wrap each slide's flowing content into a .fitwrap so we can shrink it to fit if it would
  // overflow (long bullet lists / big headings) — nothing should ever run off the slide edge.
  function clsOf(c){ var n = c.className; return (n && n.baseVal !== undefined) ? n.baseVal : (n || ''); }
  function wrapContent(){
    slides.forEach(function(sl){
      if (sl.querySelector(':scope > .fitwrap')) return;
      var kids = [];
      for (var i=0;i<sl.children.length;i++){
        var c = sl.children[i];
        if (/\\b(prog|foot|wm|nv-logo|fitwrap)\\b/.test(clsOf(c))) continue;
        if (getComputedStyle(c).position === 'absolute') continue; // full-bleed overlays stay put
        kids.push(c);
      }
      if (!kids.length) return;
      var wrap = document.createElement('div'); wrap.className = 'fitwrap';
      sl.insertBefore(wrap, kids[0]);
      kids.forEach(function(k){ wrap.appendChild(k); });
    });
  }
  function fitOne(sl){
    if (!sl) return;
    var wrap = sl.querySelector(':scope > .fitwrap');
    if (!wrap) return;
    wrap.style.transform = 'none';
    var avail = 720 - 96 - 96 - 6;               // slide height minus top+bottom padding
    var h = wrap.scrollHeight;
    if (h > avail) wrap.style.transform = 'scale(' + Math.max(0.55, avail / h) + ')';
  }
  function fit(){
    var s = Math.min(window.innerWidth/1280, window.innerHeight/720);
    slides.forEach(function(el){ el.style.transform = 'scale('+s+')'; });
    fitOne(slides[cur]);
  }
  function show(n){
    cur = Math.max(0, Math.min(slides.length-1, n));
    slides.forEach(function(el,i){ el.classList.toggle('active', i===cur); });
    document.getElementById('count').textContent = (cur+1)+' / '+slides.length;
    fitOne(slides[cur]);
  }
  // Are we embedded inside the app (an iframe), or opened standalone in a real browser?
  // When embedded, fullscreen + print are blocked by the iframe sandbox, so we ask the parent
  // app to do them (it fullscreens the iframe / opens the deck in the real browser to print).
  // When standalone (a downloaded .html), we do them directly — they work there.
  var EMBEDDED = false; try { EMBEDDED = window.parent && window.parent !== window; } catch(e){ EMBEDDED = true; }
  document.getElementById('prev').onclick = function(){ show(cur-1); };
  document.getElementById('next').onclick = function(){ show(cur+1); };
  document.getElementById('present').onclick = function(){
    if (EMBEDDED){ try { parent.postMessage({ __deckPresent: true }, '*'); return; } catch(e){} }
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  };
  document.getElementById('pdf').onclick = function(){
    if (EMBEDDED){ try { parent.postMessage({ __deckPdf: true }, '*'); return; } catch(e){} }
    window.print();
  };
  window.addEventListener('keydown', function(e){
    // Don't hijack keys (arrows/space) while the user is editing a text field.
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('contenteditable') === 'true') return;
    if (e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' '||e.key==='PageDown'){ show(cur+1); e.preventDefault(); }
    else if (e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){ show(cur-1); e.preventDefault(); }
    else if (e.key==='f'||e.key==='F'){ document.getElementById('present').click(); }
    else if (e.key==='p'||e.key==='P'){ document.getElementById('pdf').click(); }
  });
  window.addEventListener('resize', fit);
  wrapContent();
  // Re-fit once fonts have loaded (text metrics change → overflow can appear after load).
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ fitOne(slides[cur]); });
  setTimeout(function(){ fitOne(slides[cur]); }, 350);
  fit(); show(0);
${editable ? `
  // Post every text edit back to the parent app so the deck spec stays in sync (used for
  // downloads / Save to Brain). Fires when a field loses focus.
  document.addEventListener('focusout', function(e){
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-f') != null){
      try { parent.postMessage({ __deckEdit: true, id: '${editId}', s: parseInt(t.getAttribute('data-s'),10), f: t.getAttribute('data-f'), value: t.innerText }, '*'); } catch(_){}
    }
  });` : ''}
</script>
<script type="application/json" id="nv-deck-spec">${JSON.stringify(spec).replace(/<\/(script)/gi, '<\\/$1')}</script>
</body>
</html>`;
}

// Recover a DeckSpec embedded in a rendered deck's HTML (the hidden nv-deck-spec script). Lets a
// deck reloaded from chat history be re-hydrated into the fully editable deck bubble.
export function extractDeckSpec(html: string): DeckSpec | null {
  const m = html.match(/<script type="application\/json" id="nv-deck-spec">([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return normalizeSpec(JSON.parse(m[1].replace(/<\\\/(script)/gi, '</$1'))); } catch { return null; }
}

// Format a chart number compactly: 12_00_000 → "12L"-ish is overkill; keep it simple with
// thousands separators and a k/M shorthand for big values so bar labels stay readable.
function fmtChartNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000)     return (n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n * 100) / 100);
}
// A clean SVG bar chart for a 'chart' slide (a few labelled numbers). Bars in the deck accent,
// value on top, label below. Returns '' when there's no usable numeric data.
function renderChartSvg(s: DeckSlide, p: DeckPalette): string {
  const data = (s.chartData || [])
    .filter((d) => d && d.label != null && typeof d.value === 'number' && isFinite(d.value))
    .slice(0, 8);
  if (data.length < 2) return '';
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 1040, H = 430, padX = 20, base = H - 54, gap = 30, n = data.length;
  const bw = Math.max(40, (W - padX * 2 - gap * (n - 1)) / n);
  const unit = s.chartUnit || '';
  const bars = data.map((d, idx) => {
    const h = Math.max(6, (Math.max(0, d.value) / max) * (base - 40));
    const x = padX + idx * (bw + gap);
    const y = base - h;
    const label = unit === '₹' ? '₹' + fmtChartNum(d.value) : fmtChartNum(d.value) + (unit && unit !== '₹' ? unit : '');
    return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="8" fill="${p.accent}"/>`
      + `<text x="${x + bw / 2}" y="${y - 12}" text-anchor="middle" font-size="21" font-weight="800" fill="${p.text}">${esc(label)}</text>`
      + `<text x="${x + bw / 2}" y="${H - 16}" text-anchor="middle" font-size="17" fill="${p.muted}">${esc(String(d.label).slice(0, 22))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:1040px;position:relative;z-index:1;overflow:visible">`
    + `<line x1="${padX}" y1="${base}" x2="${W - padX}" y2="${base}" stroke="${p.muted}" stroke-opacity=".35" stroke-width="1.5"/>${bars}</svg>`;
}

function renderSlideHtml(s: DeckSlide, spec: DeckSpec, i: number, total: number, editable = false): string {
  const multi = (t = '') => esc(t).replace(/\n/g, '<br>');
  const pct = (((i + 1) / total) * 100).toFixed(1);
  // In-chat editing: mark a text field editable and tag it so a change can be posted back to
  // the deck spec (slide index + field name). Downloaded/saved decks are NOT editable.
  const ed = editable ? (field: string) => ` contenteditable="true" data-s="${i}" data-f="${field}" spellcheck="false"` : () => '';
  const chrome = `<div class="prog" style="width:${pct}%"></div><div class="foot"><span class="brand">${esc(spec.title)}</span><span class="pg">${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>`;
  // If an image fails to load (broken/blank data), remove its box so a slide never shows an
  // empty coloured rectangle — the split layout collapses to a clean single text column.
  const imgErr = `onerror="this.closest('.imgwrap')&amp;&amp;this.closest('.imgwrap').remove();this.closest('.split')&amp;&amp;this.closest('.split').style.setProperty('grid-template-columns','1fr')"`;
  const img = s.imageData ? `<img src="${s.imageData}" alt="" ${imgErr}/>` : '';
  // In the FINAL deck, empty/placeholder bullets are dropped so "Add your point here" never shows.
  // In EDIT mode they stay as empty, clickable <li> (with a faint "Type a point…" hint) so the user
  // can fill or ignore them.
  const bullets = (s.bullets || [])
    .map((b, bi) => ({ b: b || '', bi }))
    .filter(({ b }) => editable || b.trim())
    .map(({ b, bi }) => `<li${ed('bullet.' + bi)}${editable && !b.trim() ? ' data-ph="Type a point…"' : ''}>${esc(b)}</li>`)
    .join('');
  // Background image (with a directional gradient scrim so the left-side text stays readable).
  // Used on title/section/closing — layouts that don't have a dedicated image slot.
  const bgImage = (base: string) => s.imageData
    ? `<div style="position:absolute;inset:0;background:url('${s.imageData}') center/cover;z-index:0"></div>` +
      `<div style="position:absolute;inset:0;background:linear-gradient(100deg, ${base} 22%, ${base}ee 48%, ${base}55 74%, transparent);z-index:0"></div>`
    : '';

  switch (s.layout) {
    case 'title':
      return `<section class="slide">${bgImage(spec.palette.bg)}
        ${s.subtitle ? `<div class="kicker"${ed('subtitle')}>${esc(s.subtitle)}</div>` : ''}
        <h1 style="font-size:86px;max-width:${s.imageData ? '780px' : '1040px'}"${ed('title')}>${esc(s.title || spec.title)}</h1>
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:27px;max-width:${s.imageData ? '660px' : '820px'};line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
        ${chrome}</section>`;
    case 'section':
      return `<section class="slide" style="background:${spec.palette.surface}">${bgImage(spec.palette.surface)}
        ${s.imageData ? '' : `<div class="wm">${String(i + 1).padStart(2, '0')}</div>`}
        <div class="kicker">Section</div>
        <h1 style="font-size:72px;max-width:${s.imageData ? '720px' : '900px'}"${ed('title')}>${esc(s.title || '')}</h1>
        ${s.subtitle ? `<p class="muted" style="font-size:26px;margin-top:20px;max-width:${s.imageData ? '620px' : '780px'};line-height:1.45"${ed('subtitle')}>${esc(s.subtitle)}</p>` : ''}
        ${chrome}</section>`;
    case 'quote':
      return `<section class="slide">
        <div class="quote-mark">&ldquo;</div>
        <h2 style="font-size:46px;max-width:1000px;font-weight:600;line-height:1.24"${ed('quote')}>${esc(s.quote || s.title || '')}</h2>
        ${s.attribution ? `<p class="accent" style="font-size:22px;margin-top:34px;font-weight:700;letter-spacing:.03em"${ed('attribution')}>— ${esc(s.attribution)}</p>` : ''}
        ${chrome}</section>`;
    case 'stat':
      return `<section class="slide">
        ${s.title ? `<div class="kicker"${ed('title')}>${esc(s.title)}</div>` : ''}
        <div class="stat-big"${ed('stat')}>${esc(s.stat || '')}</div>
        ${s.statLabel ? `<p class="muted" style="font-size:30px;margin-top:28px;max-width:800px;line-height:1.4"${ed('statLabel')}>${multi(s.statLabel)}</p>` : ''}
        ${chrome}</section>`;
    case 'chart': {
      const chart = renderChartSvg(s, spec.palette);
      // No usable numbers → render as a normal text slide instead of an empty frame.
      if (!chart) {
        return `<section class="slide">
          ${s.title ? `<h2 style="font-size:46px;max-width:1040px"${ed('title')}>${esc(s.title)}</h2>` : ''}
          <div class="rule"></div>
          ${s.body ? `<p class="muted" style="font-size:24px;margin-bottom:24px;max-width:1000px;line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
          ${(s.bullets || []).length ? `<ul>${bullets}</ul>` : ''}
          ${chrome}</section>`;
      }
      return `<section class="slide">
        ${s.title ? `<h2 style="font-size:44px;max-width:1040px"${ed('title')}>${esc(s.title)}</h2>` : ''}
        <div class="rule"></div>
        ${chart}
        ${s.body ? `<p class="muted" style="font-size:21px;margin-top:24px;max-width:1000px;line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
        ${chrome}</section>`;
    }
    case 'agenda': {
      const items = (s.bullets || []).filter(Boolean);
      if (!items.length) return renderSlideHtml({ ...s, layout: 'bullets' }, spec, i, total, editable);
      return `<section class="slide">
        <div class="kicker">${esc(s.subtitle || 'Agenda')}</div>
        <h2 style="font-size:52px;max-width:1040px"${ed('title')}>${esc(s.title || 'Agenda')}</h2>
        <div class="rule"></div>
        <div class="agenda">${items.map((b, bi) => `<div class="it"><span class="n">${String(bi + 1).padStart(2, '0')}</span><span class="t"${ed('bullet.' + bi)}>${esc(b)}</span></div>`).join('')}</div>
        ${chrome}</section>`;
    }
    case 'comparison': {
      const cc = (s.columns || []).filter((c) => c && (c.heading || (c.bullets && c.bullets.length))).slice(0, 2);
      if (cc.length < 2) return renderSlideHtml({ ...s, layout: 'two-column' }, spec, i, total, editable);
      const col = (c: { heading: string; bullets: string[] }, ci: number) =>
        `<div class="col"><h3${ed('col.' + ci + '.head')}>${esc(c.heading)}</h3><ul>${(c.bullets || []).map((b, bi) => `<li${ed('col.' + ci + '.b.' + bi)}>${esc(b)}</li>`).join('')}</ul></div>`;
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1000px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="cols" style="position:relative">${col(cc[0], 0)}${col(cc[1], 1)}<span class="vs">VS</span></div>
        ${chrome}</section>`;
    }
    case 'cards':
    case 'process': {
      // In EDIT mode render the full array so inline-edit indices match the spec; in the final
      // deck drop empty cards.
      const cards = (editable ? (s.cards || []) : (s.cards || []).filter((c) => c && (c.heading || c.body))).slice(0, 6);
      if (!cards.length) return renderSlideHtml({ ...s, layout: 'bullets' }, spec, i, total, editable);
      const isProc = s.layout === 'process';
      const gridCls = cards.length <= 2 ? 'grid2' : 'grid3';
      const cardHtml = cards.map((c, ci) =>
        `<div class="card">${isProc ? `<span class="cn">${ci + 1}</span>` : ''}<h3${ed('card.' + ci + '.head')}${editable && !c.heading ? ' data-ph="Heading…"' : ''}>${esc(c.heading || '')}</h3>${(editable || c.body) ? `<p${ed('card.' + ci + '.body')}${editable && !c.body ? ' data-ph="Description…"' : ''}>${esc(c.body || '')}</p>` : ''}</div>`
      ).join('');
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="${isProc ? 'steps' : gridCls}">${cardHtml}</div>
        ${chrome}</section>`;
    }
    case 'timeline': {
      const rows = (editable ? (s.timeline || []) : (s.timeline || []).filter((t) => t && (t.label || t.text))).slice(0, 7);
      if (!rows.length) return renderSlideHtml({ ...s, layout: 'bullets' }, spec, i, total, editable);
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="tl">${rows.map((t, ti) => `<div class="row"><div class="lab"${ed('tl.' + ti + '.label')}${editable && !t.label ? ' data-ph="When…"' : ''}>${esc(t.label || '')}</div><div class="txt"${ed('tl.' + ti + '.text')}${editable && !t.text ? ' data-ph="What happened…"' : ''}>${esc(t.text || '')}</div></div>`).join('')}</div>
        ${chrome}</section>`;
    }
    case 'pricing': {
      const plans = (editable ? (s.plans || []) : (s.plans || []).filter((p2) => p2 && p2.name)).slice(0, 4);
      if (!plans.length) return renderSlideHtml({ ...s, layout: 'two-column' }, spec, i, total, editable);
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="plans">${plans.map((pl, pi) => `<div class="plan${pl.highlight ? ' hl' : ''}"><div class="pn"${ed('plan.' + pi + '.name')}${editable && !pl.name ? ' data-ph="Plan…"' : ''}>${esc(pl.name)}</div>${(editable || pl.price) ? `<div class="pp"${ed('plan.' + pi + '.price')}${editable && !pl.price ? ' data-ph="₹—"' : ''}>${esc(pl.price || '')}</div>` : ''}<ul>${(pl.bullets || []).map((b, bi) => `<li${ed('plan.' + pi + '.b.' + bi)}>${esc(b)}</li>`).join('')}</ul></div>`).join('')}</div>
        ${chrome}</section>`;
    }
    case 'team': {
      const ppl = (editable ? (s.people || []) : (s.people || []).filter((m) => m && m.name)).slice(0, 8);
      if (!ppl.length) return renderSlideHtml({ ...s, layout: 'bullets' }, spec, i, total, editable);
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="team" style="grid-template-columns:repeat(${Math.min(4, Math.max(1, ppl.length))},1fr)">${ppl.map((m, mi) => `<div class="m"><div class="av">${esc((m.name || '?').trim().charAt(0).toUpperCase())}</div><div class="nm"${ed('team.' + mi + '.name')}${editable && !m.name ? ' data-ph="Name…"' : ''}>${esc(m.name)}</div>${(editable || m.role) ? `<div class="rl"${ed('team.' + mi + '.role')}${editable && !m.role ? ' data-ph="Role…"' : ''}>${esc(m.role || '')}</div>` : ''}</div>`).join('')}</div>
        ${chrome}</section>`;
    }
    case 'logos': {
      const logos = (editable ? (s.logos || []) : (s.logos || []).filter(Boolean)).slice(0, 12);
      if (!logos.length) return renderSlideHtml({ ...s, layout: 'bullets' }, spec, i, total, editable);
      return `<section class="slide">
        <div class="kicker">${esc(s.subtitle || 'Trusted by')}</div>
        ${(editable || s.title) ? `<h2 style="font-size:40px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="logos" style="grid-template-columns:repeat(${Math.min(4, Math.max(1, logos.length))},1fr)">${logos.map((l, li) => `<div class="lg"${ed('logo.' + li)}${editable && !l ? ' data-ph="Name…"' : ''}>${esc(l)}</div>`).join('')}</div>
        ${chrome}</section>`;
    }
    case 'two-column': {
      const validCols = editable ? (s.columns || []) : (s.columns || []).filter((c) => c && (c.heading || (c.bullets && c.bullets.length)));
      // No usable column data → don't render empty column boxes; fall back to a normal content slide.
      if (validCols.length === 0) {
        return `<section class="slide">
          ${(editable || s.title) ? `<h2 style="font-size:46px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
          <div class="rule"></div>
          ${s.body ? `<p class="muted" style="font-size:24px;margin-bottom:24px;max-width:1000px;line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
          ${(s.bullets || []).length ? `<ul>${bullets}</ul>` : ''}
          ${chrome}</section>`;
      }
      const cols = validCols.map((c, ci) =>
        `<div class="col"><h3${ed('col.' + ci + '.head')}${editable && !c.heading ? ' data-ph="Heading…"' : ''}>${esc(c.heading)}</h3><ul>${(c.bullets || []).map((b, bi) => `<li${ed('col.' + ci + '.b.' + bi)}>${esc(b)}</li>`).join('')}</ul></div>`
      ).join('');
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:44px;max-width:1000px"${ed('title')}${editable && !s.title ? ' data-ph="Title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        <div class="cols">${cols}</div>${chrome}</section>`;
    }
    case 'image-full':
      // No image (Basic mode / generation skipped) → render a bold TEXT slide, never an empty box.
      if (!s.imageData) {
        return `<section class="slide" style="background:${spec.palette.surface}">${bgImage(spec.palette.surface)}
          <div class="kicker"${ed('subtitle')}>${esc(s.subtitle || 'Highlight')}</div>
          <h1 style="font-size:64px;max-width:1040px"${ed('title')}>${esc(s.title || spec.title)}</h1>
          <div class="rule"></div>
          ${s.body ? `<p class="muted" style="font-size:25px;max-width:900px;line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
          ${chrome}</section>`;
      }
      return `<section class="slide" style="padding:0">
        <div class="imgwrap" style="border-radius:0;position:absolute;inset:0;z-index:0">${img}</div>
        ${s.title ? `<div style="position:absolute;left:0;bottom:0;width:100%;padding:64px 104px 84px;background:linear-gradient(transparent,rgba(0,0,0,.82));z-index:1"><h2 style="color:#fff;font-size:46px;max-width:920px"${ed('title')}>${esc(s.title)}</h2></div>` : ''}
        <div class="prog" style="width:${pct}%;z-index:2"></div></section>`;
    case 'closing':
      return `<section class="slide" style="background:${spec.palette.surface}">${bgImage(spec.palette.surface)}
        <div class="kicker">Get started</div>
        <h1 style="font-size:78px;max-width:${s.imageData ? '760px' : '1000px'}"${ed('title')}>${esc(s.title || 'Thank you')}</h1>
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:26px;max-width:${s.imageData ? '640px' : '840px'};line-height:1.5;margin-bottom:14px"${ed('body')}>${multi(s.body)}</p>` : ''}
        ${s.subtitle ? `<div class="pill"${ed('subtitle')}>${esc(s.subtitle)}</div>` : ''}
        ${chrome}</section>`;
    case 'bullets':
    default:
      if (s.imageData) {
        return `<section class="slide">
          <div class="split">
            <div>
              ${(editable || s.title) ? `<h2 style="font-size:40px;max-width:520px"${ed('title')}${editable && !s.title ? ' data-ph="Slide title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
              <div class="rule"></div>
              <ul>${bullets}</ul>
            </div>
            <div class="imgwrap" style="height:470px">${img}</div>
          </div>${chrome}</section>`;
      }
      return `<section class="slide">
        ${(editable || s.title) ? `<h2 style="font-size:46px;max-width:1040px"${ed('title')}${editable && !s.title ? ' data-ph="Slide title…"' : ''}>${esc(s.title || '')}</h2>` : ''}
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:24px;margin-bottom:30px;max-width:1000px;line-height:1.5"${ed('body')}>${multi(s.body)}</p>` : ''}
        <ul>${bullets}</ul>${chrome}</section>`;
  }
}

// ── PPTX (editable PowerPoint) ───────────────────────────────────────────────
// Renders the same DeckSpec into a real .pptx via pptxgenjs (dynamically imported).
// Returns a Blob the caller downloads. Colours must be 6-digit hex WITHOUT '#'.
const hx = (c: string) => (c || '#000000').replace('#', '').slice(0, 6).padStart(6, '0');

export async function deckToPptxBlob(spec: DeckSpec): Promise<Blob> {
  const mod: any = await import('pptxgenjs');
  const PptxGenJS = mod.default || mod;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
  pptx.layout = 'W';
  pptx.author = 'adris.tech';
  pptx.title = spec.title;

  const p = spec.palette;
  const headFont = spec.font.heading;
  const bodyFont = spec.font.body;
  const W = 13.333, H = 7.5;

  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    const isSurface = s.layout === 'section' || s.layout === 'closing';
    slide.background = { color: hx(isSurface ? p.surface : p.bg) };
    // brand bar
    slide.addShape('rect', { x: 0, y: 0, w: 0.14, h: H, fill: { color: hx(p.accent) } });
    // brand logo (top-right corner) if the user supplied one
    if (spec.logo) { try { slide.addImage({ data: spec.logo, x: W - 1.9, y: 0.3, w: 1.5, h: 0.62, sizing: { type: 'contain', w: 1.5, h: 0.62 } }); } catch { /* skip a bad logo */ } }
    if (s.notes) slide.addNotes(s.notes);

    const titleOpt = { fontFace: headFont, color: hx(p.text), bold: true } as any;
    const bodyOpt  = { fontFace: bodyFont, color: hx(p.text) } as any;
    const muteOpt  = { fontFace: bodyFont, color: hx(p.muted) } as any;

    switch (s.layout) {
      case 'title':
        if (s.subtitle) slide.addText(s.subtitle.toUpperCase(), { x: 0.9, y: 2.2, w: 11, h: 0.5, fontSize: 14, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });
        slide.addText(s.title || spec.title, { ...titleOpt, x: 0.9, y: 2.7, w: 11.5, h: 2, fontSize: 48, align: 'left' });
        if (s.body) slide.addText(s.body, { ...muteOpt, x: 0.9, y: 4.7, w: 10.5, h: 1.5, fontSize: 20 });
        break;
      case 'section':
        slide.addText(`SECTION`, { x: 0.9, y: 2.6, w: 8, h: 0.5, fontSize: 14, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });
        slide.addText(s.title || '', { ...titleOpt, x: 0.9, y: 3.1, w: 11, h: 1.6, fontSize: 40 });
        if (s.subtitle) slide.addText(s.subtitle, { ...muteOpt, x: 0.9, y: 4.7, w: 10, h: 1, fontSize: 20 });
        break;
      case 'quote':
        slide.addText('“', { x: 0.7, y: 1.0, w: 3, h: 2, fontSize: 130, color: hx(p.accent), fontFace: headFont, bold: true });
        slide.addText(s.quote || s.title || '', { ...titleOpt, bold: false, x: 1.2, y: 2.7, w: 11, h: 2.5, fontSize: 30, italic: true });
        if (s.attribution) slide.addText(`— ${s.attribution}`, { x: 1.2, y: 5.4, w: 10, h: 0.6, fontSize: 18, color: hx(p.accent), fontFace: bodyFont, bold: true });
        break;
      case 'stat':
        if (s.title) slide.addText(s.title.toUpperCase(), { x: 0.9, y: 2.0, w: 11, h: 0.5, fontSize: 14, charSpacing: 3, color: hx(p.accent), fontFace: bodyFont, bold: true });
        slide.addText(s.stat || '', { ...titleOpt, x: 0.9, y: 2.4, w: 11.5, h: 2.4, fontSize: 130, color: hx(p.accent) });
        if (s.statLabel) slide.addText(s.statLabel, { ...muteOpt, x: 0.9, y: 5.0, w: 10.5, h: 1.2, fontSize: 22 });
        break;
      case 'two-column': {
        if (s.title) slide.addText(s.title, { ...titleOpt, x: 0.9, y: 0.7, w: 11.5, h: 1, fontSize: 30 });
        const cols = s.columns || [];
        const cw = 5.6;
        cols.slice(0, 2).forEach((c, ci) => {
          const cx = 0.9 + ci * (cw + 0.5);
          slide.addShape('roundRect', { x: cx, y: 2.0, w: cw, h: 4.6, fill: { color: hx(p.surface) }, rectRadius: 0.12, line: { type: 'none' } });
          slide.addText(c.heading, { x: cx + 0.4, y: 2.3, w: cw - 0.8, h: 0.6, fontSize: 20, bold: true, color: hx(p.accent), fontFace: headFont });
          slide.addText((c.bullets || []).map((b) => ({ text: b, options: { bullet: true } })), { ...bodyOpt, x: cx + 0.4, y: 3.0, w: cw - 0.8, h: 3.4, fontSize: 16, lineSpacingMultiple: 1.3 });
        });
        break;
      }
      case 'image-full':
        if (s.imageData) slide.addImage({ data: s.imageData, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
        if (s.title) slide.addText(s.title, { x: 0.9, y: 6.2, w: 11, h: 1, fontSize: 30, bold: true, color: 'FFFFFF', fontFace: headFont });
        break;
      case 'closing':
        slide.addText(s.title || 'Thank you', { ...titleOpt, x: 0.9, y: 2.6, w: 11.5, h: 1.6, fontSize: 44 });
        if (s.body) slide.addText(s.body, { ...muteOpt, x: 0.9, y: 4.3, w: 10.5, h: 1.2, fontSize: 22 });
        if (s.subtitle) slide.addText(s.subtitle, { x: 0.9, y: 5.5, w: 10, h: 0.8, fontSize: 20, bold: true, color: hx(p.accent), fontFace: bodyFont });
        break;
      case 'bullets':
      default: {
        const hasImg = !!s.imageData;
        const txtW = hasImg ? 6.8 : 11.5;
        if (s.title) slide.addText(s.title, { ...titleOpt, x: 0.9, y: 0.8, w: txtW, h: 1.1, fontSize: 32 });
        if (s.body) slide.addText(s.body, { ...muteOpt, x: 0.9, y: 1.9, w: txtW, h: 1, fontSize: 18 });
        if (s.bullets && s.bullets.length)
          slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: { characterCode: '2022' } } })),
            { ...bodyOpt, x: 0.9, y: s.body ? 2.9 : 2.1, w: txtW, h: 4, fontSize: 20, lineSpacingMultiple: 1.35 });
        if (hasImg) slide.addImage({ data: s.imageData!, x: 8.1, y: 1.6, w: 4.4, h: 4.4, rounding: true, sizing: { type: 'cover', w: 4.4, h: 4.4 } });
        break;
      }
    }
  }

  const out = await pptx.write({ outputType: 'blob' });
  return out as Blob;
}

// ── PDF (shareable, e.g. attached to an email) ───────────────────────────────
// A real VECTOR PDF drawn from the DeckSpec with jsPDF (not a screenshot) — reliable and small.
// Mirrors the deck's layouts at readable fidelity. 960×540 pt canvas = 16:9.
function rgb(hex: string): [number, number, number] {
  const m = (hex || '#000000').replace('#', '').match(/.{2}/g)?.map((x) => parseInt(x, 16)) ?? [0, 0, 0];
  return [m[0] || 0, m[1] || 0, m[2] || 0];
}
// High-fidelity PDF: render the ACTUAL deck HTML (gradients, shadows, mesh backgrounds, the
// auto-fit that makes 6 bullets fill the slide) offscreen and photograph each slide with
// html2canvas, then drop those images full-bleed into a 16:9 PDF. This replaces the old
// hand-drawn jsPDF reconstruction, which lost every gradient/shadow, flattened the deck to one
// colour, and mangled bar-graph numbers into "1 2 , 5 0 0". The vector version is kept as a
// fallback for the rare case html2canvas can't run. The result is pixel-identical to what the
// user sees in the chat/Brain, at the SAME size — no shrinking, no empty space after the last point.
export async function deckToPdfBlob(spec: DeckSpec): Promise<Blob> {
  const SW = 1280, SH = 720;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let iframe: HTMLIFrameElement | null = null;
  try {
    const html = renderDeckHtml(spec, false);
    iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${SW}px;height:${SH}px;border:0;background:transparent;`;
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!idoc) throw new Error('no iframe doc');
    idoc.open(); idoc.write(html); idoc.close();

    // Wait for the deck to load, its fonts, its images, and its own wrapContent()/fit pass.
    await new Promise<void>((res) => {
      let done = false; const finish = () => { if (!done) { done = true; res(); } };
      if (idoc.readyState === 'complete') finish();
      iframe!.addEventListener('load', finish, { once: true });
      setTimeout(finish, 2500);
    });
    try { await (idoc as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready; } catch { /* system fonts */ }
    // Wait for slide images (data URIs load instantly, but be safe).
    try {
      const imgs = Array.from(idoc.images || []);
      await Promise.all(imgs.map((im) => im.complete ? Promise.resolve() : new Promise<void>((r) => { im.addEventListener('load', () => r(), { once: true }); im.addEventListener('error', () => r(), { once: true }); setTimeout(r, 1500); })));
    } catch { /* ignore */ }
    await sleep(300); // let the deck's setTimeout fit pass run

    const slides = Array.from(idoc.querySelectorAll('.slide')) as HTMLElement[];
    if (!slides.length) throw new Error('no slides');

    const h2cMod: any = await import('html2canvas');
    const html2canvas = h2cMod.default || h2cMod;
    const jsMod: any = await import('jspdf');
    const JsPDF = jsMod.jsPDF || jsMod.default || jsMod;
    const avail = SH - 96 - 96 - 6;
    let doc: any = null;

    for (let i = 0; i < slides.length; i++) {
      // Show ONLY this slide, at native 1280×720 (undo the viewport-fit scale), then re-run the
      // content auto-fit so long slides shrink-to-fit exactly like on screen.
      slides.forEach((el) => { el.classList.remove('active'); el.style.display = 'none'; el.style.transform = 'none'; });
      const sl = slides[i];
      sl.classList.add('active');
      sl.style.display = 'flex';
      sl.style.transform = 'none';
      sl.style.left = '0'; sl.style.top = '0';
      const wrap = sl.querySelector(':scope > .fitwrap') as HTMLElement | null;
      if (wrap) { wrap.style.transform = 'none'; const h = wrap.scrollHeight; if (h > avail) wrap.style.transform = `scale(${Math.max(0.55, avail / h)})`; }
      await sleep(60);
      const canvas = await html2canvas(sl, {
        width: SW, height: SH, windowWidth: SW, windowHeight: SH,
        scale: 2, backgroundColor: null, useCORS: true, logging: false, imageTimeout: 4000,
      });
      const img = canvas.toDataURL('image/jpeg', 0.92);
      if (!doc) doc = new JsPDF({ orientation: 'landscape', unit: 'px', format: [SW, SH], compress: true });
      else doc.addPage([SW, SH], 'landscape');
      doc.addImage(img, 'JPEG', 0, 0, SW, SH, undefined, 'FAST');
    }
    return doc.output('blob') as Blob;
  } catch {
    // Anything went wrong with the live capture → fall back to the vector reconstruction so the
    // user still gets a (plainer) PDF rather than nothing.
    return deckToPdfBlobVector(spec);
  } finally {
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

async function deckToPdfBlobVector(spec: DeckSpec): Promise<Blob> {
  const mod: any = await import('jspdf');
  const JsPDF = mod.jsPDF || mod.default || mod;
  const W = 960, H = 540, M = 66;
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H] });
  const p = spec.palette;
  const [tr, tg, tb] = rgb(p.text), [mr, mg, mb] = rgb(p.muted), [ar, ag, ab] = rgb(p.accent);
  const setText = (hex: string) => { const [r, g, b] = rgb(hex); doc.setTextColor(r, g, b); };

  spec.slides.forEach((s, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape');
    const surface = s.layout === 'section' || s.layout === 'closing';
    const [bgR, bgG, bgB] = rgb(surface ? p.surface : p.bg);
    doc.setFillColor(bgR, bgG, bgB); doc.rect(0, 0, W, H, 'F');
    // accent brand bar (left edge)
    doc.setFillColor(ar, ag, ab); doc.rect(0, 0, 6, H, 'F');
    // page number
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(mr, mg, mb);
    doc.text(`${String(i + 1).padStart(2, '0')} / ${String(spec.slides.length).padStart(2, '0')}`, W - M, H - 24, { align: 'right' });
    // logo top-right
    if (spec.logo) { try { doc.addImage(spec.logo, 'PNG', W - M - 90, 22, 90, 34, undefined, 'FAST'); } catch { /* skip */ } }

    const title = (size: number, y: number, txt: string, color = p.text) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(size); setText(color);
      const lines = doc.splitTextToSize(txt || '', W - M * 2);
      doc.text(lines, M, y); return y + lines.length * size * 1.08;
    };
    const rule = (y: number) => { doc.setFillColor(ar, ag, ab); doc.rect(M, y, 42, 3, 'F'); };
    const para = (size: number, y: number, txt: string, w = W - M * 2, color = p.muted) => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(size); setText(color);
      const lines = doc.splitTextToSize(txt || '', w); doc.text(lines, M, y); return y + lines.length * size * 1.35;
    };
    const bulletList = (size: number, y0: number, items: string[], x = M, w = W - M * 2) => {
      let y = y0; doc.setFontSize(size);
      for (const b of items) {
        doc.setFillColor(ar, ag, ab); doc.rect(x, y - size * 0.32, 4, 4, 'F');
        doc.setFont('helvetica', 'normal'); doc.setTextColor(tr, tg, tb);
        const lines = doc.splitTextToSize(b, w - 16); doc.text(lines, x + 14, y);
        y += lines.length * size * 1.28 + 6;
      }
      return y;
    };
    const kicker = (y: number, txt: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(ar, ag, ab); doc.text((txt || '').toUpperCase(), M, y); };
    const imgCover = (data: string, x: number, y: number, w: number, h: number) => { try { doc.addImage(data, 'JPEG', x, y, w, h, undefined, 'FAST'); } catch { try { doc.addImage(data, 'PNG', x, y, w, h, undefined, 'FAST'); } catch { /* skip */ } } };

    switch (s.layout) {
      case 'title': {
        if (s.subtitle) kicker(210, s.subtitle);
        let y = title(40, 260, s.title || spec.title); rule(y + 8);
        if (s.body) para(16, y + 40, s.body, W - M * 2);
        break;
      }
      case 'section': {
        kicker(250, 'Section');
        let y = title(34, 300, s.title || ''); if (s.subtitle) para(16, y + 20, s.subtitle);
        break;
      }
      case 'agenda': {
        title(30, 120, s.title || 'Agenda'); rule(140);
        let y = 190; doc.setFontSize(18);
        (s.bullets || []).slice(0, 8).forEach((b, bi) => {
          doc.setFont('helvetica', 'bold'); doc.setTextColor(ar, ag, ab); doc.text(String(bi + 1).padStart(2, '0'), M, y);
          doc.setFont('helvetica', 'normal'); doc.setTextColor(tr, tg, tb); doc.text(doc.splitTextToSize(b, W - M * 2 - 50), M + 42, y);
          y += 42;
        });
        break;
      }
      case 'quote': {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(96); doc.setTextColor(ar, ag, ab); doc.text('“', M, 200);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(26); setText(p.text);
        doc.text(doc.splitTextToSize(s.quote || s.title || '', W - M * 2), M, 250);
        if (s.attribution) { doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(ar, ag, ab); doc.text(`— ${s.attribution}`, M, 400); }
        break;
      }
      case 'stat': {
        if (s.title) kicker(190, s.title);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(150); doc.setTextColor(ar, ag, ab); doc.text(s.stat || '', M, 330);
        if (s.statLabel) para(20, 380, s.statLabel);
        break;
      }
      case 'chart': {
        title(30, 110, s.title || ''); rule(128);
        const data = (s.chartData || []).filter((d) => d && typeof d.value === 'number').slice(0, 6);
        if (data.length >= 2) {
          const max = Math.max(...data.map((d) => d.value), 1);
          const base = 430, chartH = 230, n = data.length, gap = 26;
          const bw = Math.min(120, (W - M * 2 - gap * (n - 1)) / n);
          data.forEach((d, di) => {
            const bh = Math.max(6, (Math.max(0, d.value) / max) * chartH);
            const x = M + di * (bw + gap), y = base - bh;
            doc.setFillColor(ar, ag, ab); doc.rect(x, y, bw, bh, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(14); setText(p.text);
            const lbl = (s.chartUnit === '₹' ? '₹' : '') + Math.round(d.value).toLocaleString() + (s.chartUnit && s.chartUnit !== '₹' ? s.chartUnit : '');
            doc.text(lbl, x + bw / 2, y - 8, { align: 'center' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(mr, mg, mb);
            doc.text(doc.splitTextToSize(String(d.label), bw + gap - 6), x + bw / 2, base + 18, { align: 'center' });
          });
        } else if (s.body) para(16, 170, s.body);
        break;
      }
      case 'two-column':
      case 'comparison': {
        title(30, 100, s.title || ''); rule(118);
        const cols = (s.columns || []).filter((c) => c && (c.heading || c.bullets?.length)).slice(0, 2);
        const cw = (W - M * 2 - 24) / 2;
        cols.forEach((c, ci) => {
          const cx = M + ci * (cw + 24);
          const [sr, sg, sb] = rgb(p.surface); doc.setFillColor(sr, sg, sb); doc.roundedRect(cx, 150, cw, 320, 10, 10, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(ar, ag, ab); doc.text(doc.splitTextToSize(c.heading || '', cw - 40), cx + 22, 185);
          bulletList(14, 220, c.bullets || [], cx + 22, cw - 44);
        });
        if (s.layout === 'comparison' && cols.length === 2) { doc.setFillColor(ar, ag, ab); doc.circle(W / 2, 310, 24, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(255, 255, 255); doc.text('VS', W / 2, 315, { align: 'center' }); }
        break;
      }
      case 'cards':
      case 'process': {
        title(30, 100, s.title || ''); rule(118);
        const cards = (s.cards || []).filter((c) => c && (c.heading || c.body)).slice(0, 6);
        const per = cards.length <= 2 ? cards.length : 3; const rows = Math.ceil(cards.length / per);
        const cw = (W - M * 2 - 20 * (per - 1)) / per, ch = rows > 1 ? 150 : 300;
        cards.forEach((c, ci) => {
          const cx = M + (ci % per) * (cw + 20), cy = 150 + Math.floor(ci / per) * (ch + 20);
          const [sr, sg, sb] = rgb(p.surface); doc.setFillColor(sr, sg, sb); doc.roundedRect(cx, cy, cw, ch, 10, 10, 'F');
          let ty = cy + 34;
          if (s.layout === 'process') { doc.setFillColor(ar, ag, ab); doc.roundedRect(cx + 20, cy + 18, 30, 30, 6, 6, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(255, 255, 255); doc.text(String(ci + 1), cx + 35, cy + 38, { align: 'center' }); ty = cy + 76; }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(16); setText(p.text); doc.text(doc.splitTextToSize(c.heading || '', cw - 40), cx + 20, ty);
          if (c.body) { doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(mr, mg, mb); doc.text(doc.splitTextToSize(c.body, cw - 40), cx + 20, ty + 24); }
        });
        break;
      }
      case 'timeline': {
        title(30, 100, s.title || ''); rule(118);
        let y = 170; (s.timeline || []).slice(0, 6).forEach((t) => {
          doc.setFillColor(ar, ag, ab); doc.circle(M + 6, y - 4, 5, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(ar, ag, ab); doc.text(t.label || '', M + 26, y);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(13); setText(p.text); doc.text(doc.splitTextToSize(t.text || '', W - M * 2 - 180), M + 180, y);
          y += 56;
        });
        break;
      }
      case 'pricing': {
        title(30, 96, s.title || ''); rule(114);
        const plans = (s.plans || []).filter((pl) => pl && pl.name).slice(0, 4);
        const n = plans.length || 1, gap = 18, cw = (W - M * 2 - gap * (n - 1)) / n;
        plans.forEach((pl, pi) => {
          const cx = M + pi * (cw + gap);
          const [sr, sg, sb] = rgb(p.surface); doc.setFillColor(sr, sg, sb); doc.roundedRect(cx, 150, cw, 330, 10, 10, 'F');
          if (pl.highlight) { doc.setDrawColor(ar, ag, ab); doc.setLineWidth(2); doc.roundedRect(cx, 150, cw, 330, 10, 10, 'S'); }
          doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setText(p.text); doc.text(doc.splitTextToSize(pl.name, cw - 30), cx + 18, 182);
          if (pl.price) { doc.setFontSize(26); doc.setTextColor(ar, ag, ab); doc.text(pl.price, cx + 18, 220); }
          bulletList(12, 252, pl.bullets || [], cx + 18, cw - 34);
        });
        break;
      }
      case 'team': {
        title(30, 100, s.title || ''); rule(118);
        const ppl = (s.people || []).filter((m) => m && m.name).slice(0, 8);
        const per = Math.min(4, ppl.length || 1), cw = (W - M * 2 - 20 * (per - 1)) / per;
        ppl.forEach((m, mi) => {
          const cx = M + (mi % per) * (cw + 20) + cw / 2, cy = 190 + Math.floor(mi / per) * 170;
          doc.setFillColor(ar, ag, ab); doc.circle(cx, cy, 34, 'S'); doc.setDrawColor(ar, ag, ab);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(ar, ag, ab); doc.text((m.name || '?').charAt(0).toUpperCase(), cx, cy + 9, { align: 'center' });
          doc.setFontSize(15); setText(p.text); doc.text(doc.splitTextToSize(m.name, cw), cx, cy + 62, { align: 'center' });
          if (m.role) { doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(mr, mg, mb); doc.text(doc.splitTextToSize(m.role, cw), cx, cy + 82, { align: 'center' }); }
        });
        break;
      }
      case 'logos': {
        kicker(90, s.subtitle || 'Trusted by'); title(30, 130, s.title || ''); rule(148);
        const logos = (s.logos || []).filter(Boolean).slice(0, 12);
        const per = Math.min(4, logos.length || 1), cw = (W - M * 2 - 18 * (per - 1)) / per, ch = 84;
        logos.forEach((l, li) => {
          const cx = M + (li % per) * (cw + 18), cy = 180 + Math.floor(li / per) * (ch + 18);
          const [sr, sg, sb] = rgb(p.surface); doc.setFillColor(sr, sg, sb); doc.roundedRect(cx, cy, cw, ch, 10, 10, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(15); setText(p.text); doc.text(doc.splitTextToSize(l, cw - 24), cx + cw / 2, cy + ch / 2 + 5, { align: 'center' });
        });
        break;
      }
      case 'image-full': {
        if (s.imageData) { imgCover(s.imageData, 0, 0, W, H); doc.setFillColor(0, 0, 0); (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 0.55 })); doc.rect(0, H - 120, W, 120, 'F'); (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 1 })); doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(255, 255, 255); doc.text(doc.splitTextToSize(s.title || '', W - M * 2), M, H - 60); }
        else { kicker(200, s.subtitle || 'Highlight'); let y = title(30, 250, s.title || spec.title); rule(y + 8); if (s.body) para(15, y + 40, s.body); }
        break;
      }
      case 'closing': {
        kicker(210, 'Get started');
        let y = title(38, 270, s.title || 'Thank you'); rule(y + 8);
        if (s.body) y = para(16, y + 40, s.body);
        if (s.subtitle) { doc.setFillColor(ar, ag, ab); doc.roundedRect(M, y + 20, doc.getTextWidth(s.subtitle) + 40, 34, 17, 17, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(255, 255, 255); doc.text(s.subtitle, M + 20, y + 42); }
        break;
      }
      default: {
        // bullets (with optional image on the right)
        const hasImg = !!s.imageData; const txtW = hasImg ? W - M * 2 - 340 : W - M * 2;
        let y = title(28, 110, s.title || ''); rule(y + 6); y += 34;
        if (s.body) y = para(15, y, s.body, txtW);
        bulletList(16, y + 10, s.bullets || [], M, txtW);
        if (hasImg) imgCover(s.imageData!, W - M - 300, 150, 300, 300);
        break;
      }
    }
  });

  return doc.output('blob') as Blob;
}
