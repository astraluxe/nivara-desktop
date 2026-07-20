import { useState, useEffect } from "react";
import { startGuardWatch, GUARD_ALERT_EVENT, type GuardAlert } from './lib/guardWatch';
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import LoginScreen from "./components/LoginScreen";
import TitleBar from "./components/TitleBar";
import Sidebar, { type Module } from "./components/Sidebar";
import HomeModule from "./modules/HomeModule";
import AutomationModule from "./modules/AutomationModule";
import CoderModule from "./modules/CoderModule";
import KrewModule from "./modules/KrewModule";
import ConnectApps from "./components/krew/ConnectApps";
import ModelsModule from "./modules/ModelsModule";
import VaultModule from "./modules/VaultModule";
import BrainModule from "./modules/BrainModule";
import GuardModule from "./modules/GuardModule";
import MeshModule from "./modules/MeshModule";
import AccountPanel from "./modules/AccountPanel";
import SettingsModule, { loadSettings } from "./modules/SettingsModule";
import InfoModule from "./modules/InfoModule";
import HeadModule from "./modules/HeadModule";
import { AppSkeleton } from "./components/Skeleton";
import TourOverlay, { isTourDone } from "./components/TourOverlay";
import FirstRunSetup, { needsFirstRun } from "./components/FirstRunSetup";
import type { Node, Edge } from "@xyflow/react";
import { executeAutomation, type AutomationRow } from "./lib/automationRunner";
import { supabase } from "./lib/supabase";

const LAST_OPEN_KEY = "nv-last-open";

interface MissedRun {
  id: string;
  automation_id: string;
  triggered_at: number;
  status: string;
  output_summary: string | null;
}

function OfflineBanner({ runs, onDismiss, onView }: { runs: MissedRun[]; onDismiss: () => void; onView: () => void }) {
  const ok = runs.filter(r => r.status === "success").length;
  const fail = runs.filter(r => r.status === "failed").length;
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-nv-surface border-b border-nv-border text-xs shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-nv-info shrink-0" />
      <span className="text-nv-text flex-1">
        <span className="font-semibold">{runs.length} automation{runs.length !== 1 ? "s" : ""} ran while you were away</span>
        {ok > 0 && <span className="text-nv-ok ml-2">{ok} succeeded</span>}
        {fail > 0 && <span className="text-nv-bad ml-2">{fail} failed</span>}
      </span>
      <button onClick={onView} className="text-accent hover:underline font-medium">View</button>
      <button onClick={onDismiss} className="text-nv-faint hover:text-nv-text ml-1">✕</button>
    </div>
  );
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'update' | 'warning';
  cta_label?: string;
  cta_url?: string;
}

function AnnouncementModal({ ann, onClose }: { ann: Announcement; onClose: () => void }) {
  const icons: Record<string, string> = { info: 'ℹ', update: '↑', warning: '⚠' };
  const colours: Record<string, string> = {
    info:    'border-nv-info bg-nv-info/10',
    update:  'border-accent bg-accent/10',
    warning: 'border-nv-bad bg-nv-bad/10',
  };
  // In-app update flow with LIVE progress. The old CTA opened the WEBSITE download page
  // in a browser — which read as "I clicked download and nothing happened". Now the
  // button runs the same Tauri updater Settings uses, with a visible progress bar.
  const [updState, setUpdState] = useState<'idle' | 'installing' | 'error'>('idle');
  const [pct, setPct] = useState<number | null>(null);

  // Bare window.open() is a DEAD call inside a Tauri webview (nothing opens, no error) —
  // that was the original "clicked Download 3 times, popup just stays there" bug. External
  // links must go through the shell plugin, same as everywhere else in the app.
  function openExternal(url: string) {
    import('@tauri-apps/plugin-shell').then(({ open }) => open(url)).catch(() => window.open(url, '_blank'));
  }

  async function runCta() {
    if (ann.type !== 'update') {
      if (ann.cta_url) openExternal(ann.cta_url);
      return;
    }
    setUpdState('installing');
    setPct(null);
    const un = await listen<{ downloaded: number; total: number | null }>('update-progress', (e) => {
      const { downloaded, total } = e.payload;
      if (total && total > 0) setPct(Math.min(100, Math.round((downloaded / total) * 100)));
    });
    try {
      await invoke('install_update'); // on success the installer takes over and the app restarts
    } catch {
      setUpdState('error');
    } finally {
      un();
    }
  }

  const installing = updState === 'installing';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-sm mx-4 bg-nv-bg border-2 rounded-xl p-6 shadow-2xl ${colours[ann.type] ?? colours.info}`}>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">{icons[ann.type] ?? icons.info}</span>
          <h2 className="text-base font-semibold text-nv-text leading-snug flex-1">{ann.title}</h2>
        </div>
        <p className="text-sm text-nv-faint leading-relaxed mb-5">
          {updState === 'error'
            ? 'The in-app update failed — you can download the installer directly from adris.tech/download instead.'
            : installing
            ? 'Downloading the update — the app will close and update itself automatically when it finishes. Don’t close it manually.'
            : ann.body}
        </p>
        {installing && (
          <div className="mb-5">
            <div className="h-2 w-full rounded-full bg-nv-surface2 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${pct ?? 8}%`, opacity: pct === null ? 0.5 : 1 }}
              />
            </div>
            <p className="text-[11px] text-nv-faint mt-1.5 font-mono">
              {pct === null ? 'Contacting update server…' : `Downloading… ${pct}%`}
            </p>
          </div>
        )}
        <div className="flex gap-2">
          {ann.cta_label && updState !== 'error' && (
            <button onClick={runCta} disabled={installing}
              className="flex-1 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-60 disabled:cursor-default">
              {installing ? (pct === null ? 'Preparing…' : `Downloading ${pct}%`) : ann.cta_label}
            </button>
          )}
          {updState === 'error' && (
            <button onClick={() => openExternal('https://adris.tech/download')}
              className="flex-1 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/80 transition-colors">
              Get it from the website
            </button>
          )}
          <button onClick={onClose} disabled={installing}
            className="flex-1 px-4 py-2 border border-nv-border text-nv-faint text-sm rounded-lg hover:text-nv-text hover:border-nv-text transition-colors disabled:opacity-50">
            {ann.type === 'update' ? 'Later' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

const DISMISSED_KEY = 'nv-dismissed-announcements';

function AppShell() {
  const { session, loading, profile } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>("home");
  const [showTour, setShowTour] = useState(false);
  const [canvasFlow, setCanvasFlow] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [missedRuns, setMissedRuns] = useState<MissedRun[]>([]);
  const [guardAlert, setGuardAlert] = useState<GuardAlert | null>(null);
  const [meshActive, setMeshActive] = useState(false);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [showFirstRun, setShowFirstRun] = useState(false);

  function handleViewOnCanvas(nodes: Node[], edges: Edge[]) {
    setCanvasFlow({ nodes, edges });
    setActiveModule("automation");
  }

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;
    // Don't start tour while FirstRunSetup is showing — wait until it finishes
    if (!isTourDone(uid) && !needsFirstRun(uid)) {
      setShowTour(true);
    }
  }, [session]);

  // Ensure agent-browser is installed — runs every launch, skips if already present
  useEffect(() => {
    invoke('setup_agent_browser').catch(() => {});
  }, []);

  // SECOND, INDEPENDENT driver for the corner badge's visibility. The badge window is
  // supposed to show itself, but if anything in its own boot fails (monitor detection,
  // a script error, timing at cold start) the failure is INVISIBLE — the user just
  // "never sees the badge" (exactly the .74/.75 report). The main app now also
  // positions + shows + re-tops it, so one dead path can't hide the feature.
  useEffect(() => {
    async function driveBadge() {
      try {
        if (localStorage.getItem('nv-quickbar') === 'off') return;
        const snooze = parseInt(localStorage.getItem('nv-quickbadge-snooze-until') || '0', 10);
        if (snooze > Date.now()) return;
        const [{ WebviewWindow }, { primaryMonitor, PhysicalPosition }] = await Promise.all([
          import('@tauri-apps/api/webviewWindow'),
          import('@tauri-apps/api/window'),
        ]);
        const badge = await WebviewWindow.getByLabel('quickbadge');
        if (!badge) return;
        const mon = await primaryMonitor().catch(() => null);
        if (mon) {
          const sf = mon.scaleFactor || 1;
          const x = Math.round(mon.position.x + mon.size.width - 56 * sf - 10 * sf);
          const y = Math.round(mon.position.y + mon.size.height * 0.32);
          await badge.setPosition(new PhysicalPosition(x, y));
        }
        await badge.show();
        await badge.setAlwaysOnTop(true);
      } catch { /* best effort — the badge's own script is the primary path */ }
    }
    const t1 = setTimeout(driveBadge, 1500);
    const t2 = setTimeout(driveBadge, 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Register the Quick Bar's autostart ONCE (launches at login with --quickbar, main
  // window hidden — the bar is there without "opening the exe"). The Settings toggle
  // owns it after this; users who turned the bar off are never re-enrolled.
  useEffect(() => {
    if (localStorage.getItem('nv-autostart-init')) return;
    if (localStorage.getItem('nv-quickbar') === 'off') return;
    import('@tauri-apps/plugin-autostart')
      .then(async ({ enable, isEnabled }) => {
        try {
          if (!(await isEnabled())) await enable();
          localStorage.setItem('nv-autostart-init', '1');
        } catch { /* retry next launch */ }
      })
      .catch(() => {});
  }, []);

  // App-wide zoom with Ctrl +/- (and Ctrl+0 to reset), like a browser. Persisted.
  useEffect(() => {
    const apply = (z: number) => {
      const clamped = Math.min(2, Math.max(0.5, z));
      (document.documentElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(clamped);
      try { localStorage.setItem('app_zoom', String(clamped)); } catch { /* ignore */ }
      return clamped;
    };
    let zoom = (() => { const v = parseFloat(localStorage.getItem('app_zoom') || '1'); return Number.isFinite(v) ? v : 1; })();
    apply(zoom);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')      { e.preventDefault(); zoom = apply(zoom + 0.1); }
      else if (e.key === '-' || e.code === 'NumpadSubtract')             { e.preventDefault(); zoom = apply(zoom - 0.1); }
      else if (e.key === '0' || e.code === 'Numpad0')                    { e.preventDefault(); zoom = apply(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // First-run setup — show once per user (new install or new Google account)
  useEffect(() => {
    if (!session) return;
    if (needsFirstRun(session.user.id)) {
      setShowFirstRun(true);
    }
  }, [session]);

  // Fetch session key for direct Gemini calls (adris.tech AI fast path)
  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    if (!token) return;
    invoke('fetch_session_key', { sessionToken: token }).catch(() => {/* silent — falls back to krew-stream */});
  }, [session]);

  // Log tokens immediately after every direct Gemini message — no batching delay
  useEffect(() => {
    if (!session) return;
    const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const unlisten = listen<{ tokens: number }>('nivara-tokens', (e) => {
      invoke('track_token_usage', {
        supabaseUrl,
        supabaseAnonKey: supabaseAnon,
        sessionToken: session.access_token,
        userId: session.user.id,
        module: 'krew_direct',
        tokensUsed: e.payload.tokens,
      }).catch(() => {});
    });
    return () => { unlisten.then(f => f()); };
  }, [session]);

  // Offline automation notification — check for runs since last open
  useEffect(() => {
    if (!session) return;
    const prevTs = parseInt(localStorage.getItem(LAST_OPEN_KEY) ?? "0", 10);
    localStorage.setItem(LAST_OPEN_KEY, Math.floor(Date.now() / 1000).toString());
    if (prevTs === 0) return; // first ever open, nothing to compare
    invoke<MissedRun[]>("automation_get_logs", { automationId: null, limit: 50 })
      .then(logs => {
        const missed = logs.filter(r => r.triggered_at > prevTs);
        if (missed.length > 0) setMissedRuns(missed);
      })
      .catch(() => {/* silent */});
  }, [session]);

  // Guard inbox watch — the product promises Guard "checks what arrives" and alerts you when
  // something matters. Runs only while signed in; it no-ops unless Gmail is connected and the
  // watch is left enabled in Guard.
  useEffect(() => {
    if (!session) return;
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
    const stop = startGuardWatch();
    return () => stop();
  }, [session]);

  // Suspicious-email banner — the in-app half of the alert, so a warning is never lost just
  // because OS notifications are denied.
  useEffect(() => {
    const onAlert = (e: Event) => setGuardAlert((e as CustomEvent).detail as GuardAlert);
    window.addEventListener(GUARD_ALERT_EVENT, onAlert);
    return () => window.removeEventListener(GUARD_ALERT_EVENT, onAlert);
  }, []);

  // Desktop heartbeat — fires immediately on login, then every 5 min.
  // Was every 60s: at ~23k UPDATEs against a 10-row `users` table, this single heartbeat was a
  // top disk-IO consumer on the free Supabase plan (each UPDATE forces a full WAL write under
  // Postgres MVCC). "Online status" doesn't need second-level freshness, so 5 min cuts this
  // write volume 5x for free with no visible UX change.
  useEffect(() => {
    if (!session) return;
    const ping = async () => { try { await supabase.from('users').update({ last_desktop_ping: new Date().toISOString() }).eq('id', session.user.id); } catch {} };
    ping();
    const id = setInterval(ping, 300_000);
    return () => clearInterval(id);
  }, [session]);

  // Announcement fetch — shows a modal once per announcement id
  useEffect(() => {
    if (!session) return;
    supabase
      .from('announcements')
      .select('id, title, body, type, cta_label, cta_url')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        const ann = data[0] as Announcement;
        const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
        if (!dismissed.includes(ann.id)) setAnnouncement(ann);
      });
  }, [session]);

  // Auto-update check — on startup AND every time the app is brought back to the
  // foreground (opened from the quick bar / corner badge / tray while it was already
  // running in the background). A check only at boot misses updates released while
  // the app sat autostarted for days — the user opens the window and sees nothing.
  useEffect(() => {
    if (!session) return;

    function showUpdateBanner(version: string) {
      const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
      if (dismissed.includes(`update-${version}`)) return;
      setAnnouncement({
        id: `update-${version}`,
        title: `Update available — v${version}`,
        body: 'A new version of adris.tech is ready. It installs right here — one click, the app restarts itself when done.',
        type: 'update',
        cta_label: 'Install update',
      });
    }

    function newerThan(remote: string, local: string): boolean {
      const r = remote.split('.').map(Number);
      const l = local.split('.').map(Number);
      for (let i = 0; i < Math.max(r.length, l.length); i++) {
        const rv = r[i] ?? 0, lv = l[i] ?? 0;
        if (rv > lv) return true;
        if (rv < lv) return false;
      }
      return false;
    }

    let lastCheck = 0;
    function runCheck(force = false) {
      // Throttle focus-triggered re-checks so tabbing in and out doesn't hammer GitHub.
      if (!force && Date.now() - lastCheck < 30 * 60_000) return;
      lastCheck = Date.now();
      invoke<{ available: boolean; version?: string }>('check_for_update')
        .then(res => {
          if (res.available && res.version) showUpdateBanner(res.version);
        })
        .catch(() => {
          // Tauri plugin failed — fallback: fetch latest.json directly
          Promise.all([
            fetch('https://github.com/astraluxe/nivara-desktop/releases/latest/download/latest.json')
              .then(r => r.json()),
            getVersion(),
          ])
            .then(([json, current]) => {
              const remote = (json as { version?: string }).version ?? '';
              if (remote && newerThan(remote, current)) showUpdateBanner(remote);
            })
            .catch(() => {/* no network — silent */});
        });
    }

    runCheck(true);
    const onFocus = () => runCheck();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [session]);

  // Global automation trigger listener — active regardless of which module is open
  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;
    let unlisten: (() => void) | null = null;

    listen<{ id: string; trigger_type: string; context: string }>(
      "automation_fired",
      async (event) => {
        const { id, context } = event.payload;
        try {
          const s = loadSettings();
          if (!s.automationAutoRun) return;
          const automations = await invoke<AutomationRow[]>("automation_list", { userId });
          const automation = automations.find(a => a.id === id);
          if (!automation || !automation.enabled) return;
          await executeAutomation(automation, userId, context || undefined);
        } catch { /* silent — errors logged inside executeAutomation */ }
      }
    ).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [session]);

  // Global navigation event — lets any part of the app (e.g. Krew slash commands) open a module.
  useEffect(() => {
    const VALID: Module[] = ["home", "automation", "coder", "krew", "connect", "models", "vault", "guard", "mesh", "brain", "head", "info", "account", "settings"];
    let un: (() => void) | null = null;
    listen<{ module: string }>("nv-navigate", (e) => {
      const m = e.payload?.module as Module;
      if (m && VALID.includes(m)) setActiveModule(m);
    }).then((fn) => { un = fn; });
    return () => { un?.(); };
  }, []);

  // Krew agent explicit run — bypasses automationAutoRun gate
  useEffect(() => {
    if (!session) return;
    const userId = session.user.id;
    let unlisten: (() => void) | null = null;

    listen<{ id: string }>("krew_run_automation", async (event) => {
      try {
        const automations = await invoke<AutomationRow[]>("automation_list", { userId });
        const automation = automations.find(a => a.id === event.payload.id);
        if (!automation) return;
        await executeAutomation(automation, userId);
      } catch { /* silent */ }
    }).then(fn => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [session]);

  if (loading) return <AppSkeleton />;

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-col h-full">
      <TitleBar activeModule={activeModule} />
      {missedRuns.length > 0 && (
        <OfflineBanner
          runs={missedRuns}
          onDismiss={() => setMissedRuns([])}
          onView={() => { setActiveModule("automation"); setMissedRuns([]); }}
        />
      )}
      {guardAlert && (
        <div className="flex items-start gap-3 px-4 py-2.5 border-b shrink-0 border-red-500/40 bg-red-500/10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
            strokeLinecap="round" strokeLinejoin="round" className="text-nv-bad shrink-0 mt-0.5">
            <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z" /><path d="M12 8v5M12 16h.01" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-nv-text">
              Guard flagged a suspicious email
              <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded-full border border-nv-bad/40 text-nv-bad align-middle">
                {guardAlert.severity.toUpperCase()}
              </span>
            </p>
            <p className="text-[11px] text-nv-muted leading-snug break-words mt-0.5">
              <span className="text-nv-text">{guardAlert.subject || '(no subject)'}</span> — from {guardAlert.from}
            </p>
            <p className="text-[11px] text-nv-muted leading-snug break-words">{guardAlert.reason}</p>
          </div>
          <button
            onClick={() => { setActiveModule('guard'); setGuardAlert(null); }}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-nv-bad/15 border border-nv-bad/40 text-nv-bad hover:bg-nv-bad/25 transition-fast shrink-0"
          >
            Open Guard
          </button>
          <button onClick={() => setGuardAlert(null)} title="Dismiss"
            className="text-[11px] text-nv-faint hover:text-nv-text shrink-0 px-1">✕</button>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} meshSessionActive={meshActive} />
        <main className="flex-1 overflow-hidden">
          {activeModule === "home"       && <HomeModule onNavigate={setActiveModule} onStartTour={() => setShowTour(true)} />}
          {activeModule === "automation" && <AutomationModule canvasFlow={canvasFlow} onCanvasFlowConsumed={() => setCanvasFlow(null)} />}
          {activeModule === "coder"      && <CoderModule />}
          {/* Krew stays mounted so messages/session survive tab switches */}
          <div className={activeModule === "krew" ? "contents" : "hidden"}>
            <KrewModule onViewOnCanvas={handleViewOnCanvas} onOpenAutomations={() => setActiveModule('automation')} />
          </div>
          {activeModule === "connect" && <ConnectApps />}
          {activeModule === "models"  && <ModelsModule />}
          {activeModule === "vault"   && <VaultModule />}
          {activeModule === "guard"   && <GuardModule />}
          {activeModule === "mesh"    && <MeshModule onSessionChange={setMeshActive} />}
          {activeModule === "brain"   && <BrainModule />}
          <BrainToKrewBridge onGoKrew={() => setActiveModule("krew")} />
          {/* Head is head-only. The sidebar merely HIDES the entry, which is not a check — anything
              that sets the active module (a nv-navigate event, a restored value) would otherwise
              render it. The real boundary is RLS: a non-admin's queries return only their own rows,
              and a self-promotion attempt is reverted by protect_billing_columns. This is the
              second lock, so the screen never even appears for anyone else. */}
          {activeModule === "head"    && (profile?.admin_level === 'head'
            ? <HeadModule />
            : <div className="h-full flex items-center justify-center px-8">
                <div className="max-w-sm text-center">
                  <p className="text-[15px] font-semibold text-nv-text mb-1.5">Not available</p>
                  <p className="text-[12.5px] leading-relaxed text-nv-muted">
                    This area is restricted to the account owner.
                  </p>
                </div>
              </div>)}
          {activeModule === "info"     && <InfoModule />}
          {activeModule === "account"  && <AccountPanel />}
          {activeModule === "settings" && <SettingsModule />}
        </main>
      </div>
      {showTour && <TourOverlay userId={session.user.id} onDone={() => setShowTour(false)} />}
      {showFirstRun && <FirstRunSetup userId={session.user.id} onDone={() => {
        setShowFirstRun(false);
        if (!isTourDone(session.user.id)) setShowTour(true);
      }} />}
      {announcement && (
        <AnnouncementModal
          ann={announcement}
          onClose={() => {
            // If it's an update announcement and user clicked "Got it", just dismiss
            // If cta_label is "Install & restart", clicking the CTA button runs install
            if (announcement.type === 'update' && announcement.cta_url === undefined) {
              // Install update flow — CTA button handled separately; dismiss just hides modal
            }
            const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
            if (!dismissed.includes(announcement.id)) {
              localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed, announcement.id]));
            }
            setAnnouncement(null);
          }}
        />
      )}
    </div>
  );
}

// Switches to the Krew tab when a Brain note is "Used in Krew chat".
function BrainToKrewBridge({ onGoKrew }: { onGoKrew: () => void }) {
  useEffect(() => {
    const go = () => onGoKrew();
    window.addEventListener("nv-goto-krew", go);
    return () => window.removeEventListener("nv-goto-krew", go);
  }, [onGoKrew]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
