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
/**
 * Which line is the HEADER?
 *
 * Almost no real export starts with its header. A vendor master opens with a title row
 * ("VENDOR MASTER DATA"), an export date, a blank line, sometimes a company logo cell — and only
 * then the columns. Taking row 0 makes "VENDOR MASTER DATA" the one and only column name and every
 * subsequent row a single ragged cell, which reads as "this file has no usable data".
 *
 * The header is the first row that looks like LABELS rather than VALUES: several non-empty cells,
 * mostly short, mostly non-numeric, and no cell that is obviously data (an email, a long address).
 * Only the first few rows are considered — a header is never on line 40.
 */
/**
 * True when the chosen "header" is actually the first row of DATA.
 *
 * A sheet exported without headers, or pasted from a selection that missed the top row, has real
 * values where the labels should be. Taking them as column names loses that row entirely — and on
 * a two-row list, that is half the file. Emails, URLs and phone numbers never appear in a header.
 */
function headerIsReallyData(cells: string[]): boolean {
  const filled = cells.map((c) => (c || '').trim()).filter(Boolean);
  if (!filled.length) return false;
  return filled.some((c) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}/.test(c) || /^https?:\/\//i.test(c) || /^[+(]?[\d][\d\s().-]{8,}\d$/.test(c));
}

function pickHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const r = rows[i].map((c) => (c || '').trim());
    const filled = r.filter(Boolean);
    if (filled.length < 2) continue;
    // A row where most cells are numbers, or that contains an email, is data.
    const numeric = filled.filter((c) => /^[\d.,%₹$\s-]+$/.test(c)).length;
    const dataish = filled.some((c) => c.includes('@') || c.length > 60);
    if (dataish) continue;
    const shortish = filled.filter((c) => c.length <= 40).length;
    // More filled cells is better; numeric cells count against; a later row is slightly worse, so
    // a genuine tie goes to the earliest candidate.
    const score = filled.length * 3 + shortish - numeric * 4 - i;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/**
 * Split a delimited line, honouring "quoted, fields" — CSV's one genuinely fiddly rule.
 *
 * The special delimiter '  ' means RUNS OF WHITESPACE (two or more spaces, or a tab). Pasted
 * spreadsheet data arrives that way constantly: the tabs survive a copy out of Excel but not
 * always the trip through an HTML editor, where they land as aligned runs of spaces. Without this
 * mode such a file parses as zero tables and the app reports it has nothing to work with — while
 * the user is looking at a perfectly good list of columns.
 */
function splitDelimited(line: string, delim: string): string[] {
  if (delim === '  ') return line.split(/\t| {2,}| {2,}/).map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }   // "" is an escaped quote
      else inQ = !inQ;
    } else if (ch === delim && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Read a CSV / TSV / semicolon-separated body — the shapes an export actually arrives in.
 *
 * The delimiter is chosen by consistency, not by counting: the right one produces the SAME number
 * of columns on most lines. Counting alone picks the comma for a file full of "Bengaluru, Karnataka"
 * addresses and shreds every row.
 */
function parseDelimited(src: string): Table | null {
  const lines = src.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const sample = lines.slice(0, 40);
  let bestDelim = '', bestScore = 0, bestWidth = 0;
  // '  ' (runs of whitespace) is tried LAST, so a genuine tab or comma file is never reinterpreted
  // by it — it exists only for pasted data whose tabs became aligned spaces.
  for (const d of ['\t', ',', ';', '|', '  ']) {
    const widths = sample.map((l) => splitDelimited(l, d).length).filter((w) => w >= 2);
    if (!widths.length) continue;
    // The most common column count, counted with a map. The previous version called
    // widths.sort() with a comparator that READ `widths` while sort was mutating it, so the
    // "mode" was whatever the sort happened to leave in slot 0 — sometimes right, sometimes 1,
    // and a mode of 1 rejected the entire table.
    const freq = new Map<number, number>();
    for (const w of widths) freq.set(w, (freq.get(w) ?? 0) + 1);
    let mode = 0, modeCount = 0;
    for (const [w, c] of freq) if (c > modeCount || (c === modeCount && w > mode)) { mode = w; modeCount = c; }
    if (mode < 2) continue;
    const agree = sample.filter((l) => Math.abs(splitDelimited(l, d).length - mode) <= 1).length;
    const score = agree * mode;
    if (score > bestScore) { bestScore = score; bestDelim = d; bestWidth = mode; }
  }
  if (!bestDelim || bestWidth < 2) return null;
  // Half the sampled lines must agree on the shape. The old bar compared agree×width against the
  // line count, so a 13-column table cleared it on three good rows while a 2-column one failed
  // with thirty — it was measuring width, not consistency.
  const agreeing = sample.filter((l) => Math.abs(splitDelimited(l, bestDelim).length - bestWidth) <= 1).length;
  if (agreeing < Math.max(2, Math.ceil(sample.length / 2))) return null;
  const rows = lines.map((l) => splitDelimited(l, bestDelim));
  const h = pickHeaderRow(rows);
  // A file with no header row at all: the top line holds real values. Give the columns generic
  // names and keep every row as data, rather than consuming the first record as labels.
  const noHeader = headerIsReallyData(rows[h]);
  const headers = noHeader
    ? rows[h].map((_, i) => `Column ${i + 1}`)
    : rows[h].map((c, i) => c || `Column ${i + 1}`);
  const width = headers.length;
  const body = rows.slice(noHeader ? h : h + 1)
    .map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]))
    .filter((r) => r.some((c) => c && c !== '—' && c !== '-'));
  return body.length ? { headers, rows: body } : null;
}

export function parseAnyTable(text: string): Table | null {
  // NON-BREAKING SPACES FIRST, ALWAYS.
  //
  // Every HTML editor turns runs of spaces into &nbsp; — that is what keeps the columns aligned on
  // screen. The character it leaves behind is U+00A0, which is NOT matched by \s in the split
  // patterns below, so a table that looks perfectly columnar to the user parses as one enormous
  // single-column blob and the file is reported as containing no table at all. Two other invisible
  // characters do the same thing: the zero-width space and the BOM.
  const src = String(text || '')
    .replace(/ /g, ' ')
    .replace(/[​﻿]/g, '');
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
      const h = pickHeaderRow(parsed);
      const headers = parsed[h].map((c, i) => c || `Column ${i + 1}`);
      const width = headers.length;
      const rows = parsed.slice(h + 1)
        .map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]))
        .filter((r) => r.some((c) => c));
      if (rows.length) return { headers, rows };
    }
  }

  const lines = src.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const body = lines.filter((l) => !isSepRow(l));
  if (body.length >= 2) {
    const cells = body.map(splitRow);
    const h = pickHeaderRow(cells);
    const headers = cells[h].map((c, i) => c || `Column ${i + 1}`);
    const width = headers.length;
    const rows = cells.slice(h + 1)
      // Ragged rows are normal in a hand-edited sheet; pad rather than drop, or a row with one
      // missing trailing cell vanishes from every answer.
      .map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]))
      .filter((r) => r.some((c) => c && c !== '—' && c !== '-'));
    if (rows.length) return { headers, rows };
  }

  // No pipes and no HTML — a CSV/TSV export pasted or imported as-is. Every company stores this
  // differently, and refusing everything that is not a markdown table is why a perfectly good
  // spreadsheet read as "no data".
  return parseDelimited(src);
}

// ─── What a column MEANS, whatever it is called ───────────────────────────────
//
// The same field is written a dozen ways across exports: SUPPLIER_NAME, Vendor Name, Party,
// Account, Firm; EMAIL, E-Mail, Mail ID, Email Address, Contact Email. Matching on one spelling is
// how a file "has no email column" while plainly having one. These are the aliases actually seen in
// the wild, ordered so the most specific wins.
export type CanonField = 'name' | 'person' | 'company' | 'lastName' | 'email' | 'phone' | 'city' | 'country' | 'website' | 'title' | 'linkedin' | 'status' | 'id';

const FIELD_ALIASES: Record<CanonField, RegExp> = {
  // A row's own label. Kept separate from `person` and `company` because a vendor sheet has ONE
  // name column and it is the organisation.
  name:     /^(?:supplier|vendor|party|account|customer|client|firm|business|entity|org(?:anisation|anization)?|company|contact|full)?[\s_-]*name$|^name$|^supplier$|^vendor$|^party$|^account$/i,
  person:   /(?:contact|owner|founder|director|poc|point.of.contact|attention|attn|person|representative|rep)[\s_-]*(?:name|person)?$|^(?:first|fore|given|full)[\s_-]*name$|^fname$/i,
  // English plus the words other languages use, since an export is written by whoever made it.
  company:  /(?:company|organisation|organization|firm|business|employer|account)[\s_-]*(?:name)?$|^(?:firma|firmenname|société|societe|entreprise|empresa|azienda|bedrijf|ragione\s*sociale|raz[oó]n\s*social)$/i,
  // A CRM export splits the person across two columns far more often than not. Without this the
  // whole list is on first-name terms with strangers — "Hi Ravi" to someone you have never met,
  // and two different Ravis indistinguishable in the campaign.
  lastName: /^(?:last|sur|family)[\s_-]*name$|^lname$|^surname$/i,
  email:    /e[\s_-]*mail|^mail([\s_-]*id)?$|email[\s_-]*(?:id|address)/i,
  phone:    /phone|mobile|contact[\s_-]*(?:no|number)|whats[\s_-]*app|tel(?:ephone)?|cell/i,
  city:     /city|town|district|location|locality|place/i,
  country:  /country|nation|region|state|province/i,
  website:  /website|web[\s_-]*site|url|domain|site$/i,
  title:    /designation|job[\s_-]*title|^title$|role|position|department/i,
  linkedin: /linked[\s_-]*in|^li[\s_-]*url$|profile[\s_-]*(?:url|link)/i,
  status:   /status|stage|outcome|disposition/i,
  id:       /^(?:sl|sr|s)[\s.#_-]*(?:no|num)?$|^id$|.*[\s_-]id$|code$|gst|pan(?:no)?$/i,
};

/**
 * Map a table's real headers onto the fields we know how to use.
 *
 * Returns column INDEXES, -1 when the field is genuinely absent. `id`-looking columns are excluded
 * from being read as a name, because "SUPPLIER_ID" contains neither more nor less "name" than
 * "SUPPLIER_NAME" to a naive matcher and picking it gives every contact a code for a name.
 */
export function mapFields(headers: string[]): Record<CanonField, number> {
  const out = {} as Record<CanonField, number>;
  const taken = new Set<number>();
  // Order matters: the most specific patterns claim their column first.
  const order: CanonField[] = ['linkedin', 'email', 'phone', 'website', 'title', 'status', 'lastName', 'person', 'company', 'name', 'city', 'country', 'id'];
  for (const f of order) {
    const re = FIELD_ALIASES[f];
    let idx = -1;
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue;
      const h = (headers[i] || '').trim();
      if (!h || !re.test(h)) continue;
      // Never let an identifier column masquerade as a name.
      if ((f === 'name' || f === 'person' || f === 'company') && FIELD_ALIASES.id.test(h)) continue;
      idx = i; break;
    }
    out[f] = idx;
    if (idx >= 0) taken.add(idx);
  }
  return out;
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

/**
 * Is this the name of an ORGANISATION or of a PERSON?
 *
 * It decides how the contact gets approached, so it has to be right more often than a guess: a
 * company gets an email to whoever answers, a person gets a message written to them by name. Legal
 * suffixes and trade words are decisive; beyond that, people have two or three capitalised words
 * and no digits, while organisations run long or contain a word no human is called.
 */
export function looksLikeCompanyName(raw?: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return false;
  const low = s.toLowerCase();
  // Decisive: a legal form or a corporate suffix.
  if (/\b(pvt|private|ltd|limited|llp|llc|inc|incorporated|corp|corporation|co|company|gmbh|s\.?a\.?|b\.?v\.?|plc|sdn|bhd|pte)\b\.?/.test(low)) return true;
  // Decisive: a trade or sector word. No person is called "Industries".
  if (/\b(industries|industry|enterprises|enterprise|technologies|technology|solutions|systems|services|traders|trading|engineering|engineers|associates|consultancy|consultants|agencies|agency|group|holdings|ventures|labs|laboratories|works|manufacturing|exports|imports|logistics|motors|foods|steel|textiles|pharma|healthcare|hospital|hotels|constructions?|infra|electricals?|electronics|automation|instruments|tools|packaging|chemicals|polymers|furniture|stationery|security|marketing|media|studio|academy|institute|university|college|school|bank|federation|society|corporation|council|centre|center|retail|stores|store|mart|supplies|suppliers|distributors|traders|equipments?|machinery|components|products|fabrication|engg|udyog|impex|international|global|overseas|company)\b/.test(low)) return true;
  if (/[&@]|\band\b\s+\w+\s+(?:co|sons|bros|brothers)\b/.test(low)) return true;
  if (/\d/.test(s)) return true;                                  // "3D Engineering", "AV 24 Traders"
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;                             // people rarely have five names
  // ALL CAPS on its own is not evidence — plenty of exports upper-case everything, people included.
  return false;
}

/**
 * Is this cell an IDENTIFIER rather than a name?
 *
 * "1074", "IN00110430", "29AESPJ2945M1ZV", "45681" — serial numbers, supplier codes, GST numbers
 * and Excel date serials. A contact called "1074" is not a contact, and an outreach list full of
 * them is unusable: the user cannot tell who anybody is, and no message can be written to them.
 * This is the last line of defence for when a column was picked wrongly.
 */
export function looksLikeIdentifier(raw?: string): boolean {
  const s = String(raw || '').trim();
  if (!s) return true;
  if (/^[\d\s.,/-]+$/.test(s)) return true;                 // all digits and punctuation
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const digits = (s.match(/\d/g) || []).length;
  if (!letters) return true;
  // A code: no spaces, mostly not letters, and long enough to be an id rather than an initialism.
  if (!/\s/.test(s) && digits >= 3 && s.length >= 6 && digits >= letters / 2) return true;
  // GST / PAN shapes: a long unbroken run of upper-case letters and digits.
  if (/^[A-Z0-9]{10,}$/.test(s) && digits >= 2) return true;
  return false;
}

/** Words that only ever appear in a HEADER, so a row of them is not a contact. */
const HEADER_WORDS = /\b(sl|sr|no|id|name|email|mail|mobile|phone|address|country|city|state|gst|pan|date|status|company|supplier|vendor|creation|exp|dt)\b/gi;

/**
 * Did a header row leak through as data?
 *
 * When the header is not detected, row 0 becomes a contact named "SL# SUPPLIER_ID SUPPLIER_NAME
 * CREATION_DATE …". It looks absurd in the list and it is the clearest possible signal the parse
 * went wrong, so it is caught explicitly rather than left for the user to notice.
 */
export function looksLikeHeaderRow(raw?: string): boolean {
  const s = String(raw || '').trim();
  if (!s || s.length < 8) return false;
  // UNDERSCORES MUST BECOME SPACES FIRST. An underscore is a word character, so `\bname\b` does
  // not match inside "SUPPLIER_NAME" — the same quirk that made the original people-list test
  // reject the vendor sheet. Un-normalised, this detector saw five header words in a row of
  // fifteen and concluded it was data.
  const flat = s.replace(/[_]+/g, ' ');
  const words = flat.split(/[\s,|]+/).filter(Boolean);
  if (words.length < 3) return false;
  const hits = (flat.match(HEADER_WORDS) || []).length;
  return hits >= 3 && hits >= words.length / 2;
}

// ─── Turning a file into contacts ─────────────────────────────────────────────
//
// This is the whole "who is in this list" decision, in one pure function.
//
// It used to live inside the chat component, spread across a heuristic gate, two competing parsers
// and a merge loop — which is why the same class of bug kept coming back wearing a different face:
// contacts named "1074", a campaign built from somebody else's list, and "I don't have anyone to
// reach out to yet" said about a file full of names and email addresses. Each was a different link
// in a chain that could not be tested end to end, so each fix was verified on the piece that had
// broken rather than on the answer the user actually gets.
//
// Here the input is text and the output is contacts, so a test can assert the thing that matters.

export interface ExtractedContact {
  name: string;
  company: string;
  headline: string;
  url: string;
  email: string;
  emails: string[];
  phone: string;
  website: string;
  entityKind: 'person' | 'company';
}

export interface ExtractResult {
  contacts: ExtractedContact[];
  /** Every row accounted for, so the caller can say where its number came from. */
  stats: { total: number; kept: number; noContact: number; noName: number; duplicate: number; companies: number; people: number };
  /** Plain English for when nothing came out — shown to the user, never swallowed. */
  problem: string;
  headers: string[];
}

const EMPTY_STATS = { total: 0, kept: 0, noContact: 0, noName: 0, duplicate: 0, companies: 0, people: 0 };

/**
 * Read a file of any shape into contacts.
 *
 * `requireContact` — a row with a name but no email, phone or profile cannot be messaged, so by
 * default it is counted and dropped rather than padding a campaign with people who can never be
 * reached. Callers that just want to see the rows can turn it off.
 */
export function extractContacts(text: string, requireContact = true): ExtractResult {
  const table = parseAnyTable(text);
  if (!table) {
    return { contacts: [], stats: { ...EMPTY_STATS }, headers: [], problem: 'No table found — the columns may not be separated by tabs, commas or pipes.' };
  }
  const f = mapFields(table.headers);
  // ── FIND THE CONTACT COLUMNS BY WHAT IS IN THEM ───────────────────────────────────────────
  //
  // "Courriel", "Correo", "Mail ID", "E-post", or a sheet with no header row at all — the word
  // above a column of email addresses can be anything, but the addresses themselves are
  // unmistakable. Same for phone numbers and LinkedIn URLs. Detecting these by content instead of
  // vocabulary is what makes an unfamiliar export work on the first try rather than after someone
  // adds another word to a list.
  const sniff = table.rows.slice(0, 60);
  const colHas = (c: number, re: RegExp) => {
    const vals = sniff.map((r) => (r[c] || '').trim()).filter(Boolean);
    if (!vals.length) return 0;
    return vals.filter((v) => re.test(v)).length / vals.length;
  };
  if (f.email < 0) for (let c = 0; c < table.headers.length; c++) {
    if (colHas(c, /^[^@\s]+@[^@\s]+\.[^@\s]{2,}/) >= 0.5) { f.email = c; break; }
  }
  if (f.linkedin < 0) for (let c = 0; c < table.headers.length; c++) {
    if (colHas(c, /linkedin\.com\/in\//i) >= 0.5) { f.linkedin = c; break; }
  }
  if (f.phone < 0) for (let c = 0; c < table.headers.length; c++) {
    if (c === f.email || c === f.id) continue;
    // A phone number: 7+ digits, and not a year, an amount or a serial (those have no separators
    // and no leading +, and tend to sit in columns we have already claimed).
    if (colHas(c, /^[+(]?[\d][\d\s().-]{6,}\d$/) >= 0.6) { f.phone = c; break; }
  }
  // A person column if the sheet has one (a CRM export), else the general name column (a vendor
  // master), else the company. Falling back through all three is what makes one function work on
  // every export instead of one schema.
  let iName = f.person >= 0 ? f.person : f.name >= 0 ? f.name : f.company;
  const stats = { ...EMPTY_STATS, total: table.rows.length };
  // ── WHEN THE HEADER TELLS US NOTHING, READ THE DATA ────────────────────────────────────────
  //
  // No vocabulary list will ever cover every export: headers arrive in other languages, as
  // internal jargon ("Party", "Ledger A/c"), or as "Column 3" because the sheet never had a
  // header at all. Chasing the words is a losing game — so when none matches, pick the column
  // whose CONTENTS look most like names: text with letters in it, not codes, not emails, not
  // URLs, not numbers, and not all identical. That is a property of the data, so it works on a
  // list nobody has seen before, which is the whole requirement.
  if (iName < 0) {
    let best = -1, bestScore = 0;
    const sample = table.rows.slice(0, 60);
    for (let c = 0; c < table.headers.length; c++) {
      if (c === f.email || c === f.phone || c === f.linkedin || c === f.website || c === f.id || c === f.status) continue;
      const vals = sample.map((r) => (r[c] || '').trim()).filter(Boolean);
      if (!vals.length) continue;
      const nameish = vals.filter((v) =>
        /[A-Za-zÀ-ɏ]{2}/.test(v)          // has real letters (accents included)
        && !looksLikeIdentifier(v)
        && !v.includes('@') && !/^https?:\/\//i.test(v)
        && v.length <= 90).length;
      const distinct = new Set(vals.map((v) => v.toLowerCase())).size;
      // DISTINCTNESS IS DECISIVE. A Country column is pure letters and passes every other test,
      // and on a sheet where every row says "INDIA" it would otherwise be chosen as the name —
      // producing a campaign of contacts all called India. Names are nearly all different; a
      // category column repeats. Anything under two thirds distinct is not a name column.
      const variety = distinct / vals.length;
      if (variety < 0.66) continue;
      const score = (nameish / vals.length) * variety;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // Better than half the cells must look like names, or we are guessing rather than reading.
    if (bestScore >= 0.5) iName = best;
  }
  if (iName < 0) {
    return { contacts: [], stats, headers: table.headers, problem: `No column looks like a name. Columns found: ${table.headers.join(', ')}.` };
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] || '').trim() : '');
  // Does the name column's own heading say these rows are organisations? Underscores normalised
  // first, for the same reason as everywhere else in this file.
  const nameHeader = (table.headers[iName] || '').replace(/[_]+/g, ' ');
  const nameColumnMeansCompany = iName === f.company
    || /\b(supplier|vendor|company|firm|business|party|account|organisation|organization|entity|dealer|distributor|manufacturer|client|customer)\b/i.test(nameHeader);
  const out: ExtractedContact[] = [];
  const seen = new Set<string>();
  for (const r of table.rows) {
    // Join a split first/last name back together before anything else looks at it.
    const last = cell(r, f.lastName);
    const name = [cell(r, iName), iName === f.person ? last : ''].filter(Boolean).join(' ').trim();
    // A contact must have a NAME. "1074", "IN00110430" and a header row that leaked through as
    // data are things nobody can write a message to or recognise in a list.
    if (!name || name === '—' || looksLikeIdentifier(name) || looksLikeHeaderRow(name)) { stats.noName++; continue; }
    const emails = splitEmailCell(cell(r, f.email));
    const phone = cell(r, f.phone);
    const li = cell(r, f.linkedin);
    const m = /(https?:\/\/[^\s)\]]*linkedin\.com\/in\/[^\s)\]]+)/i.exec(li);
    if (requireContact && !emails.length && !m && !phone) { stats.noContact++; continue; }
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) { stats.duplicate++; continue; }   // most exports list a supplier twice
    seen.add(key);
    const company = f.company >= 0 ? cell(r, f.company) : (f.person >= 0 && f.name >= 0 ? cell(r, f.name) : '');
    // WHAT THE COLUMN IS CALLED BEATS GUESSING AT THE VALUE.
    //
    // A column headed SUPPLIER_NAME / Vendor / Party / Company contains organisations — every row,
    // by definition. Judging each value on its wording instead gets the obvious ones right and
    // then calls "Yellow Retail" a person, so that row alone is addressed "Hi Yellow" and sent a
    // LinkedIn connection request. A filled person column still wins, because a sheet that names
    // an actual human in a row is telling us something more specific than its own title.
    const isCompany = f.person >= 0 && cell(r, f.person)
      ? false
      : (nameColumnMeansCompany || looksLikeCompanyName(name));
    if (isCompany) stats.companies++; else stats.people++;
    stats.kept++;
    out.push({
      name,
      company: company || (isCompany ? name : ''),
      headline: [company && company !== name ? company : '', cell(r, f.title), cell(r, f.city), cell(r, f.country)]
        .map((s) => s.trim()).filter((s) => s && s !== '—').join(' · ').slice(0, 140),
      url: m ? m[1] : '',
      email: emails[0] || '',
      emails,
      phone,
      website: cell(r, f.website),
      entityKind: isCompany ? 'company' : 'person',
    });
  }
  let problem = '';
  if (!out.length) {
    problem = stats.noContact > stats.noName
      ? `All ${stats.total} rows have a name but none has an email, phone or LinkedIn — there is no way to contact them.`
      : `None of the ${stats.total} rows had a usable name (the name column read as codes or numbers). Columns found: ${table.headers.join(', ')}.`;
  }
  return { contacts: out, stats, headers: table.headers, problem };
}

/** Every address in one cell — exports put three in a single field, separated by anything. */
export function splitEmailCell(cell?: string): string[] {
  return String(cell || '')
    .replace(/ /g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .split(/[,;/|\s]+/)
    .map((s) => s.replace(/^[[(<]+|[\])>.]+$/g, '').trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
    .filter((s, i, a) => a.indexOf(s) === i);
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
  // HOW MANY ROWS ACTUALLY HAVE A VALUE IN THIS COLUMN.
  //
  // Counting was impossible before. A work order asked for "total rows, rows with email,
  // rows with LinkedIn, rows with Company" across seven lists; the only thing query_table
  // returned without a filter was the column names and five sample rows, so three agents
  // called it fifteen times between them, got the same preview each time, and produced
  // nothing. The count is one pass over data already in memory — it costs nothing and it
  // is the single most common question anyone asks of a list.
  const filled = (i: number) =>
    t.rows.reduce((n, r) => n + ((r[i] ?? '').trim() && (r[i] ?? '').trim() !== '—' ? 1 : 0), 0);

  return [
    `${t.rows.length} rows, ${t.headers.length} columns.`,
    'Columns (filled = rows with a value in that column):',
    ...t.headers.map((h, i) => `- ${h} — ${filled(i)}/${t.rows.length} filled${uniq(i)}`),
    '',
    `First ${Math.min(sample, t.rows.length)} rows:`,
    tableToMarkdown({ headers: t.headers, rows: t.rows.slice(0, sample) }),
    '',
    `NOTE: the ${Math.min(sample, t.rows.length)} rows above are a SAMPLE for shape. The counts `
      + `on each column are over all ${t.rows.length} rows and are what you should quote. `
      + `Add a "where" filter only when you need specific rows back.`,
  ].join('\n');
}
