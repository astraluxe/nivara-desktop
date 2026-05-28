import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ConnectionMode = 'local' | 'own_key' | 'nivara';

export type Provider =
  | 'openai' | 'groq' | 'mistral' | 'perplexity'
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
