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

// Builds the canonical JS runtime for a given canvas size — the single source of truth
function buildVideoRuntime(W: number, H: number, duration: number): string {
  const subSide   = Math.round(W * 0.074);
  const subBottom = Math.round(H * 0.08);
  const subFont   = Math.round(W * 0.038);
  const subLH     = Math.round(subFont * 1.45);
  return `window.onerror=function(msg,src,ln){var c=document.getElementById('c')||document.querySelector('canvas');if(!c)return;var x=c.getContext('2d');var fs=Math.round(Math.min(c.width,c.height)*0.04);x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.font='bold '+fs+'px monospace';x.fillStyle='rgba(160,0,0,.9)';x.textAlign='center';x.textBaseline='middle';x.fillText(String(msg).slice(0,80),c.width/2,c.height/2-fs);x.fillText('(line '+ln+')',c.width/2,c.height/2+fs);};
var canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
var W=${W},H=${H},DUR=${duration};
var _T=0,_L=null;
var C=function(v,a,b){return v<a?a:v>b?b:v;};
var E={o3:function(t){t--;return t*t*t+1;},i3:function(t){return t*t*t;},io:function(t){return t<.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1;},bk:function(t){var c=1.70158;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);},el:function(t){return t<=0?0:t>=1?1:Math.pow(2,-10*t)*Math.sin((t*10-.75)*2.094)+1;},si:function(t){return Math.sin(t*Math.PI/2);}};
function sp(s,e){if(_T<s||_T>e)return null;var lt=_T-s,dur=e-s,eD=0.45,xD=0.35,xS=dur-xD,op=1,ty=0;if(lt<eD){var p=E.o3(C(lt/eD,0,1));op=p;ty=(1-p)*32;}else if(lt>xS){var p2=E.i3(C((lt-xS)/xD,0,1));op=1-p2;ty=-p2*20;}return{lt:lt,op:op,ty:ty,p:C(lt/dur,0,1)};}
function lp(a,b,s,e,ef){ef=ef||E.o3;return a+(b-a)*ef(C((_T-s)/(e-s),0,1));}
function cu(n,s,d,ef){ef=ef||E.o3;return Math.round(n*ef(C((_T-s)/d,0,1)));}
function tx(t,x,y,fs,clr,w,al,ba){ctx.font=(w||600)+' '+(fs||36)+'px "Inter Tight",system-ui';ctx.fillStyle=clr||'#0c0b14';ctx.textAlign=al||'center';ctx.textBaseline=ba||'middle';ctx.fillText(t,x,y);}
function txm(t,x,y,fs,clr){ctx.font='700 '+(fs||48)+'px "JetBrains Mono",monospace';ctx.fillStyle=clr||'#6d4cff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t,x,y);}
function txWrap(lines,x,yc,fs,clr,wt,lhh){var n=lines.length,ly=yc-(n-1)*(lhh||fs*1.25)/2;for(var i=0;i<n;i++)tx(lines[i],x,ly+i*(lhh||fs*1.25),fs,clr,wt);}
function rr(x,y,w,h,r,fill,sc,sb){ctx.save();if(sc){ctx.shadowColor=sc;ctx.shadowBlur=sb||20;}ctx.fillStyle=fill||'#fff';r=Math.min(r||20,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();ctx.fill();ctx.restore();}
function sub(text,op,color){if(!op||op<=0)return;ctx.save();ctx.globalAlpha=op;ctx.font='600 ${subFont}px "Inter Tight",system-ui';ctx.textAlign='center';ctx.textBaseline='alphabetic';var mw=W-${subSide*2},words=text.split(' '),lines=[],cur='';for(var i=0;i<words.length;i++){var tl=cur?(cur+' '+words[i]):words[i];if(ctx.measureText(tl).width>mw&&cur){lines.push(cur);cur=words[i];}else cur=tl;}lines.push(cur);var lh=${subLH},bH=lines.length*lh+12,bY=H-${subBottom}-lines.length*lh-10;rr(${subSide},bY,W-${subSide*2},bH,10,'rgba(255,255,255,0.88)');ctx.fillStyle=color||'#0c0b14';for(var j=0;j<lines.length;j++)ctx.fillText(lines[j].trim(),W/2,H-${subBottom}-(lines.length-1-j)*lh);ctx.restore();}
function subHL(a,hl,b,op){if(!op||op<=0)return;ctx.save();ctx.globalAlpha=op;ctx.font='600 ${subFont}px "Inter Tight",system-ui';ctx.textBaseline='alphabetic';ctx.textAlign='left';var wa=ctx.measureText(a).width,wh=ctx.measureText(hl).width,wb=ctx.measureText(b).width;var tot=wa+wh+wb,x=W/2-tot/2,y=H-${subBottom};rr(x-16,y-${subFont}-6,tot+32,${subFont}+18,10,'rgba(255,255,255,0.88)');ctx.fillStyle='#0c0b14';ctx.fillText(a,x,y);ctx.fillStyle='#6d4cff';ctx.fillText(hl,x+wa,y);ctx.fillStyle='#0c0b14';ctx.fillText(b,x+wa+wh,y);ctx.restore();}
function ripple(cx,cy,st,n){n=n||3;for(var i=0;i<n;i++){var p=C((_T-st-i*0.3)/1.8,0,1);if(p<=0||p>=1)continue;ctx.save();ctx.globalAlpha=(1-p)*0.5;ctx.strokeStyle='#6d4cff';ctx.lineWidth=3;ctx.shadowColor='rgba(109,76,255,.4)';ctx.shadowBlur=8;ctx.beginPath();ctx.arc(cx,cy,p*Math.min(W,H)*0.4,0,Math.PI*2);ctx.stroke();ctx.restore();}}
function circle(cx,cy,r,fill,stroke,sw){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=sw||2;ctx.stroke();}ctx.restore();}
function ring(cx,cy,r,t,col,p){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(p||1)*Math.PI*2);ctx.strokeStyle=col||'#6d4cff';ctx.lineWidth=t||8;ctx.lineCap='round';ctx.stroke();ctx.restore();}
function glow(cx,cy,r,col){var g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');ctx.save();ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.restore();}
function arrow(x1,y1,x2,y2,col,lw){var a=Math.atan2(y2-y1,x2-x1),as=12;ctx.save();ctx.strokeStyle=col||'#6d4cff';ctx.fillStyle=col||'#6d4cff';ctx.lineWidth=lw||2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2-Math.cos(a)*as*0.4,y2-Math.sin(a)*as*0.4);ctx.stroke();ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-as*Math.cos(a-0.4),y2-as*Math.sin(a-0.4));ctx.lineTo(x2-as*Math.cos(a+0.4),y2-as*Math.sin(a+0.4));ctx.closePath();ctx.fill();ctx.restore();}
function dashed(x1,y1,x2,y2,col,lw,d,g){ctx.save();ctx.strokeStyle=col||'rgba(255,255,255,0.25)';ctx.lineWidth=lw||1.5;ctx.setLineDash([d||6,g||4]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
function dotGrid(x,y,cols,rows,gap,r,col){ctx.save();ctx.fillStyle=col||'rgba(255,255,255,0.1)';for(var c=0;c<cols;c++)for(var row=0;row<rows;row++){ctx.beginPath();ctx.arc(x+c*gap,y+row*gap,r||2,0,Math.PI*2);ctx.fill();}ctx.restore();}
function wave(x,y,w,amp,freq,col,lw,phase){ctx.save();ctx.strokeStyle=col||'#6d4cff';ctx.lineWidth=lw||2;ctx.beginPath();for(var i=0;i<=w;i+=3){var wy=y+Math.sin((i/w)*Math.PI*2*(freq||1)+(phase||0))*amp;if(i===0)ctx.moveTo(x+i,wy);else ctx.lineTo(x+i,wy);}ctx.stroke();ctx.restore();}
function gradRect(x,y,w,h,c1,c2,vert){var g=vert?ctx.createLinearGradient(x,y,x,y+h):ctx.createLinearGradient(x,y,x+w,y);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.save();ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.restore();}
function floatCard(x,y,w,h,r,bg){ctx.save();ctx.shadowColor='rgba(0,0,0,0.2)';ctx.shadowBlur=20;ctx.shadowOffsetY=6;rr(x,y,w,h,r||12,bg||'rgba(255,255,255,0.08)');ctx.restore();}
function laptop(cx,cy,bW,fn){var bH=bW*0.58,sW=bW*0.83,sH=bH*0.67,sx=cx-sW/2,sy=cy-bH/2+bH*0.07;rr(cx-bW/2,cy-bH/2,bW,bH*0.82,8,'#1a1a2e');rr(sx,sy,sW,sH,4,'#080812');if(fn){ctx.save();ctx.beginPath();ctx.moveTo(sx+4,sy);ctx.lineTo(sx+sW-4,sy);ctx.quadraticCurveTo(sx+sW,sy,sx+sW,sy+4);ctx.lineTo(sx+sW,sy+sH-4);ctx.quadraticCurveTo(sx+sW,sy+sH,sx+sW-4,sy+sH);ctx.lineTo(sx+4,sy+sH);ctx.quadraticCurveTo(sx,sy+sH,sx,sy+sH-4);ctx.lineTo(sx,sy+4);ctx.quadraticCurveTo(sx,sy,sx+4,sy);ctx.closePath();ctx.clip();fn(sx,sy,sW,sH);ctx.restore();}circle(cx,cy-bH/2+bH*0.033,3,'#222238');rr(cx-bW*0.52,cy+bH*0.365,bW*1.04,bH*0.1,4,'#141428');rr(cx-bW*0.13,cy+bH*0.39,bW*0.26,bH*0.055,4,'#1e1e30');}
function phone(cx,cy,h,fn){var w=h*0.46,sW=w*0.86,sH=h*0.88,sx=cx-sW/2,sy=cy-sH/2;rr(cx-w/2,cy-h/2,w,h,22,'#1c1c2e');rr(sx,sy,sW,sH,16,'#080812');if(fn){ctx.save();ctx.beginPath();ctx.moveTo(sx+16,sy);ctx.lineTo(sx+sW-16,sy);ctx.quadraticCurveTo(sx+sW,sy,sx+sW,sy+16);ctx.lineTo(sx+sW,sy+sH-16);ctx.quadraticCurveTo(sx+sW,sy+sH,sx+sW-16,sy+sH);ctx.lineTo(sx+16,sy+sH);ctx.quadraticCurveTo(sx,sy+sH,sx,sy+sH-16);ctx.lineTo(sx,sy+16);ctx.quadraticCurveTo(sx,sy,sx+16,sy);ctx.closePath();ctx.clip();fn(sx,sy,sW,sH);ctx.restore();}rr(cx-w*0.15,cy-h/2-1,w*0.3,13,7,'#1c1c2e');rr(cx-w*0.2,cy+h/2-11,w*0.4,5,3,'#2a2a3e');}
function check(cx,cy,r,col,lw){circle(cx,cy,r,null,col||'#22c55e',lw||2);ctx.save();ctx.strokeStyle=col||'#22c55e';ctx.lineWidth=lw||2;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cx-r*0.35,cy);ctx.lineTo(cx-r*0.05,cy+r*0.32);ctx.lineTo(cx+r*0.38,cy-r*0.3);ctx.stroke();ctx.restore();}
function bar(x,y,w,maxH,val,fill,anim){var h=val*(anim!==undefined?anim:1);rr(x,y+maxH-h,w,h,4,fill||'#6d4cff');}
function txReveal(words,x,yc,fs,clr,wt,s,gap){ctx.font=(wt||700)+' '+(fs||48)+'px "Inter Tight",system-ui';var tw=[],tot=0;for(var i=0;i<words.length;i++){tw[i]=ctx.measureText(words[i]+' ').width;tot+=tw[i];}var cx=x-tot/2;for(var i=0;i<words.length;i++){var p=C((_T-s-i*(gap||0.18))/.35,0,1);if(p<=0)break;ctx.save();ctx.globalAlpha=E.o3(p);ctx.fillStyle=clr||'#0c0b14';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(words[i],cx+(1-E.o3(p))*14,yc);ctx.restore();cx+=tw[i];}}
function txType(text,x,y,fs,clr,wt,s,dur){var p=C((_T-s)/(dur||1.2),0,1),ch=Math.floor(text.length*p),vis=text.slice(0,ch);tx(vis,x,y,fs,clr,wt);if(p<1&&Math.sin(_T*8)>0){ctx.save();ctx.font=(wt||700)+' '+(fs||48)+'px "Inter Tight",system-ui';ctx.textAlign='center';ctx.textBaseline='middle';var vw=ctx.measureText(vis).width;ctx.fillStyle=clr||'#0c0b14';ctx.fillRect(x+vw/2+2,y-fs*.5,2,fs);ctx.restore();}}
function hexagon(cx,cy,r,fill,stroke,sw){ctx.save();ctx.beginPath();for(var i=0;i<6;i++){var a=Math.PI/3*i-Math.PI/6;if(i===0)ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a));else ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=sw||2;ctx.stroke();}ctx.restore();}
function triangle(cx,cy,r,fill,angle){ctx.save();ctx.translate(cx,cy);if(angle)ctx.rotate(angle);ctx.beginPath();for(var i=0;i<3;i++){var a=Math.PI*2/3*i-Math.PI/2;if(i===0)ctx.moveTo(r*Math.cos(a),r*Math.sin(a));else ctx.lineTo(r*Math.cos(a),r*Math.sin(a));}ctx.closePath();ctx.fillStyle=fill||'rgba(109,76,255,0.15)';ctx.fill();ctx.restore();}
window.addEventListener('message',function(e){if(!e.data)return;if(e.data.__nv_acc)window.__NV_ACC=e.data.__nv_acc;if(e.data.__nv_bg)window.__NV_BG=e.data.__nv_bg;if(e.data.__nv_fg)window.__NV_FG=e.data.__nv_fg;});
var _PAUSED=false;
function render(){}
(function(){function _loop(ts){if(_L==null){_L=ts;requestAnimationFrame(_loop);return;}if(!_PAUSED){var dt=Math.min((ts-_L)/1000,0.1);_T=(_T+dt)%DUR;}_L=ts;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();try{render();}catch(e){var _ef=Math.round(Math.min(W,H)*0.04);ctx.font='bold '+_ef+'px monospace';ctx.fillStyle='rgba(160,0,0,.9)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Error: '+String(e.message||e).slice(0,60),W/2,H/2-_ef*0.6);ctx.font='bold '+Math.round(_ef*0.7)+'px monospace';ctx.fillText('(check code view for details)',W/2,H/2+_ef*0.8);}ctx.restore();ctx.save();ctx.fillStyle='rgba(109,76,255,.12)';ctx.fillRect(0,H-6,W,6);ctx.fillStyle='#6d4cff';ctx.shadowColor='rgba(109,76,255,.5)';ctx.shadowBlur=10;ctx.fillRect(0,H-6,W*C(_T/DUR,0,1),6);ctx.restore();requestAnimationFrame(_loop);}requestAnimationFrame(_loop);})();`;
}

// Assembles the final HTML from our canonical runtime + AI scene code
function buildVideoHtml(fmt: Format, duration: number, sceneCode: string): string {
  const runtime = buildVideoRuntime(fmt.w, fmt.h, duration);
  const marker = '// ── YOUR SCENE CODE';
  const hasMarker = sceneCode.trimStart().startsWith(marker);
  const body = hasMarker
    ? sceneCode.trim()
    : `${marker} ─────────────────────────────────────────────────────────\nrender = function() {\n${sceneCode}\n};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300;0,400;0,600;0,700;0,800;0,900;1,700&family=JetBrains+Mono:wght@400;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#ffffff}
canvas{display:block;width:100%;height:100%;object-fit:contain}
</style>
</head>
<body>
<canvas id="c" width="${fmt.w}" height="${fmt.h}"></canvas>
<script>
${runtime}

${body}
</script>
</body>
</html>`;
}

function buildVideoPrompt(fmt: Format, duration: number, agentBias?: string): string {
  const W = fmt.w;
  const H = fmt.h;

  // How many scenes fit this duration
  const sceneCount =
    duration <= 12 ? 2 :
    duration <= 22 ? 3 :
    duration <= 38 ? 4 :
    duration <= 52 ? 5 : 6;

  const subSide   = Math.round(W * 0.074);
  const subBottom = Math.round(H * 0.08);
  const subFont   = Math.round(W * 0.038);
  const subLH     = Math.round(subFont * 1.45);

  // Font size scale — proportional to canvas width
  const fsHero   = Math.round(W * 0.088);
  const fsSub    = Math.round(W * 0.052);
  const fsStat   = Math.round(W * 0.13);
  const fsBody   = Math.round(W * 0.036);
  const fsCta    = Math.round(W * 0.038);

  // Canvas-based runtime — renders to <canvas id="c">, enables video recording
  const runtime =
`window.onerror=function(msg,src,ln){var c=document.getElementById('c');if(!c)return;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.font='bold 13px monospace';x.fillStyle='rgba(160,0,0,.9)';x.textAlign='center';x.textBaseline='middle';x.fillText(String(msg).slice(0,90),c.width/2,c.height/2-14);x.fillText('line '+ln,c.width/2,c.height/2+14);};
var canvas=document.getElementById('c'),ctx=canvas.getContext('2d');
var W=${W},H=${H},DUR=${duration};
var _T=0,_L=null;
var C=function(v,a,b){return v<a?a:v>b?b:v;};
var E={
  o3:function(t){t--;return t*t*t+1;},
  i3:function(t){return t*t*t;},
  io:function(t){return t<.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1;},
  bk:function(t){var c=1.70158;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);},
  el:function(t){return t<=0?0:t>=1?1:Math.pow(2,-10*t)*Math.sin((t*10-.75)*2.094)+1;},
  si:function(t){return Math.sin(t*Math.PI/2);}
};
// sp(s,e): returns {lt,op,ty,p} during time window or null
function sp(s,e){
  if(_T<s||_T>e)return null;
  var lt=_T-s,dur=e-s,eD=0.45,xD=0.35,xS=dur-xD,op=1,ty=0;
  if(lt<eD){var p=E.o3(C(lt/eD,0,1));op=p;ty=(1-p)*32;}
  else if(lt>xS){var p2=E.i3(C((lt-xS)/xD,0,1));op=1-p2;ty=-p2*20;}
  return {lt:lt,op:op,ty:ty,p:C(lt/dur,0,1)};
}
function lp(a,b,s,e,ef){ef=ef||E.o3;return a+(b-a)*ef(C((_T-s)/(e-s),0,1));}
function cu(n,s,d,ef){ef=ef||E.o3;return Math.round(n*ef(C((_T-s)/d,0,1)));}
// tx(text,x,y,fs,clr,weight,align,base): draw text on canvas
function tx(t,x,y,fs,clr,w,al,ba){ctx.font=(w||600)+' '+(fs||36)+'px "Inter Tight",system-ui';ctx.fillStyle=clr||'#0c0b14';ctx.textAlign=al||'center';ctx.textBaseline=ba||'middle';ctx.fillText(t,x,y);}
// txm(text,x,y,fs,clr): monospace text (JetBrains Mono) for numbers/stats
function txm(t,x,y,fs,clr){ctx.font='700 '+(fs||48)+'px "JetBrains Mono",monospace';ctx.fillStyle=clr||'#6d4cff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t,x,y);}
// txWrap(lines[],x,yCtr,fs,clr,wt,lineH): draw multi-line text centered at yCtr
function txWrap(lines,x,yc,fs,clr,wt,lhh){var n=lines.length,ly=yc-(n-1)*(lhh||fs*1.25)/2;for(var i=0;i<n;i++)tx(lines[i],x,ly+i*(lhh||fs*1.25),fs,clr,wt);}
// rr(x,y,w,h,r,fill,shadowColor,shadowBlur): draw rounded rectangle
function rr(x,y,w,h,r,fill,sc,sb){
  ctx.save();
  if(sc){ctx.shadowColor=sc;ctx.shadowBlur=sb||20;}
  ctx.fillStyle=fill||'#fff';r=Math.min(r||20,w/2,h/2);
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();ctx.fill();
  ctx.restore();
}
// sub(text,op,color): centered word-wrapped subtitle at bottom with frosted bg
function sub(text,op,color){
  if(!op||op<=0)return;
  ctx.save();ctx.globalAlpha=op;
  ctx.font='600 ${subFont}px "Inter Tight",system-ui';
  ctx.textAlign='center';ctx.textBaseline='alphabetic';
  var mw=W-${subSide * 2},words=text.split(' '),lines=[],cur='';
  for(var i=0;i<words.length;i++){var tl=cur?(cur+' '+words[i]):words[i];if(ctx.measureText(tl).width>mw&&cur){lines.push(cur);cur=words[i];}else cur=tl;}
  lines.push(cur);
  var lh=${subLH},bH=lines.length*lh+12,bY=H-${subBottom}-lines.length*lh-10;
  rr(${subSide},bY,W-${subSide * 2},bH,10,'rgba(255,255,255,0.88)');
  ctx.fillStyle=color||'#0c0b14';
  for(var j=0;j<lines.length;j++)ctx.fillText(lines[j].trim(),W/2,H-${subBottom}-(lines.length-1-j)*lh);
  ctx.restore();
}
// subHL(before,hl,after,op): two-color subtitle — hl part in accent purple, frosted bg
function subHL(a,hl,b,op){
  if(!op||op<=0)return;
  ctx.save();ctx.globalAlpha=op;ctx.font='600 ${subFont}px "Inter Tight",system-ui';ctx.textBaseline='alphabetic';ctx.textAlign='left';
  var wa=ctx.measureText(a).width,wh=ctx.measureText(hl).width,wb=ctx.measureText(b).width;
  var tot=wa+wh+wb,x=W/2-tot/2,y=H-${subBottom};
  rr(x-16,y-${subFont}-6,tot+32,${subFont}+18,10,'rgba(255,255,255,0.88)');
  ctx.fillStyle='#0c0b14';ctx.fillText(a,x,y);
  ctx.fillStyle='#6d4cff';ctx.fillText(hl,x+wa,y);
  ctx.fillStyle='#0c0b14';ctx.fillText(b,x+wa+wh,y);
  ctx.restore();
}
// ripple(cx,cy,startT,count): expanding purple rings for brand reveals
function ripple(cx,cy,st,n){
  n=n||3;
  for(var i=0;i<n;i++){
    var p=C((_T-st-i*0.3)/1.8,0,1);if(p<=0||p>=1)continue;
    ctx.save();ctx.globalAlpha=(1-p)*0.5;ctx.strokeStyle='#6d4cff';ctx.lineWidth=3;
    ctx.shadowColor='rgba(109,76,255,.4)';ctx.shadowBlur=8;
    ctx.beginPath();ctx.arc(cx,cy,p*Math.min(W,H)*0.4,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
}
// circle(cx,cy,r,fill,stroke,sw): filled/stroked circle
function circle(cx,cy,r,fill,stroke,sw){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=sw||2;ctx.stroke();}ctx.restore();}
// ring(cx,cy,r,t,col,p): arc progress ring, p=0–1
function ring(cx,cy,r,t,col,p){ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(p||1)*Math.PI*2);ctx.strokeStyle=col||'#6d4cff';ctx.lineWidth=t||8;ctx.lineCap='round';ctx.stroke();ctx.restore();}
// glow(cx,cy,r,col): radial soft glow
function glow(cx,cy,r,col){var g=ctx.createRadialGradient(cx,cy,0,cx,cy,r);g.addColorStop(0,col);g.addColorStop(1,'rgba(0,0,0,0)');ctx.save();ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.restore();}
// arrow(x1,y1,x2,y2,col,lw): directional line with arrowhead
function arrow(x1,y1,x2,y2,col,lw){var a=Math.atan2(y2-y1,x2-x1),as=12;ctx.save();ctx.strokeStyle=col||'#6d4cff';ctx.fillStyle=col||'#6d4cff';ctx.lineWidth=lw||2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2-Math.cos(a)*as*0.4,y2-Math.sin(a)*as*0.4);ctx.stroke();ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-as*Math.cos(a-0.4),y2-as*Math.sin(a-0.4));ctx.lineTo(x2-as*Math.cos(a+0.4),y2-as*Math.sin(a+0.4));ctx.closePath();ctx.fill();ctx.restore();}
// dashed(x1,y1,x2,y2,col,lw,d,g): dashed separator line
function dashed(x1,y1,x2,y2,col,lw,d,g){ctx.save();ctx.strokeStyle=col||'rgba(255,255,255,0.25)';ctx.lineWidth=lw||1.5;ctx.setLineDash([d||6,g||4]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.setLineDash([]);ctx.restore();}
// dotGrid(x,y,cols,rows,gap,r,col): decorative dot matrix background
function dotGrid(x,y,cols,rows,gap,r,col){ctx.save();ctx.fillStyle=col||'rgba(255,255,255,0.1)';for(var c=0;c<cols;c++)for(var row=0;row<rows;row++){ctx.beginPath();ctx.arc(x+c*gap,y+row*gap,r||2,0,Math.PI*2);ctx.fill();}ctx.restore();}
// wave(x,y,w,amp,freq,col,lw,phase): animated sine wave line
function wave(x,y,w,amp,freq,col,lw,phase){ctx.save();ctx.strokeStyle=col||'#6d4cff';ctx.lineWidth=lw||2;ctx.beginPath();for(var i=0;i<=w;i+=3){var wy=y+Math.sin((i/w)*Math.PI*2*(freq||1)+(phase||0))*amp;if(i===0)ctx.moveTo(x+i,wy);else ctx.lineTo(x+i,wy);}ctx.stroke();ctx.restore();}
// gradRect(x,y,w,h,c1,c2,vert): gradient-filled rectangle (vert=top-to-bottom)
function gradRect(x,y,w,h,c1,c2,vert){var g=vert?ctx.createLinearGradient(x,y,x,y+h):ctx.createLinearGradient(x,y,x+w,y);g.addColorStop(0,c1);g.addColorStop(1,c2);ctx.save();ctx.fillStyle=g;ctx.fillRect(x,y,w,h);ctx.restore();}
// floatCard(x,y,w,h,r,bg): rounded card with drop shadow
function floatCard(x,y,w,h,r,bg){ctx.save();ctx.shadowColor='rgba(0,0,0,0.2)';ctx.shadowBlur=20;ctx.shadowOffsetY=6;rr(x,y,w,h,r||12,bg||'rgba(255,255,255,0.08)');ctx.restore();}
// laptop(cx,cy,bW,fn): laptop device frame; fn(sx,sy,sw,sh) paints inside the screen
function laptop(cx,cy,bW,fn){var bH=bW*0.58,sW=bW*0.83,sH=bH*0.67,sx=cx-sW/2,sy=cy-bH/2+bH*0.07;rr(cx-bW/2,cy-bH/2,bW,bH*0.82,8,'#1a1a2e');rr(sx,sy,sW,sH,4,'#080812');if(fn){ctx.save();ctx.beginPath();ctx.moveTo(sx+4,sy);ctx.lineTo(sx+sW-4,sy);ctx.quadraticCurveTo(sx+sW,sy,sx+sW,sy+4);ctx.lineTo(sx+sW,sy+sH-4);ctx.quadraticCurveTo(sx+sW,sy+sH,sx+sW-4,sy+sH);ctx.lineTo(sx+4,sy+sH);ctx.quadraticCurveTo(sx,sy+sH,sx,sy+sH-4);ctx.lineTo(sx,sy+4);ctx.quadraticCurveTo(sx,sy,sx+4,sy);ctx.closePath();ctx.clip();fn(sx,sy,sW,sH);ctx.restore();}circle(cx,cy-bH/2+bH*0.033,3,'#222238');rr(cx-bW*0.52,cy+bH*0.365,bW*1.04,bH*0.1,4,'#141428');rr(cx-bW*0.13,cy+bH*0.39,bW*0.26,bH*0.055,4,'#1e1e30');}
// phone(cx,cy,h,fn): phone device frame; fn(sx,sy,sw,sh) paints inside the screen
function phone(cx,cy,h,fn){var w=h*0.46,sW=w*0.86,sH=h*0.88,sx=cx-sW/2,sy=cy-sH/2;rr(cx-w/2,cy-h/2,w,h,22,'#1c1c2e');rr(sx,sy,sW,sH,16,'#080812');if(fn){ctx.save();ctx.beginPath();ctx.moveTo(sx+16,sy);ctx.lineTo(sx+sW-16,sy);ctx.quadraticCurveTo(sx+sW,sy,sx+sW,sy+16);ctx.lineTo(sx+sW,sy+sH-16);ctx.quadraticCurveTo(sx+sW,sy+sH,sx+sW-16,sy+sH);ctx.lineTo(sx+16,sy+sH);ctx.quadraticCurveTo(sx,sy+sH,sx,sy+sH-16);ctx.lineTo(sx,sy+16);ctx.quadraticCurveTo(sx,sy,sx+16,sy);ctx.closePath();ctx.clip();fn(sx,sy,sW,sH);ctx.restore();}rr(cx-w*0.15,cy-h/2-1,w*0.3,13,7,'#1c1c2e');rr(cx-w*0.2,cy+h/2-11,w*0.4,5,3,'#2a2a3e');}
// check(cx,cy,r,col,lw): checkmark drawn inside a circle
function check(cx,cy,r,col,lw){circle(cx,cy,r,null,col||'#22c55e',lw||2);ctx.save();ctx.strokeStyle=col||'#22c55e';ctx.lineWidth=lw||2;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cx-r*0.35,cy);ctx.lineTo(cx-r*0.05,cy+r*0.32);ctx.lineTo(cx+r*0.38,cy-r*0.3);ctx.stroke();ctx.restore();}
// bar(x,y,w,maxH,val,fill,anim): animated vertical bar; anim=0–1 entrance progress
function bar(x,y,w,maxH,val,fill,anim){var h=val*(anim!==undefined?anim:1);rr(x,y+maxH-h,w,h,4,fill||'#6d4cff');}
// txReveal(words[],x,yCtr,fs,clr,wt,startT,gapT): reveal each word left-to-right with fade+slide; gapT=delay between words (default 0.18s)
function txReveal(words,x,yc,fs,clr,wt,s,gap){ctx.font=(wt||700)+' '+(fs||48)+'px "Inter Tight",system-ui';var tw=[],tot=0;for(var i=0;i<words.length;i++){tw[i]=ctx.measureText(words[i]+' ').width;tot+=tw[i];}var cx=x-tot/2;for(var i=0;i<words.length;i++){var p=C((_T-s-i*(gap||0.18))/.35,0,1);if(p<=0)break;ctx.save();ctx.globalAlpha=E.o3(p);ctx.fillStyle=clr||'#0c0b14';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(words[i],cx+(1-E.o3(p))*14,yc);ctx.restore();cx+=tw[i];}}
// txType(text,x,y,fs,clr,wt,startT,dur): typewriter effect with blinking cursor
function txType(text,x,y,fs,clr,wt,s,dur){var p=C((_T-s)/(dur||1.2),0,1),ch=Math.floor(text.length*p),vis=text.slice(0,ch);tx(vis,x,y,fs,clr,wt);if(p<1&&Math.sin(_T*8)>0){ctx.save();ctx.font=(wt||700)+' '+(fs||48)+'px "Inter Tight",system-ui';ctx.textAlign='center';ctx.textBaseline='middle';var vw=ctx.measureText(vis).width;ctx.fillStyle=clr||'#0c0b14';ctx.fillRect(x+vw/2+2,y-fs*.5,2,fs);ctx.restore();}}
// hexagon(cx,cy,r,fill,stroke,sw): regular hexagon shape — use for network/AI/tech visuals
function hexagon(cx,cy,r,fill,stroke,sw){ctx.save();ctx.beginPath();for(var i=0;i<6;i++){var a=Math.PI/3*i-Math.PI/6;if(i===0)ctx.moveTo(cx+r*Math.cos(a),cy+r*Math.sin(a));else ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=sw||2;ctx.stroke();}ctx.restore();}
// triangle(cx,cy,r,fill,angle): equilateral triangle — use for direction, growth, energy; angle in radians
function triangle(cx,cy,r,fill,angle){ctx.save();ctx.translate(cx,cy);if(angle)ctx.rotate(angle);ctx.beginPath();for(var i=0;i<3;i++){var a=Math.PI*2/3*i-Math.PI/2;if(i===0)ctx.moveTo(r*Math.cos(a),r*Math.sin(a));else ctx.lineTo(r*Math.cos(a),r*Math.sin(a));}ctx.closePath();ctx.fillStyle=fill||'rgba(109,76,255,0.15)';ctx.fill();ctx.restore();}
// Color override listener — allows parent window to change accent/bg/fg in real-time via postMessage({__nv_acc:'#hex'})
window.addEventListener('message',function(e){if(!e.data)return;if(e.data.__nv_acc)window.__NV_ACC=e.data.__nv_acc;if(e.data.__nv_bg)window.__NV_BG=e.data.__nv_bg;if(e.data.__nv_fg)window.__NV_FG=e.data.__nv_fg;});
var _PAUSED=false;
function render(){}
(function(){
  function _loop(ts){
    if(_L==null){_L=ts;requestAnimationFrame(_loop);return;}
    if(!_PAUSED){var dt=Math.min((ts-_L)/1000,0.1);_T=(_T+dt)%DUR;}
    _L=ts;
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
    ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);ctx.clip();
    try{render();}catch(e){
      ctx.font='bold 13px monospace';ctx.fillStyle='rgba(160,0,0,.9)';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('Render error: '+e.message,W/2,H/2);
    }
    ctx.restore();
    ctx.save();ctx.fillStyle='rgba(109,76,255,.12)';ctx.fillRect(0,H-6,W,6);
    ctx.fillStyle='#6d4cff';ctx.shadowColor='rgba(109,76,255,.5)';ctx.shadowBlur=10;
    ctx.fillRect(0,H-6,W*C(_T/DUR,0,1),6);ctx.restore();
    requestAnimationFrame(_loop);
  }
  requestAnimationFrame(_loop);
})();`;

  return `You are a professional canvas animation coder. Create a self-contained animated HTML document rendered on <canvas>. ZERO external scripts — Google Fonts @import only.
${agentBias ? `\nDIRECTION: ${agentBias}\n` : ''}
CANVAS: ${W}×${H}px  ·  ${duration}s loop  ·  Fonts: Inter Tight (display) + JetBrains Mono (numbers)

━━━ STEP 1: ANALYZE THE CONTENT ━━━
Read ALL of the user message — every word. Extract: subject, key message, tone, specific names/numbers/features/facts.
Then plan before writing any code:

A) What narrative TYPE fits this content?
   Product/app launch  → Hook · Problem · Solution · Proof · CTA
   Brand story         → Vision · Values · Journey · Promise · CTA
   Data reveal         → Big number hook · Insight · Insight · CTA
   Tutorial/how-to     → End result first · Step 1 · Step 2 · Step 3 · CTA
   Announcement/event  → Reveal · Details · Who/When/Where · CTA
   Portfolio/showcase  → Best work · Style · Style · Contact
   ... or invent your own structure — the content dictates it.

B) What OBJECTS or VISUALS does the content need?
   Think like a motion designer: a glowing server rack? bar charts? a phone with UI?
   Abstract geometry? A network of nodes? A city skyline? A product diagram?
   These must come FROM the content — not from a template.

C) ${sceneCount} scenes for ${duration}s — vary lengths, do NOT split equally.

━━━ STEP 2: DESIGN YOUR VISUALS ━━━
For each visual object the content needs, define a drawing function using raw canvas primitives:
ctx.beginPath(), moveTo(), lineTo(), bezierCurveTo(), arc(), rect(), roundRect(), fillRect(), strokeRect()

Write custom drawing functions ABOVE render(). Match the object to the content:

  // Tech product — server rack
  function drawServer(x,y,w,h,lit){
    ctx.fillStyle='#1a1a2e'; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#333'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
    for(var i=0;i<4;i++){
      ctx.fillStyle='#0f0e24'; ctx.fillRect(x+4,y+i*(h/4.2)+4,w-8,h/5);
      ctx.fillStyle=lit?'#22c55e':'#ef4444';
      ctx.beginPath(); ctx.arc(x+w-10,y+i*(h/4.2)+h/10,4,0,Math.PI*2); ctx.fill();
    }
  }
  // Analytics — animated line chart
  function drawLineChart(cx,cy,w,h,points,col,anim){
    ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath();
    points.forEach(function(v,i){
      if(i>Math.floor(points.length*anim))return;
      var px=cx-w/2+i*(w/(points.length-1)), py=cy+h/2-v*h;
      if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.stroke(); ctx.restore();
  }
  // AI/network — glowing node
  function drawNode(cx,cy,r,col,label,fs){
    ctx.save(); ctx.shadowColor=col; ctx.shadowBlur=20;
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
    ctx.restore();
    if(label) tx(label,cx,cy+r+14,fs||12,col,600);
  }

Anything the content needs: a basketball, DNA helix, award medal, city skyline, rocket — CODE IT with canvas.
These drawing functions are what makes each video unique to its content.

━━━ STEP 3: EXTRACT COLORS ━━━
Derive 3 colors from the content brand/mood — do NOT default to purple every time:
  BG:  dominant background matching tone (dark/light/neutral)
  FG:  main text color — high contrast on BG (min 4.5:1)
  ACC: accent — pick what fits emotionally:
       violet #6d4cff · orange #f97316 · emerald #10b981 · sky #0ea5e9
       rose #f43f5e · amber #f59e0b · pink #ec4899 · lime #84cc16

Define FIRST inside render() — enables the live color picker to override:
  var CLR_BG = window.__NV_BG || '#<your derived color>';
  var CLR_FG = window.__NV_FG || '#<your derived color>';
  var CLR_ACC = window.__NV_ACC || '#<your derived color>';
Use CLR_BG/CLR_FG/CLR_ACC everywhere. NEVER hardcode a hex value inside scene blocks.

━━━ STEP 4: CODE YOUR SCENES ━━━
Each scene: var r=sp(start,end); if(r){ ctx.save(); ctx.globalAlpha=r.op; ...draw... ctx.restore(); sub('voice-over text',r.op); }
Scenes can overlap 0.5-1s for smooth cross-fade. Do NOT use equal time splits.
sp() returns: r.lt (time-in-scene), r.op (fade envelope 0→1→0), r.ty (entrance offset), r.p (progress 0→1)

DRAW ORDER — violating this hides text (the #1 bug in canvas animations):
  1. Background: gradRect() or ctx.fillRect() — FIRST, always
  2. Mid layer: your custom objects, shapes, charts — SECOND
  3. Text: tx(), txm(), txWrap(), txReveal(), txType() — ALWAYS LAST

Pacing — contrast in speed makes videos feel professional:
  Hook:       fast — easing <=0.3s, urgent energy
  Content:    medium — 0.35-0.5s per element stagger
  Stats/data: slow — cu() count-up over 1.5-2.5s, let numbers land
  CTA:        steady pulse — ctx.scale(1+Math.sin(_T*3)*0.025, 1+Math.sin(_T*3)*0.025)

Text animations — use these, not flat text:
  Word-by-word: txReveal(['Word','by','Word'],W/2,y,${fsHero},CLR_FG,900,sceneStart,0.22)
  Typewriter:   txType('tagline here',W/2,y,${fsSub},CLR_FG,700,sceneStart,1.5)

Suggested font scale (${W}px canvas): headline ${fsHero}px · subhead ${fsSub}px · stat ${fsStat}px · body ${fsBody}px · CTA ${fsCta}px
Subtitle zone (y>${Math.round(H*0.85)}) is RESERVED for sub()/subHL() — place nothing else there.
Subtitles: sub(text,op) at the end of EVERY scene block — these are the voice-over captions.
Two-color subtitle: subHL('before ','KEY WORD',' after',op)

━━━ RUNTIME HELPERS ━━━
All available in scope — do not redefine:
  sp(s,e)→{lt,op,ty,p}  lp(a,b,s,e,ef)  cu(n,s,dur)  C(v,a,b)  E.{o3,i3,io,bk,el,si}  _T DUR W H ctx
  tx(t,x,y,fs,clr,wt,al,ba)  txm(t,x,y,fs,clr)  txWrap(lines[],x,yc,fs,clr,wt,lh)
  txReveal(words[],x,y,fs,clr,wt,start,gap)  txType(text,x,y,fs,clr,wt,start,dur)
  rr(x,y,w,h,r,fill,shadowCol,shadowBlur)  sub(text,op)  subHL(before,hl,after,op)
  glow(cx,cy,r,col)  ripple(cx,cy,start,n)  circle(cx,cy,r,fill,stroke,sw)  ring(cx,cy,r,t,col,p)
  gradRect(x,y,w,h,c1,c2,vert)  floatCard(x,y,w,h,r,bg)  wave(x,y,w,amp,freq,col,lw,phase)
  dotGrid(x,y,cols,rows,gap,r,col)  arrow(x1,y1,x2,y2,col,lw)  dashed(x1,y1,x2,y2,col,lw,d,g)
  hexagon(cx,cy,r,fill,stroke,sw)  triangle(cx,cy,r,fill,angle)  bar(x,y,w,maxH,val,fill,anim)
  check(cx,cy,r,col,lw)  laptop(cx,cy,bW,fn)  phone(cx,cy,h,fn)

━━━ MANDATORY HTML SHELL ━━━
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,300;0,400;0,600;0,700;0,800;0,900;1,700&family=JetBrains+Mono:wght@400;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#ffffff}
canvas{display:block;width:100%;height:100%;object-fit:contain}
</style>
</head>
<body>
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
// ── RUNTIME (verbatim — do NOT modify) ──────────────────────────────────────
${runtime}

// ── YOUR SCENE CODE ─────────────────────────────────────────────────────────
// Step 2 custom drawing functions go HERE (between this comment and render):
// function drawMyObject(x, y, w, h) { ctx.fillRect(x,y,w,h); }

render = function() {
  // COLOR VARS — always first (enables live color picker):
  var CLR_BG = window.__NV_BG || '#<derived-bg>';
  var CLR_FG = window.__NV_FG || '#<derived-fg>';
  var CLR_ACC = window.__NV_ACC || '#<derived-acc>';

  // SCENES — pattern: background -> objects -> text LAST -> subtitle
  // var r1 = sp(0, 8); if(r1) {
  //   ctx.save(); ctx.globalAlpha = r1.op;
  //   gradRect(0,0,W,H,CLR_BG,CLR_BG,true);   // 1. background
  //   drawMyObject(W*.3,H*.4,W*.4,H*.2);        // 2. objects
  //   txReveal(['Title'],W/2,H*.35,${fsHero},CLR_FG,900,0,0.22); // 3. text LAST
  //   ctx.restore(); sub('voice-over caption', r1.op);
  // }
};

</script>
</body>
</html>

━━━ NON-NEGOTIABLE RULES ━━━
1. Output ONLY the HTML — start with <!DOCTYPE html>. No markdown fences, no explanations.
2. Copy the runtime block VERBATIM — do not change a single character.
3. Custom drawing functions go BETWEEN the "// ── YOUR SCENE CODE" comment and "render = function()".
4. ctx.save()/ctx.restore() around every block that changes globalAlpha or shadowBlur.
5. Every scene uses sp(s,e). Every scene ends with sub() or subHL().
6. Real copy only — derive every word from the content. Zero placeholder text.
7. CLR_BG/CLR_FG/CLR_ACC defined at top of render(). Never hardcode hex in scene blocks.
8. No emojis in any canvas text string — they render as broken boxes on Windows.
9. ALL elements must fit within [0,0,${W},${H}]. Canvas has an active clip rect — overflow is invisible.
10. DRAW ORDER always: background first, objects second, text ALWAYS last.`;
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

// Replace just the scene section, keeping the runtime intact
function injectSceneSection(html: string, newSection: string): string {
  const marker = '// ── YOUR SCENE CODE';
  const start = html.indexOf(marker);
  if (start === -1) return html;
  const end = html.lastIndexOf('</script>');
  if (end === -1) return html;
  return html.slice(0, start) + newSection.trim() + '\n' + html.slice(end);
}

function buildRefinePrompt(currentHtml: string, instruction: string, isVideo = false): string {
  if (isVideo) {
    const scene = extractSceneSection(currentHtml);
    return `Current scene code:\n\`\`\`js\n${scene.slice(0, 14000)}\n\`\`\`\n\nInstruction: "${instruction}"\n\nReturn ONLY the scene section — start with the exact line "// ── YOUR SCENE CODE ─" then the render = function(){...}; block. No HTML, no runtime, no </script> tag.`;
  }
  return `Current code:\n\`\`\`html\n${currentHtml.slice(0, 18000)}\n\`\`\`\n\nInstruction: "${instruction}"\n\nReturn the COMPLETE updated HTML starting with <!DOCTYPE html>. Keep everything not mentioned unchanged.`;
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
      await streamAI(sysPrompt, userMsg, (chunk) => { raw += chunk; setStreamLog(raw.slice(-400)); });
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
          setStreamLog(raw.slice(-400));
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
          setStreamLog(raw.slice(-400));
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
      ? `You are refining a canvas-animated video's scene code.
Return ONLY the scene section — start with "// ── YOUR SCENE CODE ─────..." then render = function(){ ... }; Nothing else.

Runtime helpers available (already in scope — do not redefine):
  sp(s,e), lp(), cu(), E.{o3,i3,io,bk,el,si}, C(), _T, DUR, W, H, ctx
  tx(), txm(), txWrap(), txReveal(), txType(), rr(), sub(), subHL()
  glow(), ripple(), circle(), ring(), gradRect(), floatCard(), wave(), dotGrid()
  arrow(), dashed(), hexagon(), triangle(), bar(), check(), laptop(), phone()

You may also define custom drawing functions (ABOVE render =) using raw canvas primitives:
  ctx.beginPath(), moveTo(), lineTo(), bezierCurveTo(), arc(), rect(), roundRect()

Rules:
1. No emojis in canvas text — they render as broken boxes on Windows
2. Draw order: background FIRST, objects SECOND, text ALWAYS LAST
3. Canvas bounds [0,0,W,H] — clip is active, overflow invisible
4. Every scene ends with sub() or subHL()
5. CLR_BG/CLR_FG/CLR_ACC must be defined at top of render() — never hardcode hex in scene blocks
6. Apply ONLY the requested changes — keep unchanged scenes intact`
      : `You are an expert HTML/CSS designer. Modify the design as instructed. Return the COMPLETE updated HTML starting with <!DOCTYPE html>. Keep everything not mentioned unchanged.`;

    try {
      await streamAI(sysPrompt, buildRefinePrompt(html, text, isVideo), (chunk) => {
        raw += chunk;
        setStreamLog(raw.slice(-400));
      });
      const stripped = stripFences(raw);
      let updated: string;
      if (isVideo) {
        const hasMarker = stripped.includes('// ── YOUR SCENE CODE');
        const hasRender = /render\s*=\s*function/.test(stripped);
        if (hasMarker) {
          updated = injectSceneSection(html, stripped);
        } else if (hasRender) {
          // AI returned render code without the marker — add it and inject
          updated = injectSceneSection(html, `// ── YOUR SCENE CODE ─────────────────────────────────────────────────────────\n${stripped}`);
        } else {
          // Try to extract scene section from a full HTML response
          const extracted = extractSceneSection(stripped);
          updated = extracted ? injectSceneSection(html, extracted) : buildVideoHtml(format, duration, stripped);
        }
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
                <pre className="text-[9px] text-nv-faint/60 font-mono max-w-sm text-center overflow-hidden line-clamp-3">
                  {streamLog}
                </pre>
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
