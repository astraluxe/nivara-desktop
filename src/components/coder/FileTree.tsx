import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface FileEntry { name: string; path: string; is_dir: boolean; }

function sortEntries(list: FileEntry[]) {
  return list.sort((a, b) =>
    (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0) || a.name.localeCompare(b.name)
  );
}

/** Join a folder and a name using whatever separator that folder already uses. */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : (dir.includes('\\') ? '\\' : '/');
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}
function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}

function FileIcon({ isDir, expanded }: { isDir: boolean; expanded?: boolean }) {
  if (isDir) return <span className="text-nv-faint">{expanded ? '▾' : '▸'}</span>;
  return <span className="text-nv-faint opacity-40">·</span>;
}

/** What the tree is being asked to make or change. Held in one place so only one row is ever in
 *  edit mode — two open name boxes is how you rename the wrong file. */
type Pending =
  | { kind: 'new'; dir: string; isDir: boolean }
  | { kind: 'rename'; path: string; was: string }
  | null;

function FileNode({
  entry, depth, openFile, onFileOpen, pending, setPending, onChanged, refreshKey,
}: {
  entry: FileEntry; depth: number; openFile: string | null;
  onFileOpen: (p: string) => void;
  pending: Pending; setPending: (p: Pending) => void;
  onChanged: (created?: string) => void;
  refreshKey: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const [err, setErr] = useState('');
  // Deleting is two clicks on the row itself — window.confirm never shows in this webview, so a
  // confirm dialog would leave the button doing nothing at all.
  const [confirmDel, setConfirmDel] = useState(false);
  const isActive = openFile === entry.path;

  const load = useCallback(async () => {
    try { setChildren(sortEntries(await invoke<FileEntry[]>('list_dir', { path: entry.path }))); }
    catch { /* unreadable folder — leave it collapsed rather than blanking the tree */ }
  }, [entry.path]);

  // Re-read an OPEN folder whenever something was created, renamed or deleted anywhere, so a new
  // file appears where it was made instead of only after collapsing and re-opening the folder.
  useEffect(() => { if (expanded) void load(); }, [refreshKey, expanded, load]);

  async function handleClick() {
    if (!entry.is_dir) { onFileOpen(entry.path); return; }
    if (!expanded) await load();
    setExpanded((x) => !x);
  }

  // "New file here" on a FOLDER means inside it; on a FILE it means beside it, which is what
  // someone clicking a file in a folder actually means.
  const dirFor = entry.is_dir ? entry.path : parentOf(entry.path);
  const startNew = async (isDir: boolean) => {
    if (entry.is_dir && !expanded) { await load(); setExpanded(true); }
    setPending({ kind: 'new', dir: dirFor, isDir });
  };

  const renaming = pending?.kind === 'rename' && pending.path === entry.path;

  return (
    <>
      <div className="group relative flex items-center">
        {renaming ? (
          <NameBox
            initial={entry.name}
            depth={depth}
            onCancel={() => { setPending(null); setErr(''); }}
            onSubmit={async (name) => {
              try {
                await invoke<string>('rename_path', { from: entry.path, to: joinPath(parentOf(entry.path), name) });
                setPending(null); setErr(''); onChanged();
              } catch (e) { setErr(String(e)); }
            }}
          />
        ) : (
          <>
            <button
              onClick={handleClick}
              style={{ paddingLeft: `${6 + depth * 12}px` }}
              className={`flex-1 min-w-0 flex items-center gap-1.5 py-[3px] pr-1 text-[11px] text-left rounded
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
            {/* Row actions. Hidden until the row is hovered so the tree stays a tree, but always
                present — there was previously no way at all to make a file. */}
            <span className="shrink-0 flex items-center gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-fast">
              <RowBtn title={entry.is_dir ? 'New file in this folder' : 'New file beside this one'} onClick={() => startNew(false)}>+</RowBtn>
              {entry.is_dir && <RowBtn title="New folder inside" onClick={() => startNew(true)}>▤</RowBtn>}
              <RowBtn title="Rename" onClick={() => setPending({ kind: 'rename', path: entry.path, was: entry.name })}>✎</RowBtn>
              <RowBtn
                title={entry.is_dir ? 'Delete this folder and everything in it' : 'Delete this file'}
                danger
                onClick={async () => {
                  // Two clicks, in the row. window.confirm is swallowed in this webview, so a
                  // confirm dialog here would mean the button silently did nothing.
                  if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); return; }
                  try { await invoke('delete_path', { path: entry.path }); setConfirmDel(false); onChanged(); }
                  catch (e) { setErr(String(e)); }
                }}
              >{confirmDel ? 'sure?' : '🗑'}</RowBtn>
            </span>
          </>
        )}
      </div>
      {err && <div style={{ paddingLeft: `${18 + depth * 12}px` }} className="text-[10px] text-red-400 pr-2 py-0.5">{err}</div>}

      {/* The name box for something being created directly inside THIS folder. */}
      {pending?.kind === 'new' && pending.dir === entry.path && (
        <NameBox
          initial={pending.isDir ? '' : ''}
          placeholder={pending.isDir ? 'folder name' : 'file name, e.g. merkletree.js'}
          depth={depth + 1}
          onCancel={() => { setPending(null); setErr(''); }}
          onSubmit={async (name) => {
            try {
              const made = await invoke<string>('create_path', { path: joinPath(pending.dir, name), isDir: pending.isDir });
              setPending(null); setErr('');
              if (!expanded) { await load(); setExpanded(true); }
              onChanged(pending.isDir ? undefined : made);
            } catch (e) { setErr(String(e)); }
          }}
        />
      )}

      {expanded && children.map((c) => (
        <FileNode key={c.path} entry={c} depth={depth + 1} openFile={openFile} onFileOpen={onFileOpen}
          pending={pending} setPending={setPending} onChanged={onChanged} refreshKey={refreshKey} />
      ))}
    </>
  );
}

function RowBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`text-[10px] leading-none px-1 py-0.5 rounded transition-fast ${danger ? 'text-nv-faint hover:text-red-400' : 'text-nv-faint hover:text-accent'}`}
    >{children}</button>
  );
}

/** One inline name field — used for both "new" and "rename" so they behave identically. */
function NameBox({ initial, placeholder, depth, onSubmit, onCancel }: {
  initial: string; placeholder?: string; depth: number;
  onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <input
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { const n = v.trim(); if (n && n !== initial) onSubmit(n); else onCancel(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); const n = v.trim(); if (n) onSubmit(n); else onCancel(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      style={{ marginLeft: `${6 + depth * 12}px` }}
      className="flex-1 min-w-0 mr-1.5 my-[2px] bg-nv-bg border border-accent rounded px-1.5 py-[2px] text-[11px] text-nv-text outline-none"
    />
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
  const [pending, setPending] = useState<Pending>(null);
  const [rootErr, setRootErr] = useState('');
  // Bumped after any create/rename/delete so every open folder re-reads itself.
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRoot = useCallback(() => {
    if (!projectPath) return;
    invoke<FileEntry[]>('list_dir', { path: projectPath })
      .then((list) => setEntries(sortEntries(list)))
      .catch(() => {});
  }, [projectPath]);

  useEffect(() => { loadRoot(); }, [loadRoot, refreshKey]);

  // A file just made is a file you want to be editing — opening it saves the extra click and makes
  // it obvious the creation worked.
  const onChanged = useCallback((created?: string) => {
    setRefreshKey((k) => k + 1);
    if (created) onFileOpen(created);
  }, [onFileOpen]);

  async function openFolder() {
    const p = await invoke<string | null>('open_folder_dialog');
    if (p) onOpenFolder(p);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 h-8 border-b border-nv-border shrink-0">
        <span className="nv-eyebrow text-nv-muted">Explorer</span>
        <div className="flex items-center gap-1.5">
          {projectPath && (
            <>
              <button
                onClick={() => setPending({ kind: 'new', dir: projectPath, isDir: false })}
                title="New file in this folder"
                className="text-nv-faint hover:text-accent transition-fast text-[13px] leading-none"
              >+</button>
              <button
                onClick={() => setPending({ kind: 'new', dir: projectPath, isDir: true })}
                title="New folder"
                className="text-nv-faint hover:text-accent transition-fast text-[11px] leading-none"
              >▤</button>
            </>
          )}
          <button
            onClick={openFolder}
            title="Open a different folder"
            className="text-nv-faint hover:text-accent transition-fast text-[11px] leading-none"
          >⌂</button>
        </div>
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
          <>
            {/* Creating at the top level of the open folder. */}
            {pending?.kind === 'new' && pending.dir === projectPath && (
              <div className="flex items-center">
                <NameBox
                  initial=""
                  placeholder={pending.isDir ? 'folder name' : 'file name, e.g. merkletree.js'}
                  depth={0}
                  onCancel={() => { setPending(null); setRootErr(''); }}
                  onSubmit={async (name) => {
                    try {
                      const made = await invoke<string>('create_path', { path: joinPath(projectPath, name), isDir: pending.isDir });
                      setPending(null); setRootErr('');
                      onChanged(pending.isDir ? undefined : made);
                    } catch (e) { setRootErr(String(e)); }
                  }}
                />
              </div>
            )}
            {rootErr && <div className="text-[10px] text-red-400 px-2 py-0.5">{rootErr}</div>}
            {entries.map((e) => (
              <FileNode key={e.path} entry={e} depth={0} openFile={openFile} onFileOpen={onFileOpen}
                pending={pending} setPending={setPending} onChanged={onChanged} refreshKey={refreshKey} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
