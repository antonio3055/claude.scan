import { useCallback, useRef, useState } from 'react';

/**
 * Native HTML5 drag-and-drop to reorder columns. Dropping a header onto
 * another moves it to that position; everything else keeps its relative
 * order. Kept separate from useResizableColumns -- resizing is a pointer
 * drag on a small handle, reordering is a native drag on the header itself,
 * and the two must never fight over the same gesture.
 */
export function useColumnOrder(defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(defaultOrder);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);

  const onDragStart = useCallback(
    (key: string) => (e: React.DragEvent) => {
      dragKey.current = key;
      setDraggingKey(key);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', key);
    },
    []
  );

  const onDragOver = useCallback(
    (key: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragKey.current;
      if (!from || from === key) return;
      setOrder((prev) => {
        const fromIdx = prev.indexOf(from);
        const toIdx = prev.indexOf(key);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
        const next = [...prev];
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, from);
        return next;
      });
    },
    []
  );

  const onDragEnd = useCallback(() => {
    dragKey.current = null;
    setDraggingKey(null);
  }, []);

  /** Any newly-appeared column (e.g. a column turned back on) is appended once, at the end. */
  const withNewColumns = useCallback((allKeys: string[]) => {
    setOrder((prev) => {
      const missing = allKeys.filter((k) => !prev.includes(k));
      const stale = prev.filter((k) => !allKeys.includes(k));
      if (!missing.length && !stale.length) return prev;
      return [...prev.filter((k) => allKeys.includes(k)), ...missing];
    });
  }, []);

  return { order, draggingKey, onDragStart, onDragOver, onDragEnd, withNewColumns };
}
