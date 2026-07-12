import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { brain, BRAIN_EVENT, nodeToMarkdown, type BrainNode, type BrainNodeKind, type BrainData } from '../lib/knowledgeStore';

// ─── Kind metadata ────────────────────────────────────────────────────────────
const KIND_COLOR: Record<BrainNodeKind, string> = {
  note: '#7C5CFF', file: '#38bdf8', data: '#34d399', list: '#f59e0b',
  outreach: '#f472b6', contact: '#a78bfa', source: '#94a3b8',
};
const KIND_LABEL: Record<BrainNodeKind, string> = {
  note: 'Note', file: 'File', data: 'Data', list: 'List', outreach: 'Outreach', contact: 'Contact', source: 'Source',
};
const KINDS: BrainNodeKind[] = ['note', 'file', 'data', 'list', 'outreach', 'contact', 'source'];

const NODE_W = 150, NODE_H = 38;

// ─── Content helpers: hide tool-call noise + convert markdown → formatted HTML ──
// so the user always sees a clean, formatted note (never raw ## / ** / <tool_call>).
function cleanBody(text: string): string {
  return (text || '')
    .replace(/<tool_(?:call|code)>[\s\S]*?<\/tool_(?:call|code)>/gi, '')
    .replace(/<tool_(?:call|code)>\s*\{[^|\n]*/gi, '')
    .replace(/<\/?(?:tool_call|tool_code|res|tool_result)[^>]*>?/gi, '')
    .replace(/^\s*\{\s*"tool"\s*:[\s\S]*?\}\s*$/gim, '')
    .trim();
}
function looksLikeHtml(text: string): boolean {
  return /<(table|p|h[1-6]|ul|ol|li|strong|em|div|br|a)\b/i.test(text);
}
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inlineHtml(s: string): string {
  return escHtml(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}
function mdToHtml(md: string): string {
  const lines = cleanBody(md).split('\n');
  const isSep = (s?: string) => !!s && /-/.test(s) && /^[\s|:\-]+$/.test(s.trim());
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block — without this, every line of a saved code snippet (e.g. from a Coder
    // explanation) fell through to the plain-paragraph case below: proportional font, no
    // preserved whitespace, one <p> per line. Render as a real <pre><code> block instead.
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^```\s*$/)) { codeLines.push(lines[i]); i++; }
      i++; // skip the closing fence
      html += `<pre><code>${escHtml(codeLines.join('\n'))}</code></pre>`;
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) { const lvl = Math.min(hm[1].length, 3) + 1; html += `<h${lvl}>${inlineHtml(hm[2])}</h${lvl}>`; i++; continue; }
    if (line.trim().startsWith('|') && (line.match(/\|/g) || []).length >= 2 && lines[i + 1] && lines[i + 1].includes('|')) {
      const header = line; const hasSep = isSep(lines[i + 1]); i += hasSep ? 2 : 1;
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) { body.push(lines[i]); i++; }
      const cells = (r: string) => { let s = r.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split('|').map(c => c.trim()); };
      const heads = isSep(header) ? ['Name', 'Company / Role', 'Sector', 'City', 'Website', 'LinkedIn'] : cells(header);
      const rows = body.filter(b => !isSep(b)).map(cells).filter(c => /[a-z0-9]/i.test((c[0] || '').replace(/[*`[\]()]/g, '')));
      html += '<table><thead><tr>' + heads.map(h => `<th>${inlineHtml(h)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + heads.map((_, ci) => `<td>${inlineHtml(r[ci] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      continue;
    }
    if (line.match(/^\s*[-*]\s+/)) { let items = ''; while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) { items += `<li>${inlineHtml(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; } html += `<ul>${items}</ul>`; continue; }
    if (!line.trim()) { i++; continue; }
    html += `<p>${inlineHtml(line)}</p>`; i++;
  }
  return html;
}
// CSS for the formatted note (used by both the editor and the graph — descendant
// selectors so headings/tables/links/lists all look right in the WYSIWYG surface).
const NOTE_CLS =
  'text-[13px] leading-relaxed outline-none ' +
  '[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-nv-text ' +
  '[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:text-nv-text ' +
  '[&_h4]:text-[12px] [&_h4]:font-semibold [&_h4]:text-nv-text ' +
  '[&_p]:mb-1.5 [&_strong]:font-semibold [&_a]:text-accent [&_a]:underline ' +
  '[&_ul]:list-disc [&_ul]:ml-5 [&_ul]:my-1 [&_li]:mb-0.5 ' +
  '[&_pre]:my-2 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-nv-border [&_pre]:bg-nv-surface2/60 [&_pre]:overflow-x-auto ' +
  '[&_pre_code]:font-mono [&_pre_code]:text-[11.5px] [&_pre_code]:text-nv-text [&_pre_code]:whitespace-pre ' +
  '[&_table]:my-2 [&_table]:border [&_table]:border-nv-border [&_table]:rounded-lg [&_table]:border-collapse ' +
  '[&_th]:text-left [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold [&_th]:text-nv-text [&_th]:border [&_th]:border-nv-border [&_th]:bg-nv-surface2/50 [&_th]:relative ' +
  '[&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:border [&_td]:border-nv-border/50 [&_td]:text-nv-muted ' +
  '[&_.col-resizer]:absolute [&_.col-resizer]:top-0 [&_.col-resizer]:-right-[3px] [&_.col-resizer]:w-[6px] [&_.col-resizer]:h-full [&_.col-resizer]:cursor-col-resize [&_.col-resizer]:z-10 [&_.col-resizer:hover]:bg-accent/40';

// ─── Graph stage (custom SVG + cards, like the Krew Office — no heavy lib) ─────
function Stage({ data, selectedId, onSelect, onMoveNode }: {
  data: BrainData; selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  // live positions during drag (avoids writing to storage on every move)
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const drag = useRef<{ id: string | null; sx: number; sy: number; ox: number; oy: number; moved: boolean; pan?: boolean } | null>(null);

  const nodePos = useCallback((n: BrainNode) => pos[n.id] ?? { x: n.x, y: n.y }, [pos]);

  // Fit-to-content once on first load / when count changes a lot.
  const fitKey = data.nodes.length;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || data.nodes.length === 0) return;
    const xs = data.nodes.map((n) => n.x), ys = data.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys), maxY = Math.max(...ys) + NODE_H;
    const cw = el.clientWidth, ch = el.clientHeight;
    const scale = Math.min(cw / (maxX - minX + 120), ch / (maxY - minY + 120), 1.1);
    setView({
      scale,
      x: (cw - (maxX - minX) * scale) / 2 - minX * scale,
      y: (ch - (maxY - minY) * scale) / 2 - minY * scale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const el = wrapRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const ns = Math.min(2.2, Math.max(0.25, view.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    // zoom toward cursor
    setView((v) => ({
      scale: ns,
      x: mx - ((mx - v.x) / v.scale) * ns,
      y: my - ((my - v.y) / v.scale) * ns,
    }));
  }

  function onBgPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { id: null, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, pan: true };
  }
  function onNodePointerDown(e: React.PointerEvent, n: BrainNode) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = nodePos(n);
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    if (d.pan) {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.id) {
      setPos((p) => ({ ...p, [d.id!]: { x: d.ox + dx / view.scale, y: d.oy + dy / view.scale } }));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.id) {
      if (!d.moved) { onSelect(d.id); }
      else { const p = pos[d.id]; if (p) onMoveNode(d.id, p.x, p.y); }
    } else if (d.pan && !d.moved) {
      onSelect(null);
    }
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  const connectedToSel = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set<string>([selectedId]);
    for (const e of data.edges) {
      if (e.source === selectedId) s.add(e.target);
      if (e.target === selectedId) s.add(e.source);
    }
    return s;
  }, [selectedId, data.edges]);

  return (
    <div
      ref={wrapRef}
      className="relative flex-1 min-h-0 overflow-hidden"
      style={{ cursor: drag.current?.pan ? 'grabbing' : 'default', touchAction: 'none' }}
      onWheel={onWheel}
      onPointerDown={onBgPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="absolute inset-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>
        {/* edges */}
        <svg className="absolute" style={{ overflow: 'visible', pointerEvents: 'none', left: 0, top: 0 }} width="1" height="1">
          {data.edges.map((e) => {
            const a = data.nodes.find((n) => n.id === e.source);
            const b = data.nodes.find((n) => n.id === e.target);
            if (!a || !b) return null;
            const pa = nodePos(a), pb = nodePos(b);
            const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H / 2;
            const x2 = pb.x + NODE_W / 2, y2 = pb.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = !connectedToSel || (connectedToSel.has(e.source) && connectedToSel.has(e.target));
            return (
              <g key={e.id} opacity={on ? 1 : 0.12}>
                <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke={KIND_COLOR[a.kind]} strokeWidth={1.6} strokeOpacity={0.5} strokeLinecap="round" />
                {e.label && (
                  <text x={mx} y={(y1 + y2) / 2 - 4} textAnchor="middle" fontSize="9" fill="var(--nv-faint)">{e.label}</text>
                )}
              </g>
            );
          })}
        </svg>

        {/* nodes */}
        {data.nodes.map((n) => {
          const p = nodePos(n);
          const sel = n.id === selectedId;
          const dim = connectedToSel ? !connectedToSel.has(n.id) : false;
          return (
            <div
              key={n.id}
              onPointerDown={(e) => onNodePointerDown(e, n)}
              className="absolute select-none"
              style={{
                left: p.x, top: p.y, width: NODE_W, minHeight: NODE_H,
                opacity: dim ? 0.28 : 1, transition: 'opacity .2s', zIndex: sel ? 20 : 5, cursor: 'grab',
              }}
            >
              <div
                className="flex items-center gap-2 rounded-xl px-2.5 py-2"
                style={{
                  background: 'var(--nv-surface)',
                  border: `1.5px solid ${sel ? KIND_COLOR[n.kind] : 'var(--nv-border)'}`,
                  boxShadow: sel ? `0 6px 22px ${KIND_COLOR[n.kind]}44` : '0 2px 8px rgba(0,0,0,.16)',
                }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_COLOR[n.kind] }} />
                <span className="text-[11px] font-medium leading-tight truncate" style={{ color: 'var(--nv-text)' }}>{n.title}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* zoom controls */}
      <div className="absolute right-4 bottom-4 flex flex-col gap-1">
        {(['+', '−'] as const).map((s) => (
          <button key={s} onClick={() => setView((v) => ({ ...v, scale: Math.min(2.2, Math.max(0.25, v.scale * (s === '+' ? 1.15 : 0.87))) }))}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[14px] transition-fast"
            style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>{s}</button>
        ))}
      </div>
      <div className="absolute left-4 bottom-4 text-[10px] px-2.5 py-1 rounded-lg pointer-events-none"
        style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-faint)' }}>
        drag to move · scroll to zoom · click a node
      </div>
    </div>
  );
}

// ─── Main module ──────────────────────────────────────────────────────────────
export default function BrainModule() {
  const [data, setData] = useState<BrainData>(() => brain.all());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const reload = useCallback(() => setData(brain.all()), []);
  useEffect(() => {
    window.addEventListener(BRAIN_EVENT, reload);
    return () => window.removeEventListener(BRAIN_EVENT, reload);
  }, [reload]);

  const filtered: BrainData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    const ids = new Set(data.nodes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)).map((n) => n.id));
    return { nodes: data.nodes.filter((n) => ids.has(n.id)), edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [data, search]);

  const selected = data.nodes.find((n) => n.id === selectedId) || null;

  // "+ File" — try the native picker (gives the real path) and create the node from
  // it; if the picker isn't available, just create an empty file node and let the
  // user attach the file from the panel (which has a guaranteed browser fallback).
  const addFile = useCallback(async () => {
    try {
      const path = await invoke<string | null>('brain_pick_file');
      if (path === null) return; // cancelled
      const content = await invoke<string>('read_file', { path }).catch(() => '');
      const name = path.split(/[/\\]/).pop() || path;
      const node = brain.addNode({ title: name, kind: 'file', body: content.slice(0, 8000) });
      brain.updateNode(node.id, { filePath: path });
      setSelectedId(node.id);
    } catch {
      const node = brain.addNode({ title: 'New file', kind: 'file', body: '' });
      setSelectedId(node.id);
    }
  }, []);

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--nv-bg)' }}>
      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--nv-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(124,92,255,.15)', color: '#7C5CFF' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="18" r="1.8"/>
                <path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" strokeWidth="1.3"/>
              </svg>
            </div>
            <div>
              <h2 className="text-[15px] font-bold" style={{ color: 'var(--nv-text)' }}>Brain</h2>
              <p className="text-[11px] font-mono" style={{ color: 'var(--nv-faint)' }}>{data.nodes.length} items · {data.edges.length} links · shared with your agents</p>
            </div>
          </div>
          <div className="flex-1" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the Brain…"
            className="w-56 rounded-lg px-3 py-1.5 text-[11px] outline-none"
            style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' }} />
          <button onClick={addFile}
            className="text-[11px] px-3 py-1.5 rounded-lg font-medium transition-fast"
            style={{ border: '1px solid var(--nv-border)', color: 'var(--nv-muted)', background: 'var(--nv-surface)' }}>+ File</button>
          <button onClick={() => setSelectedId(brain.addNode({ title: 'New note', body: '', kind: 'note' }).id)}
            className="text-[11px] px-3 py-1.5 rounded-lg text-white font-medium transition-fast hover:opacity-90" style={{ background: '#7C5CFF' }}>+ Note</button>
        </div>

        {data.nodes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(124,92,255,.12)', color: '#7C5CFF' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="12" cy="12" r="2.5"/><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="6" r="1.8"/><circle cx="5" cy="18" r="1.8"/><circle cx="19" cy="18" r="1.8"/>
                <path d="M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3" strokeWidth="1.3"/>
              </svg>
            </div>
            <p className="text-[14px] font-semibold mb-1.5" style={{ color: 'var(--nv-text)' }}>Your Brain is empty</p>
            <p className="text-[11.5px] max-w-md leading-relaxed" style={{ color: 'var(--nv-muted)' }}>
              A shared knowledge graph — like a private Obsidian your AI also reads. Krew saves company lists, outreach
              drafts, contacts and attached files here automatically and recalls them instead of re-fetching — so it uses
              fewer tokens and never forgets. Add a note, or just ask Krew to find some companies.
            </p>
            <button onClick={() => setSelectedId(brain.addNode({ title: 'New note', body: '', kind: 'note' }).id)}
              className="mt-5 text-[11px] px-4 py-2 rounded-lg text-white font-medium transition-fast hover:opacity-90" style={{ background: '#7C5CFF' }}>+ Add your first note</button>
          </div>
        ) : (
          <Stage data={filtered} selectedId={selectedId} onSelect={setSelectedId}
            onMoveNode={(id, x, y) => brain.updateNode(id, { x, y })} />
        )}
      </div>

      {selected && (
        <BrainPanel key={selected.id} node={selected} allNodes={data.nodes} edges={data.edges}
          onClose={() => setSelectedId(null)} onJump={setSelectedId} />
      )}
    </div>
  );
}

// ─── Side panel ───────────────────────────────────────────────────────────────
function BrainPanel({ node, allNodes, edges, onClose, onJump }: {
  node: BrainNode; allNodes: BrainNode[]; edges: BrainData['edges'];
  onClose: () => void; onJump: (id: string) => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [ref,   setRef]   = useState(node.ref ?? '');
  const [kind,  setKind]  = useState<BrainNodeKind>(node.kind);
  const [connectTo, setConnectTo] = useState('');

  const connections = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({ edge: e, other: allNodes.find((n) => n.id === (e.source === node.id ? e.target : e.source)) }))
    .filter((c) => c.other);
  const targets = allNodes.filter((n) => n.id !== node.id &&
    !edges.some((e) => (e.source === node.id && e.target === n.id) || (e.target === node.id && e.source === n.id)));

  const [filePath, setFilePath] = useState(node.filePath ?? '');
  // A deck saved by the PPT maker: an .html under the app's decks folder, with a
  // DeckSpec .json sidecar. These get Open/Present + Download .pptx actions.
  const isDeck = !!filePath && /[\\/]decks[\\/]/.test(filePath) && /\.html$/i.test(filePath);
  const [deckMsg, setDeckMsg] = useState('');
  async function openDeck() {
    setDeckMsg('Opening…');
    try { await invoke('open_path', { path: filePath }); setDeckMsg(''); }
    catch (e) { setDeckMsg('Could not open: ' + (e instanceof Error ? e.message : String(e))); }
  }
  async function downloadDeckPptx() {
    setDeckMsg('Building .pptx…');
    try {
      const json = await invoke<string>('read_deck_spec', { path: filePath });
      const { parseDeckSpec, deckToPptxBlob } = await import('../lib/deck');
      const spec = parseDeckSpec(json);
      if (!spec) { setDeckMsg('Deck data not found.'); return; }
      const blob = await deckToPptxBlob(spec);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (spec.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '.pptx';
      a.click();
      URL.revokeObjectURL(url);
      setDeckMsg('');
    } catch (e) { setDeckMsg('Export failed: ' + (e instanceof Error ? e.message : String(e))); }
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // WYSIWYG: the editor shows FORMATTED text (tables, headings, links) — never raw
  // markdown symbols. Existing markdown (e.g. an agent's lead list) is converted to
  // HTML for display; what the user types is stored as HTML.
  const initialHtml = useMemo(
    () => looksLikeHtml(node.body) ? cleanBody(node.body) : mdToHtml(node.body),
    [node.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Add JS column-resize handles to every table (CSS resize doesn't work on table
  // cells). Dragging a handle sets the header cell's width → column resizes.
  const enhanceTables = useCallback(() => {
    const root = editorRef.current; if (!root) return;
    root.querySelectorAll('table').forEach((table) => {
      (table as HTMLElement).style.tableLayout = 'fixed';
      (table as HTMLElement).style.width = (table as HTMLElement).style.width || '100%';
      const headRow = table.tHead?.rows[0] || table.rows[0];
      if (!headRow) return;
      Array.from(headRow.cells).forEach((th) => {
        if ((th as HTMLElement).querySelector('.col-resizer')) return;
        const handle = document.createElement('div');
        handle.className = 'col-resizer';
        handle.contentEditable = 'false';
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const startX = e.clientX;
          const startW = (th as HTMLElement).getBoundingClientRect().width;
          const move = (ev: PointerEvent) => { (th as HTMLElement).style.width = `${Math.max(48, startW + (ev.clientX - startX))}px`; };
          const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); save(); };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        });
        th.appendChild(handle);
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editorRef.current) { editorRef.current.innerHTML = initialHtml; enhanceTables(); } }, [initialHtml, enhanceTables]);

  const patch = (p: Partial<BrainNode>) => brain.updateNode(node.id, p);
  const patchTitleDebounced = (t: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => brain.updateNode(node.id, { title: t.trim() || 'Untitled' }), 220);
  };
  // Read the body but strip the resize handles (they're UI-only, never stored).
  const readBody = () => {
    const root = editorRef.current; if (!root) return '';
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.col-resizer').forEach((h) => h.remove());
    return clone.innerHTML;
  };
  const save = () => brain.updateNode(node.id, { title: title.trim() || 'Untitled', body: readBody(), ref, kind });
  const afterEdit = () => { enhanceTables(); save(); };
  // Formatting buttons — the user clicks these instead of typing markdown symbols.
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); editorRef.current?.focus(); save(); };

  // ── Spreadsheet-style table editing (operates on the live editor DOM) ─────────
  const currentCell = (): HTMLTableCellElement | null => {
    let n = window.getSelection()?.anchorNode as Node | null;
    while (n && n !== editorRef.current) { if (n instanceof HTMLTableCellElement) return n; n = n.parentNode; }
    return null;
  };
  const currentTable = (): HTMLTableElement | null => {
    let n: Node | null = currentCell();
    while (n && n !== editorRef.current) { if (n instanceof HTMLTableElement) return n; n = n.parentNode; }
    return null;
  };
  function insertTable() {
    const html = '<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody>'
      + '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>';
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    afterEdit();
  }
  function addRow() {
    const t = currentTable(); if (!t) { insertTable(); return; }
    const cols = t.rows[0]?.cells.length || 1;
    const tr = document.createElement('tr');
    for (let i = 0; i < cols; i++) { const td = document.createElement('td'); td.innerHTML = '&nbsp;'; tr.appendChild(td); }
    (t.tBodies[0] || t).appendChild(tr); afterEdit();
  }
  function addColumn() {
    const t = currentTable(); if (!t) return;
    const idx = (currentCell()?.cellIndex ?? (t.rows[0]?.cells.length || 1) - 1) + 1;
    for (const row of Array.from(t.rows)) {
      const isHead = row.parentElement?.tagName === 'THEAD';
      const cell = document.createElement(isHead ? 'th' : 'td');
      cell.innerHTML = isHead ? 'New column' : '&nbsp;';
      row.insertBefore(cell, row.cells[idx] ?? null);
    }
    afterEdit();
  }
  function delRow() {
    const tr = currentCell()?.closest('tr');
    if (tr && tr.parentElement?.tagName !== 'THEAD') { tr.remove(); afterEdit(); }
  }
  function delColumn() {
    const t = currentTable(); const c = currentCell(); if (!t || !c) return;
    const idx = c.cellIndex;
    for (const row of Array.from(t.rows)) if (row.cells[idx]) row.deleteCell(idx);
    afterEdit();
  }
  // Simple calc: sum the numbers in the current column, append a Total row.
  function sumColumn() {
    const t = currentTable(); const c = currentCell(); if (!t || !c) return;
    const idx = c.cellIndex; let sum = 0;
    for (const row of Array.from(t.tBodies[0]?.rows || [])) {
      const v = parseFloat((row.cells[idx]?.innerText || '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isNaN(v)) sum += v;
    }
    const cols = t.rows[0]?.cells.length || 1;
    const tr = document.createElement('tr');
    for (let i = 0; i < cols; i++) {
      const td = document.createElement('td');
      td.innerHTML = i === idx ? `<strong>${Math.round(sum * 100) / 100}</strong>` : (i === 0 ? '<strong>Total</strong>' : '&nbsp;');
      tr.appendChild(td);
    }
    (t.tBodies[0] || t).appendChild(tr); afterEdit();
  }

  function applyFile(name: string, content: string, path?: string) {
    const newTitle = (!title.trim() || title.trim() === 'New note') ? name : title;
    setKind('file'); setTitle(newTitle);
    if (path) setFilePath(path);
    const cur = editorRef.current;
    if (cur && !cur.innerText.trim()) cur.innerHTML = mdToHtml(content.slice(0, 8000));
    brain.updateNode(node.id, { kind: 'file', title: newTitle, body: editorRef.current?.innerHTML ?? mdToHtml(content.slice(0, 8000)), ...(path ? { filePath: path } : {}) });
  }

  // Attach a real file to THIS node. Tries the native picker (gives the full path);
  // if that command isn't available, falls back to the browser file input (content only).
  async function attachFile() {
    try {
      const path = await invoke<string | null>('brain_pick_file');
      if (!path) return; // user cancelled
      const content = await invoke<string>('read_file', { path }).catch(() => '');
      applyFile(path.split(/[/\\]/).pop() || path, content, path);
    } catch {
      fileInputRef.current?.click(); // native dialog unavailable → browser picker
    }
  }
  function onHtmlFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => applyFile(f.name, String(reader.result ?? ''));
    reader.readAsText(f);
    e.target.value = '';
  }

  const inputCls = 'w-full rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-accent';
  const inputStyle = { background: 'var(--nv-bg)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' };
  const labelCls = 'text-[9px] font-mono uppercase tracking-wider';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" style={{ background: 'rgba(0,0,0,.5)' }}
      onMouseDown={() => { save(); onClose(); }}>
      <div className="flex flex-col w-full max-w-6xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ height: '92vh', background: 'var(--nv-surface)', border: '1px solid var(--nv-border)' }}
        onMouseDown={(e) => e.stopPropagation()}>

        {/* Header — title + simple formatting buttons (no markdown to learn) */}
        <div className="flex items-center gap-3 px-5 h-14 shrink-0" style={{ borderBottom: '1px solid var(--nv-border)' }}>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[kind] }} />
          <input value={title}
            onChange={(e) => { setTitle(e.target.value); patchTitleDebounced(e.target.value); }} onBlur={save}
            placeholder="Untitled"
            className="flex-1 bg-transparent text-[16px] font-semibold outline-none" style={{ color: 'var(--nv-text)' }} />
          <div className="flex items-center gap-0.5 shrink-0">
            {([
              { label: 'B', cmd: 'bold', title: 'Bold', cls: 'font-bold' },
              { label: 'I', cmd: 'italic', title: 'Italic', cls: 'italic' },
              { label: 'H', cmd: 'formatBlock:h2', title: 'Heading', cls: 'font-semibold' },
              { label: '•', cmd: 'insertUnorderedList', title: 'Bullet list', cls: '' },
            ] as const).map((b) => (
              <button key={b.label} title={b.title} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { const [c, v] = b.cmd.split(':'); exec(c, v); }}
                className={`w-7 h-7 rounded-md text-[12px] transition-fast hover:bg-nv-surface2 ${b.cls}`} style={{ color: 'var(--nv-muted)' }}>
                {b.label}
              </button>
            ))}
          </div>
          <button onClick={() => { save(); onClose(); }} className="text-xl ml-1" style={{ color: 'var(--nv-faint)' }}>×</button>
        </div>

        {/* Table toolbar — Excel-style structure editing */}
        <div className="flex items-center gap-1 px-5 py-1.5 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--nv-border)', background: 'var(--nv-bg)' }}>
          <span className="text-[9px] font-mono uppercase tracking-wider mr-1" style={{ color: 'var(--nv-faint)' }}>Table</span>
          {([
            { l: '⊞ Insert', fn: insertTable, t: 'Insert a new table', del: false },
            { l: '+ Row', fn: addRow, t: 'Add a row', del: false },
            { l: '+ Col', fn: addColumn, t: 'Add a column', del: false },
            { l: '🗑 Row', fn: delRow, t: 'Delete the current row (click a cell in it first)', del: true },
            { l: '🗑 Col', fn: delColumn, t: 'Delete the current column (click a cell in it first)', del: true },
            { l: 'Σ Sum', fn: sumColumn, t: 'Sum the numbers in the current column', del: false },
          ] as const).map((b) => (
            <button key={b.l} title={b.t} onMouseDown={(e) => e.preventDefault()} onClick={b.fn}
              className={`text-[10.5px] px-2 py-1 rounded-md transition-fast ${b.del ? 'hover:bg-nv-red/15' : 'hover:bg-nv-surface2'}`}
              style={b.del
                ? { color: 'var(--nv-red, #ef4444)', border: '1px solid color-mix(in srgb, var(--nv-red, #ef4444) 45%, transparent)' }
                : { color: 'var(--nv-muted)', border: '1px solid var(--nv-border)' }}>
              {b.l}
            </button>
          ))}
          <span className="text-[9px] ml-2" style={{ color: 'var(--nv-faint)' }}>tip: drag a cell's right/bottom edge to resize</span>
        </div>

        {/* Body — formatted note editor (WYSIWYG) + metadata sidebar */}
        <div className="flex flex-1 min-h-0">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={save}
            data-placeholder="Start writing… use the B / H / • buttons above to format. Anything Krew finds (like a company list) shows here as a clean table."
            className={`flex-1 min-w-0 overflow-y-auto p-6 empty:before:content-[attr(data-placeholder)] empty:before:text-nv-faint ${NOTE_CLS}`}
            style={{ color: 'var(--nv-text)' }}
          />

          <div className="w-[268px] shrink-0 overflow-y-auto p-4 flex flex-col gap-3" style={{ borderLeft: '1px solid var(--nv-border)', background: 'var(--nv-bg)' }}>
            <div className="space-y-1">
              <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>Type</label>
              <select value={kind}
                onChange={(e) => { const k = e.target.value as BrainNodeKind; setKind(k); patch({ kind: k }); if (k === 'file' && !filePath) attachFile(); }}
                className={inputCls} style={inputStyle}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>File</label>
              {filePath ? (
                <div className="flex items-center gap-1.5">
                  <p className="flex-1 text-[10px] font-mono break-all rounded-lg px-2.5 py-1.5" style={{ ...inputStyle, color: 'var(--nv-faint)' }}>{filePath}</p>
                  <button onClick={attachFile} className="text-[10px] px-2 py-1.5 rounded-lg shrink-0" style={{ border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>↻</button>
                </div>
              ) : (
                <button onClick={attachFile} className="w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium" style={{ border: '1px dashed var(--nv-border)', color: 'var(--nv-muted)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                  Attach a file
                </button>
              )}
              <input ref={fileInputRef} type="file" className="hidden" onChange={onHtmlFile} />
            </div>
            {isDeck && (
              <div className="space-y-1.5">
                <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>Presentation</label>
                <div className="flex gap-1.5">
                  <button onClick={openDeck} className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold text-white" style={{ background: 'var(--nv-accent, #7C5CFF)' }}>Open / Present</button>
                  <button onClick={downloadDeckPptx} className="flex-1 rounded-lg px-3 py-2 text-[11px] font-medium" style={{ border: '1px solid var(--nv-border)', color: 'var(--nv-text)' }}>Download .pptx</button>
                </div>
                <p className="text-[9px]" style={{ color: deckMsg.startsWith('Could') || deckMsg.includes('failed') ? '#f87171' : 'var(--nv-faint)' }}>{deckMsg || 'Opens in your browser — present fullscreen or export to PDF from there.'}</p>
              </div>
            )}
            <div className="space-y-1">
              <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>Your reference note</label>
              <textarea value={ref} onChange={(e) => setRef(e.target.value)} onBlur={save} rows={3}
                placeholder="Extra context (the AI sees it too)…"
                className="w-full rounded-lg px-3 py-2 text-[11px] outline-none resize-y" style={{ ...inputStyle, color: 'var(--nv-muted)' }} />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>Connected · {connections.length}</label>
              {connections.map(({ edge, other }) => (
                <div key={edge.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={inputStyle}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_COLOR[other!.kind] }} />
                  <button onClick={() => { save(); onJump(other!.id); }} className="flex-1 text-left text-[11px] truncate hover:opacity-70" style={{ color: 'var(--nv-text)' }}>{other!.title}</button>
                  <button onClick={() => brain.unlink(edge.id)} className="text-[10px] font-mono shrink-0" style={{ color: 'var(--nv-faint)' }}>✕</button>
                </div>
              ))}
              {targets.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <select value={connectTo} onChange={(e) => setConnectTo(e.target.value)} className={inputCls} style={inputStyle}>
                    <option value="">Connect to…</option>
                    {targets.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                  </select>
                  <button disabled={!connectTo} onClick={() => { if (connectTo) { brain.link(node.id, connectTo); setConnectTo(''); } }}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg text-white font-medium disabled:opacity-40" style={{ background: '#7C5CFF' }}>+</button>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                save();
                // Build this file's markdown PLUS the notes connected to it, then enter
                // a focused chat that stays scoped to this file + its connections.
                const html = editorRef.current?.innerHTML || '';
                let content = (nodeToMarkdown(html) || editorRef.current?.innerText || '').trim();
                const data = brain.all();
                const linkedIds = new Set<string>();
                data.edges.forEach((e) => {
                  if (e.source === node.id) linkedIds.add(e.target);
                  if (e.target === node.id) linkedIds.add(e.source);
                });
                const linked = data.nodes.filter((x) => linkedIds.has(x.id));
                if (linked.length) {
                  content += `\n\n---\n_Connected in Brain (reference these too — expand around them, don't re-create):_\n`;
                  for (const l of linked) content += `\n### ${l.title}\n${nodeToMarkdown(l.body).slice(0, 2500)}\n`;
                }
                window.dispatchEvent(new CustomEvent('nv-brain-chat-focus', { detail: { name: `${(title.trim() || 'Brain file')}.md`, content, connected: linked.length } }));
                window.dispatchEvent(new Event('nv-goto-krew'));
                onClose();
              }}
              className="mt-auto w-full flex items-center justify-center gap-1.5 text-[11px] px-3 py-2 rounded-lg text-white font-medium transition-fast hover:opacity-90" style={{ background: '#7C5CFF' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Chat with this file
            </button>
            <button
              onClick={() => {
                save();
                const html = editorRef.current?.innerHTML || '';
                const content = (nodeToMarkdown(html) || editorRef.current?.innerText || '').trim();
                window.dispatchEvent(new CustomEvent('nv-brain-to-krew', { detail: { name: `${(title.trim() || 'Brain note')}.md`, content } }));
                window.dispatchEvent(new Event('nv-goto-krew'));
                onClose();
              }}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] px-3 py-2 rounded-lg transition-fast hover:opacity-90" style={{ border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              Attach to chat once
            </button>
            <button onClick={() => { if (confirm('Delete this item from the Brain?')) { brain.deleteNode(node.id); onClose(); } }}
              className="text-[11px] px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--nv-border)', color: 'var(--nv-muted)' }}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
