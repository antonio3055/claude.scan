import type { ScannerLead } from '../types/scanner';
import { roundDisplayAmount, potentialApproval } from './displayRules';

const HEADER = [
  'Company', 'Owner', 'Phone', 'Email', 'Address', 'App date', 'Statements', 'Bank',
  'Revenue', 'Approval', 'BSD', 'MCA', 'Score', 'Status', 'Duplicates excluded'
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
    (app?.phones ?? []).join(' • ') || null,
    (app?.emails ?? []).join(' • ') || null,
    lead.companyInfo.applicationAddress ?? lead.companyInfo.statementAddresses[0] ?? null,
    app?.appDate ?? null,
    statementsText(lead) || null,
    banks.join(' • ') || null,
    roundDisplayAmount(lead.revenue),
    potentialApproval(lead.revenue),
    app?.businessStartDate ?? null,
    mcaText(lead) || null,
    lead.extractionScore,
    lead.status,
    lead.duplicateCount || null
  ];
}

/** Exports exactly what the Results sheet shows: one row per company. */
export async function exportLeadsToXlsx(leads: ScannerLead[]): Promise<void> {
  const XLSX = await import('xlsx');
  const rows = leads.filter((l) => l.companyName !== 'Unassociated');
  const sheet = XLSX.utils.aoa_to_sheet([HEADER, ...rows.map(row)]);
  sheet['!cols'] = HEADER.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Results');
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `forge-scanner-results-${stamp}.xlsx`);
}
