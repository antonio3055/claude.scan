/**
 * Balance-equation tests.
 *
 * Every layout below is copied from a real statement in the supplied batch —
 * the same rows, the same signs, the same reconstruction artefacts — with
 * account numbers and personal identifiers replaced. Each one is checked
 * against the figures printed on that statement, so a pass means the engine
 * read the bank's own arithmetic, not that it produced a plausible number.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReporter } from './lib/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['coreUtils', 'balanceEquation', 'summaryExtractor', 'reconciliation']) {
  await import(pathToFileURL(path.join(root, 'src/scanner/engine', `${name}.js`)));
}
const E = globalThis.ScannerEngine;
const reporter = createReporter('Balance equation tests');
const test = (name, run) => reporter.check(name, run);
const done = () => reporter.done();

const solve = (text) => E.balanceEquation.solveBalanceEquation(text);

/** Chase: the sign is printed on the number, and a count sits before it. */
const CHASE = `
Beginning Balance $381.64
Deposits and Additions 22 19,441.82
ATM & Debit Card Withdrawals 12 -3,405.57
Electronic Withdrawals 18 -13,928.51
Other Withdrawals 1 -1,000.00
Fees 4 -143.00
Ending Balance 57 $1,346.38
`;

await test('Chase block is verified', () => assert.equal(solve(CHASE).verified, true));
await test('Chase beginning balance', () => assert.equal(solve(CHASE).beginning, 381.64));
await test('Chase ending balance', () => assert.equal(solve(CHASE).ending, 1346.38));
await test('Chase deposits', () => assert.equal(solve(CHASE).deposits, 19441.82));
await test('Chase withdrawals sum all four debit categories', () =>
  assert.equal(solve(CHASE).withdrawals, 18477.08));
await test('Chase equation closes exactly', () => assert.equal(solve(CHASE).difference, 0));

/** Commerce: the sign is a separate token before the figure. */
const COMMERCE = `
Beginning Balance on January 1, 2026 $ 107.40
Deposits & Other Credits + 29,724.58
ATM Withdrawals & Debits - 62.88
Debit Card Purchases & Debits - 2,724.12
Withdrawals & Other Debits - 14,339.98
Checks Paid - 12,693.41
Ending Balance on January 31, 2026 $ 11.59
`;

await test('Commerce block is verified', () => assert.equal(solve(COMMERCE).verified, true));
await test('Commerce deposits', () => assert.equal(solve(COMMERCE).deposits, 29724.58));
await test('Commerce withdrawals', () => assert.equal(solve(COMMERCE).withdrawals, 29820.39));

/** Truist: the operators sit between the label and the figure. */
const TRUIST = `
Account summary
Your previous balance as of 11/28/2025 $36,835.98
Checks - 0.00
Other withdrawals, debits and service charges - 469,487.69
Deposits, credits and interest + 446,224.73
Your new balance as of 12/31/2025 = $13,573.02
`;

await test('Truist block is verified', () => assert.equal(solve(TRUIST).verified, true));
await test('Truist deposits are the printed credit total', () =>
  assert.equal(solve(TRUIST).deposits, 446224.73));
await test('Truist withdrawals are the printed debit total', () =>
  assert.equal(solve(TRUIST).withdrawals, 469487.69));

/** Regions: a two-column layout scatters the signs onto their own rows. */
const SCATTERED_SIGNS = `
SUMMARY
Beginning Balance $17,454.70 Minimum Daily Balance $9,791 -
Deposits & Credits $186,766.59 + Average Monthly Statement Balance $22,090
-
Withdrawals $199,376.29
Fees $40.00 -
+
Automatic Transfers $0.00
Returned Checks $22,888.95 +
Checks $4,276.31 -
Ending Balance $23,417.64
`;

await test('scattered-sign block is verified', () => assert.equal(solve(SCATTERED_SIGNS).verified, true));
await test('a trailing sign after a later figure does not reach the balance', () =>
  assert.equal(solve(SCATTERED_SIGNS).beginning, 17454.7));
await test('returned checks are read as the credit the bank marked them', () =>
  assert.equal(solve(SCATTERED_SIGNS).deposits, 209655.54));
await test('scattered-sign withdrawals', () => assert.equal(solve(SCATTERED_SIGNS).withdrawals, 203692.6));

/** The same layout with an overdrawn closing balance, signed on the row above. */
const OVERDRAWN_END = `
SUMMARY
Beginning Balance $23,417.64 Minimum Daily Balance $10,228 -
Deposits & Credits $117,728.67 + Average Monthly Statement Balance $9,793
-
Withdrawals $151,169.77
Fees $0.00 -
+
Automatic Transfers $0.00
Returned Checks $10,883.44 +
Checks $2,659.82 -
-
Ending Balance $1,799.84
`;

await test('an overdrawn ending balance is read as negative', () =>
  assert.equal(solve(OVERDRAWN_END).ending, -1799.84));
await test('overdrawn block still verifies', () => assert.equal(solve(OVERDRAWN_END).verified, true));

/** The same layout with an overdrawn opening balance, signed on the row. */
const OVERDRAWN_START = `
SUMMARY
Beginning Balance $1,799.84 - Minimum Daily Balance $7,300 -
Deposits & Credits $250,686.96 + Average Monthly Statement Balance $10,855
-
Withdrawals $171,403.32
Fees $87.00 -
+
Automatic Transfers $0.00
Returned Checks $26,772.00 +
Checks $18,342.10 -
Ending Balance $85,826.70
`;

await test('an overdrawn opening balance is read as negative', () =>
  assert.equal(solve(OVERDRAWN_START).beginning, -1799.84));
await test('overdrawn opening still verifies', () => assert.equal(solve(OVERDRAWN_START).verified, true));

/** Bank of America: an average-balance statistic sits inside the block. */
const WITH_STATISTIC = `
Beginning balance on January 1, 2026 $17,163.93
# of deposits/credits: 55
Deposits and other credits 123,176.10
# of withdrawals/debits: 40
Withdrawals and other debits -131,167.43
# of items-previous cycle: 1
Checks -927.81
# of days in cycle: 31
Service fees -2.70
Average ledger balance: $4,857.46
Ending balance on January 31, 2026 $8,242.09
`;

await test('a statistic printed inside the block does not break the equation', () =>
  assert.equal(solve(WITH_STATISTIC).verified, true));
await test('the statistic is left out of the totals', () =>
  assert.equal(solve(WITH_STATISTIC).withdrawals, 132097.94));
await test('deposits are unaffected by the statistic', () =>
  assert.equal(solve(WITH_STATISTIC).deposits, 123176.1));

/** Texas Capital: a posting date sits before each label. */
const DATED_LABELS = `
STATEMENT SUMMARY TX Small Business Checking Account No ****0000
01/01/2026 Beginning Balance $19,561.60
24 Deposits/Other Credits + $45,153.22
40 Checks/Other Debits - $56,233.41
01/31/2026 Ending Balance 31 Days in Statement Period $8,481.41
`;

await test('a dated label row is still recognised', () => assert.equal(solve(DATED_LABELS).verified, true));
await test('dated-label deposits', () => assert.equal(solve(DATED_LABELS).deposits, 45153.22));
await test('dated-label withdrawals', () => assert.equal(solve(DATED_LABELS).withdrawals, 56233.41));
await test('the day count is not mistaken for a figure', () =>
  assert.equal(solve(DATED_LABELS).ending, 8481.41));

/** Old National: one category prints no sign at all. */
const UNSIGNED_CATEGORY = `
ACCOUNT SUMMARY
Previous Statement Balance 12/31/2025 $3,587.62
Deposits/Credits 23 $32,268.60
Withdrawals/Debits 56 -$31,764.93
Total Service Charges $0.00
Interest Paid $0.00
Current Statement Balance 01/31/2026 $4,091.29
`;

await test('an unsigned category is classified and the block verifies', () =>
  assert.equal(solve(UNSIGNED_CATEGORY).verified, true));
await test('unsigned deposits', () => assert.equal(solve(UNSIGNED_CATEGORY).deposits, 32268.6));
await test('unsigned withdrawals', () => assert.equal(solve(UNSIGNED_CATEGORY).withdrawals, 31764.93));

/** Labels in one column and figures in another, split across rows. */
const SPLIT_COLUMNS = `
Beginning balance
$10,000.00
Deposits & Credits
$25,000.00
Withdrawals
$5,000.00
Ending balance
$30,000.00
`;

await test('a label split from its figure is rejoined', () => assert.equal(solve(SPLIT_COLUMNS).verified, true));
await test('split-column deposits', () => assert.equal(solve(SPLIT_COLUMNS).deposits, 25000));
await test('split-column ending', () => assert.equal(solve(SPLIT_COLUMNS).ending, 30000));

/** KeyPoint: a column table whose header prints the operators. */
const OPERATOR_TABLE = `
ELITE BUSINESS CHECKING Account No. 000000000
Beginning Dividend Service Ending
Balance + Deposits + Paid - Withdrawals - Charges = Balance
$44,355.15 $122,832.82 $0.00 $159,610.24 $8.10 $7,569.63
Post Date Transaction Description Withdrawal Deposit Balance
`;

await test('a column table is verified', () => assert.equal(solve(OPERATOR_TABLE).verified, true));
await test('column table reports the table layout', () => assert.equal(solve(OPERATOR_TABLE).layout, 'column_table'));
await test('column-table deposits', () => assert.equal(solve(OPERATOR_TABLE).deposits, 122832.82));
await test('column-table withdrawals include the service charge', () =>
  assert.equal(solve(OPERATOR_TABLE).withdrawals, 159618.34));

/** PNC: a column table whose header wraps and prints no operators. */
const WRAPPED_HEADER_TABLE = `
Balance Summary
Beginning Deposits and Checks and other Ending
balance other additions deductions balance
3,367.61 54,172.17 57,054.79 484.99
Average ledger Average collected
`;

await test('a wrapped column header is verified', () => assert.equal(solve(WRAPPED_HEADER_TABLE).verified, true));
await test('wrapped-header deposits', () => assert.equal(solve(WRAPPED_HEADER_TABLE).deposits, 54172.17));
await test('wrapped-header withdrawals', () => assert.equal(solve(WRAPPED_HEADER_TABLE).withdrawals, 57054.79));

/** Bluestone: one row per account; the operating account is the busy one. */
const MULTI_ACCOUNT_TABLE = `
MEMBERSHIP SUMMARY INFORMATION FOR MEMBER # 00000
Beginning
Suffix Account Description Total Debits Total Credits Ending Balance Last Tran
Balance
000 OWNERSHIP SHARE 151.66 5,500.00 6,996.71 1,648.37 1/27/26
050 MICRO BUSINESS DRAFT 1,850.00 239,463.37 269,683.04 32,069.67 1/30/26
`;

await test('a multi-account table is verified', () => assert.equal(solve(MULTI_ACCOUNT_TABLE).verified, true));
await test('the operating account is chosen, not the share account', () =>
  assert.equal(solve(MULTI_ACCOUNT_TABLE).deposits, 269683.04));
await test('operating-account withdrawals', () =>
  assert.equal(solve(MULTI_ACCOUNT_TABLE).withdrawals, 239463.37));
await test('operating-account ending balance', () =>
  assert.equal(solve(MULTI_ACCOUNT_TABLE).ending, 32069.67));
await test('how many accounts were on the statement is reported', () =>
  assert.equal(solve(MULTI_ACCOUNT_TABLE).accountsInTable, 2));

/** A block that does not add up must never be reported as the bank's total. */
const BROKEN = `
Beginning Balance $1,000.00
Deposits & Credits $5,000.00
Withdrawals $2,000.00
Ending Balance $9,999.99
`;

await test('a block that does not add up is not verified', () => assert.equal(solve(BROKEN).verified, false));
await test('an unproven block still reports what it read', () => assert.equal(solve(BROKEN).deposits, 5000));
await test('an unproven block reports how far out it is', () => assert.equal(solve(BROKEN).difference, -5999.99));

await test('a document with no summary yields no equation', () =>
  assert.equal(solve('Application for business funding\nLegal company name: Test LLC'), null));

/** Farmers Bank, read by OCR: the balances are named after the statements. */
const STATEMENT_NAMED_BALANCES = `
BUSINESS CHECKING ACCOUNT XXXXXX0000
LAST STATEMENT 12/31/25 56,002.94
60 CREDITS 487,393.71
72 DEBITS 374,202.29
THIS STATEMENT 01/30/26 169,194.36
TOTAL DAYS IN STATEMENT PERIOD 01/01/26 THROUGH 01/30/26: 30
`;

await test('balances named after the statements are recognised', () =>
  assert.equal(solve(STATEMENT_NAMED_BALANCES).verified, true));
await test('statement-named opening balance', () =>
  assert.equal(solve(STATEMENT_NAMED_BALANCES).beginning, 56002.94));
await test('statement-named credits', () =>
  assert.equal(solve(STATEMENT_NAMED_BALANCES).deposits, 487393.71));
await test('statement-named debits', () =>
  assert.equal(solve(STATEMENT_NAMED_BALANCES).withdrawals, 374202.29));

/**
 * IMCU, read by OCR: two accounts, the label sits mid-row after the account
 * name, the figures sit mid-row after their own labels, and year-to-date
 * dividend statistics are printed inside the block.
 */
const MID_ROW_LABELS = `
Your Account Balances as of 01/31
MEMBERSHIP SAVINGS ID 0001 Beginning Balance $6.57
0 Total Deposits for 0.00
Dividends Paid in 2025 $5.66 0 Total Withdrawals for 0.00
Ending Balance 6.57
PREFERRED BUSINESS CHECKING ID 0010 Beginning Balance $22,414.43
Total Dividends Paid Year-To-Date $1.76 85 Total Deposits for 75,505.32
Dividends Paid in 2025 $64.85 66 Total Withdrawals for 89,234.31
Annual Percentage Yield earned 0.240% Ending Balance 8,685.44
Date Transaction Description Withdrawal Deposit Balance
`;

await test('a mid-row balance label is recognised', () =>
  assert.equal(solve(MID_ROW_LABELS).verified, true));
await test('the checking account is reported, not the savings account', () =>
  assert.equal(solve(MID_ROW_LABELS).beginning, 22414.43));
await test('mid-row deposits', () => assert.equal(solve(MID_ROW_LABELS).deposits, 75505.32));
await test('mid-row withdrawals', () => assert.equal(solve(MID_ROW_LABELS).withdrawals, 89234.31));
await test('dividends printed inside the block are left out of the totals', () =>
  assert.equal(solve(MID_ROW_LABELS).ending, 8685.44));
await test('both account blocks are counted', () =>
  assert.equal(solve(MID_ROW_LABELS).accountsInBlock, 2));

/** Wells Fargo: the account number sits in the first column of the table. */
const ACCOUNT_NUMBER_COLUMN = `
Account summary
WellsOne Account
Account number Beginning balance Total credits Total debits Ending balance
4474485638 $74,953.21 $247,648.93 -$316,016.74 $6,585.40
Credits
`;

await test('an account number is not read as the opening balance', () =>
  assert.equal(solve(ACCOUNT_NUMBER_COLUMN).beginning, 74953.21));
await test('the account-number table verifies', () =>
  assert.equal(solve(ACCOUNT_NUMBER_COLUMN).verified, true));
await test('account-number table credits', () =>
  assert.equal(solve(ACCOUNT_NUMBER_COLUMN).deposits, 247648.93));
await test('account-number table debits', () =>
  assert.equal(solve(ACCOUNT_NUMBER_COLUMN).withdrawals, 316016.74));

/** The same table where credits and debits are equal, so only the header says which is which. */
const HEADER_NAMES_THE_COLUMNS = `
Account number Beginning balance Total credits Total debits Ending balance
9606001106 $0.00 $36,996.11 -$36,996.11 $0.00
`;

await test('the header names which column is which when the figures cannot say', () => {
  const equation = solve(HEADER_NAMES_THE_COLUMNS);
  assert.equal(equation.verified, true);
  assert.equal(equation.deposits, 36996.11);
  assert.equal(equation.withdrawals, 36996.11);
});

/** Comerica: the summary is set beside a column of addresses and phone numbers. */
const INTERLEAVED_ADDRESS_COLUMN = `
Account summary
Call
(800) 266-3742
Hearing impaired (TDD 800 822-6546)
Beginning balance
$14,137.90
on January 1, 2026
Visit our web site
www.comerica.com
Plus deposits
Electronic deposits $379,856.94 Write to us
............................................................
COMERICA BANK
Transfers from other accounts $20,000.00
P.O. BOX 650282
............................................................
DALLAS, TX 75265-0282
Less withdrawals
Electronic (EFT) withdrawals -$376,308.65
............................................................
Fees and service charges -$40.00
............................................................
Transfers to other accounts -$4,000.00
The Account Balance Fee for this statement
period for this account is $0.00/$1,000.
Ending balance
$33,646.19
on January 31, 2026
`;

await test('a summary interleaved with an address column still verifies', () =>
  assert.equal(solve(INTERLEAVED_ADDRESS_COLUMN).verified, true));
await test('a telephone number is not read as an amount', () =>
  assert.equal(solve(INTERLEAVED_ADDRESS_COLUMN).beginning, 14137.9));
await test('a PO box and a postcode are not read as amounts', () =>
  assert.equal(solve(INTERLEAVED_ADDRESS_COLUMN).deposits, 399856.94));
await test('interleaved withdrawals', () =>
  assert.equal(solve(INTERLEAVED_ADDRESS_COLUMN).withdrawals, 380348.65));
await test('interleaved closing balance', () =>
  assert.equal(solve(INTERLEAVED_ADDRESS_COLUMN).ending, 33646.19));

/** The same bank, where a foreign row lands between a label and its figure. */
const LABEL_SPLIT_BY_A_FOREIGN_ROW = `
Beginning balance
$233,365.59
on March 1, 2026
Plus deposits
Electronic deposits $291,944.10
Transfers from other accounts $30,000.00
Less withdrawals
Electronic (EFT) withdrawals -$482,574.21
Fees and service charges -$40.00
Transfers to other accounts -$3,000.00
The Account Balance Fee for this statement
Ending balance
period for this account is $0.00/$1,000.
$39,695.48
on March 31, 2026
`;

await test('a label separated from its figure by another row still pairs', () =>
  assert.equal(solve(LABEL_SPLIT_BY_A_FOREIGN_ROW).ending, 39695.48));
await test('the split-label block verifies', () =>
  assert.equal(solve(LABEL_SPLIT_BY_A_FOREIGN_ROW).verified, true));

/** Access FCU: the figure is printed above its own label. */
const FIGURE_ABOVE_LABEL = `
BUSINESS SHARE DRAFT CHECKING ID 0061
Beginning Balance $3,691.07
Total Deposits $1,000.00
Total Withdrawals $1,973.08
$2,717.99
Ending Balance
`;

await test('a figure printed above its label is still read', () =>
  assert.equal(solve(FIGURE_ABOVE_LABEL).ending, 2717.99));
await test('the figure-above-label block verifies', () =>
  assert.equal(solve(FIGURE_ABOVE_LABEL).verified, true));

/** First Fidelity: statistics sit beside the totals, equal and offsetting. */
const OFFSETTING_STATISTICS = `
Previous Balance 10.00 Days This Statement Period 31
9 Deposits/Credits 140,000.00 Average Ledger 7,622.90
9 Checks/Debits 140,000.00 Average Collected 7,622.90
Service Charge .00
Interest Paid .00
Current Balance 10.00
`;

await test('an equal pair of statistics is not read as movement', () => {
  const equation = solve(OFFSETTING_STATISTICS);
  assert.equal(equation.verified, true);
  assert.equal(equation.deposits, 140000);
  assert.equal(equation.withdrawals, 140000);
});

/** The same bank, where the closing balance is under a dollar. */
const AMOUNT_WITHOUT_A_LEADING_ZERO = `
Previous Balance 10.00 Days This Statement Period 32
9 Deposits/Credits 261,182.23 Average Ledger 7,045.14
10 Checks/Debits 261,191.80 Average Collected 4,452.25
Service Charge .00
Interest Paid .00
Current Balance .43
`;

await test('an amount written without its leading zero is read', () =>
  assert.equal(solve(AMOUNT_WITHOUT_A_LEADING_ZERO).ending, 0.43));
await test('the block with a sub-dollar balance verifies', () =>
  assert.equal(solve(AMOUNT_WITHOUT_A_LEADING_ZERO).verified, true));
await test('a decimal inside a larger figure is not read as its own amount', () => {
  const hits = solve('Beginning Balance 1,234.56\nDeposits 10.00\nEnding Balance 1,244.56');
  assert.equal(hits.beginning, 1234.56);
  assert.equal(hits.ending, 1244.56);
});

/** Wells Fargo: the account is overdrawn and the table says so on the figure. */
const OVERDRAWN_TABLE = `
Account summary
Analyzed Business Checking
Account number Beginning balance Total credits Total debits Ending balance
3319125179 $7,141.84 $119,387.30 -$126,808.58 -$279.44
Credits
`;

await test('an overdrawn closing balance in a table is read as negative', () =>
  assert.equal(solve(OVERDRAWN_TABLE).ending, -279.44));
await test('the overdrawn table verifies', () => assert.equal(solve(OVERDRAWN_TABLE).verified, true));
await test('overdrawn table credits', () => assert.equal(solve(OVERDRAWN_TABLE).deposits, 119387.3));
await test('overdrawn table debits', () => assert.equal(solve(OVERDRAWN_TABLE).withdrawals, 126808.58));

/** US Bank: the sign is printed after the figure, and counts sit before it. */
const TRAILING_SIGNS_AND_COUNTS = `
Account Summary
# Items
Number of Days in Statement Period 31
Beginning Balance on Dec 1 $ 19,310.56
Other Deposits 87 90,930.37
Card Withdrawals 168 21,767.97-
Other Withdrawals 64 50,926.35-
Checks Paid 40 29,772.55-
Ending Balance on Dec 31, 2025 $ 7,774.06
`;

await test('trailing minus signs and item counts are read correctly', () => {
  const equation = solve(TRAILING_SIGNS_AND_COUNTS);
  assert.equal(equation.verified, true);
  assert.equal(equation.deposits, 90930.37);
  assert.equal(equation.withdrawals, 102466.87);
  assert.equal(equation.ending, 7774.06);
});

/* ---------- what counts as a printed amount ---------- */

await test('a page of structural markers holds no amounts', () =>
  assert.equal(E.balanceEquation.hasPrintedAmounts('*start*summary\n*end*summary\nPage of'), false));
await test('an address and a PO box hold no amounts', () =>
  assert.equal(E.balanceEquation.hasPrintedAmounts('P O Box 182051\nColumbus, OH 43218 - 2051'), false));
await test('a real statement line holds an amount', () =>
  assert.equal(E.balanceEquation.hasPrintedAmounts('Ending Balance $1,346.38'), true));
await test('an amount without a currency mark still counts', () =>
  assert.equal(E.balanceEquation.hasPrintedAmounts('Deposits and Additions 22 19,441.82'), true));

/* ---------- the summary extractor and reconciliation on top ---------- */

await test('the extractor prefers the proven equation', () => {
  const summary = E.summaryExtractor.extractSummary(CHASE, { usedOcr: false });
  assert.equal(summary.deposits, 19441.82);
  assert.equal(summary.withdrawals, 18477.08);
  assert.equal(summary.confidence, 99);
});

await test('the extractor marks an unproven reading down', () => {
  const summary = E.summaryExtractor.extractSummary(BROKEN, { usedOcr: false });
  assert.equal(summary.confidence, 40);
});

await test('a proven equation reconciles the statement', () => {
  const result = E.reconciliation.reconcile({
    opening: 381.64,
    ending: 1346.38,
    transactions: [],
    equation: solve(CHASE),
  });
  assert.equal(result.reconciles, true);
  assert.equal(result.source, 'statement_balance_equation');
  assert.equal(result.difference, 0);
});

await test('a proven equation reconciles even when only some pages were read', () => {
  const result = E.reconciliation.reconcile({
    opening: 381.64,
    ending: 1346.38,
    transactions: [],
    equation: solve(CHASE),
    transactionsComplete: false,
  });
  assert.equal(result.reconciles, true);
});

await test('without an equation, a part-read statement withholds the verdict', () => {
  const result = E.reconciliation.reconcile({
    opening: 100,
    ending: 200,
    transactions: [{ amount: 100, direction: 'credit' }],
    equation: null,
    transactionsComplete: false,
  });
  assert.equal(result.reconciles, null);
  assert.equal(result.reason, 'statement_truncated');
});

await test('without an equation, complete transactions still reconcile', () => {
  const result = E.reconciliation.reconcile({
    opening: 100,
    ending: 200,
    transactions: [{ amount: 100, direction: 'credit' }],
    equation: null,
    transactionsComplete: true,
  });
  assert.equal(result.reconciles, true);
  assert.equal(result.source, 'transactions');
});

await test('a transaction mismatch is still reported as a mismatch', () => {
  const result = E.reconciliation.reconcile({
    opening: 100,
    ending: 500,
    transactions: [{ amount: 100, direction: 'credit' }],
    equation: null,
    transactionsComplete: true,
  });
  assert.equal(result.reconciles, false);
  assert.equal(result.difference, -300);
});

done();
