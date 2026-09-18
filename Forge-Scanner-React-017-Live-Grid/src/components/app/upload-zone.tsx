import { FileUp, X } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useScanStore } from "@/store/scan-store";

export function UploadZone() {
  const addFiles = useScanStore((s) => s.addFiles);
  const notices = useScanStore((s) => s.notices);
  const dismissNotice = useScanStore((s) => s.dismissNotice);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const ingest = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;
      setBusy(true);
      try {
        await addFiles(files);
      } finally {
        setBusy(false);
      }
    },
    [addFiles],
  );

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(true);
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setOver(false);
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files?.length) await ingest(e.dataTransfer.files);
  }

  async function onFilePick(e: { currentTarget: HTMLInputElement }) {
    // currentTarget is only valid while the event is dispatching -- the DOM
    // reverts it to null once dispatch finishes, which happens well before
    // an awaited ingest() resolves. Read what's needed now; reset through
    // the stable ref afterward instead of e.currentTarget.
    const files = e.currentTarget.files;
    if (files?.length) await ingest(files);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="flex flex-col gap-2">
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex min-h-40 flex-col items-center justify-center gap-4 rounded-md border border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-150 ease-smooth",
          over ? "border-primary bg-scanning-dim" : "border-border-strong bg-surface-2",
        )}
      >
        <FileUp className={cn("size-10", over ? "text-primary" : "text-subtle")} strokeWidth={1.5} />
        <div className="space-y-1">
          <p className="text-base font-medium text-fg">Drop PDFs or a .zip</p>
          <p className="text-sm text-muted">
            Multiple statements at once. Nested folders in zips are included.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
          {busy ? "Reading…" : "Choose files"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept=".pdf,.zip,application/pdf,application/zip"
          multiple
          onChange={onFilePick}
        />
      </div>
      {notices.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {notices.map((notice) => (
            <li
              key={notice.id}
              className={cn(
                "flex max-w-full items-start gap-2 rounded-sm px-2.5 py-1 text-xs",
                notice.kind === "skip" ? "bg-review-dim text-review" : "bg-complete-dim text-complete",
              )}
            >
              <span className="min-w-0 flex-1 leading-snug">{notice.message}</span>
              <button
                type="button"
                className="mt-px shrink-0 text-current opacity-60 hover:opacity-100"
                onClick={() => dismissNotice(notice.id)}
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
