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
  // RE-MEASURED 2026-08-11 against a live free-tier key. Every number below was observed, not
  // assumed, on two tests that matter more than benchmarks: can it return clean JSON, and can it
  // emit a tool call this app can parse. A model that answers beautifully in prose is useless here.
  //
  //   model                                    JSON    tool call   time
  //   nvidia/nemotron-3.5-lightning-30b-a3b    ok      YES         0.9s   <- fastest AND correct
  //   openai/gpt-oss-20b                       ok      YES         1.5s
  //   meta/llama-3.1-8b-instruct               ok      YES         2.1s
  //   nvidia/nemotron-3-nano-30b-a3b           ok      YES         3.3s
  //   nvidia/nemotron-3-super-120b-a12b        ok      -          24.8s   <- was FIRST here
  //   meta/muse-glimmer-30b                    -       no          9.9s   (returned empty)
  //   nvidia/llama-3.3-nemotron-super-49b-v1.5 ok      TIMEOUT     40s
  //   meta/llama-3.2-3b-instruct               TIMEOUT -           40s    <- gone
  //   thinkingmachines/inkling                 prose   no          7.6s
  //   nvidia/nemotron-3-ultra-550b-a55b        -       TIMEOUT     45s
  //   z-ai/glm-5.2                             -       TIMEOUT     45s
  //   deepseek-ai/deepseek-v4-pro              410 Gone (withdrawn from the free endpoint)
  //
  // The old first choice took TWENTY-FIVE SECONDS to answer "give me a JSON object", and every
  // agent step in the app waits on a call like that. It is kept only as a last resort for its size.
  // llama-3.2-3b and inkling are removed: one no longer answers, the other cannot emit a tool call.
  //
  // This is a starting ORDER, not a guarantee — availability moves, which is the whole reason
  // every candidate is still probed before use.
  nvidia: [
    'nvidia/nemotron-3.5-lightning-30b-a3b',
    'openai/gpt-oss-20b',
    'meta/llama-3.1-8b-instruct',
    'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nemotron-3-super-120b-a12b',
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
  // Forget after 2 hours, not a week. Availability is transient, not permanent — the same NVIDIA
  // model answered in 4.3s and then hung an hour later on the same key. A week-long ban would
  // permanently retire a model over one busy afternoon.
  return !!at && Date.now() - at < 2 * 3_600_000;
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

// ─── Measured model scan ──────────────────────────────────────────────────────
// PREFERRED above is a hand-written order, and hand-written orders go stale: it was built from one
// sweep of one key at one moment, and NVIDIA's free tier grants different models to different
// accounts and changes what it grants over time. So the app measures the user's OWN key instead —
// probe every chat model in their live catalogue, record how fast it answers and whether it can
// return JSON, and rank from that. PREFERRED then survives only as the cold-start order used before
// a scan has ever run.
//
// Nothing here is hardcoded to a model NAME. A model NVIDIA adds tomorrow is picked up by the next
// scan on its merits, and one that quietly stops working drops out of the ranking on its own.

export interface ModelScanRow {
  id: string;
  /** Milliseconds to a complete short answer. The number the user feels as "slow". */
  ms: number;
  /** Did it return the JSON it was explicitly asked for? This app runs on JSON — reply plans, deck
   *  specs, verification results — so a fast model that answers in prose is not usable. */
  jsonOk: boolean;
  /** Answered at all. False = listed in the catalogue but hangs or rejects on this account. */
  ok: boolean;
  /** Rough context window in tokens, so the popup can show what a model has room for. */
  window: number;
  /** 'smart' = big/agentic/reasoning family, 'fast' = small. From the id, via rankChatModel. */
  tier?: 'smart' | 'fast' | 'other';
  /** Why it failed, when it did — see ProbeFailure. Absent on rows from before this was recorded. */
  reason?: ProbeFailure;
}

export interface ModelScan {
  provider: string;
  /** Last 6 chars of the key it was measured on — results are never reused across keys, because
   *  access genuinely differs per account. */
  keyTail: string;
  scannedAt: number;
  rows: ModelScanRow[];
}

const SCAN_KEY = 'nv-model-scan';
const SCAN_FRESH_MS = 12 * 3_600_000;   // a day's work; availability drifts slower than that

function keyTail(apiKey: string): string { return (apiKey || '').slice(-6); }

function allScans(): ModelScan[] {
  try { const v = JSON.parse(localStorage.getItem(SCAN_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** The saved scan for this provider+key, or null. */
export function loadScan(provider: string, apiKey: string): ModelScan | null {
  const t = keyTail(apiKey);
  return allScans().find((s) => s.provider === provider && s.keyTail === t) ?? null;
}

export function scanIsFresh(scan: ModelScan | null): boolean {
  return !!scan && Date.now() - scan.scannedAt < SCAN_FRESH_MS && scan.rows.some((r) => r.ok);
}

function saveScan(scan: ModelScan): void {
  try {
    const rest = allScans().filter((s) => !(s.provider === scan.provider && s.keyTail === scan.keyTail));
    // Keep the last few keys' results only — this is a cache, not an archive.
    localStorage.setItem(SCAN_KEY, JSON.stringify([scan, ...rest].slice(0, 4)));
  } catch { /* quota */ }
}

/**
 * How long this model took to answer when it was last measured, or null if it never has been.
 *
 * Searches every saved scan rather than needing the key, because a model id is unique to its
 * provider and the caller (deep inside the streaming path) has no clean way to know which key the
 * scan was recorded against.
 *
 * This exists to tell SLOW apart from DEAD. The streaming path gives a model 40 seconds to say its
 * first word and treats silence as "this model is gone" — which is right for one the account cannot
 * really use, and wrong for one that genuinely takes half a minute to think. Without this the app
 * cannot distinguish them, so it retires a working model mid-task and swaps in a weaker one.
 */
export function measuredMsFor(modelId: string): number | null {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  let best: number | null = null;
  for (const s of allScans()) {
    for (const r of s.rows) {
      if (r.id.toLowerCase() !== id || !r.ok) continue;
      // Slowest observation wins: the point is to be patient enough, not accurate on average.
      if (best === null || r.ms > best) best = r.ms;
    }
  }
  return best;
}

/** Beyond this, a model is "slow" no matter how clever — a user waiting 25 seconds for a chat reply
 *  has already decided the app is broken. Measured: the models that felt unusable were 24–27s. */
const SLOW_MS = 8_000;

/**
 * Models that answered, best first.
 *
 * Three things decide it, in this order:
 *   1. Can it return JSON? This app runs on JSON — reply plans, deck specs, verification results —
 *      so one that answers in prose is not usable however clever it sounds.
 *   2. Is it fast enough to sit in front of? A capable model that takes 25 seconds is demoted, not
 *      promoted, whatever its size.
 *   3. Then capability before size. Among models that are both reliable and quick, the bigger
 *      agentic family wins: the user's own experience is that 7–9B models are poor at real work,
 *      and raw speed alone would keep handing them the smallest thing on the list.
 *
 * All three are read off measurements of THIS key. No model is named anywhere.
 */
export function rankScan(scan: ModelScan | null): ModelScanRow[] {
  if (!scan) return [];
  const tierRank = (t?: string) => (t === 'smart' ? 0 : t === 'other' ? 1 : 2);
  const bucket = (r: ModelScanRow) => (r.jsonOk ? 0 : 2) + (r.ms > SLOW_MS ? 1 : 0);
  return scan.rows.filter((r) => r.ok)
    .slice()
    .sort((a, b) => bucket(a) - bucket(b) || tierRank(a.tier) - tierRank(b.tier) || a.ms - b.ms);
}

/**
 * WHY a probe failed, because the answers are not interchangeable.
 *
 * 'dead' is the only one that justifies retiring a model: the account genuinely cannot call it
 * ("404 not found for account", "model does not exist", no access). A rate limit means "ask me
 * later" and a timeout means "I did not wait long enough" — treating either as death is how a
 * working model disappears. A scan sweeps up to 90 models in batches of six against a free key, so
 * 429s during it are entirely expected, and every one of them used to blocklist a model for two
 * hours and drop it out of the picker.
 */
export type ProbeFailure = 'ok' | 'rate_limit' | 'timeout' | 'dead' | 'unknown';

export function classifyProbeFailure(msg: string): ProbeFailure {
  const m = (msg || '').toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|quota|capacity/.test(m)) return 'rate_limit';
  if (/timed? ?out|timeout|deadline|aborted/.test(m)) return 'timeout';
  if (/\b(404|403|401)\b|not found|does not exist|no access|unauthorized|not authorized|invalid model|unknown model|decommissioned/.test(m)) return 'dead';
  return 'unknown';
}

/**
 * Probe one model and MEASURE it: does it answer, how fast, and can it return JSON on request.
 * One call does both jobs — asking for a tiny JSON object costs the same as asking for "hi".
 */
export async function probeModelDetailed(
  provider: Provider, apiKey: string, model: string, timeoutMs = 12_000,
): Promise<{ ok: boolean; ms: number; jsonOk: boolean; reason: ProbeFailure }> {
  const endpoint = PROVIDERS[provider]?.endpoint;
  const t0 = Date.now();
  if (!endpoint || !apiKey || !model) return { ok: false, ms: 0, jsonOk: false, reason: 'dead' };
  try {
    const raw = await invoke<string>('krew_http_call', {
      method: 'POST', url: endpoint,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with only this JSON and nothing else: {"ok":1}' }],
        max_tokens: 24, temperature: 0, stream: false,
      }),
      timeoutMs,
    });
    const ms = Date.now() - t0;
    if (!raw) return { ok: false, ms, jsonOk: false, reason: 'unknown' };
    const j = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown; detail?: unknown };
    if (j.error || j.detail) return { ok: false, ms, jsonOk: false, reason: classifyProbeFailure(JSON.stringify(j.error ?? j.detail)) };
    if (!Array.isArray(j.choices) || !j.choices.length) return { ok: false, ms, jsonOk: false, reason: 'unknown' };
    const content = String(j.choices[0]?.message?.content ?? '');
    // A reasoning model wraps its answer in <think>…</think>; that is not a JSON failure, so strip
    // it before judging. Anything still containing a bare {"ok"…} object counts.
    const body = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?|```/gi, '');
    const jsonOk = /\{\s*"ok"\s*:\s*1\s*\}/.test(body);
    return { ok: true, ms, jsonOk, reason: 'ok' };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, jsonOk: false, reason: classifyProbeFailure(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Sweep every chat model this key lists, in small parallel batches, and save the measurements.
 *
 * Meant to be fired and forgotten (`void scanModels(...)`) right after a key is connected: the user
 * keeps working on whatever model is current while this runs in the background, and the ranking is
 * simply better the next time a model has to be chosen. `onProgress` is for the popup's live count.
 */
export async function scanModels(
  provider: Provider, apiKey: string,
  onProgress?: (done: number, total: number, row?: ModelScanRow) => void,
  opts: { batch?: number; timeoutMs?: number; max?: number } = {},
): Promise<ModelScan> {
  const { contextWindowFor } = await import('./contextBudget');
  const batch = opts.batch ?? 6;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const live = await fetchRankedModels(provider, apiKey).catch(() => []);
  // fetchRankedModels already drops embedding/vision/etc. Domain specialists are listed but never
  // auto-picked, so measuring them is wasted time on a free key's rate limit.
  const candidates = live.filter((m) => !SPECIALIST.test(m.id)).slice(0, opts.max ?? 90);
  const ids = candidates.map((m) => m.id);
  const tierById = new Map(candidates.map((m) => [m.id, m.tier] as const));

  const rows: ModelScanRow[] = [];
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    const measured = await Promise.all(chunk.map(async (id) => {
      const r = await probeModelDetailed(provider, apiKey, id, timeoutMs);
      return { id, ms: r.ms, jsonOk: r.jsonOk, ok: r.ok, reason: r.reason, window: contextWindowFor(id), tier: tierById.get(id) } as ModelScanRow;
    }));
    for (const row of measured) {
      rows.push(row);
      // Feed the blocklist as we go, so even an interrupted scan leaves the app better off — but
      // ONLY for models the account genuinely cannot call. A 429 or a slow first token during a
      // 90-model sweep says nothing about whether the model works, and blocking on those quietly
      // retired good models and dropped them out of the picker for two hours.
      if (!row.ok && row.reason === 'dead') blockModel(provider, row.id);
      onProgress?.(rows.length, ids.length, row);
    }
  }
  const scan: ModelScan = { provider, keyTail: keyTail(apiKey), scannedAt: Date.now(), rows };
  saveScan(scan);
  try { window.dispatchEvent(new CustomEvent('nv-model-scan-done', { detail: { provider } })); } catch { /* no window */ }
  return scan;
}

/** Run a scan only if there isn't a fresh one already. Safe to call on every connect. */
export function scanModelsIfStale(provider: Provider, apiKey: string): void {
  if (!apiKey || !PROVIDERS[provider]?.endpoint) return;
  if (scanIsFresh(loadScan(provider, apiKey))) return;
  void scanModels(provider, apiKey).catch(() => { /* background work never surfaces an error */ });
}

/**
 * Best model this key can actually call — verified, not assumed. Prefers the MEASURED ranking from
 * a background scan of this key; falls back to the preference list and then the live catalogue,
 * PROBING each candidate and returning the first that genuinely answers.
 */
export async function pickBestModel(provider: Provider, apiKey: string, exclude: string[] = []): Promise<string> {
  const bad = new Set(exclude.filter(Boolean).map((s) => s.toLowerCase()));
  const skip = (id: string) => bad.has(id.toLowerCase()) || isBlocked(provider, id);

  // MEASURED FIRST. A scan of this very key beats any list we shipped: it knows what this account
  // was actually granted, how fast each one is today, and which can return JSON. Every row here has
  // already answered once, so the winner needs no re-probe and the pick is instant.
  const scanned = rankScan(loadScan(provider, apiKey)).filter((r) => !skip(r.id));
  if (scanned[0]) return scanned[0].id;   // rankScan already ordered it: reliable, quick, capable

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
