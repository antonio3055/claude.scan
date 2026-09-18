import type { ScannerDocument } from '../types/scanner';

interface Props {
  documents: ScannerDocument[];
  onClose: () => void;
}

/** Every file that needed or used OCR, so a reviewer knows what to double-check by hand. */
export function OcrFilesModal({ documents, onClose }: Props) {
  const used = documents.filter((d) => d.usedOcr);
  const pending = documents.filter((d) => d.needsOcr && !d.usedOcr);

  return (
    <div className="scanner-modal-overlay" onClick={onClose}>
      <div className="scanner-modal" onClick={(e) => e.stopPropagation()}>
        <header className="scanner-modal-head">
          <h2>OCR files</h2>
          <button type="button" className="scanner-modal-close" onClick={onClose} title="Close">✕</button>
        </header>
        <div className="scanner-modal-body">
          <section>
            <h3>Read by OCR ({used.length})</h3>
            {used.length ? <ul className="ocr-file-list">{used.map((d) => <li key={d.fileId}>{d.filename}</li>)}</ul> : <p className="muted-copy">No file has needed OCR yet.</p>}
          </section>
          <section>
            <h3>Flagged, not yet OCR'd ({pending.length})</h3>
            {pending.length ? <ul className="ocr-file-list">{pending.map((d) => <li key={d.fileId}>{d.filename}</li>)}</ul> : <p className="muted-copy">Nothing waiting on OCR.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
