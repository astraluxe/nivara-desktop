// BACKUP of the live `krew-stream` Edge Function (version 40, verify_jwt: true), saved 2 Oct 2026
// before it was replaced by a "retired" stub when the hosted adris.tech plan was switched off.
// It streamed chat through adris.tech's GEMINI_API_KEY. To restore: redeploy this file as
// `krew-stream` with verify_jwt true.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const PLAN_LIMITS: Record<string, number | null> = {
  free:     100_000,
  explore:  100_000,
  solo:     4_000_000,
  builder:  16_000_000,
  business: 50_000_000,
  custom:   null,
};

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - s.length % 4) % 4);
    return JSON.parse(atob(b64(parts[1]))) as Record<string, unknown>;
  } catch { return null; }
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jsonError = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const GEMINI_MODEL = 'gemini-3-flash-preview';

// ── Gemini explicit context caching (cost lever) ───────────────────────────────────
// The Krew system prompt is large (~11k tokens) and is re-sent on every turn. Caching it lets Google
// bill those input tokens at a steep discount on repeat calls — the single biggest cost saving. This
// is BEST-EFFORT: any failure returns null and we send the prompt inline (the original behaviour), and
// if a cached request is rejected we retry inline once. So it can never break the endpoint — worst
// case it simply doesn't save money. A 20-minute TTL keeps one cache alive across a user's whole chat
// session (max reuse) while storage cost stays negligible; a Map de-dupes per-isolate.
const sysCache = new Map<string, { name: string; expiresAt: number }>();
function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
async function getSystemCache(systemPrompt: string, key: string): Promise<string | null> {
  try {
    // Only worth caching a substantial prompt; small ones may also be below Gemini's min cache size.
    if (!systemPrompt || systemPrompt.length < 8000) return null;
    const id = hashStr(systemPrompt);
    const now = Date.now();
    const hit = sysCache.get(id);
    if (hit && hit.expiresAt > now) return hit.name;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${GEMINI_MODEL}`,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        ttl: '1200s',
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const name = data?.name;
    if (typeof name !== 'string' || !name) return null;
    sysCache.set(id, { name, expiresAt: now + 1_140_000 }); // expire just before the 1200s TTL
    if (sysCache.size > 200) { for (const k of sysCache.keys()) { sysCache.delete(k); if (sysCache.size <= 150) break; } }
    return name;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')   return jsonError('Method not allowed', 405);

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return jsonError('Not signed in to adris.tech.', 401);
  const jwt = auth.slice(7);

  const payload = decodeJwtPayload(jwt);
  if (!payload?.sub) return jsonError('Session expired. Please sign in again.', 401);
  const userId = payload.sub as string;

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Count usage over the user's BILLING period (users.usage_period_start), NOT a hardcoded calendar
  // month start. The app meters against usage_period_start too (tokenTracker.getMonthlyUsage); when a
  // user's billing anchor is later than the 1st, counting from the 1st wrongly included pre-anchor
  // usage and 429'd users who actually had allowance left (client showed plenty remaining). Falling
  // back to the calendar month start keeps the old behaviour for rows where the anchor is null.
  const calMonthStart = new Date();
  calMonthStart.setUTCDate(1); calMonthStart.setUTCHours(0, 0, 0, 0);

  const userResult = await admin.from('users').select('plan, usage_period_start').eq('id', userId).single();
  const plan  = (userResult.data?.plan as string) ?? 'free';
  const limit = PLAN_LIMITS[plan] ?? 100_000;
  const periodStart = (userResult.data?.usage_period_start as string | null) ?? calMonthStart.toISOString();

  let used = 0;
  if (limit !== null) {
    const usageResult = await admin.from('token_usage').select('tokens_consumed').eq('user_id', userId).gte('created_at', periodStart);
    const rows = (usageResult.data ?? []) as Array<{ tokens_consumed: number }>;
    used = rows.reduce((s, r) => s + (r.tokens_consumed ?? 0), 0);
  }

  if (limit !== null && used >= limit) {
    return jsonError(
      (plan === 'free' || plan === 'explore')
        ? `You've used all your free AI credits this month. Upgrade to Solo at adris.tech/pricing to continue.`
        : `You've reached your monthly AI limit. Switch to Own Key mode to continue, or upgrade your plan at adris.tech/pricing.`,
      429,
    );
  }

  let messages: { role: string; content: string }[] = [];
  let systemPrompt = '';
  try {
    const body  = await req.json();
    messages     = body.messages     ?? [];
    systemPrompt = body.systemPrompt ?? '';
  } catch { return jsonError('Invalid request body.', 400); }

  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiKey) return jsonError('Platform AI not configured. Contact support.', 500);

  const geminiMsgs = messages.map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const reqBody: Record<string, unknown> = {
    contents:         geminiMsgs,
    generationConfig: { maxOutputTokens: 32768 },
  };
  // Serve the system prompt from a cache when possible (big input-cost saving); otherwise inline.
  let cacheName: string | null = null;
  if (systemPrompt) cacheName = await getSystemCache(systemPrompt, geminiKey);
  if (cacheName) reqBody.cachedContent = cacheName;
  else if (systemPrompt) reqBody.systemInstruction = { parts: [{ text: systemPrompt }] };

  const model = GEMINI_MODEL;
  const tier  = plan === 'builder' || plan === 'business' || plan === 'custom' ? 'flash-3-paid' : 'flash-3-free';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiKey}&alt=sse`;
  let geminiResp = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody),
  });
  // If a cached request is rejected (expired/invalid cache), drop the cache and retry INLINE once —
  // this makes caching completely safe: any cache problem degrades to the original behaviour.
  if (!geminiResp.ok && cacheName) {
    try { sysCache.delete(hashStr(systemPrompt)); } catch { /* ignore */ }
    delete reqBody.cachedContent;
    if (systemPrompt) reqBody.systemInstruction = { parts: [{ text: systemPrompt }] };
    geminiResp = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody),
    });
  }
  if (!geminiResp.ok) {
    const t = await geminiResp.text();
    return jsonError(`AI error: ${t.slice(0, 300)}`, 500);
  }

  let totalChars   = 0;
  let wasTruncated = false;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = geminiResp.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data: ')) continue;
            try {
              const json      = JSON.parse(t.slice(6));
              const candidate = json?.candidates?.[0];
              if (!candidate) continue;
              const parts = (candidate?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
              let chunkText = '';
              for (const part of parts) {
                if (part.thought === true) continue;
                if (typeof part.text === 'string') chunkText += part.text;
              }
              if (candidate.finishReason === 'MAX_TOKENS') wasTruncated = true;
              if (chunkText) {
                totalChars += chunkText.length;
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`));
              }
            } catch { /* skip malformed SSE */ }
          }
        }
        if (wasTruncated) controller.enqueue(new TextEncoder().encode('data: [TRUNCATED]\n\n'));
        const tokens = Math.max(1, Math.ceil(totalChars / 4));
        await admin.from('token_usage').insert({
          user_id: userId, task_type: 'krew_chat',
          tokens_consumed: tokens, model_used: model, model_tier: tier, credits_consumed: 0,
        });
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      } catch (e) { controller.error(e); }
      finally     { controller.close(); }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...CORS },
  });
});
