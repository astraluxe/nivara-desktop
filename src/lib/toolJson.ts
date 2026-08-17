// ─── Repairing a tool call the model wrote imperfectly ───────────────────────
//
// WHY THIS EXISTS. The chat's parser had five strategies, and the last one — the one that
// runs when the JSON is genuinely broken — recovered exactly three fields:
//
//     const tool     = …match(/"tool"…/)
//     const agentKey = …match(/"agent_key"…/)
//     const task     = …match(/"task"…/)
//
// `title` and `body` were not among them. So a save_to_brain carrying a long document —
// the case most likely to break the JSON in the first place, because it is full of quotes,
// pipes and line breaks — parsed as a call with NO CONTENT. The Brain then stored the
// fallback (the raw turn prose) under that name, which is how finished work became a
// flattened copy of an unrelated strategy document sitting in the user's Brain.
//
// The fix is to REPAIR the JSON rather than fish three known keys out of the wreckage.
// Two faults account for nearly every broken tool call a language model produces:
//
//   1. Literal newlines, tabs and control characters inside a string. JSON forbids them;
//      models emit them constantly when the value is a document.
//   2. Unescaped double quotes inside a string — {"body":"He said "no" to it"}.
//
// Both are repairable in one pass by deciding, at each quote, whether it closes the string
// or belongs inside it: a real closing quote is followed (after whitespace) by one of
// , } ] : or the end of the text. Anything else is content.

/**
 * Rebuild syntactically valid JSON from what the model actually wrote.
 *
 * Returns null when there is no object at all. Never throws — a repair that cannot be made
 * must fall through to the caller's own handling, not take the turn down with it.
 */
export function repairToolJson(raw: string): string | null {
  const src = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = src.indexOf('{');
  if (start < 0) return null;

  let out = '';
  let i = start;
  let depth = 0;

  while (i < src.length) {
    const c = src[i];

    if (c !== '"') {
      out += c;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
      i++;
      continue;
    }

    // A string starts here. Walk to its real end, collecting the raw body.
    let j = i + 1;
    let body = '';
    for (;;) {
      if (j >= src.length) break;                    // truncated mid-string
      const ch = src[j];

      if (ch === '\\') {
        const next = src[j + 1] ?? '';
        // Keep a valid escape exactly as written; a stray backslash is literal content.
        if ('"\\/bfnrtu'.indexOf(next) >= 0) { body += ch + next; j += 2; continue; }
        body += '\\\\';
        j += 1;
        continue;
      }

      if (ch === '"') {
        let k = j + 1;
        while (k < src.length && /\s/.test(src[k])) k++;
        const after = src[k] ?? '';
        // Closing quote, or one the model forgot to escape?
        if (after === ',' || after === '}' || after === ']' || after === ':' || k >= src.length) break;
        body += '\\"';
        j++;
        continue;
      }

      body += ch;
      j++;
    }

    // body still holds raw newlines/tabs (fault 1) alongside escapes kept above. Re-escape
    // only the raw parts, so a legitimate \n written by the model is not doubled into \\n.
    const fixed = body.replace(/(\\.)|([\s\S])/g, (_m, keep?: string, ch?: string) => {
      if (keep) return keep;
      const c2 = ch as string;
      if (c2 === '\n') return '\\n';
      if (c2 === '\r') return '\\r';
      if (c2 === '\t') return '\\t';
      if (c2 === '"') return '\\"';
      if (c2 < ' ') return ' ';
      return c2;
    });

    out += '"' + fixed + '"';
    i = j + 1;
  }

  if (depth > 0) out += '}'.repeat(depth);            // clipped by a stop sequence
  return out.trim().startsWith('{') ? out : null;
}

/**
 * Last resort: pull EVERY top-level "key": value pair out, whatever state the JSON is in.
 *
 * The version this replaces knew three key names. This one knows none, which is the point:
 * a tool added next year, or a field like `body` that nobody thought to list, comes through
 * the same way. Escaped sequences are turned back into real characters, so a markdown table
 * written as \n-separated rows survives as a table rather than one long line.
 */
export function extractToolFields(raw: string): Record<string, string> | null {
  const src = String(raw || '');
  const out: Record<string, string> = {};

  // "key": "value" — the value ends at the quote followed by , } ] or the next "key":
  const strRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"[A-Za-z_][A-Za-z0-9_]*"\s*:|[},\]]|$))/g;
  for (const m of src.matchAll(strRe)) {
    out[m[1]] = m[2]
      .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  // Numbers and booleans too, so `"limit": 200` is not silently lost.
  const litRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(true|false|-?\d+(?:\.\d+)?)/g;
  for (const m of src.matchAll(litRe)) {
    if (!(m[1] in out)) out[m[1]] = m[2];
  }

  return Object.keys(out).length ? out : null;
}
