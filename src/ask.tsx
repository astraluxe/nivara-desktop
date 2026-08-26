// The small window the agent opens just below its cursor when it hits something only the user can
// answer — which Google account, which mailbox, which of two files they meant.
//
// It is deliberately NOT part of the adris window. The user's eyes are on the application being
// worked in; a prompt that opens somewhere else, possibly behind what they are looking at, is a
// prompt that gets missed — and a waiting agent then looks like a broken one.
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './index.css';
import { onAsk, sendAnswer, type AgentQuestion } from './lib/agentCursor';

function Ask() {
  const [q, setQ] = useState<AgentQuestion | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let off: (() => void) | null = null;
    onAsk((next) => { setQ(next); setTyped(''); }).then((fn) => { off = fn; }).catch(() => {});
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, []);

  if (!q) return null;
  const c = `rgb(${q.rgb})`;
  const answer = (value: string) => { if (value.trim()) { sendAnswer(q.id, value.trim()); setQ(null); } };

  return (
    <div style={{
      fontFamily: "'Space Grotesk', Inter, 'Segoe UI', sans-serif",
      background: 'rgba(16,16,22,.97)',
      border: `1px solid rgb(${q.rgb} / .5)`,
      borderRadius: 16,
      boxShadow: `0 18px 50px -16px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.05) inset, 0 0 26px -10px ${c}`,
      color: '#f2f2f8', padding: 14, margin: 6,
      animation: 'nv-ask-in 200ms cubic-bezier(.22,.61,.36,1) both',
    }}>
      {/* A little arrow pointing back up at the cursor, so it is obvious WHICH agent is asking and
          that this belongs to the work happening above it. */}
      <div style={{ position: 'absolute', top: -1, left: 34, width: 12, height: 12, transform: 'rotate(45deg)',
                    background: 'rgba(16,16,22,.97)', borderLeft: `1px solid rgb(${q.rgb} / .5)`,
                    borderTop: `1px solid rgb(${q.rgb} / .5)` }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: c, boxShadow: `0 0 8px ${c}` }} />
        <b style={{ color: c, fontSize: 11.5, fontWeight: 600 }}>{q.agent}</b>
        <span style={{ fontSize: 10.5, opacity: .45 }}>needs to know</span>
      </div>

      <p style={{ fontSize: 13.5, lineHeight: 1.45, margin: '0 0 4px' }}>{q.question}</p>
      {q.because && (
        <p style={{ fontSize: 11, lineHeight: 1.45, opacity: .6, margin: '0 0 10px' }}>{q.because}</p>
      )}

      {/* REAL CHOICES WHERE THEY EXIST. The accounts actually signed in are a list the user
          recognises; asking them to type one out invites a typo that becomes a wrong account. */}
      {!!q.options?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0 4px' }}>
          {q.options.map((o) => (
            <button
              key={o.id}
              onClick={() => answer(o.id)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: '9px 11px', borderRadius: 10,
                background: 'rgba(255,255,255,.045)', border: '1px solid rgba(255,255,255,.1)',
                color: '#f2f2f8', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.35,
                transition: 'background .12s, border-color .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `rgb(${q.rgb} / .16)`; e.currentTarget.style.borderColor = `rgb(${q.rgb} / .5)`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.045)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'; }}
            >
              <span style={{ fontWeight: 600 }}>{o.label}</span>
              {o.detail && <span style={{ display: 'block', opacity: .55, fontSize: 11, marginTop: 2 }}>{o.detail}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Free text is the fallback, never the default — but it is always there, because a list of
          options can always be missing the one that is actually true. */}
      <div style={{ display: 'flex', gap: 6, marginTop: q.options?.length ? 8 : 10 }}>
        <input
          autoFocus={!q.options?.length}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') answer(typed); }}
          placeholder={q.options?.length ? 'or tell me something else…' : 'your answer…'}
          style={{
            flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 9,
            background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.12)',
            color: '#f2f2f8', fontFamily: 'inherit', fontSize: 12.5, outline: 'none',
          }}
        />
        <button
          onClick={() => answer(typed)}
          disabled={!typed.trim()}
          style={{
            padding: '8px 13px', borderRadius: 9, border: 'none', cursor: typed.trim() ? 'pointer' : 'default',
            background: typed.trim() ? c : 'rgba(255,255,255,.08)',
            color: typed.trim() ? '#fff' : 'rgba(242,242,248,.35)',
            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
          }}
        >Send</button>
      </div>

      {q.rememberAs && (
        <p style={{ fontSize: 10, opacity: .45, margin: '9px 0 0' }}>
          I will remember this, so I only ask once.
        </p>
      )}

      <style>{`@keyframes nv-ask-in { from { opacity: 0; transform: translateY(-6px) scale(.98) } to { opacity: 1; transform: none } }`}</style>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Ask />);
