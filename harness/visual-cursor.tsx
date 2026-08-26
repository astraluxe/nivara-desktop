// Screenshots the REAL overlay components on a mock desktop, so the design can be seen without
// building the exe. Only the Tauri event transport is stubbed; the components are the shipped ones.
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import AgentCursorView from '../src/components/overlay/AgentCursorView';
import AgentAskView from '../src/components/overlay/AgentAskView';

function Desktop() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden',
                  background: 'linear-gradient(135deg,#1b2030,#2a2340)' }}>
      {/* A stand-in for the Word window the cursor would be sitting over. */}
      <div style={{ position: 'absolute', left: 120, top: 70, width: 780, height: 470, borderRadius: 8,
                    background: '#fff', boxShadow: '0 24px 60px -20px rgba(0,0,0,.6)', overflow: 'hidden' }}>
        <div style={{ height: 30, background: '#2b579a', color: '#fff', fontSize: 12,
                      display: 'flex', alignItems: 'center', paddingLeft: 12,
                      fontFamily: 'Segoe UI, sans-serif' }}>watched — Word</div>
        <div style={{ padding: '28px 60px', fontFamily: 'Georgia, serif', color: '#111' }}>
          <h1 style={{ fontSize: 26, margin: '0 0 14px' }}>Proposal for Acme Manufacturing</h1>
          <h2 style={{ fontSize: 17, margin: '0 0 8px', color: '#2b579a' }}>What adris.tech does</h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
            Agents drive the software already on your computer.
          </p>
        </div>
      </div>

      {/* The real overlay, positioned where the window would put it. */}
      {/* The overlay is full-screen now and positions itself by transform, so it is mounted at the
          root exactly as it is in the real window. */}
      <AgentCursorView />
      <div style={{ position: 'absolute', left: 520, top: 430, width: 420 }}><AgentAskView /></div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Desktop />);
