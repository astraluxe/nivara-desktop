import { useEffect, useRef, useCallback, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export function useTerminal(containerRef: RefObject<HTMLDivElement>, cwd: string) {
  const termRef    = useRef<Terminal | null>(null);
  const fitRef     = useRef<FitAddon | null>(null);
  const ptyIdRef   = useRef<number | null>(null);
  const bufferRef  = useRef<string[]>([]);

  const getLastLines = useCallback((n = 20) =>
    bufferRef.current.slice(-n).join(''), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      allowTransparency: true,
      theme: {
        background:         '#09090b',
        foreground:         '#e4e4e7',
        cursor:             '#7C5CFF',
        cursorAccent:       '#09090b',
        selectionBackground:'rgba(124,92,255,0.3)',
        black:  '#09090b', red:     '#ef4444',
        green:  '#22c55e', yellow:  '#eab308',
        blue:   '#3b82f6', magenta: '#a855f7',
        cyan:   '#06b6d4', white:   '#e4e4e7',
        brightBlack: '#3f3f46', brightWhite: '#fafafa',
      },
    });

    const fit  = new FitAddon();
    const webl = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(webl);
    term.open(el);
    fit.fit();
    termRef.current = term;
    fitRef.current  = fit;

    let unlistenData: (() => void) | null = null;

    invoke<number>('pty_spawn', { cwd: cwd || '.', cols: term.cols, rows: term.rows })
      .then(async (id) => {
        ptyIdRef.current = id;
        const unlisten = await listen<[number, string]>('pty-data', (e) => {
          const [ptId, data] = e.payload;
          if (ptId !== id) return;
          term.write(data);
          bufferRef.current.push(data);
          if (bufferRef.current.length > 300) bufferRef.current.splice(0, 100);
        });
        unlistenData = unlisten;
      })
      .catch((e) => term.write(`\r\n\x1b[31m[adris.tech] PTY error: ${e}\x1b[0m\r\n`));

    term.onData((data) => {
      if (ptyIdRef.current !== null)
        invoke('pty_write', { id: ptyIdRef.current, data });
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ptyIdRef.current !== null)
        invoke('pty_resize', { id: ptyIdRef.current, cols: term.cols, rows: term.rows });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      unlistenData?.();
      if (ptyIdRef.current !== null) invoke('pty_kill', { id: ptyIdRef.current }).catch(() => {});
      term.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  const writeCommand = useCallback((cmd: string) => {
    if (ptyIdRef.current !== null)
      invoke('pty_write', { id: ptyIdRef.current, data: cmd + '\r' });
  }, []);

  const copySelection = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) navigator.clipboard.writeText(sel).catch(() => {});
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && ptyIdRef.current !== null)
        invoke('pty_write', { id: ptyIdRef.current, data: text });
    } catch { /* clipboard access denied */ }
  }, []);

  const selectAll = useCallback(() => { termRef.current?.selectAll(); }, []);

  const clearTerminal = useCallback(() => { termRef.current?.clear(); }, []);

  const hasSelection = useCallback(() => !!(termRef.current?.getSelection()), []);

  return { writeCommand, getLastLines, copySelection, pasteFromClipboard, selectAll, clearTerminal, hasSelection };
}
