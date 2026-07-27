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
  if (/no longer available|model_not_found|model not found|unknown model|invalid model|does not exist|decommissioned|has been (removed|retired|deprecated)|not a valid model/.test(s)) return true;
  // NVIDIA answers a withdrawn model with a bare 410; a 404 that mentions the model is the same thing.
  if (/\b410\b/.test(s)) return true;
  return /\b404\b/.test(s) && /model/.test(s);
}

/**
 * Best live model this key can actually call. Asks the provider's own /models endpoint, so we never
 * store an id that isn't in the catalogue. Returns '' when the provider can't be reached and there
 * is no safe default.
 */
export async function pickBestModel(provider: Provider, apiKey: string, exclude: string[] = []): Promise<string> {
  const bad = new Set(exclude.filter(Boolean).map((s) => s.toLowerCase()));
  const live = (await fetchRankedModels(provider, apiKey).catch(() => [])).filter((m) => !bad.has(m.id.toLowerCase()));

  for (const want of PREFERRED[provider] ?? []) {
    const hit = live.find((m) => m.id.toLowerCase() === want.toLowerCase());
    if (hit) return hit.id;
  }
  const general = live.filter((m) => !SPECIALIST.test(m.id));
  const chosen = general.find((m) => m.tier === 'smart') ?? general[0] ?? live[0];
  if (chosen) return chosen.id;

  // Catalogue unreachable (offline, or the key can't list models) — fall back to a known id.
  const fallback = (PREFERRED[provider] ?? [])[0] ?? PROVIDERS[provider]?.defaultModel ?? '';
  return fallback && !bad.has(fallback.toLowerCase()) ? fallback : '';
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
