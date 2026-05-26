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

/** Returns tokens used this calendar month, or 0 on error. */
export async function getMonthlyUsage(): Promise<number> {
  try {
    const creds = await getSupabaseCreds();
    if (!creds.userId || !creds.sessionToken) return 0;
    const used = await invoke<number>('get_token_usage_this_month', {
      supabaseUrl:     creds.supabaseUrl,
      supabaseAnonKey: creds.supabaseAnonKey,
      sessionToken:    creds.sessionToken,
      userId:          creds.userId,
    });
    return used ?? 0;
  } catch {
    return 0;
  }
}
