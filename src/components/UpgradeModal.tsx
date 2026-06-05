import { useState } from "react";
import { getPlanConfig } from "../lib/planConfig";
import { useAuth } from "../contexts/AuthContext";

const SUPABASE_URL = 'https://xkkqcqsacgdrfwbwdqsp.supabase.co';

interface Plan {
  key:      string;
  label:    string;
  price:    string;
  paise:    number;  // price in paise — update when plan prices are decided
  sub:      string;
  tokens:   string;
  features: string[];
  accent:   boolean;
}

const PLANS: Plan[] = [
  {
    key:      "solo",
    label:    "Solo",
    price:    "₹1,499",
    paise:    149900,
    sub:      "/ month",
    tokens:   "~2,000 tasks / month",
    features: ["All 6 modules", "2M tokens/mo", "500 cloud automations", "10 Mesh devices"],
    accent:   false,
  },
  {
    key:      "builder",
    label:    "Builder",
    price:    "₹4,999",
    paise:    499900,
    sub:      "/ month",
    tokens:   "~8,000 tasks / month",
    features: ["Everything in Solo", "8M tokens/mo", "5,000 cloud automations", "25 Mesh devices + relay nodes", "Voice to Code"],
    accent:   true,
  },
  {
    key:      "business",
    label:    "Business",
    price:    "₹14,999",
    paise:    1499900,
    sub:      "/ month",
    tokens:   "~30,000 tasks / month",
    features: ["Everything in Builder", "30M tokens/mo", "Unlimited automations", "50 Mesh devices", "Guard + Audit export"],
    accent:   false,
  },
  {
    key:      "custom",
    label:    "Custom",
    price:    "Contact us",
    paise:    0,
    sub:      "",
    tokens:   "Unlimited tokens",
    features: ["Everything in Business", "Dedicated infra", "Custom integrations", "SLA & priority support"],
    accent:   false,
  },
];

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay checkout'));
    document.head.appendChild(s);
  });
}

interface Props {
  onClose:       () => void;
  currentPlan:   string;
  highlightPlan?: string;
  reason?:       string;
}

export default function UpgradeModal({ onClose, currentPlan, highlightPlan, reason }: Props) {
  const { session, refreshSession } = useAuth();
  const [selected,  setSelected]  = useState(highlightPlan ?? "builder");
  const [paying,    setPaying]    = useState(false);
  const [done,      setDone]      = useState(false);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  const plan = PLANS.find(p => p.key === selected)!;

  async function handleSubscribe() {
    if (!session) return; // should never happen — modal only shown when logged in
    setErrMsg(null);
    setPaying(true);

    try {
      await loadRazorpayScript();

      // Create order server-side (login required — JWT verified by Edge Function)
      const res = await fetch(`${SUPABASE_URL}/functions/v1/razorpay-create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan: selected }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setErrMsg(data.error ?? 'Failed to create payment order. Try again.');
        setPaying(false);
        return;
      }

      // Open Razorpay Checkout modal
      const rzp = new window.Razorpay({
        key:         data.key_id,
        order_id:    data.order_id,
        amount:      data.amount,
        currency:    data.currency,
        name:        'adris.tech',
        description: `${plan.label} plan — ${plan.price}/month`,
        prefill: {
          email: session.user.email ?? '',
        },
        theme: { color: '#7C5CFF' },
        modal: { ondismiss: () => setPaying(false) },
        handler: async () => {
          // Payment captured — webhook will update DB; refresh profile to pick it up
          setDone(true);
          // Poll up to 6s for plan update
          for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 2000));
            await refreshSession();
          }
          setTimeout(onClose, 1000);
        },
      });
      rzp.open();

    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setPaying(false);
    }
  }

  if (done) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      >
        <div
          className="w-full max-w-sm rounded-2xl border p-8 flex flex-col items-center gap-4 text-center"
          style={{ background: "var(--nv-bg)", borderColor: "var(--nv-rule)" }}
        >
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M5 11l4.5 4.5L17 7" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 className="text-[17px] font-semibold text-nv-text">Payment successful!</h3>
          <p className="text-[12px] text-nv-muted">
            Your <span className="text-nv-text font-semibold">{plan.label}</span> plan is activating. The app will update in a moment.
          </p>
          <div className="w-6 h-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin mt-1" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={e => { if (e.target === e.currentTarget && !paying) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border overflow-hidden"
        style={{ background: "var(--nv-bg)", borderColor: "var(--nv-rule)" }}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-nv-text tracking-tight">Upgrade adris.tech</h2>
            {reason && <p className="text-[12px] text-nv-muted mt-1">{reason}</p>}
            <p className="text-[11px] font-mono mt-1" style={{ color: "var(--accent)" }}>
              Current plan: {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} · {getPlanConfig(currentPlan).label}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={paying}
            className="text-nv-faint hover:text-nv-text transition-colors text-lg leading-none ml-4 mt-0.5 disabled:opacity-30"
          >✕</button>
        </div>

        {/* Plan grid */}
        <div className="px-6 pb-5 grid grid-cols-4 gap-3">
          {PLANS.map(p => (
            <button
              key={p.key}
              onClick={() => !paying && setSelected(p.key)}
              disabled={paying}
              className="rounded-xl border p-3 text-left transition-all disabled:opacity-60"
              style={{
                borderColor: selected === p.key
                  ? (p.accent ? "#7C5CFF" : "rgba(124,92,255,0.5)")
                  : "var(--nv-rule)",
                background: selected === p.key
                  ? (p.accent ? "rgba(124,92,255,0.08)" : "rgba(124,92,255,0.04)")
                  : "var(--nv-surface)",
                outline: "none",
              }}
            >
              {p.accent && (
                <div className="text-[8px] font-mono uppercase tracking-wider font-bold mb-1.5 px-1.5 py-0.5 rounded inline-block" style={{ background: "#7C5CFF", color: "#fff" }}>
                  Popular
                </div>
              )}
              <div className="text-[13px] font-semibold text-nv-text">{p.label}</div>
              <div className="font-mono text-[15px] font-bold mt-1" style={{ color: "#7C5CFF" }}>{p.price}</div>
              <div className="text-[9px] text-nv-faint">{p.sub}</div>
              <div className="text-[9px] font-mono text-nv-muted mt-2 pb-2 border-b" style={{ borderColor: "var(--nv-rule)" }}>
                {p.tokens}
              </div>
              <ul className="mt-2 space-y-1">
                {p.features.map((f, i) => (
                  <li key={i} className="text-[10px] text-nv-muted flex items-start gap-1">
                    <span style={{ color: "#10B981", flexShrink: 0 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {/* Error */}
        {errMsg && (
          <div className="mx-6 mb-3 px-3 py-2 rounded-lg text-[11px] text-red-400 bg-red-400/10 border border-red-400/20">
            {errMsg}
          </div>
        )}

        {/* CTA */}
        <div className="px-6 pb-6 flex items-center gap-4">
          {plan.paise === 0 ? (
            <a
              href="mailto:team@adris.tech?subject=Custom%20Plan%20Inquiry"
              className="flex-1 py-3 rounded-xl text-[13px] font-semibold text-center transition-opacity hover:opacity-90"
              style={{ background: "#7C5CFF", color: "#fff" }}
            >
              Contact us for Custom plan
            </a>
          ) : (
            <button
              onClick={handleSubscribe}
              disabled={paying || !session}
              className="flex-1 py-3 rounded-xl text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "#7C5CFF", color: "#fff" }}
            >
              {paying && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" />}
              {paying
                ? 'Opening payment…'
                : `Subscribe to ${plan.label} — ${plan.price}/mo`}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={paying}
            className="px-4 py-3 rounded-xl text-[12px] border transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ borderColor: "var(--nv-rule)", color: "var(--nv-muted)" }}
          >Keep {currentPlan}</button>
        </div>

        <div className="px-6 pb-4 text-[10px] text-nv-faint text-center">
          Payments secured by Razorpay · INR only · Cancel anytime
        </div>
      </div>
    </div>
  );
}
