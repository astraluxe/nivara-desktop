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
  [/nemotron-3-ultra|llama-3\.[13]-70b|llama-3\.3-70b/i, 128_000],
  [/gpt-4o|gpt-4\.1|o[34]-/i, 128_000],
  [/claude-/i, 200_000],
  [/gemini-/i, 1_000_000],
  [/llama-3\.[13]-8b-instant|llama-3\.1-8b-instant/i, 32_768],
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
