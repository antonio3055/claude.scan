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
 * browser's own Storage API -- not a guess. "Clear cache" wipes it for real
 * and this refreshes immediately after.
 */
export function StoragePanel({ onClear, epoch }: { onClear: () => void; epoch: number }) {
  const [bytes, setBytes] = useState<number | null>(null);
  const [supported, setSupported] = useState(true);
  const [clearing, setClearing] = useState(false);

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
    try {
      onClear();
    } finally {
      setClearing(false);
    }
  };

  return (
    <footer className="storage-panel">
      <span className="storage-label">Storage</span>
      <span className="storage-value">
        {supported ? (bytes == null ? 'Checking…' : formatBytes(bytes)) : 'Not available in this browser'}
      </span>
      <button type="button" onClick={handleClear} disabled={clearing}>
        {clearing ? 'Clearing…' : 'Clear cache'}
      </button>
    </footer>
  );
}
