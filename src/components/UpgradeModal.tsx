import { useState } from "react";
import { getPlanConfig } from "../lib/planConfig";

// ── Payment links — fill these in when Razorpay payment links are created ──────
// Create links at https://dashboard.razorpay.com/app/payment-links
// Set the product name to "Nivara" and enable INR
const PAYMENT_LINKS: Record<string, string> = {
  solo:    "",   // e.g. "https://rzp.io/l/nivara-solo"
  growth:  "",   // e.g. "https://rzp.io/l/nivara-growth"
  builder: "",   // e.g. "https://rzp.io/l/nivara-builder"
  pro:     "",   // e.g. "https://rzp.io/l/nivara-pro"
};

interface Plan {
  key:      string;
  label:    string;
  price:    string;
  sub:      string;
  tokens:   string;
  features: string[];
  accent:   boolean;
}

const PLANS: Plan[] = [
  {
    key:      "solo",
    label:    "Solo",
    price:    "₹299",
    sub:      "/ month",
    tokens:   "2M tokens / month",
    features: ["All 6 modules", "BYOK + Nivara AI", "20 cloud automations", "Priority support"],
    accent:   false,
  },
  {
    key:      "growth",
    label:    "Growth",
    price:    "₹599",
    sub:      "/ month",
    tokens:   "2M tokens / month",
    features: ["Everything in Solo", "Mesh (join sessions)", "100 cloud automations", "Guard security"],
    accent:   false,
  },
  {
    key:      "builder",
    label:    "Builder",
    price:    "₹999",
    sub:      "/ month",
    tokens:   "10M tokens / month",
    features: ["Everything in Growth", "Voice to Code", "Mesh hosting", "500 automations", "Contract scanning"],
    accent:   true,
  },
  {
    key:      "pro",
    label:    "Pro",
    price:    "₹2,499",
    sub:      "/ month",
    tokens:   "Unlimited tokens",
    features: ["Everything in Builder", "10 Mesh devices", "Unlimited automations", "Audit export", "Priority queue"],
    accent:   false,
  },
];

interface Props {
  onClose:     () => void;
  currentPlan: string;
  highlightPlan?: string;
  reason?:     string;
}

export default function UpgradeModal({ onClose, currentPlan, highlightPlan, reason }: Props) {
  const [selected, setSelected]   = useState(highlightPlan ?? "builder");
  const [contacted, setContacted] = useState(false);

  function handleSubscribe() {
    const link = PAYMENT_LINKS[selected];
    if (link) {
      window.open(link, "_blank");
    } else {
      // Payment links not yet configured — open email
      const subject = encodeURIComponent(`Upgrade to Nivara ${PLANS.find(p => p.key === selected)?.label ?? selected}`);
      const body    = encodeURIComponent(`Hi,\n\nI'd like to upgrade my Nivara plan to ${selected}.\n\nEmail: \nCurrent plan: ${currentPlan}\n`);
      window.open(`mailto:astraluxe.tech@gmail.com?subject=${subject}&body=${body}`, "_blank");
      setContacted(true);
    }
  }

  const paymentReady = !!PAYMENT_LINKS[selected];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border overflow-hidden"
        style={{ background: "var(--nv-bg)", borderColor: "var(--nv-rule)" }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-nv-text tracking-tight">Upgrade Nivara</h2>
            {reason && (
              <p className="text-[12px] text-nv-muted mt-1">{reason}</p>
            )}
            <p className="text-[11px] font-mono mt-1" style={{ color: "var(--accent)" }}>
              Current plan: {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · {getPlanConfig(currentPlan).label}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-nv-faint hover:text-nv-text transition-colors text-lg leading-none ml-4 mt-0.5"
          >✕</button>
        </div>

        {/* Plan grid */}
        <div className="px-6 pb-5 grid grid-cols-4 gap-3">
          {PLANS.map(plan => (
            <button
              key={plan.key}
              onClick={() => setSelected(plan.key)}
              className="rounded-xl border p-3 text-left transition-all"
              style={{
                borderColor: selected === plan.key
                  ? (plan.accent ? "#7C5CFF" : "rgba(124,92,255,0.5)")
                  : "var(--nv-rule)",
                background: selected === plan.key
                  ? (plan.accent ? "rgba(124,92,255,0.08)" : "rgba(124,92,255,0.04)")
                  : "var(--nv-surface)",
                outline: "none",
              }}
            >
              {plan.accent && (
                <div
                  className="text-[8px] font-mono uppercase tracking-wider font-bold mb-1.5 px-1.5 py-0.5 rounded inline-block"
                  style={{ background: "#7C5CFF", color: "#fff" }}
                >Popular</div>
              )}
              <div className="text-[13px] font-semibold text-nv-text">{plan.label}</div>
              <div className="font-mono text-[15px] font-bold mt-1" style={{ color: "#7C5CFF" }}>{plan.price}</div>
              <div className="text-[9px] text-nv-faint">{plan.sub}</div>
              <div className="text-[9px] font-mono text-nv-muted mt-2 pb-2 border-b" style={{ borderColor: "var(--nv-rule)" }}>
                {plan.tokens}
              </div>
              <ul className="mt-2 space-y-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="text-[10px] text-nv-muted flex items-start gap-1">
                    <span style={{ color: "#10B981", flexShrink: 0 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pb-6 flex items-center gap-4">
          <button
            onClick={handleSubscribe}
            className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ background: "#7C5CFF", color: "#fff" }}
          >
            {paymentReady
              ? `Subscribe to ${PLANS.find(p => p.key === selected)?.label} — ${PLANS.find(p => p.key === selected)?.price}/mo`
              : contacted
                ? "Email sent — we'll be in touch!"
                : `Contact us to upgrade to ${PLANS.find(p => p.key === selected)?.label}`}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl text-[12px] border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--nv-rule)", color: "var(--nv-muted)" }}
          >Keep {currentPlan}</button>
        </div>

        {!paymentReady && (
          <div className="px-6 pb-4 text-[10px] text-nv-faint text-center">
            Payment gateway launching soon · We'll set up your plan manually within 24 hours
          </div>
        )}
      </div>
    </div>
  );
}
