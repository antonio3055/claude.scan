import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'forge.scanner.panelWidths.v2';

interface PanelWidths {
  left: number;
  middle: number;
}

const DEFAULTS: PanelWidths = { left: 360, middle: 520 };

function load(): PanelWidths {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { ...DEFAULTS, ...(parsed || {}) };
  } catch {
    return DEFAULTS;
  }
}

export function useResizablePanels() {
  const [widths, setWidths] = useState<PanelWidths>(load);
  const drag = useRef<{ side: 'left' | 'middle'; startX: number; startLeft: number; startMiddle: number } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(widths)); } catch { /* non-fatal */ }
  }, [widths]);

  const onPointerDown = useCallback((side: 'left' | 'middle', event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { side, startX: event.clientX, startLeft: widths.left, startMiddle: widths.middle };
  }, [widths]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!drag.current) return;
    const delta = event.clientX - drag.current.startX;
    if (drag.current.side === 'left') {
      setWidths((prev) => ({ ...prev, left: Math.max(290, Math.min(620, drag.current!.startLeft + delta)) }));
    } else {
      setWidths((prev) => ({ ...prev, middle: Math.max(360, Math.min(820, drag.current!.startMiddle + delta)) }));
    }
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (drag.current) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }, []);

  const reset = useCallback(() => setWidths(DEFAULTS), []);

  return { widths, onPointerDown, onPointerMove, onPointerUp, reset };
}
