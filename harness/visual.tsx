import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/index.css';
import TitleBar from '../src/components/TitleBar';
import Sidebar from '../src/components/Sidebar';
import Caret from '../src/components/ui/Caret';

// The REAL TitleBar and Sidebar, plus a reproduction of the chat thread using the same classes the
// live bubbles carry. ?paper=1 renders the light theme.
//
// The theme is set through localStorage, NOT by adding the class here: Sidebar owns the theme via
// its own useTheme hook, which reads that key on mount and then rewrites the class from it. Setting
// the class directly produced two byte-identical screenshots, because the Sidebar removed it again
// a moment after mount.
// Pretend Claude Code is installed and the bridge is on, so the title-bar switch renders in its
// live state. The real button reads the same two keys.
localStorage.setItem('nv-agent-cli', JSON.stringify({ claude_code: '/fake/claude', codex: '' }));
localStorage.setItem('nv-ai-source', JSON.stringify({ mode: 'agent_cli', cli: 'claude_code' }));
// Open the AI-source menu on load so the dropdown itself is in the screenshot.
setTimeout(() => (document.querySelector('[aria-haspopup="menu"]') as HTMLButtonElement | null)?.click(), 300);
localStorage.setItem('nv-theme',
  new URLSearchParams(location.search).get('paper') ? 'paper' : 'ink');

function Thread() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex-1 overflow-auto bg-nv-bg px-6 py-4">
      <div className="max-w-[760px] mx-auto">

        <div className="flex flex-col items-end my-2">
          <div className="max-w-[80%] bg-accent/[0.13] border border-accent/25 shadow-e1
                          rounded-nv-xl rounded-tr-nv-sm px-3.5 py-2.5">
            <p className="text-[13px] leading-[1.6] text-nv-text whitespace-pre-wrap">
              Draft the outreach for the 40 leads in my sheet and show me the first one before sending.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/25 rounded-md">
                <span className="text-[10px] font-mono text-accent">leads-august.xlsx</span>
              </span>
            </div>
          </div>
        </div>

        <div className="my-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-6 h-6 rounded-nv-sm flex items-center justify-center text-[9px] font-bold shrink-0"
                 style={{ background: 'rgb(124 92 255 / 0.16)', color: '#7C5CFF',
                          boxShadow: 'inset 0 0 0 1px rgb(124 92 255 / 0.35)' }}>AR</div>
            <span className="text-[11.5px] font-semibold tracking-[-0.01em] text-nv-text">@arjun</span>
          </div>
          <div className="ml-8">
            <p className="nv-prose">
              Read the sheet — 40 rows, all with a work email. I have drafted the first one for Priya at Acme
              and left the other 39 queued behind it.
            </p>

            <div className="flex items-start gap-2 my-1.5 mt-3">
              <div className="w-5 h-5 rounded-md bg-accent/15 flex items-center justify-center shrink-0 mt-0.5">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M9 3l5 5-5 5" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="flex-1">
                <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-[11px] text-accent font-mono hover:text-nv-text transition-colors duration-fast ease-nv">
                  read_spreadsheet() <Caret open={open} />
                </button>
                {open && <pre className="text-[10px] text-nv-muted font-mono mt-1 bg-nv-bg border border-nv-border rounded-lg p-2 whitespace-pre-wrap">{'{ "path": "leads-august.xlsx", "sheet": "Contacts" }'}</pre>}
              </div>
            </div>

            <div className="my-2 ml-2 rounded-nv-lg border border-nv-border bg-nv-bg shadow-e1 overflow-hidden">
              <button className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-nv-faint font-mono hover:text-nv-text hover:bg-nv-surface2/50 transition-colors duration-fast ease-nv">
                read_spreadsheet · 40 rows <Caret open />
              </button>
              <div className="border-t border-nv-border">
                <table className="w-full text-[10px] border-collapse">
                  <tbody>
                    {[['Name','Company','Email'],['Priya Sharma','Acme','priya@acme.co.in'],['Rahul Verma','Beta','rahul@beta.in']].map((r, i) => (
                      <tr key={i} className={i === 0 ? 'bg-nv-surface2 font-semibold' : 'border-t border-nv-border'}>
                        {r.map((c, j) => <td key={j} className="px-1.5 py-1 text-nv-muted">{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="nv-card p-4 mt-5">
          <p className="nv-eyebrow text-accent mb-1">Elevation 1</p>
          <p className="nv-heading mb-1">A card, on the new surface scale</p>
          <p className="nv-prose">Contact shadow, ambient shadow, and a lit top edge.</p>
        </div>
        <div className="nv-sheet p-4 mt-3">
          <p className="nv-eyebrow text-accent mb-1">Elevation 3</p>
          <p className="nv-heading mb-1">A sheet — modals and popovers</p>
          <p className="nv-prose">The same language, further off the page.</p>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="flex flex-col h-screen w-screen bg-nv-bg">
      <TitleBar activeModule="krew" />
      <div className="flex flex-1 min-h-0">
        <Sidebar activeModule="krew" onModuleChange={() => {}} />
        <div className="flex flex-col flex-1 min-w-0">
          <Thread />
          <div className="border-t border-nv-border px-4 py-3 bg-nv-bg">
            <div className="max-w-[760px] mx-auto flex gap-2">
              <textarea
                rows={2}
                defaultValue=""
                placeholder="Ask Arjun anything…   type / for commands"
                className="nv-field flex-1 bg-nv-bg border border-nv-border rounded-nv px-3 py-2
                  text-[13px] leading-[1.55] text-nv-text outline-none resize-none placeholder:text-nv-faint"
              />
              <button className="shrink-0 self-start text-[11px] px-3 py-2 rounded-nv bg-accent text-white hover:bg-accent-dim transition-fast font-medium">Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
