import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import { supabase } from './supabase';
import { detectClis, availableClis, type AgentCli } from './agentCli';

// ─── Where AI runs ────────────────────────────────────────────────────────────
// Krew always had a connection bar, but everything else — Guard, Automations, Studio, Coder's
// helpers — silently used a fixed preference (own key if present, else adris.tech, else local)
// with no way for the user to see or change it. This is that choice, in one place, remembered
// across the app and across restarts.

// 'agent_cli' is the bridge: the whole app thinks with the user's OWN Claude Code / Codex
// subscription instead of with tokens bought from anyone. See agentCli.ts for why that is the
// strategically important one — their budget is larger than any plan this product could sell.
export type AiSourceMode = 'auto' | 'nivara' | 'own_key' | 'local' | 'agent_cli';
// nvidia + groq are free, OpenAI-compatible cloud providers — the fast alternative to a slow local
// model, at no adris.tech token cost. The Rust own_key path routes them by name to their endpoints.
// omniroute is a gateway the user installs and runs themselves — own-key in every sense that
// matters, and the answer when one free key runs dry or a provider stops serving its big models.
export type ByokProvider = 'gemini' | 'openai' | 'claude' | 'nvidia' | 'groq' | 'omniroute';

export interface AiSourcePref {
  mode: AiSourceMode;
  provider?: ByokProvider;   // which BYOK key to use when mode is own_key
  localModel?: string;       // which downloaded model to use when mode is local
  cli?: AgentCli;            // which agent CLI to think with when mode is agent_cli
}

const KEY = 'nv-ai-source';
export const AI_SOURCE_EVENT = 'nv-ai-source-changed';

/**
 * Ask whichever screen owns the setup panels to open one.
 *
 * The panels — connect a key, pick a local model, install OmniRoute — live inside ConnectionBar and
 * are genuinely useful. What was removed is the row of buttons beside them that set the same value
 * the title-bar menu sets. This is how the menu reaches them now: choosing something that needs
 * setting up opens the panel for it, instead of leaving the user to hunt for a button that no
 * longer exists.
 *
 * detail: { which: 'own_key' | 'local' | 'omniroute' }
 */
export const AI_SETUP_EVENT = 'nv-open-ai-setup';

/** Default model per BYOK provider — cheap + fast, these are background tasks. */
const BYOK_MODEL: Record<ByokProvider, string> = {
  gemini: 'gemini-2.5-flash-lite',
  openai: 'gpt-4o-mini',
  claude: 'claude-3-5-haiku-20241022',
  // MEASURED 2026-08-11 on a live free key: llama-3.3-70b TIMED OUT at 35s, and every background
  // task here — Guard scans, automations, contract reads — was pointed at it. The lightning model
  // answered the same tool-call prompt in 0.5s with clean JSON.
  nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  groq:   'llama-3.3-70b-versatile',      // free on console.groq.com; 70B, and Groq runs it extremely fast
  // Chosen inside OmniRoute itself, which is the whole point of it — it routes to whichever
  // provider is available. Sending a model name from here would fight that.
  omniroute: '',
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
  clis: AgentCli[];                // agent CLIs actually installed on this machine
}

/** What the user can actually pick right now — used to disable options rather than fail later. */
export async function getAiAvailability(): Promise<AiAvailability> {
  const byokProviders: ByokProvider[] = [];
  try {
    const services = await credentialStore.list();
    for (const p of ['gemini', 'openai', 'claude', 'nvidia', 'groq', 'omniroute'] as ByokProvider[]) {
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

  let clis: AgentCli[] = [];
  try { clis = availableClis(await detectClis()); } catch { /* none installed */ }

  return { byokProviders, localModels, signedIn, clis };
}

export interface ResolvedAiSource {
  mode: 'nivara' | 'own_key' | 'local' | 'agent_cli';
  apiKey: string | null;
  provider: string | null;
  modelName: string | null;
  /** The address of a gateway the user runs. Mandatory for omniroute — without it the Rust side
   *  falls through to its OpenAI default and the key comes back rejected. */
  baseUrl: string | null;
  localModel: string | null;
  sessionToken: string | null;
  /** Which agent CLI to think with, when mode is 'agent_cli'. */
  cli?: AgentCli;
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
    const d = await credentialStore.get(provider).catch(() => null) as { api_key?: string; access_token?: string; base_url?: string } | null;
    const key = d?.api_key || d?.access_token;
    if (!key) return null;
    // A user-run gateway carries its own address, stored beside the key.
    const baseUrl = provider === 'omniroute' ? (d?.base_url || null) : null;
    return { mode: 'own_key', apiKey: key, provider, modelName: BYOK_MODEL[provider] || null,
             baseUrl, localModel: null, sessionToken: null };
  };

  const nivara = async (): Promise<ResolvedAiSource | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      if (!s?.access_token) return null;
      // Refresh a near-expiry JWT before handing it over. Callers like the outreach copilot run a
      // long browser pass (reading a LinkedIn thread) BEFORE the AI call, which can leave the token
      // expired by the time it's used → the edge function 401s and the whole call throws ("Couldn't
      // analyse the reply"). Refreshing here fixes that for every caller of resolveAiSource.
      let token = s.access_token;
      const expMs = (s.expires_at ?? 0) * 1000;
      if (expMs && expMs - Date.now() < 90_000) {
        try { const { data: r } = await supabase.auth.refreshSession(); token = r.session?.access_token ?? token; } catch { /* keep the existing token */ }
      }
      return { mode: 'nivara', apiKey: null, provider: null, modelName: null, baseUrl: null, localModel: null, sessionToken: token };
    } catch { return null; }
  };

  const local = (want?: string): ResolvedAiSource | null => {
    // Use what the user actually downloaded. This used to be hardcoded to 'llama3', so local mode
    // asked for a model most people do not have.
    const chosen = (want && avail.localModels.find((m) => m.filename === want || m.name === want))
      ?? avail.localModels[0];
    if (!chosen) return null;
    return { mode: 'local', apiKey: null, provider: null, modelName: null, baseUrl: null, localModel: chosen.filename, sessionToken: null };
  };

  // THE BRIDGE. Deliberately falls back like every other mode rather than failing: someone who
  // uninstalls Claude Code should find the app still works, not find it dead.
  if (pref.mode === 'agent_cli') {
    const want = pref.cli && avail.clis.includes(pref.cli) ? pref.cli : avail.clis[0];
    if (want) {
      return { mode: 'agent_cli', apiKey: null, provider: null, modelName: null,
               baseUrl: null, localModel: null, sessionToken: null, cli: want };
    }
    const fb = (await byok()) ?? (await nivara()) ?? local();
    if (fb) return { ...fb, fellBackFrom: 'agent_cli' };
  }

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
    ?? { mode: 'nivara', apiKey: null, provider: null, modelName: null, baseUrl: null, localModel: null, sessionToken: null };
}

/** Short label for the current choice, for headers and status lines. */
export function aiSourceLabel(pref: AiSourcePref): string {
  switch (pref.mode) {
    case 'own_key': return pref.provider ? `Your ${pref.provider} key` : 'Your own key';
    case 'local':   return pref.localModel ? 'Local model' : 'Local model';
    case 'agent_cli': return pref.cli === 'codex' ? 'Your Codex' : 'Your Claude Code';
    case 'nivara':  return 'adris.tech AI';
    default:        return 'Automatic';
  }
}
