import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// flowType: 'implicit' is required for the desktop TCP-server OAuth callback.
// With 'pkce' (the supabase-js v2 default) and skipBrowserRedirect: true,
// the code verifier is never stored, so exchangeCodeForSession() always fails.
// Implicit flow returns #access_token= in the hash, which setSession() handles fine.
export const supabase = createClient(url, key, {
  auth: { flowType: 'implicit' },
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
