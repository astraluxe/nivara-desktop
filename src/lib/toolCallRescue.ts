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

// ─── Finding the call, whatever the model wrapped it in ──────────────────────
//
// MEASURED against the live NVIDIA endpoint, one system prompt, six models. Every one was told to
// reply with exactly `<tool_call>{…}</tool_call>`. What actually came back:
//
//   nemotron-3.5-lightning-30b   <tool_call>{…}</tool_call>     as asked
//   meta/llama-3.1-70b           <tool_call>{…}</tool_call>     as asked
//   minimax-m3                   <tool_call>{…}</tool_call>     as asked
//   nemotron-super-49b-v1        <TOOL>{…}                      a tag of its own invention
//   nemotron-3-super-120b        { "tool": … }                  NO TAG AT ALL, pretty-printed
//
// The app required one of two exact tags, so the last two were read as final answers. The 120B —
// the biggest model on the account that answers — could never call a tool at all, and its bare
// JSON was then stripped from the visible text as machinery, leaving an empty turn.
//
// No prompt fixes this: the models were told, and a large model's habits beat an instruction.
// So the search is widened to what they really do. The JSON object itself is the reliable part —
// a `"tool"` or `"name"` key with a known tool name — and the wrapper is treated as decoration.

/** Tags models actually use, beyond the two the prompt asks for. */
const CALL_TAGS = ['tool_call', 'tool_code', 'TOOL', 'tool', 'function_call', 'function', 'invoke', 'action'];

/**
 * Pull the tool-call JSON out of a reply, however it is wrapped — or not wrapped.
 *
 * Returns the raw JSON text, for the caller's existing parser to handle. Deliberately does NOT
 * parse: the callers already have layered recovery for truncated and malformed JSON, and this is
 * about FINDING the call, not understanding it.
 */
export function findToolCallJson(text: string): string | null {
  const s = String(text || '');
  // 1. A properly closed tag, in any of the spellings seen in the wild.
  for (const tag of CALL_TAGS) {
    const m = s.match(new RegExp(`<${tag}>\s*([\s\S]*?)\s*</${tag}>`, 'i'));
    if (m?.[1]?.trim().startsWith('{')) return m[1].trim();
  }
  // 2. An OPEN tag with no closing one — common when a stop sequence clipped the end.
  for (const tag of CALL_TAGS) {
    const at = s.toLowerCase().indexOf(`<${tag.toLowerCase()}>`);
    if (at < 0) continue;
    const after = s.slice(at + tag.length + 2).trim();
    if (after.startsWith('{')) {
      const bal = balanced(after);
      if (bal) return bal;
    }
  }
  // 3. No tag whatsoever. Accept a bare object ONLY when it names a tool — a JSON example inside a
  //    prose answer must not be executed, so the key has to be there and the value a plain
  //    identifier, not a sentence.
  // LOWERCASE AND UNDERSCORES ONLY, for the untagged case. Every tool this app has is named that
  // way (query_table, save_to_brain, browser_navigate), and the restriction is what stops a JSON
  // EXAMPLE inside a prose answer from being executed: {"name":"Amogh","city":"Pune"} is a person
  // in a sentence, not a call, and it matched happily until this was tightened. With no tag to go
  // on, the name itself is the only evidence there is.
  const bare = s.match(/\{[\s\S]*?"(?:tool|name|tool_name)"\s*:\s*"[a-z][a-z0-9_]{2,48}"[\s\S]*?\}/);
  if (bare) {
    const bal = balanced(s.slice(s.indexOf(bare[0])));
    if (bal) return bal;
  }
  return null;
}

/** The first complete {...} from the start of a string, counting braces outside of strings. */
function balanced(src: string): string | null {
  const s = String(src || '');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;   // never closed — the caller's truncation recovery handles it
}
