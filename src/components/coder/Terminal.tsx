import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { useTerminal } from '../../hooks/useTerminal';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  writeCommand: (cmd: string) => void;
  getLastLines: (n?: number) => string;
}

interface Props { cwd: string; }

interface CtxMenu { x: number; y: number; hasSel: boolean; }

const TerminalPanel = forwardRef<TerminalHandle, Props>(({ cwd }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null!);
  const wrapRef      = useRef<HTMLDivElement>(null);
  const {
    writeCommand, getLastLines,
    copySelection, pasteFromClipboard, selectAll, clearTerminal, hasSelection,
  } = useTerminal(containerRef, cwd);

  useImperativeHandle(ref, () => ({ writeCommand, getLastLines }));

  const [menu, setMenu] = useState<CtxMenu | null>(null);

  // Close menu on any outside click or scroll
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close, { capture: true });
    window.addEventListener('keydown',     close, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true });
      window.removeEventListener('keydown',     close, { capture: true });
    };
  }, [menu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    // Clamp so menu doesn't overflow the terminal panel
    const mx = Math.min(e.clientX - rect.left, rect.width  - 160);
    const my = Math.min(e.clientY - rect.top,  rect.height - 140);
    setMenu({ x: Math.max(0, mx), y: Math.max(0, my), hasSel: hasSelection() });
  }

  async function act(fn: () => void | Promise<void>) {
    setMenu(null);
    await fn();
  }

  const SEP = 'sep';
  const items = [
    { label: 'Copy',       icon: '⎘', action: copySelection,    disabled: (m: CtxMenu) => !m.hasSel },
    { label: 'Paste',      icon: '⎗', action: pasteFromClipboard, disabled: () => false },
    SEP,
    { label: 'Select All', icon: '⬚', action: selectAll,        disabled: () => false },
    SEP,
    { label: 'Clear',      icon: '⌫', action: clearTerminal,    disabled: () => false },
  ] as const;

  return (
    <div ref={wrapRef} className="flex flex-col h-full bg-[#09090b] relative">
      {/* Traffic-light bar */}
      <div className="flex items-center gap-1.5 px-4 h-8 border-b border-nv-border shrink-0 select-none">
        <span className="w-2.5 h-2.5 rounded-full bg-nv-red/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-nv-yellow/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-nv-green/60" />
        <span className="ml-2 text-nv-faint text-[10px] font-mono truncate">
          terminal · {cwd || '~'}
        </span>
      </div>

      {/* xterm container — right-click opens custom menu */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{ padding: '4px 2px' }}
        onContextMenu={handleContextMenu}
      />

      {/* Custom context menu */}
      {menu && (
        <div
          className="absolute z-50 min-w-[148px] py-1 rounded-lg
            bg-nv-surface border border-nv-border shadow-2xl
            text-[12px] text-nv-text"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {items.map((item, i) => {
            if (item === SEP) {
              return <div key={i} className="my-1 border-t border-nv-border/60" />;
            }
            const disabled = item.disabled(menu);
            return (
              <button
                key={item.label}
                onClick={() => !disabled && act(item.action)}
                disabled={disabled}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-fast
                  ${disabled
                    ? 'text-nv-faint cursor-default'
                    : 'hover:bg-accent/10 hover:text-accent cursor-pointer'}
                `}
              >
                <span className="w-3.5 text-center text-[11px] opacity-60">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

TerminalPanel.displayName = 'TerminalPanel';
export default TerminalPanel;
