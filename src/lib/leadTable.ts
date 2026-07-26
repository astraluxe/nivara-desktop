// Lead-table parsing & merging — pure functions, no React, so they can be unit-tested directly.
// These back the lead-list Brain merge. The whole point is CELL-LEVEL, HEADER-NAME-AWARE merging:
// a new pass FILLS blanks without ever wiping data a person already had, non-data columns
// (verify's "Status") are dropped instead of shifting into Phone, and cells corrupted by earlier
// broken runs are cleaned so the list self-heals rather than degrading each run.

// Extract the markdown table rows from a block of text.
export function extractTableRows(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
}

export const LEAD_CANON: Array<{ key: string; label: string; match: RegExp }> = [
  { key: 'name',     label: 'Name',         match: /\bname\b/i },
  { key: 'company',  label: 'Company/Role', match: /company|role|firm|organi[sz]/i },
  { key: 'sector',   label: 'Sector',       match: /sector|industry/i },
  { key: 'city',     label: 'City',         match: /city|location/i },
  { key: 'website',  label: 'Website',      match: /website|site|domain|\burl\b/i },
  { key: 'linkedin', label: 'LinkedIn',     match: /linkedin/i },
  { key: 'phone',    label: 'Phone',        match: /phone|mobile|number|\bcontact\b/i },
  { key: 'email',    label: 'Email',        match: /email|mail/i },
  // Deliberately SEPARATE from a bare "Status" column (still dropped, per the comment above —
  // that's one-off verify commentary, not meant to persist). "Connection Status" tracks LinkedIn
  // connection-request progress (sent/accepted/pending) and DOES need to survive every merge —
  // otherwise re-verifying or enriching the list would silently erase who's already been invited.
  { key: 'conn_status', label: 'Connection Status', match: /connection.?status|invite.?status|request.?status|connection.?request/i },
];

export function splitTableRow(row: string): string[] {
  let c = row.split('|').map((x) => x.trim());
  if (c.length && c[0] === '') c = c.slice(1);
  if (c.length && c[c.length - 1] === '') c = c.slice(0, -1);
  return c;
}

// Header cell → canonical key (LinkedIn checked before Website so "LinkedIn URL" isn't read as a site).
export function canonForHeader(h: string): string | null {
  const s = h.toLowerCase();
  if (/linkedin/i.test(s)) return 'linkedin';
  for (const c of LEAD_CANON) { if (c.key !== 'linkedin' && c.match.test(s)) return c.key; }
  return null; // status / note / anything else → dropped, never merged into a data column
}

// Sanitise a value for its column: strips "—", strips status-note text that leaked in from earlier
// broken runs, and enforces the column's shape (phone has digits, email has @, linkedin is a real
// /in/ URL) so corrupted cells don't get carried forward.
export function cleanLeadCell(key: string, raw: string): string {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-') return '';
  if (/^(corrected\b|verified\b|couldn'?t\s*verify|unverified|no profile|found (via|the)|status\b)/i.test(s)) return '';
  if (key === 'name') { s = s.replace(/\]\([^)]*\)/g, '').replace(/[[\]]/g, '').replace(/\bcouldn'?t verify.*$/i, '').trim(); return s; }
  if (key === 'phone')    return /\d/.test(s) && s.replace(/\D/g, '').length >= 7 ? s : '';
  if (key === 'email')    return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s) ? s : '';
  // LinkedIn can legitimately be a PERSON'S profile (/in/) or, when the row is about an
  // organisation with no specific named contact (e.g. "find internships" — the row is a
  // COMPANY, not a person), a COMPANY page (/company/). Both are valid.
  if (key === 'linkedin') {
    if (!/linkedin\.com\/(?:in|company)\//i.test(s)) return '';
    // A clean, well-formed markdown link renders nicely — keep it exactly as-is.
    if (/^\[[^[\]]+\]\(https?:\/\/[^()]+\)$/.test(s)) return s;
    // Otherwise the cell is malformed (e.g. a lost opening "[" or missing "](" glued two
    // fragments together — "[www.linkedin.com/company/x)" or "iamhere://www.linkedin.com/
    // company/iamhere-labs)"). Recovering the exact intended label isn't possible, but the
    // real URL is — extract just that and drop the broken decoration around it.
    const m = s.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/[A-Za-z0-9\-_%]+/i);
    if (!m) return '';
    return /^https?:/i.test(m[0]) ? m[0] : 'https://' + m[0];
  }
  // A PERSONAL LinkedIn URL landing in the Website column is always a MISPLACED column (a model
  // writing the person's profile link where the company site belongs) — never a real company
  // website. A COMPANY page URL there is the same mistake — the company's LinkedIn page, however
  // useful, is not "their website". Showing either as-is is misleading (looks like a company site
  // but goes to LinkedIn).
  if (key === 'website' && /linkedin\.com\/(?:in|company)\//i.test(s)) return '';
  // company/sector/city/role are free text but must NEVER legitimately contain markdown-link
  // syntax — a "](https://…)" fragment here is always a column-bleed artifact (a link meant for
  // an adjacent cell got glued onto this one with no separator, e.g.
  // "B2B SaaSin/ankit-uttam](https://www.linkedin.com/in/ankit-uttam)"). Strip the markdown-link
  // remnants AND the dangling "in/<slug>" fragment left behind (its own "[" was already lost
  // before this cell was even built, so the closing-bracket strip alone leaves "…SaaSin/ankit-uttam").
  if ((key === 'company' || key === 'sector' || key === 'city') && /\]\(https?:\/\//.test(s)) {
    s = s.replace(/\]\([^)]*\)/g, '').replace(/[[\]]/g, '').replace(/\s*in\/[a-z0-9-]+$/i, '').trim();
  }
  // Broader column-bleed net: even WITHOUT the "](" bracket pattern above, a company/sector/city
  // cell can still end up with a bare domain fragment or a LinkedIn URL glued onto it with no
  // markdown syntax at all — e.g. ".com/company/appsmith" (a "linkedin" prefix got cut) or
  // "Bangalorelinkedin.com/company/signadotcompany/newton-school" (multiple ROWS' worth of link
  // fragments mashed into one cell with zero separators — seen when a model tries to cram a
  // different task's info, like an internship application link, into a column that was never
  // meant to hold a URL). Real sector/city/role text never legitimately contains "linkedin.com"
  // or a raw "<dot-extension>/<path>" shape — if it does, the cell is corrupted beyond a clean
  // fix. Better to show "—" than a glued, unreadable mess.
  if (key === 'company' || key === 'sector' || key === 'city') {
    if (/linkedin\.com/i.test(s)) return '';
    if (/\.(com|io|ai|co|in|org|net)\/[a-z0-9\-/]/i.test(s)) return '';
    if (s.length > 60) return ''; // real sector/city/role values are always short phrases
  }
  return s;
}

export function isJunkName(name: string): boolean {
  const fc = name.trim();
  if (!fc) return true;
  if (/^(name|company|company\/role|sector|city|website|linkedin|phone|email|status|column)\b/i.test(fc)) return true;
  if (/^(partner|founder|co-?founder|ceo|cmd|md|director|chairman|head|senior partner|managing director)\b/i.test(fc)) return true;
  if (/couldn'?t verify|unverified guess|found via|\]\(https?:/i.test(fc)) return true; // corrupted-name leftovers
  if (/\/in\/|linkedin\.com|https?:\/\//i.test(fc)) return true;                        // a URL/slug fragment leaked into the name
  // A markdown table-separator row (e.g. ":---", "--", ":-:") landing in a data row when a
  // continuation/repair pass fails to fully drop a stray header — no real name is ever built
  // only from colons, dashes, pipes and spaces.
  if (/^[\s:|-]+$/.test(fc)) return true;
  // A real person's name never contains a domain suffix or a stray/unbalanced paren — that
  // shape only happens when a company URL or a following cell's text got glued onto this one
  // (e.g. "Ktestsigma.com)" from a mangled/merged row). Requiring at least one real word of
  // letters (and rejecting the domain/paren markers) catches this whole corruption class
  // instead of chasing each specific garbled shape one at a time.
  if (/\.(com|io|ai|co|in|org|net)\b/i.test(fc)) return true;
  if (/[()]/.test(fc)) return true;
  if (!/[a-z]{2,}/i.test(fc)) return true; // no real word at all — nothing left to show
  return false;
}

export type LeadRow = { key: string; cells: Record<string, string>; order: number };

/**
 * Read the free-text "Connection Status" cell back into an outreach status.
 *
 * The cell is written by both this app and, sometimes, a model filling the table, so it has to
 * cope with phrasing rather than an enum. Anything unrecognised returns undefined — meaning
 * "no progress recorded", which is safer than guessing a status the user never set.
 */
export function leadConnStatusToOutreach(raw?: string): 'todo' | 'connect' | 'sent' | 'accepted' | 'replied' | 'skip' | undefined {
  const s = (raw || '').toLowerCase().trim();
  if (!s || s === '—' || s === '-') return undefined;
  if (/replied|responded|answered/.test(s)) return 'replied';
  if (/messag(e|ed)\s*sent|dm sent|sent message/.test(s)) return 'sent';
  if (/accepted|connected|1st/.test(s)) return 'accepted';
  if (/pending|requested|invite|invitation|sent/.test(s)) return 'connect';
  if (/skip|ignore|not a fit|declined/.test(s)) return 'skip';
  return undefined;
}

/**
 * Write one person's connection status into a lead-list markdown table.
 *
 * Returns the table unchanged if the person isn't in it. If the list has no "Connection Status"
 * column yet the column is APPENDED properly — header, separator and every row — because
 * mergeLeadTables only emits columns that already carry data, so a freshly built list never has
 * one. (Writing into the last existing column instead would quietly overwrite someone's email.)
 */
export function setLeadConnStatus(md: string, name: string, cell: string): string {
  const lines = (md || '').split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('|'));
  if (headerIdx === -1 || !name) return md;

  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = key(name);
  const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && /-/.test(l);
  const cols = splitTableRow(lines[headerIdx]);
  const nameCol = cols.findIndex((h) => /\bname\b/i.test(h));
  if (nameCol === -1) return md;
  let statusCol = cols.findIndex((h) => /connection.?status/i.test(h));

  const rowCells = (l: string) => splitTableRow(l);
  const join = (c: string[]) => '| ' + c.join(' | ') + ' |';

  // Nothing to do if the person isn't on this list — don't touch the file at all.
  const present = lines.some((l, i) => i > headerIdx && l.trim().startsWith('|') && !isSep(l)
    && key(rowCells(l)[nameCol] || '') === target);
  if (!present) return md;

  const appending = statusCol === -1;
  const width = cols.length + (appending ? 1 : 0);
  if (appending) statusCol = cols.length;

  return lines.map((line, i) => {
    if (!line.trim().startsWith('|')) return line;
    if (i === headerIdx) {
      const c = rowCells(line);
      if (appending) c.push('Connection Status');
      return join(c);
    }
    if (isSep(line)) {
      const c = rowCells(line);
      if (appending) c.push('---');
      return join(c);
    }
    const c = rowCells(line);
    while (c.length < width) c.push('—');
    if (key(c[nameCol] || '') !== target) return join(c);
    c[statusCol] = cell;
    return join(c);
  }).join('\n');
}

// Words that mark a row as an ORGANISATION rather than a person.
const ORG_WORDS = /\b(associates|assoc|advocates?|solicitors?|consultancy|ltd|limited|pvt|private|llp|inc|corp|technologies|developers?|solutions?|systems?|labs?|studios?|partners|group|school|college|institute|academy|foundation|trust|society|enterprises?|industries|holdings|agency|firm)\b/i;
// A real JOB TITLE in the Company/Role cell is the strongest signal the row is a PERSON.
//
// Deliberately excludes "developer", "engineer", "intern" and similar: those describe what an
// ORGANISATION does or is hiring for far more often than they name a person here. "Total
// Environment | Real Estate Developer" and "Khatabook | Active: SDE Intern" are both companies,
// and both were read as people until this list was tightened.
const ROLE_TITLE = /\b(ceo|cto|coo|cfo|cmo|cio|founder|co-?founder|owner|director|head|lead|manager|vp|vice president|president|partner|principal|chief|advocate|doctor|dr)\b/i;

/**
 * Is this lead row a PERSON you could send a LinkedIn connection request to?
 *
 * Lead lists legitimately mix people and organisations — "find me law firms in HSR" produces rows
 * that are companies, and that is correct for lead-gen. But you cannot connect with or message a
 * company page, so outreach has to tell them apart. This filter lives here rather than in
 * isJunkName deliberately: dropping company rows from the PARSER would break lead-gen itself.
 *
 * Also rejects text that is obviously not a name at all — a chat sentence can end up in the Name
 * column when a model writes its commentary into the table ("Pramod S processed your first 9
 * connections; would you like me to…"), and without this it becomes an outreach "contact".
 */
export function looksLikePersonLead(name: string, role = ''): boolean {
  const n = (name || '').trim();
  if (!n) return false;
  // Real names are short. 48 chars comfortably fits "Shreeram Ravichandran" and rejects prose.
  if (n.length > 48) return false;
  // Sentence punctuation never appears in a name.
  if (/[;?!]|\.{2,}/.test(n)) return false;
  const words = n.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  if (ORG_WORDS.test(n)) return false;
  const r = (role || '').trim();
  const described = r && r !== '—' && r !== '-';
  // When the row SAYS what this is, believe it: a job title means a person ("Hiver / CEO",
  // "COO at Rashbhar Healthcare"), and a description with no title is a company ("Home Services",
  // "Law Firm", "Real Estate Developer", "Active: SDE Intern").
  if (described) return ROLE_TITLE.test(r);
  // No role given — fall back to shape, and stay lenient so a real person with a sparse row is
  // never silently dropped from outreach.
  return words.length >= 2;
}

/** The reverse — what to write into the lead list so the next run and the user both understand it. */
export function outreachStatusToLeadCell(s?: string): string {
  switch (s) {
    case 'connect':  return 'Request sent';
    case 'accepted': return 'Connected';
    case 'sent':     return 'Message sent';
    case 'replied':  return 'Replied';
    case 'skip':     return 'Skipped';
    default:         return '';
  }
}

export function parseLeadRows(md: string, startOrder: number): { rows: LeadRow[]; next: number } {
  const raw = extractTableRows(md);
  const rows: LeadRow[] = [];
  let order = startOrder;
  if (!raw.length) return { rows, next: order };
  const colKeys = splitTableRow(raw[0]).map(canonForHeader);
  const isSep = (l: string) => /^\|?[\s:|-]+\|?$/.test(l) && /-/.test(l);
  const seen = new Map<string, LeadRow>(); // dedupe by name-key; merge a later dup's cells into the first
  for (const r of raw.slice(1)) {
    if (isSep(r)) continue;
    const cells = splitTableRow(r);
    const byKey: Record<string, string> = {};
    cells.forEach((c, i) => { const k = colKeys[i]; if (k) { const v = cleanLeadCell(k, c); if (v && !byKey[k]) byKey[k] = v; } });
    const name = byKey['name'] || '';
    if (!name || isJunkName(name)) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = seen.get(key);
    if (existing) { for (const c of LEAD_CANON) { if (byKey[c.key] && !existing.cells[c.key]) existing.cells[c.key] = byKey[c.key]; } continue; }
    const row: LeadRow = { key, cells: byKey, order: order++ };
    seen.set(key, row); rows.push(row);
  }
  return { rows, next: order };
}

// Render parsed rows back to a markdown table (full canonical columns). Used to build a sub-list of
// only the rows that still need work, so the browser pass FOCUSES on the missing ones.
export function rowsToMarkdown(rows: LeadRow[]): string {
  const header = '| ' + LEAD_CANON.map((c) => c.label).join(' | ') + ' |';
  const sep = '| ' + LEAD_CANON.map(() => '---').join(' | ') + ' |';
  const body = rows.map((r) => '| ' + LEAD_CANON.map((c) => r.cells[c.key] || '—').join(' | ') + ' |');
  return [header, sep, ...body].join('\n');
}

export function mergeLeadTables(oldMd: string, newMd: string): string {
  const oldParsed = parseLeadRows(oldMd, 0);
  const newParsed = parseLeadRows(newMd, oldParsed.next);
  // Keep the user's existing order; overlay the new pass onto matching people, append new-only rows.
  const map = new Map<string, LeadRow>();
  for (const r of oldParsed.rows) if (!map.has(r.key)) map.set(r.key, r);
  for (const nr of newParsed.rows) {
    const ex = map.get(nr.key);
    if (ex) { for (const c of LEAD_CANON) { if (nr.cells[c.key]) ex.cells[c.key] = nr.cells[c.key]; } } // fill/refresh, never blank
    else map.set(nr.key, nr);
  }
  const all = [...map.values()].sort((a, b) => a.order - b.order);
  // Output only the columns that actually carry data (always Name + LinkedIn), in canonical order.
  const cols = LEAD_CANON.filter((c) => c.key === 'name' || c.key === 'linkedin' || all.some((r) => r.cells[c.key]));
  const header = '| ' + cols.map((c) => c.label).join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = all.map((r) => '| ' + cols.map((c) => r.cells[c.key] || '—').join(' | ') + ' |');
  return [header, sep, ...body].join('\n');
}

// ─── Enforcing the two filters the user picks off the /leads card ────────────
// SENIORITY and SECTOR were being written into the prompt and then never checked against the
// result, so a model that drifted was never caught: a request for logistics founders came back
// with someone working at Intel and the run reported success. These are the checks that make them
// real constraints. They read the whole row (role, sector, company) because models put the useful
// word in a different column each time.

const DECISION_MAKER_RE =
  /\b(founder|co-?founder|owner|ceo|cto|coo|cmo|cfo|cro|cxo|chief\b[\w\s]*|managing director|man\.? dir|md\b|president|partner|proprietor|principal|director|head\b|vp\b|vice president|avp|svp|evp|board member|chairman|chairperson|promoter)\b/i;

/**
 * Does this row's job title clear the seniority bar the user asked for?
 *
 * 'any' (or nothing picked) accepts everyone. Otherwise the row must carry an actual
 * decision-making title somewhere — the point of the filter is "someone who can say yes", so a
 * row whose role is blank or a plain individual-contributor title does not pass. Being generous
 * about WHERE the title appears is deliberate: it lands in Company/Role most of the time, but
 * models sometimes put it in the name cell ("Priya Nair, Founder") or leave it in the sector.
 */
export function matchesSeniority(cells: Record<string, string>, seniority: string[]): boolean {
  if (!seniority?.length || seniority.includes('any')) return true;
  const hay = `${cells['company'] || ''} ${cells['name'] || ''} ${cells['sector'] || ''}`;
  // The user's own words come first: if they asked for a "founder" and the row says founder, that
  // is a match regardless of what the generic list thinks.
  const asked = seniority
    .flatMap((s) => s.toLowerCase().split(/[^a-z]+/))
    .filter((t) => t.length > 2 && t !== 'any' && t !== 'and' && t !== 'the');
  if (asked.some((t) => hay.toLowerCase().includes(t))) return true;
  return DECISION_MAKER_RE.test(hay);
}

/**
 * Is this row plausibly in the sector the user asked for?
 *
 * Deliberately FORGIVING, because sector wording never matches exactly — "logistics" legitimately
 * shows up as freight, shipping, supply chain, 3PL, courier, warehousing. One shared word anywhere
 * in the row is enough. What it does catch is the case that actually goes wrong: a row with no
 * connection to the sector at all. An empty request accepts everything.
 */
const SECTOR_SYNONYMS: Record<string, string[]> = {
  logistics: ['logistic', 'freight', 'shipping', 'supply chain', 'supplychain', 'courier', 'warehous', 'transport', 'trucking', 'delivery', 'fulfil', 'fulfill', '3pl', 'cargo', 'last mile', 'lastmile', 'moving', 'packers'],
  fintech: ['fintech', 'financ', 'payment', 'lending', 'bank', 'insur', 'wealth', 'invest', 'credit', 'neobank'],
  healthcare: ['health', 'medical', 'clinic', 'hospital', 'pharma', 'diagnostic', 'wellness', 'medtech', 'biotech'],
  edtech: ['edtech', 'educat', 'learning', 'school', 'college', 'university', 'training', 'tutor', 'course'],
  ecommerce: ['ecommerce', 'e-commerce', 'commerce', 'retail', 'marketplace', 'd2c', 'dtc', 'shopping'],
  saas: ['saas', 'software', 'platform', 'cloud', 'b2b software', 'enterprise software', 'tech'],
  realestate: ['real estate', 'realestate', 'property', 'proptech', 'housing', 'construction', 'realty'],
  manufacturing: ['manufactur', 'factory', 'industrial', 'production', 'engineering', 'fabricat'],
  marketing: ['marketing', 'advertis', 'agency', 'brand', 'media', 'creative', 'digital marketing', 'seo', 'ads'],
  travel: ['travel', 'tourism', 'hospitality', 'hotel', 'booking', 'trip', 'holiday'],
  food: ['food', 'restaurant', 'beverage', 'catering', 'cloud kitchen', 'fmcg', 'dairy', 'agri'],
};

export function matchesSector(cells: Record<string, string>, sector: string): boolean {
  const want = (sector || '').trim().toLowerCase();
  if (!want) return true;
  const hay = `${cells['sector'] || ''} ${cells['company'] || ''} ${cells['name'] || ''}`.toLowerCase();
  // Every meaningful word the user typed, plus the known synonyms for any of them.
  const asked = want.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const terms = new Set<string>(asked);
  for (const key of Object.keys(SECTOR_SYNONYMS)) {
    if (want.includes(key) || asked.some((t) => key.includes(t) || t.includes(key))) {
      for (const syn of SECTOR_SYNONYMS[key]) terms.add(syn);
    }
  }
  if (!terms.size) return true;
  // Stem lightly so "logistics" matches "logistic" and "shipping" matches "shipment".
  return [...terms].some((t) => hay.includes(t) || (t.length > 5 && hay.includes(t.slice(0, -1))));
}
