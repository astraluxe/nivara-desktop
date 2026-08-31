// Fake AI availability for the screenshot: both CLIs, two connected keys and two local models, so
// every kind of row in the title-bar menu is visible at once. Only the data is faked; AiSourceMenu
// and AiSourceDetail are the shipped components.
//
// It says "two connected keys and a local model" and for a while it returned none of them, so the
// screenshot only ever showed the two CLI rows and the app never got looked at in the state most
// users are actually in.
export type AiSourceMode = 'auto' | 'nivara' | 'own_key' | 'local' | 'agent_cli';
export type ByokProvider = 'gemini' | 'openai' | 'claude' | 'nvidia' | 'groq' | 'omniroute';
export interface AiSourcePref {
  mode: AiSourceMode; provider?: ByokProvider; localModel?: string; cli?: string; model?: string;
}
export interface AiAvailability {
  byokProviders: ByokProvider[];
  localModels: { name: string; filename: string; sizeGb: number }[];
  signedIn: boolean;
  clis: string[];
}
export interface ChatConnection {
  mode: 'local' | 'own_key' | 'nivara'; provider?: ByokProvider; model?: string;
  localModel?: string; bridge: boolean;
}
export const AI_SOURCE_EVENT = 'nv-ai-source-changed';
export const AI_SETUP_EVENT = 'nv-open-ai-setup';
let pref: AiSourcePref = { mode: 'agent_cli', cli: 'claude_code' };
export const getAiSource = (): AiSourcePref => pref;
export const setAiSource = (p: AiSourcePref) => {
  pref = p;
  window.dispatchEvent(new CustomEvent(AI_SOURCE_EVENT, { detail: p }));
};
export const getAiAvailability = async (): Promise<AiAvailability> => ({
  byokProviders: ['nvidia', 'gemini'],
  localModels: [
    { name: 'Llama 3 8B Instruct', filename: 'llama3-8b-instruct.gguf', sizeGb: 4.7 },
    { name: 'Qwen 2.5 14B',        filename: 'qwen2.5-14b.gguf',        sizeGb: 9.1 },
  ],
  signedIn: true,
  clis: ['claude_code'],   // Codex NOT installed, so the install flow is what the shot shows
});
export const aiSourceLabel = () => 'Your Claude Code';
export const resolveAiSource = async () => ({ mode: 'agent_cli' });
export const chatConnectionFor = (): ChatConnection => ({ mode: 'nivara', bridge: true });
export const onChatConnectionChange = (): (() => void) => () => {};

/** Mirrors the real one: an explicit choice wins, and only for the provider it was made for. */
export function modelForProvider(provider: string, pref: { provider?: string | null; model?: string | null } | null): string | null {
  const chosen = pref && pref.provider === provider ? (pref.model || '') : '';
  return chosen || ({ nvidia: 'llama-3.3-70b-instruct', groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-3-flash-preview', openai: 'gpt-4o-mini', claude: 'claude-sonnet-4-5',
    omniroute: 'auto' } as Record<string, string>)[provider] || null;
}
