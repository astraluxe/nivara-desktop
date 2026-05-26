import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const DNS_MODES = [
  {
    id:    "swift",
    label: "Swift",
    desc:  "Best all-round pick. Fastest response times with zero browsing logs — your ISP cannot see what sites you visit.",
  },
  {
    id:    "block",
    label: "Block",
    desc:  "Heaviest ad and tracker blocking available. Strips ads from every app and browser on your device, not just Chrome.",
  },
  {
    id:    "guard",
    label: "Guard",
    desc:  "Built to stop threats. Phishing links, malware domains, and spyware are blocked before they ever reach your device.",
  },
  {
    id:    "core",
    label: "Core",
    desc:  "Rock-solid reliability. If you just want fast, stable internet with no filtering or extras, this is the one.",
  },
  {
    id:    "family",
    label: "Family",
    desc:  "Filters out adult content and unsafe sites automatically. Good choice for shared devices or kids on the same network.",
  },
];

const FEATURES = [
  {
    title: "Ad & tracker blocking",
    desc:  "System-wide — every app, every browser.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M4.93 4.93l14.14 14.14" />
      </svg>
    ),
  },
  {
    title: "DNS privacy",
    desc:  "ISP cannot see or log the sites you visit.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: "Malware blocking",
    desc:  "Threats stopped before they reach your device.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 3 6v7c0 5 3.9 9.3 9 10 5.1-.7 9-5 9-10V6z" /><path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Zero logs",
    desc:  "Nothing stored anywhere. Ever.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18M3 12h18M3 18h12" /><path d="M19 15l-5 5m0-5l5 5" />
      </svg>
    ),
  },
];

interface VaultStatus {
  enabled: boolean;
  mode: string;
  adapter: string | null;
}

interface VaultEnableResult {
  adapter: string;
  active_mode: string;
  failover_used: boolean;
}

export default function VaultModule() {
  const [enabled, setEnabled]         = useState(false);
  const [mode, setMode]               = useState("swift");
  const [adapter, setAdapter]         = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [failoverNote, setFailover]   = useState<string | null>(null);
  // pendingToggle: mode to enable after setup completes, or "disable"
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  // Load current vault state and check if one-time setup has been done
  useEffect(() => {
    invoke<VaultStatus>("vault_status")
      .then(s => { setEnabled(s.enabled); setMode(s.mode); setAdapter(s.adapter); })
      .catch(() => {});
    invoke<boolean>("vault_check_setup")
      .then(ok => { if (!ok) setSetupNeeded(true); })
      .catch(() => {});
  }, []);

  // vault_needs_admin: vault was on at launch but task not installed → show setup banner
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ mode: string }>("vault_needs_admin", () => {
      setSetupNeeded(true);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // Sync state when toggled from the system tray
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<VaultStatus & { error?: string }>("vault_state_changed", event => {
      const p = event.payload;
      setEnabled(p.enabled);
      setMode(p.mode);
      setAdapter(p.adapter);
      if (p.error === "setup_required") setSetupNeeded(true);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  async function handleToggle() {
    setLoading(true);
    setError(null);
    setFailover(null);
    try {
      if (enabled) {
        await invoke("vault_disable");
        setEnabled(false);
        setAdapter(null);
      } else {
        const result = await invoke<VaultEnableResult>("vault_enable", { mode });
        setEnabled(true);
        setAdapter(result.adapter);
        if (result.failover_used && result.active_mode !== mode) {
          const modeName = result.active_mode.charAt(0).toUpperCase() + result.active_mode.slice(1);
          setMode(result.active_mode);
          setFailover(`Your chosen DNS servers weren't reachable — automatically switched to ${modeName} mode.`);
        }
      }
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes("setup_required")) {
        setSetupNeeded(true);
        setPendingToggle(enabled ? "disable" : mode);
      } else {
        setError(msg || "Failed to change DNS settings.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleModeChange(newMode: string) {
    setMode(newMode);
    if (!enabled) return;
    setLoading(true);
    setError(null);
    setFailover(null);
    try {
      const result = await invoke<VaultEnableResult>("vault_enable", { mode: newMode });
      setAdapter(result.adapter);
      if (result.failover_used && result.active_mode !== newMode) {
        const modeName = result.active_mode.charAt(0).toUpperCase() + result.active_mode.slice(1);
        setMode(result.active_mode);
        setFailover(`Switched to ${modeName} mode — original mode's DNS servers not reachable.`);
      }
    } catch (e: unknown) {
      const msg = String(e);
      if (msg.includes("setup_required")) setSetupNeeded(true);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup() {
    setSetupLoading(true);
    setError(null);
    try {
      await invoke("vault_do_setup");
      setSetupNeeded(false);
      // Auto-retry the operation that triggered the setup banner
      if (pendingToggle) {
        setPendingToggle(null);
        if (pendingToggle === "disable") {
          await handleDisableAfterSetup();
        } else {
          await handleEnableAfterSetup(pendingToggle);
        }
      }
    } catch (e: unknown) {
      setError(String(e) || "Setup failed — please try again.");
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleEnableAfterSetup(m: string) {
    setLoading(true);
    try {
      const result = await invoke<VaultEnableResult>("vault_enable", { mode: m });
      setEnabled(true);
      setAdapter(result.adapter);
    } catch (e: unknown) {
      setError(String(e) || "Failed to enable Vault after setup.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisableAfterSetup() {
    setLoading(true);
    try {
      await invoke("vault_disable");
      setEnabled(false);
      setAdapter(null);
    } catch (e: unknown) {
      setError(String(e) || "Failed to disable Vault after setup.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-nv-bg p-6 gap-5 relative">
      {/* Honeycomb background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" style={{ opacity: 0.06 }}>
        <svg viewBox="0 0 1600 900" fill="none" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', width: '100%', height: '100%', color: '#7C5CFF' }}>
          <defs>
            <pattern id="hex-vault" x="0" y="0" width="104" height="60" patternUnits="userSpaceOnUse">
              <path d="M26 0 L78 0 L104 30 L78 60 L26 60 L0 30 Z" fill="none" stroke="currentColor" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="1600" height="900" fill="url(#hex-vault)"/>
          <path style={{ animation: 'nv-hex-pulse 2.6s ease-in-out infinite' }} d="M538 270 L590 270 L616 300 L590 330 L538 330 L512 300 Z" fill="#7C5CFF" opacity="0.4"/>
          <path style={{ animation: 'nv-hex-pulse 2.6s ease-in-out 1.3s infinite' }} d="M1018 450 L1070 450 L1096 480 L1070 510 L1018 510 L992 480 Z" fill="#7C5CFF" opacity="0.4"/>
          <path d="M1380 220 L1500 270 L1500 480 C1500 580 1380 660 1380 660 C1380 660 1260 580 1260 480 L1260 270 Z"
                fill="none" stroke="#7C5CFF" strokeWidth="2" opacity="0.4"/>
        </svg>
      </div>

      {/* One-time setup banner — shown until NivaraVaultDNS scheduled task is installed */}
      {setupNeeded && (
        <div className="relative z-10 flex items-start gap-3 px-4 py-3 rounded-xl border border-accent/30 bg-accent/6">
          <svg className="flex-shrink-0 mt-0.5 text-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/><path d="M12 22V12"/><path d="M12 12L2 7"/><path d="M12 12l10-5"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-nv-text font-medium">One-time setup required</p>
            <p className="text-xs text-nv-muted mt-0.5">
              Vault needs a one-time Windows permission to change your DNS. You'll see a single security prompt — after that, Vault works silently forever.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleSetup}
              disabled={setupLoading}
              className="px-3 py-1 text-xs font-mono bg-accent text-white rounded-lg hover:bg-accent/80 disabled:opacity-50 transition-fast"
            >
              {setupLoading ? "Setting up…" : "Set Up Vault"}
            </button>
            <button onClick={() => setSetupNeeded(false)} className="text-nv-muted hover:text-nv-text transition-fast">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* DNS failover notice */}
      {failoverNote && (
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-accent/30 bg-accent/8">
          <svg className="text-accent flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.41"/>
          </svg>
          <p className="text-xs text-nv-muted flex-1">{failoverNote}</p>
          <button onClick={() => setFailover(null)} className="text-nv-muted hover:text-nv-text">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Generic error */}
      {error && (
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-red-500/30 bg-red-500/8">
          <svg className="text-red-400 flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="text-xs text-nv-muted flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-nv-muted hover:text-nv-text">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {/* Top row — shield left, DNS modes right */}
      <div className="flex gap-5 flex-1 min-h-0">

        {/* Left — shield + toggle */}
        <div className="flex flex-col items-center justify-center gap-6 w-72 flex-shrink-0 rounded-2xl bg-nv-surface border border-nv-border px-8 py-10">
          {/* Shield */}
          <div className="relative">
            <div className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 ${
              enabled ? "bg-accent/15 border-2 border-accent/40" : "bg-nv-surface2 border-2 border-nv-border"
            }`}>
              <svg width="54" height="54" viewBox="0 0 28 28" fill="none"
                 className={enabled ? "text-accent" : "text-nv-muted"}>
                <path
                  d="M14 2 4 6v8c0 6.5 4.3 11.5 10 12 5.7-.5 10-5.5 10-12V6L14 2Z"
                  fill="currentColor"
                  fillOpacity={enabled ? 0.2 : 0.12}
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeOpacity={enabled ? 1 : 0.4}
                />
                {enabled && (
                  <path d="M10 14l3 3 5-5" stroke="var(--nv-bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </div>
            <span className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-nv-bg transition-colors duration-500 ${
              enabled ? "bg-nv-green" : "bg-nv-faint"
            }`} />
          </div>

          {/* Status */}
          <div className="text-center flex flex-col gap-1.5">
            <p className="text-nv-text text-lg font-semibold tracking-tight">Vault</p>
            <p className={`text-sm font-mono transition-colors duration-300 ${enabled ? "text-nv-green" : "text-nv-muted"}`}>
              {enabled ? "Protected" : "Not protected"}
            </p>
            {enabled && (
              <p className="text-accent text-xs font-mono uppercase tracking-wide">
                {DNS_MODES.find((d) => d.id === mode)?.label} mode active
              </p>
            )}
            {enabled && adapter && (
              <p className="text-nv-faint text-[10px] font-mono tracking-wide">
                via {adapter}
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="w-full border-t border-nv-border" />

          {/* Toggle */}
          <div className="flex flex-col items-center gap-3 w-full">
            <button
              onClick={handleToggle}
              disabled={loading}
              className={`relative w-16 h-8 rounded-full transition-colors duration-300 focus:outline-none ${
                loading ? "opacity-50 cursor-not-allowed" :
                enabled ? "bg-accent" : "bg-nv-surface2 border border-nv-border"
              }`}
              aria-label={enabled ? "Disable Vault" : "Enable Vault"}
            >
              {loading ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg className="animate-spin text-nv-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                </span>
              ) : (
                <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all duration-300 ${
                  enabled ? "left-9" : "left-1"
                }`} />
              )}
            </button>
            <p className="text-nv-faint text-xs font-mono">
              {loading ? "Applying…" : enabled ? "Click to disable" : "Click to enable"}
            </p>
          </div>

          {/* Free badge */}
          <div className="w-full text-center pt-1">
            <span className="text-nv-faint text-[10px] font-mono uppercase tracking-widest">
              Free · all plans · no limits
            </span>
          </div>
        </div>

        {/* Right — DNS mode selector */}
        <div className="flex flex-col flex-1 rounded-2xl bg-nv-surface border border-nv-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-nv-border">
            <p className="text-nv-muted text-[10px] uppercase tracking-widest font-mono">Protection mode</p>
          </div>
          <div className="flex flex-col flex-1 divide-y divide-nv-border">
            {DNS_MODES.map((dns) => {
              const active = mode === dns.id;
              return (
                <div
                  key={dns.id}
                  className={`flex items-center justify-between px-4 flex-1 transition-fast ${
                    active ? "bg-accent/8" : "hover:bg-nv-surface2"
                  }`}
                >
                  <div>
                    <p className="text-nv-text text-sm font-medium">{dns.label}</p>
                    <p className="text-nv-muted text-xs">{dns.desc}</p>
                  </div>
                  <button
                    onClick={() => handleModeChange(dns.id)}
                    disabled={loading}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex-shrink-0 focus:outline-none ${
                      loading ? "opacity-50 cursor-not-allowed" :
                      active ? "bg-accent" : "bg-nv-surface2 border border-nv-border"
                    }`}
                    aria-label={`Select ${dns.label}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${
                      active ? "left-5" : "left-0.5"
                    }`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom row — 4 feature cards */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex flex-col gap-2 p-4 rounded-xl bg-nv-surface border border-nv-border">
            <span className="text-nv-muted">{f.icon}</span>
            <p className="text-nv-text text-sm font-medium">{f.title}</p>
            <p className="text-nv-muted text-xs leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

    </div>
  );
}
