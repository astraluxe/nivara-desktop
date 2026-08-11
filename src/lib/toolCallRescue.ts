// ─── When the model writes the tool call instead of making it ────────────────
//
// The boss answered a work order with three lines of literal
// `delegate_to_agent("Nyx.Research", "Research …")` in the message body, then told the user what it
// was "doing in parallel". Nothing ran. No agent was called, no tool executed, and the reply read
// like work in progress — which is the most expensive kind of failure, because the user waits.
//
// The instructions that produced it have been fixed, but instruction is a floor, not a guarantee:
// any model, on any provider, can drop out of the tool-call format under a long prompt. So this is
// the deterministic catch underneath. If a finished answer contains printed calls and no real one,
// the calls are recovered and re-issued properly.
//
// Deliberately narrow. It only fires when there is NO real tool call in the message, only for the
// two delegation tools, and only when the agent named resolves to one that exists — because turning
// prose into an action the user did not ask for is a worse failure than the one it fixes.

export interface PrintedCall { agentKey: string; task: string }

/** True if the text already contains a real tool call — in which case nothing here should run. */
export function hasRealToolCall(text: string): boolean {
  return /<tool_call>|<tool_code>/.test(text || '');
}

/**
 * Pull `delegate_to_agent("agent", "task")` style calls out of prose.
 *
 * `resolve` maps whatever the model wrote — an agent key, or a display handle like "Nyx.Research" —
 * onto a real agent key, and returns null when it matches nothing. A call naming an agent that does
 * not exist is dropped rather than guessed at.
 */
export function extractPrintedCalls(text: string, resolve: (name: string) => string | null): PrintedCall[] {
  const out: PrintedCall[] = [];
  if (!text) return out;
  // Both quote styles, optional whitespace and newlines between the arguments, and an optional
  // leading marker (a bullet, a backtick, "1.") because models like to format these as a list.
  const re = /delegate_to_agent\s*\(\s*(["'`])([\s\S]*?)\1\s*,\s*(["'`])([\s\S]*?)\3\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = resolve(m[2].trim());
    const task = m[4].replace(/\s+/g, ' ').trim();
    if (!key || task.length < 10) continue;
    if (out.some((c) => c.agentKey === key)) continue;   // one turn each, same as the real loop
    out.push({ agentKey: key, task });
    if (out.length >= 4) break;                          // plan_workflow's own ceiling
  }
  return out;
}

/**
 * Turn recovered calls into the tool call that should have been made.
 *
 * More than one goes to plan_workflow, because that is what the boss is told to use for compound
 * work and what actually runs a pipeline; a single one goes to delegate_to_agent. Returns null when
 * there is nothing to rescue, so the caller can leave the answer exactly as it is.
 */
export function rescuePrintedCalls(text: string, resolve: (name: string) => string | null): string | null {
  if (hasRealToolCall(text)) return null;
  const calls = extractPrintedCalls(text, resolve);
  if (!calls.length) return null;
  if (calls.length === 1) {
    return `<tool_call>${JSON.stringify({ tool: 'delegate_to_agent', agent_key: calls[0].agentKey, task: calls[0].task })}</tool_call>`;
  }
  return `<tool_call>${JSON.stringify({
    tool: 'plan_workflow',
    delegations: JSON.stringify(calls.map((c) => ({ agent_key: c.agentKey, task: c.task }))),
  })}</tool_call>`;
}

// ─── One shape out, whatever shape came in ───────────────────────────────────
//
// "I tried to use a tool but the response could not be parsed. Please try rephrasing your request."
//
// The user hit that on a 550B model, and rephrasing was never going to help. The system prompt
// asks for parameters alongside "tool":
//
//   {"tool":"web_search","query":"weather in Bangalore"}
//
// …but the retry sent when a call fails to parse told the model something else entirely:
//
//   {"name":"<tool>","arguments":{…}}
//
// So the recovery path TAUGHT the model a shape the parser cannot read. One malformed call became
// a permanent failure: the model obeyed the correction, emitted name/arguments, `parsed.tool` came
// back undefined, and the turn died with an apology and a suggestion to rephrase.
//
// The retry text is fixed, but that alone would be brittle. {"name":…,"arguments":…} is the shape
// OpenAI-compatible models emit natively, and a big model will produce it whatever the prompt says
// — it is what it was trained on. So both are simply accepted, along with the "function" wrapper
// some providers add. Being liberal here costs nothing and removes a whole class of dead turn.

/** Every key a model might use for the tool's name. */
const NAME_KEYS = ['tool', 'name', 'tool_name', 'function_name', 'recipient_name', 'action'];
/** Every key a model might nest the parameters under. */
const ARG_KEYS = ['args', 'arguments', 'parameters', 'params', 'input', 'tool_input'];

/**
 * Read a parsed tool-call object into { tool, args }, whatever shape it arrived in.
 *
 * Returns null when there is no recognisable tool name, so callers keep their existing
 * "could not parse" path for genuine rubbish.
 */
export function normaliseToolCall(parsed: unknown): { tool: string; args: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  let obj = parsed as Record<string, unknown>;

  // Some providers wrap it: {"type":"function","function":{"name":…,"arguments":…}}
  const wrapper = obj.function ?? obj.tool_call ?? obj.toolCall;
  if (wrapper && typeof wrapper === 'object') obj = wrapper as Record<string, unknown>;

  let tool = '';
  for (const k of NAME_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) { tool = v.trim(); break; }
  }
  if (!tool) return null;

  // Parameters: nested under one of the arg keys, or spread across the root alongside the name.
  let args: Record<string, unknown> = {};
  for (const k of ARG_KEYS) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) { args = { ...(v as Record<string, unknown>) }; break; }
    // Some models send `arguments` as a JSON STRING rather than an object.
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      try { args = { ...(JSON.parse(v) as Record<string, unknown>) }; break; } catch { /* fall through */ }
    }
  }
  // Root-level parameters are merged UNDER the nested ones, so an explicit `arguments` block wins
  // over a stray root key of the same name.
  const root: Record<string, unknown> = { ...obj };
  for (const k of [...NAME_KEYS, ...ARG_KEYS, 'type', 'function', 'tool_call', 'toolCall']) delete root[k];
  args = { ...root, ...args };

  return { tool, args };
}
