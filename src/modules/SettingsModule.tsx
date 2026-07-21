import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useAuth } from '../contexts/AuthContext';
import AiSourcePicker from '../components/AiSourcePicker';

interface NvSettings {
  automationAutoRun: boolean;
  automationNotify:  boolean;
  automationRunMode: 'always' | 'app_open';  // 'app_open' = only while app is open (current default)
  // Default behaviour when an agent produces a list/table that matches existing work:
  // 'continue' tops up the existing Brain note, 'new' always starts a fresh one. Either way an
  // explicit instruction in chat ("continue the existing list") wins over this default.
  listMode: 'continue' | 'new';
  // Advanced/experimental — Krew can explore an arbitrary website (snapshot → click → fill) and
  // learn a reusable "skill" from what it did, instead of only using pre-built site integrations.
  // Off by default: opt-in, since it lets the agent interact with sites it has no specific
  // instructions for. It still NEVER submits/sends/pays without an explicit approval click either
  // way — this setting only controls whether the exploratory tools exist at all.
  webAutopilot: boolean;
}

const DEFAULTS: NvSettings = {
  automationAutoRun: true,
  automationNotify:  true,
  automationRunMode: 'app_open',
  listMode:          'continue',
  webAutopilot:      false,
};

export function loadSettings(): NvSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('nv-settings') ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(s: NvSettings) {
  localStorage.setItem('nv-settings', JSON.stringify(s));
}

// Short, human-readable "what changed" notes for the current version — shown in About below.
// Add a new entry here on future releases; keep only the last few so this doesn't grow forever.
const WHATS_NEW: { version: string; items: string[] } = {
  version: '1.6.13',
  items: [
    'Fixed: people added by a later /scan now get messages. Attaching a campaign file made it the whole list of people, so anyone scanned afterwards could never be drafted for, however many times you ran outreach. A campaign file records how far you got, not who you know — so the roster is now topped up from your saved connections, and everyone you have already messaged keeps their status and is not drafted again.',
    'Upgrading now opens the checkout on adris.tech in your browser instead of doing nothing. Payment is deliberately handled only on the website: the app never processes money and never grants a plan by itself, so a tampered copy cannot fake one. Pay signed in with the same email, then press “I’ve paid — check my plan” and it updates.',
    'Fixed: asking for DMs or cold emails “for the people in <file>” now opens the outreach copilot with the drafted messages. Without the literal word “outreach” it used to be routed to a strategy agent, which replied with a market-analysis report instead of the messages.',
    '/outreach now asks two questions before it starts: which list of people to message, then which campaign note to save into (or a new one you name). It no longer guesses either — guessing is what put a 52-person list under one contact’s name. It remembers the note you last chose and marks it “last used”.',
    'The same searchable file picker now opens for /summarize as well as /verify, /enrich, /findleads, /expand, /draft, /email and /repair-table — pick a saved file instead of typing its name.',
    'Fixed: long AI replies no longer come back with words missing from the middle of sentences. The streaming reader parsed each network packet on its own, so any message split across a packet boundary failed to decode and was silently thrown away — taking a chunk of the answer with it. Text now survives the boundary intact, including accented and non-English characters.',
    'Web Autopilot is much better at unfamiliar forms: Krew now reads every field — its label, whether it is required, and a dropdown’s real options — before filling anything, and can set dropdowns, tick checkboxes and choose radio buttons, which it simply could not do before. Fields labelled the normal way, or with no label at all, are no longer invisible to it.',
    'Skills are now saved as a step-by-step recipe — the site, which fields to fill, what to ask you for, and which step needs your approval — so repeating a task follows what worked last time instead of working the page out again. Krew will not build or run a skill for anything unlawful or abusive.',
    'Fixed: "block Tuesday" and similar now go through the calendar tool, which shows you the event and waits for your approval. Krew was instead driving the Google Calendar website by hand, which left a half-filled form it could never safely save — so nothing was created and you were never asked.',
    'When a task stops before producing anything there is now a Continue button, so you do not have to retype the request. The message it leaves also no longer talks about lead lists when the task had nothing to do with leads.',
    'Fixed: to-dos created by Krew no longer show a literal "!high" in the task name.',
    'Ticking a to-do off keeps it in Done rather than removing it, and each completed item now has a visible ✕ so you decide when it goes.',
    'Asking Krew to update your to-do no longer tells you to connect Google Calendar — the to-do list is local and needs no connected account.',
    'Fixed: text typed into "Your reference note" in the Brain is no longer lost when you close the panel with Escape or the ✕ — it used to save only if you clicked out of the box first.',
    'Renaming a Brain note now renames it everywhere: the to-do that points at it, and — for an outreach note — the campaign itself. Previously the campaign kept its old name internally, so it recreated a second note under the old title and the to-do never updated.',
    'Fixed: replying to one person no longer renames your whole outreach campaign after them. A one-person errand saves a campaign too, and the next full run was inheriting its name — which is how a 52-person list ended up filed under a single contact.',
  ],
};

function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-nv-border/60 last:border-0">
      <div className="flex-1">
        <p className="text-[12px] text-nv-text font-medium">{label}</p>
        {desc && <p className="text-[10px] text-nv-muted mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <button
        onClick={() => onChange(!on)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none ${on ? 'bg-accent' : 'bg-nv-surface2'}`}
        aria-checked={on}
        role="switch"
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${on ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-nv-surface border border-nv-border rounded-xl p-5 mb-4">
      <p className="nv-eyebrow text-nv-muted mb-3">{title}</p>
      {children}
    </div>
  );
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'latest' | 'installing' | 'error';
type VoiceStatus = 'checking' | 'ready' | 'downloading' | 'idle' | 'error';

export default function SettingsModule() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [settings, setSettings] = useState<NvSettings>(loadSettings);
  const [appVersion, setAppVersion]   = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; body?: string; current?: string; propagating?: boolean }>({});
  const [updateErr, setUpdateErr] = useState('');
  const [updatePct, setUpdatePct] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('checking');
  const [voicePct, setVoicePct]       = useState(0);
  const [voiceStep, setVoiceStep]     = useState('');

  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  useEffect(() => {
    invoke<{ ready: boolean }>('voice_check_setup')
      .then(r => setVoiceStatus(r.ready ? 'ready' : 'idle'))
      .catch(() => setVoiceStatus('idle'));
  }, []);

  async function downloadVoice() {
    setVoiceStatus('downloading');
    setVoiceStep('Preparing…');
    setVoicePct(0);
    const unsub = await listen<{ step: string; pct: number }>('voice_setup_progress', e => {
      setVoiceStep(e.payload.step);
      setVoicePct(e.payload.pct);
    });
    try {
      await invoke('voice_download_setup');
      setVoiceStatus('ready');
    } catch (e) {
      setVoiceStatus('error');
      setVoiceStep(`Failed: ${e}`);
    } finally {
      unsub();
    }
  }

  async function checkUpdate() {
    setUpdateStatus('checking');
    setUpdateInfo({});
    setUpdateErr('');
    try {
      const res = await invoke<{ available: boolean; version?: string; body?: string; current?: string; propagating?: boolean }>('check_for_update');
      if (res.available) {
        setUpdateStatus('available');
        setUpdateInfo({ version: res.version, body: res.body, current: res.current, propagating: res.propagating });
      } else {
        setUpdateInfo({ current: res.current });
        setUpdateStatus('latest');
      }
    } catch (e) {
      console.error('check_for_update failed:', e);
      setUpdateStatus('error');
    }
  }

  // Live download progress so "installing…" never just looks frozen (the cursor-spinner the user
  // saw). The Rust install_update emits `update-progress` {downloaded,total} as it streams.
  useEffect(() => {
    const un = listen<{ downloaded: number; total: number }>('update-progress', (e) => {
      const { downloaded, total } = e.payload || { downloaded: 0, total: 0 };
      if (total > 0) setUpdatePct(Math.min(100, Math.round((downloaded / total) * 100)));
    });
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  async function installUpdate() {
    setUpdateStatus('installing');
    setUpdateErr('');
    setUpdatePct(0);
    try {
      await invoke('install_update');
      // install_update restarts the app on success, so reaching here means it returned without
      // installing (e.g. the release is still propagating) — surface that instead of hanging.
      setUpdateStatus('available');
    } catch (e) {
      setUpdateErr(e instanceof Error ? e.message : String(e));
      setUpdateStatus('available');
    }
  }

  function update<K extends keyof NvSettings>(key: K, val: NvSettings[K]) {
    const next = { ...settings, [key]: val };
    setSettings(next);
    saveSettings(next);
  }

  // Quick Bar — the always-on-top mini chat at the top of the screen.
  const [quickbarOn, setQuickbarOn] = useState(() => localStorage.getItem('nv-quickbar') !== 'off');
  async function toggleQuickbar(v: boolean) {
    setQuickbarOn(v);
    localStorage.setItem('nv-quickbar', v ? 'on' : 'off');
    emit('nv-quickbar-toggle', { on: v }).catch(() => {});
    // The bar's whole point is being there at login without opening the app —
    // so the autostart registration follows the same switch.
    try {
      const { enable, disable } = await import('@tauri-apps/plugin-autostart');
      if (v) await enable(); else await disable();
    } catch { /* autostart unavailable — bar still toggles for this session */ }
  }

  return (
    <div className="h-full overflow-y-auto bg-nv-bg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-nv-border shrink-0">
        <h1 className="text-[16px] font-semibold text-nv-text tracking-tight">Settings</h1>
        <p className="text-[11px] text-nv-muted mt-0.5">Preferences stored locally on this device.</p>
      </div>

      <div className="p-6 max-w-xl">

        {/* Automation */}
        <Section title="Automation">
          <Toggle
            on={settings.automationAutoRun}
            onChange={(v) => update('automationAutoRun', v)}
            label="Auto-run scheduled automations"
            desc="When enabled, automations fire automatically based on their trigger. Disable to pause all automations without deleting them."
          />
          <Toggle
            on={settings.automationNotify}
            onChange={(v) => update('automationNotify', v)}
            label="Show run notifications"
            desc="Display a desktop notification each time an automation runs successfully."
          />
          <div className="pt-3">
            <p className="text-[12px] text-nv-text font-medium mb-2">Run mode</p>
            <div className="flex flex-col gap-2">
              {[
                { val: 'app_open' as const, label: 'Only while adris.tech is open', desc: 'Automations run when the app is active. Nothing runs in the background.' },
                { val: 'always'   as const, label: '24/7 background mode', desc: 'Automations run even when the window is hidden. App stays in the system tray.' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => update('automationRunMode', opt.val)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-fast ${
                    settings.automationRunMode === opt.val
                      ? 'border-accent/50 bg-accent/5'
                      : 'border-nv-border hover:border-nv-border/80'
                  }`}
                >
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    settings.automationRunMode === opt.val ? 'border-accent' : 'border-nv-faint'
                  }`}>
                    {settings.automationRunMode === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </span>
                  <div>
                    <p className={`text-[11px] font-medium ${settings.automationRunMode === opt.val ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</p>
                    <p className="text-[10px] text-nv-muted mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="pt-3">
            <p className="text-[12px] text-nv-text font-medium mb-2">Lists &amp; notes</p>
            <div className="flex flex-col gap-2">
              {[
                { val: 'continue' as const, label: 'Continue the existing list', desc: 'When Krew produces a list that matches earlier work, it tops up that note instead of creating another one — so your outreach status and saved rows carry over.' },
                { val: 'new'      as const, label: 'Always start a new list', desc: 'Every run saves to its own new note. Useful if you want a clean record of each session.' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => update('listMode', opt.val)}
                  className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-fast ${
                    settings.listMode === opt.val ? 'border-accent/50 bg-accent/5' : 'border-nv-border hover:border-nv-border/80'
                  }`}
                >
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    settings.listMode === opt.val ? 'border-accent' : 'border-nv-faint'
                  }`}>
                    {settings.listMode === opt.val && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                  </span>
                  <div>
                    <p className={`text-[11px] font-medium ${settings.listMode === opt.val ? 'text-accent' : 'text-nv-text'}`}>{opt.label}</p>
                    <p className="text-[10px] text-nv-muted mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-nv-faint mt-2 leading-relaxed">
              Whatever you pick here, saying <span className="text-nv-muted">“continue the existing list”</span> in chat always wins for that request.
            </p>
          </div>
        </Section>

        {/* Advanced / experimental */}
        <Section title="Advanced">
          <Toggle
            on={settings.webAutopilot}
            onChange={(v) => update('webAutopilot', v)}
            label="Web Autopilot"
            desc="Let Krew figure out sites it wasn't specifically built for: it reads the page, works out which fields/buttons matter, fills things in, and can attach a file it finds on your computer. It always shows you the finished action and waits for your approval before anything is actually sent, submitted, or paid — never automatically. Once you approve a task, Krew remembers how it did it as a reusable skill for next time (visible in Brain, say /skills)."
          />
        </Section>

        {/* AI source — governs every module that runs AI in the background */}
        <Section title="Where AI runs">
          <p className="text-[11.5px] leading-[1.6] text-nv-muted mb-3">
            Guard scans, automations and other background work use this. Pick the hosted AI, your own
            API key, or a model running on this machine — your own key and local models never touch
            your monthly allowance. The Krew chat keeps its own switch in the connection bar.
          </p>
          <AiSourcePicker compact />
        </Section>

        {/* Interface */}
        <Section title="Interface">
          <Toggle
            on={quickbarOn}
            onChange={toggleQuickbar}
            label="Quick Bar & corner badge"
            desc="The adris chat bar sits at the top-center of your desktop; inside other apps it becomes a small logo at the right edge (click it to chat, right-click to hide it for 1 or 24 hours). Starts with Windows. Turn off to remove both entirely."
          />
          <div className="py-2">
            <p className="text-[12px] text-nv-text font-medium">Theme</p>
            <p className="text-[10px] text-nv-muted mt-1">Use the theme toggle at the bottom of the sidebar (sun/moon icon) to switch between Ink (dark) and Paper (light).</p>
          </div>
          <div className="pt-2 border-t border-nv-border/60 py-2">
            <p className="text-[12px] text-nv-text font-medium">Sidebar expand</p>
            <p className="text-[10px] text-nv-muted mt-1">The sidebar expands after hovering for 2 seconds, showing module names and status labels. Move the mouse away to collapse.</p>
          </div>
        </Section>

        {/* Data */}
        <Section title="Local data">
          <div className="py-2">
            <p className="text-[12px] text-nv-text font-medium">Storage location</p>
            <p className="text-[10px] text-nv-muted mt-1">All data (chat history, credentials, automation logs) is stored on your device only. Nothing is sent to adris.tech servers unless you explicitly use cloud features.</p>
          </div>
          <div className="pt-3 border-t border-nv-border/60">
            <p className="text-[11px] text-nv-muted mb-3">Clear specific local data:</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { localStorage.removeItem('nv-coder-state'); alert('Coder state cleared.'); }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-nv-red hover:text-nv-red transition-fast"
              >Clear Coder state</button>
              <button
                onClick={() => {
                  const key = uid ? `nv-tour-done-${uid}` : 'nv-tour-done';
                  const setupKey = uid ? `nv-first-run-done-v1-${uid}` : 'nv-first-run-done-v1';
                  localStorage.removeItem(key);
                  localStorage.removeItem(setupKey);
                  alert('Onboarding reset. Relaunch the app to see it again.');
                }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >Reset onboarding tour</button>
            </div>
          </div>
        </Section>

        {/* Voice */}
        <Section title="Voice — Whisper">
          {voiceStatus === 'checking' && (
            <p className="text-[11px] text-nv-muted">Checking…</p>
          )}
          {voiceStatus === 'ready' && (
            <div className="flex items-center gap-2 py-1">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0">
                <circle cx="9" cy="9" r="9" fill="#22c55e"/>
                <path d="M4.5 9.5l3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div>
                <p className="text-[12px] text-nv-text font-medium">Voice is ready</p>
                <p className="text-[10px] text-nv-muted mt-0.5">Whisper engine + model installed. Use the mic button in any chat.</p>
              </div>
            </div>
          )}
          {(voiceStatus === 'idle' || voiceStatus === 'error') && (
            <div>
              <p className="text-[12px] text-nv-text font-medium mb-0.5">Voice / Speech-to-text</p>
              <p className="text-[10px] text-nv-muted mb-3">Downloads Whisper (OpenAI) locally — ~150 MB. Lets you speak to adris.tech instead of typing.</p>
              {voiceStatus === 'error' && (
                <p className="text-[10px] text-nv-red font-mono mb-2">{voiceStep}</p>
              )}
              <button
                onClick={downloadVoice}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >
                Download Voice (~150 MB)
              </button>
            </div>
          )}
          {voiceStatus === 'downloading' && (
            <div>
              <p className="text-[12px] text-nv-text font-medium mb-2">Downloading…</p>
              <div className="h-1 bg-nv-border rounded-full overflow-hidden mb-1">
                <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${voicePct}%` }} />
              </div>
              <p className="text-[10px] text-nv-faint font-mono">{voiceStep}</p>
            </div>
          )}
        </Section>

        {/* About */}
        <Section title="About adris.tech">
          <div className="space-y-1.5 mb-4">
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Version</span>
              <span className="text-nv-text font-mono">{appVersion || '—'}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Platform</span>
              <span className="text-nv-text font-mono">Tauri 2 · React · Rust</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-nv-muted">Built in</span>
              <span className="text-nv-text font-mono">India</span>
            </div>
          </div>

          {/* What's new */}
          <div className="pt-3 border-t border-nv-border/60 mb-1">
            <p className="text-[12px] text-nv-text font-medium mb-2">What's new in v{WHATS_NEW.version}</p>
            <ul className="space-y-1.5">
              {WHATS_NEW.items.map((it, i) => (
                <li key={i} className="text-[10.5px] text-nv-muted leading-relaxed flex gap-1.5">
                  <span className="text-accent shrink-0">•</span>
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Update checker */}
          <div className="pt-3 border-t border-nv-border/60">
            {updateStatus === 'available' && (
              <div className="mb-3 p-3 rounded-lg bg-accent/10 border border-accent/30">
                <p className="text-[11px] text-accent font-medium">Update available — v{updateInfo.version}{updateInfo.current ? <span className="text-nv-muted font-normal"> (you're on v{updateInfo.current})</span> : null}</p>
                {updateInfo.body && <p className="text-[10px] text-nv-muted mt-1 leading-relaxed">{updateInfo.body}</p>}
                {updateInfo.propagating && !updateErr && (
                  <p className="text-[10px] text-nv-muted mt-1 leading-relaxed">Just published — if Install says it's not ready yet, give it a minute and try again.</p>
                )}
                {updateErr && (
                  <p className="text-[10px] text-nv-red mt-1.5 leading-relaxed">{updateErr}</p>
                )}
              </div>
            )}
            {updateStatus === 'latest' && (
              <p className="text-[11px] text-nv-green mb-3">You're on the latest version{updateInfo.current ? ` (v${updateInfo.current})` : ''}.</p>
            )}
            {updateStatus === 'error' && (
              <p className="text-[11px] text-nv-red mb-3">Could not check for updates. Check your connection.</p>
            )}
            {updateStatus === 'installing' && (
              <div className="mb-3">
                <p className="text-[11px] text-nv-muted">{updatePct > 0 ? `Downloading update — ${updatePct}%` : 'Starting download…'} The app will restart automatically when done.</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-nv-surface2 overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${updatePct}%` }} />
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={checkUpdate}
                disabled={updateStatus === 'checking' || updateStatus === 'installing'}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast disabled:opacity-40"
              >
                {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              {updateStatus === 'available' && (
                <button
                  onClick={installUpdate}
                  className="text-[10px] px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-fast"
                >
                  Install &amp; restart
                </button>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
