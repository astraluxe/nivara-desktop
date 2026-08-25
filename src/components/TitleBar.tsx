import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuth } from "../contexts/AuthContext";

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
      /* A hairline of light along the top edge and a gradient that fades downward: the two things
         that make a title bar read as the lid of the window rather than a strip of the same colour
         with a line under it. */
      className="relative flex items-center h-10 shrink-0 select-none cursor-default
                 border-b border-nv-border
                 bg-gradient-to-b from-nv-surface2/70 to-nv-bg
                 before:absolute before:inset-x-0 before:top-0 before:h-px
                 before:bg-white/[0.06] before:pointer-events-none"
      onMouseDown={handleMouseDown}
    >
      {/* Left — branding */}
      <div className="flex items-center gap-2.5 px-3.5 pointer-events-none">
        <AppLogo />
        <span className="text-nv-text text-[13px] font-semibold tracking-[-0.01em]">adris.tech</span>
        {/* The module name is set apart by a full-height rule rather than a slash, so the eye reads
            "app | where you are" instead of one run-on string. */}
        <span className="w-px h-3.5 bg-nv-border" />
        <span className="text-nv-muted text-[11px] tracking-wide">{MODULES[activeModule] ?? activeModule}</span>
      </div>

      <div className="flex-1" />

      {/* Right — plan badge + window controls */}
      <div className="flex items-center gap-3 pr-2">
        {profile && (
          <span className="text-[10px] font-mono px-2 py-[3px] rounded-full uppercase tracking-[0.14em]
                           bg-accent/10 border border-accent/25 text-accent/90 pointer-events-none">
            {PLAN_LABEL[profile.plan ?? 'free'] ?? profile.plan}
          </span>
        )}

        <div className="flex items-center gap-0.5">
          <WinBtn
            onClick={async () => { try { await getCurrentWindow().minimize(); } catch {} }}
            label="Minimize"
            className="hover:bg-nv-surface2 hover:text-nv-text"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </WinBtn>
          <WinBtn
            onClick={async () => { try { await getCurrentWindow().toggleMaximize(); } catch {} }}
            label="Maximize"
            className="hover:bg-nv-surface2 hover:text-nv-text"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="2.5" y="2.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </WinBtn>
          <WinBtn
            onClick={async () => { try { await getCurrentWindow().hide(); } catch {} }}
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
      className={`w-8 h-8 flex items-center justify-center rounded-nv-sm text-nv-faint
                  transition-colors duration-fast ease-nv ${className}`}
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
