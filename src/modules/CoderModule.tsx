import { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import FileTree from '../components/coder/FileTree';
import Editor from '../components/coder/Editor';
import TerminalPanel, { type TerminalHandle } from '../components/coder/Terminal';
import AIChat from '../components/coder/AIChat';
import { useResize } from '../hooks/useResize';

const STORAGE_KEY = 'nv-coder-state';

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

export default function CoderModule() {
  const saved = loadState();

  const [projectPath, setProjectPath] = useState<string>(saved.projectPath ?? '');
  const [openFile, setOpenFile]       = useState<string | null>(saved.openFile ?? null);
  const [fileContent, setFileContent] = useState('');
  const [chatOpen, setChatOpen]       = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(true);

  const terminalRef = useRef<TerminalHandle>(null);

  // Resizable panels — persisted in localStorage
  const fileTree = useResize({ initial: 200, min: 120, max: 420, direction: 'horizontal',               storageKey: 'nv-coder-filetree-w' });
  const terminal = useResize({ initial: 240, min: 80,  max: 560, direction: 'vertical',   invert: true, storageKey: 'nv-coder-terminal-h' });
  const chat     = useResize({ initial: 320, min: 240, max: 560, direction: 'horizontal', invert: true, storageKey: 'nv-coder-chat-w'    });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectPath, openFile }));
  }, [projectPath, openFile]);

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
  function handleInsertAtCursor(text: string) { setFileContent((prev) => prev + '\n' + text); }

  return (
    <div className="flex flex-col h-full bg-nv-bg overflow-hidden">
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
              getTerminalContext={getTerminalContext}
              onRunInTerminal={runInTerminal}
              onInsertAtCursor={handleInsertAtCursor}
            />
          </div>
        )}
      </div>
    </div>
  );
}
