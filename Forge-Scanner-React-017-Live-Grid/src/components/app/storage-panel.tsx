import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { useScanStore } from "@/store/scan-store";

export function StorageBar() {
  const cacheBytes = useScanStore((s) => s.cacheBytes);
  const clearCache = useScanStore((s) => s.clearCache);

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-surface px-5 py-2 text-xs">
      <span className="font-medium tracking-wide text-muted uppercase">Storage</span>
      <span className="font-mono tabular-nums text-fg">{formatBytes(cacheBytes)}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto"
        onClick={clearCache}
      >
        Clear cache
      </Button>
    </footer>
  );
}
