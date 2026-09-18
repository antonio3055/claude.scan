import type { ScannerLead } from '../types/scanner';
import { roundDisplayAmount, potentialApproval } from './displayRules';

const HEADER = [
  'Company', 'Owner', 'Revenue', 'Approval', 'Phone', 'Email', 'Address', 'App date', 'Statements', 'Bank',
  'BSD', 'MCA', 'Score', 'Status', 'Duplicates excluded'
];

function statementsText(lead: ScannerLead): string {
  return lead.statements
    .filter((d) => d.processingStatus === 'complete' || d.processingStatus === 'needs_review')
    .map((d) => {
      const deposits = d.deposits?.trueRevenue ?? d.deposits?.totalDeposits;
      const ending = d.balances?.ending;
      return `${d.statementPeriod?.end ?? d.filename} • $${deposits ?? '—'} • $${ending ?? '—'}`;
    })
    .join(' · ');
}

function mcaText(lead: ScannerLead): string {
  const positions = lead.statements.flatMap((d) => (d.mcaPositions as any[]) ?? []);
  const byFunder = new Map<string, number>();
  for (const p of positions) {
    const name = String(p.funder || 'Unknown lender');
    byFunder.set(name, (byFunder.get(name) ?? 0) + (Number(p.estimatedMonthlyBurden) || 0));
  }
  return [...byFunder.entries()].map(([name, total]) => `${name} • $${Math.round(total)}/mo`).join(' · ');
}

function row(lead: ScannerLead): (string | number | boolean | null)[] {
  const app = lead.application?.application;
  const banks = [...new Set(lead.statements.map((d) => d.bankAccount?.bank).filter(Boolean))] as string[];
  return [
    lead.companyName,
    app?.fullName ?? null,
    roundDisplayAmount(lead.revenue),
    potentialApproval(lead.revenue),
    (app?.phones ?? []).join(' • ') || null,
    (app?.emails ?? []).join(' • ') || null,
    lead.companyInfo.applicationAddress ?? lead.companyInfo.statementAddresses[0] ?? null,
    app?.appDate ?? null,
    statementsText(lead) || null,
    banks.join(' • ') || null,
    app?.businessStartDate ?? null,
    mcaText(lead) || null,
    lead.extractionScore,
    lead.status,
    lead.duplicateCount || null
  ];
}

/**
 * Short and unique on every export, never the same name twice: initials
 * (who ran it, so it's obvious at a glance who it was sent to) + month.day
 * + lead count + an "L" for leads + hour/minute, e.g. "MM9.17.13L1342.xlsx".
 * The minute-level time is what actually guarantees uniqueness -- date and
 * lead count alone collide if the same batch is exported twice in an hour.
 */
function exportFilename(initials: string, leadCount: number): string {
  const now = new Date();
  const stamp = `${now.getMonth() + 1}.${now.getDate()}.${leadCount}L${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${initials ? initials.toUpperCase() : ''}${stamp}.xlsx`;
}

/** Exports exactly what the Results sheet shows: one row per company. */
export async function exportLeadsToXlsx(leads: ScannerLead[], exporterInitials = ''): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = leads.filter((l) => l.companyName !== 'Unassociated');
  const sheet = XLSX.utils.aoa_to_sheet([HEADER, ...rows.map(row)]);
  sheet['!cols'] = HEADER.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Results');
  XLSX.writeFile(workbook, exportFilename(exporterInitials, rows.length));
}
