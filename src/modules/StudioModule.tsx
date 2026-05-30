import { useState, useRef, useEffect } from 'react';
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
  { id: 'minimal',   label: 'Minimal',    desc: 'Clean white background, generous whitespace, sharp modern typography' },
  { id: 'bold',      label: 'Bold',       desc: 'High contrast black/white, dominant oversized typography, strong shapes' },
  { id: 'dark',      label: 'Dark',       desc: 'Deep dark background (#0c0b14), glassmorphism panels, glowing purple accents' },
  { id: 'vibrant',   label: 'Vibrant',    desc: 'Colorful purple-to-violet gradients, energetic, high-impact social-first' },
  { id: 'corporate', label: 'Corporate',  desc: 'Professional navy/blue, trustworthy, clean layout, suitable for LinkedIn' },
  { id: 'editorial', label: 'Editorial',  desc: 'Magazine-style, large type, strong grid, editorial photography-like feel' },
];

// ─── Accent color palette ─────────────────────────────────────────────────────

const ACCENT_PALETTE = [
  { name: 'Violet',  hex: '#6d4cff' },
  { name: 'Orange',  hex: '#f97316' },
  { name: 'Amber',   hex: '#f59e0b' },
  { name: 'Lime',    hex: '#84cc16' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Sky',     hex: '#0ea5e9' },
  { name: 'Pink',    hex: '#ec4899' },
  { name: 'Rose',    hex: '#f43f5e' },
  { name: 'White',   hex: '#f8fafc' },
];

// ─── Marketing agents ─────────────────────────────────────────────────────────

interface StudioAgent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  defaultFormatId: string;
  defaultDuration: number;
  bias: string;
}

// ─── Review agents (marketing department) ────────────────────────────────────

interface ReviewResult {
  score: number;
  verdict: 'approved' | 'needs_work' | 'rejected';
  issues: string[];
  fixes: string[];
}

interface ReviewAgent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  prompt: string;
}

const REVIEW_AGENTS: ReviewAgent[] = [
  {
    id: 'creative',
    name: 'Riya',
    role: 'Creative Director',
    emoji: '🎨',
    prompt: `You are a Creative Director reviewing a marketing video's HTML/CSS code. Evaluate visual quality with brutal honesty.
Assess: typography hierarchy (is the hero headline dominant?), color palette execution, spacing and breathing room, animation polish and timing, background depth, overall aesthetic grade.
Return ONLY valid JSON (no markdown): {"score":<1-10>,"verdict":"approved"|"needs_work"|"rejected","issues":["specific issue 1","specific issue 2"],"fixes":["exact refinement instruction 1","exact refinement instruction 2"]}
Fixes must be actionable prompts (e.g. "Make the hero headline font-size 20% larger and add letter-spacing:-0.04em"). Max 3 issues.`,
  },
  {
    id: 'social',
    name: 'Zara',
    role: 'Social Media Expert',
    emoji: '📱',
    prompt: `You are a Social Media Expert specializing in Instagram Reels and TikTok performance. Review this video HTML for scroll-stopping impact.
Assess: hook strength in first 0.5s (is the first animated element attention-grabbing?), CTA button visibility and copy urgency, animation speed (slow stagger delays lose mobile viewers), text size for mobile viewing, shareability factor.
Return ONLY valid JSON (no markdown): {"score":<1-10>,"verdict":"approved"|"needs_work"|"rejected","issues":["specific issue"],"fixes":["exact fix instruction"]}
Fixes must be specific prompts. Max 3 issues.`,
  },
  {
    id: 'brand',
    name: 'Arjun',
    role: 'Brand Strategist',
    emoji: '🎯',
    prompt: `You are a Brand Strategist reviewing this video for messaging clarity and brand effectiveness.
Assess: does the value proposition land in the first scene?, is the headline specific or generic?, is the feature copy benefit-driven not feature-driven?, is brand hierarchy correct (name → tagline → proof → CTA)?, would a cold viewer understand the offer in 5 seconds?
Return ONLY valid JSON (no markdown): {"score":<1-10>,"verdict":"approved"|"needs_work"|"rejected","issues":["specific issue"],"fixes":["exact fix instruction"]}
Max 3 issues.`,
  },
  {
    id: 'conversion',
    name: 'Kiran',
    role: 'Conversion Expert',
    emoji: '📊',
    prompt: `You are a Conversion Rate Optimization expert. Review this video's HTML for its ability to drive action.
Assess: CTA button size, color contrast, and copy (is it action-oriented?), value prop → CTA visual flow, presence of urgency/scarcity signals, number of competing visual elements distracting from CTA, social proof or numbers present.
Return ONLY valid JSON (no markdown): {"score":<1-10>,"verdict":"approved"|"needs_work"|"rejected","issues":["specific issue"],"fixes":["exact fix instruction"]}
Max 3 issues.`,
  },
];

const STUDIO_AGENTS: StudioAgent[] = [
  {
    id: 'director',
    name: 'Riya',
    role: 'Brand Director',
    emoji: '🎯',
    defaultFormatId: 'wide',
    defaultDuration: 30,
    bias: 'You are a premium brand director. Create a timeless, cinematic video that feels like a high-budget ad. Prioritize brand identity — extract the exact brand voice, color palette, and positioning from the context. Use elegant typography, rich dark backgrounds, layered depth. Every frame should feel intentional and luxury-grade.',
  },
  {
    id: 'social',
    name: 'Zara',
    role: 'Social Expert',
    emoji: '📱',
    defaultFormatId: 'story',
    defaultDuration: 15,
    bias: 'You are a viral social media expert designing for Instagram Reels and TikTok. Hook viewers in the first 0.5 seconds. Use bold typography, fast stagger (0.2s between elements), energetic vibrant colors (purple gradients), and make the CTA impossible to ignore. Optimize for mobile portrait viewing — stack elements vertically, high-contrast minimal shapes, NO emojis (they render badly on canvas).',
  },
  {
    id: 'launch',
    name: 'Arjun',
    role: 'Launch Strategist',
    emoji: '🚀',
    defaultFormatId: 'wide',
    defaultDuration: 45,
    bias: 'You are a product launch strategist. Structure the video as a conversion narrative: Scene 1 — attention-grabbing brand moment, Scene 2 — 3 key features with proof points, Scene 3 — social proof stats (animate numbers counting up), Scene 4 — urgent CTA with offer. Every scene has a single job. Drive action.',
  },
  {
    id: 'data',
    name: 'Kiran',
    role: 'Data Storyteller',
    emoji: '📊',
    defaultFormatId: 'wide',
    defaultDuration: 30,
    bias: 'You are a data storyteller. Lead with numbers — animate 3–4 key metrics using countUp animation (e.g., "10×", "99%", "2M+ users"). Use a professional corporate palette, clean grid layouts, and credibility-first copy. Investors and decision-makers are the audience. Every claim needs a number behind it.',
  },
];


function buildStaticHtml(code: string): string {
  if (/^<!DOCTYPE/i.test(code.trimStart()) || /^<html/i.test(code.trimStart())) return code;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}html,body{height:100%;font-family:'Inter Tight',system-ui,sans-serif}</style></head><body>${code}</body></html>`;
}

// Use AI's complete HTML as-is (preserving drawing functions defined anywhere in the script)
// Falls back to wrapping bare scene code with the canonical runtime
function assembleVideoHtml(stripped: string, fmt: Format, dur: number): string {
  if (/^<!DOCTYPE/i.test(stripped.trimStart()) || /^<html/i.test(stripped.trimStart())) {
    return stripped;
  }
  const sceneCode = extractSceneSection(stripped) || stripped;
  return buildVideoHtml(fmt, dur, sceneCode);
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

function extractDurationFromPrompt(text: string): number | null {
  const m = text.match(/\b(\d+)\s*(?:sec(?:ond)?s?)\b/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  return DURATIONS.includes(n) ? n : null;
}

// Fallback HTML shell for bare snippet responses (rare — AI normally returns full HTML)
function buildVideoHtml(fmt: Format, duration: number, snippet: string): string {
  const W = fmt.w, H = fmt.h;
  const subPad = Math.round(H * 0.015), subW = Math.round(W * 0.05), subFs = Math.round(H * 0.025);
  const playbackJs = `(function(){
  var DUR=${duration},start=performance.now(),_paused=false,_pausedAt=0;
  window._PAUSED=false;
  function rawT(){return(performance.now()-start)/1000;}
  function curT(){return _paused?_pausedAt:rawT()%DUR;}
  Object.defineProperty(window,'_T',{get:curT,set:function(v){start=performance.now()-v*1000;_pausedAt=v;}});
  var _clips=null;
  function _tick(){if(!_clips)_clips=[].slice.call(document.querySelectorAll('.clip'));var t=curT();for(var i=0;i<_clips.length;i++){var el=_clips[i],s=parseFloat(el.dataset.start)||0,d=parseFloat(el.dataset.duration)||DUR,on=t>=s&&t<(s+d);if(on!==el._nvOn){el._nvOn=on;el.style.display=on?'block':'none';}}requestAnimationFrame(_tick);}
  requestAnimationFrame(_tick);
  setInterval(function(){var anims=document.getAnimations?document.getAnimations():[];if(window._PAUSED!==_paused){_paused=window._PAUSED;if(_paused){_pausedAt=rawT()%DUR;anims.forEach(function(a){try{a.pause();}catch(e){}});}else{start=performance.now()-_pausedAt*1000;anims.forEach(function(a){try{a.play();}catch(e){}});}}},60);
  window.addEventListener('message',function(e){if(!e||!e.data)return;var r=document.documentElement;if(e.data.__nv_acc)r.style.setProperty('--acc',e.data.__nv_acc);if(e.data.__nv_bg)r.style.setProperty('--bg',e.data.__nv_bg);if(e.data.__nv_fg)r.style.setProperty('--fg',e.data.__nv_fg);if(e.data.__nv_restart){start=performance.now();_paused=false;window._PAUSED=false;_pausedAt=0;_clips=null;document.getAnimations&&document.getAnimations().forEach(function(a){try{a.cancel();a.play();}catch(e){}});}});
})()`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Inter Tight',system-ui,sans-serif;}
:root{--bg:#111118;--fg:#f1f5f9;--acc:#6d4cff;}
body{position:relative;background:var(--bg);color:var(--fg);}
.clip{position:absolute;inset:0;display:none;overflow:hidden;}
.sub{position:absolute;bottom:0;left:0;right:0;padding:${subPad}px ${subW}px;background:linear-gradient(transparent,rgba(0,0,0,0.65));font-size:${subFs}px;color:#fff;font-weight:500;text-align:center;}
</style>
</head>
<body>
<div class="clip" data-start="0" data-duration="${duration}" id="scene-main">
${snippet}
</div>
<script>
${playbackJs}
</script>
</body>
</html>`;
}

function buildVideoPrompt(fmt: Format, duration: number, agentBias?: string): string {
  const W = fmt.w;
  const H = fmt.h;

  const sceneCount = duration <= 12 ? 2 : duration <= 22 ? 3 : duration <= 38 ? 4 : duration <= 52 ? 5 : 6;

  const fsHero = Math.round(H * 0.09);
  const fsSub  = Math.round(H * 0.04);
  const fsStat = Math.round(H * 0.13);
  const fsBody = Math.round(H * 0.028);
  const fsCta  = Math.round(H * 0.038);
  const subPad = Math.round(H * 0.015);
  const subW   = Math.round(W * 0.05);
  const subFs  = Math.round(H * 0.025);

  // Playback + clip-runtime block (AI copies verbatim into their HTML)
  const playbackJs = `(function(){
  var DUR=${duration},start=performance.now(),_paused=false,_pausedAt=0;
  window._PAUSED=false;
  function rawT(){return(performance.now()-start)/1000;}
  function curT(){return _paused?_pausedAt:rawT()%DUR;}
  Object.defineProperty(window,'_T',{get:curT,set:function(v){start=performance.now()-v*1000;_pausedAt=v;}});
  // Clip visibility runtime: reads data-start/data-duration on every .clip element
  var _clips=null;
  function _tick(){
    if(!_clips)_clips=[].slice.call(document.querySelectorAll('.clip'));
    var t=curT();
    for(var i=0;i<_clips.length;i++){
      var el=_clips[i],s=parseFloat(el.dataset.start)||0,d=parseFloat(el.dataset.duration)||DUR,on=t>=s&&t<(s+d);
      if(on!==el._nvOn){el._nvOn=on;el.style.display=on?'block':'none';}
    }
    requestAnimationFrame(_tick);
  }
  requestAnimationFrame(_tick);
  setInterval(function(){
    var anims=document.getAnimations?document.getAnimations():[];
    if(window._PAUSED!==_paused){
      _paused=window._PAUSED;
      if(_paused){_pausedAt=rawT()%DUR;anims.forEach(function(a){try{a.pause();}catch(e){}});}
      else{start=performance.now()-_pausedAt*1000;anims.forEach(function(a){try{a.play();}catch(e){}});}
    }
  },60);
  window.addEventListener('message',function(e){
    if(!e||!e.data)return;
    var r=document.documentElement;
    if(e.data.__nv_acc)r.style.setProperty('--acc',e.data.__nv_acc);
    if(e.data.__nv_bg)r.style.setProperty('--bg',e.data.__nv_bg);
    if(e.data.__nv_fg)r.style.setProperty('--fg',e.data.__nv_fg);
    if(e.data.__nv_restart){start=performance.now();_paused=false;window._PAUSED=false;_pausedAt=0;_clips=null;document.getAnimations&&document.getAnimations().forEach(function(a){try{a.cancel();a.play();}catch(e){}});}
  });
})()`;

  return `You are a professional motion designer and frontend developer. Create a stunning, polished animated marketing video as a single self-contained HTML file.
${agentBias ? `\nDIRECTION: ${agentBias}\n` : ''}
VIEWPORT: ${W}x${H}px fixed · ${duration}s loop · Fonts: Inter Tight + JetBrains Mono (Google Fonts)

━━━ STEP 1: PLAN BEFORE WRITING ━━━
Read the entire user message. Extract every specific name, number, feature, and fact — use them, do not invent.
Decide:
  A) VIDEO TYPE — Product launch / Brand story / Data reveal / Tutorial / Announcement
  B) SCENE PLAN — ${sceneCount} scenes. For each: name, job (one sentence), duration in seconds. Durations must sum to ${duration}.
  C) VISUAL STYLE — dark glassmorphism / clean minimal / bold gradient / editorial. Derived from content emotion.
  D) COLOR TRIO — --bg / --fg / --acc. Derived from brand or content feel. DO NOT default to purple.
  E) SCENE VISUALS — plan the PROP or OBJECT for each scene BEFORE writing code.
     Each scene = 1 big visual prop that fills 50-60% of the viewport. Text is secondary.
     PICK ONE PROP PER SCENE:
     - Laptop/phone mockup built from CSS divs with a glowing screen
     - Animated bar chart (5-8 bars, CSS height animation, labelled)
     - Ring/donut chart (SVG circle with stroke-dasharray animation)
     - 3-stat card grid (each card: big mono number + label)
     - Feature icon grid (icon box + label, 2-3 columns, SVG icons)
     - Waveform / audio bars (20 thin divs animating height)
     - Network diagram (SVG nodes + lines, nodes glow)
     - Progress timeline (horizontal steps, animated fill)
     - Code terminal mockup (dark card, monospace fake code lines)
     - Abstract shape / logo mark built from CSS border-radius + rotate

━━━ STEP 2: SCENE STRUCTURE (data-start / data-duration) ━━━
Each scene is a <div class="clip"> with data-start and data-duration in whole seconds.
The built-in runtime auto-shows/hides scenes — you write ZERO keyframe math for scene visibility.

TIMING EXAMPLE for a 30s/4-scene video:
  <div class="clip" data-start="0"  data-duration="7"  id="scene-hook">      <!-- 0s → 7s -->
  <div class="clip" data-start="7"  data-duration="10" id="scene-features">  <!-- 7s → 17s -->
  <div class="clip" data-start="17" data-duration="8"  id="scene-proof">     <!-- 17s → 25s -->
  <div class="clip" data-start="25" data-duration="5"  id="scene-cta">       <!-- 25s → 30s -->

For YOUR ${duration}s video with ${sceneCount} scenes: choose your own durations — they must SUM to exactly ${duration}.
CRITICAL: last clip's data-start + data-duration = ${duration}. No gaps. No overlaps.
.clip is already set to { position:absolute; inset:0; display:none; overflow:hidden } in CSS — do not add display:block.

Layer content inside each clip — ALWAYS this structure:
  1. BG div:     <div style="position:absolute;inset:0;z-index:0;">  ← gradient/texture
  2. Visual div: <div style="position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;">  ← your prop
  3. Text div:   <div style="position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8% 10%;gap:3%;">  ← headline only
  4. Sub div:    <div class="sub">  ← caption, bottom

CENTERING RULE (the #1 cause of text in corners):
Every content div MUST use display:flex + align-items:center + justify-content:center.
NEVER position text with top/left pixel offsets. NEVER put text in a position:absolute div without flex centering.

CORRECT — text always centered:
  <div style="position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8% 10%;gap:3%;">
    <h1 style="font-size:${fsHero}px;...">Headline</h1>
    <p style="font-size:${fsSub}px;...">One short line</p>
  </div>
WRONG — causes corner text:
  <div style="position:absolute;top:80px;left:60px;"><h1>Text</h1></div>

SIZE RULE (prevents elements overflowing the ${W}×${H}px viewport):
  - All visual elements: max-width:${Math.round(W*0.84)}px; max-height:${Math.round(H*0.54)}px; overflow:hidden
  - Icon/card rows: flex-wrap:wrap; justify-content:center; max-width:${Math.round(W*0.84)}px
  - Individual cards in a 3-col grid: max-width:${Math.round(W*0.26)}px
  - SVG elements: width/height ≤ ${Math.round(Math.min(W,H)*0.24)}px
  - Headline text: max-width:${Math.round(W*0.82)}px; word-break:break-word

━━━ STEP 3: WITHIN-CLIP ANIMATIONS ━━━
CSS animations inside each clip play from 0s when the clip becomes visible.
When the video loops, the runtime toggles display:none→block, restarting all animations. Design for this.
Use animation-fill-mode:both. Use animation-delay for stagger (0.1s / 0.25s / 0.4s / 0.6s).

Standard keyframes (define once in <style>):
  @keyframes fadeUp   { from{opacity:0;transform:translateY(44px)}  to{opacity:1;transform:translateY(0)} }
  @keyframes fadeDown { from{opacity:0;transform:translateY(-44px)} to{opacity:1;transform:translateY(0)} }
  @keyframes scaleIn  { from{opacity:0;transform:scale(0.7)}        to{opacity:1;transform:scale(1)} }
  @keyframes slideInL { from{opacity:0;transform:translateX(-56px)} to{opacity:1;transform:translateX(0)} }
  @keyframes slideInR { from{opacity:0;transform:translateX(56px)}  to{opacity:1;transform:translateX(0)} }
  @keyframes blurIn   { from{opacity:0;filter:blur(20px)}           to{opacity:1;filter:blur(0)} }
  @keyframes clipIn   { from{opacity:0}                             to{opacity:1} }
  @keyframes float    { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-14px)} }
  @keyframes pulse    { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 55%,transparent)} 50%{box-shadow:0 0 0 22px transparent} }
  @keyframes fillBar  { from{width:0} to{width:var(--pct,80%)} }
  @keyframes spinIn   { from{opacity:0;transform:rotate(-90deg) scale(0.5)} to{opacity:1;transform:rotate(0) scale(1)} }

Clip entrance (add to the clip div's CSS):
  #scene-hook { animation: clipIn 0.5s ease-out both; }

Element stagger example:
  #scene-hook .headline { animation: fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
  #scene-hook .subtext  { animation: fadeUp 0.7s cubic-bezier(0.16,1,0.3,1) 0.3s both; }
  #scene-hook .visual   { animation: scaleIn 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.5s both; }
  #scene-hook .cta      { animation: fadeUp 0.5s ease-out 0.7s both, pulse 2s ease 1.4s infinite; }

━━━ STEP 4: COLORS + TYPOGRAPHY ━━━
:root { --bg: #YOUR; --fg: #YOUR; --acc: #YOUR; }
Accent palette: violet #6d4cff · orange #f97316 · emerald #10b981 · sky #0ea5e9 · rose #f43f5e · amber #f59e0b · pink #ec4899 · lime #84cc16
Use var(--bg)/var(--fg)/var(--acc) EVERYWHERE — never hardcode hex in element styles.

Sizes:
  Hero:  font-size:${fsHero}px; font-weight:900; letter-spacing:-0.04em; line-height:0.95; color:var(--fg);
  Sub:   font-size:${fsSub}px;  font-weight:600; opacity:0.8;
  Stats: font-family:'JetBrains Mono',monospace; font-size:${fsStat}px; font-weight:700; color:var(--acc);
  Body:  font-size:${fsBody}px; font-weight:400; opacity:0.7;
  CTA:   font-size:${fsCta}px;  font-weight:700; background:var(--acc); color:#fff; border-radius:100px; padding:18px 48px;

━━━ STEP 5: VISUAL PROPS TOOLKIT (use these — text alone = rejected) ━━━
TEXT BUDGET: max 1 headline + 1 short subline per scene. The remaining 60% of the scene is a VISUAL PROP.
If a scene has more than 2 lines of text and no visual prop, redesign it.
Dark atmospheric BG:
  background: radial-gradient(ellipse 80% 60% at 30% 20%, color-mix(in srgb,var(--acc) 22%,transparent), transparent 60%), var(--bg);

Noise overlay (subtle texture):
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  background-size: 200px 200px;

Dot grid:
  background-image: radial-gradient(circle, color-mix(in srgb,var(--fg) 20%,transparent) 1px, transparent 1px);
  background-size: 40px 40px;

Glass card:
  background:rgba(255,255,255,0.06); backdrop-filter:blur(16px); border:1px solid rgba(255,255,255,0.1); border-radius:24px; box-shadow:0 0 60px color-mix(in srgb,var(--acc) 12%,transparent);

Light card:
  background:#fff; border-radius:20px; box-shadow:0 8px 40px rgba(0,0,0,0.09);

Metric card (3 in a row for data scenes):
  .metric { display:flex; flex-direction:column; align-items:center; gap:8px; padding:32px 24px; }
  .metric .num  { font-family:'JetBrains Mono',monospace; font-size:${fsStat}px; font-weight:700; color:var(--acc); }
  .metric .label { font-size:${fsBody}px; opacity:0.6; text-align:center; }

DESIGN YOUR OWN VISUAL PROP for each scene — do not copy these verbatim. Adapt every prop to the actual content.
Every prop container: position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
All props: max-width:${Math.round(W*0.84)}px; max-height:${Math.round(H*0.54)}px; overflow:hidden.

PROP MENU — pick the best fit, invent freely beyond this list:

1. DEVICE FRAME (product/app scene)
   Outer shell = dark rounded div + deep box-shadow. Inner screen = darker div with real mini-UI.
   Laptop: ~55% W wide. Phone: ~18% W wide × 33% W tall. Add radial glow behind device.
   Screen content = simplified UI mockup, not placeholder text.

2. STAT CARD GRID (metrics/proof scene)
   3 glass cards in a flex row, gap:2% W, each flex:1 min-width:0.
   Card: rounded-20px glass bg, big JetBrains Mono number (data-suffix attr) + short label.
   Use countUp() JS to animate numbers from 0 when the scene appears.

3. FEATURE ICON GRID (features/benefits scene)
   2-3 column flex grid of icon boxes. Each box: 64×64 rounded square, accent-tinted bg.
   Real SVG icon inside (28px, stroke style — Heroicons/Lucide paths you know exactly).
   Feature name below icon in body font. Stagger animate-in with 0.1s delays.

4. VERTICAL BAR CHART (data/growth scene)
   Flex row, align-items:flex-end, height:${Math.round(H*0.3)}px, max-width:${Math.round(W*0.65)}px.
   5-7 bars, each flex:1, height controlled by CSS var --h (15%-90%).
   @keyframes growBar{from{height:0}to{height:var(--h)}} — stagger delays.
   Real labels below each bar.

5. DONUT / RING CHART (progress/completion/stat scene)
   SVG, size ~${Math.round(Math.min(W,H)*0.22)}px. Track = low-opacity circle. Progress = accent stroke.
   @keyframes dashIn{from{stroke-dasharray:0 290}to{stroke-dasharray:230 60}}
   Center text = the actual stat/percentage. Outer label ring if needed.

6. WAVEFORM / AUDIO BARS (energy/signal/activity scene)
   20-24 thin divs (width:5px, border-radius:3px, accent color), flex row, align-items:center.
   @keyframes waveBar{from{height:8px}to{height:${Math.round(H*0.1)}px}}
   Stagger animation-delay 0.06s each. Alternate infinite. Some bars tall, some short.

7. TIMELINE / STEPS (process/workflow scene)
   Flex row: numbered circle → line → numbered circle → line → ...
   Active steps = accent bg. Pending = low opacity bg. Lines animate width with fillBar.
   Label below each step node. Max-width:${Math.round(W*0.78)}px.

8. NETWORK GRAPH (integrations/connections scene)
   SVG. 5-7 circle nodes scattered by absolute position or SVG coordinates.
   Lines between nodes = stroke, 0.2 opacity. Central node = accent + glow filter.
   Outer nodes scaleIn with stagger. Lines animate stroke-dashoffset.

9. CODE TERMINAL (developer/API/tech scene)
   Dark card, radius:16px. Top row: 3 colored circles (red/yellow/green).
   Below: monospace lines with syntax coloring — actual relevant code/command from the content.
   Cursor blink at end. Card glow = accent color-mix.

10. ABSTRACT / BRAND MARK (opening/brand scene)
    Geometric CSS shapes built from border, border-radius, rotate, clip-path.
    Must REPRESENT the brand concept visually — not random shapes.
    Animate: float + slow rotate. Layer 2-3 shapes for depth.

11. LINE CHART (trend/growth scene)
    SVG polyline. @keyframes drawLine{from{stroke-dashoffset:500}to{stroke-dashoffset:0}}
    Gradient fill below line using linearGradient. Dots at data points with scaleIn delay.
    X-axis labels at bottom. Y-axis faint grid lines.

12. CIRCULAR PROGRESS RINGS (multi-metric scene)
    3 concentric SVG rings, each a different metric. Different radii, stroke widths, accent variants.
    Each ring animates dashIn independently with offset delays.

Count-up JS (always include if you use numbers):
  function countUp(el,to,ms){var from=0,s=Date.now(),suf=el.dataset.suffix||'';function f(){var p=Math.min((Date.now()-s)/ms,1),e=1-Math.pow(1-p,3);el.textContent=Math.round(from+(to-from)*e)+suf;if(p<1)requestAnimationFrame(f);}requestAnimationFrame(f);}
  // Trigger once per scene appearance:
  document.getElementById('scene-stats').addEventListener('animationstart',function(ev){if(ev.animationName!=='clipIn')return;countUp(document.getElementById('myNum'),2500000,1800);},{once:false});

SVG icons: always fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round". Color via CSS color:var(--acc).
Only use Heroicons/Lucide SVG paths you know with certainty — never guess or approximate a path.

Subtitle bar (REQUIRED on every clip — write real voice-over copy from the content):
  <div class="sub">Your actual caption text here</div>
  .sub { position:absolute; bottom:0; left:0; right:0; padding:${subPad}px ${subW}px; background:linear-gradient(transparent,rgba(0,0,0,0.65)); font-size:${subFs}px; color:#fff; font-weight:500; text-align:center; line-height:1.4; }

━━━ MANDATORY OUTPUT FORMAT ━━━
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Inter Tight',system-ui,sans-serif;}
:root{--bg:#111118;--fg:#f1f5f9;--acc:#6d4cff;}  /* ← OVERRIDE — derive from content */
body{position:relative;background:var(--bg);color:var(--fg);}
.clip{position:absolute;inset:0;display:none;overflow:hidden;}
.sub{position:absolute;bottom:0;left:0;right:0;padding:${subPad}px ${subW}px;background:linear-gradient(transparent,rgba(0,0,0,0.65));font-size:${subFs}px;color:#fff;font-weight:500;text-align:center;line-height:1.4;}
/* ─── @keyframes ─────────────────────────────────────────── */
@keyframes fadeUp   { from{opacity:0;transform:translateY(44px)}  to{opacity:1;transform:translateY(0)} }
@keyframes scaleIn  { from{opacity:0;transform:scale(0.7)}        to{opacity:1;transform:scale(1)} }
@keyframes slideInL { from{opacity:0;transform:translateX(-56px)} to{opacity:1;transform:translateX(0)} }
@keyframes blurIn   { from{opacity:0;filter:blur(20px)}           to{opacity:1;filter:blur(0)} }
@keyframes clipIn   { from{opacity:0}                             to{opacity:1} }
@keyframes float    { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-14px)} }
@keyframes pulse    { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 55%,transparent)} 50%{box-shadow:0 0 0 22px transparent} }
@keyframes fillBar  { from{width:0} to{width:var(--pct,80%)} }
/* ─── YOUR SCENE-SPECIFIC STYLES BELOW ──────────────────── */
</style>
</head>
<body>

<div class="clip" data-start="0" data-duration="X" id="scene-hook">
  <div style="position:absolute;inset:0;z-index:0;"><!-- background --></div>
  <div style="position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;">
    <!-- visual + text -->
  </div>
  <div class="sub">Caption text</div>
</div>

<!-- more .clip divs... -->

<script>
// ── PLAYBACK + CLIP RUNTIME (copy verbatim — do NOT modify) ──
${playbackJs}
// ─────────────────────────────────────────────────────────────
// YOUR JS below:
</script>
</body>
</html>

━━━ NON-NEGOTIABLE RULES ━━━
1. Output ONLY raw HTML — starts with <!DOCTYPE html>. Zero markdown, zero explanation.
2. Copy the PLAYBACK + CLIP RUNTIME block VERBATIM between the comment markers. Never alter it.
3. Override :root { --bg, --fg, --acc } with content-derived colors. NEVER default to #6d4cff purple.
4. Use var(--bg)/var(--fg)/var(--acc) everywhere — no hardcoded hex in element styles, ever.
5. Every .clip MUST contain a .sub element with real voice-over text derived from the content.
6. All visible text comes from user content — no placeholders, no "Lorem ipsum", no generic labels.
7. html,body must stay width:${W}px; height:${H}px; overflow:hidden.
8. No emojis in text. Use inline SVG paths for any icon/symbol.
9. Scene times: last clip's data-start + data-duration = ${duration}. No gaps. No overlaps.
10. Every scene must have a distinct visual prop — no two scenes with the same layout.
11. TEXT BUDGET: max 1 headline + 1 subline per scene. If you have a third text line, cut it and make it a visual prop instead.
12. CENTERING: all content divs use display:flex + align-items:center + justify-content:center. NEVER top/left pixel offsets for text.
13. SIZE BOUNDS: no element wider than ${Math.round(W*0.9)}px or taller than ${Math.round(H*0.7)}px. Use max-width/max-height on every visual prop.
14. OVERFLOW: every .clip has overflow:hidden — but also add overflow:hidden on any inner container with dynamic content to be safe.`;
}

function buildScreenPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  const W = fmt.w;
  const H = fmt.h;
  return `You are an expert UI designer. Create a pixel-perfect ${fmt.label} UI mockup (${W}×${H}px).
${context ? `\nBrand/product context (use for copy, colors, and data):\n${context}\n` : ''}
Purpose: ${desc}
Style: ${styleName}

━━━ LAYOUT CONSTRAINTS (non-negotiable) ━━━
- Root wrapper: width:${W}px; height:${H}px; overflow:hidden; position:relative — this is the hard boundary.
- html, body: width:${W}px; height:${H}px; overflow:hidden; margin:0; padding:0.
- ALL content must fit within ${W}×${H}px. Nothing may overflow or require scrolling.
- Use flex/grid layouts within the fixed wrapper — do NOT use position:absolute for content unless layering decorative elements.
- If the design has a sidebar + main area: sidebar width must be a fixed px value, main area uses flex:1 with overflow:hidden.
- Text elements: overflow:hidden; text-overflow:ellipsis or word-break:break-word. Never let text push layout past the boundary.
- If the design has a scrollable list/feed: the scroll container must have a fixed height and overflow-y:auto — outer wrapper still clips.
${context ? '- If brand colors are specified in the context above, use them. Otherwise derive from style direction.' : ''}

━━━ QUALITY RULES ━━━
- Import Inter Tight or Sora via Google Fonts @import in <style>
- Hover states + subtle CSS transitions on interactive elements
- NO JavaScript unless essential for a toggle/tab interaction
- Real copy only — derive every label, stat, and name from context. No "Lorem ipsum."
- Rich UI: proper nav/header, sidebar or top tabs, cards with real data, status badges, avatar initials

Output ONLY the complete HTML starting with <!DOCTYPE html>. No markdown fences.`;
}

function buildBannerPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  const W = fmt.w;
  const H = fmt.h;
  const sidePad  = Math.round(W * 0.08);
  const topPad   = Math.round(H * 0.06);
  const usableW  = W - 2 * sidePad;
  const cx       = Math.round(W / 2);
  const cxL      = sidePad;                     // left-aligned start

  // Exact zone boundaries — no ranges, no overlap
  const z1top = topPad;
  const z1h   = Math.round(H * 0.13);
  const z2top = z1top + z1h;
  const z2h   = Math.round(H * 0.28);
  const z3top = z2top + z2h;
  const z3h   = Math.round(H * 0.21);
  const z4top = z3top + z3h;
  const z4h   = H - z4top - topPad;

  type StyleKey = 'minimal' | 'bold' | 'dark' | 'vibrant' | 'corporate' | 'editorial';
  const styleId = (styleName.split(' — ')[0].trim().toLowerCase()) as StyleKey;
  const styleVars: Record<StyleKey, string> = {
    minimal:   '--bg:#ffffff;--bg2:#f0eeff;--text:#111111;--muted:#666666;--accent:#6d4cff;--accent2:#a78bfa;--surface:#f5f4ff;--card:rgba(109,76,255,0.06)',
    bold:      '--bg:#0a0a0a;--bg2:#111111;--text:#ffffff;--muted:#999999;--accent:#ffffff;--accent2:#e0e0e0;--surface:#1c1c1c;--card:rgba(255,255,255,0.05)',
    dark:      '--bg:#0c0b14;--bg2:#130f2a;--text:#ffffff;--muted:#a78bfa;--accent:#6d4cff;--accent2:#a78bfa;--surface:rgba(255,255,255,0.06);--card:rgba(109,76,255,0.15)',
    vibrant:   '--bg:#5b21b6;--bg2:#6d28d9;--text:#ffffff;--muted:#ddd6fe;--accent:#fbbf24;--accent2:#fb923c;--surface:rgba(255,255,255,0.12);--card:rgba(255,255,255,0.08)',
    corporate: '--bg:#0f2744;--bg2:#1a3a5c;--text:#ffffff;--muted:#93c5fd;--accent:#3b82f6;--accent2:#60a5fa;--surface:rgba(255,255,255,0.06);--card:rgba(59,130,246,0.15)',
    editorial: '--bg:#f7f5f1;--bg2:#eeece8;--text:#0f0f0f;--muted:#555555;--accent:#dc2626;--accent2:#1a1a1a;--surface:#e8e6e2;--card:rgba(0,0,0,0.04)',
  };
  const vars = styleVars[styleId] ?? styleVars.dark;

  const headlineSz = Math.round(Math.min(H, W) * 0.095);
  const tagSz      = Math.round(Math.min(H, W) * 0.030);
  const bodySz     = Math.round(Math.min(H, W) * 0.040);
  const ctaSz      = Math.round(Math.min(H, W) * 0.036);
  const ctaBtnH    = Math.round(Math.min(z4h * 0.55, 64));
  const ctaBtnW    = Math.round(Math.min(usableW * 0.55, 320));

  return `You are an elite creative director and front-end engineer. Create a ${fmt.label} graphic (${W}×${H}px) — scroll-stopping, publication-quality, social-media-ready.

${context ? `━━━ BRAND BRIEF ━━━\n${context}\n━━━━━━━━━━━━━━━━━\n` : ''}VISUAL INTENT: ${desc}
STYLE: ${styleName}
CANVAS: ${W}×${H}px

━━━ COLOR SYSTEM ━━━
${context ? 'If the brand brief above mentions specific colors (hex codes, color names, brand palette), use those as --accent, --bg, --text instead of the style defaults.' : ''}
Style palette (use unless overridden by brand colors above):
:root { ${vars} }

━━━ EXACT ZONE BOUNDARIES — ABSOLUTE PIXEL VALUES ━━━
Zone 1 — Brand/Badge:  top:${z1top}px  height:${z1h}px   (logo, eyebrow label, badge — small)
Zone 2 — Headline:     top:${z2top}px  height:${z2h}px   (DOMINANT text — must fill this zone)
Zone 3 — Supporting:   top:${z3top}px  height:${z3h}px   (subtitle, features, social proof)
Zone 4 — CTA:          top:${z4top}px  height:${z4h}px   (button, price, handle)
Horizontal: left safe edge = ${cxL}px | usable width = ${usableW}px | center = ${cx}px

━━━ MANDATORY TEMPLATE — fill in your content, do NOT change the zone wrapper structure ━━━
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;600;700;800;900&family=Space+Grotesk:wght@400;500;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;font-family:'Inter Tight',system-ui,sans-serif}
:root{${vars}}
.canvas{position:relative;width:${W}px;height:${H}px;background:var(--bg);overflow:hidden}
.zone{position:absolute;left:${cxL}px;width:${usableW}px;overflow:hidden;display:flex;align-items:center}
.zone-bg{position:absolute;inset:0;pointer-events:none;overflow:hidden}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes scaleIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
/* stagger: add animation-delay 0s / 0.15s / 0.30s / 0.45s to each zone */

/* ── YOUR CSS BELOW ── */
</style>
</head>
<body>
<div class="canvas">

  <!-- BACKGROUND (z-index:0) — rich gradient + at least one geometric shape, spans full canvas -->
  <div class="zone-bg"><!-- background SVG/divs here --></div>

  <!-- ZONE 1: Brand/Badge — top:${z1top}px height:${z1h}px -->
  <div class="zone" style="top:${z1top}px;height:${z1h}px;animation:fadeIn 0.4s both 0s">
    <!-- logo text or badge — font-size:${tagSz}px font-weight:700 text-transform:uppercase letter-spacing:0.15em -->
  </div>

  <!-- ZONE 2: Headline — top:${z2top}px height:${z2h}px -->
  <div class="zone" style="top:${z2top}px;height:${z2h}px;align-items:flex-start;flex-direction:column;animation:fadeUp 0.55s both 0.1s">
    <!-- main headline — font-size:${headlineSz}px font-weight:900 line-height:1.05 color:var(--text) word-break:break-word -->
  </div>

  <!-- ZONE 3: Supporting — top:${z3top}px height:${z3h}px -->
  <div class="zone" style="top:${z3top}px;height:${z3h}px;align-items:flex-start;flex-direction:column;gap:8px;animation:fadeUp 0.55s both 0.25s">
    <!-- subtitle font-size:${bodySz}px / feature pills / social proof — color:var(--muted) -->
  </div>

  <!-- ZONE 4: CTA — top:${z4top}px height:${z4h}px -->
  <div class="zone" style="top:${z4top}px;height:${z4h}px;animation:scaleIn 0.45s both 0.4s">
    <!-- CTA button: width:${ctaBtnW}px height:${ctaBtnH}px border-radius:${Math.round(ctaBtnH/2)}px background:var(--accent) color:#fff font-size:${ctaSz}px font-weight:700 -->
  </div>

</div>
</body>
</html>

━━━ NON-NEGOTIABLE RULES ━━━
1. NEVER move, remove, or resize the zone wrapper divs. Fill their interiors only.
2. ZONE OVERFLOW IS CLIPPED — if your content is taller than the zone height, it will be cut. Size content to fit.
3. All content elements inside a zone: position:relative (NOT absolute) so they stack naturally within the flex zone. Exception: purely decorative background elements use position:absolute within .zone-bg only.
4. BACKGROUND IS MANDATORY — must have gradient + at least one geometric shape (circle, diagonal band, SVG blob, dot grid). Flat color alone fails.
5. HEADLINE DOMINANT — font-size ${headlineSz}px minimum, font-weight 900, fills Zone 2 visually.
6. REAL COPY ONLY — every word derived from the brief. Zero placeholder text.
7. MAX WIDTH — no element inside a zone may exceed ${usableW}px wide. Text: word-break:break-word; white-space:normal.
8. COLORS — var(--accent) on CTA background, var(--text) on headline, var(--muted) on supporting copy. If brand colors were in the brief, override :root vars at the top of <style>.

Output ONLY the filled complete HTML starting with <!DOCTYPE html>. No markdown, no explanation.`;
}

function buildComponentPrompt(fmt: Format, desc: string, styleName: string, context: string): string {
  const W = fmt.w;
  const H = fmt.h;
  return `You are a senior UI engineer. Build a polished, production-ready interactive UI component.
${context ? `\nProduct context (use for real copy, data, and brand colors):\n${context}\n` : ''}
Component: ${desc}
Style: ${styleName}
Viewport: ${W}×${H}px

━━━ LAYOUT CONSTRAINTS ━━━
- html, body: width:${W}px; height:${H}px; overflow:hidden; margin:0; padding:0; display:flex; align-items:center; justify-content:center.
- The component must be centered and must fit within ${W}×${H}px — no scrollbars, no overflow.
- Component max-width: ${Math.round(W * 0.92)}px. Component max-height: ${Math.round(H * 0.92)}px.
- If the component has an internal list/feed: give it a fixed max-height with overflow-y:auto.
- Text: word-break:break-word; overflow:hidden on all text containers.
${context ? '- If brand colors are in the context, use them for CSS custom properties.' : ''}

━━━ QUALITY RULES ━━━
- CSS custom properties for all colors: --bg, --text, --accent, --muted, --surface
- Smooth transitions and micro-animations on every interactive element
- Fully functional: buttons respond, toggles toggle, inputs accept text
- No Lorem ipsum — realistic content from context

Output ONLY the complete HTML starting with <!DOCTYPE html>. No markdown fences.`;
}

// Extract everything from the YOUR SCENE CODE marker to the closing </script>
function extractSceneSection(html: string): string {
  const marker = '// ── YOUR SCENE CODE';
  const start = html.indexOf(marker);
  if (start === -1) return '';
  const end = html.lastIndexOf('</script>');
  return end === -1 ? html.slice(start).trim() : html.slice(start, end).trim();
}


function buildRefinePrompt(currentHtml: string, instruction: string, _isVideo = false): string {
  return `Current HTML:\n\`\`\`html\n${currentHtml.slice(0, 20000)}\n\`\`\`\n\nInstruction: "${instruction}"\n\nReturn the COMPLETE updated HTML starting with <!DOCTYPE html>. Keep everything not mentioned unchanged.`;
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
    'Product launch — dark bg, glowing orb expands, brand name bounces in at 72px, three feature lines stagger up left-to-right, icon+label pairs fade in with 0.2s stagger, CTA button pulses with soft glow',
    'Pain-to-solution — opening scene shows frustrated user (red tint, glitch text), scene 2 brand name cuts in clean (purple accent, smooth), scene 3 three benefits count up, CTA fades in with ripple',
    'Metric reveal — black bg, three stat cards slide up (10×, 99%, 2M+), numbers count up with JetBrains Mono, tagline staggered in below, minimal corporate feel',
  ],
  screen: [
    'Analytics dashboard — dark theme, sidebar nav, KPI cards row, line chart, recent activity table',
    'Mobile app onboarding — step 1 of 3, hero illustration area, headline, subtext, progress dots, Next CTA',
    'SaaS landing page hero — large headline, subtext, two CTA buttons, floating device mockup',
  ],
  banner: [
    'Instagram post: product launch announcement — bold gradient bg, large headline, app screenshot, brand CTA',
    'LinkedIn post: new feature announcement — professional clean layout, icon accent, brand colors',
    'YouTube thumbnail: dark bg, bold contrasting title text, accent highlight strip, high-contrast visual',
  ],
  component: [
    'Glassmorphism pricing card with monthly/yearly toggle, feature list, highlighted CTA button',
    'Toast notification system — success/error/warning/info variants, smooth slide-in animation',
    'Data table with sortable columns, search input, pagination, row hover effects',
  ],
};

const REFINE_SUGGESTIONS: Record<ProjectType, string[]> = {
  video: [
    'Make the headline bigger and bolder with more impact',
    'Add word-by-word text reveal on the hero title',
    'Make the background more dramatic — deeper glow, darker',
    'Add more particles and ambient motion',
    'Make the CTA section more impactful with a ring pulse',
  ],
  screen: [
    'Make it darker with glassmorphism panels and blur',
    'Add hover animations to all interactive elements',
    'Increase spacing and make it more airy',
    'Change the primary color to emerald green',
  ],
  banner: [
    'Make the headline much larger and more dominant',
    'Add a diagonal color band across the background',
    'Strip it down — more minimal, fewer elements',
    'Make the CTA button pop more',
  ],
  component: [
    'Add a smooth entrance animation on mount',
    'Make it glassmorphism style with blur',
    'Increase contrast and make it bolder',
    'Add keyboard navigation support',
  ],
};

function getStreamPhase(raw: string, projectType: ProjectType): string {
  const len = raw.length;
  if (projectType === 'video') {
    if (len === 0) return 'Thinking…';
    if (raw.includes('</html>') || len > 7000) return 'Finalizing…';
    if (raw.includes('<script')) return 'Adding playback engine…';
    if (raw.includes('data-start') || raw.includes('class="clip"')) return 'Building scenes…';
    if (raw.includes('@keyframes') || raw.includes('animation:')) return 'Writing animations…';
    if (raw.includes('<style')) return 'Styling visuals…';
    if (raw.includes('<!DOCTYPE') || raw.includes('<html')) return 'Generating HTML…';
    return 'Planning scenes…';
  }
  if (raw.includes('</html>') || len > 6000) return 'Finalizing…';
  if (raw.includes('<body') || raw.includes('<main')) return 'Building layout…';
  if (raw.includes('<style') || raw.includes('animation')) return 'Styling…';
  if (raw.includes('<!DOCTYPE')) return 'Generating…';
  return 'Writing…';
}

// ─── Main component ───────────────────────────────────────────────────────────

interface StudioModuleProps {
  initialRequest?: { prompt: string; formatId: string; duration: number; context: string } | null;
  onRequestConsumed?: () => void;
}

export default function StudioModule({ initialRequest, onRequestConsumed }: StudioModuleProps = {}) {
  const { session } = useAuth();
  const callIdRef  = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef  = useRef<HTMLIFrameElement>(null);

  const [type,           setType]           = useState<ProjectType>('video');
  const [format,         setFormat]         = useState<Format>(FORMATS.video[0]);
  const [duration,       setDuration]       = useState(15);
  const [style,          setStyle]          = useState(STYLES[0].id);
  const [prompt,         setPrompt]         = useState('');
  const [generating,     setGenerating]     = useState(false);
  const [html,           setHtml]           = useState<string | null>(null);
  const [error,          setError]          = useState<string | null>(null);
  const [history,        setHistory]        = useState<HistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem('studio_history');
      return saved ? (JSON.parse(saved) as HistoryEntry[]) : [];
    } catch { return []; }
  });
  const [copied,         setCopied]         = useState(false);
  const [streamLog,      setStreamLog]      = useState('');
  const [showCode,       setShowCode]       = useState(false);
  const [editedHtml,     setEditedHtml]     = useState('');
  const [connMode,       setConnMode]       = useState<string>('');
  const [contextFile,    setContextFile]    = useState<{ name: string; content: string } | null>(null);
  const [showContext,    setShowContext]     = useState(false);
  const [activeAgent,    setActiveAgent]    = useState<StudioAgent | null>(null);
  const [briefing,       setBriefing]       = useState(false);
  const [rightTab,       setRightTab]       = useState<'prompt' | 'reviews'>('prompt');
  const [reviews,        setReviews]        = useState<Record<string, ReviewResult>>({});
  const [reviewing,      setReviewing]      = useState(false);
  const [recording,      setRecording]      = useState(false);
  const [recordSecs,     setRecordSecs]     = useState(0);
  const [previewKey,     setPreviewKey]     = useState(0);
  const [currentTime,    setCurrentTime]    = useState(0);
  const [isPaused,       setIsPaused]       = useState(false);
  const [accentColor,    setAccentColor]    = useState<string | null>(null);
  const [showCustomColor, setShowCustomColor] = useState(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try { localStorage.setItem('studio_history', JSON.stringify(history)); } catch { /* quota */ }
  }, [history]);

  // Sync playback time from iframe canvas animation
  useEffect(() => {
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    setCurrentTime(0);
    setIsPaused(false);
    if (!html || type !== 'video') return;
    syncIntervalRef.current = setInterval(() => {
      const w = iframeRef.current?.contentWindow as (Window & { _T?: number }) | null;
      if (w && typeof w._T === 'number') setCurrentTime(w._T);
    }, 80);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [html, type]);

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

  // Auto-generate when arriving from Krew with a pre-built request
  const initConsumed = useRef(false);
  useEffect(() => {
    if (!initialRequest || initConsumed.current) return;
    initConsumed.current = true;
    const fmt = FORMATS.video.find((f) => f.id === initialRequest.formatId) ?? FORMATS.video[2];
    setType('video');
    setFormat(fmt);
    setDuration(initialRequest.duration);
    setPrompt(initialRequest.prompt);
    if (initialRequest.context) setContextFile({ name: 'krew-brief.md', content: initialRequest.context });
    onRequestConsumed?.();
    generateFromKrew(initialRequest.prompt, fmt, initialRequest.duration, initialRequest.context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generateFromKrew(p: string, fmt: Format, dur: number, ctx: string) {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setStreamLog('Preparing…');
    setShowCode(false);
    setReviews({});
    let raw = '';
    try {
      const sysPrompt = buildVideoPrompt(fmt, dur, activeAgent?.bias);
      const userMsg = ctx ? `Brand context:\n${ctx}\n\nCreate:\n${p}` : `Create:\n${p}`;
      await streamAI(sysPrompt, userMsg, (chunk) => { raw += chunk; setStreamLog(getStreamPhase(raw, 'video')); });
      const stripped = stripFences(raw);
      const finalHtml = assembleVideoHtml(stripped, fmt, dur);
      setHtml(finalHtml);
      setPreviewKey(k => k + 1);
      setEditedHtml(finalHtml);
      setAccentColor(null);
      setShowCustomColor(false);
      setHistory((h) => [{ id: Date.now().toString(), prompt: p, html: finalHtml, type: 'video', format: fmt, at: Date.now() }, ...h.slice(0, 19)]);
      setTimeout(() => runReviews(finalHtml), 800);
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
      setStreamLog('');
    }
  }

  async function autoBrief() {
    if (!contextFile || !activeAgent || briefing) return;
    setBriefing(true);

    const sysPrompt = `You are a ${activeAgent.role}. Extract a marketing video brief from the brand content below.
${activeAgent.bias}
Return ONLY valid JSON (no markdown fences, no explanation):
{"prompt":"<detailed cinematic video prompt — specific visual elements, scene structure, emoji icons ⚡🤖🚀, color palette, CTA text, animation style>","duration":<${activeAgent.defaultDuration}>}
The prompt must be specific enough for a motion designer to execute without questions. No placeholder text.`;

    const callId = `brief-${Date.now()}`;
    let full = '';
    const done = { cleanup: () => {} };

    try {
      const result = await new Promise<string>((resolve, reject) => {
        (async () => {
          const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
            if (e.payload.id === callId) full += e.payload.text;
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
          const { mode, apiKey, provider } = await resolveMode();
          invoke('krew_ai_stream', {
            callId, mode, systemPrompt: sysPrompt,
            messages: [{ role: 'user', content: `Brand content:\n\n${contextFile.content.slice(0, 8000)}` }],
            apiKey, provider, localModel: null, modelName: null, baseUrl: null,
            sessionToken: session?.access_token ?? null,
          }).catch((e: unknown) => { done.cleanup(); reject(e); });
        })();
      });

      let parsed: { prompt?: string; duration?: number } = {};
      try { parsed = JSON.parse(result.trim().replace(/```[\w]*\n?|```/g, '').trim()); } catch { /* use defaults */ }
      if (parsed.prompt) setPrompt(parsed.prompt);
      if (parsed.duration) setDuration(parsed.duration);
    } catch { /* silent — user can still type manually */ }
    finally { setBriefing(false); }
  }

  async function runReviews(override?: string) {
    const target = override ?? html;
    if (!target || reviewing) return;
    setReviewing(true);
    setReviews({});
    setRightTab('reviews');

    // For video: agents review scene code only (not the runtime boilerplate)
    const isVideoTarget = type === 'video';
    const codeSnippet = isVideoTarget
      ? (extractSceneSection(target) || target).slice(0, 9000)
      : target.slice(0, 7000);

    for (const agent of REVIEW_AGENTS) {
      const callId = `rev-${agent.id}-${Date.now()}`;
      let full = '';
      const done = { cleanup: () => {} };
      try {
        await new Promise<void>((resolve, reject) => {
          (async () => {
            const u1 = await listen<{ id: string; text: string }>('krew-chunk', (e) => {
              if (e.payload.id === callId) full += e.payload.text;
            });
            const u2 = await listen<{ id: string }>('krew-done', (e) => {
              if (e.payload.id !== callId) return;
              done.cleanup(); resolve();
            });
            const u3 = await listen<{ id: string; error: string }>('krew-error', (e) => {
              if (e.payload.id !== callId) return;
              done.cleanup(); reject(new Error(e.payload.error));
            });
            done.cleanup = () => { u1(); u2(); u3(); };
            const { mode, apiKey, provider } = await resolveMode();
            invoke('krew_ai_stream', {
              callId, mode, systemPrompt: agent.prompt,
              messages: [{ role: 'user', content: `Review this marketing video scene code:\n\`\`\`js\n${codeSnippet}\n\`\`\`` }],
              apiKey, provider, localModel: null, modelName: null, baseUrl: null,
              sessionToken: session?.access_token ?? null,
            }).catch((e: unknown) => { done.cleanup(); reject(e); });
          })();
        });

        try {
          const parsed = JSON.parse(full.trim().replace(/```[\w]*\n?|```/g, '').trim()) as ReviewResult;
          setReviews((prev) => ({ ...prev, [agent.id]: parsed }));
        } catch {
          setReviews((prev) => ({ ...prev, [agent.id]: { score: 0, verdict: 'needs_work', issues: ['Could not parse review'], fixes: [] } }));
        }
      } catch {
        setReviews((prev) => ({ ...prev, [agent.id]: { score: 0, verdict: 'needs_work', issues: ['Review failed — check your AI connection'], fixes: [] } }));
      }
    }

    setReviewing(false);
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    // Auto-detect duration from prompt text (e.g. "60 sec")
    const detectedDur = extractDurationFromPrompt(prompt);
    if (detectedDur && detectedDur !== duration) setDuration(detectedDur);
    const effectiveDur = detectedDur ?? duration;
    setGenerating(true);
    setError(null);
    setStreamLog('Preparing…');
    setShowCode(false);
    setReviews({});

    const selectedStyle = STYLES.find((s) => s.id === style)!;
    const ctx = contextFile?.content ?? '';
    let raw = '';

    try {
      if (type === 'video') {
        const sysPrompt = buildVideoPrompt(format, effectiveDur, activeAgent?.bias);
        const userMsg = ctx
          ? `Brand/product context:\n${ctx}\n\nCreate this animation:\n${prompt}`
          : `Create this animation:\n${prompt}`;
        await streamAI(sysPrompt, userMsg, (chunk) => {
          raw += chunk;
          setStreamLog(getStreamPhase(raw, 'video'));
        });
        const stripped = stripFences(raw);
        const finalHtml = assembleVideoHtml(stripped, format, effectiveDur);
        setHtml(finalHtml);
        setPreviewKey(k => k + 1);
        setEditedHtml(finalHtml);
        setHistory((h) => [{ id: Date.now().toString(), prompt, html: finalHtml, type, format, at: Date.now() }, ...h.slice(0, 19)]);
        // Agents immediately help review + improve after generation
        setTimeout(() => runReviews(finalHtml), 800);
      } else {
        const styleDesc = `${selectedStyle.label} — ${selectedStyle.desc}`;
        const sysPrompt =
          type === 'screen'    ? buildScreenPrompt(format, prompt, styleDesc, ctx) :
          type === 'banner'    ? buildBannerPrompt(format, prompt, styleDesc, ctx) :
                                 buildComponentPrompt(format, prompt, styleDesc, ctx);
        const userMsg = ctx ? `Brand/product context:\n${ctx}\n\n${prompt}` : prompt;
        await streamAI(sysPrompt, userMsg, (chunk) => {
          raw += chunk;
          setStreamLog(getStreamPhase(raw, type));
        });
        const finalHtml = buildStaticHtml(stripFences(raw));
        setHtml(finalHtml);
        setPreviewKey(k => k + 1);
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

  async function handleRefine(instruction?: string, skipHistory = false) {
    const text = instruction ?? prompt;
    if (!text.trim() || !html || generating) return;
    setGenerating(true);
    setError(null);
    setStreamLog('Refining…');

    let raw = '';
    const isVideo = type === 'video';
    const sysPrompt = isVideo
      ? `You are refining a CSS-animated marketing video HTML file that uses data-start/data-duration attributes for scene timing.
Return the COMPLETE updated HTML starting with <!DOCTYPE html>.

Rules:
1. Keep the // ── PLAYBACK + CLIP RUNTIME block VERBATIM — never modify it
2. Keep all .clip data-start and data-duration values unless timing is explicitly requested to change
3. Keep :root { --bg, --fg, --acc } — use CSS variables, never hardcode hex in element styles
4. Every .clip must keep its .sub subtitle div
5. No emojis in visible text
6. html,body must stay width/height fixed with overflow:hidden
7. Apply ONLY the requested changes — preserve everything else exactly`
      : `You are an expert HTML/CSS designer. Modify the design as instructed. Return the COMPLETE updated HTML starting with <!DOCTYPE html>. Keep everything not mentioned unchanged.`;

    try {
      await streamAI(sysPrompt, buildRefinePrompt(html, text, isVideo), (chunk) => {
        raw += chunk;
        setStreamLog(getStreamPhase(raw, type));
      });
      const stripped = stripFences(raw);
      let updated: string;
      // For both video and static: if AI returned full HTML, use it; otherwise wrap
      if (/^<!DOCTYPE/i.test(stripped.trimStart()) || /^<html/i.test(stripped.trimStart())) {
        updated = stripped;
      } else if (isVideo) {
        updated = buildVideoHtml(format, duration, stripped);
      } else {
        updated = buildStaticHtml(stripped);
      }
      setHtml(updated);
      setPreviewKey(k => k + 1);
      setEditedHtml(updated);
      if (!instruction) setPrompt('');
      if (!skipHistory) {
        setHistory((h) => [{ id: Date.now().toString(), prompt: `↺ ${text}`, html: updated, type, format, at: Date.now() }, ...h.slice(0, 19)]);
      }
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
    setPreviewKey(k => k + 1);
    setShowCode(false);
  }

  async function handleSave() {
    if (!html) return;
    const defaultName = `studio_${type}_${Date.now()}.html`;
    try {
      await invoke('studio_save_file', { defaultName, content: html });
    } catch {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = defaultName; a.click();
      URL.revokeObjectURL(url);
    }
  }

  function togglePlayPause() {
    const w = iframeRef.current?.contentWindow as (Window & { _PAUSED?: boolean }) | null;
    if (!w) return;
    const next = !isPaused;
    w._PAUSED = next;
    setIsPaused(next);
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const t = parseFloat(e.target.value);
    const w = iframeRef.current?.contentWindow as (Window & { _T?: number; _L?: number | null }) | null;
    if (w) { w._T = t; w._L = null; }
    setCurrentTime(t);
  }

  function restartPreview() {
    const w = iframeRef.current?.contentWindow as (Window & { _T?: number; _L?: number | null; _PAUSED?: boolean }) | null;
    if (w) { w._T = 0; w._L = null; w._PAUSED = false; }
    setCurrentTime(0);
    setIsPaused(false);
  }

  function applyAccentColor(hex: string) {
    setAccentColor(hex);
    iframeRef.current?.contentWindow?.postMessage({ __nv_acc: hex }, '*');
  }

  async function handleDownloadVideo() {
    if (!html || recording) return;
    const iframe = iframeRef.current;
    const iframeCanvas = iframe?.contentDocument?.querySelector<HTMLCanvasElement>('canvas#c');
    if (!iframeCanvas) {
      handleSave();
      return;
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm'].find((t) => {
      try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
    }) ?? 'video/webm';
    let stream: MediaStream;
    try {
      stream = (iframeCanvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(30);
    } catch {
      handleSave();
      return;
    }
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nivara-video-${Date.now()}.webm`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    setRecording(true);
    setRecordSecs(duration);
    recorder.start(100);
    const tick = setInterval(() => setRecordSecs((s) => Math.max(0, s - 1)), 1000);
    setTimeout(() => {
      recorder.stop();
      clearInterval(tick);
      setRecording(false);
      setRecordSecs(0);
    }, duration * 1000 + 600);
  }

  async function applyAndRemoveFix(agentId: string, fixIdx: number, fixText: string) {
    await handleRefine(fixText, true);
    setReviews(prev => {
      const r = prev[agentId];
      if (!r) return prev;
      const newIssues = r.issues.filter((_, i) => i !== fixIdx);
      const newFixes  = r.fixes.filter((_, i) => i !== fixIdx);
      if (newIssues.length === 0) {
        const next = { ...prev };
        delete next[agentId];
        return next;
      }
      return { ...prev, [agentId]: { ...r, issues: newIssues, fixes: newFixes } };
    });
  }

  async function applyAllFixes() {
    if (generating) return;
    const allFixes: string[] = [];
    for (const result of Object.values(reviews)) {
      result.fixes.forEach(fix => { if (fix) allFixes.push(fix); });
    }
    if (allFixes.length === 0) return;
    // Combine into a single instruction — sequential calls would each read stale html state
    const combined = allFixes.map((f, i) => `${i + 1}. ${f}`).join('\n');
    await handleRefine(combined, true);
    setReviews({});
  }

  function handleCopy() {
    if (!html) return;
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

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

          {/* Marketing agents */}
          <section>
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-1.5 px-1">Agents</p>
            <div className="flex flex-wrap gap-1 mb-1">
              {STUDIO_AGENTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    if (activeAgent?.id === a.id) { setActiveAgent(null); return; }
                    setActiveAgent(a);
                    setType('video');
                    const fmt = FORMATS.video.find((f) => f.id === a.defaultFormatId) ?? FORMATS.video[2];
                    setFormat(fmt);
                    setDuration(a.defaultDuration);
                  }}
                  title={a.role}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] border transition-fast ${
                    activeAgent?.id === a.id
                      ? 'bg-accent/15 border-accent/40 text-accent'
                      : 'border-nv-border text-nv-faint hover:border-nv-muted hover:text-nv-muted'
                  }`}
                >
                  <AgentIcon id={a.id} />
                  <span className="font-medium">{a.name}</span>
                </button>
              ))}
            </div>
            {activeAgent && (
              <div className="px-1 mb-1">
                <p className="text-[9px] text-accent font-mono">{activeAgent.role}</p>
              </div>
            )}
            {activeAgent && contextFile && (
              <button
                onClick={autoBrief}
                disabled={briefing}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-mono border border-accent/35 text-accent rounded-lg hover:bg-accent/10 transition-fast disabled:opacity-50"
              >
                {briefing ? (
                  <><span className="w-2.5 h-2.5 rounded-full border border-accent/30 border-t-accent animate-spin" />Briefing…</>
                ) : (
                  <>{activeAgent.emoji} Brief from {contextFile.name.split('.')[0]}</>
                )}
              </button>
            )}
            {activeAgent && !contextFile && (
              <p className="text-[9px] text-nv-faint/60 font-mono px-1">Attach a file to auto-brief</p>
            )}
          </section>

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
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono">History</p>
                <button
                  onClick={() => setHistory([])}
                  className="text-[8px] text-nv-faint/50 hover:text-red-400 font-mono transition-fast"
                  title="Clear all history"
                >
                  clear
                </button>
              </div>
              {history.slice(0, 8).map((h) => (
                <div
                  key={h.id}
                  className="group relative flex items-start mb-0.5 rounded-lg hover:bg-nv-surface2 transition-fast"
                >
                  <button
                    onClick={() => { setHtml(h.html); setPreviewKey(k => k + 1); setEditedHtml(h.html); setShowCode(false); }}
                    className="flex-1 text-left px-2 py-1.5 min-w-0"
                  >
                    <p className="text-[10px] text-nv-muted truncate pr-4">{h.prompt}</p>
                    <p className="text-[9px] text-nv-faint font-mono">{h.type} · {h.format.label}</p>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setHistory((prev) => prev.filter((x) => x.id !== h.id)); }}
                    className="opacity-0 group-hover:opacity-100 absolute right-1.5 top-1.5 text-[10px] text-nv-faint/50 hover:text-red-400 transition-fast leading-none"
                    title="Remove from history"
                  >
                    ✕
                  </button>
                </div>
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
            <button
              onClick={() => { setHtml(null); setEditedHtml(''); setShowCode(false); setError(null); }}
              className="text-[10px] text-nv-faint hover:text-nv-text font-mono px-2 py-1 rounded border border-nv-border hover:border-nv-muted transition-fast"
              title="Clear canvas and start fresh"
            >
              + New
            </button>
          )}
          {html && !generating && (
            <button
              onClick={() => runReviews()}
              disabled={reviewing}
              className={`flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border transition-fast ${
                rightTab === 'reviews'
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'text-nv-faint border-nv-border hover:text-nv-text hover:border-nv-muted'
              } disabled:opacity-50`}
              title="Run marketing department review"
            >
              {reviewing
                ? <><span className="w-2.5 h-2.5 rounded-full border border-accent/30 border-t-accent animate-spin" />Reviewing…</>
                : <>✦ Review</>}
            </button>
          )}
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
              {type === 'video' ? (
                <button
                  onClick={handleDownloadVideo}
                  disabled={recording}
                  className="flex items-center gap-1.5 text-[10px] text-white bg-accent font-mono px-2.5 py-1 rounded hover:bg-accent-dim transition-fast disabled:opacity-60"
                  title="Record the animation and download as WebM video"
                >
                  {recording ? (
                    <><span className="w-2.5 h-2.5 rounded-full border border-white/30 border-t-white animate-spin" />
                    Rec… {recordSecs}s</>
                  ) : (
                    <><svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
                      <circle cx="5" cy="5" r="1.8" fill="currentColor"/>
                    </svg>
                    Download</>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 text-[10px] text-white bg-accent font-mono px-2.5 py-1 rounded hover:bg-accent-dim transition-fast"
                >
                  <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5">
                    <path d="M5 1v6M2 5l3 2 3-2M1 9h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Save
                </button>
              )}
            </>
          )}
        </div>

        {/* Preview / Code area */}
        <div
          className="flex-1 overflow-hidden flex items-center justify-center relative"
          style={{ background:
            showCode        ? 'var(--nv-surface)' :
            html && !generating ? 'var(--nv-surface2)' :
                                  'var(--nv-bg)'
          }}
        >
          {/* Generating overlay — inherits parent background, no hardcoded dark */}
          {generating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <div className="w-8 h-8 rounded-full border-2 border-nv-border border-t-accent animate-spin" />
              <p className="text-[11px] text-nv-muted font-mono">Generating {type}…</p>
              {streamLog && (
                <p className="text-[11px] text-nv-muted/70 text-center">
                  {streamLog}
                </p>
              )}
            </div>
          )}

          {/* Empty state */}
          {!generating && !html && !error && (
            <div className="flex flex-col items-center gap-3 text-nv-faint/30 pointer-events-none select-none">
              <svg viewBox="0 0 64 64" fill="none" className="w-16 h-16">
                <rect x="8" y="8" width="48" height="48" rx="8" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 40l14-14 10 10 10-10 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="22" cy="22" r="5" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <p className="text-[13px] font-medium text-nv-faint/50">Describe → Generate</p>
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
            <div className="flex flex-col items-center gap-2">
              <div
                className="shadow-2xl overflow-hidden rounded"
                style={{
                  width: format.w * previewScale,
                  height: format.h * previewScale,
                  outline: type !== 'video' ? '1px solid rgba(0,0,0,0.08)' : 'none',
                }}
              >
                <iframe
                  ref={iframeRef}
                  key={previewKey}
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

              {/* Playback bar — video only */}
              {type === 'video' && (
                <div
                  className="flex items-center gap-2 px-2 py-1.5 bg-nv-surface border border-nv-border rounded-lg"
                  style={{ width: format.w * previewScale }}
                >
                  {/* Restart */}
                  <button
                    onClick={restartPreview}
                    className="w-5 h-5 flex items-center justify-center text-nv-faint hover:text-nv-text transition-fast shrink-0"
                    title="Restart"
                  >
                    <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                      <path d="M2 6a4 4 0 1 0 .8-2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      <path d="M2 2.5V5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {/* Play / Pause */}
                  <button
                    onClick={togglePlayPause}
                    className="w-5 h-5 flex items-center justify-center text-nv-text hover:text-accent transition-fast shrink-0"
                    title={isPaused ? 'Play' : 'Pause'}
                  >
                    {isPaused ? (
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
                        <path d="M3 2l7 4-7 4V2z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
                        <rect x="2" y="2" width="3" height="8" rx="0.8"/>
                        <rect x="7" y="2" width="3" height="8" rx="0.8"/>
                      </svg>
                    )}
                  </button>

                  {/* Scrub slider */}
                  <div className="flex-1 relative flex items-center h-4">
                    <div className="absolute inset-x-0 h-1 bg-nv-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={currentTime}
                      onChange={handleScrub}
                      className="absolute inset-x-0 opacity-0 cursor-pointer h-4 w-full"
                      title={`${Math.floor(currentTime)}s`}
                    />
                    {/* Thumb dot */}
                    <div
                      className="absolute w-3 h-3 bg-white border-2 border-accent rounded-full shadow pointer-events-none"
                      style={{ left: `calc(${(currentTime / duration) * 100}% - 6px)` }}
                    />
                  </div>

                  {/* Time display */}
                  <span className="text-[10px] font-mono text-nv-muted shrink-0 tabular-nums">
                    {`${Math.floor(currentTime)}`.padStart(1, '0')}s / {duration}s
                  </span>
                </div>
              )}

              {/* ── Color palette (video only) ── */}
              {type === 'video' && <div
                className="flex flex-col gap-1.5 px-1 pt-0.5"
                style={{ width: format.w * previewScale }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-nv-faint font-mono shrink-0">Accent</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {ACCENT_PALETTE.map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => applyAccentColor(c.hex)}
                        title={c.name}
                        className="w-4 h-4 rounded-full shrink-0 transition-all hover:scale-110"
                        style={{
                          background: c.hex,
                          outline: accentColor === c.hex ? `2px solid ${c.hex}` : '2px solid transparent',
                          outlineOffset: '1px',
                          boxShadow: c.hex === '#f8fafc' ? 'inset 0 0 0 1px rgba(0,0,0,0.15)' : undefined,
                        }}
                      />
                    ))}
                    <button
                      onClick={() => setShowCustomColor((v) => !v)}
                      title="Custom color"
                      className="w-4 h-4 rounded-full border border-dashed border-nv-border text-nv-faint hover:border-nv-muted text-[9px] flex items-center justify-center shrink-0 transition-fast"
                    >
                      {showCustomColor ? '×' : '+'}
                    </button>
                  </div>
                </div>

                {showCustomColor && (
                  <div className="flex items-center gap-2 px-0.5">
                    <input
                      type="color"
                      defaultValue={accentColor ?? '#6d4cff'}
                      onChange={(e) => applyAccentColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border border-nv-border bg-nv-surface p-0.5 shrink-0"
                      title="Pick any color"
                    />
                    <input
                      type="text"
                      placeholder="#hex or rgb()"
                      defaultValue={accentColor ?? ''}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (v) applyAccentColor(v);
                        }
                      }}
                      className="flex-1 min-w-0 text-[10px] font-mono bg-nv-surface border border-nv-border rounded px-2 py-1 text-nv-text placeholder:text-nv-faint outline-none focus:border-accent/50 transition-fast"
                    />
                    <span className="text-[9px] text-nv-faint font-mono shrink-0">↵ apply</span>
                  </div>
                )}
              </div>}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ──────────────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 flex flex-col border-l border-nv-border">

        {/* Header — context-aware */}
        <div className="px-3 pt-2 pb-0 border-b border-nv-border shrink-0">
          {html ? (
            <>
              <div className="flex items-start justify-between gap-2 pb-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-nv-text">Editing</p>
                  <p className="text-[9px] text-nv-faint font-mono mt-0.5 truncate">{TYPE_META[type].label} · {format.label}</p>
                </div>
                <button
                  onClick={() => { setHtml(null); setEditedHtml(''); setShowCode(false); setError(null); setPrompt(''); setRightTab('prompt'); setReviews({}); }}
                  className="text-[9px] text-nv-faint/60 hover:text-accent font-mono shrink-0 mt-0.5 transition-fast"
                  title="Start a new project"
                >
                  + New
                </button>
              </div>
              <div className="flex gap-0">
                <button
                  onClick={() => setRightTab('prompt')}
                  className={`text-[10px] font-mono px-2 pb-1.5 border-b-2 -mb-px transition-fast ${
                    rightTab === 'prompt' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
                  }`}
                >
                  Prompt
                </button>
                <button
                  onClick={() => setRightTab('reviews')}
                  className={`flex items-center gap-1 text-[10px] font-mono px-2 pb-1.5 border-b-2 -mb-px transition-fast ${
                    rightTab === 'reviews' ? 'border-accent text-nv-text' : 'border-transparent text-nv-faint hover:text-nv-muted'
                  }`}
                >
                  Reviews
                  {Object.keys(reviews).length > 0 && (
                    <span className="text-[8px] bg-accent/20 text-accent px-1 rounded-full">{Object.keys(reviews).length}</span>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="pb-2">
              <p className="text-[11px] font-semibold text-nv-text">Prompt</p>
              <p className="text-[9px] text-nv-faint font-mono mt-0.5">Describe what to create</p>
            </div>
          )}
        </div>

        {/* Reviews tab / Suggestions tab */}
        {rightTab === 'reviews' && html ? (
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {/* Initial state */}
            {!reviewing && Object.keys(reviews).length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8 text-nv-faint/25">
                  <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10.5 16h11M16 10.5v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="text-[10px] text-nv-faint font-mono">No reviews yet</p>
                <p className="text-[9px] text-nv-faint/50 leading-relaxed">Get brutally honest feedback<br/>from the marketing team</p>
                <button
                  onClick={() => runReviews()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono bg-accent/10 text-accent border border-accent/30 rounded-lg hover:bg-accent/20 transition-fast"
                >
                  ✦ Run Reviews
                </button>
              </div>
            )}
            {/* Loading first result */}
            {reviewing && Object.keys(reviews).length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-10">
                <div className="w-5 h-5 rounded-full border-2 border-nv-border border-t-accent animate-spin" />
                <p className="text-[10px] text-nv-faint font-mono">Asking the team…</p>
              </div>
            )}
            {/* Agent cards */}
            {REVIEW_AGENTS.map((agent) => {
              const result = reviews[agent.id];
              const isPending = reviewing && !result;
              return (
                <div
                  key={agent.id}
                  className={`border rounded-xl p-2.5 transition-fast ${
                    result?.verdict === 'approved'   ? 'border-green-500/25 bg-green-500/5' :
                    result?.verdict === 'rejected'   ? 'border-red-500/25 bg-red-500/5' :
                    result?.verdict === 'needs_work' ? 'border-yellow-500/25 bg-yellow-500/5' :
                                                       'border-nv-border bg-nv-surface/50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <AgentIcon id={agent.id} className="w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-nv-text leading-tight">{agent.name}</p>
                      <p className="text-[8px] text-nv-faint font-mono leading-tight">{agent.role}</p>
                    </div>
                    {result ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-[12px] font-bold font-mono leading-none ${
                          result.score >= 8 ? 'text-green-400' :
                          result.score >= 6 ? 'text-yellow-400' : 'text-red-400'
                        }`}>{result.score}/10</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-mono border leading-none ${
                          result.verdict === 'approved'   ? 'bg-green-500/10 text-green-400 border-green-500/25' :
                          result.verdict === 'needs_work' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25' :
                                                            'bg-red-500/10 text-red-400 border-red-500/25'
                        }`}>
                          {result.verdict === 'approved' ? '✓ OK' : result.verdict === 'needs_work' ? '⚠ Fix' : '✕ Fail'}
                        </span>
                      </div>
                    ) : isPending ? (
                      <span className="w-3 h-3 rounded-full border border-nv-border border-t-accent animate-spin shrink-0" />
                    ) : null}
                  </div>
                  {result && result.issues.map((issue, idx) => (
                    <div key={idx} className="mt-1.5 p-1.5 bg-nv-bg/50 rounded-lg">
                      <p className="text-[9px] text-nv-muted leading-relaxed mb-1">{issue}</p>
                      {result.fixes[idx] && (
                        <button
                          onClick={() => applyAndRemoveFix(agent.id, idx, result.fixes[idx])}
                          disabled={generating}
                          className="text-[9px] text-accent font-mono hover:underline transition-fast disabled:opacity-40"
                        >
                          {generating ? 'Applying…' : 'Apply →'}
                        </button>
                      )}
                    </div>
                  ))}
                  {result && result.issues.length === 0 && (
                    <p className="text-[9px] text-green-400/80 font-mono mt-1">No issues — looks great!</p>
                  )}
                </div>
              );
            })}
            {/* Apply All — shown when 2+ fixes remain */}
            {(() => {
              const total = Object.values(reviews).reduce((s, r) => s + r.fixes.filter(Boolean).length, 0);
              return total >= 2 && !reviewing && (
                <button
                  onClick={applyAllFixes}
                  disabled={generating}
                  className="w-full py-2 text-[10px] font-mono text-white bg-accent rounded-lg hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {generating ? 'Applying…' : `Apply all fixes (${total})`}
                </button>
              );
            })()}
            {Object.keys(reviews).length === REVIEW_AGENTS.length && !reviewing && (
              <button
                onClick={() => runReviews()}
                className="w-full py-1.5 text-[10px] font-mono text-nv-faint border border-nv-border rounded-lg hover:text-nv-text hover:border-nv-muted transition-fast"
              >
                ↺ Re-run reviews
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2.5">
            <p className="text-[9px] text-nv-faint uppercase tracking-widest font-mono mb-2 px-1">
              {html ? 'Quick edits' : 'Examples'}
            </p>
            {(html ? REFINE_SUGGESTIONS[type] : EXAMPLES[type]).map((item, i) => (
              <button
                key={i}
                onClick={() => setPrompt(item)}
                className="w-full text-left px-2.5 py-2 rounded-lg mb-1.5 border border-nv-border/60 hover:border-accent/30 hover:bg-accent/5 transition-fast"
              >
                <p className="text-[10px] text-nv-muted leading-relaxed">{item}</p>
              </button>
            ))}
          </div>
        )}

        {/* Input + Actions — hidden when reviewing */}
        {rightTab !== 'reviews' && <div className="p-2.5 border-t border-nv-border shrink-0 space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                html ? handleRefine() : handleGenerate();
              }
            }}
            placeholder={
              html
                ? 'Describe what to change — or pick a quick edit above…'
                : type === 'video'  ? 'Product launch video — dark bg, purple logo entrance…' :
                  type === 'screen' ? 'Analytics dashboard, dark theme, sidebar + KPI cards…' :
                  type === 'banner' ? 'Instagram post announcing product launch…' :
                                     'Glassmorphism pricing card with toggle…'
            }
            rows={html ? 4 : 5}
            className="w-full bg-nv-surface border border-nv-border rounded-xl px-3 py-2.5 text-[12px] text-nv-text placeholder-nv-faint/60 outline-none focus:border-accent transition-fast resize-none leading-relaxed"
          />

          {/* File attach */}
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt,.json,.csv"
              className="hidden"
              onChange={handleFileAttach}
            />
            {contextFile ? (
              <div className="flex items-center gap-1.5 bg-accent/10 border border-accent/25 rounded-lg px-2 py-1 flex-1 min-w-0">
                <svg viewBox="0 0 10 10" fill="none" className="w-2.5 h-2.5 text-accent shrink-0">
                  <path d="M2 1h4.5L9 3.5V9H2V1z" stroke="currentColor" strokeWidth="1.1"/>
                </svg>
                <span className="text-[9px] text-accent font-mono truncate flex-1">{contextFile.name}</span>
                <button
                  onClick={() => setShowContext(v => !v)}
                  className="text-[9px] text-accent/60 hover:text-accent font-mono transition-fast shrink-0"
                >{showContext ? '▲' : '▼'}</button>
                <button
                  onClick={() => { setContextFile(null); setShowContext(false); }}
                  className="w-5 h-5 flex items-center justify-center text-base text-nv-muted hover:text-nv-text leading-none shrink-0 rounded hover:bg-nv-border/50 transition-fast"
                  title="Remove file"
                >×</button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-[10px] text-nv-faint hover:text-accent font-mono transition-fast px-2 py-1 rounded-lg border border-nv-border hover:border-accent/30 w-full"
                title="Attach a brand doc, product brief, or .md/.txt/.json file"
              >
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3 shrink-0">
                  <path d="M2 3.5A1.5 1.5 0 013.5 2h4L10 5v5a1 1 0 01-1 1H3.5A1.5 1.5 0 012 9.5V3.5z" stroke="currentColor" strokeWidth="1.1"/>
                  <path d="M6.5 2v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                </svg>
                Attach context file (.md · .txt · .json)
              </button>
            )}
          </div>
          {contextFile && showContext && (
            <pre className="text-[9px] text-nv-faint font-mono bg-nv-bg border border-nv-border rounded-lg p-2 max-h-20 overflow-y-auto whitespace-pre-wrap">
              {contextFile.content.slice(0, 500)}{contextFile.content.length > 500 ? '…' : ''}
            </pre>
          )}

          <button
            onClick={html ? () => handleRefine() : handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <><span className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white animate-spin" />{html ? 'Applying…' : 'Generating…'}</>
            ) : html ? (
              <>
                <svg viewBox="0 0 14 14" fill="none" className="w-3.5 h-3.5">
                  <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Apply Changes
                <span className="text-[10px] opacity-60 ml-0.5">⌘↵</span>
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
        </div>}
      </div>
    </div>
  );
}

// ─── Agent icons (filled, slate-400 grey — works dark + light) ───────────────

function AgentIcon({ id, className = 'w-3 h-3' }: { id: string; className?: string }) {
  const cls = `${className} text-slate-400 shrink-0`;
  // Target / crosshair — Brand Director, Brand Strategist
  if (id === 'director' || id === 'brand') return (
    <svg viewBox="0 0 14 14" fill="none" className={cls}>
      <circle cx="7" cy="7" r="5" fill="currentColor" opacity=".22"/>
      <circle cx="7" cy="7" r="2.6" fill="currentColor"/>
      <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
  // Mobile phone — Social Expert
  if (id === 'social') return (
    <svg viewBox="0 0 14 14" fill="none" className={cls}>
      <rect x="3.5" y="1" width="7" height="12" rx="1.5" fill="currentColor" opacity=".2"/>
      <rect x="3.5" y="1" width="7" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="5.2" y="2.5" width="3.6" height="1" rx=".5" fill="currentColor"/>
      <circle cx="7" cy="11" r=".9" fill="currentColor"/>
    </svg>
  );
  // Rocket — Launch Strategist
  if (id === 'launch') return (
    <svg viewBox="0 0 14 14" fill="none" className={cls}>
      <path d="M7 2C7 2 4 4.5 4 8h6c0-3.5-3-6-3-6z" fill="currentColor"/>
      <path d="M4 8v3l3-1 3 1V8" fill="currentColor" opacity=".5"/>
      <path d="M3.5 9.5C2 9.5 1.5 11 1.5 11S3 11 3.5 9.5z" fill="currentColor" opacity=".55"/>
      <path d="M10.5 9.5C12 9.5 12.5 11 12.5 11S11 11 10.5 9.5z" fill="currentColor" opacity=".55"/>
    </svg>
  );
  // Bar chart — Data Storyteller, Conversion Expert
  if (id === 'data' || id === 'conversion') return (
    <svg viewBox="0 0 14 14" fill="currentColor" className={cls}>
      <rect x="1.5" y="8.5" width="3"   height="4" rx=".6"/>
      <rect x="5.5" y="5.5" width="3"   height="7" rx=".6"/>
      <rect x="9.5" y="2.5" width="3"   height="10" rx=".6"/>
    </svg>
  );
  // Star / sparkle — Creative Director
  if (id === 'creative') return (
    <svg viewBox="0 0 14 14" fill="none" className={cls}>
      <path d="M7 1.5 8.5 5.2 12.5 7 8.5 8.8 7 12.5 5.5 8.8 1.5 7 5.5 5.2 7 1.5z" fill="currentColor"/>
    </svg>
  );
  return <svg viewBox="0 0 14 14" fill="currentColor" className={cls}><circle cx="7" cy="7" r="4"/></svg>;
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
