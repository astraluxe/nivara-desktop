// ─── Watching an agent write a document ──────────────────────────────────────
//
// This is where the two halves meet: officeCom.ts drives real Word/Excel/PowerPoint, agentCursor.ts
// draws a pointer on screen, and this moves the second one according to what the first is genuinely
// doing.
//
// ── THE PROGRESS IS REAL, AND THAT IS THE WHOLE POINT ────────────────────────
//
// Office automation is a single PowerShell call that takes several seconds and returns only at the
// end. The easy version of this file would animate a cursor over that opaque call — motion invented
// to look busy while the real work happened invisibly. That is a lie with a spinner on it, and on a
// product whose pitch is "watch it happen" it is the exact lie that would matter.
//
// So the script APPENDS a line per real step to a file, this polls it, and the cursor reflects what
// actually happened. When Word is slow, the cursor waits. When a step fails, the cursor stops there.

import { createDocument, type DocSpec, type DocResult } from './officeCom';
import { showCursor, hideCursor, moveCursorTo, flashClick, type CursorPos } from './agentCursor';

export interface ProgressLine {
  phase: 'opened' | 'typing' | 'row' | 'slide' | 'saving';
  i: number;
  total: number;
  what: string;
}

/** Parse the progress file. Partial last lines are normal mid-write and are simply skipped. */
export function parseProgress(raw: string): ProgressLine[] {
  const out: ProgressLine[] = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t) as ProgressLine;
      if (o && typeof o.phase === 'string') out.push(o);
    } catch { /* a line still being written — it will be complete on the next poll */ }
  }
  return out;
}

/** The sentence shown beside the cursor. Never a bare "working…". */
export function describeProgress(p: ProgressLine, kind: DocSpec['kind']): string {
  const short = (s: string, n = 42) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  switch (p.phase) {
    case 'opened': return kind === 'word' ? 'opening Word' : kind === 'excel' ? 'opening Excel' : 'opening PowerPoint';
    case 'typing': return `writing "${short(p.what)}"  (${p.i}/${p.total})`;
    case 'row':    return `filling row ${p.i} of ${p.total}`;
    case 'slide':  return `building slide ${p.i}: ${short(p.what, 28)}`;
    case 'saving': return `saving ${short(p.what.split(/[/\\]/).pop() ?? '', 28)}`;
    default:       return 'working in the document';
  }
}

/**
 * Where the cursor should sit for a given step.
 *
 * Inside the real application window, walking DOWN the page as the document is written, because
 * that is where a person's eye and hand would be. Bounded well inside the frame so it never lands
 * on the title bar or off the edge of a window that turned out smaller than expected.
 */
export function pointFor(
  p: ProgressLine, rect: { x: number; y: number; w: number; h: number }, kind: DocSpec['kind'],
): CursorPos {
  const total = Math.max(1, p.total);
  const frac = Math.min(1, Math.max(0, (p.i || 0) / total));
  if (kind === 'excel') {
    // Down the first column, as if entering rows.
    return { x: rect.x + Math.round(rect.w * 0.18), y: rect.y + Math.round(rect.h * (0.28 + 0.5 * frac)) };
  }
  if (kind === 'powerpoint') {
    // Down the slide strip on the left, which is where the deck visibly grows.
    return { x: rect.x + Math.round(rect.w * 0.09), y: rect.y + Math.round(rect.h * (0.22 + 0.55 * frac)) };
  }
  // Word: down the page, indented like a line of text.
  return { x: rect.x + Math.round(rect.w * 0.32), y: rect.y + Math.round(rect.h * (0.26 + 0.5 * frac)) };
}

const TITLE_HINT: Record<DocSpec['kind'], string> = {
  word: 'Word', excel: 'Excel', powerpoint: 'PowerPoint',
};

async function findWindow(kind: DocSpec['kind']) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<string>('window_rect', { titleContains: TITLE_HINT[kind] });
    const r = JSON.parse(raw || '{}') as { x?: number; y?: number; w?: number; h?: number };
    if (typeof r.x === 'number' && typeof r.w === 'number' && r.w > 200) {
      return { x: r.x, y: r.y ?? 0, w: r.w, h: r.h ?? 600 };
    }
  } catch { /* fall through */ }
  return null;
}

export interface WatchedDoc extends DocResult {
  /** How many real steps the cursor followed. 0 means it never got a window to sit on. */
  steps: number;
}

/**
 * Make a document, with the agent's cursor following the real work.
 *
 * The cursor is decoration in the strictest sense: if anything about it fails — no window found, no
 * progress file, the overlay missing — the document is still made. It is never allowed to break the
 * task it exists to describe.
 */
export async function createDocumentWatched(
  spec: DocSpec,
  who: { agent: string; rgb: string },
  opts: { pollMs?: number } = {},
): Promise<WatchedDoc> {
  const pollMs = opts.pollMs ?? 140;
  const progressPath = `${spec.savePath}.progress.jsonl`;
  const full: DocSpec = { ...spec, visible: spec.visible !== false, progressPath };

  let stop = false;
  let seen = 0;
  let last: CursorPos = { x: 0, y: 0 };

  const follow = (async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    let rect: { x: number; y: number; w: number; h: number } | null = null;
    // Sit at the centre of the screen until the application window exists, so the user sees the
    // agent arrive before the app does rather than the cursor appearing from nowhere.
    try {
      const s = JSON.parse(await invoke<string>('agent_screen')) as { w: number; h: number };
      last = { x: Math.round(s.w / 2), y: Math.round(s.h / 2) };
      await showCursor({ ...who, ...last, doing: `opening ${TITLE_HINT[full.kind]}` });
    } catch { /* the overlay is optional */ }

    while (!stop) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (!rect) rect = await findWindow(full.kind);
      let lines: ProgressLine[] = [];
      try { lines = parseProgress(await invoke<string>('read_progress', { path: progressPath })); }
      catch { /* not written yet */ }
      if (lines.length <= seen) continue;

      // Only the newest matters; if several arrived between polls, the older ones are already past.
      const p = lines[lines.length - 1];
      seen = lines.length;
      const target = rect ? pointFor(p, rect, full.kind) : last;
      // One emit; the component animates the travel with a CSS transition. Stepping it from here
      // would restart that transition on every frame and produce the stutter it replaced.
      await moveCursorTo(last, target, {
        ...who,
        doing: describeProgress(p, full.kind),
        step: p.i, total: p.total,
      });
      last = target;
      if (p.phase === 'saving') await flashClick(target, { ...who, doing: describeProgress(p, full.kind), step: p.total, total: p.total });
    }
  })().catch(() => { /* never allowed to break the document */ });

  try {
    const res = await createDocument(full);
    stop = true;
    await follow;
    if (res.ok) {
      await showCursor({ ...who, ...last, doing: 'done — the document is open in front of you' });
      await new Promise((r) => setTimeout(r, 1400));
    }
    await hideCursor();
    // The progress file is scaffolding, not output. Leaving a .jsonl beside the user's proposal
    // would be litter in their Documents folder.
    try { await (await import('@tauri-apps/api/core')).invoke('krew_execute_command', { command: `del "${progressPath}"` }); }
    catch { /* best effort */ }
    return { ...res, steps: seen };
  } catch (e) {
    stop = true;
    await hideCursor();
    return { ok: false, error: e instanceof Error ? e.message : String(e), steps: seen };
  }
}
