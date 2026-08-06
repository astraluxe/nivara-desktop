// ─── Reading part of a big table ──────────────────────────────────────────────
//
// A spreadsheet in the Brain is one note with a few thousand rows in it. Every existing path reads
// the WHOLE thing: recall_from_brain returns the first 1,800 characters (so a 4,000-row vendor
// master arrives as its first nine rows and nothing else), and attaching the file sends all of it
// and blows the context budget on data the request never mentioned.
//
// Neither is what "find the vendors in Bengaluru with more than 50 people" needs. That question has
// an exact, cheap answer — filter two columns — and it does not need a model at all. Doing it here,
// deterministically, means the model spends tokens on the twelve rows that matter rather than on
// four thousand it has to read to find them, and the answer is the same on adris.tech, a BYOK key
// or a local model.
//
// Everything in this file is pure. No storage, no network, no Tauri — so it can be tested directly.

export interface Table {
  headers: string[];
  rows: string[][];
}

/** Cells of one markdown table row, without the leading/trailing pipe. */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const isSepRow = (l: string) => /^\|?[\s:|-]+\|?$/.test(l.trim()) && l.includes('-');

/**
 * Read whatever table is in this text.
 *
 * Handles the two shapes a Brain body actually comes in: a markdown pipe table, and the HTML one
 * the note editor writes once the user has touched the file. Deliberately keeps the file's OWN
 * headers rather than mapping onto a lead schema — a vendor master has GST numbers and payment
 * terms, and forcing it through a "Name / LinkedIn / Email" canon is how those columns disappear.
 */
export function parseAnyTable(text: string): Table | null {
  const src = String(text || '');
  if (!src.trim()) return null;

  // HTML first: if the body has a <table>, that is authoritative — a converted markdown version of
  // it can lose cells that contained pipes.
  if (/<t[dh][\s>]/i.test(src)) {
    const rowMatches = src.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const parsed: string[][] = [];
    for (const r of rowMatches) {
      const cells = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((c) =>
        c.replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
          .replace(/\s+/g, ' ').trim());
      if (cells.length) parsed.push(cells);
    }
    if (parsed.length >= 2) {
      const headers = parsed[0];
      return { headers, rows: parsed.slice(1).filter((r) => r.some((c) => c)) };
    }
  }

  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const body = lines.filter((l) => !isSepRow(l));
  if (body.length < 2) return null;
  const headers = splitRow(body[0]);
  const width = headers.length;
  const rows = body.slice(1)
    .map(splitRow)
    // Ragged rows are normal in a hand-edited sheet; pad rather than drop, or a row with one
    // missing trailing cell vanishes from every answer.
    .map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]))
    .filter((r) => r.some((c) => c && c !== '—' && c !== '-'));
  return rows.length ? { headers, rows } : null;
}

/** Compare header names the way a person would: case, spaces and punctuation are not identity. */
function normHeader(h: string): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Which column does the user mean?
 *
 * Exact match, then "starts with", then "contains" — so "loc" finds "Location", and "emp" finds
 * "Employee Count". Returns -1 when nothing matches, which the caller reports as an error naming
 * the real columns rather than silently filtering on column 0 and returning confident nonsense.
 */
export function findColumn(headers: string[], want: string): number {
  const w = normHeader(want);
  if (!w) return -1;
  const norm = headers.map(normHeader);
  const exact = norm.indexOf(w);
  if (exact >= 0) return exact;
  const starts = norm.findIndex((h) => h.startsWith(w) || w.startsWith(h));
  if (starts >= 0) return starts;
  const contains = norm.findIndex((h) => h.includes(w) || w.includes(h));
  if (contains >= 0) return contains;
  // Word-by-word, last. Nobody types a header exactly: "employee count" is asked of a column
  // headed "Employees", "company name" of one headed "Vendor Name". Squashed together neither
  // contains the other, so every test above fails on a question that is perfectly clear to a
  // person. Tokens of four characters or more only — "of", "the" and "id" would match anything.
  const toks = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  const wantToks = toks(want);
  if (!wantToks.length) return -1;
  let best = -1, bestScore = 0;
  headers.forEach((h, i) => {
    const hToks = toks(h);
    const score = wantToks.filter((wt) => hToks.some((ht) => ht.includes(wt) || wt.includes(ht))).length;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return bestScore > 0 ? best : -1;
}

export type Op = 'contains' | 'is' | 'not' | 'gt' | 'lt' | 'gte' | 'lte' | 'starts' | 'ends' | 'empty' | 'notempty' | 'in';
export interface Condition { column: string; op: Op; value: string }

const OP_WORDS: Array<[RegExp, Op]> = [
  [/^(>=|=>|at least|no less than)$/i, 'gte'],
  [/^(<=|=<|at most|no more than)$/i, 'lte'],
  [/^(>|greater than|more than|over|above)$/i, 'gt'],
  [/^(<|less than|under|below|fewer than)$/i, 'lt'],
  [/^(!=|<>|is not|not|isnt|isn't|excluding|except)$/i, 'not'],
  [/^(=|==|is|equals|equal to)$/i, 'is'],
  [/^(contains|has|includes|like|matches)$/i, 'contains'],
  [/^(starts with|startswith|begins with)$/i, 'starts'],
  [/^(ends with|endswith)$/i, 'ends'],
  [/^(is empty|empty|blank|missing)$/i, 'empty'],
  [/^(is not empty|not empty|notempty|present|filled|has a value)$/i, 'notempty'],
  [/^(in|one of|any of)$/i, 'in'],
];

/**
 * Parse the filter the model (or the user) wrote.
 *
 * A plain string — "Location contains Bengaluru; Employees > 50" — rather than nested JSON, because
 * every model gets a one-line string right and a good number of them mangle a nested array. The
 * conditions are ANDed, which is what "and" means in every request of this shape anyone actually
 * writes.
 */
export function parseConditions(spec: string): Condition[] {
  const out: Condition[] = [];
  for (const partRaw of String(spec || '').split(/\s*(?:;|\band\b|\n)\s*/i)) {
    const part = partRaw.trim();
    if (!part) continue;
    // Symbol operators can sit flush against the words ("Employees>50"), word ones cannot.
    const sym = /^(.+?)\s*(>=|<=|<>|!=|==|=|>|<)\s*(.*)$/.exec(part);
    if (sym) {
      const op = OP_WORDS.find(([re]) => re.test(sym[2]))?.[1] ?? 'is';
      out.push({ column: sym[1].trim(), op, value: sym[3].trim() });
      continue;
    }
    // Longest operator phrase first, so "is not empty" is not read as "is".
    const phrases = ['is not empty', 'is empty', 'not empty', 'starts with', 'begins with', 'ends with', 'greater than', 'less than', 'more than', 'fewer than', 'at least', 'at most', 'no less than', 'no more than', 'one of', 'any of', 'is not', 'equals', 'equal to', 'contains', 'includes', 'matches', 'blank', 'missing', 'empty', 'under', 'over', 'above', 'below', 'like', 'has', 'is', 'in', 'not'];
    let matched = false;
    for (const p of phrases) {
      const re = new RegExp(`^(.+?)\\s+${p.replace(/ /g, '\\s+')}(?:\\s+(.*))?$`, 'i');
      const m = re.exec(part);
      if (!m) continue;
      const op = OP_WORDS.find(([r]) => r.test(p))?.[1] ?? 'contains';
      out.push({ column: m[1].trim(), op, value: (m[2] || '').trim() });
      matched = true;
      break;
    }
    // No operator at all ("Bengaluru") is a search across every column, not a broken filter.
    if (!matched) out.push({ column: '*', op: 'contains', value: part });
  }
  return out;
}

/** The number inside a cell, ignoring ₹ , % and any trailing unit. NaN when there isn't one. */
function numOf(cell: string): number {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(cell || '').replace(/,/g, ''));
  return m ? Number(m[0]) : NaN;
}

function cellPasses(cell: string, c: Condition): boolean {
  const v = String(cell ?? '').trim();
  const want = c.value.trim();
  const lv = v.toLowerCase();
  const lw = want.toLowerCase();
  // A dash is how "nothing here" is written in every table this app produces.
  const blank = !v || v === '—' || v === '-' || v === 'n/a';
  switch (c.op) {
    case 'empty':    return blank;
    case 'notempty': return !blank;
    case 'is':       return lv === lw;
    case 'not':      return lv !== lw;
    case 'starts':   return lv.startsWith(lw);
    case 'ends':     return lv.endsWith(lw);
    case 'in':       return want.split(/\s*[|,/]\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean).includes(lv);
    case 'gt': case 'lt': case 'gte': case 'lte': {
      const a = numOf(v); const b = numOf(want);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return c.op === 'gt' ? a > b : c.op === 'lt' ? a < b : c.op === 'gte' ? a >= b : a <= b;
    }
    default:         return lv.includes(lw);
  }
}

export interface QueryResult {
  table: Table;
  /** Total rows in the source, so a caller can say "12 of 4,000". */
  total: number;
  matched: number;
  /** Conditions whose column did not exist — reported, never silently ignored. */
  unknownColumns: string[];
}

/**
 * Run the filter.
 *
 * A condition naming a column that does not exist is NOT treated as "matches nothing" and not
 * treated as "matches everything" — both are answers to a question that was never asked. It is
 * reported back, so the caller can say "there is no Location column; the columns are …" instead of
 * confidently returning zero rows and having the user believe their sheet is empty.
 */
export function queryTable(table: Table, conditions: Condition[], columns?: string[], limit = 200): QueryResult {
  const unknownColumns: string[] = [];
  const resolved = conditions.map((c) => {
    if (c.column === '*') return { c, idx: -2 };            // -2 = search every column
    const idx = findColumn(table.headers, c.column);
    if (idx < 0) unknownColumns.push(c.column);
    return { c, idx };
  }).filter(({ idx }) => idx !== -1);

  const kept = table.rows.filter((row) => resolved.every(({ c, idx }) => (
    idx === -2 ? row.some((cell) => cellPasses(cell, c)) : cellPasses(row[idx] ?? '', c)
  )));

  // Narrowing the COLUMNS matters as much as narrowing the rows: a vendor sheet with 22 columns
  // costs eleven times what the three the question needs would.
  let headers = table.headers;
  let rows = kept;
  if (columns?.length) {
    const idxs = columns.map((c) => findColumn(table.headers, c)).filter((i) => i >= 0);
    if (idxs.length) {
      headers = idxs.map((i) => table.headers[i]);
      rows = kept.map((r) => idxs.map((i) => r[i] ?? ''));
    }
  }
  return {
    table: { headers, rows: rows.slice(0, Math.max(1, limit)) },
    total: table.rows.length,
    matched: kept.length,
    unknownColumns: [...new Set(unknownColumns)],
  };
}

/** Render a table back to markdown. */
export function tableToMarkdown(t: Table): string {
  const head = `| ${t.headers.join(' | ')} |`;
  const sep = `| ${t.headers.map(() => '---').join(' | ')} |`;
  const body = t.rows.map((r) => `| ${t.headers.map((_, i) => (r[i] ?? '').replace(/\|/g, '\\|') || '—').join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/**
 * The cheap thing to send when nobody has said what they are looking for yet: the shape of the
 * sheet and a handful of rows. Learning a 4,000-row file's schema this way costs a few hundred
 * tokens instead of the whole file, and it is what lets the next call be an exact query.
 */
export function describeTable(t: Table, sample = 5): string {
  const uniq = (i: number) => {
    const vals = [...new Set(t.rows.map((r) => (r[i] ?? '').trim()).filter((v) => v && v !== '—'))];
    // Only worth listing when the column is genuinely categorical — a column of 4,000 distinct
    // company names tells the reader nothing and costs a great deal to print.
    return vals.length <= 12 ? ` (values: ${vals.join(', ')})` : ` (${vals.length} distinct)`;
  };
  return [
    `${t.rows.length} rows, ${t.headers.length} columns.`,
    'Columns:',
    ...t.headers.map((h, i) => `- ${h}${uniq(i)}`),
    '',
    `First ${Math.min(sample, t.rows.length)} rows:`,
    tableToMarkdown({ headers: t.headers, rows: t.rows.slice(0, sample) }),
  ].join('\n');
}
