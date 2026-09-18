import { money } from './format';
import { potentialApproval } from './displayRules';
import type { ScannerLead } from '../types/scanner';

export function buildSalesPitch(lead: ScannerLead) {
  const statement = lead.statements[0] ?? lead.mtdDocs[0];
  const expense = (statement?.expenses as any)?.largestRecurringExpense;
  const mca = (statement?.mcaPositions as any[])?.[0];
  const approval = potentialApproval(lead.revenue);
  const pressure = mca?.funder
    ? `${mca.funder} is taking about ${money(mca.estimatedMonthlyBurden)} per month.`
    : expense?.counterparty
      ? `${expense.counterparty} is the largest repeated cash-flow pressure.`
      : 'The statements do not show one verified recurring pressure yet.';
  return `${lead.companyName} is showing about ${money(lead.revenue)} in monthly revenue. ${pressure} A potential ${money(approval)} approval could add working cash without guessing beyond the documents we scanned.`;
}
