import type { ScannerDocument, ScannerLead, ScanStatus } from '../types/scanner';

/** A document that won't be touched by the queue again -- done one way or another. */
export const SETTLED_STATUSES: ScanStatus[] = ['complete', 'needs_review', 'failed', 'stopped', 'skipped'];

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

/**
 * One entry per distinct bank+account on a lead's statements, as
 * "Bank Name • AccountNumber" -- the account number is always the full,
 * unmasked value the engine extracted (accountNumber, not
 * accountNumberMasked), exactly as the statement itself prints it. If the
 * bank's own statement only ever shows a masked number (e.g. "XXXXX4439"),
 * that whole masked string is shown as printed -- never trimmed down to a
 * fixed 4 X's.
 */
export function bankAccountEntries(lead: ScannerLead): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const doc of lead.statements) {
    const bank = doc.bankAccount?.bank;
    if (!bank) continue;
    const account = doc.bankAccount?.accountNumber || null;
    const key = `${bank}|${account ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(account ? `${bank} • ${account}` : bank);
  }
  return entries;
}

const SHORT_NAME_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SHORT_NAME_MONTH_WORDS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'
];

/**
 * A guess at company/App/month from the raw filename alone, for display
 * while a file is still mid-scan -- before extraction has produced a real
 * `docType`/`statementPeriod` for `shortDocLabel` to use.
 */
export function shortFilenameLabel(name: string) {
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = base.toLowerCase();
  let company = base
    .replace(/\b(application|app|bank statement|statement|month to date|mtd|final|signed|copy|scan|document)\b/gi, ' ')
    .replace(/\b(20\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let suffix = '';
  if (/month\s*to\s*date|\bmtd\b/i.test(lower)) {
    suffix = 'MTD';
  } else if (/application|\bapp\b/i.test(lower)) {
    suffix = 'App';
  } else {
    const idx = SHORT_NAME_MONTH_WORDS.findIndex((m) => lower.includes(m));
    if (idx >= 0) {
      suffix = SHORT_NAME_MONTHS[idx];
      company = company.replace(new RegExp(SHORT_NAME_MONTH_WORDS[idx], 'ig'), '').replace(/\s+/g, ' ').trim();
    } else {
      const shortIdx = SHORT_NAME_MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, 'i').test(base));
      if (shortIdx >= 0) {
        suffix = SHORT_NAME_MONTHS[shortIdx];
        company = company.replace(new RegExp(`\\b${SHORT_NAME_MONTHS[shortIdx]}\\b`, 'ig'), '').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return [company || base.slice(0, 28), suffix].filter(Boolean).join(' ').slice(0, 46);
}
