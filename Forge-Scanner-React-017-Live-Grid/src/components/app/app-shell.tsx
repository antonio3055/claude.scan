import { useEffect } from "react";
import { ResultsGrid } from "@/components/app/results-grid";
import { ScanControls } from "@/components/app/scan-controls";
import { SettingsMenu } from "@/components/app/settings-panel";
import { StorageBar } from "@/components/app/storage-panel";
import { UploadZone } from "@/components/app/upload-zone";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useScanStore } from "@/store/scan-store";

export function AppShell() {
  const hydrate = useScanStore((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <TooltipProvider>
      <div className="flex min-h-dvh flex-col bg-bg text-fg lg:h-dvh lg:overflow-hidden">
        <header className="flex shrink-0 items-center gap-4 border-b border-border bg-surface px-5 py-2.5">
          <Logo />
          <div className="min-w-0">
            <p className="text-sm font-medium tracking-tight text-fg">Northline</p>
            <p className="text-xs text-muted">Bank statement extraction</p>
          </div>
          <div className="ml-auto">
            <SettingsMenu />
          </div>
        </header>
        <div className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-3 overflow-auto p-4 lg:overflow-hidden">
          <div className="shrink-0 rounded-lg bg-surface p-3 shadow-border">
            <UploadZone />
          </div>
          <main className="flex min-h-96 min-w-0 flex-1 flex-col gap-3 rounded-lg bg-surface p-4 shadow-border">
            <ScanControls />
            <ResultsGrid />
          </main>
        </div>
        <StorageBar />
      </div>
    </TooltipProvider>
  );
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <rect x="8" y="7" width="16" height="18" rx="1.5" className="fill-primary-fg" />
      <rect x="11" y="11" width="10" height="1.4" className="fill-primary" opacity="0.35" />
      <rect x="11" y="15" width="10" height="1.6" className="fill-primary" />
      <rect x="11" y="19" width="7" height="1.4" className="fill-primary" opacity="0.35" />
    </svg>
  );
}
