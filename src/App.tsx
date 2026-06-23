import { useState, useEffect } from "react";
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
  const [installing, setInstalling] = useState(false);
  const icons: Record<string, string> = { info: 'ℹ', update: '↑', warning: '⚠' };
  const colours: Record<string, string> = {
    info:    'border-nv-info bg-nv-info/10',
    update:  'border-accent bg-accent/10',
    warning: 'border-nv-bad bg-nv-bad/10',
  };

  async function handleCta() {
    if (ann.cta_url) window.open(ann.cta_url, '_blank');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-sm mx-4 bg-nv-bg border-2 rounded-xl p-6 shadow-2xl ${colours[ann.type] ?? colours.info}`}>
        <div className="flex items-start gap-3 mb-4">
          <span className="text-2xl">{icons[ann.type] ?? icons.info}</span>
          <h2 className="text-base font-semibold text-nv-text leading-snug flex-1">{ann.title}</h2>
        </div>
        <p className="text-sm text-nv-faint leading-relaxed mb-5">{ann.body}</p>
        <div className="flex gap-2">
          {ann.cta_label && (
            <button onClick={handleCta} disabled={installing}
              className="flex-1 px-4 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-60">
              {installing ? 'Installing…' : ann.cta_label}
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 px-4 py-2 border border-nv-border text-nv-faint text-sm rounded-lg hover:text-nv-text hover:border-nv-text transition-colors">
            {ann.type === 'update' ? 'Later' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

const DISMISSED_KEY = 'nv-dismissed-announcements';

function AppShell() {
  const { session, loading } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>("home");
  const [showTour, setShowTour] = useState(false);
  const [canvasFlow, setCanvasFlow] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [missedRuns, setMissedRuns] = useState<MissedRun[]>([]);
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

  // Desktop heartbeat — fires immediately on login, then every 60s
  useEffect(() => {
    if (!session) return;
    const ping = async () => { try { await supabase.from('users').update({ last_desktop_ping: new Date().toISOString() }).eq('id', session.user.id); } catch {} };
    ping();
    const id = setInterval(ping, 60_000);
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

  // Auto-update check on startup — tries Tauri plugin first, falls back to direct fetch
  useEffect(() => {
    if (!session) return;

    function showUpdateBanner(version: string) {
      const dismissed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[];
      if (dismissed.includes(`update-${version}`)) return;
      setAnnouncement({
        id: `update-${version}`,
        title: `Update available — v${version}`,
        body: 'A new version of adris.tech is ready. Download and install it to get the latest features and fixes.',
        type: 'update',
        cta_label: 'Download update',
        cta_url: 'https://adris.tech/download',
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
          {activeModule === "head"    && <HeadModule />}
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

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
