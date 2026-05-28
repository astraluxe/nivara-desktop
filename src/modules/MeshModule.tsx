import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useAuth } from "../contexts/AuthContext";
import { getPlanConfig } from "../lib/planConfig";
import UpgradeModal from "../components/UpgradeModal";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MachineInfo { hostname: string; ram_gb: number; os: string }
interface Device {
  deviceId:   string;
  deviceName: string;
  ramGb:      number;
  isCentral:  boolean;
  joinedAt:   number;
}
type SessionState = "idle" | "hosting" | "joining" | "joined";

// ── Constants ─────────────────────────────────────────────────────────────────

const DEVICE_ID_KEY = "nv-mesh-device-id";
const TIER_KEY      = "nv-mesh-tier";

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10).toUpperCase();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const suffix = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `NIVARA-${suffix}`;
}

const TIERS = [
  { key: "free",    label: "Mesh 3",  price: "Free", sub: "forever",   maxDevices: 3  },
  { key: "hourly",  label: "1 hour",  price: "₹15",  sub: "/ session", maxDevices: 5  },
  { key: "daily",   label: "1 day",   price: "₹59",  sub: "/ session", maxDevices: 10 },
  { key: "weekly",  label: "1 week",  price: "₹179", sub: "/ session", maxDevices: 10 },
  { key: "monthly", label: "Monthly", price: "₹399", sub: "/ month",   maxDevices: 10 },
] as const;

const MODELS = [
  { name: "TinyLlama 1.1B",    ram: "2 GB",   devs: "1 × 4 GB",  use: "Quick tasks" },
  { name: "Llama 3.2 3B",      ram: "4 GB",   devs: "1 × 4 GB",  use: "Chat" },
  { name: "Mistral 7B",        ram: "8 GB",   devs: "1 × 8 GB",  use: "Writing & analysis" },
  { name: "Qwen 2.5 Coder 7B", ram: "8 GB",   devs: "1 × 8 GB",  use: "Code generation" },
  { name: "Llama 3.1 70B",     ram: "40 GB",  devs: "5 × 8 GB",  use: "Advanced reasoning" },
  { name: "Command R 35B",     ram: "20 GB",  devs: "3 × 8 GB",  use: "RAG & tools" },
  { name: "DeepSeek V3",       ram: "70 GB",  devs: "9 × 8 GB",  use: "Frontier intelligence" },
  { name: "DeepSeek R1 671B",  ram: "400 GB", devs: "50 × 8 GB", use: "Mesh frontier", frontier: true },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CopyChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); })}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-mono text-[11px] font-medium transition-colors"
      style={{ background: "rgba(124,92,255,0.1)", color: copied ? "#10B981" : "var(--accent)" }}
    >
      {copied ? "Copied!" : (label ?? value)}
      {!copied && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-mono uppercase tracking-widest mb-3" style={{ color: "var(--accent)", opacity: 0.8, letterSpacing: "0.14em" }}>
      {children}
    </p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface MeshModuleProps {
  onSessionChange?: (active: boolean) => void;
}

export default function MeshModule({ onSessionChange }: MeshModuleProps) {
  const { profile } = useAuth();
  const userPlan    = profile?.plan ?? "explore";
  const planCfg     = getPlanConfig(userPlan);

  const [sessionState, setSessionState]       = useState<SessionState>("idle");
  const [roomCode, setRoomCode]               = useState("");
  const [roomCodeInput, setRoomCodeInput]     = useState("");
  const [devices, setDevices]                 = useState<Device[]>([]);
  const [machineInfo, setMachineInfo]         = useState<MachineInfo | null>(null);
  const [tier]                                = useState<string>(localStorage.getItem(TIER_KEY) ?? "free");
  const [showUpgrade, setShowUpgrade]         = useState(false);
  const [upgradeReason, setUpgradeReason]     = useState<string>("");
  const [upgradePlan, setUpgradePlan]         = useState<string>("builder");
  const [exoRunning, setExoRunning]           = useState(false);
  const [err, setErr]                         = useState<string | null>(null);
  const [joining, setJoining]                 = useState(false);

  function showUpgradeFor(reason: string, plan: string) {
    setUpgradeReason(reason);
    setUpgradePlan(plan);
    setShowUpgrade(true);
  }

  const channelRef   = useRef<RealtimeChannel | null>(null);
  const isCentralRef = useRef(false);
  const deviceId     = getDeviceId();
  const currentTier  = TIERS.find(t => t.key === tier) ?? TIERS[0];
  const isActive     = sessionState === "hosting" || sessionState === "joined";

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    invoke<MachineInfo>("mesh_get_machine_info").then(setMachineInfo).catch(() => null);
  }, []);

  // ── Notify parent (App.tsx → Sidebar) about session state ──────────────────

  useEffect(() => {
    onSessionChange?.(isActive);
  }, [isActive, onSessionChange]);

  // ── Presence channel helpers ─────────────────────────────────────────────

  function buildPayload(isCentral: boolean): Device {
    return {
      deviceId,
      deviceName: machineInfo?.hostname ?? "Unknown Device",
      ramGb:      Math.round(machineInfo?.ram_gb ?? 0),
      isCentral,
      joinedAt:   Date.now(),
    };
  }

  async function openChannel(code: string, isCentral: boolean): Promise<boolean> {
    const ch = supabase.channel(`mesh:${code}`, {
      config: { presence: { key: deviceId } },
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<Device>();
      setDevices(Object.values(state).flat());
    });

    ch.on("presence", { event: "leave" }, ({ leftPresences }) => {
      const centralLeft = (leftPresences as unknown as Device[]).some(p => p.isCentral);
      if (centralLeft && !isCentralRef.current) {
        closeChannel();
        setErr("The host ended the session. You have been disconnected.");
      }
    });

    return new Promise(resolve => {
      ch.subscribe(async status => {
        if (status === "SUBSCRIBED") {
          const state   = ch.presenceState<Device>();
          const current = Object.keys(state).length;
          if (!isCentral && current >= currentTier.maxDevices) {
            await ch.unsubscribe();
            setErr(`Session is full (${currentTier.maxDevices} device limit for ${currentTier.label}).`);
            resolve(false);
            return;
          }
          await ch.track(buildPayload(isCentral));
          channelRef.current = ch;
          resolve(true);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve(false);
        }
      });
    });
  }

  const closeChannel = useCallback(async () => {
    if (channelRef.current) {
      await channelRef.current.untrack().catch(() => null);
      await supabase.removeChannel(channelRef.current).catch(() => null);
      channelRef.current = null;
    }
    if (exoRunning) {
      await invoke("mesh_stop_exo").catch(() => null);
      setExoRunning(false);
    }
    isCentralRef.current = false;
    setDevices([]);
    setRoomCode("");
    setSessionState("idle");
  }, [exoRunning]);

  // ── Session actions ─────────────────────────────────────────────────────────

  async function startSession() {
    if (!machineInfo) return;
    setErr(null);
    const code = generateRoomCode();
    isCentralRef.current = true;
    setSessionState("joining");
    const ok = await openChannel(code, true);
    if (ok) {
      setRoomCode(code);
      setSessionState("hosting");
      invoke<void>("mesh_start_exo", { nodeCount: currentTier.maxDevices })
        .then(() => setExoRunning(true)).catch(() => null);
    } else {
      isCentralRef.current = false;
      setSessionState("idle");
      if (!err) setErr("Failed to start session. Check your internet connection.");
    }
  }

  async function joinSession() {
    const code = roomCodeInput.trim().toUpperCase();
    if (!machineInfo || !code) return;
    setErr(null);
    setJoining(true);
    isCentralRef.current = false;
    setSessionState("joining");
    const ok = await openChannel(code, false);
    setJoining(false);
    if (ok) {
      setRoomCode(code);
      setSessionState("joined");
      invoke<void>("mesh_start_exo", { nodeCount: 1 })
        .then(() => setExoRunning(true)).catch(() => null);
    } else {
      isCentralRef.current = false;
      setSessionState("idle");
      if (!err) setErr("Could not join. Check the room code and try again.");
    }
  }

  function totalRam() { return devices.reduce((s, d) => s + d.ramGb, 0); }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto bg-nv-bg" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">

        {/* Header row */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(124,92,255,0.12)", color: "var(--accent)" }}>
            <svg viewBox="0 0 28 28" fill="none" style={{ width: 18, height: 18 }}>
              <circle cx="4"  cy="14" r="2.5" fill="currentColor"/>
              <circle cx="14" cy="4"  r="2.5" fill="currentColor"/>
              <circle cx="24" cy="14" r="2.5" fill="currentColor"/>
              <circle cx="14" cy="24" r="2.5" fill="currentColor"/>
              <circle cx="14" cy="14" r="2"   fill="currentColor" opacity=".6"/>
              <path d="M6 14h5M17 14h5M14 6v5M14 17v5" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
            </svg>
          </div>
          <div>
            <h1 className="text-[18px] font-semibold text-nv-text tracking-tight leading-none">Mesh</h1>
            <p className="text-[11px] text-nv-muted font-mono mt-0.5">RAM pooling · distributed AI inference</p>
          </div>
          <div className="ml-auto">
            {isActive ? (
              <span className="font-mono text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: "rgba(16,185,129,0.1)", color: "#10B981" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Session active
              </span>
            ) : (
              <span className="font-mono text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1.5"
                style={{ background: "rgba(124,92,255,0.08)", color: "var(--accent)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--nv-faint)" }} />
                {currentTier.label} · {currentTier.maxDevices} devices
              </span>
            )}
          </div>
        </div>

        {/* ── SESSION CARD — first thing visible ── */}
        <div>
          <div className="rounded-xl border overflow-hidden"
            style={{ borderColor: isActive ? "rgba(16,185,129,0.3)" : "var(--nv-rule)" }}>

            {/* Idle */}
            {sessionState === "idle" && (
              <div className="p-5">
                <p className="text-[11px] text-nv-muted mb-4 leading-relaxed">
                  Start a session to get a room code, then share it with anyone on another device running Nivara to pool your RAM.
                </p>
                <button
                  onClick={startSession}
                  className="w-full text-[13px] font-semibold py-3 rounded-lg mb-3 transition-opacity hover:opacity-90 active:opacity-80"
                  style={{ background: "#7C5CFF", color: "#fff", border: "none" }}
                >
                  Start session · become host
                </button>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-px" style={{ background: "var(--nv-rule)" }} />
                  <span className="text-[10px] text-nv-faint font-mono">or join existing</span>
                  <div className="flex-1 h-px" style={{ background: "var(--nv-rule)" }} />
                </div>
                <div className="flex gap-2 mt-3">
                  <input
                    value={roomCodeInput}
                    onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === "Enter" && roomCodeInput.trim() && joinSession()}
                    placeholder="Enter room code — e.g. NIVARA-XK9F2A"
                    spellCheck={false}
                    className="flex-1 px-3 py-2 rounded-lg border font-mono text-[12px] outline-none"
                    style={{ borderColor: "var(--nv-rule)", background: "var(--nv-bg)", color: "var(--nv-ink)" }}
                  />
                  <button
                    onClick={joinSession}
                    disabled={!roomCodeInput.trim() || joining}
                    className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-40"
                    style={{ background: "#7C5CFF", color: "#fff", border: "none", opacity: (!roomCodeInput.trim() || joining) ? 0.4 : 1 }}
                  >
                    {joining ? "Joining…" : "Join"}
                  </button>
                </div>
              </div>
            )}

            {/* Connecting */}
            {sessionState === "joining" && (
              <div className="p-5 flex items-center gap-3">
                <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                <span className="text-[12px] text-nv-muted">Connecting to mesh network…</span>
              </div>
            )}

            {/* Active session */}
            {(sessionState === "hosting" || sessionState === "joined") && (
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "#10B981" }}>
                    {sessionState === "hosting" ? "Central node · hosting" : "Connected as guest"}
                  </span>
                  <span className="font-mono text-[9px]" style={{ color: "#10B981" }}>
                    {devices.length} / {currentTier.maxDevices} devices
                  </span>
                </div>

                {sessionState === "hosting" && (
                  <div className="mb-4">
                    <p className="text-[10px] text-nv-muted mb-1.5">Share this code with other devices to connect:</p>
                    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
                      style={{ borderColor: "rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.04)" }}>
                      <span className="font-mono font-bold flex-1 text-nv-text" style={{ fontSize: "17px", letterSpacing: "0.12em" }}>
                        {roomCode}
                      </span>
                      <CopyChip value={roomCode} label="Copy code" />
                    </div>
                  </div>
                )}

                {/* Device list */}
                <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: "var(--nv-rule)" }}>
                  {devices.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] font-mono" style={{ color: "var(--nv-faint)" }}>
                      Waiting for devices to join…
                    </div>
                  ) : devices.map((d, i) => (
                    <div key={d.deviceId}
                      className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0"
                      style={{ borderColor: "var(--nv-rule)", background: i % 2 === 0 ? "var(--nv-surface)" : "transparent" }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#10B981" }} />
                      <span className="font-semibold text-[11px] flex-1 text-nv-text truncate">{d.deviceName}</span>
                      {d.isCentral && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "rgba(124,92,255,0.12)", color: "var(--accent)" }}>HOST</span>
                      )}
                      <span className="font-mono text-[10px] text-nv-muted shrink-0">{d.ramGb} GB</span>
                    </div>
                  ))}
                </div>

                {/* Pool stats */}
                <div className="flex items-center gap-5 mb-4 text-[11px]">
                  <span className="text-nv-muted">
                    Pooled RAM: <strong className="font-mono text-nv-text">{totalRam()} GB</strong>
                  </span>
                  {exoRunning && (
                    <span className="flex items-center gap-1.5 text-nv-muted">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      Exo running
                    </span>
                  )}
                </div>

                <button
                  onClick={closeChannel}
                  className="w-full text-[12px] font-semibold py-2 rounded-lg border transition-colors"
                  style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#EF4444" }}
                >
                  {sessionState === "hosting" ? "End session for all devices" : "Leave session"}
                </button>
              </div>
            )}
          </div>

          {err && (
            <div className="mt-2 px-3 py-2 rounded-lg text-[11px]"
              style={{ background: "rgba(239,68,68,0.06)", borderLeft: "2px solid #EF4444", color: "#EF4444" }}>
              {err}
              <button className="ml-2 underline text-[10px]" onClick={() => setErr(null)}>dismiss</button>
            </div>
          )}

          {sessionState !== "idle" && sessionState !== "joining" && (
            <p className="text-[10px] text-nv-faint mt-2">
              {sessionState === "hosting"
                ? "You are the central node. When you end the session, all connected devices are automatically disconnected."
                : "You joined this session as a guest. If the host disconnects, you will be removed automatically."}
            </p>
          )}
        </div>

        {/* This device + extension status — compact row */}
        {machineInfo && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border"
            style={{ borderColor: "var(--nv-rule)", background: "var(--nv-surface)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }}>
              <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
            </svg>
            <span className="font-semibold text-[12px] text-nv-text">{machineInfo.hostname}</span>
            <span className="text-nv-faint">·</span>
            <span className="font-mono text-[11px] text-nv-muted">{Math.round(machineInfo.ram_gb)} GB RAM</span>
            <div className="ml-auto">
              <span className="font-mono text-[9px] px-2 py-0.5 rounded"
                style={{ background: "rgba(16,185,129,0.1)", color: "#10B981" }}>
                Mesh ready
              </span>
            </div>
          </div>
        )}

        {/* Tier / pricing */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Mesh tier</SectionLabel>
            <button onClick={() => setShowUpgrade(true)} className="text-[10px] font-mono text-accent hover:underline">
              Upgrade →
            </button>
          </div>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            {TIERS.map((t, i) => {
              const active = t.key === tier;
              return (
                <div key={t.key}
                  className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0 cursor-pointer"
                  style={{
                    borderColor: "var(--nv-rule)",
                    background: active ? "rgba(124,92,255,0.06)" : i % 2 === 0 ? "var(--nv-surface)" : "transparent",
                    borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                  onClick={() => { if (t.key !== "free") setShowUpgrade(true); }}
                >
                  <div className="w-16 shrink-0">
                    <div className="font-semibold text-[12px]" style={{ color: active ? "var(--accent)" : "var(--nv-ink)" }}>{t.label}</div>
                    <div className="font-mono text-[9px] text-nv-muted">{t.sub}</div>
                  </div>
                  <div className="font-bold text-[15px] w-14 shrink-0" style={{ color: "var(--nv-ink)", letterSpacing: "-0.02em" }}>{t.price}</div>
                  <div className="flex-1 font-mono text-[10px] text-nv-muted">Up to {t.maxDevices} devices</div>
                  {t.key === "free" && <span className="font-mono text-[9px] px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(16,185,129,0.12)", color: "#10B981" }}>FREE</span>}
                  {t.key === "monthly" && <span className="font-mono text-[9px] px-2 py-0.5 rounded shrink-0" style={{ background: "rgba(124,92,255,0.12)", color: "var(--accent)" }}>BEST VALUE</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] mt-2 text-nv-faint">
            Extra devices: ₹2/hr · ₹6/day · ₹18/wk · ₹40/mo per device beyond base.
          </p>
        </div>

        {/* Models table */}
        <div>
          <SectionLabel>What you can run with Mesh</SectionLabel>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            <div className="grid font-mono text-[9px] uppercase tracking-widest border-b px-4 py-2.5"
              style={{ gridTemplateColumns: "1.8fr 0.7fr 1fr 1.2fr", borderColor: "var(--nv-rule)", background: "var(--nv-surface)", color: "var(--nv-muted)" }}>
              {["Model", "RAM", "Devices", "Best for"].map(h => <div key={h}>{h}</div>)}
            </div>
            {MODELS.map((r, i) => (
              <div key={r.name}
                className="grid items-center px-4 py-3 border-b last:border-b-0"
                style={{
                  gridTemplateColumns: "1.8fr 0.7fr 1fr 1.2fr",
                  borderColor: "var(--nv-rule)",
                  background: (r as any).frontier ? "rgba(251,146,60,0.04)" : i % 2 === 0 ? "var(--nv-surface)" : "transparent",
                  borderLeft: (r as any).frontier ? "2px solid #F97316" : "2px solid transparent",
                }}>
                <div>
                  <div className="font-sans text-[12px] font-medium text-nv-text">{r.name}</div>
                  {(r as any).frontier && <div className="font-mono text-[9px] mt-0.5" style={{ color: "#F97316" }}>MESH FRONTIER</div>}
                </div>
                <div className="font-mono text-[11px] text-nv-muted">{r.ram}</div>
                <div className="font-mono text-[11px]" style={{ color: (r as any).frontier ? "var(--accent)" : "var(--nv-muted)" }}>{r.devs}</div>
                <div className="text-[11px] text-nv-muted">{r.use}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Relay nodes — paid inter-mesh connections */}
        <div>
          <SectionLabel>Relay nodes</SectionLabel>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            <div className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ background: planCfg.canCreateMesh ? "rgba(16,185,129,0.1)" : "rgba(124,92,255,0.08)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                    style={{ color: planCfg.canCreateMesh ? "#10B981" : "var(--accent)" }}>
                    <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-[12px] text-nv-text">Central relay infrastructure</div>
                  <div className="text-[11px] text-nv-muted mt-0.5 leading-relaxed">
                    Connect devices across different networks. Relay nodes route traffic when direct P2P connection isn't possible — useful for teams on corporate networks or different ISPs.
                  </div>
                </div>
              </div>
              {planCfg.canCreateMesh ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse shrink-0" />
                  <span className="text-[11px] text-nv-muted">Relay routing active — included in your Builder+ plan</span>
                </div>
              ) : (
                <button
                  onClick={() => showUpgradeFor("Relay nodes connect devices across networks. Available on Builder plan and above.", "builder")}
                  className="w-full py-2 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-80"
                  style={{ background: "#7C5CFF", color: "#fff", border: "none" }}
                >
                  Unlock relay nodes · Builder+
                </button>
              )}
            </div>
          </div>
        </div>

        {/* How central node system works */}
        <div>
          <SectionLabel>Central node system</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            {[
              { n: "01", t: "Host creates session", b: "The device that starts the session becomes the central node. They generate a room code and control device limits based on their Mesh tier." },
              { n: "02", t: "Guests join with code", b: "Anyone on the same Nivara account or with the code can join. Their RAM is added to the shared pool." },
              { n: "03", t: "Host controls everything", b: "When the central node leaves, all guests are automatically disconnected. Model inference splits across all connected devices." },
            ].map(s => (
              <div key={s.n} className="rounded-xl border p-4" style={{ borderColor: "var(--nv-rule)", background: "var(--nv-surface)" }}>
                <div className="font-mono text-[9px] mb-2 tracking-widest" style={{ color: "var(--accent)", opacity: 0.7 }}>{s.n}</div>
                <div className="font-semibold text-[12px] text-nv-text mb-1.5">{s.t}</div>
                <div className="text-[11px] leading-relaxed text-nv-muted">{s.b}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="h-4" />
      </div>

      {showUpgrade && (
        <UpgradeModal
          onClose={() => setShowUpgrade(false)}
          currentPlan={userPlan}
          highlightPlan={upgradePlan}
          reason={upgradeReason}
        />
      )}
    </div>
  );
}
