import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import { supabase } from './supabase';

// ─── Where AI runs ────────────────────────────────────────────────────────────
// Krew always had a connection bar, but everything else — Guard, Automations, Studio, Coder's
// helpers — silently used a fixed preference (own key if present, else adris.tech, else local)
// with no way for the user to see or change it. This is that choice, in one place, remembered
// across the app and across restarts.

export type AiSourceMode = 'auto' | 'nivara' | 'own_key' | 'local';
// nvidia + groq are free, OpenAI-compatible cloud providers — the fast alternative to a slow local
// model, at no adris.tech token cost. The Rust own_key path routes them by name to their endpoints.
export type ByokProvider = 'gemini' | 'openai' | 'claude' | 'nvidia' | 'groq';

export interface AiSourcePref {
  mode: AiSourceMode;
  provider?: ByokProvider;   // which BYOK key to use when mode is own_key
  localModel?: string;       // which downloaded model to use when mode is local
}

const KEY = 'nv-ai-source';
export const AI_SOURCE_EVENT = 'nv-ai-source-changed';

/** Default model per BYOK provider — cheap + fast, these are background tasks. */
const BYOK_MODEL: Record<ByokProvider, string> = {
  gemini: 'gemini-2.5-flash-lite',
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-20241022',
  nvidia: 'meta/llama-3.3-70b-instruct',  // free on build.nvidia.com; 70B — strong at agent tools, closest to the hosted default
  groq:   'llama-3.3-70b-versatile',      // free on console.groq.com; 70B, and Groq runs it extremely fast
};

export function getAiSource(): AiSourcePref {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { mode: (raw.mode as AiSourceMode) ?? 'auto', provider: raw.provider, localModel: raw.localModel };
  } catch { return { mode: 'auto' }; }
}

export function setAiSource(pref: AiSourcePref): void {
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(AI_SOURCE_EVENT, { detail: pref })); } catch { /* ignore */ }
}

export interface AiAvailability {
  byokProviders: ByokProvider[];   // keys the user has actually connected
  localModels: { name: string; filename: string }[];
  signedIn: boolean;
}

/** What the user can actually pick right now — used to disable options rather than fail later. */
export async function getAiAvailability(): Promise<AiAvailability> {
  const byokProviders: ByokProvider[] = [];
  try {
    const services = await credentialStore.list();
    for (const p of ['gemini', 'openai', 'claude', 'nvidia', 'groq'] as ByokProvider[]) {
      if (!services.includes(p)) continue;
      const d = await credentialStore.get(p).catch(() => null) as { api_key?: string; access_token?: string } | null;
      if (d?.api_key || d?.access_token) byokProviders.push(p);
    }
  } catch { /* none */ }

  let localModels: { name: string; filename: string }[] = [];
  try {
    const installed = await invoke<{ name: string; filename: string }[]>('models_list_installed');
    localModels = (installed ?? []).map((m) => ({ name: m.name, filename: m.filename }));
  } catch { /* engine not installed */ }

  let signedIn = false;
  try { signedIn = !!(await supabase.auth.getSession()).data.session?.access_token; } catch { /* offline */ }

  return { byokProviders, localModels, signedIn };
}

export interface ResolvedAiSource {
  mode: 'nivara' | 'own_key' | 'local';
  apiKey: string | null;
  provider: string | null;
  modelName: string | null;
  localModel: string | null;
  sessionToken: string | null;
  /** Set when the user's choice could not be honoured and we fell back. */
  fellBackFrom?: AiSourceMode;
}

/**
 * Turn the stored preference into concrete call parameters.
 *
 * 'auto' keeps the historic behaviour (own key → adris.tech → local). An explicit choice is
 * honoured when it is actually usable, and falls back rather than failing — a background task
 * must never die because a key was removed.
 */
export async function resolveAiSource(): Promise<ResolvedAiSource> {
  const pref = getAiSource();
  const avail = await getAiAvailability();

  const byok = async (want?: ByokProvider): Promise<ResolvedAiSource | null> => {
    const provider = want && avail.byokProviders.includes(want) ? want : avail.byokProviders[0];
    if (!provider) return null;
    const d = await credentialStore.get(provider).catch(() => null) as { api_key?: string; access_token?: string } | null;
    const key = d?.api_key || d?.access_token;
    if (!key) return null;
    return { mode: 'own_key', apiKey: key, provider, modelName: BYOK_MODEL[provider], localModel: null, sessionToken: null };
  };

  const nivara = async (): Promise<ResolvedAiSource | null> => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) return null;
      return { mode: 'nivara', apiKey: null, provider: null, modelName: null, localModel: null, sessionToken: token };
    } catch { return null; }
  };

  const local = (want?: string): ResolvedAiSource | null => {
    // Use what the user actually downloaded. This used to be hardcoded to 'llama3', so local mode
    // asked for a model most people do not have.
    const chosen = (want && avail.localModels.find((m) => m.filename === want || m.name === want))
      ?? avail.localModels[0];
    if (!chosen) return null;
    return { mode: 'local', apiKey: null, provider: null, modelName: null, localModel: chosen.filename, sessionToken: null };
  };

  if (pref.mode === 'own_key') {
    const r = await byok(pref.provider);
    if (r) return r;
    const fb = (await nivara()) ?? local();
    if (fb) return { ...fb, fellBackFrom: 'own_key' };
  }
  if (pref.mode === 'local') {
    const r = local(pref.localModel);
    if (r) return r;
    const fb = (await byok()) ?? (await nivara());
    if (fb) return { ...fb, fellBackFrom: 'local' };
  }
  if (pref.mode === 'nivara') {
    const r = await nivara();
    if (r) return r;
    const fb = (await byok()) ?? local();
    if (fb) return { ...fb, fellBackFrom: 'nivara' };
  }

  // 'auto' — and the last resort for every branch above.
  return (await byok()) ?? (await nivara()) ?? local()
    ?? { mode: 'nivara', apiKey: null, provider: null, modelName: null, localModel: null, sessionToken: null };
}

/** Short label for the current choice, for headers and status lines. */
export function aiSourceLabel(pref: AiSourcePref): string {
  switch (pref.mode) {
    case 'own_key': return pref.provider ? `Your ${pref.provider} key` : 'Your own key';
    case 'local':   return pref.localModel ? 'Local model' : 'Local model';
    case 'nivara':  return 'adris.tech AI';
    default:        return 'Automatic';
  }
}
