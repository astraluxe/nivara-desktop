import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
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

// Post-process generated video HTML to enforce selected emoji style at code level
// (LLM prompt instructions alone are unreliable for this — we do it ourselves)
function applyEmojiStyle(html: string, style: 'color' | 'infill' | 'outline'): string {
  if (style === 'color') return html;
  const emojiRe = /\p{Emoji_Presentation}/gu;
  return html.replace(/(<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|>[^<]*<)/gi, (m) => {
    if (/^<style/i.test(m) || /^<script/i.test(m)) return m;
    return m.replace(emojiRe, (e) => {
      if (style === 'outline') {
        return `<span style="display:inline-block;-webkit-text-stroke:3px var(--acc);color:transparent;filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 40%,transparent));">${e}</span>`;
      }
      return `<span style="display:inline-block;position:relative;line-height:1;vertical-align:middle;"><span style="filter:grayscale(1) brightness(0);">${e}</span><span style="position:absolute;inset:0;background:var(--acc);mix-blend-mode:screen;pointer-events:none;"></span></span>`;
    });
  });
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

function getSceneCount(duration: number): number {
  return duration <= 8 ? 3 : duration <= 15 ? 5 : duration <= 22 ? 7 : duration <= 32 ? 9 : duration <= 45 ? 12 : duration <= 60 ? 15 : 18;
}

function buildVideoPrompt(fmt: Format, duration: number, agentBias?: string, emojiStyle: 'color' | 'infill' | 'outline' = 'infill'): string {
  const W = fmt.w;
  const H = fmt.h;

  const sceneCount = getSceneCount(duration);

  const fsHero    = Math.round(H * 0.09);   // full-scene headlines
  const fsSub     = Math.round(H * 0.04);   // secondary text / supporting lines
  const fsStat    = Math.round(H * 0.13);   // STANDALONE full-screen hero numbers only
  const fsCardNum = Math.round(H * 0.062);  // numbers INSIDE a card/badge/box
  const fsBody    = Math.round(H * 0.028);  // body / label text
  const fsCta     = Math.round(H * 0.038);  // CTA button text
  const subPad    = Math.round(H * 0.015);
  const subW      = Math.round(W * 0.05);
  const subFs     = Math.round(H * 0.025);

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
SAFE ZONE: ${Math.round(W*0.05)}px from left/right edges, ${Math.round(H*0.04)}px from bottom. No content may touch the canvas border. The 3-zone template already encodes these — do not set left:0 or right:0 on any content div.

━━━ STEP 1: PLAN BEFORE WRITING ━━━
Read the ENTIRE user message + brand content. Extract every name, number, feature, fact. Use them — do not invent.
Decide:
  A) VIDEO TYPE — Product launch / Brand story / Data reveal / Tutorial / Announcement
  B) NARRATIVE ARC — if user specifies a story structure (e.g. "pain then solution", "problem first"), lay out ALL ${sceneCount} scenes in that exact order:
     Pain arc: scenes 1-3 = relatable user problem (use pain-point language from content), scenes 4+ = product as the solution, last scene = CTA.
     If no arc specified: hook → features → proof → CTA.
  C) SCENE PLAN — exactly ${sceneCount} scenes. For each: name, narrative role, duration. Durations must sum to ${duration}.
  D) VISUAL STYLE — derive from (1) user color signal: white/light → light theme; dark/no signal → dark theme. (2) platform: Instagram → punchy 3-4s scenes.
  E) COLOR TRIO — --bg / --fg / --acc. White/light signal → light theme. DO NOT default to purple. NEVER override a color explicitly stated in the prompt.
  F) HERO VISUAL — decide the ONE dominant visual for each scene BEFORE writing code.
     PRIORITY ORDER — use the HIGHEST option that fits. Do NOT default to emoji.
     1. CODED CSS VISUAL (preferred — rich, branded): staggered card list, hero stat number, terminal window, item/tile grid, progress bar, pill-badge + cards. See TECHNIQUE A for copy-paste templates.
     2. UI INTERACTION (tech/product): search bar typing, browser/app mockup, chat bubbles, phone notification.
     3. DATA PROP (metrics/growth): bar chart, donut ring, stat card grid.
     4. MULTI-EMOJI STORY (emotion/pain — use sparingly): 2-3 emoji side-by-side, only if no coded visual fits.
     5. SINGLE EMOJI HERO (last resort — max 2 scenes per video): only for pure emotion (pain hook, win/CTA).
     RULE: coded CSS visuals MUST appear in at least 60% of scenes. Emoji alone is a crutch — avoid it.
     NEVER use icon font class names (.icon, .icon-fill) — they render as raw text. ONLY use emoji or inline SVG.
     LAYOUT: every scene = TOP keyword + MIDDLE visual + BOTTOM subtitle. That's the only layout.

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

━━━ THE ONE LAYOUT — every scene uses this exact 3-zone structure ━━━

  ┌────────────────────────────────┐
  │  ZONE 1 — TOP: keyword(s)     │  ← 1-4 important words, accent color, centered
  │                                │
  │  ZONE 2 — MIDDLE: visual prop  │  ← emoji / UI component (search, browser, app) / chart
  │                                │
  │  ZONE 3 — BOTTOM: .sub only   │  ← voice-over caption, explanation
  └────────────────────────────────┘

PIXEL ZONES for this ${W}×${H}px canvas:
  TOP    starts: ${Math.round(H*0.055)}px from top, height ≈ ${Math.round(H*0.18)}px
  MIDDLE starts: ${Math.round(H*0.24)}px from top → ends ${Math.round(H*0.14)}px from bottom
  BOTTOM .sub:   position:absolute; bottom:0; (already in CSS)

FULL SCENE TEMPLATE (copy and fill — do NOT change the zone structure):
  <div class="clip" data-start="X" data-duration="Y" id="scene-NAME">

    <!-- ZONE 0: Background — full bleed, z-index:0 -->
    <div style="position:absolute;inset:0;z-index:0;
                background:radial-gradient(ellipse 70% 50% at 50% 40%,color-mix(in srgb,var(--acc) 18%,transparent),transparent 70%),var(--bg);"></div>

    <!-- ZONE 1: TOP — 1-4 keyword words, centered, accent color -->
    <div style="position:absolute;top:${Math.round(H*0.055)}px;left:${Math.round(W*0.06)}px;right:${Math.round(W*0.06)}px;
                z-index:2;display:flex;justify-content:center;align-items:flex-start;">
      <h1 style="font-size:${fsHero}px;font-weight:900;letter-spacing:-0.04em;line-height:1.0;
                 text-align:center;color:var(--acc);max-width:${Math.round(W*0.88)}px;word-break:break-word;
                 animation:revealWord 0.6s cubic-bezier(0.16,1,0.3,1) 0.05s both;">KEY WORDS</h1>
    </div>

    <!-- ZONE 2: MIDDLE — visual prop. Text only inside UI shells (search bar, browser, app). Never as standalone labels. -->
    <div style="position:absolute;top:${Math.round(H*0.24)}px;left:${Math.round(W*0.05)}px;right:${Math.round(W*0.05)}px;bottom:${Math.round(H*0.14)}px;
                z-index:1;display:flex;align-items:center;justify-content:center;overflow:hidden;">
      <!--
        PREFERRED (use coded CSS visuals first — see TECHNIQUE A):
          • Staggered card list (A1) — sliding rows of items/benefits/features
          • Hero stat number (A2) — giant number with accent color
          • Badge pill + card grid (A3) — grouped cards with category label
          • Terminal window (A4) — CLI/code/download scenes
          • Numbered item grid (A5) — tile matrix for counts

        ALSO ALLOWED (see TECHNIQUE B/C):
          • Typing search bar — user types a query
          • Browser/app window — mini website or UI mockup with real content
          • Chat bubbles — conversation between user and AI
          • Stat cards / bar chart / donut chart
          • Phone notification sliding in

        EMOJI (last resort — max 2 scenes per video):
          • Single large emoji ONLY for pure emotion (pain hook, win CTA)
          • Never emoji as the ONLY visual for feature/data/product scenes

        NOT ALLOWED (ever):
          • Plain sentences or paragraphs floating in the zone
          • Standalone text labels (headlines belong in ZONE 1)
          • position:absolute on content children — they escape the overflow boundary

        SIZING — this zone is ${Math.round(H*0.62)}px tall. Size content to fit:
          • 4-row card list → each row ≈ ${Math.round(H*0.62/4*0.82)}px tall
          • 2×2 grid → each card ≈ ${Math.round(H*0.62/2*0.82)}px tall
          • Never pack more items than fit the height — split to next scene

        max-width:${Math.round(W*0.84)}px on any row container; overflow:hidden on every child
      -->
    </div>

    <!-- ZONE 3: BOTTOM — subtitle caption only -->
    <div class="sub">Voice-over: max 10 words that explain the scene</div>
  </div>

KEYWORD STYLES for ZONE 1 (pick by scene emotion):
  Single accent word:    <h1 style="...;color:var(--acc);">Pain</h1>
  Two words, split tone: <h1 style="...;color:var(--fg);">Still <span style="color:var(--acc);">Waiting?</span></h1>
  Stat as keyword:       <h1 style="...;color:var(--acc);font-family:'JetBrains Mono',monospace;">3 Hours</h1>
  Question hook:         <h1 style="...;color:var(--fg);">Sound <span style="color:var(--acc);">Familiar?</span></h1>
  Word reveal:           wrap each word in <span style="display:inline-block;clip-path:inset(0 0 100% 0);animation:revealWord 0.65s cubic-bezier(0.16,1,0.3,1) Xs both;">word</span>

RULES — enforced for every scene:
  1. ZONE 1 (top): keyword text only. Max 4 words. Always centered. Color: var(--acc) or mix fg+acc.
  2. ZONE 2 (middle): visual prop only. Text is permitted ONLY when it appears INSIDE a UI component:
       ✅ Search bar with animated typing
       ✅ Browser window with a styled mini website inside
       ✅ App/desktop screen showing a UI (chat, dashboard, form, feed)
       ✅ Phone mockup showing app content
       ❌ Standalone sentence floating in the zone
       ❌ Labels or descriptions sitting directly in the zone
       ❌ Anything that looks like a heading or paragraph by itself
  3. ZONE 3 (bottom): .sub caption only. Max 10 words. Voice-over narration.
  4. NEVER put a visual or UI component in ZONE 1. NEVER put a naked sentence in ZONE 2.
  5. Middle visual size: freely fills the zone — use max-width:${Math.round(W*0.84)}px on any row container.

CARD/CONTAINER FONT SIZES:
  Numbers inside cards/badges → fsCardNum (${fsCardNum}px). NEVER use fsStat (${fsStat}px) inside any box.
  fsStat = standalone full-screen hero number only (nothing around it).
  Every card: overflow:hidden + display:flex + align-items:center + justify-content:center.
  Card max-width for 3-col grid: ${Math.round(W*0.26)}px per card.

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

━━━ STEP 4: COLORS + NARRATIVE ━━━
FIRST — scan the user's prompt for these signals BEFORE picking colors or scene order:
  • Color signal: "white", "light", "clean" → LIGHT THEME.  "dark", "black", "deep" or no mention → DARK THEME.
  • Narrative arc: "pain then solution", "problem first", "before → after" → open with 3-4 pain scenes, then pivot to solution.
  • Platform: "instagram", "reel", "story", "shorts" → punchy 2-4s scenes, big visuals, minimal text.
  • Subtitle color: if user says "black subtitles" or "dark text" → light subtitle bar.

DARK THEME (default when no signal):
  :root { --bg:#0d0d1a; --fg:#f1f5f9; --acc: (brand-derived) }
  .sub override in <style>: .sub { color:#fff; background:linear-gradient(transparent,rgba(0,0,0,0.7)); }

LIGHT THEME (when user says white/light):
  :root { --bg:#f8f9fa; --fg:#111827; --acc: (brand-derived, must be vivid enough on white) }
  .sub override in <style>: .sub { color:#111827 !important; background:linear-gradient(transparent,rgba(248,249,250,0.95)) !important; }
  Body BG elements: use var(--acc) tints, soft shadows, light gradients — NOT dark overlays.

Accent palette: violet #6d4cff · orange #f97316 · emerald #10b981 · sky #0ea5e9 · rose #f43f5e · amber #f59e0b · pink #ec4899 · lime #84cc16
Use var(--bg)/var(--fg)/var(--acc) EVERYWHERE — never hardcode hex in element styles.

Sizes:
  Hero:     font-size:${fsHero}px;    font-weight:900; letter-spacing:-0.04em; line-height:0.95; color:var(--fg);
  Sub:      font-size:${fsSub}px;     font-weight:600; opacity:0.8;
  StatHero: font-size:${fsStat}px;    font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--acc); ← STANDALONE only, NOT in cards
  CardNum:  font-size:${fsCardNum}px; font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--acc); ← use for numbers INSIDE stat cards
  Body:     font-size:${fsBody}px;    font-weight:400; opacity:0.7;
  CTA:      font-size:${fsCta}px;     font-weight:700; background:var(--acc); color:#fff; border-radius:100px; padding:18px 48px;

━━━ STEP 5: VISUAL PROPS TOOLKIT (text alone = rejected) ━━━
TEXT BUDGET PER SCENE:
  Main content area: max 1 headline (≤5 words) + EITHER a subline OR a visual — not both
  .sub subtitle: carries all narrative (max 10 words)
  If you have a sentence to say → put it in .sub and replace it with an icon/emoji in the main area

EMOJI-FIRST RULE: if the concept maps to an emoji — USE IT at ${Math.round(H*0.18)}–${Math.round(H*0.24)}px, not a paragraph.
  Pain/frustration → 😩 😤 😫 💀 😭 ❌ 💸 ⏰
  Speed/power      → ⚡ 🚀 💨 🔥
  Security/trust   → 🔒 🛡️ ✅ 🤝
  Growth/success   → 📈 🏆 💪 🎯 ⭐
  AI/tech          → 🤖 🧠 ✨ 💡
  Money/savings    → 💰 💳 💸 🤑
  Data/analytics   → 📊 📋 📉
  Simple/easy      → ✅ 👌 🎯
  DO NOT use .icon or .icon-fill class — those render as raw text. Emoji only.
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

DESIGN YOUR OWN VISUAL for each scene — read the content, pick the best technique, code it fresh.
Every visual: position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
All props: max-width:${Math.round(W*0.84)}px; max-height:${Math.round(H*0.54)}px; overflow:hidden.

━━━ EMOJI STYLE — GLOBAL DIRECTIVE — applies to every emoji in the entire output ━━━
Selected style: ${emojiStyle === 'color' ? 'FULL COLOR' : emojiStyle === 'infill' ? 'INFILL (accent silhouette)' : 'OUTLINE (stroke only)'}
${emojiStyle !== 'color' ? `⚠️ MANDATORY: every emoji character in every scene MUST use the wrapper below. No bare emoji allowed.` : `Full color: use emoji as-is, no wrapper needed.`}

${emojiStyle === 'infill' ? `INFILL wrapper — copy this EXACTLY for every emoji (replace 😀 with your emoji):
  <div style="display:inline-block;position:relative;line-height:1;vertical-align:middle;">
    <div style="font-size:${Math.round(H*0.22)}px;line-height:1;filter:grayscale(1) brightness(0);">😀</div>
    <div style="position:absolute;inset:0;background:var(--acc);mix-blend-mode:screen;pointer-events:none;border-radius:6px;"></div>
  </div>` : ''}
${emojiStyle === 'outline' ? `OUTLINE wrapper — copy this EXACTLY for every emoji (replace 😀 with your emoji):
  <span style="font-size:${Math.round(H*0.22)}px;line-height:1;-webkit-text-stroke:4px var(--acc);color:transparent;display:inline-block;
               filter:drop-shadow(0 0 ${Math.round(H*0.018)}px color-mix(in srgb,var(--acc) 45%,transparent));">😀</span>` : ''}

━━━ TECHNIQUE A: CODED CSS VISUALS — use for 60%+ of all scenes ━━━
Pure CSS components. No emoji required. These look premium, always render, and match the brand aesthetic.
All entrance animations use CSS keyframes already defined in the <style> block (scaleIn, fadeUp, slideInL, etc).

── A1. STAGGERED CARD LIST — feature list, benefit list, bill list, model catalogue ──
Rows that slide in from left with animation-delay stagger. Use for 3-5 items.
  <div style="display:flex;flex-direction:column;gap:${Math.round(H*0.014)}px;width:100%;max-width:${Math.round(W*0.78)}px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:${Math.round(H*0.022)}px ${Math.round(W*0.04)}px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:${Math.round(H*0.018)}px;animation:slideInL 0.45s cubic-bezier(0.16,1,0.3,1) 0.10s both;">
      <div>
        <div style="font-size:${fsSub}px;font-weight:700;color:var(--fg);">Item Name</div>
        <div style="font-size:${fsBody}px;opacity:0.5;margin-top:3px;font-family:'JetBrains Mono',monospace;letter-spacing:0.05em;text-transform:uppercase;">CATEGORY</div>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${fsSub}px;color:var(--acc);padding:8px 16px;background:color-mix(in srgb,var(--acc) 12%,transparent);border-radius:8px;">Metric</div>
    </div>
    <!-- Row 2: same structure, animation-delay:0.20s — Row 3: 0.30s — Row 4: 0.40s — Row 5: 0.50s -->
  </div>
  LIGHT THEME variant: replace rgba(255,255,255,0.06)→rgba(12,11,20,0.04) and rgba(255,255,255,0.1)→rgba(12,11,20,0.08)

── A2. HERO STAT DISPLAY — large number, key metric, cost, count ──
Commanding number that fills the zone. Use for: $2,000/mo, 671B params, 100 people, 4.9★.
  <div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(H*0.015)}px;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:${Math.round(fsBody*1.1)}px;color:var(--acc);letter-spacing:0.18em;text-transform:uppercase;opacity:0.8;animation:fadeUp 0.4s ease 0.05s both;">CATEGORY LABEL</div>
    <div style="display:flex;align-items:baseline;gap:${Math.round(W*0.02)}px;animation:scaleIn 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;">
      <span style="font-size:${Math.round(fsStat*1.05)}px;font-weight:800;color:var(--acc);letter-spacing:-0.05em;line-height:0.95;font-family:'JetBrains Mono',monospace;">$2,000</span>
      <span style="font-size:${Math.round(fsSub*1.2)}px;font-weight:600;color:var(--fg);opacity:0.55;">/mo</span>
    </div>
    <div style="font-size:${fsBody}px;font-weight:500;opacity:0.45;letter-spacing:0.12em;text-transform:uppercase;animation:fadeUp 0.4s ease 0.5s both;">SUPPORTING CONTEXT</div>
  </div>

── A3. BADGE PILL + 2-COL CARD GRID — category header above grouped cards ──
Use for: model catalogue, plan tiers, feature groups, LoRA marketplace, option sets.
  <div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(H*0.022)}px;width:100%;max-width:${Math.round(W*0.78)}px;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:${Math.round(fsBody*0.95)}px;color:var(--acc);letter-spacing:0.16em;text-transform:uppercase;padding:10px 24px;background:color-mix(in srgb,var(--acc) 10%,transparent);border-radius:999px;border:1px solid color-mix(in srgb,var(--acc) 28%,transparent);animation:scaleIn 0.4s ease 0.05s both;">CATEGORY · LABEL</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:${Math.round(H*0.013)}px;width:100%;">
      <div style="padding:${Math.round(H*0.024)}px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:${Math.round(H*0.016)}px;display:flex;flex-direction:column;gap:6px;animation:scaleIn 0.4s cubic-bezier(0.34,1.4,0.64,1) 0.15s both;">
        <div style="width:14px;height:14px;border-radius:4px;background:var(--acc);box-shadow:0 0 10px color-mix(in srgb,var(--acc) 60%,transparent);"></div>
        <div style="font-size:${fsSub}px;font-weight:700;color:var(--fg);">Name</div>
        <div style="font-size:${fsBody}px;opacity:0.45;font-family:'JetBrains Mono',monospace;">Sub-label</div>
        <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:${fsSub}px;color:var(--acc);margin-top:4px;">Value</div>
      </div>
      <!-- Card 2: delay 0.25s — Card 3: 0.35s — Card 4: 0.45s -->
    </div>
  </div>
  LIGHT THEME: rgba(255,255,255,0.05)→rgba(12,11,20,0.03), rgba(255,255,255,0.1)→rgba(12,11,20,0.07)

── A4. TERMINAL WINDOW — CLI, code, download progress, technical scenes ──
Dark card with monospace text lines appearing with animation-delay stagger.
  <div style="width:${Math.round(W*0.72)}px;border-radius:${Math.round(H*0.022)}px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.45);animation:scaleIn 0.55s ease 0.1s both;">
    <div style="background:#1e1e2e;padding:12px 18px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="display:flex;gap:6px;"><div style="width:12px;height:12px;border-radius:50%;background:#ff5f57;"></div><div style="width:12px;height:12px;border-radius:50%;background:#febc2e;"></div><div style="width:12px;height:12px;border-radius:50%;background:#28c840;"></div></div>
      <div style="margin-left:auto;font-size:${Math.round(fsBody*0.82)}px;opacity:0.38;font-family:'JetBrains Mono',monospace;">~ terminal</div>
    </div>
    <div style="background:#0c0b14;padding:${Math.round(H*0.024)}px ${Math.round(W*0.038)}px;font-family:'JetBrains Mono',monospace;font-size:${Math.round(fsBody*1.02)}px;line-height:1.65;display:flex;flex-direction:column;gap:2px;">
      <div style="animation:fadeUp 0.3s ease 0.15s both;"><span style="color:#8a6cff;">$</span> <span style="color:#cfc7e3;">command --flag value</span></div>
      <div style="animation:fadeUp 0.3s ease 0.40s both;color:#a785ff;">→ Resolving...</div>
      <div style="animation:fadeUp 0.3s ease 0.65s both;color:#7a7388;">→ Output line 2</div>
      <div style="margin-top:8px;height:10px;border-radius:5px;background:rgba(255,255,255,0.07);overflow:hidden;animation:fadeUp 0.3s ease 0.85s both;">
        <div style="height:100%;background:linear-gradient(90deg,var(--acc),color-mix(in srgb,var(--acc) 65%,#fff));animation:growH 1.8s cubic-bezier(0.16,1,0.3,1) 0.9s both;width:0;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;color:#7a7388;font-size:${Math.round(fsBody*0.78)}px;animation:fadeUp 0.3s ease 1.1s both;margin-top:4px;"><span>100%</span><span style="color:#3ddc84;">✓ DONE · LOCAL</span></div>
    </div>
  </div>
  @keyframes growH{from{width:0}to{width:100%}}

── A5. NUMBERED ITEM GRID — office headcount, plan grid, tile matrix ──
Use for: showing N items (people, tasks, nodes, seats). Cells appear with stagger.
  <div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(H*0.02)}px;">
    <div style="display:grid;grid-template-columns:repeat(8,${Math.round(W*0.065)}px);gap:${Math.round(W*0.011)}px;">
      <!-- Write 24+ cells. Each: animation-delay increases by 0.015s per cell (0.05s, 0.065s, 0.08s...) -->
      <div style="width:${Math.round(W*0.065)}px;height:${Math.round(W*0.065)}px;border-radius:${Math.round(H*0.01)}px;background:color-mix(in srgb,var(--acc) 14%,transparent);border:1px solid color-mix(in srgb,var(--acc) 28%,transparent);display:grid;place-items:center;font-family:'JetBrains Mono',monospace;font-size:${Math.round(fsBody*0.65)}px;font-weight:700;color:var(--acc);animation:scaleIn 0.28s cubic-bezier(0.34,1.4,0.64,1) 0.05s both;">01</div>
      <!-- ...repeat with increasing animation-delay... -->
    </div>
    <div style="font-size:${Math.round(fsSub*1.1)}px;font-weight:800;color:var(--fg);letter-spacing:-0.03em;animation:fadeUp 0.5s ease 0.7s both;"><span style="color:var(--acc);">N</span> total count label</div>
  </div>

── A6. EMOJI HERO (last resort — max 2 per video, pure emotion scenes only) ──
Use ONLY for: pain hook opener, win/CTA closer, pure emotional beat with NO data to show.
EMOJI CONCEPT MAP:
  Pain/frustration → 😩 😤 😫 💀 😭   Problem/broken → ❌ 🚫 ⚠️ 💔
  Celebrate/win    → 🎉 🏆 ⭐ 🎊       Launch/growth  → 🚀 📈 💡 🔥
  Money/cost       → 💸 💰 💳 🤑       Security       → 🔒 🛡️ ✅
  Speed/AI         → ⚡ 🤖 🧠 ✨        Time/waiting   → ⏰ ⌛

  <div style="position:relative;display:inline-flex;align-items:center;justify-content:center;">
    <div style="position:absolute;width:${Math.round(H*0.32)}px;height:${Math.round(H*0.32)}px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--acc) 22%,transparent),transparent 70%);animation:pulse 2.5s ease infinite;pointer-events:none;"></div>
    <div style="font-size:${Math.round(H*0.22)}px;line-height:1;filter:drop-shadow(0 0 ${Math.round(H*0.025)}px color-mix(in srgb,var(--acc) 55%,transparent));animation:scaleIn 0.7s cubic-bezier(0.34,1.56,0.64,1) 0.1s both,float 3.5s ease-in-out 1s infinite;">🚀</div>
  </div>

━━━ TECHNIQUE B: MULTI-EMOJI STORY ━━━
Combine 2-3 large emoji to tell a visual story in one scene (e.g. pain arc: ❌📊😤):
  <div style="display:flex;align-items:center;justify-content:center;gap:${Math.round(W*0.04)}px;">
    <div style="font-size:${Math.round(H*0.14)}px;line-height:1;filter:drop-shadow(0 0 30px color-mix(in srgb,#ff4444 40%,transparent));animation:scaleIn 0.5s ease 0.1s both;">❌</div>
    <div style="font-size:${Math.round(H*0.1)}px;line-height:1;opacity:0.4;animation:scaleIn 0.5s ease 0.25s both;">→</div>
    <div style="font-size:${Math.round(H*0.14)}px;line-height:1;filter:drop-shadow(0 0 30px color-mix(in srgb,var(--acc) 40%,transparent));animation:scaleIn 0.5s ease 0.4s both;">✅</div>
  </div>
Use for: before/after, problem/solution, compare contrasts.

━━━ TECHNIQUE C: UI INTERACTION ANIMATIONS ━━━

Typing search bar (great for search/discovery/AI products):
  <div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(H*0.03)}px;width:100%;max-width:${Math.round(W*0.7)}px;">
    <div style="display:flex;align-items:center;gap:14px;width:100%;background:rgba(255,255,255,0.08);border:1.5px solid rgba(255,255,255,0.18);border-radius:100px;padding:18px 28px;animation:fadeUp 0.6s ease 0.2s both;box-shadow:0 0 40px color-mix(in srgb,var(--acc) 15%,transparent);">
      <span style="font-size:22px;opacity:0.5;flex-shrink:0;">🔍</span>
      <span id="q1" style="font-size:${fsSub}px;flex:1;font-weight:500;letter-spacing:-0.01em;"></span>
      <span style="width:2px;height:22px;background:var(--acc);animation:blink 0.8s step-end infinite;border-radius:1px;"></span>
    </div>
  </div>
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  // JS: typeText('q1', 'Find the best solution...', 55)
  // function typeText(id,txt,ms,cb){var el=document.getElementById(id),i=0;el.textContent='';var t=setInterval(function(){el.textContent=txt.slice(0,++i);if(i>=txt.length){clearInterval(t);if(cb)setTimeout(cb,600);}},ms);}

Browser window with URL typing:
  <div style="width:${Math.round(W*0.72)}px;border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.5);animation:scaleIn 0.6s ease 0.2s both;">
    <div style="background:#1e1e2e;padding:14px 18px;display:flex;align-items:center;gap:10px;">
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <div style="width:13px;height:13px;border-radius:50%;background:#ff5f57;"></div>
        <div style="width:13px;height:13px;border-radius:50%;background:#febc2e;"></div>
        <div style="width:13px;height:13px;border-radius:50%;background:#28c840;"></div>
      </div>
      <div style="flex:1;background:rgba(255,255,255,0.08);border-radius:8px;padding:7px 14px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:12px;opacity:0.4;">🔒</span>
        <span id="url1" style="font-size:13px;opacity:0.7;font-family:'JetBrains Mono',monospace;"></span>
      </div>
    </div>
    <!-- INNER SCREEN: style as a real mini-website — nav + hero section using actual brand content -->
    <div style="background:#0d0d1a;overflow:hidden;display:flex;flex-direction:column;max-height:${Math.round(H*0.48)}px;">
      <!-- Fake nav bar — use real brand name + real nav items from content -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 18px;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0;">
        <span style="font-weight:800;font-size:13px;color:var(--acc);">BrandName</span>
        <div style="display:flex;gap:14px;opacity:0.45;font-size:10px;"><span>Features</span><span>Pricing</span><span>Docs</span></div>
        <div style="background:var(--acc);color:#fff;padding:4px 12px;border-radius:20px;font-size:10px;font-weight:700;flex-shrink:0;">Get Started</div>
      </div>
      <!-- Fake hero section — big headline + short desc + CTA, all from real content -->
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px 20px;gap:8px;text-align:center;">
        <div style="font-size:18px;font-weight:900;letter-spacing:-0.03em;color:var(--fg);animation:fadeUp 0.5s ease 0.4s both;line-height:1.1;">Real Product Headline</div>
        <div style="font-size:10px;opacity:0.45;max-width:220px;line-height:1.4;">Short one-line description from the brand content.</div>
        <div style="display:flex;gap:8px;margin-top:6px;">
          <div style="background:var(--acc);color:#fff;padding:5px 14px;border-radius:20px;font-size:10px;font-weight:700;animation:scaleIn 0.4s ease 0.6s both;">Try Free</div>
          <div style="border:1px solid rgba(255,255,255,0.18);padding:5px 14px;border-radius:20px;font-size:10px;opacity:0.6;">Learn more</div>
        </div>
      </div>
    </div>
  </div>
  // JS: typeText('url1', 'yourdomain.com/product', 40)
  // IMPORTANT: Replace "BrandName", "Real Product Headline", description, and nav items with actual content from the brief.

Phone notification card (push notification sliding in):
  <div style="max-width:${Math.round(W*0.4)}px;width:100%;background:rgba(255,255,255,0.12);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.18);border-radius:20px;padding:18px 20px;display:flex;align-items:center;gap:14px;animation:slideInR 0.6s cubic-bezier(0.16,1,0.3,1) 0.4s both;box-shadow:0 8px 40px rgba(0,0,0,0.3);">
    <div style="width:44px;height:44px;border-radius:12px;background:var(--acc);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
      <span style="font-size:22px;">🔔</span>
    </div>
    <div>
      <div style="font-size:${fsBody}px;font-weight:700;">App Name</div>
      <div style="font-size:${Math.round(fsBody*0.9)}px;opacity:0.65;margin-top:3px;">Your notification message here</div>
    </div>
  </div>

Animated checklist (feature/benefit scenes):
  <div style="display:flex;flex-direction:column;gap:${Math.round(H*0.02)}px;max-width:${Math.round(W*0.55)}px;width:100%;">
    <!-- repeat 3-4 items with stagger delay -->
    <div style="display:flex;align-items:center;gap:16px;animation:slideInL 0.5s ease 0.1s both;">
      <div style="width:28px;height:28px;border-radius:50%;background:color-mix(in srgb,var(--acc) 20%,transparent);border:2px solid var(--acc);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <span style="font-size:14px;font-weight:700;color:var(--acc);">✓</span>
      </div>
      <span style="font-size:${fsSub}px;font-weight:500;">Benefit or feature statement</span>
    </div>
  </div>

Star rating reveal (social proof / testimonial):
  <div style="display:flex;flex-direction:column;align-items:center;gap:${Math.round(H*0.025)}px;">
    <div style="display:flex;gap:8px;">
      <!-- 5 stars, staggered scaleIn -->
      <span style="font-size:52px;color:#f59e0b;animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.1s both;filter:drop-shadow(0 0 12px rgba(245,158,11,0.6));">★</span>
      <span style="font-size:52px;color:#f59e0b;animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;filter:drop-shadow(0 0 12px rgba(245,158,11,0.6));">★</span>
      <!-- repeat for 5 stars -->
    </div>
    <div style="font-size:${fsStat}px;font-family:'JetBrains Mono',monospace;font-weight:700;color:var(--acc);">4.9</div>
    <div style="font-size:${fsBody}px;opacity:0.6;">from 2,400+ reviews</div>
  </div>

━━━ TECHNIQUE D: ANIMATED SVG ICON (draw-in effect) ━━━
Draw a path stroke-by-stroke — works for logos, arrows, checkmarks, shapes:
  <svg viewBox="0 0 80 80" width="${Math.round(Math.min(W,H)*0.2)}px" height="${Math.round(Math.min(W,H)*0.2)}px" fill="none">
    <circle cx="40" cy="40" r="36" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
    <path d="M22 40 L34 52 L58 28" stroke="var(--acc)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"
          stroke-dasharray="60" stroke-dashoffset="60" style="animation:drawPath 0.8s ease-out 0.5s forwards;"/>
  </svg>
  @keyframes drawPath{to{stroke-dashoffset:0}}

━━━ TECHNIQUE E: DATA PROPS ━━━
(use when content is about metrics, growth, performance)

Vertical bar chart:
  <div style="display:flex;align-items:flex-end;gap:${Math.round(W*0.015)}px;height:${Math.round(H*0.28)}px;max-width:${Math.round(W*0.65)}px;padding-bottom:8px;">
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;">
      <span style="font-size:${Math.round(fsBody*0.85)}px;opacity:0.6;font-family:'JetBrains Mono',monospace;">75%</span>
      <div style="width:100%;background:var(--acc);border-radius:6px 6px 0 0;--h:75%;height:var(--h);animation:growBar 1.2s cubic-bezier(0.16,1,0.3,1) 0.1s both;max-height:100%;"></div>
      <span style="font-size:${Math.round(fsBody*0.85)}px;opacity:0.5;">Jan</span>
    </div>
    <!-- repeat with different --h and animation-delay per bar -->
  </div>
  @keyframes growBar{from{height:0}to{height:var(--h,50%)}}
  @keyframes growH{from{width:0}to{width:100%}}

Donut chart:
  <svg width="${Math.round(Math.min(W,H)*0.22)}" height="${Math.round(Math.min(W,H)*0.22)}" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="14"/>
    <circle cx="60" cy="60" r="46" fill="none" stroke="var(--acc)" stroke-width="14" stroke-linecap="round"
            stroke-dasharray="0 290" transform="rotate(-90 60 60)"
            style="animation:dashIn 1.4s cubic-bezier(0.16,1,0.3,1) 0.3s both;"/>
    <text x="60" y="56" text-anchor="middle" font-size="18" font-weight="700" fill="var(--fg)">87%</text>
    <text x="60" y="72" text-anchor="middle" font-size="9" fill="var(--fg)" opacity="0.5">satisfied</text>
  </svg>
  @keyframes dashIn{from{stroke-dasharray:0 290}to{stroke-dasharray:230 60}}

Stat cards (use fsCardNum NOT fsStat — fsStat overflows cards):
  <div style="display:flex;gap:${Math.round(W*0.02)}px;max-width:${Math.round(W*0.84)}px;width:100%;">
    <div style="flex:1;min-width:0;max-width:${Math.round(W*0.26)}px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:${Math.round(H*0.025)}px ${Math.round(W*0.012)}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(H*0.008)}px;overflow:hidden;animation:scaleIn 0.5s ease 0.1s both;">
      <div style="font-size:28px;line-height:1;flex-shrink:0;">📈</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:${fsCardNum}px;font-weight:700;color:var(--acc);line-height:1;white-space:nowrap;" data-suffix="%">0</div>
      <div style="font-size:${fsBody}px;opacity:0.55;text-align:center;max-width:90%;">Label</div>
    </div>
  </div>

countUp JS (always include with data):
  function countUp(el,to,ms){var s=Date.now(),suf=el.dataset.suffix||'';(function f(){var p=Math.min((Date.now()-s)/ms,1),e=1-Math.pow(1-p,3);el.textContent=Math.round(to*e)+suf;if(p<1)requestAnimationFrame(f);})();}
  // trigger: scene.addEventListener('animationstart',function(ev){if(ev.animationName==='clipIn')document.querySelectorAll('[data-suffix]').forEach(function(el){countUp(el,+el.textContent||99,1800);});},{once:false});

typeText JS helper (for typing animations):
  function typeText(id,txt,ms,cb){var el=document.getElementById(id),i=0;if(!el)return;el.textContent='';var t=setInterval(function(){el.textContent=txt.slice(0,++i);if(i>=txt.length){clearInterval(t);if(cb)setTimeout(cb,800);}},ms);}
  // start typing on scene appear: document.getElementById('scene-NAME').addEventListener('animationstart',function(ev){if(ev.animationName==='clipIn')typeText('typed-el','Your search query...',50);},{once:false});

━━━ TECHNIQUE F: TEXT REVEAL + ATMOSPHERE ━━━

Clip-path word reveal (cinematic title entrance — split headline into word spans):
  <h1 style="display:flex;flex-wrap:wrap;gap:0.22em;justify-content:center;font-size:${fsHero}px;font-weight:900;letter-spacing:-0.04em;line-height:0.95;">
    <span style="display:inline-block;clip-path:inset(0 0 100% 0);animation:revealWord 0.65s cubic-bezier(0.16,1,0.3,1) 0.05s forwards;">First</span>
    <span style="display:inline-block;clip-path:inset(0 0 100% 0);animation:revealWord 0.65s cubic-bezier(0.16,1,0.3,1) 0.22s forwards;">Word</span>
    <span style="display:inline-block;clip-path:inset(0 0 100% 0);animation:revealWord 0.65s cubic-bezier(0.16,1,0.3,1) 0.39s forwards;color:var(--acc);">Accent</span>
  </h1>
  @keyframes revealWord{to{clip-path:inset(0 0 -10% 0)}}

Gradient text shine (accent sweep across headline):
  <h1 style="font-size:${fsHero}px;font-weight:900;letter-spacing:-0.04em;background:linear-gradient(90deg,var(--fg) 0%,var(--acc) 45%,var(--fg) 100%);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:textShine 2.8s linear infinite;">Headline</h1>
  @keyframes textShine{to{background-position:200% center}}

Character stagger (short brand name / acronym):
  <div style="display:flex;gap:0.02em;font-size:${fsHero}px;font-weight:900;letter-spacing:-0.04em;">
    <span style="display:inline-block;animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.05s both;">N</span>
    <span style="display:inline-block;animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.12s both;">I</span>
    <span style="display:inline-block;animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1) 0.19s both;color:var(--acc);">V</span>
    <!-- one <span> per letter, stagger delay by 0.07s each -->
  </div>

Morphing glow blob (living background orb — always z-index:0, pointer-events:none):
  <div style="position:absolute;width:${Math.round(W*0.65)}px;height:${Math.round(W*0.65)}px;left:50%;top:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,color-mix(in srgb,var(--acc) 28%,transparent),transparent 70%);animation:blobMorph 6s ease-in-out infinite;filter:blur(${Math.round(W*0.045)}px);z-index:0;pointer-events:none;"></div>
  @keyframes blobMorph{0%,100%{border-radius:60% 40% 30% 70% / 60% 30% 70% 40%;transform:translate(-50%,-50%) scale(1);}50%{border-radius:30% 60% 70% 40% / 50% 60% 30% 60%;transform:translate(-50%,-50%) scale(1.1);}}

Shimmer sweep (card highlight — great with stat/glass cards):
  Add to a card: position:relative;overflow:hidden — then inside it:
  <div style="position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,color-mix(in srgb,var(--acc) 20%,transparent) 50%,transparent 60%);background-size:200% 100%;animation:shimmer 2s linear infinite;pointer-events:none;border-radius:inherit;"></div>
  @keyframes shimmer{from{background-position:-200% 0}to{background-position:200% 0}}

Floating particles (depth for brand/opening scenes):
  Generate 6-10 small divs absolutely positioned, each a tiny circle:
  <div style="position:absolute;width:6px;height:6px;border-radius:50%;background:var(--acc);opacity:0.5;left:15%;top:25%;animation:float 4s ease-in-out infinite;animation-delay:0s;"></div>
  <div style="position:absolute;width:4px;height:4px;border-radius:50%;background:var(--fg);opacity:0.25;left:75%;top:65%;animation:float 5s ease-in-out infinite;animation-delay:1.3s;"></div>
  <!-- vary size (3-8px), opacity (0.2-0.6), position, and animation-delay for each particle -->

Spotlight beam (hero/opening scenes):
  <div style="position:absolute;top:-20%;left:30%;width:${Math.round(W*0.4)}px;height:${Math.round(H*1.4)}px;background:linear-gradient(180deg,color-mix(in srgb,var(--acc) 15%,transparent),transparent 70%);transform:rotate(-15deg);transform-origin:top center;animation:blurIn 1.2s ease 0.3s both;pointer-events:none;z-index:0;"></div>

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
:root{--bg:#111118;--fg:#f1f5f9;--acc:#6d4cff;}  /* ← ALWAYS OVERRIDE based on user prompt — white/light prompt → --bg:#f8f9fa --fg:#111827 */
body{position:relative;background:var(--bg);color:var(--fg);}
.clip{position:absolute;inset:0;display:none;overflow:hidden;}
.sub{position:absolute;bottom:${Math.round(H*0.022)}px;left:${Math.round(W*0.05)}px;right:${Math.round(W*0.05)}px;padding:${subPad}px ${Math.round(W*0.04)}px;background:linear-gradient(transparent,rgba(0,0,0,0.7));font-size:${subFs}px;color:#fff;font-weight:500;text-align:center;line-height:1.4;border-radius:0 0 10px 10px;}
/* LIGHT THEME: color:#111827 !important; background:linear-gradient(transparent,rgba(248,249,250,0.96)) !important; */
/* ─── @keyframes ─────────────────────────────────────────── */
@keyframes fadeUp   { from{opacity:0;transform:translateY(44px)}  to{opacity:1;transform:translateY(0)} }
@keyframes scaleIn  { from{opacity:0;transform:scale(0.7)}        to{opacity:1;transform:scale(1)} }
@keyframes slideInL { from{opacity:0;transform:translateX(-56px)} to{opacity:1;transform:translateX(0)} }
@keyframes blurIn   { from{opacity:0;filter:blur(20px)}           to{opacity:1;filter:blur(0)} }
@keyframes clipIn   { from{opacity:0}                             to{opacity:1} }
@keyframes float    { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-14px)} }
@keyframes pulse    { 0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 55%,transparent)} 50%{box-shadow:0 0 0 22px transparent} }
@keyframes fillBar  { from{width:0} to{width:var(--pct,80%)} }
@keyframes growBar  { from{height:0} to{height:var(--h,50%)} }
@keyframes dashIn   { from{stroke-dasharray:0 290} to{stroke-dasharray:230 60} }
@keyframes drawPath { to{stroke-dashoffset:0} }
@keyframes blink    { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes revealWord { to{clip-path:inset(0 0 -10% 0)} }
@keyframes textShine  { to{background-position:200% center} }
@keyframes blobMorph  { 0%,100%{border-radius:60% 40% 30% 70% / 60% 30% 70% 40%} 50%{border-radius:30% 60% 70% 40% / 50% 60% 30% 60%} }
@keyframes shimmer    { from{background-position:-200% 0} to{background-position:200% 0} }
.clip *{box-sizing:border-box;max-width:100%;}
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
0. READ USER PROMPT FIRST: extract (a) color preference → set theme, (b) narrative arc → order scenes exactly, (c) platform → adjust pacing. These override all defaults.
   EMOJI RULE: NEVER use .icon or .icon-fill CSS classes — Material Symbols DO NOT LOAD and render as raw text. Use emoji sparingly (max 2 scenes). Default to coded CSS visuals (TECHNIQUE A) for all product, feature, data, and benefit scenes.
1. Output ONLY raw HTML — starts with <!DOCTYPE html>. Zero markdown, zero explanation.
2. Copy the PLAYBACK + CLIP RUNTIME block VERBATIM between the comment markers. Never alter it.
3. Override :root { --bg, --fg, --acc } with content-derived colors. NEVER default to #6d4cff purple.
4. Use var(--bg)/var(--fg)/var(--acc) everywhere — no hardcoded hex in element styles, ever.
5. Every .clip MUST contain a .sub element with real voice-over text derived from the content.
6. All visible text comes from user content — no placeholders, no "Lorem ipsum", no generic labels.
7. html,body must stay width:${W}px; height:${H}px; overflow:hidden.
8. VISUAL HIERARCHY: default to coded CSS visuals (TECHNIQUE A) for all product, feature, and data scenes. Emoji is permitted ONLY as a pure emotion anchor (pain hook, win CTA) — max 2 scenes per video. No emoji in subtitle or body copy. Material Symbols (.icon, .icon-fill classes) are NOT available and render as raw text — never use them.
9. Scene times: last clip's data-start + data-duration = ${duration}. No gaps. No overlaps.
10. Every scene must have a distinct visual prop — no two scenes with the same layout.
11. 3-ZONE LAYOUT — mandatory every scene:
    TOP    = 1-4 keyword words, accent color, centered.
    MIDDLE = visual prop. Text allowed ONLY inside a UI shell (search bar typing, browser window, app screen, phone mockup). Naked sentences/labels/headings in the middle zone = rejected.
    BOTTOM = .sub caption only (max 10 words).
    Wrong: a sentence floating in ZONE 2. Right: that sentence typed into a search bar, or shown on a browser screen.
12. ZONE POSITIONING: TOP zone uses position:absolute + top:${Math.round(H*0.055)}px. MIDDLE zone uses top:${Math.round(H*0.24)}px bottom:${Math.round(H*0.14)}px. Both zones center their content with display:flex+align-items:center+justify-content:center. NEVER arbitrary top/left pixel values.
13. SIZE BOUNDS: no element wider than ${Math.round(W*0.9)}px or taller than ${Math.round(H*0.7)}px. Use max-width/max-height on every visual prop.
18. FONT-IN-CONTAINER: when text/number sits inside a bounded box (card, badge, circle, square):
    font-size MUST be ≤ box_height × 0.38. Example: a ${Math.round(H*0.15)}px tall card → max font-size ${Math.round(H*0.15*0.38)}px.
    Always add overflow:hidden + display:flex + align-items:center + justify-content:center to the box.
    NEVER use fsStat (${fsStat}px) inside a box shorter than ${Math.round(fsStat*2.6)}px.
19. NARRATIVE CONTRACT: if user's prompt specifies a story arc, the scene order MUST follow it. "Pain first" = first 3-4 scenes show the user's problem — no product yet. Then pivot.
22. SAFE ZONE: no content div may have left:0 or right:0. Always use at least left:${Math.round(W*0.05)}px; right:${Math.round(W*0.05)}px on every zone container. The viewport border must stay visibly empty on all sides.
20. LIGHT-THEME SUBTITLE: if --bg is light, override .sub in <style> with: color:#111827 !important; background:linear-gradient(transparent,rgba(248,249,250,0.95)) !important;
14. OVERFLOW — CRITICAL: every .clip has overflow:hidden. Every direct child of ZONE 2 must also have overflow:hidden + max-width:100%. NEVER use position:absolute on content children inside ZONE 2 — they will escape the clip boundary. Use display:flex or display:grid for layout inside zones. If content looks squished, use fewer items or a smaller font-size, NOT a larger container.
24. ZONE 2 SIZING: the middle zone is ${Math.round(H*0.62)}px tall × ${Math.round(W*0.9)}px wide. A staggered card list of 4 rows should use row height ≈ ${Math.round(H*0.62/4*0.85)}px. A 2-col grid of 4 cards should use card height ≈ ${Math.round(H*0.62/2*0.85)}px. Never pack more items than fit — split across scenes if needed.
21. FILL THE MIDDLE ZONE: the visual prop in ZONE 2 should fill the available height (${Math.round(H*0.24)}px to ${Math.round(H*(1-0.14))}px = ${Math.round(H*0.62)}px tall). Make emoji/charts/cards large enough to occupy this space naturally — no tiny visuals floating in a giant empty zone.
15. SUBTITLE LENGTH: max 10 words per .sub. If you need more — split the info across 2 scenes. Subtitles should sound like speech, not captions.
16. VISUAL-FIRST: A viewer watching with sound OFF must understand each scene from the visual + headline alone. If the visual alone doesn't communicate the message, replace or enhance it.
17. BROWSER MOCKUP RULE: If you use a browser frame, the inner screen MUST be a styled mini-website (fake nav + hero section + CTAs using real brand content). NEVER put plain text inside a browser frame.
23. EMOJI STYLE ENFORCEMENT: Emoji style = ${emojiStyle === 'color' ? 'FULL COLOR — use emoji as-is, no wrapper needed' : emojiStyle === 'infill' ? 'INFILL — wrap every single emoji with the infill div shown in the GLOBAL DIRECTIVE above. Bare emoji without the mix-blend-mode wrapper = INVALID.' : 'OUTLINE — wrap every single emoji with the outline span shown in the GLOBAL DIRECTIVE above. Bare emoji without -webkit-text-stroke = INVALID.'}
25. MINIMUM FONT SIZE: No text element in any scene may use font-size smaller than ${Math.round(H*0.018)}px. Labels inside cards, badges, subtitles — all ≥ ${Math.round(H*0.018)}px. Tiny invisible text = failed output. Reduce item count instead of shrinking font-size.`;
}

function buildContentExtractPrompt(): string {
  return `You are a content analyst extracting brand/product data for a marketing video.

Read the ENTIRE document carefully. Extract ALL key information into this JSON:
{
  "brandName": "string",
  "tagline": "string or null",
  "description": "1-2 sentence product description",
  "features": ["every feature mentioned"],
  "benefits": ["every user benefit mentioned"],
  "metrics": [{"value": "99%", "label": "uptime"}, ...],
  "targetAudience": "string",
  "tone": "professional|playful|bold|minimal|energetic",
  "keyMessages": ["every key marketing message"],
  "callToAction": "string or null",
  "uniqueSellingPoints": ["every USP"],
  "useCases": ["every use case mentioned"],
  "pricing": "string or null"
}

Rules:
- Extract EVERY number, percentage, statistic from the document — miss nothing
- Extract ALL features, benefits, use cases — miss nothing
- Use exact words from the document where possible
- If information is absent, use null or empty array
- Output ONLY valid JSON, no explanation`;
}

function buildScriptPrompt(sceneCount: number, duration: number): string {
  return `You are a marketing video scriptwriter specializing in short-form social media videos.

Given brand content and a user brief, write a scene-by-scene script.

Output a JSON array of exactly ${sceneCount} scenes with durations summing to ${duration} seconds:
[
  {
    "id": "scene-hook",
    "title": "Opening Hook",
    "duration": 4,
    "headline": "Max 5 words, punchy screen text",
    "subtitle": "Max 10 words. Conversational voice-over. Like speech.",
    "visualProp": "ICON_HERO|EMOJI_HERO|TYPING_SEARCH|BROWSER_MOCKUP|STAT_CARDS|BAR_CHART|DONUT_CHART|CHECKLIST|NOTIFICATION|WORD_REVEAL|BLOB_GLOW|FEATURE_GRID|DEVICE_MOCKUP",
    "visualDetails": "Specific content: exact icon name OR emoji OR what data/stat to show OR what to type OR what feature names to list",
    "keyword": "1-4 word key phrase for top zone (accent colored)",
    "textReveal": "NONE|CLIP_PATH|CHAR_STAGGER|GRADIENT_SHINE",
    "atmosphere": "NONE|BLOB_MORPH|SHIMMER_CARD|PARTICLES|SPOTLIGHT",
    "mood": "energetic|calm|bold|minimal|data",
    "accentHint": "color name that fits this scene emotion",
    "theme": "light|dark"
  }
]

Script writing rules:
- READ USER BRIEF for color preference FIRST. "white"/"light"/"clean" → theme:light for ALL scenes. "dark"/"black" → theme:dark. No signal → theme:dark.
- LIGHT THEME scenes: backgrounds = soft gradients on white, accent colors = vivid (readable on white), subtitle text = dark.
- NARRATIVE ARC: if user brief specifies "pain then solution" or "problem first":
    Scenes 1-4: show the USER'S PAIN — relatable frustrations, problems, the "before" state. Do NOT mention the product yet.
    Scenes 5-N-1: introduce and demonstrate the SOLUTION (the product) — features, benefits, proof.
    Last scene: CTA — brand name + call to action.
  If no arc specified: scene 1 = hook, middle = features/proof, last = CTA.
- Scene 1: powerful hook matching the arc (pain hook OR brand reveal)
- Middle scenes: each covers ONE distinct feature/benefit/USP from content — spread all key info
- Last scene: CTA with brand name + call to action
- EVERY key feature and metric from the content must appear in some scene
- Each scene must be visually self-explanatory — no scene needs its subtitle to make sense
- keyword: the 1-4 important words that go TOP of the scene in accent color. For pain: "Still Struggling?", "Wasted Hours", "Sound Familiar?". For solution: "Fixed.", "Instant Results", brand name.
- Subtitle = voice-over narration (max 10 words, sounds like speech not text)
- Headline = screen text (max 5 words, punchy, no full sentences)
- For pain scenes: visualProp must be EMOJI_HERO or ICON_HERO (emotional icon/emoji — NOT text, NOT charts)
- NEVER put a sentence or description in the main content area — it belongs in subtitle
- Duration: 3-5 seconds per scene for a fast-paced professional feel
- Sum of all durations MUST equal ${duration}
- Output ONLY valid JSON array, no explanation`;
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
  return `Current HTML:\n\`\`\`html\n${currentHtml.slice(0, 80000)}\n\`\`\`\n\nInstruction: "${instruction}"\n\nReturn the COMPLETE updated HTML starting with <!DOCTYPE html>. Keep everything not mentioned unchanged.`;
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
    if (raw.includes('</html>') || len > 18000) return 'Finalizing…';
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
  const { session, profile } = useAuth();
  const callIdRef  = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef  = useRef<HTMLIFrameElement>(null);

  const [type,           setType]           = useState<ProjectType>('video');
  const [format,         setFormat]         = useState<Format>(FORMATS.video[0]);
  const [duration,       setDuration]       = useState(15);
  const [style,          setStyle]          = useState(STYLES[0].id);
  const emojiStyle = 'infill' as const;
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
  const [showSuggest,    setShowSuggest]    = useState(false);
  const [suggestText,    setSuggestText]    = useState('');
  const [suggestSending, setSuggestSending] = useState(false);
  const [suggestSent,    setSuggestSent]    = useState(false);
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
    setConnMode('adris.tech AI');
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
      let krewUserMsg: string;
      if (ctx && ctx.length > 800) {
        setStreamLog('Reading content…');
        let extracted = '';
        try {
          extracted = await streamAI(buildContentExtractPrompt(), `Document:\n${ctx.slice(0, 25000)}`, () => {});
          extracted = stripFences(extracted);
        } catch { extracted = ''; }
        setStreamLog('Writing script…');
        const sc = getSceneCount(dur);
        let script = '';
        try {
          script = await streamAI(buildScriptPrompt(sc, dur), `Brand content:\n${extracted || ctx.slice(0, 12000)}\n\nBrief:\n${p}`, () => {});
          script = stripFences(script);
        } catch { script = ''; }
        krewUserMsg = script.length > 50
          ? `Scene script:\n${script}\n\nBrief:\n${p}`
          : ctx ? `Brand context:\n${ctx.slice(0, 20000)}\n\nCreate:\n${p}` : `Create:\n${p}`;
      } else {
        krewUserMsg = ctx ? `Brand context:\n${ctx}\n\nCreate:\n${p}` : `Create:\n${p}`;
      }
      setStreamLog('Building scenes…');
      const sysPrompt = buildVideoPrompt(fmt, dur, activeAgent?.bias, emojiStyle);
      await streamAI(sysPrompt, krewUserMsg, (chunk) => { raw += chunk; setStreamLog(getStreamPhase(raw, 'video')); });
      const stripped = stripFences(raw);
      const finalHtml = applyEmojiStyle(assembleVideoHtml(stripped, fmt, dur), emojiStyle);
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
            messages: [{ role: 'user', content: `Brand content:\n\n${contextFile.content.slice(0, 20000)}` }],
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
        let videoUserMsg: string;
        if (ctx && ctx.length > 800) {
          // ── Stage 1: Extract structured content from the file ─────────────
          setStreamLog('Reading content…');
          let extracted = '';
          try {
            extracted = await streamAI(buildContentExtractPrompt(), `Document:\n${ctx.slice(0, 25000)}`, () => {});
            extracted = stripFences(extracted);
          } catch { extracted = ''; }
          // ── Stage 2: Write scene-by-scene script ──────────────────────────
          setStreamLog('Writing script…');
          const sc = getSceneCount(effectiveDur);
          let script = '';
          try {
            script = await streamAI(
              buildScriptPrompt(sc, effectiveDur),
              `Brand content:\n${extracted || ctx.slice(0, 12000)}\n\nUser brief:\n${prompt}`,
              () => {}
            );
            script = stripFences(script);
          } catch { script = ''; }
          videoUserMsg = script.length > 50
            ? `Scene script (implement each scene EXACTLY — visual prop, headline, subtitle are specified):\n${script}\n\nUser brief:\n${prompt}`
            : `Brand/product context:\n${ctx.slice(0, 20000)}\n\nCreate this animation:\n${prompt}`;
        } else {
          videoUserMsg = ctx
            ? `Brand/product context:\n${ctx}\n\nCreate this animation:\n${prompt}`
            : `Create this animation:\n${prompt}`;
        }
        // ── Stage 3: Generate HTML/CSS video from script ──────────────────
        setStreamLog('Building scenes…');
        const sysPrompt = buildVideoPrompt(format, effectiveDur, activeAgent?.bias, emojiStyle);
        await streamAI(sysPrompt, videoUserMsg, (chunk) => {
          raw += chunk;
          setStreamLog(getStreamPhase(raw, 'video'));
        });
        const stripped = stripFences(raw);
        const finalHtml = applyEmojiStyle(assembleVideoHtml(stripped, format, effectiveDur), emojiStyle);
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
Return the COMPLETE updated HTML starting with <!DOCTYPE html>. The output must be at least as long as the input HTML.

Rules:
1. Keep the // ── PLAYBACK + CLIP RUNTIME block VERBATIM — never modify it
2. Keep all .clip data-start and data-duration values unless timing is explicitly requested to change
3. Keep :root { --bg, --fg, --acc } — use CSS variables, never hardcode hex in element styles
4. Every .clip must keep its .sub subtitle div
5. Preserve all visual content including emoji, animations, and keyframes — only change what the instruction asks
6. html,body must stay width/height fixed with overflow:hidden
7. Apply ONLY the requested changes — preserve everything else exactly
8. Output the full HTML — never truncate or summarise`
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
      // Safety: don't apply if the result is shorter than half the original (LLM truncated)
      if (updated.length < (html?.length ?? 0) * 0.5) {
        throw new Error('Refine returned incomplete HTML — try again');
      }
      if (isVideo) updated = applyEmojiStyle(updated, emojiStyle);
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
      setContextFile({ name: file.name, content });
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

  async function handleSuggest() {
    if (!suggestText.trim()) return;
    setSuggestSending(true);
    try {
      await supabase.from('suggestions').insert({
        user_id: session?.user.id,
        email: profile?.email ?? session?.user.email,
        message: suggestText.trim(),
      });
      setSuggestSent(true);
      setTimeout(() => { setShowSuggest(false); setSuggestSent(false); setSuggestText(''); }, 2200);
    } catch { /* silent */ } finally { setSuggestSending(false); }
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
    <div className="flex flex-col h-full overflow-hidden bg-nv-bg">


      <div className="flex flex-1 overflow-hidden">

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
                {t === 'video' && <span className="ml-auto text-[7px] font-mono bg-accent/15 text-accent px-1 py-0.5 rounded leading-none">β</span>}
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

      {showSuggest && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSuggest(false); }}
        >
          <div className="bg-nv-surface border border-nv-border rounded-2xl p-5 w-80 shadow-2xl flex flex-col gap-3">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[13px] font-semibold text-nv-text">Suggest an Improvement</span>
              <button
                onClick={() => setShowSuggest(false)}
                className="w-6 h-6 flex items-center justify-center text-nv-faint hover:text-nv-text rounded-lg hover:bg-nv-surface2 transition-fast text-base leading-none"
              >×</button>
            </div>
            {suggestSent ? (
              <div className="flex flex-col items-center gap-2 py-6 text-nv-ok">
                <svg viewBox="0 0 20 20" fill="none" className="w-7 h-7">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" opacity=".3"/>
                  <path d="M6.5 10l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[12px] font-medium">Thanks! We’ll look into it.</span>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-nv-faint -mt-1">What could be better? Describe a visual issue, missing feature, or quality problem.</p>
                <textarea
                  value={suggestText}
                  onChange={(e) => setSuggestText(e.target.value)}
                  placeholder="e.g. Scene text is too small, or animations feel choppy…"
                  rows={4}
                  className="bg-nv-bg border border-nv-border rounded-xl px-3 py-2 text-[12px] text-nv-text placeholder-nv-faint/60 outline-none focus:border-accent/50 transition-fast resize-none leading-relaxed"
                  autoFocus
                />
                <button
                  onClick={handleSuggest}
                  disabled={suggestSending || !suggestText.trim()}
                  className="flex items-center justify-center gap-2 py-2.5 bg-accent text-white text-[12px] font-semibold rounded-xl hover:bg-accent-dim transition-fast disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {suggestSending ? <span className="w-3 h-3 rounded-full border border-white/30 border-t-white animate-spin shrink-0" /> : null}
                  {suggestSending ? 'Sending…' : 'Send Suggestion'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
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
