import { getScannerEngine } from '../engine';
import { extractionScore, getDocumentRevenue } from './format';
import type { ScannerDocument, ScannerLead, ScanStatus } from '../types/scanner';

function nameFromDoc(doc: ScannerDocument) {
  return doc.companyNameGuess || doc.application?.legalName || doc.application?.dba || 'Unassociated';
}

function normalized(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || 'unassociated';
}

function statusRank(status: ScanStatus) {
  return ({ failed: 5, needs_review: 4, stopped: 3, ocr: 2, extracting: 2, validating: 2, queued: 1, complete: 0 } as Record<ScanStatus, number>)[status] ?? 0;
}

export function buildLeads(documents: ScannerDocument[]): ScannerLead[] {
  // Keep the source engine's company grouping available, but avoid collapsing every
  // truly-unassociated document into one fake company. Unknown docs stay separate.
  const groups = new Map<string, ScannerDocument[]>();
  documents.forEach((doc) => {
    const name = nameFromDoc(doc);
    const key = name === 'Unassociated' ? `unassociated:${doc.fileId}` : normalized(name);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  });

  const leads: ScannerLead[] = [];
  groups.forEach((docs, id) => {
    const application = docs.find((d) => d.docType === 'application');
    const statements = docs.filter((d) => d.docType === 'bank_statement' && !d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const mtdDocs = docs.filter((d) => d.docType === 'bank_statement' && !!d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const companyName = nameFromDoc(application ?? docs[0]);
    const statementRevenue = statements.map(getDocumentRevenue).filter((n) => n > 0);
    const revenue = application?.application?.statedRevenue
      ?? (statementRevenue.length ? statementRevenue.reduce((a, b) => a + b, 0) / statementRevenue.length : 0);
    const extraction = Math.round(docs.reduce((sum, doc) => sum + extractionScore(doc), 0) / Math.max(1, docs.length));
    const status = docs.slice().sort((a, b) => statusRank(b.processingStatus) - statusRank(a.processingStatus))[0]?.processingStatus ?? 'queued';
    const issues = docs.flatMap((d) => (d.reviewItems ?? []).map((item) => String((item as any).type ?? 'review')));
    const ownerName = application?.application?.fullName ?? null;

    leads.push({ id, companyName, ownerName, revenue: Number(revenue) || 0, extractionScore: extraction, status, docs, application, statements, mtdDocs, issues });
  });

  return leads.sort((a, b) => b.revenue - a.revenue || b.extractionScore - a.extractionScore || a.companyName.localeCompare(b.companyName));
}

export function auditSummary(leads: ScannerLead[]) {
  const missingCompany = leads.filter((l) => l.companyName === 'Unassociated').length;
  const needsReview = leads.filter((l) => l.status === 'needs_review').length;
  const failed = leads.filter((l) => l.status === 'failed').length;
  const lowScore = leads.filter((l) => l.extractionScore > 0 && l.extractionScore < 70).length;
  const duplicateIssues = leads.flatMap((l) => l.docs).filter((d) => !!d.duplicateOfFileId).length;
  return { missingCompany, needsReview, failed, lowScore, duplicateIssues };
}

// Touch the engine here so Vite keeps the authoritative source modules in the scanner bundle.
export function assertEngineReady() {
  return !!getScannerEngine().pipeline;
}
