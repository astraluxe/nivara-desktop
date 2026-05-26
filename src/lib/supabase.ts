import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key);

export type Plan = "explore" | "solo" | "growth" | "builder" | "pro" | "custom";

export interface UserProfile {
  id: string;
  email: string;
  plan: Plan;
  first_name?: string;
  last_name?: string;
  admin_level?: "admin" | "head" | null;
  subscription_status?: string;
}
