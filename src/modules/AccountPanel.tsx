import { useAuth } from "../contexts/AuthContext";

const PLAN_LABEL: Record<string, string> = {
  explore: "Explore",
  solo:    "Solo",
  growth:  "Growth",
  builder: "Builder",
  pro:     "Pro",
  custom:  "Custom",
};

const PLAN_COLOR: Record<string, string> = {
  explore: "text-nv-muted  bg-nv-surface2",
  solo:    "text-nv-green  bg-nv-green/10",
  growth:  "text-nv-green  bg-nv-green/10",
  builder: "text-accent    bg-accent/10",
  pro:     "text-nv-yellow bg-nv-yellow/10",
  custom:  "text-nv-yellow bg-nv-yellow/10",
};

export default function AccountPanel() {
  const { profile, user, signOut } = useAuth();

  const email      = profile?.email ?? user?.email ?? "—";
  const firstName  = profile?.first_name ?? "";
  const lastName   = profile?.last_name  ?? "";
  const fullName   = [firstName, lastName].filter(Boolean).join(" ") || null;
  const plan       = profile?.plan ?? "explore";
  const adminLevel = profile?.admin_level ?? null;
  const initial    = (fullName ?? email)[0]?.toUpperCase() ?? "N";
  const planLabel  = PLAN_LABEL[plan] ?? plan;
  const planColor  = PLAN_COLOR[plan] ?? PLAN_COLOR.explore;

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
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${planColor}`}>
              {planLabel}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-4">
            <span className="text-nv-muted text-sm">Status</span>
            <span className="text-nv-text text-sm font-medium capitalize">
              {profile?.subscription_status ?? "free"}
            </span>
          </div>
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
