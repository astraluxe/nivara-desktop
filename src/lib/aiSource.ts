import { invoke } from '@tauri-apps/api/core';
import { credentialStore } from './krewDb';
import { supabase } from './supabase';
import { detectClis, availableClis, type AgentCli } from './agentCli';
// The pure preference-to-chat-state mapping lives apart so it can be unit-tested in node — see
// chatConnection.ts. Re-exported here because this is where every caller already looks.
import { chatConnectionFor, type ChatConnection } from './chatConnection';
export { chatConnectionFor };
export type { ChatConnection };

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
  /**
   * Which model on that key, when the user has picked one themselves.
   *
   * Only ever set by an explicit choice in the menu's model list — never guessed. Blank means
   * "whatever the key was connected with", which is the scanned-best model and the right default.
   * It belongs to `provider`: changing provider clears it, so a Groq model id can never be sent
   * to Gemini.
   */
  model?: string;
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

/**
 * The choice an existing user already made with the pill row, carried over once.
 *
 * WHY THIS IS NOT OPTIONAL. Until 1.68.0 the Krew chat kept its own mode in `nv-krew-connection`,
 * and the pills were how people set it. Someone who deliberately chose adris.tech there — and never
 * opened the title-bar menu, because it did not govern the chat — still has `nv-ai-source` at its
 * `auto` default. Wiring the menu up without this would read that default, resolve it to "your own
 * key" and move them off the source they picked, silently, on first launch after an update.
 *
 * Which would be the same bug in the opposite direction: a choice the user made, overridden by the
 * app without telling them. Their setting wins; `auto` only applies to someone who never set one.
 */
function legacyChatChoice(): AiSourcePref | null {
  try {
    // One key, not two: Coder's constant is named CODER_CONN_KEY but its value is the same
    // 'nv-krew-connection', so the two screens have always shared one stored choice.
    const v = JSON.parse(localStorage.getItem('nv-krew-connection') || 'null');
    const mode = v?.mode;
    if (mode !== 'nivara' && mode !== 'own_key' && mode !== 'local') return null;
    const out: AiSourcePref = { mode };
    if (mode === 'own_key' && v.provider) out.provider = v.provider as ByokProvider;
    if (mode === 'local' && v.localModel) out.localModel = v.localModel;
    return out;
  } catch { return null; }   // unparseable — treat as absent
}

export function getAiSource(): AiSourcePref {
  try {
    const stored = localStorage.getItem(KEY);
    // Never set. Honour whatever the old pill row was left on before falling back to 'auto'.
    if (!stored) return legacyChatChoice() ?? { mode: 'auto' };
    const raw = JSON.parse(stored);
    // EVERY FIELD THAT WAS WRITTEN HAS TO COME BACK.
    //
    // `cli` was silently dropped here. setAiSource stored it, this read threw it away, and the
    // bridge then fell back to `avail.clis[0]` — so a user with both installed who deliberately
    // chose Codex was put back on Claude Code the moment the app reloaded, with the menu still
    // showing Codex because currentChoiceId matches on mode when the exact match fails. A stored
    // preference that cannot survive a restart is not a preference.
    return {
      mode: (raw.mode as AiSourceMode) ?? 'auto',
      provider: raw.provider,
      localModel: raw.localModel,
      cli: raw.cli,
      model: raw.model,
    };
  } catch { return { mode: 'auto' }; }
}

export function setAiSource(pref: AiSourcePref): void {
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(AI_SOURCE_EVENT, { detail: pref })); } catch { /* ignore */ }
}

export interface AiAvailability {
  byokProviders: ByokProvider[];   // keys the user has actually connected
  /** Downloaded and ready to run. `sizeGb` is carried so the menu can say how big each one is —
   *  the only number that tells a non-technical user which of their models is the capable one. */
  localModels: { name: string; filename: string; sizeGb: number }[];
  signedIn: boolean;
  clis: AgentCli[];                // agent CLIs actually installed on this machine
}

/** What the user can actually pick right now — used to disable options rather than fail later. */
/**
 * Which model a given key would actually think with.
 *
 * The menu row used to say only "billed by NVIDIA", which answers who pays and not the question the
 * user actually has — *what is it running?* One key can carry a dozen models, several of which do
 * not work (the catalogue lies; see the model scan), so "connected" without a model name is half an
 * answer.
 *
 * An explicit choice wins, and only for the provider it was made for — a model picked on the NVIDIA
 * key must not be shown against a Groq key.
 */
export function modelForProvider(provider: string, pref: { provider?: string | null; model?: string | null } | null): string | null {
  const chosen = pref && pref.provider === provider ? (pref.model || '') : '';
  return chosen || BYOK_MODEL[provider as keyof typeof BYOK_MODEL] || null;
}

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

  let localModels: { name: string; filename: string; sizeGb: number }[] = [];
  try {
    const installed = await invoke<{ name: string; filename: string; size_gb?: number }[]>('models_list_installed');
    localModels = (installed ?? []).map((m) => ({ name: m.name, filename: m.filename, sizeGb: m.size_gb ?? 0 }));
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
    // AN EXPLICIT CHOICE WINS, INCLUDING HERE. The BYOK defaults below are picked for background
    // work — cheap and fast — which is right when nobody has said otherwise. Once the user has gone
    // into the menu and named a model on this key, ignoring it in Guard and the automations while
    // honouring it in the chat would be the same one-setting-two-answers problem in a new place.
    // Only for the provider it was chosen FOR: a fallback to another key must not carry it over.
    const chosen = provider === pref.provider ? (pref.model || '') : '';
    return { mode: 'own_key', apiKey: key, provider, modelName: chosen || BYOK_MODEL[provider] || null,
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

/**
 * Keep a component's connection state in step with the one setting.
 *
 * Returns a cleanup function. Fires once on mount and again on every change to `nv-ai-source`, so a
 * choice made in the title bar reaches the chat on the very next message rather than the next
 * remount — which is what "one control, everywhere" has to mean to be worth anything.
 */
export function onChatConnectionChange(apply: (c: ChatConnection) => void): () => void {
  let alive = true;
  const push = () => {
    getAiAvailability()
      .then((avail) => { if (alive) apply(chatConnectionFor(getAiSource(), avail)); })
      // Availability needs Tauri and the network; without it, honour the plain preference rather
      // than leaving the chat on a stale mode.
      .catch(() => { if (alive) apply(chatConnectionFor(getAiSource(), null)); });
  };
  push();
  window.addEventListener(AI_SOURCE_EVENT, push);
  // A key connected in Connect Apps changes what 'auto' and 'own_key' resolve to.
  window.addEventListener('nv-creds-changed', push);
  return () => {
    alive = false;
    window.removeEventListener(AI_SOURCE_EVENT, push);
    window.removeEventListener('nv-creds-changed', push);
  };
}

// ─── The bridge, for every caller that talks to krew_ai_stream ───────────────
//
// THE TRAP THIS CLOSES. `krew_ai_stream` is the Rust command almost every screen uses, and its
// match on `mode` ends `_ => emit_error("Unknown mode: {mode}")`. It has never heard of
// 'agent_cli'. So a caller that resolves the source correctly and then hands the result straight to
// it does not fall back or degrade — it shows the user **"Unknown mode: agent_cli"**.
//
// `callAiOnce` in automationRunner had the branch, so Guard scans, automations and the outreach
// copilot were fine. Five other places did not: the Creator screen, the Research screen, the
// Automation module's own runner, Studio, and the Quick Bar. Choosing "Your Claude Code" — the
// option the whole product strategy rests on — broke all five, and nothing said so.
//
// One helper rather than five copies, because five copies is how the sixth caller gets written
// without one.

/**
 * Answer through the user's own Claude Code / Codex when that is what they chose.
 *
 * Returns `null` when the bridge is NOT the chosen source, which means "carry on with
 * krew_ai_stream" — so the call site reads as two lines and cannot forget the case.
 *
 * The CLI replies in one piece rather than streaming, so `onChunk` is called once with the whole
 * answer. That keeps a caller's own accumulate-and-render loop working unchanged instead of asking
 * every one of them to special-case it.
 */
export async function bridgeAnswer(
  src: ResolvedAiSource,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk?: (t: string) => void,
): Promise<string | null> {
  if (src.mode !== 'agent_cli' || !src.cli) return null;
  const { runAgentCli } = await import('./agentCli');
  // The CLI takes ONE prompt, not a message array — the same flattening the Krew chat uses, so a
  // conversation reads to it the way it reads to any other model.
  const prompt = messages.length === 1
    ? messages[0].content
    : messages.map((m) => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`)).join('\n\n');
  const r = await runAgentCli(src.cli, prompt, { systemPrompt: systemPrompt || undefined });
  if (!r.ok) throw new Error(r.error || 'the agent returned nothing');
  onChunk?.(r.text);
  return r.text;
}
