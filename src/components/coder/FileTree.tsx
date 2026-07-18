import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FileEntry { name: string; path: string; is_dir: boolean; }

function sortEntries(list: FileEntry[]) {
  return list.sort((a, b) =>
    (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0) || a.name.localeCompare(b.name)
  );
}

function FileIcon({ isDir, expanded }: { isDir: boolean; expanded?: boolean }) {
  if (isDir) return <span className="text-nv-faint">{expanded ? '▾' : '▸'}</span>;
  return <span className="text-nv-faint opacity-40">·</span>;
}

function FileNode({
  entry, depth, openFile, onFileOpen,
}: {
  entry: FileEntry; depth: number; openFile: string | null;
  onFileOpen: (p: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const isActive = openFile === entry.path;

  async function handleClick() {
    if (!entry.is_dir) { onFileOpen(entry.path); return; }
    if (!expanded) {
      try {
        const kids = await invoke<FileEntry[]>('list_dir', { path: entry.path });
        setChildren(sortEntries(kids));
      } catch { /* ignore */ }
    }
    setExpanded((x) => !x);
  }

  return (
    <>
      <button
        onClick={handleClick}
        style={{ paddingLeft: `${6 + depth * 12}px` }}
        className={`w-full flex items-center gap-1.5 py-[3px] pr-2 text-[11px] text-left rounded
          transition-fast truncate
          ${isActive
            ? 'bg-accent/20 text-accent'
            : 'text-nv-muted hover:text-nv-text hover:bg-nv-surface2'}`}
      >
        <span className="shrink-0 w-3 text-center">
          <FileIcon isDir={entry.is_dir} expanded={expanded} />
        </span>
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && children.map((c) => (
        <FileNode key={c.path} entry={c} depth={depth + 1} openFile={openFile} onFileOpen={onFileOpen} />
      ))}
    </>
  );
}

interface Props {
  projectPath: string;
  openFile: string | null;
  onFileOpen: (p: string) => void;
  onOpenFolder: (p: string) => void;
}

export default function FileTree({ projectPath, openFile, onFileOpen, onOpenFolder }: Props) {
  const [entries, setEntries] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!projectPath) return;
    invoke<FileEntry[]>('list_dir', { path: projectPath })
      .then((list) => setEntries(sortEntries(list)))
      .catch(() => {});
  }, [projectPath]);

  async function openFolder() {
    const p = await invoke<string | null>('open_folder_dialog');
    if (p) onOpenFolder(p);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 h-8 border-b border-nv-border shrink-0">
        <span className="nv-eyebrow text-nv-muted">Explorer</span>
        <button
          onClick={openFolder}
          title="Open folder"
          className="text-nv-faint hover:text-accent transition-fast text-base leading-none"
        >+</button>
      </div>

      <div className="flex-1 overflow-y-auto py-1 px-1">
        {!projectPath ? (
          <div className="flex flex-col items-center gap-3 pt-8 px-3">
            <p className="text-nv-faint text-[11px] text-center">No folder open</p>
            <button
              onClick={openFolder}
              className="text-[11px] px-3 py-1.5 rounded border border-nv-border
                text-nv-muted hover:border-accent hover:text-accent transition-fast"
            >Open folder</button>
          </div>
        ) : (
          entries.map((e) => (
            <FileNode key={e.path} entry={e} depth={0} openFile={openFile} onFileOpen={onFileOpen} />
          ))
        )}
      </div>
    </div>
  );
}
