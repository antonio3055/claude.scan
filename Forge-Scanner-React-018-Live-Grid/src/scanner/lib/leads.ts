import { getScannerEngine } from '../engine';
import { extractionScore, getDocumentRevenue, revenueVerification } from './format';
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

/** The folder a file sat in inside an uploaded zip, or null for a file dropped on its own. */
export function folderOfFilename(filename: string): string | null {
  const parts = String(filename || '').split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : null;
}

/** The date stamp CRM exports put on the end of each company's folder ("Acme LLC 02_11_2026"). */
const FOLDER_DATE_STAMP = /[\s_-]*\d{1,2}[_.-]\d{1,2}[_.-]\d{2,4}\s*$/;

/** A folder's name read as a company's, without the CRM's date stamp. */
export function companyFromFolder(folder: string | null): string | null {
  if (!folder) return null;
  const name = folder
    .replace(FOLDER_DATE_STAMP, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /[A-Za-z]{3}/.test(name) ? name : null;
}

const GENERIC_NAME_WORDS = new Set([
  'llc', 'inc', 'corp', 'co', 'company', 'the', 'and', 'of', 'group', 'service', 'ltd', 'pc', 'llp', 'lp', 'dba',
  'incorporated', 'corporation', 'limited', 'partnership', 'enterprise', 'holding'
]);
function significantWords(name: string) {
  return normalized(name).split(' ').filter((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word));
}
/** Two names share a distinctive word: "ATP DIRECT INC." and "ATP DIRECT INC 02_11_2026". */
function namesOverlap(a: string, b: string) {
  const other = new Set(significantWords(b));
  return significantWords(a).some((word) => other.has(word));
}

/** The names a document itself reads as belonging to -- never one guessed from its filename. */
function readNames(doc: ScannerDocument): string[] {
  if (doc.docType === 'application') {
    const app = doc.application;
    return [app?.legalNameSource === 'form' ? app.legalName : null, app?.dba].filter(Boolean) as string[];
  }
  return [doc.statementIdentity?.name, doc.statementIdentity?.dba, doc.companyNameGuess].filter(Boolean) as string[];
}

/**
 * Folders that hold one company's files each, as CRM exports lay them out
 * ("ATP DIRECT INC 02_11_2026/APP.pdf", ".../1.pdf", ".../11.pdf"). Grouping
 * by those is far stronger than by the name read from each PDF: an
 * application form nobody could read a name from still belongs with the
 * statements beside it, instead of every unreadable "APP.pdf" collapsing into
 * one fake company called "APP".
 *
 * A folder only counts when it plainly is a company's: there must be more
 * than one folder in play (one folder around everything is just the batch),
 * and it must not hold several different companies none of which is the
 * folder's own -- a "January" folder of three companies' statements is not
 * one company. A single stray name is not enough to say so: name reading
 * can pick up a bank's footer ("subsidiary of Huntington Bancshares Inc.").
 */
function companyFolders(documents: ScannerDocument[]) {
  const byFolder = new Map<string, ScannerDocument[]>();
  documents.forEach((doc) => {
    const folder = folderOfFilename(doc.filename);
    if (folder) byFolder.set(folder, [...(byFolder.get(folder) ?? []), doc]);
  });
  const companies = new Map<string, string>();
  if (byFolder.size < 2) return companies;
  byFolder.forEach((docs, folder) => {
    const company = companyFromFolder(folder);
    if (!company) return;
    const names = docs.flatMap(readNames);
    const otherCompanies = new Set(names.filter((name) => !namesOverlap(name, company)).map(normalized));
    if (otherCompanies.size >= 2 && !names.some((name) => namesOverlap(name, company))) return;
    companies.set(folder, company);
  });
  return companies;
}

/** Best-read application first: a filled-in form over a contact sheet or an unread one. */
function applicationRank(doc: ScannerDocument) {
  const found = getScannerEngine().applicationExtractor.applicationFieldChecks(doc.application).filter((c) => c.found).length;
  return (doc.applicationKind === 'contact_sheet' ? 0 : 100) + found;
}

/**
 * One application for the lead, with every phone and email any of its
 * application documents carried: a folder can hold the form and a separate
 * contact sheet, and the sheet's numbers are worth having next to the form's.
 */
function leadApplication(docs: ScannerDocument[]): ScannerDocument | undefined {
  const apps = docs.filter((d) => d.docType === 'application' && !d.duplicateOfFileId);
  if (!apps.length) return docs.find((d) => d.docType === 'application');
  const [best, ...rest] = apps.slice().sort((a, b) => applicationRank(b) - applicationRank(a));
  if (!rest.length || !best.application) return best;
  const phones = distinct(apps.flatMap((d) => d.application?.phones ?? []));
  const emails = distinct(apps.flatMap((d) => d.application?.emails ?? []));
  return { ...best, application: { ...best.application, phones, emails } };
}

/**
 * The lead's name: a name its own files read that agrees with its folder.
 * Failing that, a CRM-stamped folder is the company's own name and beats a
 * stray read (a bank footer); a plain folder ("January") is only a fallback.
 */
function leadName(docs: ScannerDocument[], application: ScannerDocument | undefined, folder: { name: string; company: string } | null) {
  if (!folder) return nameFromDoc(application ?? docs[0]);
  const candidates = [...(application ? readNames(application) : []), ...docs.flatMap(readNames)];
  const agreeing = candidates.find((name) => namesOverlap(name, folder.company));
  if (agreeing) return agreeing;
  return FOLDER_DATE_STAMP.test(folder.name) ? folder.company : candidates[0] ?? folder.company;
}

export function buildLeads(documents: ScannerDocument[]): ScannerLead[] {
  // Keep the source engine's company grouping available, but avoid collapsing every
  // truly-unassociated document into one fake company. Unknown docs stay separate.
  const folders = companyFolders(documents);
  const groups = new Map<string, ScannerDocument[]>();
  const groupFolder = new Map<string, { name: string; company: string }>();
  documents.forEach((doc) => {
    const folder = folderOfFilename(doc.filename);
    const folderCompany = folder ? folders.get(folder) : undefined;
    const name = nameFromDoc(doc);
    // Keyed by the folder's company name, so a loose file reading that same
    // name still lands in the same lead.
    const key = folderCompany ? normalized(folderCompany) : name === 'Unassociated' ? `unassociated:${doc.fileId}` : normalized(name);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
    if (folder && folderCompany) groupFolder.set(key, { name: folder, company: folderCompany });
  });

  mergeGroupsAtSameAddress(groups);

  const leads: ScannerLead[] = [];
  groups.forEach((docs, id) => {
    const application = leadApplication(docs);
    // A flagged duplicate is the same statement read twice, not a second
    // month: it stays visible in the audit trail but never adds a second
    // copy of its deposits/balances into the company's numbers.
    const unique = docs.filter((d) => !d.duplicateOfFileId);
    const statements = unique.filter((d) => d.docType === 'bank_statement' && !d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const mtdDocs = unique.filter((d) => d.docType === 'bank_statement' && !!d.isMtd).sort((a, b) => String(b.statementPeriod?.end ?? '').localeCompare(String(a.statementPeriod?.end ?? '')));
    const companyName = leadName(docs, application, groupFolder.get(id) ?? null);
    // Statement revenue counts only the months whose balances add up; a
    // month that does not, or could not be checked, is no evidence of what
    // the business takes in. With no proven month, the figure is still shown,
    // marked unverified, rather than passed off as clean.
    const verifiedStatements = statements.filter((d) => revenueVerification(d) === 'verified');
    const revenueStatements = verifiedStatements.length ? verifiedStatements : statements;
    const statementRevenue = revenueStatements.map(getDocumentRevenue).filter((n) => n > 0);
    const statedRevenue = application?.application?.statedRevenue;
    const revenue = statedRevenue
      ?? (statementRevenue.length ? statementRevenue.reduce((a, b) => a + b, 0) / statementRevenue.length : 0);
    const revenueSource: ScannerLead['revenueSource'] = statedRevenue != null
      ? 'application'
      : !statementRevenue.length ? 'none' : verifiedStatements.length ? 'verified_statements' : 'unverified_statements';
    const extraction = leadScore(application, unique.filter((d) => d.docType === 'bank_statement'));
    const status = docs.slice().sort((a, b) => statusRank(b.processingStatus) - statusRank(a.processingStatus))[0]?.processingStatus ?? 'queued';
    const issues = docs.flatMap((d) => (d.reviewItems ?? []).map((item) => String((item as any).type ?? 'review')));
    const ownerName = application?.application?.fullName ?? null;
    const companyInfo = buildCompanyInfo(application, docs);
    const duplicateCount = docs.filter((d) => d.duplicateOfFileId).length;

    leads.push({ id, companyName, ownerName, revenue: Number(revenue) || 0, revenueSource, extractionScore: extraction, status, docs, application, statements, mtdDocs, issues, companyInfo, duplicateCount, possibleSameBusinessAs: [] });
  });

  flagPossibleSameBusiness(leads);

  return leads.sort((a, b) => b.revenue - a.revenue || b.extractionScore - a.extractionScore || a.companyName.localeCompare(b.companyName));
}

/** True once for docs that carry real financial evidence -- not a duplicate, not a month-to-date preview. */
function isRealStatement(doc: ScannerDocument) {
  return doc.docType === 'bank_statement' && !doc.duplicateOfFileId && !doc.isMtd;
}

/**
 * Before grouping purely by company name, fold an application-only group and
 * a statement-only group together when their addresses genuinely match --
 * the strongest signal available that they are one real business banking
 * under a different name than it applied under (a trading name, a rebrand,
 * an old filing). This is the one signal solid enough to actually combine
 * two groups into a single lead; every weaker case (name differs with no
 * address match, or matching neither) stays a same-business *flag* only --
 * see flagPossibleSameBusiness below, which runs after this and therefore
 * never re-flags a pair this already merged.
 */
function mergeGroupsAtSameAddress(groups: Map<string, ScannerDocument[]>) {
  const engine = getScannerEngine();
  const appOnlyKeys = [...groups.entries()]
    .filter(([, docs]) => docs.some((d) => d.docType === 'application') && !docs.some(isRealStatement))
    .map(([key]) => key);
  const stmtOnlyKeys = [...groups.entries()]
    .filter(([, docs]) => !docs.some((d) => d.docType === 'application') && docs.some(isRealStatement))
    .map(([key]) => key);

  for (const appKey of appOnlyKeys) {
    const appDocs = groups.get(appKey);
    const applicationAddress = appDocs?.find((d) => d.docType === 'application')?.application?.address;
    if (!applicationAddress) continue;

    for (const stmtKey of stmtOnlyKeys) {
      if (stmtKey === appKey) continue;
      const stmtDocs = groups.get(stmtKey);
      if (!stmtDocs) continue; // already folded into an earlier match
      const addressMatches = stmtDocs.some(
        (d) => isRealStatement(d) && engine.holderAddress.sameAddress(d.statementIdentity?.address, applicationAddress)
      );
      if (!addressMatches) continue;

      groups.set(appKey, [...(groups.get(appKey) ?? []), ...stmtDocs]);
      groups.delete(stmtKey);
    }
  }
}

/**
 * An application-only lead (no matched statements) and a statement-only lead
 * (no matched application) are always worth a look by hand, matching name
 * and address or not: the engine only groups documents by name, so the same
 * real business banking under a different name -- at a different address
 * than the one on file, an old address, a typo -- shows up as two separate
 * leads with no way to connect them on its own. Flags both sides against
 * every candidate on the other side; nothing is merged or scored
 * differently.
 */
function flagPossibleSameBusiness(leads: ScannerLead[]) {
  const appOnly = leads.filter((l) => l.application && l.statements.length === 0);
  const statementOnly = leads.filter((l) => !l.application && l.statements.length > 0);
  for (const app of appOnly) {
    for (const stmt of statementOnly) {
      app.possibleSameBusinessAs.push(stmt.companyName);
      stmt.possibleSameBusinessAs.push(app.companyName);
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
