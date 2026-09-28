import { getScannerEngine } from '../engine';
import type { ScannerDocument, ScannerLead } from '../types/scanner';

/**
 * good: everything this kind of document is read for was found.
 * partial: read, but with named gaps. bad: little or nothing usable came out.
 * pending: not read yet. excluded: deliberately left out of the totals.
 */
export type Verdict = 'good' | 'partial' | 'bad' | 'pending' | 'excluded';

export interface Diagnosis {
  verdict: Verdict;
  /** One line: what came out of this file and, when it falls short, exactly why. */
  summary: string;
}

const PENDING = new Set(['queued', 'validating', 'extracting', 'ocr']);

const has = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function list(items: string[]) {
  return items.join(', ');
}

function diagnoseApplication(doc: ScannerDocument): Diagnosis {
  const checks = getScannerEngine().applicationExtractor.applicationFieldChecks(doc.application);
  const found = checks.filter((c) => c.found);
  const missing = checks.filter((c) => !c.found).map((c) => c.field);
  const phones = doc.application?.phones?.length ?? 0;
  const emails = doc.application?.emails?.length ?? 0;
  const ocrNote = doc.usedOcr ? ' (read by OCR)' : '';

  if (doc.applicationKind === 'contact_sheet') {
    return {
      verdict: 'partial',
      summary: `Contact list only — ${phones} phone${phones === 1 ? '' : 's'}, ${emails} email${emails === 1 ? '' : 's'}; no application form in this file, so no owner, start date or address`
    };
  }
  if (doc.needsOcr && !doc.usedOcr) {
    return {
      verdict: 'bad',
      summary: `Form labels only — the answers are not in this PDF's text (typed onto the page image, or printed apart from their labels). Needs OCR${phones || emails ? `; ${phones} phone(s), ${emails} email(s) found so far` : ''}`
    };
  }
  const source = doc.application?.legalName && doc.application?.legalNameSource === 'filename' ? '; company name not on the form, only in the filename' : '';
  if (!missing.length) return { verdict: 'good', summary: `All ${checks.length} application fields found${ocrNote}` };
  const verdict: Verdict = found.length >= 6 ? 'good' : found.length >= 3 ? 'partial' : 'bad';
  return { verdict, summary: `Found ${found.length} of ${checks.length} — missing ${list(missing)}${source}${ocrNote}` };
}

function diagnoseStatement(doc: ScannerDocument): Diagnosis {
  const opening = doc.balances?.opening ?? doc.statementSummary?.beginning;
  const ending = doc.balances?.ending ?? doc.statementSummary?.ending;
  const deposits = doc.statementSummary?.deposits ?? doc.deposits?.totalDeposits;
  const ocrNote = doc.usedOcr ? ' (read by OCR)' : '';

  if (doc.needsOcr && !doc.usedOcr) {
    return { verdict: 'bad', summary: 'Scanned image — no usable text layer, nothing read yet. Needs OCR' };
  }
  if (!has(opening) && !has(ending) && !has(deposits)) {
    const pages = doc.usedOcr && doc.scannedPageCount && doc.pageCount && doc.scannedPageCount < doc.pageCount
      ? ` — OCR read ${doc.scannedPageCount} of ${doc.pageCount} pages; raise the OCR page limit and re-run`
      : '';
    return { verdict: 'bad', summary: `No balances or deposit total found — nothing to total${pages}${ocrNote}` };
  }

  const gaps: string[] = [];
  if (!doc.bankAccount?.bank) gaps.push('bank not recognised');
  if (!doc.statementPeriod?.end) gaps.push('no statement period');
  if (!doc.bankAccount?.accountNumber) gaps.push('no account number');
  if (!has(opening) || !has(ending)) gaps.push(!has(opening) && !has(ending) ? 'no opening/ending balance' : !has(opening) ? 'no opening balance' : 'no ending balance');
  if (!has(deposits)) gaps.push('no deposit total');
  if (!doc.statementIdentity?.name && !doc.companyNameGuess) gaps.push('no account-holder name');
  if (doc.truncated && doc.scannedPageCount && doc.pageCount) gaps.push(`read ${doc.scannedPageCount} of ${doc.pageCount} pages`);
  if (doc.reconciliation?.reconciles === false) gaps.push(`does not reconcile (Δ ${doc.reconciliation.difference ?? '?'})`);

  if (!gaps.length) {
    const proof = doc.reconciliation?.reconciles === true ? '; balances reconcile' : '';
    return { verdict: 'good', summary: `Bank, period, balances and deposits found${proof}${ocrNote}` };
  }
  return { verdict: 'partial', summary: `Read, but ${list(gaps)}${ocrNote}` };
}

/**
 * What actually came out of one document, and why it falls short when it
 * does -- judged on the data extracted, not on whether processing finished.
 * A file can finish "complete" and still have given up nothing usable.
 */
export function diagnoseDocument(doc: ScannerDocument, lead?: ScannerLead): Diagnosis {
  if (PENDING.has(doc.processingStatus)) return { verdict: 'pending', summary: '' };
  if (doc.duplicateOfFileId) return { verdict: 'excluded', summary: 'Duplicate of an already-scanned file — excluded from company totals' };
  if (doc.processingStatus === 'skipped') return { verdict: 'excluded', summary: doc.processingErrorMessage || 'Skipped by the revenue exclusion threshold' };
  if (doc.processingStatus === 'failed') return { verdict: 'bad', summary: doc.processingErrorMessage || 'Processing failed' };
  if (doc.processingStatus === 'stopped') return { verdict: 'pending', summary: 'Stopped before it finished — restart to read it' };

  let diagnosis: Diagnosis;
  if (doc.docType === 'application') diagnosis = diagnoseApplication(doc);
  else if (doc.docType === 'bank_statement') diagnosis = diagnoseStatement(doc);
  else if (doc.needsOcr && !doc.usedOcr) diagnosis = { verdict: 'bad', summary: 'Scanned image — no usable text layer, nothing read yet. Needs OCR' };
  else {
    const chars = Number(doc.textQuality && (doc.textQuality as { charCount?: number }).charCount) || 0;
    diagnosis = { verdict: 'bad', summary: `Not recognised as a bank statement or an application (${chars} characters of text)` };
  }

  // Where the file landed matters as much as what it holds: a statement with
  // no application beside it leaves Owner/Phone/Email/BSD blank on its row.
  if (lead && diagnosis.verdict !== 'bad') {
    if (doc.docType === 'bank_statement' && !lead.application) diagnosis.summary += ' · no application for this company';
    if (doc.docType === 'application' && lead.statements.length === 0) diagnosis.summary += ' · no statements matched to it';
  }
  return diagnosis;
}

/** Verdicts for every document, by fileId, with each document's own lead as context. */
export function diagnoseAll(documents: ScannerDocument[], leads: ScannerLead[]) {
  const leadOf = new Map<string, ScannerLead>();
  leads.forEach((lead) => lead.docs.forEach((doc) => leadOf.set(doc.fileId, lead)));
  const out = new Map<string, Diagnosis & { company: string | null }>();
  documents.forEach((doc) => {
    const lead = leadOf.get(doc.fileId);
    out.set(doc.fileId, { ...diagnoseDocument(doc, lead), company: lead?.companyName ?? null });
  });
  return out;
}
