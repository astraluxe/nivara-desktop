import UpgradeModal from '../src/components/UpgradeModal';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import '../src/index.css';
import TitleBar from '../src/components/TitleBar';
import Sidebar from '../src/components/Sidebar';
import Caret from '../src/components/ui/Caret';
import SearchModeMenu, { type SearchMode } from '../src/components/krew/SearchModeMenu';
import TipBar from '../src/components/krew/TipBar';
import DiffView from '../src/components/coder/DiffView';
import ToolRail from '../src/components/ToolRail';
import ToolsModule from '../src/modules/ToolsModule';
import ConversationList from '../src/components/krew/ConversationList';
import UsagePanel from '../src/components/UsagePanel';
import BrainModule from '../src/modules/BrainModule';
import TipStage from '../src/components/krew/TipStage';
import OfficeView from '../src/components/krew/OfficeView';
import { setActivity } from '../src/lib/agentActivity';

// A believable chat history for ?chats=1, spanning every branch of the row's time column — a clock
// time today, a weekday this week, a date beyond that — so one screenshot shows all of them.
// Exposed for harness/docx-real.mjs, which builds a REAL .docx and reads it back through the
// shipped code. readDocx needs Image() to measure a picture, so it has to run in a browser.
import('../src/lib/docImages').then((m) => { (window as any).__docImages = m; });
// deck-images.mjs builds a REAL .pptx through the shipped renderer and unzips it, because the only
// proof that a picture reached PowerPoint is finding it inside the file.
import('../src/lib/deck').then((m) => { (window as any).__deck = m; });
import('jszip').then((m) => { (window as any).__JSZip = (m as any).default || m; });

const HOUR = 3600, DAY = 86400;
// A machine WITH Office, so the rail's "on this computer" section can be looked at. The rail reads
// the cached scan, which is exactly what this writes.
//
// THE APPS LIST IS NOT OPTIONAL. This used to seed `apps: []` and lean on the `automation` flags
// alone — a machine with the Office COM servers registered but no applications, which is not a
// machine that can exist. The rail and the deck card both need the executable's real PATH now
// (the rail used to launch 'winword' as a command name, and every click failed in silence), so an
// empty list hides the rail's Office section and the deck's PowerPoint option — the very things
// this page exists to show.
try {
  // A test that describes a DIFFERENT machine — no PowerPoint, say — seeds this before the page
  // loads. Never overwrite what is already there.
  if (!localStorage.getItem('nv-installed-apps')) {
    const OFFICE = String.raw`C:\Program Files\Microsoft Office\root\Office16`;
    localStorage.setItem('nv-installed-apps', JSON.stringify({
      scannedAt: Date.now(),
      apps: [
        { name: 'Microsoft Word',       kind: 'office', path: OFFICE + String.raw`\WINWORD.EXE` },
        { name: 'Microsoft Excel',      kind: 'office', path: OFFICE + String.raw`\EXCEL.EXE` },
        { name: 'Microsoft PowerPoint', kind: 'office', path: OFFICE + String.raw`\POWERPNT.EXE` },
      ],
      automation: { word: true, excel: true, powerpoint: true, outlook: false, libreoffice: false },
    }));
  }
} catch { /* private mode */ }
// usage-rows-stub — a believable period so the usage panel can be looked at: a mix of billable
// adris rows, own-key and bridge rows, and a couple of legacy rows with no source at all.
(window as any).__usageRows = Array.from({ length: 26 }, (_, i) => {
  const src = ['adris', 'adris', 'bridge', 'own_key', 'local', undefined][i % 6];
  const mod = ['krew_direct', 'coder', 'krew_image', 'automation'][i % 4];
  return {
    created_at: new Date(Date.now() - (13 - Math.floor(i / 2)) * 86400000).toISOString(),
    task_type: mod,
    tokens_consumed: 400 + ((i * 977) % 9000),
    input_tokens: i % 3 === 0 ? null : 300 + ((i * 131) % 2000),
    output_tokens: i % 3 === 0 ? null : 100 + ((i * 71) % 900),
    model_used: 'gemini-3-flash-preview',
    source: src,
  };
});
const nowS = Math.floor(Date.now() / 1000);
(window as any).__invokeReplies = {
  ...(window as any).__invokeReplies,
  // Wrapped in an extra array ON PURPOSE. The stub reads a top-level array as a QUEUE of replies
  // and shifts one off, so passing the sessions directly handed the list a single session object
  // ("o is not iterable"); and stringifying it made React iterate 723 characters instead. A
  // one-entry queue whose entry is the array is the shape that survives both.
  db_krew_get_sessions: ([[
    { id: 's1', title: 'Outreach to the 40 leads in my sheet', agent_key: 'cold_outreach', message_count: 24, last_active: nowS - 4 * 60 },
    { id: 's2', title: 'Why are our Instagram ads not converting', agent_key: 'ad_copywriter', message_count: 11, last_active: nowS - 3 * HOUR },
    { id: 's3', title: 'Q3 numbers', agent_key: 'cfo', message_count: 6, last_active: nowS - 7 * HOUR },
    { id: 's4', title: 'Fix the checkout bug on the pricing page', agent_key: 'coder', message_count: 41, last_active: nowS - DAY - 2 * HOUR },
    { id: 's5', title: 'Competitor pricing in Bangalore', agent_key: 'research_agent', message_count: 9, last_active: nowS - 3 * DAY },
    { id: 's6', title: 'Supplier contract review', agent_key: 'boss', message_count: 3, last_active: nowS - 26 * DAY },
  ]] as unknown as string),
};

// Put three agents to work so the room shows what it is FOR — the desks that light up.
setActivity({ agent: 'Arjun.Boss', agentKey: 'boss', headline: 'Routing', startedAt: Date.now(), phase: 'thinking' });
setActivity({ agent: 'Nyx.Research', agentKey: 'research_agent', headline: 'Searching', startedAt: Date.now(), phase: 'tool' });
setActivity({ agent: 'Neo.Engineer', agentKey: 'coder', headline: 'Writing', startedAt: Date.now(), phase: 'writing' });
import { deptColor } from '../src/lib/krewAgents';
import { DeckSetupCard } from '../src/components/krew/KrewChat';
import CoderModule from '../src/modules/CoderModule';

/** The working state on a real avatar — F3.2, shown at the size it appears in the thread. */
function WorkingAvatars() {
  const rows: Array<[string, 'Boss' | 'Data' | 'Engineer', string, boolean]> = [
    ['AR', 'Boss', 'Arjun.Boss', true],
    ['NY', 'Data', 'Nyx.Research', true],
    ['NE', 'Engineer', 'Neo.Engineer', false],
  ];
  return (
    <div className="flex items-center gap-5 px-4 py-3 border-b border-nv-border bg-nv-bg">
      {rows.map(([ini, cat, name, working]) => {
        const varName = deptColor(cat).match(/--[a-z-]+/)![0];
        return (
          <div key={name} className="flex items-center gap-2">
            <div
              className={'w-6 h-6 rounded-nv-sm flex items-center justify-center text-[9px] font-bold shrink-0 ' + (working ? 'nv-working' : '')}
              style={{
                background: 'rgb(var(' + varName + ') / 0.16)',
                color: deptColor(cat),
                boxShadow: 'inset 0 0 0 1px rgb(var(' + varName + ') / 0.35)',
                ['--nv-work' as string]: 'var(' + varName + ')',
              }}
            >{ini}</div>
            <span className="text-[11px] text-nv-muted">{name}{working ? ' — working' : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A borderless composer control, the shape the real ones now take. */
function IconBtn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <button
      title={label}
      className="w-[30px] h-[30px] flex items-center justify-center rounded-full
                 text-nv-faint hover:text-accent hover:bg-nv-surface2 transition-fast shrink-0 mb-0.5"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </button>
  );
}

// The REAL TitleBar and Sidebar, plus a reproduction of the chat thread using the same classes the
// live bubbles carry. ?paper=1 renders the light theme.
//
// The theme is set through localStorage, NOT by adding the class here: Sidebar owns the theme via
// its own useTheme hook, which reads that key on mount and then rewrites the class from it. Setting
// the class directly produced two byte-identical screenshots, because the Sidebar removed it again
// a moment after mount.
// Pretend Claude Code is installed and the bridge is on, so the title-bar switch renders in its
// live state. The real button reads the same two keys.
localStorage.setItem('nv-byok-demo', '1');
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

const DEMO_TOOLS = Object.fromEntries(
  ['metabase', 'chatwoot', 'n8n', 'odoo', 'baserow', 'invoiceninja', 'calcom', 'erpnext',
   'dolibarr', 'akaunting', 'twentycrm', 'focalboard', 'zammad', 'documenso', 'kimai',
   'openwebui', 'espocrm', 'flowise']
    .map((id, i) => [id, { id, phase: (i === 1 ? 'starting' : 'ready') as 'ready' | 'starting', hostPort: 21000 + i }]),
);

function App() {
  const [searchMode, setSearchMode] = useState<SearchMode>('fast');
  return (
    <div className="flex flex-col h-screen w-screen bg-nv-bg">
      <TitleBar activeModule="krew" />
      <div className="flex flex-1 min-h-0">
        <Sidebar activeModule="krew" onModuleChange={() => {}} />
        <div className="flex flex-col flex-1 min-w-0">
          <TipBar appsConnected={0} onRunCommand={() => {}} onOpenModule={() => {}} />
          <WorkingAvatars />
          <div className="h-[260px] border-b border-nv-border">
            <DiffView projectPath="C:/repo" file="C:/repo/src/lib/agentActivity.ts" onClose={() => {}} />
          </div>
          {new URLSearchParams(location.search).get('upgrade')
            ? <UpgradeModal onClose={() => {}} currentPlan="free" />
            : new URLSearchParams(location.search).get('brain')
            ? <BrainModule />
            : new URLSearchParams(location.search).get('tip')
            ? <div className="flex-1 min-h-0"><TipStage appsConnected={3} onRunCommand={() => {}} onOpenModule={() => {}} /></div>
            : new URLSearchParams(location.search).get('usage')
            ? <div className="flex-1 overflow-auto p-6"><div className="max-w-sm mx-auto"><UsagePanel /></div></div>
            : new URLSearchParams(location.search).get('officeview')
            ? <OfficeView userId="u1" onSelectAgent={() => {}} onClose={() => {}} />
            : new URLSearchParams(location.search).get('rail')
            ? <div className="flex-1 flex min-h-0"><div className="flex-1" />
                <ToolRail states={{}} activeId={null} onOpen={() => {}} onBrowse={() => {}} />
              </div>
            : new URLSearchParams(location.search).get('deck')
            ? <div className="flex-1 overflow-auto p-6"><div className="max-w-md mx-auto">
                <DeckSetupCard unlockedAdvanced onCancel={() => {}} onGenerate={(cfg) => {
                  // The test reads this: the card's whole job is to hand back a config, and the
                  // destination is the part that had no way of being anything but 'html'.
                  (window as unknown as { __deckCfg?: unknown }).__deckCfg = cfg;
                }} />
              </div></div>
            : new URLSearchParams(location.search).get('chats')
            ? <div className="flex-1 flex min-h-0"><ConversationList activeId="s2" onSelect={() => {}} onNew={() => {}} onOpenApps={() => {}} onDelete={() => {}} onHide={() => {}} /><div className="flex-1" /></div>
            : new URLSearchParams(location.search).get('coder')
            ? <CoderModule />
            : new URLSearchParams(location.search).get('shelf')
              ? <ToolsModule />
              : <Thread />}
          {/* THE REAL COMPOSER SHAPE, and the real SearchModeMenu — not a mock of them.
              This used to be a lone bordered textarea, which meant the screenshot could not show
              the thing most often being changed. It now mirrors the shipped markup: one surface
              owning the border and the focus halo, with borderless controls floating on it. */}
          <div className="border-t border-nv-border px-4 py-3 bg-nv-bg">
            <div className="max-w-[760px] mx-auto">
              <div className="nv-field flex gap-1 items-end relative bg-nv-bg border border-nv-border
                              rounded-nv px-1.5 py-1.5 shadow-e1">
                <SearchModeMenu mode={searchMode} onChange={setSearchMode} busy={false} />
                <IconBtn label="Voice input">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </IconBtn>
                <IconBtn label="Attach a file">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </IconBtn>
                <IconBtn label="Attach from Brain">
                  <path d="M12 5a2.5 2.5 0 0 0-5 0 2.4 2.4 0 0 0-2 4 2.4 2.4 0 0 0 .5 4A2.4 2.4 0 0 0 7.5 17 2.3 2.3 0 0 0 12 17V5z" />
                  <path d="M12 5a2.5 2.5 0 0 1 5 0 2.4 2.4 0 0 1 2 4 2.4 2.4 0 0 1-.5 4A2.4 2.4 0 0 1 16.5 17 2.3 2.3 0 0 1 12 17" />
                </IconBtn>
                <textarea
                  rows={2}
                  defaultValue=""
                  placeholder="Ask Arjun anything…   type / for commands"
                  className="flex-1 bg-transparent border-0 px-2 py-1.5
                    text-[13px] leading-[1.55] text-nv-text outline-none focus:ring-0
                    resize-none placeholder:text-nv-faint"
                />
                <button className="shrink-0 self-end text-[11px] px-3 py-1.5 rounded-full bg-accent text-white hover:bg-accent-dim transition-fast font-medium">Send</button>
              </div>
            </div>
          </div>
        </div>
        <ToolRail states={DEMO_TOOLS} activeId={null} onOpen={() => {}} onBrowse={() => {}} />
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
