import { useState } from 'react';

const DEFAULTS = [
  'Explain this code step by step',
  'Write unit tests for this function',
  'Find and fix bugs in this file',
  'Add TypeScript types throughout',
  'Refactor for readability and clarity',
  'Add proper error handling',
  'Write JSDoc / docstring comments',
  'Optimise this for performance',
  'Convert this to use async/await',
  'Add input validation',
];

const STORAGE_KEY = 'nv-coder-prompts';

function loadCustom(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

interface Props {
  onSelect: (p: string) => void;
  onClose: () => void;
}

export default function PromptLibrary({ onSelect, onClose }: Props) {
  const [custom, setCustom] = useState<string[]>(loadCustom);
  const [draft, setDraft] = useState('');

  function saveCustom(list: string[]) {
    setCustom(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function add() {
    const t = draft.trim();
    if (!t) return;
    saveCustom([...custom, t]);
    setDraft('');
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-10 border-b border-nv-border shrink-0">
        <span className="text-[11px] font-semibold text-nv-text uppercase tracking-wider">
          Prompt Library
        </span>
        <button onClick={onClose} className="text-nv-faint hover:text-nv-text text-xl leading-none transition-fast">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {[...DEFAULTS, ...custom].map((p, i) => (
          <div key={i} className="group flex items-center gap-1">
            <button
              onClick={() => { onSelect(p); onClose(); }}
              className="flex-1 text-left text-[11px] py-1.5 px-2 rounded text-nv-muted
                hover:text-nv-text hover:bg-nv-surface2 transition-fast"
            >
              {p}
            </button>
            {i >= DEFAULTS.length && (
              <button
                onClick={() => saveCustom(custom.filter((_, j) => j !== i - DEFAULTS.length))}
                className="opacity-0 group-hover:opacity-100 text-nv-faint hover:text-nv-red
                  text-[10px] px-1 transition-fast"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-nv-border">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Add custom prompt…"
            className="flex-1 bg-nv-bg border border-nv-border rounded-lg px-2.5 py-1.5
              text-[11px] text-nv-text outline-none focus:border-accent transition-fast"
          />
          <button
            onClick={add}
            className="text-[11px] px-2.5 py-1.5 rounded-lg bg-accent text-white
              hover:bg-accent-dim transition-fast"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
