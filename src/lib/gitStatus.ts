// ─── What changed, in words the file tree can show ───────────────────────────
//
// THE QUESTION CODER EXISTS TO ANSWER. An agent edits four files; the only thing anyone wants next
// is *what did it change*. Until now that meant leaving the app and running git in a terminal —
// exactly the thing this product exists to stop people having to do.
//
// PURE ON PURPOSE. No Tauri, no React. The parsing and — far more importantly — the PATH MATCHING
// are the two places this silently fails, and both are testable in node.

export interface GitFile {
  /** Absolute, forward slashes, as the Rust side normalises it. */
  path: string;
  /** Repo-relative, which is what a human recognises. */
  rel: string;
  /** Porcelain codes: index column and worktree column. */
  index: string;
  worktree: string;
  /** Previous name, for a rename or a copy. */
  from?: string | null;
}

export interface GitStatus {
  ok: boolean;
  reason?: 'no_git' | 'not_a_repo';
  root?: string;
  branch?: string;
  files?: GitFile[];
}

export type ChangeKind = 'new' | 'modified' | 'deleted' | 'renamed' | 'conflict' | 'none';

/**
 * ONE PATH SHAPE, DECIDED HERE.
 *
 * Git speaks absolute forward-slash; `list_dir` hands back absolute Windows backslash; and Windows
 * itself does not care about case. Compare those three as-is and the tree lights up nothing at all
 * while every file is genuinely modified — the failure looks exactly like "no changes", which is
 * the most misleading possible outcome for a feature whose whole job is showing changes.
 *
 * So every path on both sides goes through this before it is compared, and nowhere else has to know.
 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * What actually happened to this file.
 *
 * Porcelain gives two columns — what is staged, and what is not. For a tree badge the user does not
 * care which side it sits on, only what became of the file, so the two are collapsed. Conflict is
 * checked first because it is the only one that needs a human before anything else can happen.
 */
export function changeKind(f: Pick<GitFile, 'index' | 'worktree'>): ChangeKind {
  const x = f.index, y = f.worktree;
  if (x === '?' || y === '?') return 'new';
  // Both sides modified, or either side marked unmerged, means a conflict git will not resolve.
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || x === 'C') return 'renamed';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A') return 'new';
  if (x === 'M' || y === 'M' || x === 'T' || y === 'T') return 'modified';
  return 'none';
}

/** One letter for the tree — the convention every developer already reads without being taught. */
export const KIND_LETTER: Record<ChangeKind, string> = {
  new: 'A', modified: 'M', deleted: 'D', renamed: 'R', conflict: '!', none: '',
};

/** Plain words, because Coder is used by people who do not read porcelain codes. */
export const KIND_LABEL: Record<ChangeKind, string> = {
  new: 'New file — git has not seen this before',
  modified: 'Changed since the last commit',
  deleted: 'Deleted',
  renamed: 'Renamed or moved',
  conflict: 'Conflict — needs you to decide',
  none: 'No changes',
};

/** Tailwind colour per kind. Green for added, amber for changed, red for gone or broken. */
export const KIND_CLASS: Record<ChangeKind, string> = {
  new: 'text-emerald-500',
  modified: 'text-amber-500',
  deleted: 'text-red-400',
  renamed: 'text-sky-400',
  conflict: 'text-red-500',
  none: '',
};

/** Path → what happened to it, ready for the tree to look up by normalised path. */
export function statusMap(status: GitStatus | null): Map<string, ChangeKind> {
  const out = new Map<string, ChangeKind>();
  if (!status?.ok || !status.files) return out;
  for (const f of status.files) {
    const kind = changeKind(f);
    if (kind !== 'none') out.set(normPath(f.path), kind);
  }
  return out;
}

/**
 * A folder shows a mark when anything inside it changed.
 *
 * Without this, a change three levels down is invisible until you happen to expand the right
 * folders — which for an agent that touched files you did not choose is most of the time. The
 * folder does not say WHAT changed, only that something did, which is all it needs to say to get
 * you to open it.
 */
export function folderHasChanges(dirPath: string, map: Map<string, ChangeKind>): boolean {
  const dir = normPath(dirPath) + '/';
  for (const p of map.keys()) if (p.startsWith(dir)) return true;
  return false;
}

/** How many files changed — for the one-line summary above the tree. */
export function changeCount(status: GitStatus | null): number {
  return statusMap(status).size;
}

// ── Reading a unified diff ───────────────────────────────────────────────────

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
export interface DiffLine { kind: DiffLineKind; text: string }

/**
 * Split a unified diff into lines the view can colour.
 *
 * ORDER MATTERS HERE and it is the one thing that looks fine until it does not: `+++ b/file` and
 * `--- a/file` begin with + and -, so checking those first paints two header lines as a real
 * addition and a real deletion in every single diff. The file headers are matched before the
 * content markers, always.
 */
export function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const raw of (text || '').split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) { out.push({ kind: 'meta', text: raw }); continue; }
    if (raw.startsWith('@@')) { out.push({ kind: 'hunk', text: raw }); continue; }
    if (raw.startsWith('diff ') || raw.startsWith('index ')
      || raw.startsWith('new file') || raw.startsWith('deleted file')
      || raw.startsWith('similarity ') || raw.startsWith('rename ')) {
      out.push({ kind: 'meta', text: raw }); continue;
    }
    if (raw.startsWith('+')) { out.push({ kind: 'add', text: raw.slice(1) }); continue; }
    if (raw.startsWith('-')) { out.push({ kind: 'del', text: raw.slice(1) }); continue; }
    // A context line begins with a space; the final empty line of the split is not a line at all.
    out.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  // git's output ends with a newline, which splits into a trailing empty string. Drawing it adds a
  // blank row to the bottom of every diff.
  if (out.length && out[out.length - 1].kind === 'ctx' && out[out.length - 1].text === '') out.pop();
  return out;
}

/** "+42 −7" for the header. The two numbers people actually look at. */
export function diffTotals(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of lines) { if (l.kind === 'add') added++; else if (l.kind === 'del') removed++; }
  return { added, removed };
}
