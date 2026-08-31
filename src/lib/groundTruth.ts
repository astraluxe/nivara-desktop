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

// ─── "As an AI, I cannot perform live web searches" ──────────────────────────
//
// Asked to find 200 non-tech companies in Bangalore, an agent holding web_search and a browser
// replied: "As an AI, I cannot perform live web searches or access real-time business registries…
// based on established business presence up to my knowledge cutoff", and then listed a hundred and
// fifty companies from memory, telling the user to go and verify them against the MCA database
// themselves.
//
// Every part of that is wrong. It CAN search — the tools were attached to that very turn. The list
// is unverified recall presented as a deliverable. And the work was handed back to the user, which
// is the one thing the app exists not to do.
//
// This is a different failure from inventing rows to finish a table: nothing was truncated and no
// tool ran at all. The model simply believed it could not search, which is a belief no instruction
// reliably removes — small models say this reflexively. So it is caught after the fact, by what the
// answer says about itself, and the turn is sent back with the tool it forgot it had.
const NO_ACCESS_CLAIMS = [
  /\bas an ai\b[^.]{0,80}\b(cannot|can't|can not|unable)\b/i,
  /\bI (cannot|can't|can not|am unable to|do not have the ability to)\b[^.]{0,60}\b(search|browse|access|retrieve|look up|crawl|scrape)\b[^.]{0,40}\b(web|internet|online|real[- ]time|live|current)\b/i,
  /\bI (do|does) not have (access to|the ability)\b[^.]{0,60}\b(real[- ]time|live|current|internet|web|browsing)\b/i,
  /\b(knowledge|training) cut[- ]?off\b/i,
  /\bas of my (last|latest) (update|training)\b/i,
  /\bbased on (my )?(training data|pre[- ]existing knowledge)\b/i,
  /\bI (cannot|can't) (verify|confirm) (current|real[- ]time|live)\b/i,
];

/**
 * Does this answer excuse itself for not having looked anything up?
 *
 * Used ONLY together with "and no search tool ran this turn" — the phrase alone can appear in a
 * perfectly honest answer about what the app can and cannot do, and that answer must survive.
 */
export function disclaimsLiveAccess(text: string): boolean {
  const t = String(text || '');
  return NO_ACCESS_CLAIMS.some((re) => re.test(t));
}

/**
 * Is this request asking for real-world facts that have to be looked up?
 *
 * Deliberately about the SHAPE of the ask, not its topic: "find/list/research N real things" is a
 * research job whatever the things are. A request to write, plan, summarise or explain is not —
 * those are legitimately answered from what the model already knows, and forcing a search on them
 * would waste the user's quota on every message.
 */
export function needsRealResearch(request: string): boolean {
  const t = String(request || '');
  if (!/\b(find|search|look ?up|research|gather|collect|source|list|pull|compile|scout|identify)\b/i.test(t)) return false;
  if (!/\b(compan(y|ies)|business(es)?|firms?|startups?|brands?|vendors?|suppliers?|founders?|ceos?|people|prospects?|leads?|competitors?|customers?|clients?|investors?|creators?|influencers?|contacts?)\b/i.test(t)) return false;
  // Writing ABOUT them is not finding them.
  if (/\b(blog|article|essay|deck|presentation|slides?|script|outline|strategy|plan|summary|explain)\b/i.test(t)) return false;
  return true;
}

/**
 * The verdict for a finished research turn: was this actually researched, or recalled?
 *
 * `searched` is whether any real lookup tool ran. When it did not and the answer either excuses
 * itself or hands back a list of named things, the answer is not a deliverable — it is the model's
 * memory wearing the shape of one.
 */
export function isUngroundedRecall(opts: { request: string; answer: string; searched: boolean }): boolean {
  if (opts.searched) return false;
  if (!needsRealResearch(opts.request)) return false;
  const a = String(opts.answer || '');
  if (disclaimsLiveAccess(a)) return true;
  // A long list of named entities, produced without a single lookup, is recall whether or not it
  // admits as much. Counted from numbered or bulleted lines carrying a capitalised name.
  const named = a.split('\n').filter((l) => /^\s*(?:\d+[.)]|[-*•])\s+\**\s*[A-Z][A-Za-z&.' -]{3,}/.test(l)).length;
  return named >= 8;
}

/**
 * Did the answer refuse on the grounds of being unable, when it is not?
 *
 * "I can't create videos directly — I'm a text-based AI" was the reply to a request for a product
 * video, from an agent holding open_content_studio: a tool that opens NotebookLM and ImageFX,
 * signed in, in the user's own browser. It then offered a script template and a list of eight
 * questions, which is the work handed straight back.
 *
 * This is the same shape as "I cannot search the web" — a model reciting a limitation of plain
 * chat models while sitting inside an app built to remove exactly that limitation. No instruction
 * reliably stops it, because it is not reasoning about its tools; it is completing a familiar
 * sentence. So it is caught afterwards, by what the answer says about itself.
 */
const CAPABILITY_DENIALS: RegExp[] = [
  /\bI(?:'m| am)\s+(?:just\s+|only\s+)?a\s+(?:text[- ]based|language|conversational)\s+(?:ai|model|assistant)\b/i,
  /\bas an ai\b[^.]{0,60}\b(cannot|can't|can not|unable|do not have the ability)\b/i,
  /\bI (cannot|can't|can not|am unable to|do not have the ability to)\b[^.]{0,50}\b(create|make|generate|produce|render|record|edit|design|build)\b[^.]{0,40}\b(video|image|graphic|audio|podcast|file|picture|animation)\b/i,
  /\bI (cannot|can't|can not) (directly )?(create|make|produce|generate)\b[^.]{0,30}\b(video|image|audio)/i,
  // ── "I CANNOT BROWSE THE INTERNET" ─────────────────────────────────────────
  //
  // A user asked, three times, for research on a page whose link they had pasted. The third answer
  // opened: "I cannot browse the live internet or access the specific URL you provided in
  // real-time. As an AI, my knowledge cutoff prevents me from seeing the current state of
  // iangroup.vc/portfolio/" — and then produced a long, confident, entirely recalled answer, with
  // ticket sizes and tables in it.
  //
  // Every guard above passed it. The denials listed here were all about MAKING something — a file,
  // an image, a video — and this is a denial of READING, which is the more damaging of the two for
  // a research product: what follows it is never an apology, it is unverified recall dressed as
  // findings. The page returns 200, and our own browser reads all 175 companies off it.
  // The trailing \b is deliberately absent after the nouns and verbs below: "external websiteS"
  // and "preventS me from seeing" are the forms these actually arrive in, and a word boundary
  // after `website` or `prevent` rejects both.
  /\b(cannot|can't|can not|am unable to|do not have the ability to|don't have the ability to)\b[^.]{0,60}\b(browse|access|visit|open|reach|retrieve|fetch|see)\b[^.]{0,60}\b(internet|web|website|web ?page|url|link|online|live)s?\b/i,
  /\b(no|without)\s+(real[- ]time|live|direct)\s+(access|browsing|internet|web)\b/i,
  /\bknowledge\s+cut[- ]?off\b[^.]{0,80}\b(prevent\w*|cannot|can't|unable|limit\w*|not able)/i,
  /\b(cannot|can't|can not|unable to)\b[^.]{0,40}\b(browse|search)\b[^.]{0,25}\b(internet|web)/i,
  /\bI (cannot|can't|can not|am unable to)\b[^.]{0,40}\bclick\b[^.]{0,30}\b(link|url)\b/i,
  /\bI (do not|don't) have\b[^.]{0,40}\b(access|ability)\b[^.]{0,40}\b(internet|web|external|live|real[- ]time)/i,
];

export function deniesCapability(text: string): boolean {
  return CAPABILITY_DENIALS.some((re) => re.test(String(text || '')));
}
