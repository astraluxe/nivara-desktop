import { useEffect, useState, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import FeedbackModal from "./FeedbackModal";

export type Module = "home" | "automation" | "coder" | "krew" | "connect" | "models" | "vault" | "guard" | "mesh" | "head" | "info" | "account" | "settings";

interface Props {
  activeModule: Module;
  onModuleChange: (m: Module) => void;
  meshSessionActive?: boolean;
}

// ── Theme toggle ──────────────────────────────────────────────────────────────

function useTheme() {
  const [paper, setPaper] = useState(() => {
    return localStorage.getItem("nv-theme") === "paper";
  });

  useEffect(() => {
    if (paper) {
      document.documentElement.classList.add("paper");
      localStorage.setItem("nv-theme", "paper");
    } else {
      document.documentElement.classList.remove("paper");
      localStorage.setItem("nv-theme", "ink");
    }
  }, [paper]);

  return { paper, toggle: () => setPaper((p) => !p) };
}

// ── Module list ───────────────────────────────────────────────────────────────

const MODULES: { id: Module; label: string; icon: React.ReactNode; status: "active" | "idle" | "off" }[] = [
  {
    id: "krew",
    label: "Krew · AI agent",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <circle cx="14" cy="14" r="5" fill="currentColor"/>
        <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 3" fill="none" opacity=".5"/>
        <circle cx="25" cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="3"  cy="14" r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="3"  r="2" fill="currentColor" opacity=".7"/>
        <circle cx="14" cy="25" r="2" fill="currentColor" opacity=".7"/>
      </svg>
    ),
  },
  {
    id: "automation",
    label: "Automation · workflows",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M16 3l-9 13h8l-3 9 9-13h-8l3-9z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "connect",
    label: "Connect Apps · integrations",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M10 4v7M18 4v7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
        <rect x="7" y="11" width="14" height="8" rx="3" fill="currentColor"/>
        <path d="M14 19v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "coder",
    label: "Coder · dev terminal",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M8 4H2v6m0 8v6h6M20 4h6v6m0 8v6h-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
        <rect x="10" y="12" width="8" height="4" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "models",
    label: "Models · open hub",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 26 8 14 14 2 8 14 2Z" fill="currentColor" />
        <path d="M2 14l12 6 12-6" stroke="currentColor" strokeWidth="2.2" />
        <path d="M2 20l12 6 12-6" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    ),
  },
  {
    id: "vault",
    label: "Vault · DNS protection",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 4 6v8c0 6.5 4.3 11.5 10 12 5.7-.5 10-5.5 10-12V6L14 2Z" fill="currentColor" />
        <path d="M10 14l3 3 5-5" stroke="var(--nv-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "guard",
    label: "Guard · security",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <path d="M14 2 3 6v10c0 5 4.5 9.5 11 10 6.5-.5 11-5 11-10V6L14 2Z" fill="currentColor" />
        <rect x="11" y="11" width="6" height="8" fill="var(--nv-bg)" />
        <circle cx="14" cy="14" r="1.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "mesh",
    label: "Mesh · RAM pooling",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <circle cx="4"  cy="14" r="2.5" fill="currentColor" />
        <circle cx="14" cy="4"  r="2.5" fill="currentColor" />
        <circle cx="24" cy="14" r="2.5" fill="currentColor" />
        <circle cx="14" cy="24" r="2.5" fill="currentColor" />
        <circle cx="14" cy="14" r="2"   fill="currentColor" opacity=".6" />
        <path d="M6 14h5M17 14h5M14 6v5M14 17v5" stroke="currentColor" strokeWidth="1.4" opacity=".4" />
        <path d="M6 6l5.5 5.5M16.5 16.5l5.5 5.5M22 6l-5.5 5.5M11.5 16.5L6 22" stroke="currentColor" strokeWidth="1" opacity=".2" />
      </svg>
    ),
  },
  {
    id: "info",
    label: "Info · module guide",
    status: "active",
    icon: (
      <svg viewBox="0 0 28 28" fill="none" className="w-5 h-5">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" fill="currentColor" fillOpacity=".1"/>
        <path d="M9 8h8M9 12h8M9 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M21 6v18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".3"/>
      </svg>
    ),
  },
];

const STATUS_COLOR: Record<string, string> = {
  active: "bg-nv-green",
  idle:   "bg-nv-yellow",
  off:    "bg-nv-faint",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Live",
  idle:   "Building",
  off:    "Planned",
};

const STATUS_TEXT: Record<string, string> = {
  active: "text-nv-green",
  idle:   "text-yellow-400",
  off:    "text-nv-faint",
};

const SHORT_LABEL: Record<string, string> = {
  automation: "Automation",
  krew:       "Krew",
  connect:    "Connect Apps",
  coder:      "Coder",
  models:     "Models",
  vault:      "Vault",
  guard:      "Guard",
  mesh:       "Mesh",
  head:       "Head",
  info:       "Info",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Sidebar({ activeModule, onModuleChange, meshSessionActive }: Props) {
  const { profile, user } = useAuth();
  const { paper, toggle } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const email = profile?.email ?? user?.email ?? "";
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  const initial = (fullName || email)[0]?.toUpperCase() ?? "N";

  function handleMouseEnter() {
    if (expandTimer.current) clearTimeout(expandTimer.current);
    expandTimer.current = setTimeout(() => setExpanded(true), 2000);
  }

  function handleMouseLeave() {
    if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null; }
    setExpanded(false);
  }

  const W = expanded ? "192px" : "60px";

  return (
    <aside
      className="flex flex-col shrink-0 bg-nv-bg border-r border-nv-border overflow-hidden"
      style={{
        width: W,
        minWidth: W,
        transition: "width 0.18s cubic-bezier(0.4,0,0.2,1), min-width 0.18s cubic-bezier(0.4,0,0.2,1)",
        zIndex: 20,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Logo mark */}
      <div
        className="flex items-center justify-center h-10 border-b border-nv-border shrink-0"
        style={{ justifyContent: expanded ? "flex-start" : "center", paddingLeft: expanded ? "14px" : "0", transition: "padding 0.18s, justify-content 0s" }}
      >
        <svg width="18" height="16" viewBox="0 0 26 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M2 4 L9 4 L15 12 L9 20 L2 20 L8 12 Z" fill="#7C5CFF" />
          <path d="M12 4 L19 4 L25 12 L19 20 L12 20 L18 12 Z" fill="#7C5CFF" opacity="0.55" />
        </svg>
        <span
          className="font-sans font-semibold text-sm text-nv-ink"
          style={{
            opacity: expanded ? 1 : 0,
            maxWidth: expanded ? "100px" : 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            marginLeft: expanded ? "8px" : 0,
            letterSpacing: "-0.01em",
            transition: "opacity 0.15s 0.05s, max-width 0.18s, margin-left 0.18s",
            pointerEvents: "none",
          }}
        >
          adris.tech
        </span>
      </div>

      {/* Module icons */}
      <nav id="tour-sidebar-nav" className="flex flex-col gap-1 pt-3 flex-1 overflow-hidden" style={{ alignItems: "stretch" }}>
        {/* Home */}
        <button
          onClick={() => onModuleChange("home")}
          title="Home"
          aria-label="Home"
          className={`
            relative flex items-center rounded-lg transition-fast mb-1 mx-1.5
            ${activeModule === "home"
              ? "bg-accent/15 text-accent"
              : "text-nv-muted hover:bg-nv-surface2 hover:text-nv-text"}
          `}
          style={{ height: "36px", padding: "0 8px" }}
        >
          {activeModule === "home" && (
            <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
          )}
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", position: "relative" }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
                <path d="M3 12L12 3l9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 21V12h6v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M5 10v11h14V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            <span
              className="font-sans text-xs font-medium whitespace-nowrap text-left"
              style={{
                opacity: expanded ? 1 : 0,
                maxWidth: expanded ? "100px" : 0,
                overflow: "hidden",
                marginLeft: expanded ? "8px" : 0,
                flex: "none",
                transition: "opacity 0.12s 0.06s, max-width 0.18s, margin-left 0.18s",
                pointerEvents: "none",
              }}
            >
              Home
            </span>
          </span>
        </button>
        <div className="h-px bg-nv-border mb-1 mx-3" />

        {MODULES.map((m) => {
          const isActive = m.id === activeModule;
          const effectiveStatus = (m.id === "mesh" && meshSessionActive) ? "active" as const : m.status;
          return (
            <button
              key={m.id}
              id={m.id === 'krew' ? 'tour-nav-krew' : undefined}
              onClick={() => onModuleChange(m.id as Module)}
              title={m.label}
              aria-label={m.label}
              className={`
                relative flex items-center rounded-lg transition-fast mx-1.5
                ${isActive
                  ? "bg-accent/15 text-accent"
                  : "text-nv-muted hover:bg-nv-surface2 hover:text-nv-text"
                }
              `}
              style={{ height: "36px", padding: "0 8px", justifyContent: expanded ? "flex-start" : "center" }}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
              )}
              {/* Icon — always centered when collapsed */}
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0 }}>
                {m.icon}
              </span>
              {/* Label — takes space only when expanded */}
              <span
                className="font-sans text-xs font-medium whitespace-nowrap text-left"
                style={{
                  opacity: expanded ? 1 : 0,
                  maxWidth: expanded ? "100px" : 0,
                  overflow: "hidden",
                  marginLeft: expanded ? "8px" : 0,
                  flex: "none",
                  transition: "opacity 0.12s 0.06s, max-width 0.18s, margin-left 0.18s",
                  pointerEvents: "none",
                }}
              >
                {SHORT_LABEL[m.id] ?? m.id}
              </span>
              {/* Spacer when expanded */}
              {expanded && <span style={{ flex: 1 }} />}
              {/* Status dot + label */}
              <span
                className="flex items-center gap-1 shrink-0"
                style={expanded ? {} : { position: "absolute", bottom: 5, right: 5 }}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[effectiveStatus]}`} title={`${STATUS_LABEL[effectiveStatus]} — ${m.label}`} />
                <span
                  className={`text-[8px] font-mono ${STATUS_TEXT[effectiveStatus]}`}
                  style={{
                    opacity: expanded ? 1 : 0,
                    maxWidth: expanded ? "50px" : 0,
                    overflow: "hidden",
                    transition: "opacity 0.12s 0.06s, max-width 0.18s",
                    whiteSpace: "nowrap",
                  }}
                >
                  {STATUS_LABEL[effectiveStatus]}
                </span>
              </span>
            </button>
          );
        })}

        {/* Head admin module — only visible to head users */}
        {profile?.admin_level === 'head' && (
          <>
            <div className="h-px bg-nv-border my-1 mx-3" />
            <button
              onClick={() => onModuleChange('head')}
              title="Head Dashboard"
              aria-label="Head Dashboard"
              className={`
                relative flex items-center rounded-lg transition-fast mx-1.5
                ${activeModule === 'head'
                  ? 'bg-accent/15 text-accent'
                  : 'text-nv-muted hover:bg-nv-surface2 hover:text-nv-text'
                }
              `}
              style={{ height: '36px', padding: '0 8px', justifyContent: expanded ? 'flex-start' : 'center' }}
            >
              {activeModule === 'head' && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" />
              )}
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, flexShrink: 0 }}>
                <svg viewBox="0 0 20 20" fill="none" style={{ width: 14, height: 14 }}>
                  <path d="M10 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L10 14.5l-4.8 2.4.9-5.4L2.2 7.7l5.4-.8L10 2z" fill="currentColor"/>
                </svg>
              </span>
              <span
                className="font-sans text-xs font-medium whitespace-nowrap text-left"
                style={{
                  opacity: expanded ? 1 : 0,
                  maxWidth: expanded ? '100px' : 0,
                  overflow: 'hidden',
                  marginLeft: expanded ? '8px' : 0,
                  flex: 'none',
                  transition: 'opacity 0.12s 0.06s, max-width 0.18s, margin-left 0.18s',
                  pointerEvents: 'none',
                }}
              >
                Head
              </span>
              {expanded && <span style={{ flex: 1 }} />}
              <span
                className="flex items-center gap-1 shrink-0"
                style={expanded ? {} : { position: 'absolute', bottom: 5, right: 5 }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-nv-green" title="Admin" />
                <span
                  className="text-[8px] font-mono text-nv-green"
                  style={{
                    opacity: expanded ? 1 : 0,
                    maxWidth: expanded ? '50px' : 0,
                    overflow: 'hidden',
                    transition: 'opacity 0.12s 0.06s, max-width 0.18s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Admin
                </span>
              </span>
            </button>
          </>
        )}
      </nav>

      {/* Bottom — theme toggle + settings + avatar */}
      <div
        className="flex border-t border-nv-border"
        style={{
          flexDirection: expanded ? "row" : "column",
          alignItems: "center",
          justifyContent: expanded ? "space-between" : "center",
          padding: expanded ? "10px 10px" : "10px 0",
          gap: "6px",
          transition: "padding 0.18s",
        }}
      >
        {/* Theme toggle */}
        <button
          id="tour-theme-toggle"
          onClick={toggle}
          title={paper ? "Switch to Ink (dark)" : "Switch to Paper (light)"}
          aria-label="Toggle theme"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-nv-muted hover:bg-nv-surface2 hover:text-nv-text transition-fast shrink-0"
        >
          {paper ? <InkIcon /> : <PaperIcon />}
        </button>

        {/* Settings */}
        <button
          title="Settings"
          onClick={() => onModuleChange("settings")}
          aria-label="Settings"
          className={`w-8 h-8 flex items-center justify-center rounded-lg transition-fast shrink-0 ${
            activeModule === "settings"
              ? "bg-accent/15 text-accent"
              : "text-nv-muted hover:bg-nv-surface2 hover:text-nv-text"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>

        {/* Feedback / Suggest */}
        <button
          title="Suggest or report"
          onClick={() => setShowFeedback(true)}
          aria-label="Suggest or report"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-fast shrink-0 text-nv-muted hover:bg-nv-surface2 hover:text-nv-text"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>

        {/* User avatar */}
        <button
          title="Account"
          onClick={() => onModuleChange("account")}
          className={`shrink-0 rounded-full flex items-center justify-center text-accent text-xs font-semibold transition-fast ${
            activeModule === "account"
              ? "bg-accent/30 ring-1 ring-accent/60"
              : "bg-accent/20 hover:bg-accent/30"
          }`}
          style={{ width: 32, height: 32 }}
        >
          {initial}
        </button>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </aside>
  );
}

function PaperIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function InkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
