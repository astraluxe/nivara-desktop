// ─── What changed in this file ───────────────────────────────────────────────
//
// Coder exists so an agent's work is visible and editable. "Editable" was there — Monaco, a tree, a
// terminal — and "visible" was not: the one question anyone asks after an agent touches four files
// is *what did it change*, and answering it meant leaving the app for a terminal.
//
// Deliberately a READ-ONLY unified diff and not a side-by-side editor. Side-by-side needs twice the
// width, and Coder's editor pane is already sharing the window with a tree, a chat and a terminal.
// The question here is "what changed", not "let me merge this by hand" — and the file itself is one
// click away for that.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseDiff, diffTotals, type DiffLine } from '../../lib/gitStatus';

interface DiffResult { ok: boolean; kind?: 'diff' | 'new' | 'unchanged'; text?: string; reason?: string }

export default function DiffView({ projectPath, file, onClose }: {
  projectPath: string;
  file: string;
  onClose: () => void;
}) {
  const [res, setRes] = useState<DiffResult | null>(null);

  useEffect(() => {
    let dead = false;
    setRes(null);
    invoke<string>('git_diff_file', { path: projectPath, file })
      .then((raw) => { if (!dead) setRes(JSON.parse(raw) as DiffResult); })
      .catch((e) => { if (!dead) setRes({ ok: false, reason: String(e) }); });
    return () => { dead = true; };
  }, [projectPath, file]);

  const name = file.split(/[/\\]/).pop() ?? file;

  if (!res) return <Shell name={name} onClose={onClose}><Msg>Reading the changes…</Msg></Shell>;
  if (!res.ok) {
    return (
      <Shell name={name} onClose={onClose}>
        <Msg>{res.reason === 'not_a_repo'
          ? 'This folder is not a git repository, so there is nothing to compare against.'
          : 'Could not read the changes for this file.'}</Msg>
      </Shell>
    );
  }
  if (res.kind === 'unchanged') {
    return <Shell name={name} onClose={onClose}><Msg>No changes since the last commit.</Msg></Shell>;
  }

  // A brand-new file has no diff — git has never seen it. Showing "no changes" for a file an agent
  // just created would be the exact opposite of the truth, so its contents are shown as added.
  const lines: DiffLine[] = res.kind === 'new'
    ? (res.text ?? '').split('\n').map((t) => ({ kind: 'add' as const, text: t }))
    : parseDiff(res.text ?? '');
  const { added, removed } = diffTotals(lines);

  return (
    <Shell name={name} onClose={onClose}
           badge={res.kind === 'new' ? 'new file' : undefined}
           added={added} removed={removed}>
      <div className="font-mono text-[11px] leading-[1.55] overflow-auto h-full">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === 'add' ? 'bg-emerald-500/[0.09] text-emerald-300'
              : l.kind === 'del' ? 'bg-red-500/[0.09] text-red-300'
              : l.kind === 'hunk' ? 'bg-nv-surface2 text-nv-faint mt-1'
              : l.kind === 'meta' ? 'text-nv-faint/70'
              : 'text-nv-muted'
            }
          >
            {/* The marker column is drawn separately from the text so a line beginning with a
                space is not mistaken for one that was added, and so the code stays aligned. */}
            <span className="inline-block w-4 pl-1 select-none opacity-60">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}
            </span>
            <span className="whitespace-pre-wrap break-all">{l.text || ' '}</span>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function Shell({ name, onClose, children, badge, added, removed }: {
  name: string; onClose: () => void; children: React.ReactNode;
  badge?: string; added?: number; removed?: number;
}) {
  return (
    <div className="flex flex-col h-full bg-nv-bg">
      <div className="flex items-center gap-2 h-7 px-2.5 shrink-0 border-b border-nv-border bg-nv-surface">
        <span className="text-[11px] text-nv-text font-medium truncate">{name}</span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 shrink-0">{badge}</span>
        )}
        {(added || removed) ? (
          <span className="text-[10px] font-mono shrink-0">
            <span className="text-emerald-500">+{added}</span>{' '}
            <span className="text-red-400">−{removed}</span>
          </span>
        ) : null}
        <div className="flex-1" />
        <button
          onClick={onClose}
          title="Back to the file"
          className="text-[10px] text-nv-faint hover:text-nv-text transition-fast shrink-0"
        >Back to the file</button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function Msg({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-nv-muted p-4">{children}</p>;
}
