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
import { AppSkeleton } from "./components/Skeleton";
import TourOverlay, { isTourDone } from "./components/TourOverlay";
import type { Node, Edge } from "@xyflow/react";
import { executeAutomation, type AutomationRow } from "./lib/automationRunner";
import { supabase } from "./lib/supabase";

function AppShell() {
  const { session, loading } = useAuth();
  const [activeModule, setActiveModule] = useState<Module>("home");
  const [showTour, setShowTour] = useState(false);
  const [canvasFlow, setCanvasFlow] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

  function handleViewOnCanvas(nodes: Node[], edges: Edge[]) {
    setCanvasFlow({ nodes, edges });
    setActiveModule("automation");
  }

  useEffect(() => {
    if (session && !isTourDone()) {
      setShowTour(true);
    }
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

  if (loading) return <AppSkeleton />;

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-col h-full">
      <TitleBar activeModule={activeModule} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeModule={activeModule} onModuleChange={setActiveModule} />
        <main className="flex-1 overflow-hidden">
          {activeModule === "home"       && <HomeModule onNavigate={setActiveModule} onStartTour={() => setShowTour(true)} />}
          {activeModule === "automation" && <AutomationModule canvasFlow={canvasFlow} onCanvasFlowConsumed={() => setCanvasFlow(null)} />}
          {activeModule === "coder"      && <CoderModule />}
          {activeModule === "krew"    && <KrewModule onViewOnCanvas={handleViewOnCanvas} />}
          {activeModule === "connect" && <ConnectApps />}
          {activeModule === "models"  && <ModelsModule />}
          {activeModule === "vault"   && <VaultModule />}
          {activeModule === "guard"   && <GuardModule />}
          {activeModule === "mesh"    && <MeshModule />}
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
