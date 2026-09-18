import { realScanFile } from "./real-scan-file";
import type { ScanResult, ScanSettings } from "./types";

/**
 * Abort-aware wrapper around the scan implementation.
 * Stop uses this so in-flight work can be cancelled without changing the
 * underlying scan function. realScanFile also watches this same signal
 * internally (it cancels the actual PDF/OCR work, not just this wrapper's
 * promise), so Stop cancels real in-flight work, not just its result.
 */
export function runScanFile(
  file: File,
  settings: ScanSettings,
  signal: AbortSignal,
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    realScanFile(file, settings, signal).then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        resolve(result);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
