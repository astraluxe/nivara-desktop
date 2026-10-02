import { useAuth } from "../contexts/AuthContext";
import { CONTACT_URL } from "../components/UpgradeModal";

// ─── adris.tech IS FREE (Oct 2026) ───────────────────────────────────────────
//
// This screen used to show the plan, a token meter against the plan's allowance, the licence, a
// detailed usage bill, "Manage subscription" and a test of the hosted adris.tech AI. The hosted plan
// is retired: there is no adris.tech key, no allowance, nothing to bill and nothing to manage — the
// app runs on the AI the user connects. What is left is who you are, that it is free, and where to
// ask for a custom build.

async function openExternal(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch { window.open(url, "_blank"); }
}

export default function AccountPanel() {
  const { profile, user, signOut } = useAuth();

  const email      = profile?.email ?? user?.email ?? "—";
  const firstName  = profile?.first_name ?? "";
  const lastName   = profile?.last_name  ?? "";
  const fullName   = [firstName, lastName].filter(Boolean).join(" ") || null;
  const adminLevel = profile?.admin_level ?? null;
  const initial    = (fullName ?? email)[0]?.toUpperCase() ?? "N";

  return (
    <div className="flex-1 flex items-center justify-center bg-nv-bg">
      <div className="w-full max-w-sm mx-auto flex flex-col gap-6">

        {/* Avatar + name */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center text-accent text-2xl font-bold select-none">
            {initial}
          </div>
          {fullName && (
            <p className="text-nv-text text-base font-semibold">{fullName}</p>
          )}
          {adminLevel && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/15 text-accent uppercase tracking-wide">
              {adminLevel}
            </span>
          )}
        </div>

        {/* Info card */}
        <div className="bg-nv-surface border border-nv-border rounded-xl divide-y divide-nv-border">
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Email</span>
            <span className="text-nv-text text-sm font-medium truncate max-w-[200px]">{email}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Plan</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-nv-green bg-nv-green/10">
              Free · everything unlocked
            </span>
          </div>
          <div className="px-5 py-4">
            <p className="text-[12px] text-nv-muted leading-relaxed">
              adris thinks with the AI you connect — a free NVIDIA or Groq key, your Claude Code or
              Codex, your own key, or a local model. Pick it from the AI menu at the top of the window.
            </p>
          </div>
        </div>

        {/* Custom builds */}
        <div className="border border-nv-border rounded-xl p-5">
          <div className="text-sm font-semibold text-nv-text mb-1">Want a custom adris for your business?</div>
          <p className="text-[12px] text-nv-muted leading-relaxed mb-3">
            We build custom adris setups and agentic AI offices — agents, workflows and integrations
            designed around how your team works.
          </p>
          <button
            onClick={() => openExternal(CONTACT_URL)}
            className="w-full py-2.5 rounded-lg border border-accent/50 text-accent text-sm font-medium hover:bg-accent/10 transition-fast"
          >
            Request a custom build
          </button>
        </div>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="w-full py-2.5 rounded-lg border border-nv-red/40 text-nv-red text-sm font-medium hover:bg-nv-red/10 transition-fast"
        >
          Sign out
        </button>

      </div>
    </div>
  );
}
