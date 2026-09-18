import { useEffect, useRef, useState } from 'react';

/**
 * Elapsed time since the current run started, live-updating once a second.
 * `running` only goes false->true on a genuine fresh Start (Pause keeps it
 * true the whole time, per useScannerQueue), so that transition is exactly
 * when the timer should reset to 0. It keeps counting through Pause and
 * simply freezes while paused, resuming from where it left off.
 */
export function useElapsedTimer(running: boolean, paused: boolean): string {
  const [elapsedMs, setElapsedMs] = useState(0);
  const wasRunning = useRef(false);
  const tickStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (running && !wasRunning.current) {
      setElapsedMs(0);
    }
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    if (!running || paused) {
      tickStartedAt.current = null;
      return;
    }
    tickStartedAt.current = Date.now();
    const id = window.setInterval(() => {
      const started = tickStartedAt.current;
      if (started == null) return;
      setElapsedMs((prev) => prev + (Date.now() - started));
      tickStartedAt.current = Date.now();
    }, 500);
    return () => window.clearInterval(id);
  }, [running, paused]);

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
