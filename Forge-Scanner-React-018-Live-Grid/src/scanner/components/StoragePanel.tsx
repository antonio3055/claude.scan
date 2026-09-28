import { useEffect, useState } from 'react';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Real, disk-backed space used by this scanner's IndexedDB cache (scanned
 * results plus the original files kept for restart recovery), read from the
 * browser's own Storage API -- not a guess. "Clear cache" wipes every
 * document and file record for real; the byte count the browser reports
 * afterward is a separate, much less trustworthy number (see the tooltip).
 */
export function StoragePanel({ onClear, epoch }: { onClear: () => Promise<void>; epoch: number }) {
  const [bytes, setBytes] = useState<number | null>(null);
  const [supported, setSupported] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.storage?.estimate) {
      setSupported(false);
      return;
    }
    const check = () => {
      navigator.storage
        .estimate()
        .then((estimate) => {
          if (!cancelled) setBytes(estimate.usage ?? 0);
        })
        .catch(() => {
          if (!cancelled) setSupported(false);
        });
    };
    check();
    // Live-ish while the panel is open, so it reflects a scan in progress.
    const id = window.setInterval(check, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [epoch]);

  const handleClear = async () => {
    setClearing(true);
    setCleared(false);
    try {
      await onClear();
      setCleared(true);
      window.setTimeout(() => setCleared(false), 4000);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="storage-panel">
      <span className="storage-label">Cache</span>
      <span
        className="storage-value"
        title="Real usage reported by the browser's own Storage API -- but right after a clear this number is not trustworthy: deleting IndexedDB records can make it go UP before it goes down, since the browser writes the deletion itself before reclaiming space in the background. Every document and file record is gone immediately regardless of what this number shows; a second Clear click has nothing left to do."
      >
        {supported ? (bytes == null ? 'Checking…' : formatBytes(bytes)) : 'n/a'}
      </span>
      <button type="button" onClick={handleClear} disabled={clearing} title="Wipe every cached document and original file">
        {clearing ? 'Clearing…' : cleared ? 'Cleared ✓' : 'Clear cache'}
      </button>
    </div>
  );
}
