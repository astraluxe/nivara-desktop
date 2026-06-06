import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, type UserProfile, type Plan } from "../lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const VALID_PLANS: Plan[] = ["explore", "free", "solo", "builder", "business", "custom"];

async function loadProfile(userId: string, email: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, plan, first_name, last_name, admin_level, subscription_status")
    .eq("id", userId)
    .single();

  if (error) throw error;

  if (data) {
    const plan = (VALID_PLANS.includes(data.plan) ? data.plan : "explore") as Plan;
    return { ...data, plan };
  }

  return { id: userId, email, plan: "explore" };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const emergency = setTimeout(() => setLoading(false), 5000);

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          try {
            const p = await loadProfile(session.user.id, session.user.email ?? "");
            setProfile(p);
          } catch {
            // profile table may not have this user yet — default to explore
          }
        }
      })
      .catch(() => {/* network error — proceed with no session */})
      .finally(() => { clearTimeout(emergency); setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          try {
            const p = await loadProfile(session.user.id, session.user.email ?? "");
            setProfile(p);
          } catch {
            // ignore
          }
        } else {
          setProfile(null);
        }
      }
    );

    // Realtime profile sync — picks up payment/plan changes made on the website instantly
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      const userId = session.user.id;
      realtimeChannel = supabase
        .channel(`profile:${userId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${userId}` },
          async () => {
            try {
              const p = await loadProfile(userId, session.user.email ?? '');
              setProfile(p);
            } catch { /* ignore */ }
          }
        )
        .subscribe();
    });

    return () => {
      subscription.unsubscribe();
      realtimeChannel?.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    // Clear local state immediately so the UI responds right away
    // regardless of whether the Supabase API call succeeds.
    setSession(null);
    setUser(null);
    setProfile(null);
    try {
      await supabase.auth.signOut();
    } catch {
      // local state already cleared above — sign-out is done from the user's perspective
    }
  };

  const refreshSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        try {
          const p = await loadProfile(session.user.id, session.user.email ?? "");
          setProfile(p);
        } catch {
          // ignore — default to explore plan
        }
      } else {
        setProfile(null);
      }
    } catch {
      // ignore network errors
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signIn, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
