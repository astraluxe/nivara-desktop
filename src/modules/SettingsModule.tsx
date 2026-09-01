import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { useAuth } from '../contexts/AuthContext';
import AiSourcePicker from '../components/AiSourcePicker';
import { loadUserLocation, saveUserLocation, clearUserLocation, locationLabel, type UserLocation } from '../lib/userLocation';
import { loadUserIdentity, saveUserIdentity, clearUserIdentity } from '../lib/userIdentity';
import { SCALE_OPTIONS } from '../lib/onboarding';

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
  // ONE folder on this machine that the agents may read and write — nothing else.
  //
  // Off by default, because it is a real grant of access to the user's own disk and nobody should
  // discover after the fact that it was on. When it is off the file tools do not exist at all,
  // which is a stronger guarantee than a tool that exists and is asked to behave.
  workspaceEnabled: boolean;
  /** Absolute path. Empty means "use the default", which is Desktop/adris.tech. */
  workspacePath: string;
}

const DEFAULTS: NvSettings = {
  automationAutoRun: true,
  automationNotify:  true,
  automationRunMode: 'app_open',
  listMode:          'continue',
  webAutopilot:      false,
  workspaceEnabled:  false,
  workspacePath:     '',
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
/**
 * The running version, from package.json via Vite.
 *
 * WHATS_NEW.version was typed by hand and read **1.27.1** while the app was on 1.78.0 — fifty-one
 * releases adrift, telling every user the wrong thing on a panel whose whole job is to say what
 * changed. It is derived now, and scripts/check-whats-new.mjs fails the build if the notes below
 * were not updated for the current release.
 */
const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string) || '1.78.0';

const WHATS_NEW: { version: string; items: string[] } = {
  version: APP_VERSION,
  items: [
    "Pictures from your files can now go into the Word document it makes for you. Attach slides or a report with diagrams and the figures are placed in the document where they belong, with a caption. They could not be before -- a paragraph could only be a style and some words, so there was nowhere for a picture to go, and a study guide built from four decks of diagrams arrived with none of them. If a reference could mean more than one picture it places none, because the wrong diagram under a caption is worse than no diagram.",
    "Notes for something you are being tested on are written to be revised from. Asked to explain four lecture decks for a 50-mark paper, the questions came back excellent and the recap came back as a list of headings -- readable only if you already had the slides open, which defeats the point of asking. When you attach material and say you are studying it, every concept now gets its explanation and not just its name, and the numbers, definitions and examples are kept rather than summarised away.",
    "The moving pointer that followed along while Word was being written has been switched off. It was not landing where the work actually was, so it was more distracting than useful. The document is made exactly as before.",
  ]
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

/**
 * `wide` = this section spans both columns on a large window.
 *
 * The page used to be a single 36rem column, so on any normal monitor two thirds of it was empty
 * and the settings themselves ran a long way down — everything below "Interface" needed scrolling
 * past for no reason. Two columns puts roughly half of that back on screen. Sections that contain
 * wide content of their own (a diagnostic log, a form row of three inputs) keep the full width,
 * because squeezing those into half is worse than the empty space was.
 */
function Section({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-nv-surface border border-nv-border rounded-xl p-5 self-start ${wide ? 'lg:col-span-2' : ''}`}>
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
  /** Result of the browser check — plain text, shown as-is so nothing is lost in formatting. */
  const [browserTest, setBrowserTest] = useState('');
  const [appVersion, setAppVersion]   = useState<string>('');
  const [clearNote, setClearNote]     = useState('');   // confirmation for the "clear local data" buttons
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; body?: string; current?: string; propagating?: boolean }>({});
  const [updateErr, setUpdateErr] = useState('');
  const [updatePct, setUpdatePct] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('checking');
  const [voicePct, setVoicePct]       = useState(0);
  const [voiceStep, setVoiceStep]     = useState('');

  // Where the user is. Agents read this for every location-dependent task; an agent that had to
  // ask writes it here too, so it is asked once and then visible/editable in one place.
  const [loc, setLoc]                 = useState<UserLocation | null>(loadUserLocation);
  const [locCity, setLocCity]         = useState(() => loadUserLocation()?.city ?? '');
  const [locRegion, setLocRegion]     = useState(() => loadUserLocation()?.region ?? '');
  const [locCountry, setLocCountry]   = useState(() => loadUserLocation()?.country ?? '');
  // Hydrate the saved business size once, so the screen shows what the agents actually hold
  // rather than an empty control that looks like it was never set.
  useEffect(() => {
    void (async () => {
      try {
        const { krewMemoryDb } = await import('../lib/krewDb');
        const { KREW_PROFILE_KEY } = await import('../lib/krewTools');
        const rows = await krewMemoryDb.getAll(KREW_PROFILE_KEY);
        const hit = rows.find((r) => r.key === 'business_scale');
        if (hit?.value) setBizScale(hit.value);
      } catch { /* nothing saved yet, or the store is unavailable */ }
    })();
  }, []);
  const [locErr, setLocErr]           = useState('');
  const [locSaved, setLocSaved]       = useState(false);
  // Read from the shared Krew profile, which is where the agents and the lead search both look.
  const [bizScale, setBizScale]       = useState<string>('');
  // Who the user is — so an agent never mistakes them for the person they are meeting.
  const [idName, setIdName]           = useState(() => loadUserIdentity()?.name ?? '');
  const [idRole, setIdRole]           = useState(() => loadUserIdentity()?.role ?? '');
  const [idCompany, setIdCompany]     = useState(() => loadUserIdentity()?.company ?? '');
  const [idSaved, setIdSaved]         = useState(false);
  const inputStyle = { background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' };

  // An agent can save the location mid-conversation (set_user_location). Reflect that here without
  // a reload, so Settings never shows a stale "not set" next to a location Krew is already using.
  useEffect(() => {
    const onLoc = () => {
      const l = loadUserLocation();
      setLoc(l);
      setLocCity(l?.city ?? ''); setLocRegion(l?.region ?? ''); setLocCountry(l?.country ?? '');
    };
    window.addEventListener('nv-location-changed', onLoc);
    return () => window.removeEventListener('nv-location-changed', onLoc);
  }, []);

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
      // The Tauri updater failing is NOT proof the network is down — it fails on its own for
      // signature/endpoint reasons too, and telling someone to check a working connection is both
      // wrong and unfixable from their side. The startup check already falls back to reading
      // latest.json straight from the GitHub release; do the same here before blaming the network.
      console.error('check_for_update failed, trying latest.json:', e);
      try {
        const [json, current] = await Promise.all([
          fetch('https://github.com/astraluxe/nivara-desktop/releases/latest/download/latest.json')
            .then((r) => r.json()) as Promise<{ version?: string; notes?: string }>,
          getVersion(),
        ]);
        const remote = json.version ?? '';
        const newer = (() => {
          const r = remote.split('.').map(Number), l = current.split('.').map(Number);
          for (let i = 0; i < Math.max(r.length, l.length); i++) {
            if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
            if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
          }
          return false;
        })();
        if (remote && newer) {
          setUpdateInfo({ version: remote, body: json.notes, current });
          setUpdateStatus('available');
        } else if (remote) {
          setUpdateInfo({ current });
          setUpdateStatus('latest');
        } else {
          setUpdateStatus('error');
        }
      } catch {
        // WORK OUT WHICH FAILURE THIS IS BEFORE BLAMING THE USER'S CONNECTION.
        //
        // "Check your connection" was printed for every failure, and it is wrong in the case that
        // actually happens. Measured on a real Indian ISP: github.com answers in 0.5s, and
        // objects.githubusercontent.com and release-assets.githubusercontent.com — where every
        // release file is served from — resolve to the SAME IPs and accept a TCP connection on 443,
        // then never complete the TLS handshake. That is SNI-based filtering by the network, not a
        // broken connection, and no amount of checking their wifi will fix it. Telling them to look
        // at a connection that is demonstrably working is the least useful thing the app could say.
        //
        // So probe a site that is definitely reachable. If that works, the internet is fine and the
        // problem is specific — say so, and give them the thing they can actually do.
        let reachable = false;
        try {
          await fetch('https://www.adris.tech/', { method: 'HEAD', cache: 'no-store' });
          reachable = true;
        } catch { /* genuinely offline, or everything is blocked */ }
        setUpdateErr(reachable
          ? 'Your internet is working, but this network is blocking GitHub\'s download servers (githubusercontent.com) — some ISPs, mobile hotspots and office networks do this. Updates can\'t be fetched here. Download the latest version directly from adris.tech, or try another network or a VPN.'
          : '');
        setUpdateStatus('error');
      }
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

  /**
   * Switch the workspace folder on, resolving and creating it in the same step.
   *
   * The path is written into settings at the moment the toggle goes on, so everything downstream
   * can read one concrete path synchronously — the tool gate, the agents, the executor. A setting
   * that says "on" while the path is still being worked out is a window in which the tools exist
   * and have nowhere to write.
   */
  async function toggleWorkspace(on: boolean) {
    if (!on) { update('workspaceEnabled', false); return; }
    let path = settings.workspacePath.trim();
    if (!path) path = await invoke<string>('workspace_default_path').catch(() => '');
    if (!path) { update('workspaceEnabled', false); return; }
    const real = await invoke<string>('workspace_ensure', { root: path }).catch(() => '');
    if (!real) { update('workspaceEnabled', false); return; }
    const next = { ...settings, workspaceEnabled: true, workspacePath: real };
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

  // Full changelog on its own screen, reached from the About panel's "Read the details" button.
  if (showWhatsNew) {
    return (
      <div className="h-full overflow-y-auto bg-nv-bg">
        <div className="px-6 py-4 border-b border-nv-border flex items-center gap-3 sticky top-0 bg-nv-bg z-10">
          <button
            onClick={() => setShowWhatsNew(false)}
            className="text-[11px] text-nv-faint hover:text-nv-text transition-fast shrink-0"
          >&larr; Back</button>
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold text-nv-text tracking-tight">What's new in v{WHATS_NEW.version}</h1>
            <p className="text-[11px] text-nv-muted mt-0.5">{WHATS_NEW.items.length} changes in this release.</p>
          </div>
        </div>
        <div className="px-6 py-5 max-w-3xl">
          <ul className="space-y-3">
            {WHATS_NEW.items.map((it, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-accent shrink-0 text-[11px] leading-relaxed">&bull;</span>
                <span className="text-[12px] text-nv-muted leading-relaxed">{it}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-nv-bg">
      {/* Header */}
      <div className="px-6 py-4 border-b border-nv-border shrink-0">
        <h1 className="text-[16px] font-semibold text-nv-text tracking-tight">Settings</h1>
        <p className="text-[11px] text-nv-muted mt-0.5">Preferences stored locally on this device.</p>
      </div>

      {/* Two columns from `lg` up, one below it — so a narrow window is exactly as it was, and a
          normal one stops wasting two thirds of itself. `items-start` keeps each card its own
          height instead of stretching every card in a row to match the tallest. The page still
          scrolls normally; this only changes how much of it you can see at once. */}
      <div className="p-6 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* BROWSER CHECK, FIRST THING ON THE PAGE.
            "The browser doesn't open" was for a long time the only information anyone had, including
            whoever had to fix it. This runs the real chain in the real order — runtime, script,
            driver, Chrome, then actually opening a page — and names the step that failed instead of
            confirming the symptom. It is at the top because someone whose browser is broken should
            not have to go looking for it. */}
        <div className="lg:col-span-2 rounded-xl border border-nv-border bg-nv-surface p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-nv-text">Browser check</p>
              <p className="text-[11px] text-nv-muted mt-0.5 leading-relaxed">
                Agents use a real Chrome window to read pages, fill forms and scan LinkedIn. Run this if
                anything that opens a browser isn't working — it will install whatever is missing and tell
                you exactly what went wrong if it can't.
              </p>
            </div>
            <button
              onClick={async () => {
                setBrowserTest('Checking…');
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  setBrowserTest(await invoke<string>('browser_diagnose'));
                } catch (e) {
                  setBrowserTest(`Couldn't run the check: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
              className="shrink-0 h-8 px-3 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent-dim transition-fast"
            >Test browser</button>
          </div>
          {browserTest && (
            <pre className="mt-3 p-2.5 rounded-lg bg-nv-bg border border-nv-border text-[10.5px] leading-relaxed text-nv-text whitespace-pre-wrap font-mono max-h-72 overflow-y-auto">{browserTest}</pre>
          )}
        </div>

        {/* Automation */}
        {/* ── UPDATES, FIRST ──────────────────────────────────────────────────
            This lived at the very bottom of Settings, under About, below eleven other panels. It
            is the one thing in here a user comes looking for, and the one thing that has to be
            found quickly when a release fixes what they just hit. It is now the first panel. */}
        <Section title="Updates" wide>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <p className="text-[11px] text-nv-muted">
              You are running <span className="text-nv-text font-mono">v{APP_VERSION}</span>.
            </p>
            <button
              onClick={() => setShowWhatsNew(true)}
              className="text-[10px] px-2.5 py-1 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-fast shrink-0"
            >What's new</button>
          </div>
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
              <div className="mb-3">
                {/* The specific diagnosis when we have one — "check your connection" is only
                    honest when the connection is actually the problem. */}
                <p className="text-[11px] text-nv-red leading-relaxed">
                  {updateErr || 'Could not check for updates. Check your connection.'}
                </p>
                {updateErr && (
                  <button
                    onClick={() => { import('@tauri-apps/plugin-shell').then(({ open }) => open('https://www.adris.tech/download.html')).catch(() => window.open('https://www.adris.tech/download.html', '_blank')); }}
                    className="mt-1.5 text-[10px] px-2.5 py-1 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-fast"
                  >Open the download page</button>
                )}
              </div>
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

        <Section title="Automation" wide>
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

        {/* WHO the user is. Without this the agents cannot tell the user apart from the people they
            meet — a meeting titled "Amogh x Keshav" was researched as if Amogh were the prospect,
            and the user received a briefing about themselves. */}
        <Section title="Your name" wide>
          <p className="text-[11px] text-nv-muted leading-relaxed mb-3">
            Who Krew is working for. Calendar invites, email threads and attendee lists all contain
            your own name next to the other person&rsquo;s — this is how the agents tell which one is
            you, so they research the <em>other</em> party and never write a briefing about you.
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={idName}
                onChange={(e) => { setIdName(e.target.value); setIdSaved(false); }}
                placeholder="Your full name, as it appears in calendar invites"
                className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none focus:border-accent transition-fast"
                style={inputStyle}
              />
            </div>
            <div className="flex gap-2">
              <input
                value={idRole}
                onChange={(e) => { setIdRole(e.target.value); setIdSaved(false); }}
                placeholder="Your role (optional) — e.g. Founder"
                className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none focus:border-accent transition-fast"
                style={inputStyle}
              />
              <input
                value={idCompany}
                onChange={(e) => { setIdCompany(e.target.value); setIdSaved(false); }}
                placeholder="Your company (optional)"
                className="flex-1 px-3 py-2 rounded-lg text-[12px] outline-none focus:border-accent transition-fast"
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const n = idName.trim();
                  if (!n) { clearUserIdentity(); setIdSaved(false); return; }
                  saveUserIdentity({ name: n, role: idRole.trim() || undefined, company: idCompany.trim() || undefined });
                  setIdSaved(true);
                }}
                className="text-[11px] px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/85 transition-fast"
              >Save</button>
              {idSaved && <span className="text-[10px] text-nv-green">✓ Saved — agents will never research you.</span>}
            </div>
          </div>
        </Section>

        {/* Where the user is — drives every location-dependent search */}
        <Section title="Location" wide>
          <p className="text-[11px] text-nv-muted leading-relaxed mb-3">
            Where you are, and the market Krew searches. Leads, customers, local businesses and
            events all come from here. If it isn&rsquo;t set, Krew asks you the first time a task
            needs it and saves your answer here.
          </p>
          {loc && (
            <p className="text-[11px] mb-3">
              <span className="text-nv-faint">Currently searching: </span>
              <span className="text-accent font-medium">{locationLabel(loc)}</span>
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={locCity}
                onChange={(e) => { setLocCity(e.target.value); setLocErr(''); setLocSaved(false); }}
                placeholder="City — e.g. Chicago"
                className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                style={inputStyle}
              />
              <input
                value={locRegion}
                onChange={(e) => { setLocRegion(e.target.value); setLocSaved(false); }}
                placeholder="State / region (optional)"
                className="flex-1 rounded-lg px-3 py-2 text-[11px] outline-none"
                style={inputStyle}
              />
            </div>
            <input
              value={locCountry}
              onChange={(e) => { setLocCountry(e.target.value); setLocErr(''); setLocSaved(false); }}
              placeholder="Country — e.g. United States"
              className="w-full rounded-lg px-3 py-2 text-[11px] outline-none"
              style={inputStyle}
            />
            {/* Country is required on purpose: a city alone is ambiguous, and guessing it wrong
                sends every future search to the wrong continent without anyone noticing. */}
            <p className="text-[10px] text-nv-faint leading-relaxed">
              Country is required — a city on its own is ambiguous (London UK vs London Ontario,
              Cambridge UK vs Massachusetts), and getting it wrong quietly sends every search to
              the wrong place.
            </p>
            {locErr && <p className="text-[10px] text-red-400">{locErr}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  const city = locCity.trim(); const country = locCountry.trim();
                  if (!city)    { setLocErr('Enter a city.'); return; }
                  if (!country) { setLocErr('Enter a country too — a city on its own is ambiguous.'); return; }
                  saveUserLocation({ city, country, region: locRegion.trim() || undefined });
                  setLoc(loadUserLocation()); setLocErr(''); setLocSaved(true);
                }}
                className="px-3 py-2 rounded-lg text-[11px] text-white font-medium transition-fast hover:opacity-90"
                style={{ background: '#7C5CFF' }}
              >
                Save location
              </button>
              {loc && (
                <button
                  onClick={() => {
                    clearUserLocation();
                    setLoc(null); setLocCity(''); setLocRegion(''); setLocCountry('');
                    setLocErr(''); setLocSaved(false);
                  }}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium border border-nv-border text-nv-muted transition-fast hover:border-nv-border/80"
                >
                  Clear
                </button>
              )}
              {locSaved && <span className="text-[10px] text-accent">Saved — Krew will search here from now on.</span>}
            </div>
          </div>
        </Section>

        {/* THE ANSWER THAT DECIDES WHETHER A LEAD LIST IS USABLE.
            business_scale was already being written by the agents when they happened to learn it,
            already read by the lead search to size prospects — and had nowhere the user could set
            or correct it. So most people had none, and a lead run with no scale returns the
            companies a model knows best, which are the famous ones: "yes true they are in bangalore
            but i cant deal with them na". Asked at first launch now, and editable here for anyone
            who skipped it or has grown since. */}
        <Section title="Your business size" wide>
          <p className="text-[11px] text-nv-muted leading-[1.6] pb-1">
            This sets how big a company your lead searches aim at. Selling sideways works; selling
            to someone ten times your size usually does not, and every one of those rows is a reply
            that never comes.
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {SCALE_OPTIONS.map((sc) => (
              <button
                key={sc.key}
                onClick={() => {
                  setBizScale(sc.key);
                  void (async () => {
                    try {
                      const { krewMemoryDb } = await import('../lib/krewDb');
                      const { KREW_PROFILE_KEY } = await import('../lib/krewTools');
                      await krewMemoryDb.save(KREW_PROFILE_KEY, 'business_scale', sc.key);
                    } catch { /* the choice still shows; it just did not persist */ }
                  })();
                }}
                className={`text-left px-3 py-2 rounded-lg border transition-fast ${
                  bizScale === sc.key
                    ? 'border-accent bg-accent/10'
                    : 'border-nv-border hover:border-accent/50'
                }`}
              >
                <span className="block text-[11.5px] font-medium" style={{ color: 'var(--nv-text)' }}>{sc.label}</span>
                <span className="block text-[10px] text-nv-faint mt-0.5 leading-snug">{sc.blurb}</span>
              </button>
            ))}
          </div>
          {bizScale && (
            <p className="text-[10px] text-accent pt-1.5">
              Saved — lead searches will aim at companies you can realistically win.
            </p>
          )}
          {/* A WAY BACK INTO THE SETUP QUESTIONS.
              They appear once, which is right — but "once" with no way back is a trap: skip them
              while finding your feet and the app keeps guessing your size forever, with nothing
              telling you what you missed. Everything they ask is editable on this screen anyway;
              this is simply the quicker route through all of it. */}
          <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--nv-border)' }}>
            <button
              onClick={() => { void import('../lib/onboarding').then((m) => m.reopenOnboarding(uid)); }}
              className="px-3 py-2 rounded-lg text-[11px] font-medium border border-nv-border text-nv-muted transition-fast hover:border-accent hover:text-accent"
            >
              Run the setup questions again
            </button>
            <p className="text-[10px] text-nv-faint mt-1.5 leading-relaxed">
              Walks through your name, what you do, your size and your city — the answers the agents
              use. Nothing is lost: it starts from what is already saved.
            </p>
          </div>
        </Section>

        {/* ONE FOLDER, GRANTED ON PURPOSE.
            Everything Krew made used to live inside the app or in a chat message, so "make me a
            poster" and "now post that poster" were two jobs with the user carrying the file between
            them. This closes that — and stays a single named folder, because "let the AI use my
            computer" is not a checkbox anyone should tick without knowing exactly what it covers. */}
        <Section title="Files">
          <Toggle
            on={settings.workspaceEnabled}
            onChange={(v) => { void toggleWorkspace(v); }}
            label="Let agents use a folder on this computer"
            desc="Gives Krew ONE folder — and nothing else on your machine — to keep what it makes: posters and images it generates, videos or PDFs it downloads, spreadsheets, drafts. It remembers where each file went, so a later chat can find that poster and attach it to a post instead of asking you for it. Off by default; turning it off removes the file tools entirely."
          />
          {settings.workspaceEnabled && (
            <div className="pt-1 pb-2">
              <p className="text-[11px] text-nv-muted leading-[1.6]">
                Krew reads and writes here, and nowhere else:
              </p>
              <p className="mt-1 text-[11px] font-mono break-all" style={{ color: 'var(--nv-text)' }}>
                {settings.workspacePath || 'setting up…'}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={async () => {
                    const picked = await invoke<string | null>('open_folder_dialog').catch(() => null);
                    if (!picked) return;
                    const real = await invoke<string>('workspace_ensure', { root: picked }).catch(() => picked);
                    update('workspacePath', real);
                  }}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium border border-nv-border text-nv-muted transition-fast hover:border-nv-border/80"
                >Choose a different folder…</button>
                <button
                  onClick={() => { void invoke('workspace_reveal', { path: settings.workspacePath }).catch(() => {}); }}
                  disabled={!settings.workspacePath}
                  className="px-3 py-2 rounded-lg text-[11px] font-medium border border-nv-border text-nv-muted transition-fast hover:border-nv-border/80 disabled:opacity-40"
                >Open folder</button>
              </div>
            </div>
          )}
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
              {/* alert() is swallowed by the Tauri webview — these two buttons did their work and
                  then gave no sign of it, so they read as broken. Confirm inline instead. */}
              <button
                onClick={() => { localStorage.removeItem('nv-coder-state'); setClearNote('Coder state cleared.'); }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-nv-red hover:text-nv-red transition-fast"
              >Clear Coder state</button>
              <button
                onClick={() => {
                  const key = uid ? `nv-tour-done-${uid}` : 'nv-tour-done';
                  const setupKey = uid ? `nv-first-run-done-v1-${uid}` : 'nv-first-run-done-v1';
                  localStorage.removeItem(key);
                  localStorage.removeItem(setupKey);
                  setClearNote('Onboarding reset — relaunch the app to see it again.');
                }}
                className="text-[10px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:border-accent hover:text-accent transition-fast"
              >Reset onboarding tour</button>
            </div>
            {clearNote && <p className="text-[10px] text-nv-green mt-2">✓ {clearNote}</p>}
          </div>
        </Section>

        {/* Voice */}
        <Section title="Voice — Whisper" wide>
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
        <Section title="About adris.tech" wide>
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

          {/* What's new — a summary line and a button. The full list runs to twenty-odd detailed
              entries, and dumping all of it inline turned the About panel into a wall of text
              nobody reads. The detail lives on its own screen. */}
          <div className="pt-3 border-t border-nv-border/60 mb-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-nv-text font-medium">What's new in v{WHATS_NEW.version}</p>
                <p className="text-[10.5px] text-nv-muted mt-0.5">
                  {WHATS_NEW.items.length} changes in this release.
                </p>
              </div>
              <button
                onClick={() => setShowWhatsNew(true)}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-fast shrink-0"
              >Read the details</button>
            </div>
          </div>

        </Section>
      </div>
    </div>
  );
}
