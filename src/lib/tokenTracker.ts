import { invoke } from '@tauri-apps/api/core';
import { supabase } from './supabase';
import { charsToTokens } from './planConfig';

export type TokenModule = 'coder' | 'krew' | 'automation' | 'guard';

async function getSupabaseCreds() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    supabaseUrl:     import.meta.env.VITE_SUPABASE_URL as string,
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    sessionToken:    session?.access_token ?? '',
    userId:          session?.user?.id ?? '',
  };
}

/** Fire-and-forget. Never throws — token tracking must not crash the chat. */
export async function trackTokenUsage(module: TokenModule, charsUsed: number): Promise<void> {
  try {
    const creds = await getSupabaseCreds();
    if (!creds.userId || !creds.sessionToken) return;
    await invoke('track_token_usage', {
      supabaseUrl:     creds.supabaseUrl,
      supabaseAnonKey: creds.supabaseAnonKey,
      sessionToken:    creds.sessionToken,
      userId:          creds.userId,
      module,
      tokensUsed:      charsToTokens(charsUsed),
    });
  } catch {
    // intentionally silent
  }
}

/** Returns tokens used this calendar month (or lifetime for free/explore), or 0 on error. */
export async function getMonthlyUsage(isLifetime = false): Promise<number> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return 0;
    let query = supabase
      .from('token_usage')
      .select('tokens_consumed')
      .eq('user_id', session.user.id);
    if (!isLifetime) {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      query = query.gte('created_at', monthStart.toISOString());
    }
    const { data, error } = await query;
    if (error) return 0;
    return (data ?? []).reduce((s: number, r: { tokens_consumed: number }) => s + (r.tokens_consumed ?? 0), 0);
  } catch {
    return 0;
  }
}
