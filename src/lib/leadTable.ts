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
  return s;
}

export function isJunkName(name: string): boolean {
  const fc = name.trim();
  if (!fc) return true;
  if (/^(name|company|company\/role|sector|city|website|linkedin|phone|email|status|column)\b/i.test(fc)) return true;
  if (/^(partner|founder|co-?founder|ceo|cmd|md|director|chairman|head|senior partner|managing director)\b/i.test(fc)) return true;
  if (/couldn'?t verify|unverified guess|found via|\]\(https?:/i.test(fc)) return true; // corrupted-name leftovers
  if (/\/in\/|linkedin\.com|https?:\/\//i.test(fc)) return true;                        // a URL/slug fragment leaked into the name
  return false;
}

export type LeadRow = { key: string; cells: Record<string, string>; order: number };

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
