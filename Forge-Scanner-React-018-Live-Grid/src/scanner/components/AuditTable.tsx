import { useState, type ReactNode } from 'react';
import type { ScannerDocument } from '../types/scanner';
import { extractionScore, displayValue } from '../lib/format';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { useColumnOrder } from '../hooks/useColumnOrder';

interface Props {
  documents: ScannerDocument[];
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  validating: 'Validating',
  extracting: 'Extracting',
  ocr: 'OCR',
  complete: 'Complete',
  needs_review: 'Needs review',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped'
};

const NUM_WIDTH = 42;

const DEFAULT_WIDTHS: Record<string, number> = {
  document: 220,
  company: 180,
  type: 110,
  text: 100,
  ocr: 70,
  pages: 118,
  extraction: 90,
  details: 280
};

const COLUMN_LABELS: Record<string, string> = {
  document: 'Document',
  company: 'Company',
  type: 'Type',
  text: 'Text',
  ocr: 'OCR',
  pages: 'Pages scanned',
  extraction: 'Extraction',
  details: 'Details'
};

const DEFAULT_ORDER = ['document', 'company', 'type', 'text', 'ocr', 'pages', 'extraction', 'details'];

/** A short, specific reason for this row's status, not a generic label. */
function details(doc: ScannerDocument): string {
  if (doc.duplicateOfFileId) return 'Duplicate of an already-scanned file — excluded from company totals';
  if (doc.processingStatus === 'skipped') return doc.processingErrorMessage || 'Skipped by the revenue exclusion threshold';
  if (doc.processingStatus === 'failed') return doc.processingErrorMessage || 'Processing failed';
  if (doc.processingStatus === 'needs_review') return (doc.reviewItems ?? []).map((i: any) => i.type).filter(Boolean).join(', ') || 'Flagged for manual review';
  if (doc.needsOcr && !doc.usedOcr) return 'No usable text layer — needs OCR';
  if (doc.reconciliation?.reconciles === false) return `Does not reconcile (Δ ${doc.reconciliation.difference ?? '?'})`;
  if (doc.processingStatus === 'complete') return 'Reads clean';
  return '';
}

export function AuditTable({ documents }: Props) {
  const [open, setOpen] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const cols = useResizableColumns(DEFAULT_WIDTHS);
  const reorder = useColumnOrder(DEFAULT_ORDER);

  const rows = issuesOnly
    ? documents.filter((d) => d.processingStatus === 'failed' || d.processingStatus === 'needs_review' || d.processingStatus === 'skipped' || d.duplicateOfFileId)
    : documents;

  const gridTemplateColumns = [`${NUM_WIDTH}px`, ...reorder.order.map((key) => `${cols.widths[key] ?? 140}px`)].join(' ');

  const cellFor = (doc: ScannerDocument, key: string): { node: ReactNode; num?: boolean; title?: string } => {
    switch (key) {
      case 'document': return { node: doc.filename, title: doc.filename };
      case 'company': return { node: displayValue(doc.companyNameGuess, doc) };
      case 'type': return { node: displayValue(doc.docType?.replace('_', ' '), doc) };
      case 'text': return { node: doc.usedOcr ? 'OCR' : 'Native' };
      case 'ocr': return { node: doc.usedOcr ? 'Yes' : 'No' };
      case 'pages': return { node: doc.scannedPageCount ?? doc.pageCount ?? '—', num: true };
      case 'extraction': return { node: doc.processingStatus === 'complete' || doc.processingStatus === 'needs_review' ? extractionScore(doc) : displayValue(null, doc), num: true };
      case 'details': {
        const d = details(doc);
        return { node: d || <span className={`grid-badge status-${doc.processingStatus}`}>{STATUS_LABEL[doc.processingStatus] ?? doc.processingStatus}</span>, title: d };
      }
      default: return { node: null };
    }
  };

  return (
    <section className={`audit-table-section ${open ? 'open' : ''}`}>
      <button className="audit-table-toggle" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span><strong>Scan Audit</strong><small>{documents.length} document{documents.length === 1 ? '' : 's'}</small></span>
        <span>{open ? 'Collapse' : 'Expand'}</span>
      </button>
      {open && (
        <div className="audit-table-body">
          <div className="audit-table-actions">
            <label><input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Issues only</label>
          </div>
          <div className="sheet-scroll" onPointerMove={cols.onPointerMove} onPointerUp={cols.onPointerUp}>
            <div className="sheet-row sheet-head-row" style={{ gridTemplateColumns }}>
              <div className="sheet-cell sheet-num-cell">#</div>
              {reorder.order.map((key) => (
                <div
                  className={`sheet-cell sheet-th ${reorder.draggingKey === key ? 'dragging' : ''}`}
                  key={key}
                  draggable
                  onDragStart={reorder.onDragStart(key)}
                  onDragOver={reorder.onDragOver(key)}
                  onDragEnd={reorder.onDragEnd}
                  title="Drag to reorder"
                >
                  {COLUMN_LABELS[key]}
                  <span className="col-resize-handle" draggable={false} onPointerDown={cols.startResize(key)} />
                </div>
              ))}
            </div>
            {rows.length === 0 && <div className="sheet-empty">No documents to show.</div>}
            {rows.map((doc, index) => (
              <div className={`sheet-row row-status-${doc.processingStatus}${doc.duplicateOfFileId ? ' row-duplicate' : ''}`} style={{ gridTemplateColumns }} key={doc.fileId}>
                <div className="sheet-cell sheet-num-cell">{index + 1}</div>
                {reorder.order.map((key) => {
                  const { node, num, title } = cellFor(doc, key);
                  return <div className={`sheet-cell${num ? ' num' : ''}`} key={key} title={title}>{node}</div>;
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
