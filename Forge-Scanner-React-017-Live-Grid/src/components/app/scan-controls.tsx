import { Pause, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { completedCount, useScanStore } from "@/store/scan-store";
import { formatElapsed } from "@/lib/utils";

export function ScanControls() {
  const items = useScanStore((s) => s.items);
  const engineMode = useScanStore((s) => s.engineMode);
  const start = useScanStore((s) => s.start);
  const pause = useScanStore((s) => s.pause);
  const continueScan = useScanStore((s) => s.continueScan);
  const stop = useScanStore((s) => s.stop);
  const clearQueue = useScanStore((s) => s.clearQueue);

  const total = items.length;
  const done = completedCount(items);
  const busy = engineMode === "running" || engineMode === "paused";
  const progress = total === 0 ? 0 : (done / total) * 100;

  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmClear]);

  function onClear() {
    if (items.length === 0) return;
    if (busy && !confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearQueue();
    setConfirmClear(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={start}>
          <Play className="ml-0.5" />
          Start
        </Button>
        <Button type="button" variant="secondary" onClick={continueScan}>
          <Play className="ml-0.5" />
          Continue
        </Button>
        <Button type="button" variant="outline" onClick={pause}>
          <Pause />
          Pause
        </Button>
        <Button type="button" variant="stop" onClick={stop}>
          <Square className="size-3.5 fill-current" />
          Stop
        </Button>
        <Button type="button" variant={confirmClear ? "danger" : "outline"} onClick={onClear}>
          <Trash2 />
          {confirmClear ? "Confirm clear" : "Clear"}
        </Button>
        <div className="ml-auto flex items-center gap-4">
          <ElapsedTimer />
          <p className="font-mono text-sm tabular-nums text-fg">
            <span className="font-medium">{done}</span>
            <span className="text-subtle"> / {total}</span>
          </p>
        </div>
      </div>
      <Progress value={progress} aria-label={`${done} of ${total} files complete`} />
    </div>
  );
}

function ElapsedTimer() {
  const timerRunning = useScanStore((s) => s.timerRunning);
  const timerStartedAt = useScanStore((s) => s.timerStartedAt);
  const timerAccumulatedMs = useScanStore((s) => s.timerAccumulatedMs);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timerRunning) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [timerRunning]);

  const ms =
    timerRunning && timerStartedAt != null
      ? timerAccumulatedMs + (Date.now() - timerStartedAt)
      : timerAccumulatedMs;

  return (
    <p
      className="font-mono text-sm tabular-nums text-fg"
      aria-label="Elapsed scan time"
      data-elapsed-ms={ms}
    >
      {formatElapsed(ms)}
    </p>
  );
}
