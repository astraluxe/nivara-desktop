// ─── adris.tech IS FREE (Oct 2026) ───────────────────────────────────────────
//
// This window used to sell the paid tiers and open Razorpay. The hosted plan is retired: there is
// no adris.tech key, nothing in the app costs adris.tech anything, and so there is nothing to sell.
// Every feature is unlocked for everyone (see FREE_FOR_ALL in lib/planConfig.ts).
//
// The props are kept exactly as they were so every screen that opens this still compiles and still
// has somewhere sensible to send the user — which is now one of two places: connect an AI, or ask
// for a custom adris / agentic AI office built for their business.

interface Props {
  onClose:       () => void;
  currentPlan:   string;
  highlightPlan?: string;
  reason?:       string;
}

export const CONTACT_URL = "https://www.adris.tech/contact";

async function openExternal(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch { window.open(url, "_blank"); }
}

export default function UpgradeModal({ onClose }: Props) {
  const connect = () => {
    // The title-bar AI menu is always mounted; this opens it. (A plain string rather than an import
    // from AiSourceMenu keeps this small window free of that module's dependencies.)
    try { window.dispatchEvent(new CustomEvent("nv-open-ai-menu")); } catch { /* ignore */ }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-nv-border bg-nv-bg shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-modal-title"
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 id="free-modal-title" className="text-lg font-semibold text-nv-text">adris.tech is free</h2>
          <button onClick={onClose} aria-label="Close" className="text-nv-faint hover:text-nv-text transition-fast text-xl leading-none">×</button>
        </div>

        <p className="text-sm text-nv-muted leading-relaxed mb-4">
          There are no plans to buy — every module is unlocked. adris thinks with the AI you connect:
          a free <b className="text-nv-text">NVIDIA</b> or <b className="text-nv-text">Groq</b> key,
          your own <b className="text-nv-text">Claude Code</b> or <b className="text-nv-text">Codex</b>,
          your own Gemini / OpenAI / Anthropic key, or a model running on this computer.
        </p>

        <button
          onClick={connect}
          className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition-fast mb-3"
        >
          Connect an AI
        </button>

        <div className="rounded-xl border border-nv-border p-4">
          <div className="text-sm font-semibold text-nv-text mb-1">Want a custom adris for your business?</div>
          <p className="text-[12px] text-nv-muted leading-relaxed mb-3">
            We build custom adris setups and agentic AI offices — agents, workflows and integrations
            designed around how your team works.
          </p>
          <button
            onClick={() => openExternal(CONTACT_URL)}
            className="w-full py-2 rounded-lg border border-accent/50 text-accent text-sm font-medium hover:bg-accent/10 transition-fast"
          >
            Request a custom build
          </button>
        </div>
      </div>
    </div>
  );
}
