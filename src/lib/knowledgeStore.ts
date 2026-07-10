// ─── Brain — shared knowledge graph (Obsidian-style) ─────────────────────────
// A persistent, visual store of the user's important data: company lists,
// outreach drafts, contacts + their progress, attached files (with their path),
// and free notes — all as NODES connected by EDGES. It is localStorage-backed so
// BOTH the Brain screen (UI) and the in-frontend Krew agent tools read/write the
// SAME store. Agents save results here and recall them later instead of
// re-fetching → fewer tokens, and nothing is forgotten between turns.

export type BrainNodeKind = 'note' | 'file' | 'data' | 'list' | 'outreach' | 'contact' | 'source';

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
            if (href && a?.textContent) return `[${a.textContent.trim()}](${href})`;
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
    const i = d.nodes.length;
    const node: BrainNode = {
      id: uid(), kind: n.kind ?? 'note', title: n.title.slice(0, 120), body: n.body ?? '',
      filePath: n.filePath,
      x: 80 + (i % 6) * 220, y: 80 + Math.floor(i / 6) * 150,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    d.nodes.push(node);
    write(d);
    return node;
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
};
