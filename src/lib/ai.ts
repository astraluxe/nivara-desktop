import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ConnectionMode = 'local' | 'own_key' | 'nivara';

// ─── Model discovery + ranking (so a non-tech user never picks a raw model id) ───
// NVIDIA's catalogue has 130+ models and changes weekly, so we DON'T hardcode a list that rots.
// Instead we ask the provider (with the user's key) which models THEY can actually call, then rank
// each by name into a plain-language tier — "Recommended for complex tasks" vs "Fast" — and hide
// the ones that aren't text chat (image/video/speech/embedding/OCR/safety). The user sees two short
// groups with clear labels, not 139 cryptic ids.

export type ModelTier = 'smart' | 'fast' | 'other';
export interface RankedModel { id: string; tier: ModelTier }

// Not a text-chat model → keep it out of the picker entirely.
const NON_CHAT = /(embed|rerank|image|vision|vila|video|cosmos|diffusion|tts|stt|speech|riva|parakeet|whisper|ocr|guard|safety|moderation|retriever|reranking|nv-clip|florence|paddle|super.?resolution|relight)/i;
// Big / agentic / reasoning families → best at tools, JSON, multi-step (closest to the hosted default).
const SMART = /(70b|72b|123b|128b|235b|405b|550b|671b|1t\b|k2|kimi|deepseek[-_.]?(v|r|coder)|nemotron.*(ultra|super|340|70)|glm[-_.]?[4-9]|qwen.*(72b|235b|max|3[-_.]?(32|72|coder))|mistral[-_.]?(large|medium)|llama[-_.]?3\.[0-9]+[-_.]?(70|405)|command[-_.]?r[-_.]?plus|gpt[-_.]?oss[-_.]?(120|20b\+)|minimax|step[-_.]?3|laguna|inkling)/i;
// Small / fast / light → great for writing & quick replies, weaker at heavy multi-step agent work.
const FAST = /(\b1b\b|\b3b\b|\b4b\b|\b7b\b|\b8b\b|9b|mini\b|nano\b|lite\b|instant\b|small\b|flash[-_.]?lite|tiny|edge|micro)/i;

export function rankChatModel(id: string): ModelTier | null {
  const s = (id || '').toLowerCase();
  if (!s || NON_CHAT.test(s)) return null;
  if (SMART.test(s)) return 'smart';
  if (FAST.test(s)) return 'fast';
  return 'other';
}

/** Ask the provider which models this key can call, ranked. Empty on any failure (UI falls back to
 *  a sensible default). Uses the provider's OpenAI-compatible /models endpoint. */
export async function fetchRankedModels(provider: Provider, apiKey: string): Promise<RankedModel[]> {
  const chat = PROVIDERS[provider]?.endpoint;
  if (!chat || !apiKey) return [];
  const modelsUrl = chat.replace(/\/chat\/completions$/, '/models');
  try {
    const raw = await invoke<string>('krew_http_call', {
      method: 'GET', url: modelsUrl,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, body: null,
    });
    const data = JSON.parse(raw);
    const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: { id?: string }) => m?.id).filter(Boolean) : [];
    const out: RankedModel[] = [];
    for (const id of ids) { const tier = rankChatModel(id); if (tier) out.push({ id, tier }); }
    // Smart first, then fast, then other — each alphabetical, so the recommended ones lead.
    const order: Record<ModelTier, number> = { smart: 0, fast: 1, other: 2 };
    return out.sort((a, b) => order[a.tier] - order[b.tier] || a.id.localeCompare(b.id));
  } catch { return []; }
}

export type Provider =
  | 'openai' | 'groq' | 'nvidia' | 'mistral' | 'perplexity'
  | 'together' | 'deepseek' | 'claude' | 'gemini' | 'custom';

export interface ProviderMeta {
  label: string;
  defaultModel: string;
  keyPlaceholder: string;
  endpoint: string | null; // null = custom (user supplies URL)
}

export const PROVIDERS: Record<Provider, ProviderMeta> = {
  openai:     { label: 'OpenAI',       defaultModel: 'gpt-4o',                                       keyPlaceholder: 'sk-…',      endpoint: 'https://api.openai.com/v1/chat/completions' },
  groq:       { label: 'Groq',         defaultModel: 'llama-3.3-70b-versatile',                      keyPlaceholder: 'gsk_…',     endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
  nvidia:     { label: 'NVIDIA (free)', defaultModel: 'meta/llama-3.1-8b-instruct',                  keyPlaceholder: 'nvapi-…',   endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions' },
  mistral:    { label: 'Mistral',      defaultModel: 'mistral-large-latest',                         keyPlaceholder: 'API key…',  endpoint: 'https://api.mistral.ai/v1/chat/completions' },
  perplexity: { label: 'Perplexity',   defaultModel: 'sonar-pro',                                    keyPlaceholder: 'pplx-…',    endpoint: 'https://api.perplexity.ai/chat/completions' },
  together:   { label: 'Together.ai',  defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',      keyPlaceholder: 'API key…',  endpoint: 'https://api.together.xyz/v1/chat/completions' },
  deepseek:   { label: 'DeepSeek',     defaultModel: 'deepseek-chat',                                keyPlaceholder: 'sk-…',      endpoint: 'https://api.deepseek.com/v1/chat/completions' },
  claude:     { label: 'Claude',       defaultModel: 'claude-3-5-haiku-20241022',                    keyPlaceholder: 'sk-ant-…',  endpoint: null },
  gemini:     { label: 'Gemini',       defaultModel: 'gemini-2.5-flash-lite',                        keyPlaceholder: 'AIzaSy…',   endpoint: null },
  custom:     { label: 'Custom (OpenAI-compatible)', defaultModel: '',                                keyPlaceholder: 'API key…',  endpoint: null },
};

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  mode: ConnectionMode;
  messages: AiMessage[];
  apiKey?: string;
  provider?: Provider;
  localModel?: string;
  modelName?: string;
  baseUrl?: string;
  sessionToken?: string;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (err: string) => void;
}

export async function streamAI(opts: StreamOptions): Promise<() => void> {
  const callId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const u1 = await listen<{ id: string; text: string }>('ai-chunk', (e) => {
    if (e.payload.id === callId) opts.onChunk(e.payload.text);
  });
  const u2 = await listen<{ id: string }>('ai-done', (e) => {
    if (e.payload.id === callId) { opts.onDone(); cleanup(); }
  });
  const u3 = await listen<{ id: string; error: string }>('ai-error', (e) => {
    if (e.payload.id === callId) { opts.onError(e.payload.error); cleanup(); }
  });

  function cleanup() { u1(); u2(); u3(); }

  invoke('ai_stream', {
    callId,
    mode: opts.mode,
    messages: opts.messages,
    apiKey: opts.apiKey ?? null,
    provider: opts.provider ?? 'openai',
    localModel: opts.localModel ?? 'llama3',
    modelName: opts.modelName ?? null,
    baseUrl: opts.baseUrl ?? null,
    sessionToken: opts.sessionToken ?? null,
  }).catch((e: unknown) => {
    opts.onError(String(e));
    cleanup();
  });

  return cleanup;
}
