import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Icon from '../components/Icon';
import { invoke } from '@tauri-apps/api/core';
import FileTree from '../components/coder/FileTree';
import Editor from '../components/coder/Editor';
import TerminalPanel, { type TerminalHandle } from '../components/coder/Terminal';
import AIChat from '../components/coder/AIChat';
import QuickOpen, { type PaletteMode } from '../components/coder/QuickOpen';
import DiffView from '../components/coder/DiffView';
import { statusMap, changeCount, normPath, type GitStatus, type ChangeKind } from '../lib/gitStatus';
import { useResize } from '../hooks/useResize';

interface FileEntry { name: string; path: string; is_dir: boolean; }

const STORAGE_KEY    = 'nv-coder-state';
const PROTECTED_KEY  = 'nv-coder-protected';
const AUDIT_KEY      = 'nv-coder-audit';

interface AuditEntry {
  ts:      number;
  path:    string;
  action:  'applied' | 'allowed' | 'blocked';
  prevLen: number;
  newLen:  number;
}

function shortName(p: string): string { return p.split(/[/\\]/).pop() ?? p; }

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); }
  catch { return {}; }
}

// Thin draggable divider — horizontal (between columns) or vertical (between rows)
function Divider({ direction, onPointerDown }: {
  direction: 'horizontal' | 'vertical';
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const isH = direction === 'horizontal';
  return (
    <div
      onPointerDown={onPointerDown}
      className={`
        group shrink-0 relative flex items-center justify-center
        ${isH
          ? 'w-[5px] cursor-col-resize hover:w-[5px]'
          : 'h-[5px] cursor-row-resize hover:h-[5px]'}
        bg-nv-border/30 hover:bg-accent/40 transition-colors select-none z-10
      `}
      style={isH ? { minWidth: 5 } : { minHeight: 5 }}
    >
      {/* visual grip dots */}
      <div className={`
        flex gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity
        ${isH ? 'flex-col' : 'flex-row'}
      `}>
        {[0,1,2].map((i) => (
          <span key={i} className="w-[3px] h-[3px] rounded-full bg-accent/70" />
        ))}
      </div>
    </div>
  );
}

// Compare two file paths tolerant of OS/format differences: backslash vs forward slash, trailing
// slash, Windows case-insensitivity, and absolute-vs-relative (one ending with the other).
function samePath(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const na = norm(a), nb = norm(b);
  return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}

/** One icon on the activity bar: a real 32px target, titled and labelled. */
function ActivityButton(
  { label, active, onClick, children }:
  { label: string; active?: boolean; onClick: () => void; children: React.ReactNode },
) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={!!active}
      className={`w-8 h-8 rounded-nv-sm flex items-center justify-center transition-colors duration-fast
                  ${active ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30'
                           : 'text-nv-faint hover:text-nv-text hover:bg-nv-surface2'}`}
    >
      <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export default function CoderModule() {
  const saved = loadState();

  const [projectPath, setProjectPath]   = useState<string>(saved.projectPath ?? '');
  const [openFile, setOpenFile]         = useState<string | null>(saved.openFile ?? null);
  const [fileContent, setFileContent]   = useState('');
  const [chatOpen, setChatOpen]         = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
  /** The file tree can be put away, the way every editor lets you. */
  const [treeOpen, setTreeOpen] = useState(true);
  const [dirContext, setDirContext]      = useState('');
  const [fileHistory, setFileHistory]   = useState<{ path: string; content: string }[]>([]);

  // ── Protected files + AI edit audit log ──────────────────────────────────────
  const [protectedFiles, setProtectedFiles] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(PROTECTED_KEY) ?? '[]'); } catch { return []; }
  });
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(AUDIT_KEY) ?? '[]'); } catch { return []; }
  });
  const [pendingEdit, setPendingEdit] = useState<{ path: string; code: string; prev: string } | null>(null);
  const [showAudit,   setShowAudit]   = useState(false);

  useEffect(() => { localStorage.setItem(PROTECTED_KEY, JSON.stringify(protectedFiles)); }, [protectedFiles]);
  useEffect(() => { localStorage.setItem(AUDIT_KEY, JSON.stringify(auditLog.slice(-200))); }, [auditLog]);

  const logAudit = useCallback((e: AuditEntry) => setAuditLog((l) => [...l.slice(-199), e]), []);
  const isProtected = (p: string | null) => !!p && protectedFiles.includes(p);
  function toggleProtect(path: string) {
    setProtectedFiles((p) => p.includes(path) ? p.filter((x) => x !== path) : [...p, path]);
  }

  const terminalRef = useRef<TerminalHandle>(null);

  // Resizable panels — persisted in localStorage
  const fileTree = useResize({ initial: 200, min: 120, max: 420, direction: 'horizontal',               storageKey: 'nv-coder-filetree-w' });
  const terminal = useResize({ initial: 240, min: 80,  max: 560, direction: 'vertical',   invert: true, storageKey: 'nv-coder-terminal-h' });
  const chat     = useResize({ initial: 320, min: 240, max: 560, direction: 'horizontal', invert: true, storageKey: 'nv-coder-chat-w'    });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectPath, openFile }));
  }, [projectPath, openFile]);

  useEffect(() => {
    if (!projectPath) { setDirContext(''); return; }
    async function buildDirContext() {
      try {
        const entries = await invoke<FileEntry[]>('list_dir', { path: projectPath });
        const lines = entries.slice(0, 50).map(e => `${e.is_dir ? '[dir]' : '[file]'} ${e.name}`);
        if (entries.length > 50) lines.push(`… and ${entries.length - 50} more`);
        setDirContext(lines.join('\n'));
      } catch { setDirContext(''); }
    }
    buildDirContext();
  }, [projectPath]);

  useEffect(() => {
    if (!openFile) { setFileContent(''); return; }
    invoke<string>('read_file', { path: openFile })
      .then(setFileContent)
      .catch(() => setFileContent(''));
  }, [openFile]);

  // ── Open editors, as tabs ────────────────────────────────────────────────────
  // One file at a time is the single biggest thing that made this not feel like an editor: opening
  // a second file lost the first, and going back meant finding it in the tree again. The tab strip
  // is just the list of paths you have open; `openFile` stays the one source of truth for which is
  // showing, so nothing downstream (the AI chat's "current file", protect, revert) changes at all.
  const [openTabs, setOpenTabs] = useState<string[]>(() => (saved.openFile ? [saved.openFile] : []));
  useEffect(() => {
    if (!openFile) return;
    setOpenTabs((t) => (t.includes(openFile) ? t : [...t, openFile]));
  }, [openFile]);
  const closeTab = useCallback((path: string) => {
    setOpenTabs((t) => {
      const next = t.filter((p) => p !== path);
      // Closing the file you are looking at lands you on its neighbour, not on a blank editor.
      if (path === openFile) {
        const i = t.indexOf(path);
        setOpenFile(next[Math.min(i, next.length - 1)] ?? null);
      }
      return next;
    });
  }, [openFile]);

  // ── Quick Open / Find in Files ───────────────────────────────────────────────
  const [palette, setPalette] = useState<PaletteMode | null>(null);

  // ── WHAT THE AGENT CHANGED ────────────────────────────────────────────────
  //
  // The only question anyone asks after an agent edits four files, and until now it could only be
  // answered by leaving the app and running git in a terminal.
  //
  // Refreshed on opening a folder, on Ctrl+S, and on demand — NOT on a timer. A poll would run git
  // every few seconds forever on a folder nobody is looking at, and the answer only changes when
  // something writes a file.
  const [git, setGit] = useState<GitStatus | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const refreshGit = useCallback(() => {
    if (!projectPath) { setGit(null); return; }
    invoke<string>('git_status', { path: projectPath })
      .then((raw) => setGit(JSON.parse(raw) as GitStatus))
      // Not a repository and no git are both ANSWERS, handled inside the command. A throw here is
      // something else, and the tree simply shows no marks rather than an error nobody can act on.
      .catch(() => setGit(null));
  }, [projectPath]);
  useEffect(() => { refreshGit(); }, [refreshGit]);
  const gitMap = useMemo<Map<string, ChangeKind>>(() => statusMap(git), [git]);
  // Switching file closes the diff: it belongs to the file it was opened for, and leaving it up
  // would show one file's changes under another file's name.
  useEffect(() => { setShowDiff(false); }, [openFile]);
  const [gotoLine, setGotoLine] = useState<number | undefined>(undefined);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setChatOpen((v) => !v); }
      else if (e.key === '`') { e.preventDefault(); setTerminalOpen((v) => !v); }
      // Ctrl+Shift+F before Ctrl+P/F so the shifted one is not swallowed by the plain one.
      else if (e.shiftKey && k === 'f') { e.preventDefault(); setPalette('search'); }
      else if (!e.shiftKey && k === 'p') { e.preventDefault(); setPalette('files'); }
      else if (!e.shiftKey && k === 'w' && openFile) { e.preventDefault(); closeTab(openFile); }
      else if (!e.shiftKey && k === 's') {
        // Edits already write through on every change, so there is nothing to flush — but Ctrl+S is
        // muscle memory, and a browser "save page" dialog appearing over the editor is alarming.
        // Swallow it and show that the file is safe.
        e.preventDefault();
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openFile, closeTab]);
  const [savedFlash, setSavedFlash] = useState(false);
  // A file the editor just wrote is a file whose status just changed. Declared here rather than
  // with the rest of the git state because savedFlash is defined at this point and not before.
  useEffect(() => { if (savedFlash) refreshGit(); }, [savedFlash, refreshGit]);

  function handleFileChange(content: string) {
    setFileContent(content);
    if (openFile) invoke('write_file', { path: openFile, content }).catch(() => {});
  }

  const getTerminalContext = useCallback(() => terminalRef.current?.getLastLines(20) ?? '', []);
  const runInTerminal      = useCallback((cmd: string) => { terminalRef.current?.writeCommand(cmd); }, []);

  function handleInsertAtCursor(text: string) {
    setFileHistory((prev) => {
      const snap = { path: openFile ?? '', content: fileContent };
      return [...prev.slice(-9), snap];
    });
    const newContent = fileContent + '\n' + text;
    setFileContent(newContent);
    if (openFile) invoke('write_file', { path: openFile, content: newContent }).catch(() => {});
  }

  function handleRevert() {
    setFileHistory((prev) => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setFileContent(snap.content);
      if (snap.path) invoke('write_file', { path: snap.path, content: snap.content }).catch(() => {});
      return prev.slice(0, -1);
    });
  }

  // AI applied a code block to a file — snapshot the CURRENT content first so it can
  // be reverted, then write the new content and refresh the editor if it's the open file.
  // Protected files are NOT written automatically — they are held for explicit approval.
  async function writeEdit(path: string, code: string, prev: string, action: AuditEntry['action']) {
    setFileHistory((h) => [...h.slice(-9), { path, content: prev }]);
    await invoke('write_file', { path, content: code }).catch(() => {});
    // Refresh the editor LIVE if this is the open file. Normalise the comparison so a backslash vs
    // forward-slash / trailing-slash / Windows case difference between the AI's path and openFile
    // can't stop the update (which is what made applied edits only show after switching screens).
    if (samePath(path, openFile)) setFileContent(code);
    logAudit({ ts: Date.now(), path, action, prevLen: prev.length, newLen: code.length });
  }

  async function handleApplyFromAI(path: string, code: string) {
    const prev = await invoke<string>('read_file', { path })
      .catch(() => (path === openFile ? fileContent : ''));
    if (isProtected(path)) {
      // Hold the write — the user marked this file protected and must approve.
      setPendingEdit({ path, code, prev });
      return;
    }
    await writeEdit(path, code, prev, 'applied');
  }

  async function resolvePendingEdit(allow: boolean) {
    const p = pendingEdit;
    if (!p) return;
    setPendingEdit(null);
    if (allow) await writeEdit(p.path, p.code, p.prev, 'allowed');
    else logAudit({ ts: Date.now(), path: p.path, action: 'blocked', prevLen: p.prev.length, newLen: p.code.length });
  }

  return (
    <div className="relative flex flex-col h-full bg-nv-bg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 h-9 border-b border-nv-border bg-nv-surface shrink-0 select-none">
        {/* The folder was a dead label. Once one was open there was no way to switch to another or
            to get back to an empty editor — the only route out was restarting the app. It is a
            button now, with the close beside it. */}
        <button
          onClick={async () => {
            const p = await invoke<string | null>('open_folder_dialog');
            if (p) setProjectPath(p);
          }}
          title={projectPath ? `${projectPath}\n\nClick to open a different folder` : 'Open a folder'}
          className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-nv-sm text-[11px] font-mono
                     text-nv-muted hover:text-nv-text hover:bg-nv-surface2/70
                     transition-colors duration-fast ease-nv truncate max-w-[240px]"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-nv-faint" fill="none"
               stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span className="truncate">{projectPath ? projectPath.split(/[/\\]/).pop() : 'Open a folder'}</span>
        </button>
        {projectPath && (
          <button
            onClick={() => { setProjectPath(''); setOpenFile(null); }}
            title="Close this folder"
            aria-label="Close folder"
            className="w-5 h-5 flex items-center justify-center rounded-nv-sm text-nv-faint
                       hover:text-nv-text hover:bg-nv-surface2/70 transition-colors duration-fast ease-nv"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor"
                 strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
        {openFile && (
          <>
            <span className="text-nv-border">›</span>
            <span className="text-[10px] text-nv-muted font-mono truncate">
              {openFile.split(/[/\\]/).pop()}
            </span>
          </>
        )}
        <div className="flex-1" />
        {openFile && (
          <button
            onClick={() => toggleProtect(openFile)}
            title={isProtected(openFile)
              ? 'Protected — the AI must ask before editing this file. Click to unprotect.'
              : 'Protect this file — the AI cannot change it without your approval.'}
            className={`text-[10px] px-2 py-0.5 rounded border transition-fast ${
              isProtected(openFile)
                ? 'border-nv-yellow/50 text-nv-yellow'
                : 'border-nv-border text-nv-faint hover:text-nv-muted'
            }`}
          >{isProtected(openFile) ? 'Protected' : 'Protect'}</button>
        )}
        <button
          onClick={() => setShowAudit(true)}
          title="AI edit history (what the AI changed)"
          className="text-[10px] px-2 py-0.5 rounded border border-nv-border text-nv-faint hover:text-nv-muted transition-fast"
        >History{auditLog.length ? ` · ${auditLog.length}` : ''}</button>
        {fileHistory.length > 0 && (
          <button
            onClick={handleRevert}
            title={`Revert last change (${fileHistory.length} snapshot${fileHistory.length > 1 ? 's' : ''} available)`}
            className="text-[10px] px-2 py-0.5 rounded border border-nv-red/40 text-nv-red/70 hover:border-nv-red hover:text-nv-red transition-fast"
          >↩ Revert</button>
        )}
        <button
          onClick={() => setTerminalOpen((v) => !v)}
          title="Toggle terminal (Ctrl+`)"
          className={`text-[10px] px-2 py-0.5 rounded border transition-fast
            ${terminalOpen ? 'border-accent/50 text-accent' : 'border-nv-border text-nv-faint hover:text-nv-muted'}`}
        >Terminal</button>
        <button
          onClick={() => setChatOpen((v) => !v)}
          title="Toggle AI (Ctrl+K)"
          className={`text-[10px] px-2 py-0.5 rounded border transition-fast
            ${chatOpen ? 'border-accent/50 text-accent' : 'border-nv-border text-nv-faint hover:text-nv-muted'}`}
        >AI  Ctrl+K</button>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── THE ACTIVITY BAR ──────────────────────────────────────────────
            The strip down the left edge that every code editor has. It is most of what makes a
            screen read as an editor rather than as a file browser with a text box, and it gives the
            three panels one fixed place to be reached from. Every icon is drawn, titled and
            labelled — a glyph character in a font we do not control is not an icon. */}
        <div className="w-11 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-nv-border bg-nv-surface">
          <ActivityButton label="Files" active={treeOpen} onClick={() => setTreeOpen((v) => !v)}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </ActivityButton>
          <ActivityButton label="Find a file  (Ctrl+P)" onClick={() => setPalette('files')}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </ActivityButton>
          <ActivityButton label="Search in files  (Ctrl+Shift+F)" onClick={() => setPalette('search')}>
            <path d="M4 6h16M4 12h10M4 18h7" />
          </ActivityButton>
          <ActivityButton label="Terminal  (Ctrl+`)" active={terminalOpen} onClick={() => setTerminalOpen((v) => !v)}>
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" />
          </ActivityButton>
          <ActivityButton label="Ask about this code" active={chatOpen} onClick={() => setChatOpen((v) => !v)}>
            <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
          </ActivityButton>
        </div>

        {/* File tree */}
        <div
          className="shrink-0 border-r border-nv-border overflow-hidden flex flex-col bg-nv-surface"
          style={{ width: treeOpen ? fileTree.size : 0, borderRightWidth: treeOpen ? undefined : 0 }}
        >
          <FileTree
            projectPath={projectPath}
            openFile={openFile}
            onFileOpen={setOpenFile}
            onOpenFolder={setProjectPath}
            gitMap={gitMap}
          />
        </div>

        {/* Drag handle: FileTree ↔ Editor */}
        <Divider direction="horizontal" onPointerDown={fileTree.onPointerDown} />

        {/* Centre: Editor + Terminal stacked */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Open editors. Middle-click closes, as everywhere else. */}
          {openTabs.length > 0 && (
            <div className="flex items-stretch h-7 shrink-0 border-b border-nv-border bg-nv-surface overflow-x-auto">
              {openTabs.map((p) => {
                const active = samePath(p, openFile);
                return (
                  <div
                    key={p}
                    onClick={() => setOpenFile(p)}
                    onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(p); } }}
                    title={p}
                    className={`group flex items-center gap-1.5 pl-2.5 pr-1.5 cursor-pointer border-r border-nv-border text-[11px] whitespace-nowrap transition-fast
                      ${active ? 'bg-nv-bg text-nv-text border-b-[1.5px] border-b-accent' : 'text-nv-faint hover:text-nv-muted hover:bg-nv-surface2'}`}
                  >
                    <span className="truncate max-w-[160px]">{p.split(/[/\\]/).pop()}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(p); }}
                      title="Close (Ctrl+W)"
                      className="text-[11px] leading-none px-0.5 rounded opacity-0 group-hover:opacity-100 hover:text-red-400 transition-fast"
                    >×</button>
                  </div>
                );
              })}
              {savedFlash && <span className="self-center ml-2 text-[10px] text-emerald-500 shrink-0">✓ saved</span>}
              <div className="flex-1" />
              {/* Only offered when there is something to see. A "Changes" button on a file with no
                  changes is a button that lies about there being changes. */}
              {openFile && gitMap.has(normPath(openFile)) && (
                <button
                  onClick={() => setShowDiff((v) => !v)}
                  title={showDiff ? 'Back to the file' : 'See what changed in this file'}
                  className={`self-center mr-2 shrink-0 text-[10px] px-2 py-0.5 rounded-full transition-fast
                    ${showDiff ? 'bg-accent/15 text-accent' : 'text-nv-faint hover:text-accent hover:bg-nv-surface2'}`}
                >{showDiff ? 'File' : 'Changes'}</button>
              )}
              {git?.ok && changeCount(git) > 0 && (
                <span className="self-center mr-2 text-[9.5px] text-nv-faint shrink-0"
                      title={`${changeCount(git)} changed file${changeCount(git) === 1 ? '' : 's'} on ${git.branch}`}>
                  {git.branch} · {changeCount(git)}
                </span>
              )}
            </div>
          )}
          {/* Editor, or the diff for the same file. ONE pane, not two — Coder's editor already
              shares this window with a tree, a chat and a terminal, and side-by-side would halve
              what is left of it. The question being answered is "what changed", not "let me merge
              this by hand", and the file itself is one click away for that. */}
          <div className="flex-1 overflow-hidden min-h-0">
            {showDiff && openFile && projectPath ? (
              <DiffView projectPath={projectPath} file={openFile} onClose={() => setShowDiff(false)} />
            ) : (
              <Editor
                path={openFile}
                content={fileContent}
                onChange={handleFileChange}
                isDark={true}
                gotoLine={gotoLine}
              />
            )}
          </div>

          {/* Drag handle: Editor ↔ Terminal */}
          {terminalOpen && (
            <Divider direction="vertical" onPointerDown={terminal.onPointerDown} />
          )}

          {/* Terminal */}
          {terminalOpen && (
            <div className="shrink-0 overflow-hidden" style={{ height: terminal.size }}>
              <TerminalPanel ref={terminalRef} cwd={projectPath} />
            </div>
          )}
        </div>

        {/* Drag handle: Editor ↔ AI Chat */}
        {chatOpen && (
          <Divider direction="horizontal" onPointerDown={chat.onPointerDown} />
        )}

        {/* AI chat panel */}
        {chatOpen && (
          <div
            className="shrink-0 overflow-hidden flex flex-col bg-nv-surface"
            style={{ width: chat.size }}
          >
            <AIChat
              projectPath={projectPath}
              currentFileContent={fileContent}
              currentFilePath={openFile}
              dirContext={dirContext}
              getTerminalContext={getTerminalContext}
              onRunInTerminal={runInTerminal}
              onInsertAtCursor={handleInsertAtCursor}
              onApplyToFile={handleApplyFromAI}
              onRevert={handleRevert}
              canRevert={fileHistory.length > 0}
              protectedFiles={protectedFiles}
            />
          </div>
        )}
      </div>

      {/* Protected-file approval modal */}
      {pendingEdit && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => resolvePendingEdit(false)}>
          <div className="bg-nv-surface border border-nv-yellow/40 rounded-xl w-[460px] max-w-[90%] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Icon name="shield" size={15} className="text-nv-yellow" />
              <h3 className="text-[13px] font-semibold text-nv-text">Approve change to a protected file?</h3>
            </div>
            <p className="text-[11px] text-nv-muted leading-relaxed mb-1">
              The AI wants to overwrite <span className="font-mono text-nv-text">{shortName(pendingEdit.path)}</span>, which you marked as protected.
            </p>
            <p className="text-[10px] text-nv-faint font-mono mb-3 break-all">{pendingEdit.path}</p>
            <p className="text-[10px] text-nv-faint mb-4">
              {pendingEdit.prev.length.toLocaleString()} chars → {pendingEdit.code.length.toLocaleString()} chars.
              This change is reverted-safe (a snapshot is kept if you allow it).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => resolvePendingEdit(false)} className="text-[11px] px-3 py-1.5 rounded-lg border border-nv-border text-nv-muted hover:text-nv-text transition-fast">Block</button>
              <button onClick={() => resolvePendingEdit(true)} className="text-[11px] px-3 py-1.5 rounded-lg bg-nv-yellow/90 text-black font-medium hover:bg-nv-yellow transition-fast">Allow this change</button>
            </div>
          </div>
        </div>
      )}

      {/* AI edit history + protected-files manager */}
      {showAudit && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAudit(false)}>
          <div className="bg-nv-surface border border-nv-border rounded-xl w-[560px] max-w-[92%] max-h-[80%] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 h-12 border-b border-nv-border shrink-0">
              <h3 className="text-[13px] font-semibold text-nv-text">AI edit history</h3>
              <button onClick={() => setShowAudit(false)} className="text-nv-faint hover:text-nv-text text-lg">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {protectedFiles.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono text-nv-faint uppercase tracking-widest mb-1.5">Protected files · {protectedFiles.length}</p>
                  <div className="flex flex-col gap-1">
                    {protectedFiles.map((p) => (
                      <div key={p} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-nv-bg border border-nv-border">
                        <Icon name="shield" size={11} className="text-nv-yellow" />
                        <span className="text-[11px] text-nv-text font-mono truncate flex-1" title={p}>{p}</span>
                        <button onClick={() => toggleProtect(p)} className="text-[10px] px-2 py-0.5 rounded border border-nv-border text-nv-muted hover:border-nv-red hover:text-nv-red transition-fast shrink-0">Unprotect</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-mono text-nv-faint uppercase tracking-widest">Changes · {auditLog.length}</p>
                  {auditLog.length > 0 && (
                    <button onClick={() => setAuditLog([])} className="text-[10px] font-mono text-nv-muted hover:text-nv-red transition-fast">Clear</button>
                  )}
                </div>
                {auditLog.length === 0 ? (
                  <p className="text-[11px] text-nv-faint">No AI edits recorded yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {[...auditLog].reverse().map((e, i) => (
                      <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-nv-bg border border-nv-border text-[11px]">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                          e.action === 'blocked' ? 'bg-nv-red/15 text-nv-red'
                          : e.action === 'allowed' ? 'bg-nv-yellow/15 text-nv-yellow'
                          : 'bg-nv-green/15 text-nv-green'
                        }`}>{e.action}</span>
                        <span className="text-nv-text font-mono truncate flex-1" title={e.path}>{shortName(e.path)}</span>
                        <span className="text-nv-faint shrink-0">{e.prevLen.toLocaleString()}→{e.newLen.toLocaleString()}</span>
                        <span className="text-nv-faint shrink-0 w-[52px] text-right">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ctrl+P / Ctrl+Shift+F. Opening a hit adds it to the tabs like any other file; the line
          number rides along so a search result lands where the match actually is. */}
      {palette && projectPath && (
        <QuickOpen
          mode={palette}
          projectPath={projectPath}
          onClose={() => setPalette(null)}
          onOpen={(p, line) => { setOpenFile(p); setGotoLine(line); }}
        />
      )}
      {/* ── THE STATUS BAR ────────────────────────────────────────────────
          One line saying where you are: the folder, the open file, and whether the terminal and the
          assistant are up. It sits at the bottom because it is glanced at, never read. */}
      <div className="h-6 shrink-0 flex items-center gap-3 px-3 border-t border-nv-border bg-nv-surface
                      text-[10px] font-mono text-nv-faint select-none">
        <span className="truncate max-w-[220px]" title={projectPath || 'No folder open'}>
          {projectPath ? projectPath.split(/[\\/]/).filter(Boolean).slice(-1)[0] : 'No folder open'}
        </span>
        {openFile && (
          <span className="truncate max-w-[260px] text-nv-muted" title={openFile}>
            {openFile.split(/[\\/]/).filter(Boolean).slice(-1)[0]}
          </span>
        )}
        <span className="flex-1" />
        <span>{terminalOpen ? 'Terminal' : 'Terminal off'}</span>
        <span>{chatOpen ? 'Assistant' : 'Assistant off'}</span>
      </div>
    </div>
  );
}