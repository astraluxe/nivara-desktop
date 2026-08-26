// The click-through overlay that draws the agent's pointer. See src/lib/agentCursor.ts for why it
// draws a cursor instead of taking the user's.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './index.css';
import { onCursor, type CursorState } from './lib/agentCursor';

const BLANK: CursorState = { visible: false, x: 0, y: 0, rgb: '124 92 255', agent: '', doing: '' };

function Overlay() {
  const [s, setS] = useState<CursorState>(BLANK);
  useEffect(() => {
    let off: (() => void) | null = null;
    onCursor(setS).then((fn) => { off = fn; }).catch(() => {});
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  if (!s.visible) return null;
  const c = `rgb(${s.rgb})`;

  return (
    // The window is already positioned so this corner sits on the target point; everything draws
    // from here. pointer-events stay off in CSS as well as at the window level — belt and braces,
    // because a sheet that swallowed the user's clicks would be the worst possible failure here.
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'transparent', overflow: 'hidden' }}>
      {/* The click ripple, drawn under the pointer so the pointer stays crisp on top. */}
      {s.clicking && (
        <span style={{
          position: 'absolute', left: 10, top: 10, width: 34, height: 34,
          marginLeft: -17, marginTop: -17, borderRadius: 999,
          border: `2px solid ${c}`, animation: 'nv-cur-ping 320ms ease-out forwards',
        }} />
      )}

      {/* The pointer itself. A filled arrow with a light outline so it stays visible on a dark
          window and on a white document alike — the two backgrounds it will actually land on. */}
      <svg width="26" height="30" viewBox="0 0 26 30" style={{ position: 'absolute', left: 10, top: 10, overflow: 'visible' }}>
        <path d="M2 1 L2 21 L7.4 16.2 L11 25 L15 23 L11.4 14.6 L18.6 14.2 Z"
              fill={c} stroke="rgba(255,255,255,.92)" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>

      {/* The label. This is the whole reason the overlay exists: a pointer with no words is a
          mystery, and the standing rule is to name what is happening rather than show a spinner. */}
      <div style={{
        position: 'absolute', left: 34, top: 26, maxWidth: 400,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '7px 12px 7px 10px', borderRadius: 999,
        background: 'rgba(14,14,19,.94)',
        border: `1px solid rgb(${s.rgb} / .55)`,
        boxShadow: `0 8px 26px -10px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.05) inset, 0 0 18px -6px ${c}`,
        color: '#f2f2f8', fontFamily: "'Space Grotesk', Inter, 'Segoe UI', sans-serif",
        fontSize: 12, lineHeight: 1.25, whiteSpace: 'nowrap',
        animation: 'nv-cur-in 180ms cubic-bezier(.22,.61,.36,1) both',
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: c, flexShrink: 0,
                       boxShadow: `0 0 8px ${c}`, animation: 'nv-cur-pulse 1.4s ease-in-out infinite' }} />
        <b style={{ color: c, fontWeight: 600 }}>{s.agent}</b>
        <span style={{ opacity: .55 }}>·</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.doing}</span>
      </div>

      <style>{`
        @keyframes nv-cur-ping  { from { transform: scale(.4); opacity: .9 } to { transform: scale(1.9); opacity: 0 } }
        @keyframes nv-cur-in    { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
        @keyframes nv-cur-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      `}</style>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Overlay />);
