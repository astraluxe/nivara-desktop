import { useState } from "react";

// ── Copy chip ─────────────────────────────────────────────────────────────────

function CmdChip({ cmd, desc }: { cmd: string; desc: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div
      onClick={copy}
      className="group flex items-start justify-between gap-3 px-4 py-3 rounded-xl border cursor-pointer hover:border-accent/40 transition-colors"
      style={{ borderColor: "var(--nv-rule)", background: "var(--nv-surface)" }}
    >
      <div className="min-w-0">
        <code className="font-mono text-[12px] font-semibold block mb-0.5 truncate" style={{ color: "var(--nv-ink)" }}>
          {cmd}
        </code>
        <span className="font-mono text-[10px]" style={{ color: "var(--nv-muted)" }}>{desc}</span>
      </div>
      <span className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: copied ? "var(--accent)" : "var(--nv-muted)" }}>
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        )}
      </span>
    </div>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────

const COMMANDS = [
  { cmd: "nivara mesh start",           desc: "Start a session — generates a 6-digit room code." },
  { cmd: "nivara mesh join NIVARA-XXXX",desc: "Join an existing session using the host's code." },
  { cmd: "nivara mesh status",          desc: "Show connected devices, RAM pool, model layers." },
  { cmd: "nivara mesh devices",         desc: "List all devices with RAM, latency, and quality." },
  { cmd: "nivara mesh invite <email>",  desc: "Send an invite link to someone's email." },
  { cmd: "nivara mesh stop",            desc: "End the session and release RAM on all machines." },
];

const MODELS = [
  { name: "TinyLlama 1.1B",    ram: "2 GB",   devs: "1 × 4 GB",  use: "Quick tasks" },
  { name: "Llama 3.2 3B",      ram: "4 GB",   devs: "1 × 4 GB",  use: "Chat" },
  { name: "Mistral 7B",        ram: "8 GB",   devs: "1 × 8 GB",  use: "Writing & analysis" },
  { name: "Qwen 2.5 Coder 7B", ram: "8 GB",   devs: "1 × 8 GB",  use: "Code generation" },
  { name: "Llama 3.1 70B",     ram: "40 GB",  devs: "5 × 8 GB",  use: "Advanced reasoning" },
  { name: "Command R 35B",     ram: "20 GB",  devs: "3 × 8 GB",  use: "RAG & tools" },
  { name: "DeepSeek V3",       ram: "70 GB",  devs: "9 × 8 GB",  use: "Frontier intelligence" },
  { name: "DeepSeek R1 671B",  ram: "400 GB", devs: "50 × 8 GB", use: "Mesh frontier", frontier: true },
];

const PRICING = [
  { label: "Mesh 3",  price: "Free",  sub: "forever",  devices: "Up to 3 devices", badge: "FREE FOREVER", badgeColor: "#10B981", highlight: false },
  { label: "1 hour",  price: "₹15",   sub: "/ session", devices: "Up to 5 devices", badge: null, highlight: false },
  { label: "1 day",   price: "₹59",   sub: "/ session", devices: "Up to 10 devices",badge: null, highlight: false },
  { label: "1 week",  price: "₹179",  sub: "/ session", devices: "Up to 10 devices",badge: null, highlight: false },
  { label: "Monthly", price: "₹399",  sub: "/ month",   devices: "Up to 10 devices",badge: "BEST VALUE", badgeColor: "var(--accent)", highlight: true },
];

const PLAN_GATES = [
  { plan: "Explore", ok: false, note: "Not available" },
  { plan: "Solo",    ok: false, note: "Not available" },
  { plan: "Growth",  ok: true,  note: "Join sessions · up to 3 devices" },
  { plan: "Builder", ok: true,  note: "Create + join · up to 5 devices" },
  { plan: "Pro",     ok: true,  note: "Create + join · up to 10 devices" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MeshModule() {
  return (
    <div className="h-full overflow-y-auto bg-nv-bg" style={{ scrollbarWidth: "thin" }}>
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-10">

        {/* ── Hero ── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(124,92,255,0.12)", color: "var(--accent)" }}>
              <svg viewBox="0 0 28 28" fill="none" style={{ width: 18, height: 18 }}>
                <circle cx="4"  cy="14" r="2.5" fill="currentColor"/>
                <circle cx="14" cy="4"  r="2.5" fill="currentColor"/>
                <circle cx="24" cy="14" r="2.5" fill="currentColor"/>
                <circle cx="14" cy="24" r="2.5" fill="currentColor"/>
                <circle cx="14" cy="14" r="2"   fill="currentColor" opacity=".6"/>
                <path d="M6 14h5M17 14h5M14 6v5M14 17v5" stroke="currentColor" strokeWidth="1.4" opacity=".5"/>
              </svg>
            </div>
            <div>
              <h1 className="text-[18px] font-semibold text-nv-text tracking-tight leading-none">Mesh</h1>
              <p className="text-[11px] text-nv-muted font-mono mt-0.5">RAM pooling · distributed AI inference</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-[10px] px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ background: "rgba(124,92,255,0.08)", color: "var(--accent)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                Phase 7 · Building
              </span>
            </div>
          </div>
          <p className="text-[13px] text-nv-muted leading-relaxed">
            Mesh splits a model's weight layers across multiple machines on the same Wi-Fi network. Three 8 GB laptops together can run a 70B model that no single machine could. All compute stays peer-to-peer — Nivara sees none of your inference traffic.
          </p>
        </div>

        {/* ── How it works ── */}
        <div>
          <SectionLabel>How it works</SectionLabel>
          <div className="grid grid-cols-3 gap-3">
            {[
              { n: "01", t: "Start a session", b: "Run `nivara mesh start` on the host device. You get a unique 6-digit code: NIVARA-XXXXXX." },
              { n: "02", t: "Others join",     b: "Friends enter the code in their Nivara app. Their RAM is added to the shared pool." },
              { n: "03", t: "Run big models",  b: "Click 'Run with Mesh' on any large model. Layers split automatically across devices." },
            ].map(s => (
              <div key={s.n} className="rounded-xl border p-4" style={{ borderColor: "var(--nv-rule)", background: "var(--nv-surface)" }}>
                <div className="font-mono text-[9px] mb-2 tracking-widest" style={{ color: "var(--accent)", opacity: 0.7 }}>{s.n}</div>
                <div className="font-semibold text-[12px] text-nv-text mb-1.5">{s.t}</div>
                <div className="text-[11px] leading-relaxed" style={{ color: "var(--nv-muted)" }}>{s.b}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Room code placeholder ── */}
        <div>
          <SectionLabel>Session room code</SectionLabel>
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--nv-rule)", background: "var(--nv-surface)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: "var(--nv-muted)" }}>Not started</span>
              <span className="font-mono text-[9px] text-nv-faint">0 devices connected</span>
            </div>
            <div className="font-mono font-bold tracking-[0.15em] mb-3" style={{ fontSize: "26px", color: "var(--nv-muted)", opacity: 0.25, letterSpacing: "0.18em" }}>
              NIVARA-——————
            </div>
            <p className="text-[11px] text-nv-muted mb-4">Share this code with anyone you want in your mesh session. It expires when you run `nivara mesh stop`.</p>
            <button
              disabled
              className="w-full text-[12px] font-semibold py-2.5 rounded-lg border"
              style={{ borderColor: "rgba(124,92,255,0.25)", background: "rgba(124,92,255,0.04)", color: "var(--nv-muted)", cursor: "not-allowed" }}
            >
              Start mesh session — available in Phase 7
            </button>
          </div>
        </div>

        {/* ── Models ── */}
        <div>
          <SectionLabel>What you can run with Mesh</SectionLabel>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            <div className="grid font-mono text-[9px] uppercase tracking-widest border-b px-4 py-2.5" style={{ gridTemplateColumns: "1.8fr 0.7fr 1fr 1.2fr", borderColor: "var(--nv-rule)", background: "var(--nv-surface)", color: "var(--nv-muted)" }}>
              {["Model", "RAM", "Devices", "Best for"].map(h => <div key={h}>{h}</div>)}
            </div>
            {MODELS.map((r, i) => (
              <div
                key={r.name}
                className="grid items-center px-4 py-3 border-b last:border-b-0"
                style={{
                  gridTemplateColumns: "1.8fr 0.7fr 1fr 1.2fr",
                  borderColor: "var(--nv-rule)",
                  background: r.frontier ? "rgba(251,146,60,0.04)" : i % 2 === 0 ? "var(--nv-surface)" : "transparent",
                  borderLeft: r.frontier ? "2px solid #F97316" : "2px solid transparent",
                }}
              >
                <div>
                  <div className="font-sans text-[12px] font-medium text-nv-text">{r.name}</div>
                  {r.frontier && <div className="font-mono text-[9px] mt-0.5" style={{ color: "#F97316", letterSpacing: "0.06em" }}>MESH FRONTIER</div>}
                </div>
                <div className="font-mono text-[11px]" style={{ color: "var(--nv-muted)" }}>{r.ram}</div>
                <div className="font-mono text-[11px]" style={{ color: r.frontier ? "var(--accent)" : "var(--nv-muted)" }}>{r.devs}</div>
                <div className="text-[11px]" style={{ color: "var(--nv-muted)" }}>{r.use}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing ── */}
        <div>
          <SectionLabel>Pricing</SectionLabel>
          <p className="text-[11px] text-nv-muted mb-4">Mesh 3 (3 devices) is always free. Paid sessions unlock more devices. Nivara earns nothing from your compute — all AI runs on your hardware.</p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            {PRICING.map((p, i) => (
              <div
                key={p.label}
                className="flex items-center gap-4 px-4 py-3.5 border-b last:border-b-0"
                style={{
                  borderColor: "var(--nv-rule)",
                  background: p.highlight ? "rgba(124,92,255,0.05)" : i % 2 === 0 ? "var(--nv-surface)" : "transparent",
                  borderLeft: p.highlight ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div className="w-16 shrink-0">
                  <div className="font-semibold text-[13px]" style={{ color: p.highlight ? "var(--accent)" : "var(--nv-ink)" }}>{p.label}</div>
                  <div className="font-mono text-[9px]" style={{ color: "var(--nv-muted)" }}>{p.sub}</div>
                </div>
                <div className="font-bold text-[16px] w-16 shrink-0" style={{ color: "var(--nv-ink)", letterSpacing: "-0.02em" }}>{p.price}</div>
                <div className="flex-1 font-mono text-[10px]" style={{ color: "var(--nv-muted)" }}>{p.devices}</div>
                {p.badge && (
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded shrink-0" style={{ background: `${p.badgeColor}18`, color: p.badgeColor, letterSpacing: "0.04em" }}>
                    {p.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--nv-muted)", opacity: 0.65 }}>
            Extra devices: ₹2/hr · ₹6/day · ₹18/wk · ₹40/mo per device beyond base. Example: 15 devices × 1 month = ₹399 + 5 × ₹40 = ₹599.
          </p>
        </div>

        {/* ── Plan access ── */}
        <div>
          <SectionLabel>Who can use Mesh</SectionLabel>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--nv-rule)" }}>
            {PLAN_GATES.map((g, i) => (
              <div
                key={g.plan}
                className="flex items-center gap-4 px-4 py-3 border-b last:border-b-0"
                style={{
                  borderColor: "var(--nv-rule)",
                  background: i % 2 === 0 ? "var(--nv-surface)" : "transparent",
                  opacity: g.ok ? 1 : 0.45,
                }}
              >
                <span style={{ color: g.ok ? "#10B981" : "var(--nv-muted)", flexShrink: 0 }}>
                  {g.ok ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  )}
                </span>
                <span className="font-semibold text-[12px] w-16 shrink-0" style={{ color: "var(--nv-ink)" }}>{g.plan}</span>
                <span className="font-mono text-[10px]" style={{ color: "var(--nv-muted)" }}>{g.note}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: "var(--nv-muted)", opacity: 0.65 }}>Every device in a session needs at least a Growth plan.</p>
        </div>

        {/* ── CLI reference ── */}
        <div>
          <SectionLabel>CLI commands</SectionLabel>
          <div className="space-y-2">
            {COMMANDS.map(c => <CmdChip key={c.cmd} cmd={c.cmd} desc={c.desc} />)}
          </div>
        </div>

        {/* ── Phase 7 note ── */}
        <div className="rounded-xl border px-5 py-4 flex gap-3" style={{ borderColor: "rgba(124,92,255,0.2)", background: "rgba(124,92,255,0.04)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <div>
            <p className="font-semibold text-[12px] text-nv-text mb-1">Phase 7 — in development</p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--nv-muted)" }}>
              The P2P runtime, room signaling (Supabase Realtime), Razorpay payment integration, and `nivara mesh` CLI commands all ship in Phase 7. Mesh 3 (free, 3 devices) will be available on Growth plan and above. This page is your reference until then.
            </p>
          </div>
        </div>

        {/* bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-mono uppercase tracking-widest mb-3" style={{ color: "var(--accent)", opacity: 0.8, letterSpacing: "0.14em" }}>
      {children}
    </p>
  );
}
