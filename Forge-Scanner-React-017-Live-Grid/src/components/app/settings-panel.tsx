import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useScanStore } from "@/store/scan-store";

export function SettingsMenu() {
  const settings = useScanStore((s) => s.settings);
  const setSettings = useScanStore((s) => s.setSettings);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Settings />
          Settings
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-3">
        <DropdownMenuLabel>Scan pages</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex flex-col gap-3 px-1 py-2">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-fg">Regular pages</span>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="h-8 w-20 px-2"
              value={settings.regularPages}
              onChange={(e) => {
                const next = e.target.valueAsNumber;
                if (Number.isFinite(next)) setSettings({ regularPages: next });
              }}
              aria-describedby="settings-apply-hint"
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-fg">OCR pages</span>
            <Input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              className="h-8 w-20 px-2"
              value={settings.ocrPages}
              onChange={(e) => {
                const next = e.target.valueAsNumber;
                if (Number.isFinite(next)) setSettings({ ocrPages: next });
              }}
            />
          </label>
          <p id="settings-apply-hint" className="text-2xs leading-snug text-subtle">
            Changes apply to files not yet started.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
