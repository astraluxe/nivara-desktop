// ─── The title-bar choice, applied to a chat's own connection state ──────────
//
// Krew and Coder each hold a `mode` / `provider` / `modelName` / `localModel` quartet, because
// every model call, batch size, timeout and quota check in those files is written against it. The
// row of pills at the top of each screen used to be the only thing that ever wrote it.
//
// The pills were removed in favour of one control in the title bar — correctly, they were a second
// switch on the same setting — but the writer went with them and the reader stayed. The result was
// a menu that governed exactly one branch (the Claude Code / Codex bridge, which reads the
// preference directly inside streamTurn) while "adris.tech", "your NVIDIA key" and "Local model"
// changed a label and nothing else. This hook is the missing writer, in one place so the two
// screens cannot drift apart again.
//
// WHAT IT DELIBERATELY DOES NOT TOUCH. `apiKey`, `baseUrl`, and the model beyond an explicit
// choice: the chat's own key lookup, its route-by-key-prefix safety net and its dead-model repair
// are hard-won and stay exactly where they are. This decides only what the pills decided.

import { useEffect } from 'react';
import { onChatConnectionChange, type ChatConnection } from '../lib/aiSource';
import type { ConnectionMode, Provider } from '../lib/ai';

/**
 * Told when the chosen source could not be used and something else is answering.
 *
 * Optional, so the two screens can adopt it independently and neither breaks without it.
 */
export type FellBackNotice = (from: 'own_key' | 'local') => void;

export interface AiSourceSinks {
  setMode: (m: ConnectionMode) => void;
  setProvider: (p: Provider) => void;
  setLocalModel: (m: string) => void;
  /** Only called when the user has explicitly named a model for this key. */
  setModelName: (m: string) => void;
  /**
   * Called when the user's explicit choice was NOT available and the hosted model took over.
   *
   * A silent swap here is the whole bug: the title bar goes on reading "Your NVIDIA key" while
   * adris.tech answers and spends the user's allowance. Saying it once is the minimum.
   */
  onFellBack?: FellBackNotice;
}

export function useAiSourceSync(sinks: AiSourceSinks): void {
  // The sinks are React setters — stable for the life of the component — so the subscription is
  // set up once. Re-running it on every render would re-read availability (a Tauri call and a
  // Supabase session check) on every keystroke.
  const { setMode, setProvider, setLocalModel, setModelName, onFellBack } = sinks;
  useEffect(() => {
    return onChatConnectionChange((c: ChatConnection) => {
      apply(c, { setMode, setProvider, setLocalModel, setModelName, onFellBack });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Exported so it can be unit-tested without React — the whole point of the bug this fixes is that
 * nobody could see which mode the chat was actually in.
 */
export function apply(c: ChatConnection, sinks: AiSourceSinks): void {
  sinks.setMode(c.mode);
  if (c.provider) sinks.setProvider(c.provider as Provider);
  if (c.localModel) sinks.setLocalModel(c.localModel);
  // Blank means "the user has not named one", NOT "use nothing" — leaving the chat's resolved
  // model alone is right, and clearing it would send an empty model id to the provider.
  if (c.model) sinks.setModelName(c.model);
  // Never silently. See ChatConnection.fellBackFrom — set only when the choice was genuinely
  // checked and genuinely gone, never merely because the availability probe failed.
  if (c.fellBackFrom) sinks.onFellBack?.(c.fellBackFrom);
}
