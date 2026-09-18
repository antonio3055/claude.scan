import { useCallback, useRef, useState } from 'react';

/**
 * Per-column pixel widths for a sheet, drag-resizable from a handle on each
 * header cell. One instance per table; `key` in `startResize` is whatever
 * the caller uses to identify a column (a field name is fine).
 */
export function useResizableColumns(defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);
  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const { key, startX, startWidth } = drag.current;
    const next = Math.max(60, startWidth + (e.clientX - startX));
    // Only this column's own width ever changes -- every other column's
    // entry in the map is untouched, so nothing else can shift as a side
    // effect of this drag.
    setWidths((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (drag.current && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
  }, []);

  const startResize = useCallback(
    (key: string) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Captured to the handle itself: the drag keeps tracking this exact
      // column even if the cursor slides off the handle onto a neighboring
      // header while dragging, which is what made it look like a neighbor
      // was being resized too.
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { key, startX: e.clientX, startWidth: widths[key] ?? 140 };
    },
    [widths]
  );

  const reset = useCallback(() => setWidths(defaults), [defaults]);

  return { widths, startResize, onPointerMove, onPointerUp, reset };
}
