import { useState, useEffect, useCallback } from 'react';
import { fileIcon, labelInk } from '../../lib/fileIcons';
import { invoke } from '@tauri-apps/api/core';
import {
  normPath, folderHasChanges, KIND_LETTER, KIND_LABEL, KIND_CLASS, type ChangeKind,
} from '../../lib/gitStatus';

/**
 * The mark beside a filename saying what happened to it.
 *
 * A single letter, in the colours every developer already reads without being taught: A for added,
 * M for modified, D for deleted. A FOLDER gets a dot rather than a letter — it does not know what
 * changed inside it, only that something did, which is all it needs to say to get you to open it.
 * Without the folder dot a change three levels down is invisible until you happen to expand the
 * right branch, which for files an AGENT chose is most of the time.
 */
function GitMark({ kind, folder }: { kind?: ChangeKind; folder?: boolean }) {
  if (folder) {
    return <span className="shrink-0 w-3 text-center text-amber-500/70 text-[9px] leading-none" title="Something inside this folder changed">●</span>;
  }
  if (!kind || kind === 'none') return null;
  return (
    <span className={`shrink-0 w-3 text-center text-[10px] font-mono font-semibold ${KIND_CLASS[kind]}`}
          title={KIND_LABEL[kind]}>{KIND_LETTER[kind]}</span>
  );
}

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

/**
 * What kind of file this is, at a glance.
 *
 * Every file used to draw the same grey middle-dot — source, image, lock file, spreadsheet, all
 * identical. A file tree is SCANNED rather than read, and there was nothing to scan by.
 *
 * A two-letter chip in the language's own colour is unambiguous at this size in a way a tiny
 * pictogram is not: "TS" cannot be mistaken for anything, whereas a small blue shape can. The
 * colours are the ones people already know from their editor, and the label is knocked out of a
 * filled chip so it stays readable on both themes — see lib/fileIcons.ts.
 */
function FileIcon({ isDir, expanded, name }: { isDir: boolean; expanded?: boolean; name?: string }) {
  if (isDir) {
    // A folder reads as a folder, and the chevron still says open or shut.
    return (
      <span className="inline-flex items-center gap-[3px] text-nv-faint">
        <svg viewBox="0 0 24 24" className="w-[13px] h-[13px]" fill="none" stroke="currentColor"
             strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {expanded
            ? <path d="M3 8h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            : <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}
        </svg>
      </span>
    );
  }
  const spec = fileIcon(name || '');
  return (
    <span
      title={spec.name}
      aria-label={spec.name}
      className="inline-flex items-center justify-center rounded-[3px] font-mono font-bold select-none"
      style={{
        background: spec.colour,
        color: labelInk(spec.colour),
        width: 16, height: 16,
        fontSize: spec.label.length > 2 ? 6.5 : 8,
        lineHeight: 1,
      }}
    >{spec.label}</span>
  );
}

/** What the tree is being asked to make or change. Held in one place so only one row is ever in
 *  edit mode — two open name boxes is how you rename the wrong file. */
type Pending =
  | { kind: 'new'; dir: string; isDir: boolean }
  | { kind: 'rename'; path: string; was: string }
  | null;

function FileNode({
  entry, depth, openFile, onFileOpen, pending, setPending, onChanged, refreshKey, gitMap,
}: {
  entry: FileEntry; depth: number; openFile: string | null;
  /** Normalised path → what happened to it. Empty when the folder is not a git repository. */
  gitMap: Map<string, ChangeKind>;
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
                <FileIcon isDir={entry.is_dir} expanded={expanded} name={entry.name} />
              </span>
              <span className="truncate">{entry.name}</span>
              <GitMark
                kind={entry.is_dir ? undefined : gitMap.get(normPath(entry.path))}
                folder={entry.is_dir && folderHasChanges(entry.path, gitMap)}
              />
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
          pending={pending} setPending={setPending} onChanged={onChanged} refreshKey={refreshKey}
          gitMap={gitMap} />
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
  /** What git says changed. Supplied by CoderModule, which owns the refresh. */
  gitMap?: Map<string, ChangeKind>;
}

/**
 * A toolbar icon button with a real target.
 *
 * The panel used bare "+" and "▤" characters sized 11-13px. A glyph is not an icon — it renders in
 * whatever the font supplies, never lines up with what sits beside it, and gives the pointer
 * nothing to hit. This draws the shape and wraps it in a 24px target, which is the minimum this app
 * holds itself to everywhere else.
 */
function IconBtn({ onClick, title, children }: {
  onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-6 h-6 flex items-center justify-center rounded-nv-sm text-nv-faint
                 hover:text-accent hover:bg-nv-surface2/70 transition-colors duration-fast ease-nv"
    >
      <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor"
           strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

export default function FileTree({ projectPath, openFile, onFileOpen, onOpenFolder, gitMap }: Props) {
  // An empty map is the honest default: not a repository, or git not installed. The tree then draws
  // no marks at all rather than pretending nothing has changed.
  const marks = gitMap ?? new Map<string, ChangeKind>();
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
              {/* Drawn icons, not "+" and "▤" as text. Those rendered in whatever glyph the font
                  happened to carry, at 11-13px, with no hit area of their own — the two things
                  that made this panel read as unfinished next to any real editor. 24px targets. */}
              <IconBtn
                onClick={() => setPending({ kind: 'new', dir: projectPath, isDir: false })}
                title="New file in this folder"
              >
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
                <path d="M12 12v5M9.5 14.5h5" />
              </IconBtn>
              <IconBtn
                onClick={() => setPending({ kind: 'new', dir: projectPath, isDir: true })}
                title="New folder"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M12 11v5M9.5 13.5h5" />
              </IconBtn>
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
                pending={pending} setPending={setPending} onChanged={onChanged} refreshKey={refreshKey}
                gitMap={marks} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
