import { useMemo, useState, type ReactNode } from 'react';
import type { ScannerDocument, ScannerLead } from '../types/scanner';
import { extractionScore, displayValue } from '../lib/format';
import { diagnoseAll, type Verdict } from '../lib/docDiagnostics';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { useColumnOrder } from '../hooks/useColumnOrder';

interface Props {
  documents: ScannerDocument[];
  /** The Results sheet's leads, so each file is judged in the company it landed in. */
  leads: ScannerLead[];
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

const VERDICT_LABEL: Record<Verdict, string> = {
  good: 'Good',
  partial: 'Partial',
  bad: 'Bad',
  pending: 'Pending',
  excluded: 'Excluded'
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
  result: 84,
  details: 360
};

const COLUMN_LABELS: Record<string, string> = {
  document: 'Document',
  company: 'Company',
  type: 'Type',
  text: 'Text',
  ocr: 'OCR',
  pages: 'Pages scanned',
  extraction: 'Extraction',
  result: 'Result',
  details: 'Why'
};

const DEFAULT_ORDER = ['document', 'company', 'type', 'text', 'ocr', 'pages', 'extraction', 'result', 'details'];

export function AuditTable({ documents, leads }: Props) {
  const [open, setOpen] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const cols = useResizableColumns(DEFAULT_WIDTHS);
  const reorder = useColumnOrder(DEFAULT_ORDER);

  // Judged on what was actually extracted, not on whether processing
  // finished: "complete" with nothing usable in it is a bad result.
  const diagnoses = useMemo(() => diagnoseAll(documents, leads), [documents, leads]);
  const counts = useMemo(() => {
    const out: Record<Verdict, number> = { good: 0, partial: 0, bad: 0, pending: 0, excluded: 0 };
    diagnoses.forEach((d) => { out[d.verdict] += 1; });
    return out;
  }, [diagnoses]);

  const rows = issuesOnly
    ? documents.filter((d) => {
        const verdict = diagnoses.get(d.fileId)?.verdict;
        return verdict === 'partial' || verdict === 'bad' || verdict === 'excluded';
      })
    : documents;

  // The last column fills whatever width is left instead of a fixed pixel
  // size, so the table spreads across the full available width -- no
  // horizontal scroll just to see every column on a normal screen.
  const gridTemplateColumns = [
    `${NUM_WIDTH}px`,
    ...reorder.order.map((key, i) => {
      const width = cols.widths[key] ?? 140;
      return i === reorder.order.length - 1 ? `minmax(${width}px, 1fr)` : `${width}px`;
    })
  ].join(' ');

  const cellFor = (doc: ScannerDocument, key: string): { node: ReactNode; num?: boolean; title?: string } => {
    switch (key) {
      case 'document': return { node: doc.filename, title: doc.filename };
      // The company this file was put under on the Results sheet.
      case 'company': return { node: displayValue(diagnoses.get(doc.fileId)?.company ?? doc.companyNameGuess, doc) };
      case 'type': return { node: displayValue(doc.docType?.replace('_', ' '), doc) };
      case 'text': return { node: doc.usedOcr ? 'OCR' : 'Native' };
      case 'ocr': return { node: doc.usedOcr ? 'Yes' : 'No' };
      case 'pages': return { node: doc.scannedPageCount ?? doc.pageCount ?? '—', num: true };
      case 'extraction': return { node: doc.processingStatus === 'complete' || doc.processingStatus === 'needs_review' ? extractionScore(doc) : displayValue(null, doc), num: true };
      case 'result': {
        const verdict = diagnoses.get(doc.fileId)?.verdict ?? 'pending';
        return {
          node: verdict === 'pending'
            ? <span className={`grid-badge status-${doc.processingStatus}`}>{STATUS_LABEL[doc.processingStatus] ?? doc.processingStatus}</span>
            : <span className={`grid-badge verdict-${verdict}`}>{VERDICT_LABEL[verdict]}</span>
        };
      }
      case 'details': {
        const summary = diagnoses.get(doc.fileId)?.summary ?? '';
        return { node: summary, title: summary };
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
            <span className="audit-verdict-counts">
              <span className="grid-badge verdict-good">{counts.good} good</span>
              <span className="grid-badge verdict-partial">{counts.partial} partial</span>
              <span className="grid-badge verdict-bad">{counts.bad} bad</span>
              {counts.excluded > 0 && <span className="grid-badge verdict-excluded">{counts.excluded} excluded</span>}
            </span>
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
