import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { brain, BRAIN_EVENT, nodeToMarkdown, type BrainNode, type BrainNodeKind, type BrainData } from '../lib/knowledgeStore';

// ─── Kind metadata ────────────────────────────────────────────────────────────
const KIND_COLOR: Record<BrainNodeKind, string> = {
  note: '#7C5CFF', file: '#38bdf8', data: '#34d399', list: '#f59e0b',
  outreach: '#f472b6', contact: '#a78bfa', source: '#94a3b8', image: '#f97316',
};
const KIND_LABEL: Record<BrainNodeKind, string> = {
  note: 'Note', file: 'File', data: 'Data', list: 'List', outreach: 'Outreach', contact: 'Contact', source: 'Source', image: 'Picture',
};
const KINDS: BrainNodeKind[] = ['note', 'file', 'data', 'list', 'outreach', 'contact', 'source', 'image'];

const NODE_W = 150, NODE_H = 38;

// Human-readable byte size for the storage-used display.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

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
    // Plain prose — GROUP consecutive plain lines into ONE paragraph joined by <br>, so a
    // document (a PDF/résumé dumped line-by-line) reads tightly instead of every single line
    // becoming its own spaced block. A blank line (or any special line) ends the paragraph.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim()
        && !lines[i].match(/^```/) && !lines[i].match(/^(#{1,4})\s+/)
        && !lines[i].match(/^\s*[-*]\s+/)
        && !(lines[i].trim().startsWith('|') && (lines[i].match(/\|/g) || []).length >= 2)) {
      para.push(inlineHtml(lines[i])); i++;
    }
    if (para.length) html += `<p>${para.join('<br>')}</p>`;
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
  '[&_th]:text-left [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold [&_th]:text-nv-text [&_th]:border [&_th]:border-nv-border [&_th]:bg-nv-surface2/50 [&_th]:relative [&_th]:min-w-[120px] [&_th]:max-w-[380px] [&_th]:break-words [&_th]:whitespace-normal ' +
  '[&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:border [&_td]:border-nv-border/50 [&_td]:text-nv-muted [&_td]:min-w-[120px] [&_td]:max-w-[380px] [&_td]:break-words [&_td]:whitespace-normal ' +
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

  // Fit-to-content ONCE, on first load. Previously this refit every time the node COUNT
  // changed — so adding each new file zoomed the whole canvas out a little more, which felt
  // like the graph kept shrinking. Now it fits once; the zoom controls handle the rest.
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current) return;
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
    didFit.current = true;
  }, [data.nodes.length]);

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

// ─── PDF viewer ─────────────────────────────────────────────────────────────
// Renders a PDF as an actual PDF (pages rendered via pdf.js) instead of showing the
// extracted text. Reads the bytes from the durable Brain copy so it keeps working even
// after the user deletes the original. Pages render progressively.
function PdfViewer({ path }: { path: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading'); setPages([]); setMsg('');
      try {
        const b64 = await invoke<string>('read_file_base64', { path });
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const pdf = await pdfjsLib.getDocument({ data: bytes, cMapUrl: '/cmaps/', cMapPacked: true }).promise;
        const out: string[] = [];
        const n = Math.min(pdf.numPages, 60);
        for (let p = 1; p <= n; p++) {
          if (cancelled) return;
          const page = await pdf.getPage(p);
          const viewport = page.getViewport({ scale: 1.6 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvas, viewport } as any).promise;
          out.push(canvas.toDataURL('image/jpeg', 0.88));
          if (!cancelled) setPages([...out]); // show pages as they finish
        }
        if (!cancelled) setStatus('ok');
      } catch (e) {
        if (!cancelled) { setStatus('err'); setMsg(e instanceof Error ? e.message : String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4" style={{ background: 'var(--nv-bg)' }}>
      {status === 'loading' && pages.length === 0 && (
        <div className="h-full flex items-center justify-center text-[12px]" style={{ color: 'var(--nv-faint)' }}>Rendering PDF…</div>
      )}
      {status === 'err' && (
        <div className="h-full flex flex-col items-center justify-center text-[12px] text-center px-6 gap-1">
          <span style={{ color: '#f87171' }}>Couldn't display this PDF.</span>
          {msg && <span className="text-[10px] font-mono" style={{ color: 'var(--nv-faint)' }}>{msg}</span>}
        </div>
      )}
      <div className="flex flex-col items-center gap-3">
        {pages.map((src, i) => (
          <img key={i} src={src} alt={`Page ${i + 1}`} className="max-w-full rounded-lg shadow-lg" style={{ border: '1px solid var(--nv-border)' }} />
        ))}
      </div>
    </div>
  );
}

// ─── Image viewer ────────────────────────────────────────────────────────────
// A saved picture (logo/photo) node → show the actual image, read from disk as base64.
function ImageViewer({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b64 = await invoke<string>('read_file_base64', { path });
        const ext = (path.split('.').pop() || 'png').toLowerCase();
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
        if (!cancelled) setSrc(`data:${mime};base64,${b64}`);
      } catch { if (!cancelled) setErr(true); }
    })();
    return () => { cancelled = true; };
  }, [path]);
  return (
    <div className="flex-1 min-w-0 overflow-auto p-6 flex items-center justify-center" style={{ background: 'var(--nv-bg)' }}>
      {err ? (
        <div className="text-[12px]" style={{ color: '#f87171' }}>Couldn't load this picture.</div>
      ) : src === null ? (
        <div className="text-[12px]" style={{ color: 'var(--nv-faint)' }}>Loading picture…</div>
      ) : (
        <img src={src} alt="" className="max-w-full max-h-full rounded-lg" style={{ border: '1px solid var(--nv-border)' }} />
      )}
    </div>
  );
}

// ─── Deck preview ───────────────────────────────────────────────────────────
// Shows a saved deck AS the deck (its rendered HTML in an iframe) instead of the summary
// text — so a presentation saved to the Brain actually looks like the presentation.
function DeckPreview({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<string>('read_file', { path }).then((h) => { if (!cancelled) setHtml(h); }).catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [path]);

  // The deck's own ⛶ Present / ⭳ PDF buttons live INSIDE the sandboxed iframe and postMessage to
  // us (the parent) — without this listener those clicks did nothing in the Brain preview (only
  // prev/next, handled inside the deck, worked). Present → fullscreen the iframe; PDF → rebuild the
  // DeckSpec and save a real PDF into Downloads.
  useEffect(() => {
    async function onMsg(e: MessageEvent) {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { __deckPdf?: boolean; __deckPresent?: boolean };
      if (d?.__deckPresent) {
        const el = iframeRef.current as (HTMLIFrameElement & { webkitRequestFullscreen?: () => void });
        try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); el.focus?.(); } catch { /* ignore */ }
      } else if (d?.__deckPdf && html) {
        try {
          const { extractDeckSpec, deckToPdfBlob } = await import('../lib/deck');
          const spec = extractDeckSpec(html);
          if (spec && spec.slides?.length) {
            const blob = await deckToPdfBlob(spec);
            const buf = new Uint8Array(await blob.arrayBuffer());
            let bin = ''; const CH = 0x8000;
            for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + CH)));
            const slug = (spec.title || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deck';
            const saved = await invoke<string>('save_to_downloads', { filename: `${slug}.pdf`, dataBase64: btoa(bin) });
            try { await invoke('open_path', { path: saved }); } catch { /* still saved */ }
            return;
          }
        } catch { /* fall back to opening the html to print */ }
        try { await invoke('open_path', { path }); } catch { /* ignore */ }
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [html, path]);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col items-center justify-start" style={{ background: 'var(--nv-bg)' }}>
      {err ? (
        <div className="m-auto text-[12px]" style={{ color: '#f87171' }}>Couldn't load the deck preview.</div>
      ) : html === null ? (
        <div className="m-auto text-[12px]" style={{ color: 'var(--nv-faint)' }}>Loading deck…</div>
      ) : (
        <iframe ref={iframeRef} srcDoc={html} sandbox="allow-scripts allow-same-origin" title="Deck preview"
          allow="fullscreen"
          className="rounded-lg" style={{ width: '100%', maxWidth: 820, aspectRatio: '16 / 9', border: '1px solid var(--nv-border)', background: '#000' }} />
      )}
    </div>
  );
}

// ─── Main module ──────────────────────────────────────────────────────────────
export default function BrainModule() {
  const [data, setData] = useState<BrainData>(() => brain.all());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Reload from storage on change, but COALESCE bursts: a batch of updates (e.g. saving a big
  // file, or an agent writing several nodes) used to fire brain.all() — which re-parses the whole
  // localStorage blob, now up to ~2MB with a big Excel — once PER event, freezing the UI. A short
  // debounce collapses the burst into a single re-parse.
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => setData(brain.all()), 120);
  }, []);
  useEffect(() => {
    window.addEventListener(BRAIN_EVENT, reload);
    return () => { window.removeEventListener(BRAIN_EVENT, reload); if (reloadTimer.current) clearTimeout(reloadTimer.current); };
  }, [reload]);

  // Deferred so typing in the search box stays responsive even with a big Brain (React keeps the
  // input live and computes the filtered set at a lower priority instead of blocking each keystroke).
  const deferredSearch = useDeferredValue(search);
  const filtered: BrainData = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return data;
    // Full-text scan a node's body only when it's small; for a huge body (a big spreadsheet)
    // lowercasing megabytes on every search was the freeze — match those on title only. Row-level
    // search inside a big file is what the in-file column filters are for.
    const ids = new Set(data.nodes.filter((n) =>
      n.title.toLowerCase().includes(q) || (n.body.length < 60000 && n.body.toLowerCase().includes(q))
    ).map((n) => n.id));
    return { nodes: data.nodes.filter((n) => ids.has(n.id)), edges: data.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  }, [data, deferredSearch]);

  const selected = data.nodes.find((n) => n.id === selectedId) || null;

  // Total text stored in the Brain (localStorage bodies) — a rough at-a-glance storage figure.
  // Per-file on-disk sizes are shown in each item's panel.
  const totalTextBytes = useMemo(() => data.nodes.reduce((s, n) => s + (n.body ? n.body.length : 0), 0), [data.nodes]);

  // "+ File" — try the native picker (gives the real path) and create the node from
  // it; if the picker isn't available, just create an empty file node and let the
  // user attach the file from the panel (which has a guaranteed browser fallback).
  const addFile = useCallback(async () => {
    try {
      const path = await invoke<string | null>('brain_pick_file');
      if (path === null) return; // cancelled
      // brain_extract_text reads plain-text files directly AND pulls text out of PDF,
      // PPTX, DOCX and Excel/CSV so the agents can actually use what's inside them.
      const name = path.split(/[/\\]/).pop() || path;
      // Keep a durable copy inside the Brain so the node survives the user deleting the original.
      const stored = await invoke<string>('brain_store_file', { sourcePath: path }).catch(() => path);
      // An image → save it as a Picture (in the Pictures folder), no text extraction.
      if (/\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(path)) {
        const node = brain.addPicture({ name, filePath: stored });
        setSelectedId(node.id);
        return;
      }
      // brain_extract_text reads plain-text files directly AND pulls text out of PDF,
      // PPTX, DOCX and Excel/CSV so the agents can actually use what's inside them.
      const content = await invoke<string>('brain_extract_text', { path }).catch(() => '');
      const node = brain.addNode({ title: name, kind: 'file', body: content.slice(0, 2000000) });
      brain.updateNode(node.id, { filePath: stored });
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
              <p className="text-[11px] font-mono" style={{ color: 'var(--nv-faint)' }}>{data.nodes.length} items · {data.edges.length} links · {formatBytes(totalTextBytes)} · shared with your agents</p>
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
  // Maximize the file window to fill the screen (handy for wide spreadsheets/tables);
  // toggles back to the comfortable centred size.
  const [maximized, setMaximized] = useState(false);

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
  // A PDF file → show the actual PDF (pdf.js viewer) rather than the extracted text.
  const isPdf = !!filePath && /\.pdf$/i.test(filePath);
  // A saved picture → show the actual image. (kind 'image', or an image file extension.)
  const isImage = (node.kind === 'image' || (!!filePath && /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(filePath))) && !!filePath;
  // Storage used by this item — the on-disk file size if it has one, else the size of its text
  // content. Shown so the user can see how much space each Brain item takes.
  const [diskSize, setDiskSize] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (filePath) invoke<number>('file_size', { path: filePath }).then((n) => { if (!cancelled) setDiskSize(n); }).catch(() => { if (!cancelled) setDiskSize(null); });
    else setDiskSize(null);
    return () => { cancelled = true; };
  }, [filePath]);
  const textBytes = useMemo(() => new Blob([node.body || '']).size, [node.body]);
  const storageBytes = diskSize != null ? diskSize + textBytes : textBytes;
  // A very large body (a big spreadsheet — thousands of rows) is rendered READ-ONLY: a live
  // contentEditable with ~15k+ editable cells is what froze the app on open and on every click.
  // Non-editable, the same table lays out fast and stays smooth; filter/sort still work.
  const largeBody = (node.body?.length || 0) > 150000;
  // Table filter (Excel-style): a text search across rows PLUS per-column value pickers.
  const [tableFilter, setTableFilter] = useState('');
  const [hasTable, setHasTable] = useState(false);
  const textFilterRef = useRef('');
  const colFiltersRef = useRef<Map<number, Set<string>>>(new Map()); // colIndex → allowed values (absent = all)
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colMenuRef = useRef<HTMLDivElement | null>(null);
  const [deckMsg, setDeckMsg] = useState('');
  async function openDeck() {
    setDeckMsg('Opening…');
    try { await invoke('open_path', { path: filePath }); setDeckMsg(''); }
    catch (e) { setDeckMsg('Could not open: ' + (e instanceof Error ? e.message : String(e))); }
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
      // CONTENT-SIZED layout (not `fixed`): with `fixed`, per-cell min/max widths are ignored
      // and every column is squeezed to an equal sliver — which is why a wide Excel table wrapped
      // to ~3 letters per cell with no way to scroll. `auto` + `width:max-content` lets each
      // column size to its text (capped by the cell max-width so a long address wraps at a
      // readable ~380px instead of collapsing), so the whole table grows as wide as it needs and
      // the editor (overflow-auto) shows a horizontal scrollbar. `min-width:100%` keeps a small
      // table filling the pane.
      const el = table as HTMLElement;
      el.style.tableLayout = 'auto';
      el.style.width = 'max-content';
      el.style.minWidth = '100%';
      el.style.maxWidth = 'none';
      const headRow = table.tHead?.rows[0] || table.rows[0];
      if (!headRow) return;
      Array.from(headRow.cells).forEach((th) => {
        if ((th as HTMLElement).querySelector('.col-resizer')) return;
        const handle = document.createElement('div');
        handle.className = 'col-resizer';
        handle.contentEditable = 'false';
        handle.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const colIdx = (th as HTMLTableCellElement).cellIndex;
          const startX = e.clientX;
          const startW = (th as HTMLElement).getBoundingClientRect().width;
          const move = (ev: PointerEvent) => {
            const w = Math.max(60, startW + (ev.clientX - startX));
            // Resize the WHOLE column and lift the wrap cap so the user can pull a column as wide
            // as they want (e.g. to read a long address on one line).
            for (const row of Array.from(table.rows)) {
              const cell = row.cells[colIdx] as HTMLElement | undefined;
              if (cell) { cell.style.width = `${w}px`; cell.style.maxWidth = 'none'; }
            }
          };
          const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); save(); };
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', up);
        });
        th.appendChild(handle);
        // Click-to-sort (Excel-style): a small ⇅ button in each header sorts the table by that
        // column, toggling ascending/descending. Numeric columns sort numerically. It's its own
        // (non-editable) button so it never fights the resize handle or the text caret.
        if (!(th as HTMLElement).querySelector('.col-sort')) {
          const sortBtn = document.createElement('span');
          sortBtn.className = 'col-sort';
          sortBtn.contentEditable = 'false';
          sortBtn.textContent = ' ⇅';
          sortBtn.style.cssText = 'cursor:pointer;opacity:.45;font-size:11px;user-select:none;margin-left:4px';
          sortBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            const colIdx = (th as HTMLTableCellElement).cellIndex;
            const body = table.tBodies[0]; if (!body) return;
            const rows = Array.from(body.rows);
            const dir = (table as HTMLElement).dataset.sortCol === String(colIdx) && (table as HTMLElement).dataset.sortDir === 'asc' ? 'desc' : 'asc';
            const val = (r: HTMLTableRowElement) => (r.cells[colIdx]?.textContent || '').trim();
            const numeric = rows.every((r) => { const v = val(r).replace(/[,₹%\s]/g, ''); return v === '' || !isNaN(Number(v)); });
            rows.sort((a, b) => {
              const av = val(a), bv = val(b);
              const cmp = numeric ? (Number(av.replace(/[,₹%\s]/g, '') || 0) - Number(bv.replace(/[,₹%\s]/g, '') || 0)) : av.localeCompare(bv);
              return dir === 'asc' ? cmp : -cmp;
            });
            rows.forEach((r) => body.appendChild(r));
            (table as HTMLElement).dataset.sortCol = String(colIdx);
            (table as HTMLElement).dataset.sortDir = dir;
            save();
          });
          th.appendChild(sortBtn);
        }
        // Excel-style per-column value filter (▾): pick which values in this column to show.
        if (!(th as HTMLElement).querySelector('.col-filter')) {
          const filterBtn = document.createElement('span');
          filterBtn.className = 'col-filter';
          filterBtn.contentEditable = 'false';
          filterBtn.textContent = ' ▾';
          filterBtn.title = 'Filter this column';
          filterBtn.style.cssText = 'cursor:pointer;opacity:.5;font-size:10px;user-select:none;margin-left:3px';
          filterBtn.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            openColMenuRef.current(table as HTMLTableElement, (th as HTMLTableCellElement).cellIndex, filterBtn);
          });
          th.appendChild(filterBtn);
        }
      });
    });
    setHasTable(!!root.querySelector('table'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Show only the rows that pass BOTH the text search AND every active per-column value filter.
  // View-only (display:none) — readBody() restores full visibility before anything is saved.
  const applyAllFilters = useCallback(() => {
    const root = editorRef.current; if (!root) return;
    const q = textFilterRef.current.trim().toLowerCase();
    const cf = colFiltersRef.current;
    root.querySelectorAll('table').forEach((table) => {
      const body = (table as HTMLTableElement).tBodies[0]; if (!body) return;
      const rows = body.rows;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] as HTMLTableRowElement;
        // textContent (NOT innerText) — innerText forces a synchronous reflow per row, which
        // froze the app when filtering a ~1200-row table. textContent reads with no layout.
        let show = !q || (r.textContent || '').toLowerCase().includes(q);
        if (show && cf.size) {
          for (const [ci, allowed] of cf) {
            const v = (r.cells[ci]?.textContent || '').trim();
            if (!allowed.has(v)) { show = false; break; }
          }
        }
        r.style.display = show ? '' : 'none';
      }
    });
  }, []);
  // Debounced so dragging through the text box doesn't re-scan thousands of rows per keystroke.
  const onTextFilter = useCallback((v: string) => {
    setTableFilter(v);
    textFilterRef.current = v;
    if (filterTimer.current) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => applyAllFilters(), 180);
  }, [applyAllFilters]);

  const closeColMenu = useCallback(() => { colMenuRef.current?.remove(); colMenuRef.current = null; }, []);

  // Excel-style per-column filter: click a header's ▾ to pick which values in that column to show
  // (e.g. Country → tick only INDIA + UNITED KINGDOM). Distinct values are gathered once, on open.
  const openColMenu = useCallback((table: HTMLTableElement, colIdx: number, anchor: HTMLElement) => {
    closeColMenu();
    const body = table.tBodies[0]; if (!body) return;
    // Gather distinct values with textContent (NOT innerText — innerText reflows per row and froze
    // the app when opening the menu on a big column).
    const seen = new Set<string>(); const values: string[] = [];
    for (let i = 0; i < body.rows.length; i++) {
      const v = (body.rows[i].cells[colIdx]?.textContent || '').trim();
      if (!seen.has(v)) { seen.add(v); values.push(v); }
      if (values.length >= 20000) break; // safety cap
    }
    values.sort((a, b) => a.localeCompare(b));
    const current = colFiltersRef.current.get(colIdx); // Set (allowed) or undefined (= all)
    // Persistent selection that survives search re-renders. Only a capped slice is rendered at a
    // time (rendering thousands of checkboxes was the freeze); the search box narrows which slice
    // shows, but toggles update this Set so unrendered values keep their state.
    const selected = new Set<string>(current ? current : values);
    const LIMIT = 300;

    const panel = document.createElement('div');
    panel.className = 'nv-colmenu';
    panel.contentEditable = 'false';
    panel.style.cssText = 'position:fixed;z-index:100;width:250px;max-height:360px;display:flex;flex-direction:column;'
      + 'background:var(--nv-surface);border:1px solid var(--nv-border);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);'
      + 'font-family:inherit;color:var(--nv-text);overflow:hidden;';
    const search = document.createElement('input');
    search.placeholder = 'Search values…';
    search.style.cssText = 'margin:8px;padding:6px 8px;font-size:11px;border-radius:6px;border:1px solid var(--nv-border);background:var(--nv-bg);color:var(--nv-text);outline:none;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;padding:0 10px 4px;font-size:10px;';
    const selAll = document.createElement('button'); selAll.textContent = 'Select all'; selAll.style.cssText = 'color:var(--nv-accent,#7C5CFF);background:none;border:none;cursor:pointer;padding:0;';
    const selNone = document.createElement('button'); selNone.textContent = 'Clear'; selNone.style.cssText = 'color:var(--nv-faint);background:none;border:none;cursor:pointer;padding:0;';
    bar.appendChild(selAll); bar.appendChild(selNone);
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'flex:1;overflow:auto;padding:2px 8px;';
    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      const matched = q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
      listWrap.textContent = '';
      for (const v of matched.slice(0, LIMIT)) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:3px 2px;font-size:11px;cursor:pointer;';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = selected.has(v);
        cb.addEventListener('change', () => { if (cb.checked) selected.add(v); else selected.delete(v); });
        const span = document.createElement('span'); span.textContent = v || '(blank)'; span.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        row.appendChild(cb); row.appendChild(span); listWrap.appendChild(row);
      }
      if (matched.length > LIMIT) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:9.5px;color:var(--nv-faint);padding:4px 2px;';
        note.textContent = `Showing ${LIMIT} of ${matched.length} — type to narrow.`;
        listWrap.appendChild(note);
      }
    };
    selAll.addEventListener('click', () => { values.forEach((v) => selected.add(v)); renderList(); });
    selNone.addEventListener('click', () => { selected.clear(); renderList(); });
    search.addEventListener('input', renderList);
    renderList();
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:8px;border-top:1px solid var(--nv-border);';
    const clearBtn = document.createElement('button'); clearBtn.textContent = 'Reset'; clearBtn.style.cssText = 'font-size:10.5px;color:var(--nv-faint);background:none;border:none;cursor:pointer;';
    const applyBtn = document.createElement('button'); applyBtn.textContent = 'Apply'; applyBtn.style.cssText = 'font-size:10.5px;font-weight:600;color:#fff;background:var(--nv-accent,#7C5CFF);border:none;border-radius:6px;padding:4px 12px;cursor:pointer;';
    clearBtn.addEventListener('click', () => { colFiltersRef.current.delete(colIdx); anchor.style.opacity = '.5'; anchor.style.color = ''; applyAllFilters(); closeColMenu(); });
    applyBtn.addEventListener('click', () => {
      if (selected.size >= values.length) { colFiltersRef.current.delete(colIdx); }
      else { colFiltersRef.current.set(colIdx, new Set(selected)); }
      anchor.style.opacity = colFiltersRef.current.has(colIdx) ? '1' : '.5';
      anchor.style.color = colFiltersRef.current.has(colIdx) ? 'var(--nv-accent,#7C5CFF)' : '';
      applyAllFilters(); closeColMenu();
    });
    foot.appendChild(clearBtn); foot.appendChild(applyBtn);
    panel.appendChild(search); panel.appendChild(bar); panel.appendChild(listWrap); panel.appendChild(foot);
    document.body.appendChild(panel);
    colMenuRef.current = panel;
    // Position under the header button, kept on-screen.
    const r = anchor.getBoundingClientRect();
    panel.style.left = `${Math.min(r.left, window.innerWidth - 262)}px`;
    panel.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 350)}px`;
    // Dismiss on outside click.
    setTimeout(() => {
      const onDoc = (ev: MouseEvent) => { if (colMenuRef.current && !colMenuRef.current.contains(ev.target as Node) && ev.target !== anchor) { closeColMenu(); document.removeEventListener('mousedown', onDoc); } };
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }, [applyAllFilters, closeColMenu]);
  const openColMenuRef = useRef(openColMenu);
  openColMenuRef.current = openColMenu;

  useEffect(() => { if (editorRef.current) { editorRef.current.innerHTML = initialHtml; enhanceTables(); } }, [initialHtml, enhanceTables]);
  useEffect(() => () => { if (filterTimer.current) clearTimeout(filterTimer.current); closeColMenu(); }, [closeColMenu]);

  const patch = (p: Partial<BrainNode>) => brain.updateNode(node.id, p);
  const patchTitleDebounced = (t: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => brain.updateNode(node.id, { title: t.trim() || 'Untitled' }), 220);
  };
  // Read the body but strip the resize handles (they're UI-only, never stored).
  const readBody = () => {
    const root = editorRef.current; if (!root) return '';
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.col-resizer, .col-sort, .col-filter').forEach((h) => h.remove());
    // A row hidden by the live filter must NOT be saved as display:none (that would make it
    // vanish permanently). Restore every row's visibility in the saved copy.
    clone.querySelectorAll('tr').forEach((r) => { (r as HTMLElement).style.display = ''; });
    return clone.innerHTML;
  };
  // HTML for sending to Krew: strips UI buttons and DROPS rows the filter/column-picker have
  // hidden — so when the user narrows the table (e.g. Country = INDIA) and clicks "Chat with this
  // file", Krew receives ONLY those rows and can act on them ("email all of these").
  const exportHtmlForChat = () => {
    const root = editorRef.current; if (!root) return '';
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.col-resizer, .col-sort, .col-filter').forEach((h) => h.remove());
    clone.querySelectorAll('tr').forEach((r) => { if ((r as HTMLElement).style.display === 'none') r.remove(); });
    return clone.innerHTML;
  };
  const anyFilterActive = () => colFiltersRef.current.size > 0 || !!textFilterRef.current.trim();
  // For a PDF/deck/image the editor isn't rendered, so readBody() would return '' and WIPE the
  // stored body — skip the body write there (title/ref/kind still save). A LARGE table is shown
  // read-only, so filter/sort are view-only and never persisted (cloning a 15k-cell DOM on every
  // sort/blur was itself a freeze).
  const readOnlyFile = isPdf || isDeck || isImage;
  const skipBodyWrite = readOnlyFile || largeBody;
  const save = () => brain.updateNode(node.id, { title: title.trim() || 'Untitled', ...(skipBodyWrite ? {} : { body: readBody() }), ref, kind });
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
    // Store the extracted text as the node body (agents recall it) regardless of whether the
    // editor is shown — for a PDF the panel shows the actual PDF, not this text.
    const html = mdToHtml(content.slice(0, 2000000));
    const cur = editorRef.current;
    if (cur && !cur.innerText.trim()) cur.innerHTML = html;
    brain.updateNode(node.id, { kind: 'file', title: newTitle, body: html, ...(path ? { filePath: path } : {}) });
  }

  // Attach a real file to THIS node. Tries the native picker (gives the full path);
  // if that command isn't available, falls back to the browser file input (content only).
  async function attachFile() {
    try {
      const path = await invoke<string | null>('brain_pick_file');
      if (!path) return; // user cancelled
      const content = await invoke<string>('brain_extract_text', { path }).catch(() => '');
      // Durable copy so the file stays in the Brain even if the original is deleted.
      const stored = await invoke<string>('brain_store_file', { sourcePath: path }).catch(() => path);
      applyFile(path.split(/[/\\]/).pop() || path, content, stored);
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
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${maximized ? 'p-0' : 'p-4 sm:p-8'}`} style={{ background: 'rgba(0,0,0,.5)' }}
      onMouseDown={() => { save(); onClose(); }}>
      <div className={`flex flex-col w-full overflow-hidden shadow-2xl ${maximized ? 'max-w-none' : 'max-w-6xl rounded-2xl'}`}
        style={{ height: maximized ? '100vh' : '92vh', background: 'var(--nv-surface)', border: '1px solid var(--nv-border)' }}
        onMouseDown={(e) => e.stopPropagation()}>

        {/* Header — title + simple formatting buttons (no markdown to learn) */}
        <div className="flex items-center gap-3 px-5 h-14 shrink-0" style={{ borderBottom: '1px solid var(--nv-border)' }}>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLOR[kind] }} />
          <input value={title}
            onChange={(e) => { setTitle(e.target.value); patchTitleDebounced(e.target.value); }} onBlur={save}
            placeholder="Untitled"
            className="flex-1 bg-transparent text-[16px] font-semibold outline-none" style={{ color: 'var(--nv-text)' }} />
          {!readOnlyFile && (
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
          )}
          <button onClick={() => setMaximized((m) => !m)} title={maximized ? 'Restore size' : 'Maximize'}
            className="w-7 h-7 rounded-md flex items-center justify-center ml-1 transition-fast hover:bg-nv-surface2" style={{ color: 'var(--nv-faint)' }}>
            {maximized ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
              </svg>
            )}
          </button>
          <button onClick={() => { save(); onClose(); }} className="text-xl ml-0.5" style={{ color: 'var(--nv-faint)' }}>×</button>
        </div>

        {/* Table toolbar — Excel-style structure editing (hidden for read-only files: PDF/deck) */}
        {!readOnlyFile && (
        <div className="flex items-center gap-1 px-5 py-1.5 shrink-0 flex-wrap" style={{ borderBottom: '1px solid var(--nv-border)', background: 'var(--nv-bg)' }}>
          <span className="text-[9px] font-mono uppercase tracking-wider mr-1" style={{ color: 'var(--nv-faint)' }}>{largeBody ? 'View' : 'Table'}</span>
          {/* Structure editing is hidden for a big table — it's shown read-only for speed. */}
          {!largeBody && ([
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
          {hasTable && (
            <input value={tableFilter} onChange={(e) => onTextFilter(e.target.value)}
              placeholder="Filter rows…"
              className="ml-2 w-44 rounded-md px-2.5 py-1 text-[10.5px] outline-none focus:border-accent"
              style={{ background: 'var(--nv-surface)', border: '1px solid var(--nv-border)', color: 'var(--nv-text)' }} />
          )}
          <span className="text-[9px] ml-2" style={{ color: 'var(--nv-faint)' }}>{hasTable ? (largeBody ? 'big table — read-only · ▾ filter a column · ⇅ sort · drag a cell edge to resize' : 'filter rows · ▾ filter a column · ⇅ sort · drag a cell edge to resize') : "tip: drag a cell's right/bottom edge to resize"}</span>
        </div>
        )}

        {/* Body — deck preview for decks, PDF viewer for PDFs, else the note editor + sidebar */}
        <div className="flex flex-1 min-h-0">
          {isDeck ? (
            <DeckPreview path={filePath} />
          ) : isPdf ? (
            <PdfViewer path={filePath} />
          ) : isImage ? (
            <ImageViewer path={filePath} />
          ) : (
          <div
            ref={editorRef}
            contentEditable={!largeBody}
            suppressContentEditableWarning
            onBlur={save}
            data-placeholder="Start writing… use the B / H / • buttons above to format. Anything Krew finds (like a company list) shows here as a clean table."
            className={`flex-1 min-w-0 overflow-auto p-6 empty:before:content-[attr(data-placeholder)] empty:before:text-nv-faint ${NOTE_CLS}`}
            style={{ color: 'var(--nv-text)' }}
          />
          )}

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
              {/* Storage used — shown for EVERY item (text size, plus the on-disk file if attached). */}
              <p className="text-[9px] font-mono mt-1" style={{ color: 'var(--nv-faint)' }}>Storage used: {formatBytes(storageBytes)}{diskSize != null ? ' (file on disk + text)' : ''}</p>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onHtmlFile} />
            </div>
            {isDeck && (
              <div className="space-y-1.5">
                <label className={labelCls} style={{ color: 'var(--nv-muted)' }}>Presentation</label>
                <div className="flex gap-1.5">
                  <button onClick={openDeck} className="flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold text-white" style={{ background: 'var(--nv-accent, #7C5CFF)' }}>Open / Present</button>
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
                // a focused chat that stays scoped to this file + its connections. If a filter is
                // active, only the visible (filtered) rows are sent.
                const html = exportHtmlForChat();
                let content = (nodeToMarkdown(html) || editorRef.current?.innerText || '').trim();
                if (anyFilterActive()) content = `(Filtered view — only the rows matching the applied filter are included below.)\n\n${content}`;
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
                const html = exportHtmlForChat();
                let content = (nodeToMarkdown(html) || editorRef.current?.innerText || '').trim();
                if (anyFilterActive()) content = `(Filtered view — only the rows matching the applied filter are included below.)\n\n${content}`;
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
