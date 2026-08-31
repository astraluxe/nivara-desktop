// ─── The one setting, as a chat's own connection state ───────────────────────
//
// PURE ON PURPOSE — type-only imports, no Tauri, no Supabase, no localStorage. It lives apart from
// aiSource.ts so it can be run in node and actually tested, which is the whole point: the bug it
// fixes was invisible precisely because nothing anywhere could state which mode the chat was in.

import type { AiSourcePref, ByokProvider, AiAvailability } from './aiSource';

//
// WHY THIS EXISTS. Krew and Coder each keep a `mode` / `provider` / `localModel` triple of their
// own, because every model call, batch size, timeout and quota check in those files is written
// against it. The row of pills at the top of each screen was the only thing that ever wrote it.
//
// Deleting the pills removed the writer and left the reader, so the title-bar menu governed
// exactly one branch — the Claude Code / Codex bridge, which reads the preference directly — and
// nothing else. Choosing "adris.tech", "your NVIDIA key" or "Local model" changed the label in the
// title bar and the chat carried on answering from whatever `nv-krew-connection` last held, which
// on most machines was the default `nivara`. Silent, and exactly the failure the single control was
// introduced to prevent.
//
// This is the missing writer. It is deliberately a small pure mapping rather than a second
// resolver: the chat's own key lookup, provider-by-prefix safety net and dead-model repair are
// hard-won and stay exactly where they are. All this decides is the three things the pills used to
// decide.

/**
 * `mode` here is the chat's ConnectionMode, which has no 'agent_cli' member — see `bridge`.
 * `model` is only set when the user picked one explicitly, so an empty value means "leave whatever
 * the chat already resolved", not "use nothing".
 */
export interface ChatConnection {
  mode: 'local' | 'own_key' | 'nivara';
  provider?: ByokProvider;
  model?: string;
  localModel?: string;
  /** True when the real source is the user's own Claude Code / Codex subscription. */
  bridge: boolean;
}

/**
 * The chat state that corresponds to the current preference.
 *
 * THE BRIDGE MAPS TO 'own_key', and that is a considered choice rather than a fudge. Every use of
 * `mode` outside the model call itself is asking one of two questions — *does this spend the
 * adris.tech allowance* (no, so it must not be 'nivara') and *how much work should one request
 * carry* (less than the hosted model, which 'own_key' already means). The call itself never gets
 * this far: streamTurn's bridge branch reads the preference directly and returns before any of it
 * is consulted.
 */
export function chatConnectionFor(pref: AiSourcePref, avail: AiAvailability | null): ChatConnection {
  const keys = avail?.byokProviders ?? [];
  const locals = avail?.localModels ?? [];

  const ownKey = (want?: ByokProvider): ChatConnection | null => {
    const provider = want && keys.includes(want) ? want : keys[0];
    if (!provider) return null;
    // The saved model belongs to the saved provider. Falling back to another key must not carry
    // the first one's model id with it.
    return { mode: 'own_key', provider, model: provider === pref.provider ? pref.model : undefined, bridge: false };
  };
  const localOne = (want?: string): ChatConnection | null => {
    const chosen = locals.find((m) => m.filename === want || m.name === want) ?? locals[0];
    return chosen ? { mode: 'local', localModel: chosen.filename, bridge: false } : null;
  };

  switch (pref.mode) {
    case 'agent_cli':
      // Listed but not installed is still an explicit choice — say so by keeping the bridge shape.
      // The chat reports the failure rather than quietly spending credit; see streamTurn.
      return { ...(ownKey(pref.provider) ?? { mode: 'own_key' as const, bridge: false }), bridge: true };
    case 'own_key':
      return ownKey(pref.provider) ?? { mode: 'nivara', bridge: false };
    case 'local':
      return localOne(pref.localModel) ?? { mode: 'nivara', bridge: false };
    case 'nivara':
      return { mode: 'nivara', bridge: false };
    default:
      // 'auto' — the same order resolveAiSource uses, so the two can never disagree about what
      // "choose for me" means: your own key, then adris.tech, then whatever is on the machine.
      return ownKey() ?? (avail?.signedIn ? { mode: 'nivara', bridge: false } : null)
        ?? localOne() ?? { mode: 'nivara', bridge: false };
  }
}

