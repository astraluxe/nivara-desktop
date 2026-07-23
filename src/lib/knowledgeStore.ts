// ─── Brain — shared knowledge graph (Obsidian-style) ─────────────────────────
// A persistent, visual store of the user's important data: company lists,
// outreach drafts, contacts + their progress, attached files (with their path),
// and free notes — all as NODES connected by EDGES. It is localStorage-backed so
// BOTH the Brain screen (UI) and the in-frontend Krew agent tools read/write the
// SAME store. Agents save results here and recall them later instead of
// re-fetching → fewer tokens, and nothing is forgotten between turns.

export type BrainNodeKind = 'note' | 'file' | 'data' | 'list' | 'outreach' | 'contact' | 'source' | 'image' | 'skill';

// Title of the single hub node that all saved pictures (logos, photos the user drops in
// chat) connect to — the Brain's "Pictures folder".
export const PICTURES_HUB = 'Pictures';

export interface BrainNode {
  id: string;
  kind: BrainNodeKind;
  title: string;
  body: string;          // the content/summary agents can recall
  filePath?: string;     // for attached files (path saved + connected to its data)
  ref?: string;          // user's free-text reference note about this node
  x: number; y: number;  // graph position
  createdAt: number;
  updatedAt: number;
}
export interface BrainEdge { id: string; source: string; target: string; label?: string }
export interface BrainData { nodes: BrainNode[]; edges: BrainEdge[] }

const KEY = 'nv-brain-v1';
export const BRAIN_EVENT = 'nv-brain-changed';

function read(): BrainData {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { nodes: Array.isArray(r.nodes) ? r.nodes : [], edges: Array.isArray(r.edges) ? r.edges : [] };
  } catch { return { nodes: [], edges: [] }; }
}
function write(d: BrainData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ }
  try { window.dispatchEvent(new Event(BRAIN_EVENT)); } catch { /* no window */ }
}
function uid() { return 'bn-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3); }

// Where to drop a new node. The old formula (x = 80 + (i%6)*220, y = 80 + floor(i/6)*150,
// i = node count) marched DOWNWARD forever — so every added file spawned further from the
// cluster and the canvas kept zooming out to reach it. Instead, place new nodes in a tight
// golden-angle ring around the CENTROID of what's already there, so they land next to the
// existing graph, in view.
function nextPos(nodes: BrainNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 240, y: 180 };
  const cx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
  const cy = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
  const k = nodes.length;
  const ang = k * 2.399963;               // golden angle → even, non-overlapping spread
  const r = 150 + (k % 6) * 28;
  return { x: Math.round(cx + Math.cos(ang) * r), y: Math.round(cy + Math.sin(ang) * r) };
}
function normTitle(t: string): string {
  return (t || '').toLowerCase().replace(/\.(md|txt|json|csv|markdown)$/i, '').trim();
}

// Convert a node's stored body (HTML if the user edited it, else markdown) into
// clean MARKDOWN — so when it's attached to Krew the TABLE survives (pipes intact)
// instead of collapsing into a run-together blob.
export function nodeToMarkdown(body: string): string {
  if (!/<(table|p|h[1-6]|ul|ol|li|strong|em|br|a|div)\b/i.test(body)) return body.trim();
  const mdNode = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const kids = () => Array.from(el.childNodes).map(mdNode).join('');
    switch (tag) {
      case 'h1': return `\n# ${el.textContent?.trim() ?? ''}\n`;
      case 'h2': return `\n## ${el.textContent?.trim() ?? ''}\n`;
      case 'h3': case 'h4': return `\n### ${el.textContent?.trim() ?? ''}\n`;
      case 'strong': case 'b': return `**${kids()}**`;
      case 'em': case 'i': return `*${kids()}*`;
      case 'a': { const href = el.getAttribute('href') || ''; const t = el.textContent?.trim() || ''; return href ? `[${t}](${href})` : t; }
      case 'br': return '\n';
      case 'p': case 'div': return `\n${kids()}\n`;
      case 'ul': case 'ol': return `\n${kids()}\n`;
      case 'li': return `- ${el.textContent?.trim() ?? ''}\n`;
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'));
        if (!rows.length) return '';
        let md = '\n';
        rows.forEach((tr, ri) => {
          const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => {
            const a = c.querySelector('a');
            const href = a?.getAttribute('href');
            // A bare URL cell (the Profile column) round-trips as a plain URL, not "[url](url)" —
            // the outreach reader wants the raw link, and the doubled form is noise for the user.
            if (href && a?.textContent) {
              const t = a.textContent.trim();
              return t === href ? href : `[${t}](${href})`;
            }
            return (c.textContent || '').trim().replace(/\|/g, '/');
          });
          md += '| ' + cells.join(' | ') + ' |\n';
          if (ri === 0) md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        });
        return md + '\n';
      }
      default: return kids();
    }
  };
  try {
    const doc = new DOMParser().parseFromString(body, 'text/html');
    return Array.from(doc.body.childNodes).map(mdNode).join('').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Append markdown to a note body that might be EITHER markdown or HTML.
 *
 * A note's stored body starts as markdown, but the Brain editor is a contentEditable that saves
 * `innerHTML` — so the moment a user opens and edits a note, its body becomes HTML for good.
 * Appending raw markdown to that HTML produced the "table breaks on the second scan" bug: the
 * HTML part still rendered as a table while the appended pipe rows collapsed onto a single line,
 * because HTML ignores the newlines separating them.
 *
 * Normalising the existing body back to markdown first keeps ONE consistent format in the note,
 * so appends stay parseable no matter how the note was last touched.
 */
export function appendToBody(existingBody: string | undefined, markdownToAdd: string, separator = '\n'): string {
  const prev = (existingBody || '').trim();
  if (!prev) return markdownToAdd;
  return `${nodeToMarkdown(prev)}${separator}${markdownToAdd}`;
}

/** Cells of one markdown table row, without the empty edges the outer pipes create. */
function splitCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/**
 * Repair a markdown table whose rows have been run together onto one line.
 *
 * This happens when rows were appended to a body that had become HTML (see appendToBody): the
 * newlines separating them are lost, leaving "| a | b | c | | d | e | f |" as a single line that
 * renders as one enormous row. Knowing the column count from the header, the cells can be
 * re-chunked back into the correct rows — the data itself is all still there, only the line
 * breaks were destroyed.
 *
 * Returns the repaired text plus how many rows were recovered, so the caller can report honestly
 * rather than claiming a fix that did nothing.
 */
export function repairMarkdownTables(md: string): { text: string; rowsRecovered: number } {
  const lines = md.split('\n');
  const out: string[] = [];
  let rowsRecovered = 0;
  let cols = 0; // column count of the table currently being read

  for (const raw of lines) {
    const line = raw.trim();

    // A non-blank, non-table line ends the current table — the next one may have a different shape.
    if (!line.startsWith('|') || !line.endsWith('|')) {
      if (line) cols = 0;
      out.push(raw);
      continue;
    }

    const cells = splitCells(line);
    const isSeparator = /^\|[\s:|-]+\|$/.test(line) && line.includes('-');
    if (isSeparator || cols === 0) {   // separator, or the header that starts this table
      cols = cells.length;
      out.push(raw);
      continue;
    }
    if (cells.length <= cols) { out.push(raw); continue; }   // already a single well-formed row

    // Run-on row: take `cols` cells at a time. Consecutive rows are separated by one empty token
    // (the "||" where one row's closing pipe meets the next row's opening pipe).
    let i = 0;
    let added = 0;
    while (i < cells.length) {
      const row = cells.slice(i, i + cols);
      if (row.length === cols && row.some((c) => c)) { out.push(`| ${row.join(' | ')} |`); added++; }
      i += cols;
      if (i < cells.length && cells[i] === '') i++;
    }
    if (added > 1) rowsRecovered += added - 1;
  }

  return { text: out.join('\n'), rowsRecovered };
}

export const brain = {
  all: read,

  /** Add a node. De-dupes by title (case-insensitive) — updates the existing one instead. */
  addNode(n: { title: string; body?: string; kind?: BrainNodeKind; filePath?: string }): BrainNode {
    const d = read();
    // De-dupe by NORMALISED title (ignore case + trailing .md/.txt/.json/.csv) so
    // "PRODUCT.MD" and "PRODUCT.MD.md" don't create two nodes.
    const nt = normTitle(n.title);
    const existing = d.nodes.find((x) => normTitle(x.title) === nt);
    if (existing) {
      if (n.body !== undefined) existing.body = n.body;
      if (n.kind) existing.kind = n.kind;
      if (n.filePath) existing.filePath = n.filePath;
      existing.updatedAt = Date.now();
      write(d);
      return existing;
    }
    const { x, y } = nextPos(d.nodes);
    const node: BrainNode = {
      id: uid(), kind: n.kind ?? 'note', title: n.title.slice(0, 120), body: n.body ?? '',
      filePath: n.filePath,
      x, y,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    d.nodes.push(node);
    write(d);
    // Auto-link the new node to anything it clearly relates to, so the graph stays connected as it
    // grows instead of accumulating orphans. Cheap (token-free) and scoped to just this node.
    try { this.autoConnect(node.id); } catch { /* linking is best-effort, never block the add */ }
    return node;
  },

  /** Like addNode, but NEVER overwrites an existing same-titled node — finds a free
   *  "title (2)", "title (3)"... instead. For auto-captured content (Guard scans, Coder
   *  explanations, saved emails) where each new one is its own distinct record, not a
   *  continuation of the last thing that happened to get the same title. */
  addUniqueNode(n: { title: string; body?: string; kind?: BrainNodeKind; filePath?: string }): BrainNode {
    const d = read();
    let title = n.title;
    if (d.nodes.some((x) => normTitle(x.title) === normTitle(title))) {
      for (let i = 2; i < 50; i++) {
        const t = `${n.title} (${i})`;
        if (!d.nodes.some((x) => normTitle(x.title) === normTitle(t))) { title = t; break; }
      }
    }
    return this.addNode({ ...n, title });
  },

  updateNode(id: string, patch: Partial<BrainNode>) {
    const d = read();
    const n = d.nodes.find((x) => x.id === id);
    if (n) { Object.assign(n, patch, { updatedAt: Date.now() }); write(d); }
  },

  deleteNode(id: string) {
    const d = read();
    d.nodes = d.nodes.filter((n) => n.id !== id);
    d.edges = d.edges.filter((e) => e.source !== id && e.target !== id);
    write(d);
  },

  link(source: string, target: string, label?: string) {
    const d = read();
    if (source === target) return;
    const dup = d.edges.some((e) =>
      (e.source === source && e.target === target) || (e.source === target && e.target === source));
    if (!dup) { d.edges.push({ id: uid(), source, target, label }); write(d); }
  },

  unlink(edgeId: string) {
    const d = read();
    d.edges = d.edges.filter((e) => e.id !== edgeId);
    write(d);
  },

  /**
   * Auto-connect related nodes — token-free (no LLM), so it costs nothing and runs instantly.
   * The Brain kept filling with files that were clearly related but sat unlinked because nothing
   * ever drew the edge. This finds those relationships from the content itself:
   *   1. TITLE MENTION (strong): one node's title appears verbatim in another's body/title. If your
   *      "Tech leads" list is built from "PRODUCT.md", the list's body mentions the product — link.
   *   2. SAME FOLDER (strong): two file nodes imported from the same folder path.
   *   3. SHARED KEYWORDS (softer): they share ≥2 distinctive words (≥5 chars) in their titles.
   * Deliberately conservative — a wrong edge is worse than a missing one, so generic/stopword-only
   * overlaps are ignored and a mention only counts for a title of real length. Returns edges added.
   * Pass `onlyNodeId` to connect just one (new) node to the rest; omit for a full sweep.
   */
  autoConnect(onlyNodeId?: string): number {
    const d = read();
    const STOP = new Set(['note','file','data','list','the','and','for','with','from','your','about','into','notes','draft','list','files','folder','pictures','source','contact','outreach','profile','company','companies']);
    const norm = (s: string) => (s || '').toLowerCase().replace(/\.(md|txt|json|csv|markdown|pdf|docx?)$/i, '').trim();
    const keyWords = (s: string) => Array.from(new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w))));
    const folderOf = (p?: string) => { if (!p) return ''; const m = p.replace(/\\/g, '/').match(/^(.*)\//); return m ? m[1].toLowerCase() : ''; };
    const has = (a: string, b: string) => d.edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));

    const nodes = d.nodes;
    const pool = onlyNodeId ? nodes.filter((n) => n.id === onlyNodeId) : nodes;
    let added = 0;
    for (const a of pool) {
      const aTitle = norm(a.title);
      const aBody = (a.body || '').toLowerCase();
      const aKeys = keyWords(a.title);
      const aFolder = folderOf(a.filePath);
      for (const b of nodes) {
        if (a.id === b.id || has(a.id, b.id)) continue;
        const bTitle = norm(b.title);
        let label = '';
        // 1. Title mention (either direction). Require length ≥5 so short generic titles don't match.
        if (bTitle.length >= 5 && (aBody.includes(bTitle) || aTitle.includes(bTitle))) label = 'mentions';
        else if (aTitle.length >= 5 && (b.body || '').toLowerCase().includes(aTitle)) label = 'mentions';
        // 2. Same import folder.
        else if (aFolder && aFolder === folderOf(b.filePath)) label = 'same folder';
        // 3. ≥2 shared distinctive title words.
        else { const shared = aKeys.filter((w) => keyWords(b.title).includes(w)); if (shared.length >= 2) label = 'related'; }
        if (label) { d.edges.push({ id: uid(), source: a.id, target: b.id, label }); added++; }
      }
    }
    if (added) write(d);
    return added;
  },

  findByTitle(q: string): BrainNode | undefined {
    const d = read();
    const ql = q.trim().toLowerCase();
    return d.nodes.find((n) => n.title.toLowerCase() === ql)
        ?? d.nodes.find((n) => n.title.toLowerCase().includes(ql));
  },

  // Relevance-SCORED, not a blind single-substring match. The old version treated the whole
  // query as one substring test against title+body — for a short/generic query (a single
  // word like "companies" or "Bangalore") that silently surfaces a completely unrelated old
  // note (any note that happens to mention that one word anywhere) as if it were a real match,
  // with no ranking to prefer an actually-relevant hit. This is how a stale, off-topic Brain
  // note can get handed to an agent as "the" answer to an unrelated question. Score by how
  // many of the query's significant words appear (title matches weighted higher, an exact
  // full-phrase match highest of all), and only return notes with a real, positive score.
  search(q: string): BrainNode[] {
    const d = read();
    const ql = q.trim().toLowerCase();
    if (!ql) return d.nodes;
    const words = ql.split(/\s+/).filter((w) => w.length >= 3);
    const scored = d.nodes.map((n) => {
      const title = n.title.toLowerCase();
      const body = n.body.toLowerCase();
      let score = 0;
      if (title.includes(ql)) score += 10;
      else if (body.includes(ql)) score += 4;
      for (const w of words) {
        if (title.includes(w)) score += 3;
        else if (body.includes(w)) score += 1;
      }
      return { n, score };
    });
    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.n);
  },

  // ── Pictures folder ─────────────────────────────────────────────────────────
  /** Find (or create) the single "Pictures" hub node that all saved images link to. */
  ensurePicturesHub(): BrainNode {
    const d = read();
    const hub = d.nodes.find((n) => n.kind === 'list' && normTitle(n.title) === normTitle(PICTURES_HUB));
    if (hub) return hub;
    return this.addNode({ title: PICTURES_HUB, kind: 'list', body: 'Your saved pictures — logos and images you can drop into presentations and notes.' });
  },

  /** Save a picture as an image node (its bytes live on disk at filePath) and link it into
   *  the Pictures folder. Never overwrites a same-named picture — keeps "name (2)" etc. */
  addPicture(p: { name: string; filePath: string; body?: string }): BrainNode {
    const hub = this.ensurePicturesHub();
    const node = this.addUniqueNode({ title: p.name, kind: 'image', filePath: p.filePath, body: p.body ?? '' });
    this.link(hub.id, node.id, 'picture');
    return node;
  },

  /** All saved pictures (image nodes), newest first. */
  listPictures(): BrainNode[] {
    return read().nodes.filter((n) => n.kind === 'image').sort((a, b) => b.createdAt - a.createdAt);
  },
};
