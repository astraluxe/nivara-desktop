import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEntitlement } from '../lib/useEntitlement';
import { TIER_LABEL } from '../lib/entitlement';
import { useAuth } from "../contexts/AuthContext";
import AiSourceMenu from "./AiSourceMenu";

/**
 * THE BADGE USED TO SAY THE WRONG THING, IN TWO WAYS AT ONCE.
 *
 * It read "Free / Solo / Builder / Team" — names the pricing page does not use — and it sat inches
 * from a menu offering pay-per-use, so the two halves of the title bar described different
 * products. It also said only WHICH plan, never how much of it was left, which on a metered product
 * is the one number anybody actually wants.
 *
 * Now: the tier, and the tasks remaining, from the single loader every other screen reads. The
 * names come from lib/entitlement.ts so the app and the website cannot drift apart.
 */
function PlanBadge({ onOpen }: { onOpen: () => void }) {
  const ent = useEntitlement();
  if (ent.loading) return null;

  const left = ent.left;
  const tasks = left.unlimited ? null : left.tasksLeft;
  // Amber once four fifths are gone, red once nothing is left. A meter that only turns red at zero
  // gives no warning at all.
  const tone = left.anyExhausted ? 'exhausted' : left.spent >= 0.8 ? 'low' : 'ok';
  const colour =
    tone === 'exhausted' ? 'bg-nv-red/10 border-nv-red/30 text-nv-red'
    : tone === 'low'      ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
    : 'bg-accent/10 border-accent/25 text-accent/90';

  const title = [
    `${TIER_LABEL[ent.tier]} plan`,
    left.unlimited ? 'Unlimited (fair use)' : `${left.tasksLeft.toLocaleString('en-IN')} AI tasks left this month`,
    `Resets in ${ent.resetsInDays} day${ent.resetsInDays === 1 ? '' : 's'}`,
    ent.state === 'grace' ? 'Last checked a while ago — you are offline, nothing is wrong' : '',
    'Your own key and local models are never counted',
  ].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onOpen}
      title={title}
      className={`text-[10px] font-mono px-2 py-[3px] rounded-full uppercase tracking-[0.14em]
                  border transition-fast hover:brightness-110 ${colour}`}
    >
      {TIER_LABEL[ent.tier]}
      {tasks !== null && <span className="normal-case tracking-normal opacity-80"> · {compact(tasks)} left</span>}
      {ent.state === 'grace' && <span className="opacity-60" title="offline"> ·</span>}
    </button>
  );
}

/** 12,400 → "12.4k". A badge has room for a number, not for a paragraph. */
function compact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

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

      {/* Right — the bridge, plan badge, window controls */}
      <div className="flex items-center gap-3 pr-2">
        <AiSourceMenu />
        {profile && <PlanBadge onOpen={() => window.dispatchEvent(new CustomEvent('nv-navigate', { detail: 'account' }))} />}

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
