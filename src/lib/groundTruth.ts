// ─── Rows the tool never returned must never reach the user ──────────────────
//
// query_table returned 487 real vendor rows. The model was handed the first 3000 characters of
// them — about twelve rows — and asked to produce the filtered list. It wrote twenty-five, and the
// last thirteen were invented:
//
//   VISION TECHNOLOGIES       29AAIFV1234P1ZW   NO 846, 1ST FLOOR, 8TH CROSS,  RPC LAYOUT
//   AKSHAYA ENTERPRISES       29AAHFA1234Q1ZX   NO 12,  2ND FLOOR, 3RD CROSS,  RPC LAYOUT
//   SRI VENKATESHWARA ENT.    29ABGFS5678E1ZM   NO 56,  1ST FLOOR, 4TH CROSS,  RPC LAYOUT
//
// GST prefixes marching AAI→AAH→ABG→ACI→ADJ→AEK→AFL→AGM→AHN→AIO→AJP→AKQ→ALR, PANs alternating
// 1234/5678, street numbers climbing by twelve, every one on the same date at the same layout.
// A model with a table to finish and no data left finishes the table.
//
// This is the worst possible failure for this product. The user's standing rule is that any
// company named must come from a tool result actually received — "presenting one as filtered from
// your Brain is the worst thing you can hand me" — and here their own supplier list came back
// half real, half fiction, with nothing to mark the join.
//
// Two defences, because one is not enough:
//
//   1. Do not ask. When a tool returns a table, the APP owns that table and renders it; the model
//      is told it is already shown and to write one sentence about it. A model that is never asked
//      to retype 487 rows cannot get them wrong. (Wired up in KrewChat — see toolDeliverable.)
//
//   2. Check anyway. Every row the model does write is checked against what the tools actually
//      returned THIS RUN — the full result, not the truncated copy the model saw. A row whose
//      identifiers appear nowhere in any tool output did not come from the user's data.
//
// Deterministic, synchronous, no model call: the check costs nothing and cannot itself hallucinate.

/** Fold text into a form where formatting differences stop mattering, for substring lookups. */
function haystack(s: string): string {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Identifiers in a table cell that are distinctive enough to look up.
 *
 * A GST number, a PAN, a supplier code — tokens long enough and mixed enough that finding one in
 * the tool output is real evidence, and not finding it is real evidence too. Deliberately NOT
 * company names: "ADITYA ENTERPRISES" is a plausible name that could legitimately be spelled a
 * dozen ways, and judging a row on a name match would throw away real rows.
 */
export function rowAnchors(cell: string): string[] {
  const out: string[] = [];
  for (const tok of String(cell || '').split(/[^A-Za-z0-9]+/)) {
    if (tok.length < 8) continue;
    if (!/[A-Za-z]/.test(tok) || !/[0-9]/.test(tok)) continue;   // must mix letters and digits
    out.push(tok.toUpperCase());
  }
  return out;
}

/** Is this line a markdown table row (as opposed to prose)? */
function isRow(line: string): boolean {
  return /\|/.test(line) && line.trim().length > 0;
}

/** The |---|---| rule under a header. */
function isSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

export interface GroundingResult {
  text: string;
  /** Rows removed because nothing in them appeared in any tool result. */
  dropped: number;
  /** Rows confirmed present in the tool output. */
  kept: number;
  /** Rows we could not judge (no strong identifier) — left alone. */
  unjudged: number;
  /** Names of the dropped rows, for telling the user what was cut. */
  droppedLabels: string[];
}

/**
 * Remove table rows that no tool result this run can account for.
 *
 * Conservative on purpose — a false drop deletes the user's real data, which is a worse failure
 * than the one being fixed:
 *
 *   • A row with no strong identifier is KEPT. Plenty of legitimate tables are all prose cells.
 *   • If nothing at all can be grounded, everything is KEPT. That means the premise is wrong (the
 *     answer did not come from this tool), not that every row is fake.
 *   • Headers, separators and prose are never touched.
 */
export function dropUngroundedRows(answer: string, toolOutput: string): GroundingResult {
  const hay = haystack(toolOutput);
  const lines = String(answer || '').split('\n');
  const empty: GroundingResult = { text: answer, dropped: 0, kept: 0, unjudged: 0, droppedLabels: [] };
  if (hay.length < 200) return empty;   // nothing substantial to check against

  // First pass: judge every row without changing anything, so the "did anything ground at all?"
  // question can be answered before a single line is removed.
  const verdicts = lines.map((line) => {
    if (!isRow(line) || isSeparator(line)) return 'skip' as const;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    const anchors = cells.flatMap(rowAnchors);
    if (!anchors.length) return 'unjudged' as const;
    return anchors.some((a) => hay.includes(a)) ? 'kept' as const : 'dropped' as const;
  });

  const kept = verdicts.filter((v) => v === 'kept').length;
  const dropped = verdicts.filter((v) => v === 'dropped').length;
  const unjudged = verdicts.filter((v) => v === 'unjudged').length;

  // Nothing grounded => this answer is not derived from that tool output. Judging it against the
  // wrong evidence would delete a legitimate answer wholesale.
  if (!kept || !dropped) return { ...empty, kept, unjudged };

  const droppedLabels: string[] = [];
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (verdicts[i] === 'dropped') {
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      // The longest mostly-alphabetic cell is almost always the name — what to show the user.
      const label = cells.filter((c) => /[A-Za-z]{4}/.test(c)).sort((a, b) => b.length - a.length)[0];
      if (label && droppedLabels.length < 12) droppedLabels.push(label.slice(0, 60));
      return;
    }
    out.push(line);
  });

  return { text: out.join('\n'), dropped, kept, unjudged, droppedLabels };
}

// ─── Tables that arrive with their newlines spelled out ──────────────────────

/**
 * Repair a table whose line breaks came through as the two characters \ and n.
 *
 * The whole 25-row table rendered as one unbroken line of pipes and backslash-n, which is why it
 * could not be read at all. It happens when a model echoes a JSON string value it was shown rather
 * than writing markdown — the escaping is correct for JSON and meaningless in a chat bubble.
 *
 * Only fires when the text genuinely has escaped breaks and few real ones, so a legitimate answer
 * that mentions "\n" while explaining code is left alone.
 */
export function unescapeStrayNewlines(text: string): string {
  const s = String(text || '');
  const escaped = (s.match(/\\n/g) ?? []).length;
  if (escaped < 2) return s;
  const real = (s.match(/\n/g) ?? []).length;
  // A table crammed onto one line has many escapes and almost no real breaks. Code being discussed
  // has real breaks around it, and usually sits in a fence.
  if (real > escaped) return s;
  if (/```/.test(s) && escaped < 6) return s;
  return s.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t');
}

/**
 * A markdown table needs its separator row and a leading pipe to render at all.
 *
 * The same reply also lost the `|` at the start of each line and had a separator reading
 * `--- | --- | ---` with no leading pipe, so even once the breaks were fixed it was still a wall
 * of text rather than a table. Both are mechanical to repair and neither can change a value.
 */
export function repairTableShape(text: string): string {
  const lines = String(text || '').split('\n');
  if (!lines.some((l) => (l.match(/\|/g) ?? []).length >= 2)) return text;

  const out = lines.map((l) => {
    const t = l.trim();
    if (!t || (t.match(/\|/g) ?? []).length < 2) return l;
    // Give every table-ish line the leading and trailing pipe markdown requires.
    const body = t.replace(/^\|/, '').replace(/\|$/, '');
    return `| ${body.split('|').map((c) => c.trim()).join(' | ')} |`;
  });

  // Insert the separator if the header has none under it — without it markdown renders the whole
  // thing as paragraphs, which is exactly what the user was looking at.
  const first = out.findIndex((l) => (l.match(/\|/g) ?? []).length >= 3);
  if (first >= 0) {
    const cols = out[first].split('|').filter((c) => c.trim()).length;
    const next = out[first + 1] ?? '';
    if (!isSeparator(next)) {
      out.splice(first + 1, 0, `| ${Array(cols).fill('---').join(' | ')} |`);
    }
  }
  return out.join('\n');
}

/** Everything above, in the order a mangled answer needs it. */
export function repairAnswer(text: string): string {
  return repairTableShape(unescapeStrayNewlines(text));
}
