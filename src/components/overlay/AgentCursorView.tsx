// The agent's pointer, drawn on top of the user's real screen.
//
// ── WHY THE WINDOW IS FULL SCREEN AND THE POINTER MOVES INSIDE IT ────────────
//
// The first version made the window small and MOVED THE WINDOW to each new point. That cannot be
// animated — a window position is set, not transitioned — so every step was a jump, and the whole
// thing read as stuttering rather than moving. It also meant the label could be clipped at a screen
// edge.
//
// Now the window covers the screen, transparent and click-through, and the pointer is placed inside
// it with a CSS transform. A transform is transitionable, so travel between two points is a single
// smooth movement the compositor handles, at any distance, for free.
//
// The safety rule that makes a full-screen overlay acceptable: it is click-through at BOTH levels —
// setIgnoreCursorEvents on the window (re-applied on every show) and pointer-events:none in
// overlay.css. A transparent sheet over the whole screen that swallowed clicks would be the worst
// failure this component could have, so it is prevented twice.
//
// ── COLOUR ───────────────────────────────────────────────────────────────────
//
// Never hardcoded. `rgb` arrives as the working agent's own department variable — sales green,
// research blue, boss purple — so with several agents on screen the user can tell whose pointer is
// whose without reading a word.
import { useEffect, useRef, useState } from 'react';
import { onCursor, type CursorState } from '../../lib/agentCursor';

const BLANK: CursorState = { visible: false, x: 0, y: 0, rgb: 'var(--nv-dept-boss)', agent: '', doing: '' };

export default function AgentCursorView() {
  const [s, setS] = useState<CursorState>(BLANK);
  // The pointer tips in the direction of travel and settles back. It is a small thing, and it is
  // most of what separates "an object moved" from "a value changed".
  const [lean, setLean] = useState('0deg');
  const prev = useRef({ x: 0, y: 0 });
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let off: (() => void) | null = null;
    onCursor(setS).then((fn) => { off = fn; }).catch(() => {});
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  useEffect(() => {
    if (!s.visible) return;
    const dx = s.x - prev.current.x;
    const dy = s.y - prev.current.y;
    prev.current = { x: s.x, y: s.y };
    if (Math.hypot(dx, dy) < 24) return;          // a nudge is not a journey
    setLean(dx < 0 ? '-9deg' : '9deg');
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => setLean('0deg'), 620);
  }, [s.x, s.y, s.visible]);

  if (!s.visible) return null;

  const ac = `rgb(${s.rgb})`;
  const acSoft = `rgb(${s.rgb} / .5)`;
  const pos = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
  const total = Math.max(0, s.total ?? 0);
  const step = Math.max(0, Math.min(total, s.step ?? 0));

  // The pointer outline: a filled arrow with a heavy white stroke drawn UNDER the fill
  // (paint-order), plus a hairline dark edge. That combination is what keeps it readable on a white
  // Word page and on a dark window — the two backgrounds it will actually land on.
  const ARROW = 'M1 1 L1 26.4 L7.4 20.6 L11.8 30.6 L16.6 28.5 L12.2 18.7 L20.9 18.1 Z';

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* A ghost a beat behind the real one. It costs nothing and it is what makes a long move read
          as travel rather than as a teleport with a delay. */}
      <div style={{
        position: 'absolute', left: 0, top: 0, opacity: 0.22, filter: 'blur(1.3px)',
        transform: pos, transition: 'transform 1.5s cubic-bezier(.22,.61,.36,1)',
      }}>
        <svg width="30" height="38" viewBox="0 0 30 38" fill="none" style={{ position: 'absolute', left: 10, top: 10 }}>
          <path d={ARROW} fill={ac} stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" />
        </svg>
      </div>

      <div style={{
        position: 'absolute', left: 0, top: 0, width: 460, height: 120,
        transform: pos, transition: 'transform 1.05s cubic-bezier(.22,.61,.36,1)',
        // Opacity ONLY. This element carries the position in its `transform`, and a CSS animation
        // beats an inline style — an entrance that animated `transform: scale()` here silently
        // replaced the translate, pinning the whole overlay to the top-left corner while the ghost
        // (which has no animation) went to the right place. The scale lives on the pointer below.
        animation: 'acv-fade .34s ease-out both',
      }}>
        <div style={{
          position: 'absolute', left: 10, top: 10, transformOrigin: '1px 1px',
          filter: 'drop-shadow(0 3px 8px rgba(0,0,0,.32))',
          rotate: lean, transition: 'rotate .9s cubic-bezier(.22,.61,.36,1)',
          animation: 'acv-in .34s cubic-bezier(.2,1,.3,1) both',
        }}>
          {/* A slow ring at the hotspot, so a working agent never looks frozen between steps. */}
          <span style={{
            position: 'absolute', left: 1, top: 1, width: 12, height: 12, margin: '-6px 0 0 -6px',
            borderRadius: '50%', background: ac, opacity: 0.4,
            animation: 'acv-pulse 2.6s ease-out infinite',
          }} />
          {s.clicking && (
            <>
              <span style={{
                position: 'absolute', left: 1, top: 1, width: 16, height: 16, margin: '-8px 0 0 -8px',
                borderRadius: '50%', border: `2px solid ${ac}`,
                animation: 'acv-ripple .6s cubic-bezier(.2,.7,.3,1) both',
              }} />
              <span style={{
                position: 'absolute', left: 1, top: 1, width: 16, height: 16, margin: '-8px 0 0 -8px',
                borderRadius: '50%', border: `2px solid ${acSoft}`,
                animation: 'acv-ripple2 .72s .09s cubic-bezier(.2,.7,.3,1) both',
              }} />
            </>
          )}
          <svg width="30" height="38" viewBox="0 0 30 38" fill="none"
               style={{ display: 'block', animation: 'acv-breathe 2.6s ease-in-out infinite', transformOrigin: '1px 1px' }}>
            <path d={ARROW} fill={ac} stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" />
            <path d={ARROW} fill="none" stroke="rgba(0,0,0,.22)" strokeWidth=".9" strokeLinejoin="round" />
          </svg>
        </div>

        {/* The label. A pointer with no words is a mystery — this is the part that says who is
            working and what they are doing, which is the whole reason the overlay exists. */}
        <div style={{
          position: 'absolute', left: 34, top: 28, maxWidth: 414,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 6px 6px', borderRadius: 999,
          background: 'rgba(16,17,22,.88)', border: '1px solid rgba(255,255,255,.1)',
          boxShadow: `0 8px 24px rgba(0,0,0,.34), inset 0 0 0 1px ${acSoft}`,
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          whiteSpace: 'nowrap', overflow: 'hidden',
          animation: 'acv-fade .34s .06s ease-out both',
          fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', system-ui, sans-serif",
        }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '3px 9px 3px 7px',
            borderRadius: 999, background: acSoft, flex: 'none',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'acv-dot 1.8s ease-out infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '.01em' }}>{s.agent}</span>
          </span>
          <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,.14)', flex: 'none' }} />
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.82)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.doing}
          </span>
          {/* How far through the job, without a number to read. Only when the caller knows. */}
          {total > 0 && total <= 12 && (
            <span style={{ display: 'flex', gap: 3, marginLeft: 2, flex: 'none' }}>
              {Array.from({ length: total }, (_, i) => (
                <i key={i} style={{
                  width: 10, height: 3, borderRadius: 2,
                  background: i < step ? ac : 'rgba(255,255,255,.18)',
                  transition: 'background .3s ease',
                }} />
              ))}
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes acv-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
        @keyframes acv-pulse   { 0% { transform: scale(.5); opacity: .45 } 70% { transform: scale(2.9); opacity: 0 } 100% { opacity: 0 } }
        @keyframes acv-dot     { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.55) } 70%,100% { box-shadow: 0 0 0 5px rgba(255,255,255,0) } }
        @keyframes acv-ripple  { from { transform: scale(.35); opacity: .9 } to { transform: scale(2.7); opacity: 0 } }
        @keyframes acv-ripple2 { from { transform: scale(.35); opacity: .6 } to { transform: scale(3.4); opacity: 0 } }
        @keyframes acv-in      { from { opacity: 0; transform: scale(.5) } to { opacity: 1; transform: scale(1) } }
        @keyframes acv-fade    { from { opacity: 0 } to { opacity: 1 } }
        /* Reduced motion keeps every state readable and only removes the movement. A cursor that
           vanished for someone who turned animation off would be worse than one that jumps. */
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
      `}</style>
    </div>
  );
}
