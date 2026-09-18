import type { ScannerDocument, ScannerLead } from '../types/scanner';

/**
 * A bare "—" doesn't tell a reviewer whether a field is genuinely absent or
 * whether OCR just couldn't read it. "Blank" means there was nothing to
 * find (no source document, or a clean-text document that never mentioned
 * it); "OCR failed" means the only source was an OCR'd document and the
 * field still didn't come out, so it's worth a manual recheck rather than
 * trusted as blank.
 */
export function missingLabel(sourceDoc?: ScannerDocument | null | Array<ScannerDocument | null | undefined>) {
  const docs = Array.isArray(sourceDoc) ? sourceDoc : [sourceDoc];
  return docs.some((d) => d?.usedOcr) ? 'OCR failed' : 'Blank';
}

export function displayValue(value: unknown, sourceDoc?: ScannerDocument | null | Array<ScannerDocument | null | undefined>) {
  if (value != null && value !== '') return String(value);
  return missingLabel(sourceDoc);
}

export function displayList(values: Array<string | null | undefined> | undefined, sourceDoc?: ScannerDocument | null | Array<ScannerDocument | null | undefined>) {
  const list = (values ?? []).map((v) => String(v ?? '').trim()).filter(Boolean);
  if (list.length) return list;
  return [missingLabel(sourceDoc)];
}

export function money(value: number | null | undefined, sourceDoc?: ScannerDocument | null | Array<ScannerDocument | null | undefined>) {
  if (value == null || !Number.isFinite(value)) return sourceDoc === undefined ? '—' : missingLabel(sourceDoc);
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function getDocumentRevenue(doc: ScannerDocument) {
  const app = doc.application?.statedRevenue;
  const trueRevenue = Number(doc.deposits?.trueRevenue) || 0;
  const bank = trueRevenue > 0 ? trueRevenue : doc.deposits?.totalDeposits;
  return Number(app ?? bank ?? 0) || 0;
}

/**
 * An application has no bank/reconciliation signal to score against, so it
 * used to fall back to a flat 85 (or 55) purely from whether its text layer
 * was trusted -- an application with a clean scan but nothing actually
 * found on it (no owner, no phone, no revenue) still scored 85. This counts
 * what was actually read off the form instead, the same "did we get real
 * data" question the statement side already answers with its 4 signals.
 */
function applicationCompletenessScore(app: ScannerDocument['application']) {
  if (!app) return 0;
  const checks = [
    Boolean(app.legalName),
    Boolean(app.fullName),
    Boolean(app.phones?.length),
    Boolean(app.emails?.length),
    Boolean(app.address),
    Boolean(app.businessStartDate),
    app.statedRevenue != null,
    Boolean(app.appDate)
  ];
  const found = checks.filter(Boolean).length;
  return Math.round((found / checks.length) * 100);
}

export function extractionScore(doc: ScannerDocument) {
  if (doc.docType === 'application') return applicationCompletenessScore(doc.application);
  const points = Number(doc.confidence?.points);
  const max = Number(doc.confidence?.maxPoints);
  if (Number.isFinite(points) && Number.isFinite(max) && max > 0) {
    return Math.max(0, Math.min(100, Math.round((points / max) * 100)));
  }
  const level = doc.confidence?.level;
  if (level === 'high') return 100;
  if (level === 'medium') return 75;
  if (level === 'low') return 50;
  if (level === 'needs_review') return 35;
  return 0;
}

export function shortDocLabel(doc: ScannerDocument) {
  if (doc.docType === 'application') return 'APP';
  if (doc.isMtd) return 'MTD';
  const end = doc.statementPeriod?.end;
  if (end) {
    const date = new Date(`${end}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  }
  return doc.docType === 'bank_statement' ? 'STM' : 'DOC';
}

export function leadRevenue(lead: ScannerLead) {
  return lead.revenue || 0;
}
