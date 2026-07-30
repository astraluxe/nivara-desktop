// ─── Multiple BYOK keys per provider (NVIDIA / Groq) ─────────────────────────
// A user can save SEVERAL keys for the same provider and toggle which is active — handy when a free
// key hits its rate limit, or for keeping separate keys for separate work. The stored credential
// stays shaped `{ api_key, model }` (the ACTIVE key — what streaming reads), plus `keys`, a JSON
// list of every saved key. Nothing that reads `api_key` needs to change; the list is additive, and
// an old single-key credential is transparently treated as a one-item list.

import { credentialStore } from './krewDb';

export interface ByokKey { api_key: string; model?: string; label?: string }

/** All saved keys for a provider + which one is active (''=none). Back-compatible with a credential
 *  that only has a single api_key (no list yet). */
export async function getByokKeys(service: string): Promise<{ keys: ByokKey[]; activeKey: string }> {
  const c = await credentialStore.get(service).catch(() => null) as { api_key?: string; model?: string; keys?: string } | null;
  if (!c?.api_key) return { keys: [], activeKey: '' };
  let keys: ByokKey[] = [];
  try { if (c.keys) { const parsed = JSON.parse(c.keys); if (Array.isArray(parsed)) keys = parsed.filter((k) => k?.api_key); } } catch { /* malformed → rebuild below */ }
  if (!keys.length) keys = [{ api_key: c.api_key, model: c.model }];
  // The active key must always be present in the list.
  if (!keys.some((k) => k.api_key === c.api_key)) keys.unshift({ api_key: c.api_key, model: c.model });
  return { keys, activeKey: c.api_key };
}

function persist(service: string, keys: ByokKey[], active: ByokKey): Promise<void> {
  return credentialStore.save(service, { api_key: active.api_key, model: active.model || '', keys: JSON.stringify(keys) })
    .then(() => notifyCredsChanged());
}

/** Add a key (dedupe by value) and make it the active one. */
export async function addByokKey(service: string, key: ByokKey): Promise<void> {
  const { keys } = await getByokKeys(service);
  const next = keys.filter((k) => k.api_key !== key.api_key).concat(key);
  await persist(service, next, key);
}

/**
 * Record the model the user CHOSE, against the key that is currently active.
 *
 * This was the missing write. Picking a model in the connection popup only ever set a piece of
 * React state, while every own-key call resolves its model from the CREDENTIAL — so the choice was
 * silently discarded and the model auto-picked at connect time kept answering. Choosing a 550B and
 * being answered by an 8B was not a display bug: the 8B genuinely was doing the work.
 *
 * Merges rather than overwrites, so nothing else stored on the credential is lost, and updates the
 * matching entry in the multi-key list so the choice survives toggling keys and restarting.
 */
export async function setByokModel(service: string, model: string): Promise<void> {
  if (!model) return;
  const cur = await credentialStore.get(service).catch(() => null) as
    (Record<string, string> & { api_key?: string; keys?: string }) | null;
  if (!cur?.api_key) return;
  const save: Record<string, string> = { ...cur, model };
  try {
    const parsed = cur.keys ? JSON.parse(cur.keys) : null;
    if (Array.isArray(parsed)) {
      save.keys = JSON.stringify(parsed.map((k: { api_key?: string }) =>
        (k?.api_key === cur.api_key ? { ...k, model } : k)));
    }
  } catch { /* malformed list — the active credential is what streaming reads, and that is set */ }
  await credentialStore.save(service, save);
  notifyCredsChanged();
}

/** Switch which saved key is active (what the agents use). */
export async function setActiveByokKey(service: string, apiKey: string): Promise<void> {
  const { keys } = await getByokKeys(service);
  const found = keys.find((k) => k.api_key === apiKey);
  if (found) await persist(service, keys, found);
}

/** Remove a key. If it was active, the first remaining one becomes active; if none remain, the
 *  whole provider is disconnected. */
export async function removeByokKey(service: string, apiKey: string): Promise<void> {
  const { keys, activeKey } = await getByokKeys(service);
  const next = keys.filter((k) => k.api_key !== apiKey);
  if (!next.length) { await credentialStore.delete(service).catch(() => {}); notifyCredsChanged(); return; }
  const active = activeKey === apiKey ? next[0] : (next.find((k) => k.api_key === activeKey) || next[0]);
  await persist(service, next, active);
}

function notifyCredsChanged() {
  try { window.dispatchEvent(new CustomEvent('nv-creds-changed')); } catch { /* no window */ }
}

/** "nvapi-lm…KRr" — a safe, recognisable label for a key without showing the whole secret. */
export function maskKey(k: string): string {
  const s = k || '';
  return s.length > 12 ? `${s.slice(0, 7)}…${s.slice(-4)}` : s;
}
