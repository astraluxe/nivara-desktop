import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import { useRef, useEffect } from 'react';

interface Props {
  path: string | null;
  content: string;
  onChange: (val: string) => void;
  isDark: boolean;
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  c: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby',
  css: 'css', scss: 'scss', html: 'html', json: 'json',
  md: 'markdown', sh: 'shell', bash: 'shell',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql',
  xml: 'xml', svelte: 'html',
};

function langFromPath(p: string | null) {
  if (!p) return 'plaintext';
  return EXT_LANG[p.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';
}

export default function Editor({ path, content, onChange, isDark }: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.focus();
  };

  // Push EXTERNAL content changes (e.g. an AI-applied edit) into the live editor. Monaco's `value`
  // prop alone did not reliably re-render the open file — the change only appeared after switching
  // screens (which re-reads from disk on remount). This guarantees applied edits show immediately.
  // The `getValue() !== content` guard means this never fights the user's own typing (their text is
  // already === content), so the cursor/undo stack is preserved while typing.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.getValue() === content) return;
    const pos = ed.getPosition();
    ed.setValue(content);
    if (pos) ed.setPosition(pos);
  }, [content]);

  if (!path) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 bg-nv-bg select-none">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-nv-faint opacity-40">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3 9h18M9 21V9" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
        <p className="text-nv-faint text-xs">Select a file to edit</p>
      </div>
    );
  }

  return (
    <MonacoEditor
      height="100%"
      path={path ?? undefined}
      language={langFromPath(path)}
      value={content}
      theme={isDark ? 'vs-dark' : 'vs'}
      onMount={handleMount}
      onChange={(v) => onChange(v ?? '')}
      options={{
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        renderWhitespace: 'none',
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 10, bottom: 10 },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
      }}
    />
  );
}
