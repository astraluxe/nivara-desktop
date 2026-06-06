import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Desktop-specific auth configuration:
// - flowType: 'implicit' — avoids PKCE code-verifier storage issues with skipBrowserRedirect
// - lock: no-op — supabase-js's Navigator Lock API causes cascading lock contention in
//   Tauri's WebView2 (initialize(), signOut(), setSession() queue on the same lock and
//   the lock is never released when getUser() hangs). Desktop apps don't need multi-tab
//   session sync, so a no-op lock is safe.
export const supabase = createClient(url, key, {
  auth: {
    flowType: 'implicit',
    lock: (_name: string, _acquireTimeout: number, fn: () => Promise<unknown>) => fn(),
  },
});

export type Plan = "explore" | "free" | "solo" | "builder" | "business" | "custom";

export interface UserProfile {
  id: string;
  email: string;
  plan: Plan;
  first_name?: string;
  last_name?: string;
  admin_level?: "admin" | "head" | null;
  subscription_status?: string;
}
