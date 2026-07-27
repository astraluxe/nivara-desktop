// ─── Surviving a retired model ────────────────────────────────────────────────
// A BYOK model id is saved once, at connect time, and then used forever. Providers retire models
// (NVIDIA returns `410 Gone — {"detail":"The model '…' is no longer available"}`), and when that
// happened every AI path in the app dead-ended with a raw HTTP error the user could do nothing
// about — outreach follow-ups, Guard scans, automations, chat, all of it.
//
// This module makes that self-healing: recognise a "your model no longer exists" failure, re-pick a
// live model from the provider's OWN catalogue, save it, and let the caller retry the same turn.
//
// It also fixes how the FIRST model gets chosen. The old auto-pick took the alphabetically first
// "smart"-tier id, which is how a user ended up on `abacusai/dracarys-llama-3.1-70b-instruct` — an
// obscure third-party build that sorted first and was later withdrawn. Preference order now leads
// with known-good general-purpose models, and domain-specialist builds (coder/math/med/finance) are
// never auto-picked for what is mostly writing and agent work.

import { invoke } from '@tauri-apps/api/core';
import { fetchRankedModels, PROVIDERS, type Provider } from './ai';
import { credentialStore } from './krewDb';

/** Known-good, general-purpose chat/agent models, best first. Matched against the LIVE catalogue,
 *  so a retired entry here is simply skipped rather than becoming the next dead model. */
const PREFERRED: Partial<Record<Provider, string[]>> = {
  nvidia: [
    'meta/llama-3.3-70b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'meta/llama-3.1-70b-instruct',
    'openai/gpt-oss-120b',
    'meta/llama-3.1-8b-instruct',
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ],
};

/** Tuned for one domain — strong at that, poor at general writing/agent work. Never auto-picked. */
const SPECIALIST = /(coder|codellama|starcoder|[-_/]code|math|[-_/]med(ical)?[-_/-]|palmyra-(med|fin)|legal|bio|chem|sql|chatqa|guard|safety)/i;

/**
 * Does this error mean "the model you asked for is gone", as opposed to a network blip, a bad key,
 * or a rate limit? Only these are worth re-picking a model for.
 */
export function isDeadModelError(msg: string): boolean {
  const s = (msg || '').toLowerCase();
  if (!s) return false;
  // A model that accepts the request and then answers with silence is as dead as one that 410s —
  // and far worse for the user, because it looks like the app is still working. streamTurn raises
  // NO_MODEL_RESPONSE for exactly that case.
  if (/no_model_response/.test(s)) return true;
  if (/no longer available|model_not_found|model not found|unknown model|invalid model|does not exist|decommissioned|has been (removed|retired|deprecated)|not a valid model/.test(s)) return true;
  // NVIDIA answers a withdrawn model with a bare 410; a 404 that mentions the model is the same thing.
  if (/\b410\b/.test(s)) return true;
  return /\b404\b/.test(s) && /model/.test(s);
}

/** Models this key has been SEEN to hang or reject, so we never pick one of them again. */
const BAD_KEY = 'nv-model-blocklist';
function blocklist(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(BAD_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function blockModel(provider: string, model: string): void {
  if (!model) return;
  try {
    const v = blocklist();
    v[`${provider}:${model.toLowerCase()}`] = Date.now();
    localStorage.setItem(BAD_KEY, JSON.stringify(v));
  } catch { /* quota */ }
}
function isBlocked(provider: string, model: string): boolean {
  const at = blocklist()[`${provider}:${(model || '').toLowerCase()}`];
  // Forget after a week — a model that was down for the account may come back.
  return !!at && Date.now() - at < 7 * 86_400_000;
}
export { blockModel, isBlocked };

/**
 * Does this model ACTUALLY answer for this key?
 *
 * Appearing in /v1/models means nothing about access. Measured on a real NVIDIA key:
 * `meta/llama-3.3-70b-instruct` and `openai/gpt-oss-120b` are both listed, accept the request, and
 * then never respond at all — no data, no error, no close. Others reply `404 … Not found for
 * account`. Only `meta/llama-3.1-8b-instruct` (281 ms) and `meta/llama-3.1-70b-instruct` (4.3 s)
 * actually worked. That silent hang is exactly what left the copilot "drafting…" forever, so a
 * candidate model is not trusted until it has said something back.
 */
export async function probeModel(provider: Provider, apiKey: string, model: string, timeoutMs = 12_000): Promise<boolean> {
  const endpoint = PROVIDERS[provider]?.endpoint;
  if (!endpoint || !apiKey || !model) return false;
  try {
    // krew_http_call REJECTS on a timeout or any non-2xx, so both "never answered" and
    // "404 not found for account" land in the catch below.
    const raw = await invoke<string>('krew_http_call', {
      method: 'POST', url: endpoint,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, stream: false }),
      timeoutMs,
    });
    if (!raw) return false;
    const j = JSON.parse(raw) as { choices?: unknown[]; error?: unknown; detail?: unknown };
    if (j.error || j.detail) return false;
    return Array.isArray(j.choices) && j.choices.length > 0;
  } catch { return false; }
}

/**
 * Best model this key can actually call — verified, not assumed. Walks the preference list and then
 * the live catalogue, PROBING each candidate and returning the first that genuinely answers.
 */
export async function pickBestModel(provider: Provider, apiKey: string, exclude: string[] = []): Promise<string> {
  const bad = new Set(exclude.filter(Boolean).map((s) => s.toLowerCase()));
  const skip = (id: string) => bad.has(id.toLowerCase()) || isBlocked(provider, id);
  const live = (await fetchRankedModels(provider, apiKey).catch(() => [])).filter((m) => !skip(m.id));

  // Candidates in the order we'd like them, deduped: preferred (present in the catalogue) first,
  // then general-purpose catalogue entries, smart tier before fast.
  const ordered: string[] = [];
  const push = (id: string) => { if (id && !ordered.some((o) => o.toLowerCase() === id.toLowerCase())) ordered.push(id); };
  for (const want of PREFERRED[provider] ?? []) {
    const hit = live.find((m) => m.id.toLowerCase() === want.toLowerCase());
    if (hit) push(hit.id);
  }
  const general = live.filter((m) => !SPECIALIST.test(m.id));
  for (const m of general) if (m.tier === 'smart') push(m.id);
  for (const m of general) push(m.id);

  // Probe a bounded number — enough to get past a couple of dead ones without stalling setup.
  for (const id of ordered.slice(0, 6)) {
    if (await probeModel(provider, apiKey, id)) return id;
    blockModel(provider, id);            // it is listed but does not answer — never offer it again
  }

  // Nothing probed clean (offline, or the probe endpoint is blocked). Fall back to a known id rather
  // than leaving the user with no model at all.
  const fallback = (PREFERRED[provider] ?? []).find((m) => !skip(m)) ?? PROVIDERS[provider]?.defaultModel ?? '';
  return fallback && !bad.has(fallback.toLowerCase()) ? fallback : (ordered[0] ?? '');
}

/**
 * A saved model turned out to be dead: pick a live replacement and persist it against the key that
 * failed (both the active credential and its entry in the multi-key list), so the fix survives a
 * restart and every other module picks it up. Returns the new model id, or '' if none could be found.
 */
export async function repairDeadModel(service: string, apiKey: string, deadModel: string): Promise<string> {
  const provider = service as Provider;
  if (!PROVIDERS[provider]) return '';
  const next = await pickBestModel(provider, apiKey, [deadModel]);
  if (!next || next.toLowerCase() === (deadModel || '').toLowerCase()) return '';

  try {
    const cur = await credentialStore.get(service).catch(() => null);
    if (cur?.api_key) {
      const save: Record<string, string> = { ...cur };
      // Only rewrite the model of the key that actually failed — other saved keys are untouched.
      if (cur.api_key === apiKey || !apiKey) save.model = next;
      try {
        const parsed = cur.keys ? JSON.parse(cur.keys) : null;
        if (Array.isArray(parsed)) {
          save.keys = JSON.stringify(parsed.map((k: { api_key?: string }) =>
            (k?.api_key && apiKey && k.api_key !== apiKey) ? k : { ...k, model: next }));
        }
      } catch { /* malformed list — leave it alone, the active credential is what streaming reads */ }
      await credentialStore.save(service, save);
      try { window.dispatchEvent(new CustomEvent('nv-creds-changed')); } catch { /* no window */ }
    }
  } catch { /* couldn't persist — the caller still gets the model for this run */ }

  return next;
}
