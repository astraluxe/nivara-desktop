import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import FileTree from '../components/coder/FileTree';
import Editor from '../components/coder/Editor';
import TerminalPanel, { type TerminalHandle } from '../components/coder/Terminal';
import AIChat from '../components/coder/AIChat';
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

export default function CoderModule() {
  const saved = loadState();

  const [projectPath, setProjectPath]   = useState<string>(saved.projectPath ?? '');
  const [openFile, setOpenFile]         = useState<string | null>(saved.openFile ?? null);
  const [fileContent, setFileContent]   = useState('');
  const [chatOpen, setChatOpen]         = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);
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
        const lines = entries.slice(0, 50).map(e => `${e.is_dir ? '📁' : '📄'} ${e.name}`);
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setChatOpen((v) => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); setTerminalOpen((v) => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
        <span className="text-[10px] text-nv-faint font-mono truncate max-w-[200px]">
          {projectPath ? projectPath.split(/[/\\]/).pop() : 'No folder'}
        </span>
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
          >{isProtected(openFile) ? '🔒 Protected' : '🔓 Protect'}</button>
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

        {/* File tree */}
        <div
          className="shrink-0 border-r border-nv-border overflow-hidden flex flex-col bg-nv-surface"
          style={{ width: fileTree.size }}
        >
          <FileTree
            projectPath={projectPath}
            openFile={openFile}
            onFileOpen={setOpenFile}
            onOpenFolder={setProjectPath}
          />
        </div>

        {/* Drag handle: FileTree ↔ Editor */}
        <Divider direction="horizontal" onPointerDown={fileTree.onPointerDown} />

        {/* Centre: Editor + Terminal stacked */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Editor */}
          <div className="flex-1 overflow-hidden min-h-0">
            <Editor
              path={openFile}
              content={fileContent}
              onChange={handleFileChange}
              isDark={true}
            />
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
              <span className="text-nv-yellow text-base">🔒</span>
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
                        <span className="text-nv-yellow text-[11px]">🔒</span>
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
    </div>
  );
}
