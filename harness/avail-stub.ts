// Fake AI availability for the screenshot: one CLI, two connected keys and a local model, so every
// kind of row in the title-bar menu is visible at once. Only the data is faked; AiSourceMenu is the
// shipped component.
export type AiSourceMode = 'auto' | 'nivara' | 'own_key' | 'local' | 'agent_cli';
export type ByokProvider = 'gemini' | 'openai' | 'claude' | 'nvidia' | 'groq' | 'omniroute';
export interface AiSourcePref { mode: AiSourceMode; provider?: ByokProvider; localModel?: string; cli?: string }
export interface AiAvailability {
  byokProviders: ByokProvider[];
  localModels: { name: string; filename: string }[];
  signedIn: boolean;
  clis: string[];
}
export const AI_SOURCE_EVENT = 'nv-ai-source-changed';
export const getAiSource = (): AiSourcePref => ({ mode: 'agent_cli', cli: 'claude_code' });
export const setAiSource = () => {};
export const getAiAvailability = async (): Promise<AiAvailability> => ({
  byokProviders: ['openai', 'gemini'],
  localModels: [{ name: 'Llama 3.1 8B', filename: 'llama.gguf' }],
  signedIn: true,
  clis: ['claude_code'],
});
export const aiSourceLabel = () => 'Your Claude Code';
export const resolveAiSource = async () => ({ mode: 'agent_cli' });
