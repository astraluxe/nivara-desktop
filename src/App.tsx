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

function AppShell() {
  const { session, loading } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>("home");
  const [showTour, setShowTour] = useState(false);
  const [canvasFlow, setCanvasFlow] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [missedRuns, setMissedRuns] = useState<MissedRun[]>([]);
  const [meshActive, setMeshActive] = useState(false);
  const [studioRequest, setStudioRequest] = useState<StudioRequest | null>(null);

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
