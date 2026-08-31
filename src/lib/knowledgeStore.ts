// ─── Brain — shared knowledge graph (Obsidian-style) ─────────────────────────
// A persistent, visual store of the user's important data: company lists,
// outreach drafts, contacts + their progress, attached files (with their path),
// and free notes — all as NODES connected by EDGES. It is localStorage-backed so
// BOTH the Brain screen (UI) and the in-frontend Krew agent tools read/write the
// SAME store. Agents save results here and recall them later instead of
// re-fetching → fewer tokens, and nothing is forgotten between turns.

export type BrainNodeKind = 'note' | 'file' | 'data' | 'list' | 'outreach' | 'contact' | 'source' | 'image' | 'skill' | 'link';

// Title of the single hub node that all saved pictures (logos, photos the user drops in
// chat) connect to — the Brain's "Pictures folder".
export const PICTURES_HUB = 'Pictures';

// The same idea for web pages an agent worked on or found worth keeping: the Notion page it
// filled in, the sheet it built, the profile it verified. One hub, then one group per site
// underneath it — see addLink for why the grouping is not optional.
export const LINKS_HUB = 'Links';

// And the same for things that live on disk in the user's own workspace folder: the poster that
// was generated, the video that was downloaded, the PDF that was exported. The Brain holds the
// PATH, not the bytes — so "post that poster to Instagram" a week later can find the file instead
// of asking the user where they put it.
export const FILES_HUB = 'Files';

export interface BrainNode {
  id: string;
  kind: BrainNodeKind;
  title: string;
  body: string;          // the content/summary agents can recall
  filePath?: string;     // for attached files (path saved + connected to its data)
  /**
   * The page this node IS, for link nodes — the Notion doc an agent filled in, the sheet it built.
   *
   * A first-class field rather than a URL buried in the body, because everything useful depends on
   * having it separately: opening it in one click, and knowing that two saves are the same page.
   */
  url?: string;
  ref?: string;          // user's free-text reference note about this node
  /**
   * The COMPLETE content, kept aside while the note is narrowed to a filtered subset.
   *
   * Filtering a big sheet used to produce a second note, which is the wrong shape for the problem:
   * the user wants THIS list to show the rows that matter, not a growing pile of near-duplicates
   * they then have to keep straight. So `body` becomes the filtered rows — which is what every
   * agent reads, and the whole point — and the original is parked here so "show all rows" is
   * always one click away and nothing is ever actually lost.
   */
  fullBody?: string;
  /** One line describing the active filter, for the banner ("Country: INDIA · 672 of 4,000"). */
  viewNote?: string;
  x: number; y: number;  // graph position
  createdAt: number;
  updatedAt: number;
  /** For image nodes: an identity for the bytes, so the same picture is never stored twice. */
  hash?: string;
}
export interface BrainEdge { id: string; source: string; target: string; label?: string }
export interface BrainData { nodes: BrainNode[]; edges: BrainEdge[] }

const KEY = 'nv-brain-v1';
export const BRAIN_EVENT = 'nv-brain-changed';

// ─── "Show me where it went" ─────────────────────────────────────────────────
// Anywhere in the app that saves something to the Brain can ask the Brain screen to point at it.
// Two channels on purpose: the event handles the case where the Brain is already mounted, and the
// localStorage key survives the module switch for the case where it is not (which is the usual
// one — you press "Open in Brain" from the Krew chat, so the Brain mounts fresh a beat later and
// there was nobody listening when the event fired).
export const BRAIN_FOCUS_EVENT = 'nv-brain-focus';
const FOCUS_KEY = 'nv-brain-focus-request';

/** Ask the Brain screen to select, centre and flash the node with this title (or id). */
export function requestBrainFocus(titleOrId: string) {
  if (!titleOrId) return;
  try { localStorage.setItem(FOCUS_KEY, JSON.stringify({ q: titleOrId, at: Date.now() })); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(BRAIN_FOCUS_EVENT, { detail: titleOrId })); } catch { /* no window */ }
}

/** Read and clear a pending focus request. Stale ones (over a minute old) are ignored — a request
 *  left over from an earlier session must not hijack the graph the next time the Brain is opened. */
export function takeBrainFocus(): string | null {
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return null;
    localStorage.removeItem(FOCUS_KEY);
    const { q, at } = JSON.parse(raw) as { q?: string; at?: number };
    if (!q || !at || Date.now() - at > 60_000) return null;
    return q;
  } catch { return null; }
}

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
/**
 * Is this body HTML the editor produced, or markdown that merely contains a tag?
 *
 * The old test counted <br>, <a>, <strong> and <em> as proof of HTML. But a markdown table cell
 * CANNOT hold a newline, so <br> is the standard way to write a multi-line cell — and agents use it
 * constantly. One <br> anywhere therefore sent an entire markdown document down the HTML path,
 * where the pipe characters are just text: the DOM parser flattened every table into a single
 * run-on line and the saved note became an unreadable blob. That is how a good strategy answer
 * arrived in the Brain with its tables destroyed.
 *
 * Only BLOCK-level tags indicate a body the contentEditable editor actually wrote. Inline tags are
 * legitimate inside markdown and are left for the renderer to deal with.
 */
function looksLikeEditorHtml(body: string): boolean {
  return /<(table|p|h[1-6]|ul|ol|li|div)\b/i.test(body);
}

/**
 * Un-escape a note whose own HTML has been turned into visible text.
 *
 * THE DAMAGE THIS UNDOES. A note body is sometimes markdown and sometimes editor HTML, and the
 * renderer picks between them. Put an HTML body through the MARKDOWN path once and every tag is
 * escaped for display: `<table>` becomes `&lt;table&gt;` and, because escaping runs over text that
 * already contains entities, `&amp;` becomes `&amp;amp;`. Save that and the note now literally
 * contains its own source code. What the user sees is a wall of `<td>` and `&amp;` — the 5,000-word
 * strategy note that arrived unreadable.
 *
 * It also defeats every repair downstream: nodeToMarkdown asks looksLikeEditorHtml first, an
 * escaped body has no real tags, so it is returned untouched and /repair-table reports "0 rows"
 * about a note that is nothing but table markup.
 *
 * So the decode happens at READ time, not by rewriting anything: notes already sitting damaged in
 * the Brain display correctly the next time they are opened, with no migration and no edit.
 *
 * Deliberately conservative, and it CANNOT be decided by "are there real tags too". The markdown
 * renderer wraps what it escapes in real `<p>` tags, so a damaged body carries both: genuine
 * wrappers around escaped markup. What separates the two cases is how MUCH escaped structure there
 * is — prose explaining a `&lt;div&gt;` mentions one, a document whose own markup was escaped
 * carries dozens. Three is comfortably above the first and far below the second.
 *
 * `&amp;amp;` is collapsed one level only, never to a bare `&`: an ampersand that was always
 * correctly encoded must survive untouched.
 */
export function decodeEscapedHtml(body: string): string {
  const t = body || '';
  const escaped = t.match(/&lt;\s*\/?\s*(?:table|thead|tbody|tr|td|th|p|h[1-6]|ul|ol|li|div|pre|blockquote)\b/gi);
  if (!escaped || escaped.length < 3) return t;
  return t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // One level only. The body was escaped once too often, so &amp;amp; is the doubled form of
    // &amp; — collapsing all the way to "&" would corrupt an ampersand that was always correct.
    .replace(/&amp;(amp|lt|gt|quot|#39|nbsp);/gi, '&$1;');
}

export function nodeToMarkdown(body: string): string {
  body = decodeEscapedHtml(body);
  if (!looksLikeEditorHtml(body)) return body.trim();
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
  addNode(n: { title: string; body?: string; kind?: BrainNodeKind; filePath?: string; url?: string }): BrainNode {
    const d = read();
    // De-dupe by NORMALISED title (ignore case + trailing .md/.txt/.json/.csv) so
    // "PRODUCT.MD" and "PRODUCT.MD.md" don't create two nodes.
    const nt = normTitle(n.title);
    const existing = d.nodes.find((x) => normTitle(x.title) === nt);
    if (existing) {
      if (n.body !== undefined) existing.body = n.body;
      if (n.kind) existing.kind = n.kind;
      if (n.filePath) existing.filePath = n.filePath;
      if (n.url) existing.url = n.url;
      existing.updatedAt = Date.now();
      write(d);
      return existing;
    }
    const { x, y } = nextPos(d.nodes);
    const node: BrainNode = {
      id: uid(), kind: n.kind ?? 'note', title: n.title.slice(0, 120), body: n.body ?? '',
      filePath: n.filePath, url: n.url,
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
  addUniqueNode(n: { title: string; body?: string; kind?: BrainNodeKind; filePath?: string; url?: string; hash?: string }): BrainNode {
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

  /**
   * FUZZY LOOKUP — a search, not an identity check.
   *
   * The substring fallback is what makes "find me the product note" work when the node is actually
   * called "PRODUCT.MD — adris.tech". It is the wrong tool for deciding whether a node ALREADY
   * EXISTS, because "Lead list — Bengaluru" is a substring of "Tech lead list — Bengaluru": asking
   * this whether a new list exists yet answers "yes, here is a completely different list", and the
   * caller then writes into it. Use findExactByTitle for that. Kept fuzzy here because the recall
   * paths genuinely want it.
   */
  findByTitle(q: string): BrainNode | undefined {
    const d = read();
    const ql = q.trim().toLowerCase();
    return d.nodes.find((n) => n.title.toLowerCase() === ql)
        ?? d.nodes.find((n) => n.title.toLowerCase().includes(ql));
  },

  /** EXACT title match, ignoring case and a trailing .md/.txt/.json/.csv — the same normalisation
   *  addNode de-dupes on, so "does this node exist?" is answered the same way everywhere. */
  findExactByTitle(q: string): BrainNode | undefined {
    const nt = normTitle(q);
    return read().nodes.find((n) => normTitle(n.title) === nt);
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

  /**
   * Save a picture into the Pictures folder — once.
   *
   * This used to lean on `addUniqueNode`, which does the OPPOSITE of dedupe: on a title clash it
   * keeps both and renames the newcomer "figure 1 (2)". So attaching the same document a second
   * time doubled every figure in the folder, which is exactly what a user reported.
   *
   * `hash` is an identity for the BYTES (see lib/pictureSave.ts). Filenames cannot do this job —
   * two unrelated figures are both "image1.png", and the same logo arrives under a different name
   * every time. When the bytes are already here, the existing node is returned and nothing is added.
   */
  addPicture(p: { name: string; filePath: string; body?: string; hash?: string }): BrainNode {
    const hub = this.ensurePicturesHub();
    if (p.hash) {
      const existing = read().nodes.find((n) => n.kind === 'image' && n.hash === p.hash);
      if (existing) return existing;      // same picture, already saved
    }
    const node = this.addUniqueNode({ title: p.name, kind: 'image', filePath: p.filePath, body: p.body ?? '', hash: p.hash });
    this.link(hub.id, node.id, 'picture');
    return node;
  },

  /** Every picture's content hash, so a caller can decide before writing anything to disk. */
  pictureHashes(): string[] {
    return read().nodes.filter((n) => n.kind === 'image' && n.hash).map((n) => n.hash as string);
  },

  /** All saved pictures (image nodes), newest first. */
  listPictures(): BrainNode[] {
    return read().nodes.filter((n) => n.kind === 'image').sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Links folder ────────────────────────────────────────────────────────────
  //
  // Agents work on the real web — they open a Notion page and fill it in, build a sheet, find the
  // right profile. Until now the URL of whatever they made existed only in a chat message, which
  // means it was gone the moment the conversation scrolled: the user could not reopen it, and the
  // NEXT agent could not either, so it got made again somewhere else.
  //
  // Three things make the difference between a link store and a pile of links, and all three live
  // here rather than in the agents, because a rule an agent has to remember is a rule that holds
  // most of the time:
  //   · the URL is canonicalised, so the same page saved from three places is ONE entry;
  //   · saving an existing page updates it instead of adding a near-duplicate;
  //   · every link hangs off its own site's group, so fifty links are ten tidy folders and not
  //     fifty loose nodes sprayed across the graph.

  /** Find (or create) the single "Links" hub every saved page hangs under. */
  ensureLinksHub(): BrainNode {
    const d = read();
    const hub = d.nodes.find((n) => n.kind === 'list' && normTitle(n.title) === normTitle(LINKS_HUB));
    return hub ?? this.addNode({
      title: LINKS_HUB, kind: 'list',
      body: 'Pages you and your agents have worked on or want to come back to — grouped by site. Open one to go straight there.',
    });
  },

  /** Find (or create) the group node for one site, e.g. "Links — notion.so". */
  ensureSiteGroup(site: string): BrainNode {
    const title = `${LINKS_HUB} — ${site}`;
    const d = read();
    const found = d.nodes.find((n) => normTitle(n.title) === normTitle(title));
    if (found) return found;
    const hub = this.ensureLinksHub();
    const group = this.addNode({ title, kind: 'list', body: `Saved pages on ${site}.` });
    this.link(hub.id, group.id, 'site');
    return group;
  },

  /** The saved page for this URL, whatever spelling it arrives in. */
  findLinkByUrl(url: string): BrainNode | undefined {
    const norm = normalizeLinkUrl(url);
    if (!norm) return undefined;
    return read().nodes.find((n) => n.kind === 'link' && n.url && normalizeLinkUrl(n.url) === norm);
  },

  /**
   * Save a page. Saving one that is already saved UPDATES it — it never makes a second copy.
   *
   * `body` is what the link is FOR in the user's own terms ("the Day-3 validation tracker I built"),
   * because a bare URL six weeks later tells nobody anything.
   */
  addLink(l: { url: string; title: string; body?: string }): BrainNode | null {
    const url = normalizeLinkUrl(l.url);
    if (!url) return null;
    const site = linkSite(url);
    const existing = this.findLinkByUrl(url);
    if (existing) {
      this.updateNode(existing.id, {
        url,
        // A better description replaces a worse one; an empty one never wipes what is there.
        ...(l.body?.trim() ? { body: l.body.trim() } : {}),
        ...(l.title.trim() && normTitle(l.title) !== normTitle(existing.title) ? { title: l.title.trim().slice(0, 120) } : {}),
      });
      return read().nodes.find((n) => n.id === existing.id) ?? existing;
    }
    const group = this.ensureSiteGroup(site);
    const node = this.addUniqueNode({
      title: (l.title.trim() || site).slice(0, 120),
      kind: 'link', url,
      body: l.body?.trim() ?? '',
    });
    this.link(group.id, node.id, 'link');
    return node;
  },

  /** Every saved page, newest first. */
  listLinks(): BrainNode[] {
    return read().nodes.filter((n) => n.kind === 'link').sort((a, b) => b.updatedAt - a.updatedAt);
  },

  // ── Files folder ────────────────────────────────────────────────────────────
  //
  // Same shape as Links and for the same reason: one hub, a group per subfolder, deduped on the
  // thing that identifies the item — here the path on disk. An agent that saves the same poster
  // twice should update one entry, not leave the user guessing which of two nodes is current.

  /** Find (or create) the single "Files" hub every saved file hangs under. */
  ensureFilesHub(): BrainNode {
    const d = read();
    const hub = d.nodes.find((n) => n.kind === 'list' && normTitle(n.title) === normTitle(FILES_HUB));
    return hub ?? this.addNode({
      title: FILES_HUB, kind: 'list',
      body: 'Things your agents made or downloaded into your workspace folder — grouped by folder. Open one to see where it is on disk.',
    });
  },

  /** Find (or create) the group node for one workspace subfolder, e.g. "Files — posters". */
  ensureFolderGroup(folder: string): BrainNode {
    const name = (folder || '').trim() || 'loose';
    const title = `${FILES_HUB} — ${name}`;
    const d = read();
    const found = d.nodes.find((n) => normTitle(n.title) === normTitle(title));
    if (found) return found;
    const hub = this.ensureFilesHub();
    const group = this.addNode({ title, kind: 'list', body: `Files saved in ${name}.` });
    this.link(hub.id, group.id, 'folder');
    return group;
  },

  /** The saved record for a path on disk, however it is capitalised or separated. */
  findFileByPath(filePath: string): BrainNode | undefined {
    const norm = (filePath || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (!norm) return undefined;
    return read().nodes.find((n) => n.kind === 'file' && n.filePath
      && n.filePath.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') === norm);
  },

  /**
   * Record a file the agents put in the workspace. Saving the same path again updates it.
   *
   * `body` is what the file IS in the user's terms ("the launch poster, 1080x1350, for Instagram"),
   * because a path six weeks later tells nobody what is in it.
   */
  addFileRef(f: { filePath: string; title: string; body?: string; folder?: string }): BrainNode | null {
    const filePath = (f.filePath || '').trim();
    if (!filePath) return null;
    const existing = this.findFileByPath(filePath);
    if (existing) {
      this.updateNode(existing.id, {
        filePath,
        ...(f.body?.trim() ? { body: f.body.trim() } : {}),
        ...(f.title.trim() && normTitle(f.title) !== normTitle(existing.title) ? { title: f.title.trim().slice(0, 120) } : {}),
      });
      return read().nodes.find((n) => n.id === existing.id) ?? existing;
    }
    const group = this.ensureFolderGroup(f.folder ?? '');
    const node = this.addUniqueNode({
      title: (f.title.trim() || filePath.split(/[\\/]/).pop() || 'file').slice(0, 120),
      kind: 'file', filePath, body: f.body?.trim() ?? '',
    });
    this.link(group.id, node.id, 'file');
    return node;
  },

  /** Every recorded workspace file, newest first. */
  listFiles(): BrainNode[] {
    return read().nodes.filter((n) => n.kind === 'file' && !!n.filePath)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Recorded files matching a name, a folder or what they were for. */
  findFiles(query: string): BrainNode[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.listFiles();
    return this.listFiles().filter((n) =>
      n.title.toLowerCase().includes(q) || (n.filePath ?? '').toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  },

  /** Saved pages matching a site, a word in the title, or a word in the description. */
  findLinks(query: string): BrainNode[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.listLinks();
    return this.listLinks().filter((n) =>
      n.title.toLowerCase().includes(q) || (n.url ?? '').toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  },
};

// ─── Canonical URLs ──────────────────────────────────────────────────────────

/** Parameters that identify a CAMPAIGN rather than a page. Dropping them is what stops the same
 *  Notion doc arriving from an email, a share sheet and a search from becoming three entries. */
// utm_ is a PREFIX (utm_source, utm_campaign…), the rest are whole names. Written as one anchored
// alternation before, which quietly matched nothing but a parameter literally called "utm_".
const TRACKING = /^(?:utm_.+|fbclid|gclid|mc_[ce]id|igshid|si|ref|ref_src|source|spm)$/i;

/**
 * One spelling per page.
 *
 * Deliberately conservative about what it throws away: the path's case is preserved (plenty of
 * sites are case-sensitive), and the fragment is kept because single-page apps put the actual
 * document id in it. Only the parts that are demonstrably not the page — the scheme's case, a
 * "www.", a trailing slash, campaign parameters — are normalised away.
 */
export function normalizeLinkUrl(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol)) return '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // "https://nonsense" parses perfectly happily, so a model that passes a stray word instead of a
    // URL would otherwise get its own folder in the Links pane. A real host has a dot in it.
    if (!/^localhost$/.test(u.hostname) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(u.hostname)) return '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${u.pathname === '/' ? '' : u.pathname}${qs ? `?${qs}` : ''}${u.hash}`;
  } catch {
    return '';
  }
}

/** The site a URL belongs to, as a person would name it: "notion.so", "docs.google.com". */
export function linkSite(url: string): string {
  try {
    return new URL(normalizeLinkUrl(url) || url).hostname.replace(/^www\./, '') || 'the web';
  } catch {
    return 'the web';
  }
}
