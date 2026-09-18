import { getScannerEngine } from '../engine';
import { extractionScore, getDocumentRevenue } from './format';
import type { ScannerDocument, ScannerLead, ScanStatus } from '../types/scanner';

function nameFromDoc(doc: ScannerDocument) {
  return doc.companyNameGuess || doc.application?.legalName || doc.application?.dba || 'Unassociated';
}

/** Same key rule as the engine: one implementation, no drift. */
function normalized(name: string) {
  return getScannerEngine().companyName.companyKey(name);
}

function statusRank(status: ScanStatus) {
  return (
    { failed: 5, needs_review: 4, stopped: 3, ocr: 2, extracting: 2, validating: 2, queued: 1, complete: 0, skipped: 0 } as Record<
      ScanStatus,
      number
    >
  )[status] ?? 0;
}

/**
 * A company's own bank statements are the actual financial evidence; the
 * application is contact/identity paperwork. Averaging every document's
 * score flat let a fully filled-out application with zero matched
 * statements read as a "100% complete" lead -- no financial data verified
 * at all, scored the same as one with three clean, reconciling statements.
 * Statements dominate the score, and an application alone (no statements
 * matched to it) is capped low regardless of how complete the form itself is.
 */
function leadScore(application: ScannerDocument | undefined, statementDocs: ScannerDocument[]) {
  const applicationScore = application ? extractionScore(application) : null;
  if (!statementDocs.length) return applicationScore == null ? 0 : Math.round(applicationScore * 0.3);
  const statementScore = statementDocs.reduce((sum, doc) => sum + extractionScore(doc), 0) / statementDocs.length;
  if (applicationScore == null) return Math.round(statementScore * 0.85);
  return Math.round(statementScore * 0.7 + applicationScore * 0.3);
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
    // A flagged duplicate is the same statement read twice, not a second
    // month: it stays visible in the audit trail but never adds a second
    // copy of its deposits/balances into the company's numbers.
    const unique = docs.filter((d) => !d.duplicateOfFileId);
    const statements = unique.filter((d) => d.docType === 'bank_statement' && !d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const mtdDocs = unique.filter((d) => d.docType === 'bank_statement' && !!d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const companyName = nameFromDoc(application ?? docs[0]);
    const statementRevenue = statements.map(getDocumentRevenue).filter((n) => n > 0);
    const revenue = application?.application?.statedRevenue
      ?? (statementRevenue.length ? statementRevenue.reduce((a, b) => a + b, 0) / statementRevenue.length : 0);
    const extraction = leadScore(application, unique.filter((d) => d.docType === 'bank_statement'));
    const status = docs.slice().sort((a, b) => statusRank(b.processingStatus) - statusRank(a.processingStatus))[0]?.processingStatus ?? 'queued';
    const issues = docs.flatMap((d) => (d.reviewItems ?? []).map((item) => String((item as any).type ?? 'review')));
    const ownerName = application?.application?.fullName ?? null;
    const companyInfo = buildCompanyInfo(application, docs);
    const duplicateCount = docs.filter((d) => d.duplicateOfFileId).length;

    leads.push({ id, companyName, ownerName, revenue: Number(revenue) || 0, extractionScore: extraction, status, docs, application, statements, mtdDocs, issues, companyInfo, duplicateCount, possibleSameBusinessAs: null });
  });

  flagSameAddressAcrossNames(leads);

  return leads.sort((a, b) => b.revenue - a.revenue || b.extractionScore - a.extractionScore || a.companyName.localeCompare(b.companyName));
}

/**
 * An application-only lead (no matched statements) and a statement-only lead
 * (no matched application) at the same address are worth a look by hand: the
 * engine only groups documents by name, so the same real business banking
 * under a different name than it applied under shows up as two separate
 * leads with no way to connect them on its own. Flags both sides; nothing is
 * merged or scored differently.
 */
function flagSameAddressAcrossNames(leads: ScannerLead[]) {
  const engine = getScannerEngine();
  const appOnly = leads.filter((l) => l.application && l.statements.length === 0 && l.companyInfo.applicationAddress);
  const statementOnly = leads.filter((l) => !l.application && l.statements.length > 0 && l.companyInfo.statementAddresses.length);
  for (const app of appOnly) {
    for (const stmt of statementOnly) {
      const matches = stmt.companyInfo.statementAddresses.some((address) =>
        engine.holderAddress.sameAddress(address, app.companyInfo.applicationAddress)
      );
      if (!matches) continue;
      app.possibleSameBusinessAs = stmt.companyName;
      stmt.possibleSameBusinessAs = app.companyName;
    }
  }
}

/** Distinct, trimmed values in the order they were read. */
function distinct(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * What the application says the company is, and what its statements say.
 *
 * Neither overwrites the other. A business commonly banks under its trading
 * name while its application carries the incorporated name, and the bank
 * commonly holds an address the application has moved on from — both are worth
 * having, and the difference is worth seeing.
 */
function buildCompanyInfo(application: ScannerDocument | undefined, docs: ScannerDocument[]) {
  const engine = getScannerEngine();
  const app = application?.application;
  const legalName = app?.legalName ?? null;
  const applicationDba = app?.dba ?? null;
  const applicationAddress = app?.address ?? null;

  const identities = docs
    .filter((doc) => doc.docType === 'bank_statement')
    .map((doc) => doc.statementIdentity)
    .filter(Boolean) as NonNullable<ScannerDocument['statementIdentity']>[];

  const statementNames = distinct(identities.map((item) => item.name));
  const statementDbas = distinct(identities.map((item) => item.dba));
  const statementAddresses = distinct(identities.map((item) => item.address));

  // Compared as printed, not by grouping key: "DATALAB INFOTECH INC" and
  // "Datalab Infotech Corporation" are one company for grouping, and exactly
  // the difference worth showing here.
  const asPrinted = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameName = (a: string, b: string | null) => Boolean(b) && asPrinted(a) === asPrinted(b as string);

  return {
    legalName,
    applicationDba,
    applicationAddress,
    statementNames,
    statementDbas,
    statementAddresses,
    // A "differs from the application" flag needs an application to differ
    // from; with no app data there is nothing to compare against, so it never
    // fires (no false "differs" badge when there is simply nothing on file).
    nameDiffers: legalName
      ? statementNames.some((name) => !sameName(name, legalName))
      : false,
    dbaDiffers: applicationDba
      ? statementDbas.some((dba) => !sameName(dba, applicationDba))
      : false,
    addressDiffers: applicationAddress
      ? statementAddresses.some((address) => !engine.holderAddress.sameAddress(address, applicationAddress))
      : false
  };
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
