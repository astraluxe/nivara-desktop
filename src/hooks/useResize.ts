import { useState, useEffect, useRef, useCallback } from 'react';

interface UseResizeOptions {
  initial: number;
  min: number;
  max: number;
  direction: 'horizontal' | 'vertical';
  /** Invert delta — use for right-side or bottom panels where dragging "inward" grows them */
  invert?: boolean;
  storageKey?: string;
}

export function useResize({ initial, min, max, direction, invert = false, storageKey }: UseResizeOptions) {
  const [size, setSize] = useState<number>(() => {
    if (storageKey) {
      const v = Number(localStorage.getItem(storageKey));
      if (v >= min && v <= max) return v;
    }
    return initial;
  });

  const dragging  = useRef(false);
  const startPos  = useRef(0);
  const startSize = useRef(0);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(size));
  }, [size, storageKey]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current  = true;
    startPos.current  = direction === 'horizontal' ? e.clientX : e.clientY;
    startSize.current = size;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [direction, size]);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (!dragging.current) return;
      const pos   = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = invert ? startPos.current - pos : pos - startPos.current;
      setSize(Math.min(max, Math.max(min, startSize.current + delta)));
    }
    function onPointerUp() { dragging.current = false; }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup',   onPointerUp);
    };
  }, [direction, invert, min, max]);

  return { size, onPointerDown };
}
