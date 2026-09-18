import type { ScannerDocument, ScannerLead } from '../types/scanner';

export function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function getDocumentRevenue(doc: ScannerDocument) {
  const app = doc.application?.statedRevenue;
  const trueRevenue = Number(doc.deposits?.trueRevenue) || 0;
  const bank = trueRevenue > 0 ? trueRevenue : doc.deposits?.totalDeposits;
  return Number(app ?? bank ?? 0) || 0;
}

export function extractionScore(doc: ScannerDocument) {
  const points = Number(doc.confidence?.points);
  const max = Number(doc.confidence?.maxPoints);
  if (Number.isFinite(points) && Number.isFinite(max) && max > 0) {
    return Math.max(0, Math.min(100, Math.round((points / max) * 100)));
  }
  if (doc.docType === 'application') {
    return doc.processingStatus === 'complete' ? 85 : doc.processingStatus === 'needs_review' ? 55 : 0;
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
