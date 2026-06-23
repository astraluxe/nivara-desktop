import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuth } from "../contexts/AuthContext";

const IS_LINUX = navigator.userAgent.toLowerCase().includes('linux');

const PLAN_LABEL: Record<string, string> = {
  free: "Free", explore: "Free", solo: "Solo",
  builder: "Builder", business: "Team", custom: "Custom",
};

const MODULES: Record<string, string> = {
  coder:    "Coder · dev terminal",
  connect:  "Connect Apps · integrations",
  models:   "Models · open hub",
  vault:    "Vault · VPN",
  guard:    "Guard · security",
  mesh:     "Mesh · RAM pooling",
  settings: "Settings",
};

export default function TitleBar({ activeModule }: { activeModule: string }) {
  const { profile } = useAuth();

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    getCurrentWindow().startDragging();
  }

  return (
    <div
      className="flex items-center h-10 bg-nv-bg border-b border-nv-border shrink-0 select-none cursor-default"
      onMouseDown={handleMouseDown}
    >
      {/* Left — branding */}
      <div className="flex items-center gap-2 px-4 pointer-events-none">
        <AppLogo />
        <span className="text-nv-text text-sm font-semibold tracking-tight">adris.tech</span>
        <span className="text-nv-faint text-xs font-mono">/</span>
        <span className="text-nv-muted text-xs font-mono">{MODULES[activeModule] ?? activeModule}</span>
      </div>

      <div className="flex-1" />

      {/* Right — plan badge + window controls */}
      <div className="flex items-center gap-3 pr-2">
        {profile && (
          <span className="text-xs font-mono px-2 py-0.5 rounded border border-nv-border text-nv-muted uppercase tracking-widest pointer-events-none">
            {PLAN_LABEL[profile.plan ?? 'free'] ?? profile.plan}
          </span>
        )}

        <div className="flex items-center gap-0.5">
          <WinBtn
            onClick={async () => { try { await getCurrentWindow().minimize(); } catch {} }}
            label="Minimize"
            className="hover:bg-nv-surface2"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </WinBtn>
          <WinBtn
            onClick={async () => { try { await getCurrentWindow().toggleMaximize(); } catch {} }}
            label="Maximize"
            className="hover:bg-nv-surface2"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </WinBtn>
          <WinBtn
            onClick={async () => {
              try {
                // On Linux there's no system tray to restore from — close for real
                if (IS_LINUX) { await getCurrentWindow().close(); }
                else { await getCurrentWindow().hide(); }
              } catch {}
            }}
            label="Close"
            className="hover:bg-nv-red hover:text-white"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </WinBtn>
        </div>
      </div>
    </div>
  );
}

function WinBtn({
  onClick, label, children, className,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`w-8 h-8 flex items-center justify-center rounded text-nv-muted transition-fast ${className}`}
    >
      {children}
    </button>
  );
}

function AppLogo() {
  return (
    <svg width="16" height="15" viewBox="0 0 26 24" fill="none" aria-hidden="true">
      <path d="M2 4 L9 4 L15 12 L9 20 L2 20 L8 12 Z" fill="#7C5CFF" />
      <path d="M12 4 L19 4 L25 12 L19 20 L12 20 L18 12 Z" fill="#7C5CFF" opacity="0.6" />
    </svg>
  );
}
