import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ─── The two things every code editor has that this one did not ───────────────
//
// Quick Open (Ctrl+P) and Find in Files (Ctrl+Shift+F). Without them the only way to reach a file
// is to expand your way down the tree to it, and the only way to find a string is to remember which
// file you put it in. On anything bigger than a toy project that is the difference between an
// editor you can work in and one you can only look at.
//
// Both are one panel with two modes, because they are the same interaction — type, see ranked
// results, arrow to one, Enter — and two near-identical components would drift apart.

export type PaletteMode = 'files' | 'search';

interface Hit { path: string; line?: number; text?: string }

/** The file name without its folders — what people actually type. */
function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}
function relTo(root: string, p: string): string {
  const n = (s: string) => s.replace(/\\/g, '/');
  const r = n(root).replace(/\/+$/, '');
  const f = n(p);
  return f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : f;
}

/**
 * Subsequence match, the way every editor's file finder works: "mtjs" finds "merkletree.js".
 * Returns a score (lower is better) or -1 for no match. Consecutive matches and matches in the
 * FILE NAME rather than the folder path score better, which is what makes the file you meant come
 * first instead of the third one alphabetically.
 */
function fuzzyScore(text: string, q: string): number {
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0, score = 0, lastHit = -2;
  for (const ch of q.toLowerCase()) {
    const at = t.indexOf(ch, ti);
    if (at === -1) return -1;
    score += at === lastHit + 1 ? 0 : (at - ti) + 1;   // gaps cost, runs are free
    lastHit = at;
    ti = at + 1;
  }
  return score;
}

export default function QuickOpen({ mode, projectPath, onClose, onOpen }: {
  mode: PaletteMode;
  projectPath: string;
  onClose: () => void;
  onOpen: (path: string, line?: number) => void;
}) {
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the file index once per open. Cheap enough to redo each time, and always current — a
  // cached index that has gone stale sends you to a file that no longer exists.
  useEffect(() => {
    if (mode !== 'files' || !projectPath) return;
    let alive = true;
    invoke<string[]>('list_files_recursive', { path: projectPath, max: 20000 })
      .then((f) => { if (alive) setFiles(f); })
      .catch(() => { if (alive) setNote("Couldn't read the project folder."); });
    return () => { alive = false; };
  }, [mode, projectPath]);

  const fileResults = useMemo(() => {
    if (mode !== 'files') return [];
    const query = q.trim();
    const scored = files.map((p) => {
      const rel = relTo(projectPath, p);
      if (!query) return { p, rel, s: 0 };
      // Score against the bare name first — "index" should not rank sixty src/**/index.ts files by
      // how deep they sit — then fall back to the whole relative path so folder typing works.
      const byName = fuzzyScore(baseName(p), query);
      const byPath = fuzzyScore(rel, query);
      if (byName === -1 && byPath === -1) return null;
      const s = byName === -1 ? byPath + 40 : byName;
      return { p, rel, s };
    }).filter(Boolean) as { p: string; rel: string; s: number }[];
    scored.sort((a, b) => a.s - b.s || a.rel.length - b.rel.length);
    return scored.slice(0, 60);
  }, [mode, files, q, projectPath]);

  // Search runs in Rust, debounced — every keystroke walking the project would make typing crawl.
  const runSearch = useCallback((query: string) => {
    if (!query.trim() || !projectPath) { setHits([]); setNote(''); return; }
    setBusy(true);
    invoke<Hit[]>('search_in_files', { path: projectPath, query, caseSensitive: false, max: 300 })
      .then((r) => { setHits(r); setSel(0); setNote(r.length ? '' : 'No matches.'); })
      .catch((e) => { setHits([]); setNote(String(e)); })
      .finally(() => setBusy(false));
  }, [projectPath]);

  useEffect(() => {
    if (mode !== 'search') return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => runSearch(q), 220);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [q, mode, runSearch]);

  const rows: Hit[] = mode === 'files' ? fileResults.map((r) => ({ path: r.p })) : hits;
  useEffect(() => { setSel(0); }, [mode]);
  useEffect(() => {
    listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, rows.length]);

  const choose = (i: number) => {
    const r = rows[i];
    if (!r) return;
    onOpen(r.path, r.line);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-24 bg-black/50" onClick={onClose}>
      <div
        className="w-[620px] max-w-[92vw] rounded-xl border border-nv-border bg-nv-surface shadow-2xl overflow-hidden flex flex-col max-h-[62vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-2.5 pb-2 border-b border-nv-border">
          <div className="text-[9px] font-mono uppercase tracking-wide text-accent mb-1.5">
            {mode === 'files' ? 'Go to file · Ctrl+P' : 'Find in files · Ctrl+Shift+F'}
          </div>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
            }}
            placeholder={mode === 'files' ? 'Type part of a file name…' : 'Text to find across the project…'}
            className="w-full bg-nv-bg border border-nv-border focus:border-accent rounded-lg px-2.5 py-1.5 text-[12px] text-nv-text placeholder:text-nv-faint outline-none"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {busy && <div className="px-3 py-2 text-[11px] text-nv-faint">Searching…</div>}
          {!busy && note && <div className="px-3 py-2 text-[11px] text-nv-faint">{note}</div>}
          {!busy && !note && rows.length === 0 && q.trim() && (
            <div className="px-3 py-2 text-[11px] text-nv-faint">Nothing matches “{q}”.</div>
          )}
          {rows.map((r, i) => (
            <button
              key={`${r.path}:${r.line ?? 0}:${i}`}
              data-sel={i === sel ? '1' : '0'}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
              className={`w-full text-left px-3 py-1.5 transition-fast ${i === sel ? 'bg-accent/15' : 'hover:bg-nv-surface2/60'}`}
            >
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[11.5px] text-nv-text truncate shrink-0 max-w-[45%]">{baseName(r.path)}</span>
                <span className="text-[9.5px] text-nv-faint truncate">{relTo(projectPath, r.path)}{r.line ? `:${r.line}` : ''}</span>
              </div>
              {r.text && <div className="text-[10px] font-mono text-nv-muted truncate mt-0.5">{r.text}</div>}
            </button>
          ))}
        </div>

        <div className="px-3 py-1.5 border-t border-nv-border text-[9.5px] text-nv-faint flex items-center gap-3">
          <span>↑↓ move</span><span>Enter open</span><span>Esc close</span>
          {mode === 'files' && files.length > 0 && <span className="ml-auto">{files.length} files indexed</span>}
          {mode === 'search' && hits.length > 0 && <span className="ml-auto">{hits.length} match{hits.length === 1 ? '' : 'es'}</span>}
        </div>
      </div>
    </div>
  );
}
