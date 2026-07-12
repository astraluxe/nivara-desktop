// ─── Deck (presentation) spec + renderers ───────────────────────────────────
// One structured DeckSpec → two renderers:
//   • renderDeckHtml()  → self-contained keyboard-navigable HTML deck (shown in chat,
//                          present fullscreen, export to PDF via the browser print dialog)
//   • deckToPptxBlob()  → real editable .pptx (opens in PowerPoint / Google Slides / Keynote)
//
// The deck_maker agent (Krew) emits a DeckSpec as JSON. In Advanced mode each slide's
// imagePrompt is turned into a real image (Gemini "Nano Banana") and stored as a data URI.

export interface DeckSlide {
  layout: 'title' | 'section' | 'bullets' | 'quote' | 'stat' | 'two-column' | 'image-full' | 'closing';
  title?:       string;
  subtitle?:    string;
  bullets?:     string[];
  body?:        string;
  quote?:       string;
  attribution?: string;
  stat?:        string;   // big number, e.g. "94%"
  statLabel?:   string;
  columns?:     { heading: string; bullets: string[] }[];
  imagePrompt?: string;   // Advanced mode: prompt for the AI image
  imageData?:   string;   // filled after generation — a data: URI (or full remote URL)
  notes?:       string;   // speaker notes (exported to pptx notes)
}

export interface DeckPalette { bg: string; surface: string; text: string; muted: string; accent: string }
export interface DeckFont    { heading: string; body: string }

export interface DeckSpec {
  title:     string;
  subtitle?: string;
  preset:    string;                 // one of the 8 design presets (informational)
  palette:   DeckPalette;
  font:      DeckFont;
  slides:    DeckSlide[];
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
};

// Fill defaults + drop invalid slides. Returns null if nothing usable.
function normalizeSpec(spec: any): DeckSpec | null {
  if (!spec || !Array.isArray(spec.slides)) return null;
  spec.slides = spec.slides.filter((s: any) => s && typeof s === 'object' && typeof s.layout === 'string');
  if (spec.slides.length === 0) return null;
  const preset = String(spec.preset || 'dark').toLowerCase();
  spec.preset  = preset;
  spec.palette = { ...(PRESET_PALETTES[preset] ?? PRESET_PALETTES.dark), ...(spec.palette || {}) };
  spec.font    = { ...(PRESET_FONTS[preset] ?? PRESET_FONTS.dark), ...(spec.font || {}) };
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
export function renderDeckHtml(spec: DeckSpec): string {
  const p = spec.palette, H = spec.font.heading, B = spec.font.body;
  const families = Array.from(new Set([H, B]));
  const fontLink = `https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${fontParam(f)}:wght@400;500;600;700;800`)
    .join('&')}&display=swap`;

  const total = spec.slides.length;
  const slidesHtml = spec.slides.map((s, i) => renderSlideHtml(s, spec, i, total)).join('\n');

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
  .wm { position:absolute; right:70px; bottom:-56px; font-family:'${H}',sans-serif; font-weight:800; font-size:360px; color:${p.accent}; opacity:.09; line-height:1; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:34px; position:relative; z-index:1; }
  .col { background:${p.surface}; border:1px solid ${p.accent}26; border-radius:18px; padding:34px 36px; }
  .col h3 { font-size:23px; color:${p.accent}; margin-bottom:22px; font-weight:700; }
  .col ul { gap:15px; }
  .col li { font-size:19px; line-height:1.4; }
  .col li::before { margin-top:8px; width:7px; height:7px; }
  .imgwrap { border-radius:18px; overflow:hidden; background:${p.surface}; display:flex; align-items:center; justify-content:center; position:relative; z-index:1; }
  .imgwrap img { width:100%; height:100%; object-fit:cover; }
  .split { display:grid; grid-template-columns:1.05fr .95fr; gap:60px; align-items:center; }
  .split .imgwrap { border:1px solid ${p.accent}2a; box-shadow:0 34px 90px rgba(0,0,0,.5); }
  .pill { display:inline-flex; align-items:center; gap:10px; background:${p.accent}; color:#fff; font-weight:700; font-size:22px; padding:15px 30px; border-radius:999px; margin-top:6px; }
  h1, h2, .stat-big, .kicker, .rule, ul, .pill, p { position:relative; z-index:1; }
  #bar { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); display:flex; gap:8px; align-items:center;
    background:rgba(20,20,22,.86); backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,.12);
    border-radius:999px; padding:8px 12px; z-index:10; font-family:system-ui,sans-serif; }
  #bar button { background:transparent; border:0; color:#eee; cursor:pointer; font-size:13px; padding:6px 10px; border-radius:999px; }
  #bar button:hover { background:rgba(255,255,255,.14); }
  #bar .count { color:#aaa; font-size:12px; font-variant-numeric:tabular-nums; min-width:52px; text-align:center; }
  @media print {
    #bar { display:none; }
    #stage { position:static; }
    .slide { display:flex !important; position:relative; page-break-after:always; }
  }
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
  function fit(){
    var s = Math.min(window.innerWidth/1280, window.innerHeight/720);
    slides.forEach(function(el){ el.style.transform = 'scale('+s+')'; });
  }
  function show(n){
    cur = Math.max(0, Math.min(slides.length-1, n));
    slides.forEach(function(el,i){ el.classList.toggle('active', i===cur); });
    document.getElementById('count').textContent = (cur+1)+' / '+slides.length;
  }
  document.getElementById('prev').onclick = function(){ show(cur-1); };
  document.getElementById('next').onclick = function(){ show(cur+1); };
  document.getElementById('present').onclick = function(){
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  };
  document.getElementById('pdf').onclick = function(){ window.print(); };
  window.addEventListener('keydown', function(e){
    if (e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' '||e.key==='PageDown'){ show(cur+1); e.preventDefault(); }
    else if (e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'){ show(cur-1); e.preventDefault(); }
    else if (e.key==='f'||e.key==='F'){ document.getElementById('present').click(); }
    else if (e.key==='p'||e.key==='P'){ window.print(); }
  });
  window.addEventListener('resize', fit);
  fit(); show(0);
</script>
</body>
</html>`;
}

function renderSlideHtml(s: DeckSlide, spec: DeckSpec, i: number, total: number): string {
  const multi = (t = '') => esc(t).replace(/\n/g, '<br>');
  const pct = (((i + 1) / total) * 100).toFixed(1);
  const chrome = `<div class="prog" style="width:${pct}%"></div><div class="foot"><span class="brand">${esc(spec.title)}</span><span class="pg">${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span></div>`;
  const img = s.imageData ? `<img src="${s.imageData}" alt=""/>` : '';
  const bullets = (s.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('');
  // Background image (with a directional gradient scrim so the left-side text stays readable).
  // Used on title/section/closing — layouts that don't have a dedicated image slot.
  const bgImage = (base: string) => s.imageData
    ? `<div style="position:absolute;inset:0;background:url('${s.imageData}') center/cover;z-index:0"></div>` +
      `<div style="position:absolute;inset:0;background:linear-gradient(100deg, ${base} 22%, ${base}ee 48%, ${base}55 74%, transparent);z-index:0"></div>`
    : '';

  switch (s.layout) {
    case 'title':
      return `<section class="slide">${bgImage(spec.palette.bg)}
        ${s.subtitle ? `<div class="kicker">${esc(s.subtitle)}</div>` : ''}
        <h1 style="font-size:86px;max-width:${s.imageData ? '780px' : '1040px'}">${esc(s.title || spec.title)}</h1>
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:27px;max-width:${s.imageData ? '660px' : '820px'};line-height:1.5">${multi(s.body)}</p>` : ''}
        ${chrome}</section>`;
    case 'section':
      return `<section class="slide" style="background:${spec.palette.surface}">${bgImage(spec.palette.surface)}
        ${s.imageData ? '' : `<div class="wm">${String(i + 1).padStart(2, '0')}</div>`}
        <div class="kicker">Section</div>
        <h1 style="font-size:72px;max-width:${s.imageData ? '720px' : '900px'}">${esc(s.title || '')}</h1>
        ${s.subtitle ? `<p class="muted" style="font-size:26px;margin-top:20px;max-width:${s.imageData ? '620px' : '780px'};line-height:1.45">${esc(s.subtitle)}</p>` : ''}
        ${chrome}</section>`;
    case 'quote':
      return `<section class="slide">
        <div class="quote-mark">&ldquo;</div>
        <h2 style="font-size:46px;max-width:1000px;font-weight:600;line-height:1.24">${esc(s.quote || s.title || '')}</h2>
        ${s.attribution ? `<p class="accent" style="font-size:22px;margin-top:34px;font-weight:700;letter-spacing:.03em">— ${esc(s.attribution)}</p>` : ''}
        ${chrome}</section>`;
    case 'stat':
      return `<section class="slide">
        ${s.title ? `<div class="kicker">${esc(s.title)}</div>` : ''}
        <div class="stat-big">${esc(s.stat || '')}</div>
        ${s.statLabel ? `<p class="muted" style="font-size:30px;margin-top:28px;max-width:800px;line-height:1.4">${multi(s.statLabel)}</p>` : ''}
        ${chrome}</section>`;
    case 'two-column': {
      const cols = (s.columns || []).map((c) =>
        `<div class="col"><h3>${esc(c.heading)}</h3><ul>${(c.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`
      ).join('');
      return `<section class="slide">
        ${s.title ? `<h2 style="font-size:44px;max-width:1000px">${esc(s.title)}</h2>` : ''}
        <div class="rule"></div>
        <div class="cols">${cols}</div>${chrome}</section>`;
    }
    case 'image-full':
      return `<section class="slide" style="padding:0">
        <div class="imgwrap" style="border-radius:0;position:absolute;inset:0;z-index:0">${img || `<span class="muted">${esc(s.title || '')}</span>`}</div>
        ${s.title ? `<div style="position:absolute;left:0;bottom:0;width:100%;padding:64px 104px 84px;background:linear-gradient(transparent,rgba(0,0,0,.82));z-index:1"><h2 style="color:#fff;font-size:46px;max-width:920px">${esc(s.title)}</h2></div>` : ''}
        <div class="prog" style="width:${pct}%;z-index:2"></div></section>`;
    case 'closing':
      return `<section class="slide" style="background:${spec.palette.surface}">${bgImage(spec.palette.surface)}
        <div class="kicker">Get started</div>
        <h1 style="font-size:78px;max-width:${s.imageData ? '760px' : '1000px'}">${esc(s.title || 'Thank you')}</h1>
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:26px;max-width:${s.imageData ? '640px' : '840px'};line-height:1.5;margin-bottom:14px">${multi(s.body)}</p>` : ''}
        ${s.subtitle ? `<div class="pill">${esc(s.subtitle)}</div>` : ''}
        ${chrome}</section>`;
    case 'bullets':
    default:
      if (s.imageData) {
        return `<section class="slide">
          <div class="split">
            <div>
              ${s.title ? `<h2 style="font-size:40px;max-width:520px">${esc(s.title)}</h2>` : ''}
              <div class="rule"></div>
              <ul>${bullets}</ul>
            </div>
            <div class="imgwrap" style="height:470px">${img}</div>
          </div>${chrome}</section>`;
      }
      return `<section class="slide">
        ${s.title ? `<h2 style="font-size:46px;max-width:1040px">${esc(s.title)}</h2>` : ''}
        <div class="rule"></div>
        ${s.body ? `<p class="muted" style="font-size:24px;margin-bottom:30px;max-width:1000px;line-height:1.5">${multi(s.body)}</p>` : ''}
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
