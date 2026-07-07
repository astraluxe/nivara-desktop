import { useState } from "react";
import { supabase } from "../lib/supabase";

// Display-only price table (mirrors the server). The actual charge is computed
// server-side by the mesh-create-order Edge Function, so this can't be abused.
const BASE:     Record<string, number> = { hour: 15, day: 59, week: 179, month: 399 };
const EXTRA:    Record<string, number> = { hour: 2,  day: 6,  week: 18,  month: 40 };
const BASE_DEV: Record<string, number> = { hour: 5,  day: 10, week: 10,  month: 10 };
const DURS: { key: Dur; label: string }[] = [
  { key: "hour", label: "1 hour" }, { key: "day", label: "1 day" },
  { key: "week", label: "1 week" }, { key: "month", label: "1 month" },
];
type Dur = "hour" | "day" | "week" | "month";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function loadRazorpay(): Promise<boolean> {
  return new Promise((res) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return res(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(true);
    s.onerror = () => res(false);
    document.body.appendChild(s);
  });
}

export default function MeshBuyModal({ onClose, onPurchased }: {
  onClose: () => void;
  onPurchased?: (devices: number) => void;
}) {
  const [dur, setDur]         = useState<Dur>("hour");
  const [devices, setDevices] = useState(5);
  const [hours, setHours]     = useState(1);
  const [paying, setPaying]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  const baseDev = BASE_DEV[dur];
  const eff     = Math.max(devices, baseDev);
  const extra   = eff - baseDev;
  const total   = dur === "hour" ? (BASE.hour + extra * EXTRA.hour) * hours : BASE[dur] + extra * EXTRA[dur];

  function setDuration(d: Dur) {
    setDur(d);
    if (devices < BASE_DEV[d]) setDevices(BASE_DEV[d]);
  }

  async function pay() {
    setErr(null); setPaying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErr("Please sign in to buy a Mesh pass."); setPaying(false); return; }
      if (!(await loadRazorpay())) { setErr("Couldn't load the payment window. Check your connection."); setPaying(false); return; }

      const sel = { devices: eff, dur, hours: dur === "hour" ? hours : 1 };
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mesh-create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(sel),
      });
      const ord = await res.json();
      if (!res.ok || ord.error) { setErr(ord.error ?? "Couldn't start payment."); setPaying(false); return; }

      const durLabel = dur === "hour" ? `${hours} hr${hours > 1 ? "s" : ""}` : `1 ${dur}`;
      const rzp = new (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay({
        key: ord.key_id, order_id: ord.order_id, amount: ord.amount, currency: "INR",
        name: "adris.tech", image: "https://adris.tech/icon.png",
        description: `Mesh pass · ${eff} devices · ${durLabel}`,
        prefill: { email: session.user.email ?? "" },
        theme: { color: "#7C5CFF" },
        modal: { ondismiss: () => setPaying(false) },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const v = await fetch(`${SUPABASE_URL}/functions/v1/mesh-verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ ...resp, ...sel }),
          });
          const vr = await v.json().catch(() => ({}));
          if (v.ok && vr.ok) { onPurchased?.(eff); setDone(true); setTimeout(onClose, 1800); }
          else { setErr(vr.error ?? "Payment captured, but activation failed — you won't be charged again."); setPaying(false); }
        },
      });
      rzp.open();
    } catch (e) {
      setErr(String(e)); setPaying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm rounded-2xl border p-6" style={{ background: "var(--nv-bg)", borderColor: "var(--nv-rule)" }}>
        {done ? (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)" }}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M5 11l4.5 4.5L17 7" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div>
              <p className="text-[15px] font-semibold text-nv-text">Mesh pass active</p>
              <p className="text-[12px] text-nv-muted mt-1">{eff} devices unlocked. Start a session to use it.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-semibold text-nv-text">Buy a Mesh pass</p>
              <button onClick={onClose} className="text-nv-faint hover:text-nv-text text-lg leading-none">×</button>
            </div>
            <p className="text-[11px] text-nv-muted mb-4">Pay only for the devices you need, only when you need them. Same-network meshing stays free — this lifts your device limit.</p>

            {/* duration */}
            <div className="grid grid-cols-4 gap-1 mb-4">
              {DURS.map(d => (
                <button key={d.key} onClick={() => setDuration(d.key)}
                  className={`py-1.5 text-[11px] font-mono rounded border transition-fast ${dur === d.key ? "bg-accent text-white border-accent" : "border-nv-border text-nv-muted hover:text-nv-text"}`}>
                  {d.label.replace("1 ", "")}
                </button>
              ))}
            </div>

            {/* devices */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-nv-muted">Devices</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setDevices(d => Math.max(baseDev, d - 1))} className="w-7 h-7 rounded border border-nv-border text-nv-text disabled:opacity-30" disabled={eff <= baseDev}>−</button>
                <span className="text-[15px] font-semibold text-nv-text w-8 text-center">{eff}</span>
                <button onClick={() => setDevices(d => Math.min(100, Math.max(baseDev, d) + 1))} className="w-7 h-7 rounded border border-nv-border text-nv-text disabled:opacity-30" disabled={eff >= 100}>+</button>
              </div>
            </div>
            <p className="text-[10px] text-nv-faint mb-3">Base {baseDev} devices included · {dur === "hour" ? `₹${EXTRA.hour}` : `₹${EXTRA[dur]}`} per extra device</p>

            {/* hours (hourly only) */}
            {dur === "hour" && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] text-nv-muted">Hours</span>
                  <span className="text-[12px] font-mono text-nv-text">{hours} hr{hours > 1 ? "s" : ""}</span>
                </div>
                <input type="range" min={1} max={24} value={hours} onChange={e => setHours(parseInt(e.target.value, 10))} className="w-full accent-[var(--accent)]" />
              </div>
            )}

            {/* total + pay */}
            <div className="flex items-end justify-between border-t border-nv-border pt-4 mt-2">
              <div>
                <p className="text-[10px] text-nv-faint font-mono uppercase tracking-widest">Total</p>
                <p className="text-2xl font-bold text-nv-text">₹{total.toLocaleString("en-IN")}</p>
              </div>
              <button onClick={pay} disabled={paying}
                className="px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-accent text-white hover:bg-accent/85 disabled:opacity-50 transition-fast">
                {paying ? "Opening…" : "Pay & activate"}
              </button>
            </div>
            {err && <p className="text-[11px] text-nv-red mt-3">{err}</p>}
            <p className="text-[9px] text-nv-faint mt-3 text-center">Secure payment via Razorpay · UPI, cards, netbanking · you must be signed in</p>
          </>
        )}
      </div>
    </div>
  );
}
