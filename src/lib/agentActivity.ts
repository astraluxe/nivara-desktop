// ─── What the agent is ACTUALLY doing, in words ───────────────────────────────
//
// For 220 seconds the app said "Thinking…" and nothing else. The work order had a named sheet, a
// named agent and four named filters in it, and the one thing the screen would not say was which of
// those it was on. That is not a cosmetic gap: with no detail, a run that is working and a run that
// has hung look identical, so the only move left is to press Stop — which is what happened, and the
// real query_table result (766 vendor rows) was thrown away with it.
//
// "Thinking…" was never the truth anyway. The model is not thinking in the gap; it is WRITING A
// TOOL CALL, character by character, and the tool name lands in the buffer long before the JSON
// closes. The name is right there — it was being stripped and discarded, because the same regex
// that (rightly) hides the raw XML from the user also hid the only fact worth showing.
//
// So this module reads the half-written call instead of dropping it:
//
//   peekToolIntent()  — pull the tool + its args out of a PARTIAL, unterminated buffer
//   describeIntent()  — turn that into a sentence naming the sheet, the filter, the query
//   toolReceipt()     — after it returns, one line on what came back, counted not guessed
//
// Everything here is pure and synchronous — no model call, no network — so it costs the same on a
// free key as on a paid one. Nothing is inferred: if the buffer does not yet name a tool, these
// return null and the caller says something honest and vague, rather than something specific and
// invented.

export const ACTIVITY_EVENT = 'nv-agent-activity';

export interface AgentActivity {
  /** Display handle, e.g. "Nyx.Research". */
  agent: string;
  agentKey: string;
  /** One line: what is happening right now. */
  headline: string;
  /** Optional second line: which sheet, which filter, which page. */
  detail?: string;
  /** When THIS activity began — the panel counts up from it. */
  startedAt: number;
  phase: 'thinking' | 'tool' | 'writing' | 'idle';
}

let current: AgentActivity | null = null;

/**
 * Broadcast what is happening, so every surface that wants to show it can.
 *
 * The chat paints it into the bubble; the Office floor lights up the desk of whoever is working.
 * Both read the same fact from the same place, so they can never disagree about who is busy.
 */
export function setActivity(a: AgentActivity | null): void {
  // Same late-write problem the chat's status bar had: a stream that resolves after Stop lands one
  // more update on its way out, and the Office desk lights back up with nobody working. Once the
  // bus is silenced it stays silent until a new run explicitly reopens it.
  // Only resumeActivity lifts the silence — clearing it here would let a null write from a dying
  // run re-open the bus for the next straggler behind it.
  if (a && silenced) return;
  current = a;
  try { window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: a })); } catch { /* no window */ }
}

let silenced = false;

/** Stop, and refuse the trailing updates from whatever was already in flight. */
export function silenceActivity(): void {
  silenced = true;
  current = null;
  try { window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: null })); } catch { /* no window */ }
}

/** A new run is starting — the bus may speak again. */
export function resumeActivity(): void { silenced = false; }

export function getActivity(): AgentActivity | null { return current; }

// ─── Reading a half-written tool call ────────────────────────────────────────

/**
 * Pull a string value out of JSON that may stop mid-token.
 *
 * JSON.parse is useless here by definition — the buffer is unterminated, that is the whole point.
 * This walks the characters so an unclosed `"title": "Vendor mast` still yields "Vendor mast",
 * which is enough to name the sheet a second before the call completes.
 */
function partialString(buf: string, key: string): string | undefined {
  const at = buf.indexOf(`"${key}"`);
  if (at < 0) return undefined;
  let i = buf.indexOf(':', at + key.length + 2);
  if (i < 0) return undefined;
  i++;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') {
    // A number or bare token (limit: 200) — read to the next delimiter.
    const m = buf.slice(i).match(/^([^,}\s]+)/);
    return m ? m[1] : undefined;
  }
  i++;
  let out = '';
  while (i < buf.length) {
    const c = buf[i];
    if (c === '\\') {
      const n = buf[i + 1];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === undefined ? '' : n;
      i += 2;
      continue;
    }
    if (c === '"') break;
    out += c;
    i++;
  }
  return out;
}

/**
 * What is this stream about to do? Read from a buffer that is still arriving.
 *
 * Deliberately tolerant of every shape the small models actually emit: a proper
 * `<tool_call>{…}</tool_call>`, a `<tool_code>` variant, and the bare `{"tool":…` with no tag at
 * all (which is also the shape that used to leak a raw escaped table into the chat — see
 * stripToolNoise below).
 */
export function peekToolIntent(buf: string): { tool: string; args: Record<string, string> } | null {
  const src = String(buf || '');
  // Start from the LAST opener, so a buffer carrying an earlier completed call describes the
  // call in flight rather than the one already finished.
  const open = Math.max(src.lastIndexOf('<tool_call>'), src.lastIndexOf('<tool_code>'));
  const tail = open >= 0 ? src.slice(open) : src;
  // The CLOSING quote is required. Without it, a buffer holding `"tool":"query` yields the tool
  // name "query" and the panel announces "Running query" for a frame or two before correcting
  // itself to query_table. A confident wrong label is worse than an honest vague one, and the
  // honest one — "working out the next step" — is what the caller falls back to on null.
  const tool = tail.match(/"tool"\s*:\s*"([a-zA-Z0-9_]+)"/)?.[1];
  if (!tool) return null;
  const args: Record<string, string> = {};
  for (const k of ['title', 'where', 'columns', 'query', 'queries', 'url', 'name', 'agent_key',
                   'task', 'to', 'subject', 'topic', 'limit', 'from', 'label', 'mode', 'kind']) {
    const v = partialString(tail, k);
    if (v !== undefined && v !== '') args[k] = v;
  }
  return { tool, args };
}

/** Shorten a value for a status line without cutting mid-word where avoidable. */
function clip(s: string, n: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

/**
 * Say, in the user's own vocabulary, what is about to happen.
 *
 * The rule everywhere here: name the THING. "Reading your sheet" is barely better than "Thinking";
 * "Reading your sheet Vendor master 1 — keeping rows where GST is not empty" is the difference
 * between watching it work and wondering whether it is alive.
 */
export function describeIntent(tool: string, args: Record<string, string>): { headline: string; detail?: string } {
  const t = args.title ? `"${clip(args.title, 40)}"` : '';
  switch (tool) {
    case 'query_table':
      return {
        headline: args.where
          ? `Filtering your sheet ${t || ''}`.trim()
          : `Opening your sheet ${t || ''}`.trim(),
        detail: args.where
          ? `Keeping rows where ${clip(args.where, 120)}${args.columns ? ` · columns: ${clip(args.columns, 60)}` : ''}`
          : 'Reading its columns and row count first, before filtering anything.',
      };
    case 'recall_from_brain':
      return { headline: `Looking through your Brain for ${args.query ? `"${clip(args.query, 40)}"` : 'what you already have'}`,
               detail: 'Reusing what is already saved instead of researching it again.' };
    case 'save_to_brain':
      return { headline: `Saving ${t || 'a new note'} to your Brain`,
               detail: args.kind ? `As a ${args.kind}.` : undefined };
    case 'edit_brain':
      return { headline: `Updating ${t || 'a Brain note'}`,
               detail: args.mode ? `Mode: ${args.mode} — editing the existing note rather than making a copy.` : undefined };
    case 'link_in_brain':
      return { headline: `Linking ${args.from ? `"${clip(args.from, 28)}"` : 'two items'} to ${args.to ? `"${clip(args.to, 28)}"` : 'another'} in your Brain` };
    case 'web_search':
      return { headline: `Searching the web for ${args.query || args.queries ? `"${clip(args.query || args.queries, 60)}"` : 'what it needs'}` };
    case 'delegate_to_agent':
      return { headline: `Handing this to ${args.agent_key ? args.agent_key.replace(/_/g, ' ') : 'a specialist'}`,
               detail: args.task ? clip(args.task, 130) : undefined };
    case 'council_review':
      return { headline: 'Putting this to your council', detail: 'Five advisers who deliberately disagree.' };
    case 'generate_document':
      return { headline: `Building ${args.name ? `"${clip(args.name, 40)}"` : 'the document'}` };
    case 'send_email':
      return { headline: `Writing an email${args.to ? ` to ${clip(args.to, 40)}` : ''}`,
               detail: args.subject ? `Subject: ${clip(args.subject, 80)}` : undefined };
    default:
      return { headline: `Running ${tool.replace(/_/g, ' ')}`,
               detail: args.query || args.title ? clip(args.query || args.title, 110) : undefined };
  }
}

// ─── What came back ──────────────────────────────────────────────────────────

/** Data rows in a markdown table — header and the |---| separator do not count. */
function countTableRows(text: string): { rows: number; cols: number } | null {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2) return null;
  const body = lines.filter((l) => !/^\|?[\s:|-]+\|?$/.test(l));
  if (body.length < 2) return null;
  const cols = body[0].split('|').filter((c) => c.trim()).length;
  return { rows: body.length - 1, cols };
}

/**
 * One factual line about what a tool returned — counted from the actual result, never guessed.
 *
 * This is the other half of the same complaint. Knowing the agent "used query_table" tells you
 * nothing about whether it got 766 rows or an error; the run then goes quiet again for two minutes
 * and there is still no way to tell working from broken. A receipt per call makes the run legible
 * after the fact too: the trail of what it touched stays in the bubble, so an answer can be checked
 * against the steps that produced it.
 */
export function toolReceipt(tool: string, args: Record<string, unknown>, result: string): string {
  const label = tool.replace(/_/g, ' ');
  const r = String(result || '');
  const subject = String(args?.title ?? args?.query ?? args?.name ?? args?.url ?? '').trim();
  const on = subject ? ` · ${clip(subject, 44)}` : '';
  if (!r.trim()) return `${label}${on} — came back empty`;
  if (/^\s*(error|\[error)/i.test(r) || /^\[[a-z_ -]+ (not installed|failed|unavailable)/i.test(r)) {
    return `${label}${on} — failed: ${clip(r.replace(/^error:?\s*/i, ''), 110)}`;
  }
  // THE REAL SIZE, NOT THE PREVIEW'S.
  //
  // countTableRows counts the markdown rows in the result, and a shape preview prints five
  // of them — so a 766-row vendor sheet was reported to the user, in every run log, as
  // "5 rows x 13 columns". describeTable states the true figure on its first line, so read
  // that when it is there and fall back to counting only when it is not.
  const stated = /^\s*(\d[\d,]*) rows?, (\d+) columns?\./m.exec(r);
  if (stated) {
    return `${label}${on} — ${stated[1]} rows × ${stated[2]} columns`;
  }
  const tbl = countTableRows(r);
  if (tbl) return `${label}${on} — ${tbl.rows} row${tbl.rows === 1 ? '' : 's'} × ${tbl.cols} columns`;
  if (/^\s*(saved|added|created|updated)\b/i.test(r)) return `${label} — ${clip(r, 120)}`;
  const words = r.split(/\s+/).filter(Boolean).length;
  return `${label}${on} — ${words > 40 ? `${words} words back` : clip(r, 120)}`;
}

// ─── Keeping raw machinery out of the user's chat ────────────────────────────

/**
 * Strip tool-call machinery from text about to be SHOWN.
 *
 * The existing cleaners keyed on the literal `<tool_call>` tag. A model that emits the JSON with no
 * tag — common on the small free models, and likelier still when a stop sequence clips the opener —
 * sailed straight past them, so the user saw a raw escaped payload: `{"tool":"save_to_brain",
 * "body":"| SL# | SUPPLIER_ID |\n| --- |…`. That is what landed on screen after Stop: not an error,
 * not a table, a half-written function call with its newlines still spelled out as backslash-n.
 *
 * Cutting from the first `{"tool"` is safe because a tool call is always the LAST thing in a turn —
 * the prose that matters comes before it.
 */
export function stripToolNoise(text: string): string {
  return String(text || '')
    .replace(/<tool_call>[\s\S]*/g, '')
    .replace(/<tool_code>[\s\S]*/g, '')
    .replace(/CHOICES_BLOCK:[\s\S]*/g, '')
    // Bare, untagged tool call. The FENCED form has to go first: cutting at the brace would
    // otherwise leave a naked ```json behind, which then renders as an empty code box.
    .replace(/```(?:json)?\s*\{\s*"tool"\s*:[\s\S]*/g, '')
    .replace(/\{\s*"tool"\s*:[\s\S]*/g, '')
    // A HALF-ARRIVED OPENING TAG IS STILL MACHINERY.
    //
    // Every rule above needs the complete `<tool_call>`. Mid-stream the buffer spends a few frames
    // holding `<tool`, `<tool_c`, `<tool_cal` — none of which match, so the raw fragment was
    // painted into the chat as though the agent had typed it. Small, but it is the tell that the
    // user is looking at plumbing rather than an answer. Only a TRAILING fragment is cut, so a
    // real "<tool" mid-sentence is untouched.
    .replace(/<\/?t(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l)?|d|o(?:d(?:e)?)?)?)?)?)?)?)?)?$/i, '')
    .trim();
}

/**
 * ONE frame of live narration, for whichever loop is running.
 *
 * The three call sites (boss, single delegation, pipeline stage) had drifted into three slightly
 * different versions of the same judgement, which is how one of them ended up showing nothing at
 * all. It is decided here once, and tested here once.
 *
 * The rule that matters: the status panel appears whenever a tool call is being composed —
 * NOT only when there is no prose. An agent that writes "I need to see the columns first." and
 * then spends ninety seconds composing the call left that one sentence on screen, motionless, with
 * no clock and no hint that anything was still happening. Prose already written is kept AND the
 * live panel goes underneath it, so there is always something moving.
 */
export function liveFrame(buf: string, agentName: string): {
  /** Real text written so far — kept, and drawn ABOVE the panel. */
  prose: string;
  /** Panel headline, agent included: "Nyx.Research — Filtering your sheet …". */
  headline: string;
  /** The same thing without the agent's name, for the one-line status bar. */
  step: string;
  detail: string;
  /** True once the buffer names a tool — the caller can flip its phase label. */
  onTool: boolean;
} {
  const prose = stripToolNoise(buf);
  const intent = peekToolIntent(buf);
  if (intent) {
    const d = describeIntent(intent.tool, intent.args);
    return { prose, headline: `${agentName} — ${d.headline}`, step: d.headline,
             detail: d.detail ?? 'Writing the call now.', onTool: true };
  }
  const step = prose ? 'writing' : 'working out the next step';
  return {
    prose,
    headline: `${agentName} is ${step}`,
    step,
    detail: prose
      ? (() => { const w = prose.split(/\s+/).filter(Boolean).length; return `${w} word${w === 1 ? '' : 's'} so far.`; })()
      : buf.length > 40
        ? `Deciding what to do — ${Math.round(buf.length / 5)} words in.`
        : 'Reading the task and your data.',
    onTool: false,
  };
}

/** Render the receipts collected so far as the fenced panel the chat knows how to draw. */
export function runLogFence(lines: string[]): string {
  if (!lines.length) return '';
  return ['```runlog', ...lines, '```'].join('\n');
}
