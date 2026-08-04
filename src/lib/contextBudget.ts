// ─── Fitting the prompt to the model that will actually read it ───────────────
//
// The copilot's prompts were sized by hard-coded slices — 6000 chars of thread, 4000 of owner
// context — chosen for a hosted model with a huge window. On a free NVIDIA model with a small one
// the prompt simply overflowed: the provider truncates from the FRONT, which silently eats the
// system prompt and the JSON schema, so the model answers with prose and the whole thing reads as
// "the AI returned nothing usable". Same failure the local engine had at -c 4096.
//
// So: know roughly how much room the chosen model has, and spend it deliberately — reserve space
// for the reply, keep the system prompt whole (it carries the rules and the output schema), and
// trim the big evidence blocks to fit rather than letting the provider cut wherever it lands.

const ACTIVE_KEY = 'nv-active-model';

/** Rough context windows in TOKENS, by model-id fragment. First match wins, so order matters. */
const WINDOWS: Array<[RegExp, number]> = [
  // Small free-tier workhorses — the ones a free NVIDIA/Groq key can actually call.
  [/nemotron-mini|nemotron-nano-4b|llama-3\.2-(1|3)b/i, 8_192],
  [/llama-3\.1-8b|gpt-oss-20b|nemotron-nano-9b|step-3\.7-flash/i, 32_768],
  [/nemotron-3-nano|nemotron-nano-12b|inkling/i, 32_768],
  [/llama-3\.3-nemotron-super|nemotron-3-super/i, 65_536],
  // NOTE: nemotron-3-ultra is NOT listed here — it is a 1M-context model and is matched lower
  // down. First match wins, so leaving it here would have silently capped it at 128k.
  [/llama-3\.[13]-70b|llama-3\.3-70b/i, 128_000],
  [/gpt-4o|gpt-4\.1|o[34]-/i, 128_000],
  [/claude-/i, 200_000],
  [/gemini-/i, 1_000_000],
  [/llama-3\.[13]-8b-instant|llama-3\.1-8b-instant/i, 32_768],
  // The rest of NVIDIA's free catalogue. Several of these are long-context models, and treating
  // them as a 32k default threw away room the user is entitled to use.
  [/nemotron-3-ultra|deepseek-v4|kimi-k2/i, 1_000_000],
  [/glm-5|minimax-m3|laguna-xs/i, 128_000],
  [/mistral-medium-3\.5|mistral-large/i, 128_000],
  [/gemma-4-31b|diffusiongemma/i, 32_768],
  [/ising-calibration/i, 16_384],
];

const DEFAULT_TOKENS = 32_768;      // safe middle ground for an unrecognised BYOK model
const LOCAL_TOKENS   = 8_192;       // matches the engine's -c flag
const HOSTED_TOKENS  = 1_000_000;   // adris.tech runs a large-window model

/** Roughly 4 characters per token for English prose. Deliberately pessimistic. */
export const CHARS_PER_TOKEN = 3.6;

/** Remember what the last call actually used, so budgeting is based on reality, not a guess. */
export function noteActiveModel(mode: string, modelName: string, localModel?: string): void {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ mode, modelName: modelName || '', localModel: localModel || '' })); } catch { /* quota */ }
}

/** Context window, in tokens, for a NAMED model — so the connection popup can tell the user how
 *  much room the model they are about to pick actually has, instead of them finding out when a
 *  long job comes back wrong. Same table the budgeter uses, so the two can never disagree. */
export function contextWindowFor(modelId: string): number {
  for (const [re, n] of WINDOWS) if (re.test(modelId || '')) return n;
  return DEFAULT_TOKENS;
}

/** Context window, in tokens, of the model the next call will use. */
export function activeContextTokens(): number {
  let mode = '', modelName = '';
  try {
    const v = JSON.parse(localStorage.getItem(ACTIVE_KEY) || '{}');
    mode = String(v.mode || ''); modelName = String(v.modelName || '');
  } catch { /* nothing recorded yet */ }
  if (mode === 'local') return LOCAL_TOKENS;
  if (mode === 'nivara' || (!mode && !modelName)) return HOSTED_TOKENS;
  for (const [re, n] of WINDOWS) if (re.test(modelName)) return n;
  return DEFAULT_TOKENS;
}

/**
 * How many characters of EVIDENCE (thread, owner context, documents) this prompt may carry.
 *
 * Reserves room for the reply and for the system prompt, then leaves a safety margin — an
 * over-long prompt is not a slow answer, it is a wrong one, because the front of it gets cut.
 */
export function evidenceCharBudget(systemChars = 4_000, reserveReplyTokens = 1_400): number {
  const total = activeContextTokens();
  const usable = Math.max(2_000, total - reserveReplyTokens - Math.ceil(systemChars / CHARS_PER_TOKEN));
  // Never spend more than 70% of the window on evidence, and cap it where a bigger prompt stops
  // buying better answers.
  return Math.min(Math.floor(usable * CHARS_PER_TOKEN * 0.7), 24_000);
}

/**
 * Share a budget across several blocks, largest-trimmed-first.
 *
 * Trimming everything by the same proportion throws away a short, decisive block (the owner's
 * availability) to make room for a long, repetitive one (a twenty-message thread). Small blocks are
 * kept whole for as long as possible; only the biggest is cut.
 */
export function fitSections(sections: string[], budget: number): string[] {
  const lens = sections.map((s) => (s || '').length);
  const total = lens.reduce((a, b) => a + b, 0);
  if (total <= budget) return sections.map((s) => s || '');
  const out = [...lens];
  let over = total - budget;
  while (over > 0) {
    let big = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[big]) big = i;
    if (out[big] <= 400) break;                       // everything is already small — stop cutting
    const second = out.reduce((m, v, i) => (i !== big && v > m ? v : m), 0);
    const cut = Math.min(over, Math.max(200, out[big] - Math.max(second, 400)));
    out[big] -= cut;
    over -= cut;
  }
  return sections.map((s, i) => {
    const src = s || '';
    if (src.length <= out[i]) return src;
    // Keep the END of a conversation — the most recent messages are what the reply must answer.
    return `…[earlier trimmed to fit this model's context]\n${src.slice(src.length - out[i])}`;
  });
}

// ─── How much bulk work one call may ask for ─────────────────────────────────
//
// Bulk loops (refining 30 messages, drafting a batch, filling a table) used to choose their batch
// size from the CONNECTION type alone — "local model or not". That put a free NVIDIA key driving a
// 550B model in the same bucket as the hosted service and asked it for thirty JSON objects in one
// response. It truncates, the JSON will not parse, and the user waits the full timeout to be told
// nothing came back.
//
// Size it by what the model can actually hold instead. The same measured context window the model
// picker shows as High / Medium / Basic is the honest signal: a 1M-window model can take a big
// batch, a 32k one cannot, and no amount of connection-type guessing knows the difference.
export type BulkTier = 'high' | 'medium' | 'basic';

export interface BulkPlan {
  /** Most items to attempt in total. */
  max: number;
  /** Items per request — the number that actually decides whether the answer parses. */
  batch: number;
  tier: BulkTier;
  /** Shown to the user when a bigger model on the SAME key would do this markedly better. */
  advice: string;
}

export function bulkPlan(mode: string, opts: { hostedMax?: number } = {}): BulkPlan {
  const hostedMax = opts.hostedMax ?? 30;
  if (mode === 'local') {
    return { max: 10, batch: 3, tier: 'basic',
      advice: 'A downloaded model works through these slowly. A free NVIDIA or Groq key (Connect Apps) finishes the same job in a fraction of the time and costs no adris.tech tokens.' };
  }
  if (mode !== 'own_key') return { max: hostedMax, batch: hostedMax, tier: 'high', advice: '' };

  const win = activeContextTokens();
  if (win >= 200_000) return { max: hostedMax, batch: 12, tier: 'high', advice: '' };
  if (win >= 32_000) {
    return { max: 20, batch: 6, tier: 'medium',
      advice: 'Your model has a mid-sized context window, so this runs a few at a time. Picking a High-capability model on the same key (Models → the connection bar) lets it do more per pass and finish sooner.' };
  }
  return { max: 12, batch: 3, tier: 'basic',
    advice: 'Your model has a small context window, so this has to go a few at a time and can still struggle. On the same key there are High-capability models listed in the connection bar — switching to one of those is the single biggest speed-up available here, and costs nothing extra.' };
}
