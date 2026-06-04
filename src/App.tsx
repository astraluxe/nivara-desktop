import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
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
import StudioModule from "./modules/StudioModule";
import HeadModule from "./modules/HeadModule";
import { AppSkeleton } from "./components/Skeleton";
import TourOverlay, { isTourDone } from "./components/TourOverlay";
import type { Node, Edge } from "@xyflow/react";
import { executeAutomation, type AutomationRow } from "./lib/automationRunner";
import { supabase } from "./lib/supabase";

const LAST_OPEN_KEY = "nv-last-open";

interface StudioRequest {
  prompt: string;
  formatId: string;
  duration: number;
  context: string;
}

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
    if (ann.type === 'update' && !ann.cta_url) {
      setInstalling(true);
      try { await invoke('install_update'); } catch { setInstalling(false); }
      return;
    }
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
  const [studioRequest, setStudioRequest] = useState<StudioRequest | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  function handleOpenStudio(req: StudioRequest) {
    setStudioRequest(req);
    setActiveModule('studio');
  }

  function handleViewOnCanvas(nodes: Node[], edges: Edge[]) {
    setCanvasFlow({ nodes, edges });
    setActiveModule("automation");
  }

  useEffect(() => {
    if (session && !isTourDone()) {
      setShowTour(true);
    }
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

  // Desktop heartbeat — lets Supabase cloud runner know the PC is on and skip duplicate execution
  useEffect(() => {
    if (!session) return;
    const ping = () => supabase.from('users').update({ last_desktop_ping: new Date().toISOString() }).eq('id', session.user.id);
    ping();
    const id = setInterval(ping, 5 * 60 * 1000); // every 5 minutes
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

  // Auto-update check on startup — silent, shows banner only if update available
  useEffect(() => {
    if (!session) return;
    invoke<{ available: boolean; version?: string }>('check_for_update')
      .then(res => {
        if (res.available) {
          setAnnouncement({
            id: `update-${res.version ?? 'new'}`,
            title: `Update available — v${res.version ?? 'new'}`,
            body: 'A new version of adris.tech is ready. Install it now and restart to get the latest features and fixes.',
            type: 'update',
            cta_label: 'Install & restart',
            cta_url: undefined,
          });
        }
      })
      .catch(() => {/* no network or no update — silent */});
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
          {activeModule === "krew"    && <KrewModule onViewOnCanvas={handleViewOnCanvas} onOpenAutomations={() => setActiveModule('automation')} onOpenStudio={handleOpenStudio} />}
          {activeModule === "connect" && <ConnectApps />}
          {activeModule === "models"  && <ModelsModule />}
          {activeModule === "vault"   && <VaultModule />}
          {activeModule === "guard"   && <GuardModule />}
          {activeModule === "mesh"    && <MeshModule onSessionChange={setMeshActive} />}
          {activeModule === "studio"  && <StudioModule initialRequest={studioRequest} onRequestConsumed={() => setStudioRequest(null)} />}
          {activeModule === "head"    && <HeadModule />}
          {activeModule === "info"     && <InfoModule />}
          {activeModule === "account"  && <AccountPanel />}
          {activeModule === "settings" && <SettingsModule />}
        </main>
      </div>
      {showTour && <TourOverlay onDone={() => setShowTour(false)} />}
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
