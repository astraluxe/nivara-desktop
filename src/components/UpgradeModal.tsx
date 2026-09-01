import { useState, useEffect } from "react";
import { getPlanConfig } from "../lib/planConfig";
import { ALLOWANCE, PRICE, TIER_LABEL, rupees, type Tier } from "../lib/entitlement";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";


interface Plan {
  key:        string;
  label:      string;
  price:      string;
  paise:      number;
  sub:        string;
  tokens:     string;
  prevTokens?: string;  // old value — shown struck-through to highlight the increase
  features:   string[];
  accent:     boolean;
}

// ── ONE SET OF NUMBERS, SHARED WITH THE PRICING PAGE ────────────────────────
//
// This list used to carry its own prices, and they had drifted a long way: Business at ₹9,999 and
// Growth at ₹19,999, while adris.tech/pricing sold them at ₹6,499 and ₹12,999 — and Starter, the
// five-seat tier that exists precisely for the firms this window is shown to, was missing
// altogether. Payments are locked so nobody was charged the wrong amount, but a customer reading
// one price in the product and another on the site cannot tell which is real.
//
// It also advertised "Single sign-on + admin controls". There is no SAML, no OIDC and no identity
// provider; that claim was removed from the website for exactly that reason, and selling it here
// instead is the same untruth in a smaller window.
//
// So the figures come from lib/entitlement.ts, which is what the pricing page is generated from.
//
// THE KEYS ARE NOT THE LABELS. razorpay-webhook's PAID_PLANS is solo / builder / business — those
// are what the webhook matches on when it writes `plan` after a payment, so renaming one would stop
// it recognising the plan it had just taken money for. The label is what the buyer reads; the key
// is plumbing and stays put.
const tokensLine = (t: Tier) => `~${Math.round(ALLOWANCE[t].tokens / 1000).toLocaleString('en-IN')}k tokens / month`;
const seatsLine  = (t: Tier) => `${ALLOWANCE[t].seats} seats · ${ALLOWANCE[t].meshDevices} Mesh devices`;
const runsLine   = (t: Tier) => `${ALLOWANCE[t].runs.toLocaleString('en-IN')} cloud automations`;

const PLANS: Plan[] = [
  {
    key:        "starter",
    label:      TIER_LABEL.starter,
    price:      rupees(PRICE.starter!.monthly),
    paise:      PRICE.starter!.monthly * 100,
    sub:        "/ month",
    tokens:     "~4,000 tasks / month",
    features:   ["All 8 modules, in full", tokensLine('starter'), runsLine('starter'), seatsLine('starter'), "Guard security scanner"],
    accent:     false,
  },
  {
    key:        "solo",
    label:      TIER_LABEL.business,
    price:      rupees(PRICE.business!.monthly),
    paise:      PRICE.business!.monthly * 100,
    sub:        "/ month",
    tokens:     "~8,000 tasks / month",
    prevTokens: "~300 tasks, one time",
    features:   ["Everything in Starter", tokensLine('business'), runsLine('business'), seatsLine('business'), "Team workspace"],
    accent:     true,
  },
  {
    key:        "builder",
    label:      TIER_LABEL.growth,
    price:      rupees(PRICE.growth!.monthly),
    paise:      PRICE.growth!.monthly * 100,
    sub:        "/ month",
    tokens:     "~25,000 tasks / month",
    prevTokens: "~8,000 tasks / month",
    features:   ["Everything in Business", tokensLine('growth'), runsLine('growth'), seatsLine('growth'), "Priority support, direct to the founder"],
    accent:     false,
  },
  {
    key:      "custom",
    label:    TIER_LABEL.enterprise,
    price:    "Contact us",
    paise:    0,
    sub:      "",
    tokens:   "Fair-use, uncapped",
    features: ["Everything in Growth", "Dedicated infrastructure", "Custom integrations", "SLA"],
    accent:   false,
  },
];


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
  const [sentToSite, setSentToSite] = useState(false);
  const [checking,   setChecking]   = useState(false);

  const plan = PLANS.find(p => p.key === selected)!;

  // Never invite someone to pay for something they already have.
  //
  // The plan is granted server-side by the Razorpay webhook while the user is off paying in their
  // browser. If the app's cached profile is stale (a dropped realtime channel, a laptop that
  // slept), a paid customer was still shown the upgrade screen — which is how someone ends up
  // paying twice. Ask the server on open and say so plainly instead.
  const [serverPlan, setServerPlan] = useState<string | null>(null);
  useEffect(() => {
    if (!session?.user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
        if (!cancelled) setServerPlan(String(data?.plan ?? ''));
      } catch { /* offline — fall through to the normal screen */ }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);
  const alreadyPaid = !!serverPlan && !['free', 'explore', ''].includes(serverPlan);
  const staleView = alreadyPaid && ['free', 'explore'].includes(currentPlan);

  // ── Watch for the upgrade landing, without the user having to press anything ────────────
  //
  // The webhook grants the plan seconds after the card is charged, but the app only found out
  // when the realtime channel happened to be alive, or when the window regained focus (a 20s
  // debounce), or when the user pressed "Check". So someone could be sitting in front of a paid
  // account still being told to upgrade — which is exactly the moment people panic and pay twice.
  //
  // Once we've handed off to the site, poll every 3s for 5 minutes. It only runs while this modal
  // is open and the user is mid-payment, so it costs nothing the rest of the time (this app's
  // Supabase disk-IO budget has been hurt by a background interval before).
  useEffect(() => {
    if (!sentToSite || !session?.user || done) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop || Date.now() - started > 5 * 60_000) return;
      try {
        const { data } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
        const p = String(data?.plan ?? '');
        if (p && !['free', 'explore'].includes(p)) {
          stop = true;
          await refreshSession();          // push it into the rest of the app immediately
          setDone(true);
          setTimeout(onClose, 1800);
          return;
        }
      } catch { /* offline blip — keep waiting */ }
      if (!stop) timer = setTimeout(tick, 3000);
    };
    let timer = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(timer); };
  }, [sentToSite, session?.user?.id, done]);


  // Payment happens on the WEBSITE, never inside this app — deliberately.
  //
  // Razorpay Checkout is a hosted script that expects a real browser; loading it inside the Tauri
  // webview is what made the Pay button appear to do nothing. More importantly, a desktop build is
  // a file on someone's disk: anything it decides about entitlement can be tampered with. So the
  // exe never handles money and never grants a plan. It hands off to the site, Razorpay charges
  // the card, and Razorpay's server-to-server webhook is the ONLY thing that writes `plan` in the
  // database (the billing columns are protected against client writes). The app just re-reads what
  // the server says. A faked "payment" in a patched exe therefore changes nothing.
  // CHECKOUT IS NOT OPEN YET.
  //
  // The plans are published but self-serve payment is not built (L6/L7), so this opens the pricing
  // page at the request form rather than at a checkout that is not there. Sending someone to hunt
  // for a Pay button that does not exist is worse than telling them plainly.
  async function handleSubscribe() {
    if (!session) return;
    setErrMsg(null);
    setPaying(true);
    try {
      const email = session.user.email ?? '';
      // www, not the apex — the apex 307-redirects and drops params/headers on the way.
      const url = `https://www.adris.tech/pricing.html?plan=${encodeURIComponent(selected)}#pilot`
        + (email ? `&email=${encodeURIComponent(email)}` : '')
        + '&from=app';
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      setSentToSite(true);
    } catch {
      // Shell open unavailable (unlikely) — show the address so the user can still get there.
      setErrMsg('Could not open your browser. Go to www.adris.tech/pricing and sign in with this same email to upgrade.');
    } finally {
      setPaying(false);
    }
  }

  /**
   * After paying on the site, ask the SERVER what plan it now has.
   *
   * Queries the row directly rather than reading `profile` from React state: setProfile inside
   * refreshSession does not update this closure's `profile` variable, so checking it here would
   * always still see the old plan and wrongly tell a paying customer nothing had come through.
   */
  async function recheckPlan() {
    if (!session?.user) return;
    setChecking(true);
    setErrMsg(null);
    let plan = 'free';
    for (let i = 0; i < 4; i++) {
      try {
        const { data } = await supabase.from('users').select('plan').eq('id', session.user.id).single();
        plan = String(data?.plan ?? 'free');
      } catch { /* network hiccup — try again below */ }
      if (plan && plan !== 'free' && plan !== 'explore') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await refreshSession();   // push the confirmed plan into the rest of the app
    setChecking(false);
    if (plan && plan !== 'free' && plan !== 'explore') { setDone(true); setTimeout(onClose, 1500); }
    else setErrMsg('No payment showing on your account yet — it can take a minute after paying. Press Check again, or make sure you paid while signed in as ' + (session.user.email ?? 'this same email') + '.');
  }

  if (staleView) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="w-full max-w-sm rounded-2xl border p-7 flex flex-col items-center gap-3 text-center" style={{ background: 'var(--nv-bg)', borderColor: 'var(--nv-rule)' }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none"><path d="M5 11l4.5 4.5L17 7" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <h3 className="text-[16px] font-semibold text-nv-text">You're already on {serverPlan!.charAt(0).toUpperCase() + serverPlan!.slice(1)}</h3>
          <p className="text-[12px] text-nv-muted leading-relaxed">
            Your payment came through — this app just hadn't picked it up yet. Nothing more to pay.
          </p>
          <button onClick={async () => { await refreshSession(); onClose(); }}
            className="mt-1 w-full py-2.5 rounded-xl text-[12.5px] font-semibold" style={{ background: '#7C5CFF', color: '#fff' }}>
            Continue
          </button>
        </div>
      </div>
    );
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
              <div className="text-[9px] font-mono mt-2 pb-2 border-b" style={{ borderColor: "var(--nv-rule)" }}>
                {p.prevTokens && (
                  <span className="line-through text-nv-faint mr-1.5">{p.prevTokens}</span>
                )}
                <span className={p.prevTokens ? "text-nv-green font-semibold" : "text-nv-muted"}>{p.tokens}</span>
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
                ? 'Opening your browser…'
                : sentToSite
                  ? `Reopen checkout in browser`
                  : `Pay in browser — ${plan.label} ${plan.price}/mo`}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={paying}
            className="px-4 py-3 rounded-xl text-[12px] border transition-colors hover:opacity-80 disabled:opacity-40"
            style={{ borderColor: "var(--nv-rule)", color: "var(--nv-muted)" }}
          >Keep {currentPlan}</button>
        </div>

        {/* Payment happens on the website — say so plainly, and give them the way back. */}
        {sentToSite && (
          <div className="px-6 pb-3">
            <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: 'rgba(124,92,255,0.4)', background: 'rgba(124,92,255,0.07)' }}>
              <p className="text-[11.5px] text-nv-text font-medium mb-1.5">Finish paying in your browser</p>
              <ul className="text-[11px] text-nv-muted leading-[1.7] mb-2.5 list-disc pl-4">
                <li>Sign in there with <span className="text-nv-text">{session?.user.email ?? 'this same email'}</span> — the plan is tied to that account.</li>
                <li>Complete the Razorpay payment on the page that opened.</li>
                <li>Come back here and press Check — your plan updates automatically.</li>
              </ul>
              <button
                onClick={recheckPlan}
                disabled={checking}
                className="w-full py-2 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: '#7C5CFF', color: '#fff' }}
              >
                {checking && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" />}
                {checking ? 'Checking your account…' : "I've paid — check my plan"}
              </button>
            </div>
          </div>
        )}

        <div className="px-6 pb-4 text-[10px] text-nv-faint text-center">
          Payment is completed on adris.tech, secured by Razorpay · INR only · Cancel anytime
        </div>
      </div>
    </div>
  );
}
