/**
 * Transaction parsing.
 *
 * The samples are the real layouts from the supplied batch — the ones the old
 * parser read as zero transactions, or flagged two thirds of — with account
 * numbers changed. They run against the production engine.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReporter } from './lib/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['coreUtils', 'textQuality', 'transactionParser']) {
  await import(pathToFileURL(path.join(root, 'src/scanner/engine', `${name}.js`)));
}
const P = globalThis.ScannerEngine.transactionParser;

const reporter = createReporter('Transaction parsing tests');

const sum = (txns, direction) =>
  Number(txns.filter((t) => t.direction === direction).reduce((a, t) => a + (t.amount || 0), 0).toFixed(2));

/* Hyphenated dates under explicit section headings. */
const HYPHEN_SECTIONS = `ACCOUNTS SUMMARY ACCOUNT NUMBER BALANCE YTD DIV
Business Checking 212380547 $2,368.47 $0.00
Beginning balance on January 01, 2026 $16,615.88
DEPOSITS AND OTHER CREDITS
Eff. Trans
Date Date Description Amount
01-22-2026 Deposit Mobile 600.00
01-23-2026 E Deposit BROADWAYNAT5881 6629323 - PAYMENTS 5,459.01
NTE*BROADWAY NATIONAL PAYMENT\\ 15978
01-29-2026 Deposit Funds Transfer via Mobile 2,000.00
TOTAL DEPOSITS AND OTHER CREDITS $8,059.01
WITHDRAWALS AND OTHER DEBITS
01-02-2026 Check 2219 371.45
01-05-2026 POS Withdrawal MINT MOBILE 1550 SCENIC AVE 6.70`;

/* Description first, date beside the amount. */
const TRAILING_DATE = `Daily Balance Summary Account # 475663022
01-02 -432.99 01-14 -20.36 01-23 -160.00
01-05 29.22 01-15 198.22 01-26 -818.64
Deposits & Other Credits Account # 475663022
Date
Description Credited Amount
Online Bnkg Transfer From DDA 1/1/2026 5:13:08 PM 01-02 90.00
Deposit 650825261202 01-02 1,280.00
Withdrawals & Other Debits Account # 475663022
Bus Debit Card Purchase Amazon Mktpl 01-02 19.79`;

await reporter.check('hyphenated dates are parsed, not ignored', async () => {
  const txns = P.parseTransactions(HYPHEN_SECTIONS, { statementYear: 2026 });
  assert.ok(txns.length >= 5, `only ${txns.length} transactions parsed`);
  assert.ok(txns.some((t) => t.date === '2026-01-22'));
});

await reporter.check('the section heading decides direction', async () => {
  const txns = P.parseTransactions(HYPHEN_SECTIONS, { statementYear: 2026 });
  assert.equal(sum(txns, 'credit'), 8059.01);
  assert.equal(sum(txns, 'debit'), 378.15);
});

await reporter.check('nothing is left needing review when sections are present', async () => {
  const txns = P.parseTransactions(HYPHEN_SECTIONS, { statementYear: 2026 });
  assert.equal(txns.filter((t) => t.reviewFlag).length, 0);
});

await reporter.check('a totals line is not a transaction', async () => {
  const txns = P.parseTransactions(HYPHEN_SECTIONS, { statementYear: 2026 });
  assert.ok(!txns.some((t) => t.amount === 8059.01), 'the section total was counted as a transaction');
});

await reporter.check('a wrapped description line is folded into its transaction', async () => {
  const txns = P.parseTransactions(HYPHEN_SECTIONS, { statementYear: 2026 });
  const wrapped = txns.find((t) => t.description.includes('BROADWAYNAT5881'));
  assert.ok(wrapped.description.includes('NTE*BROADWAY'), 'continuation line was dropped');
});

await reporter.check('a description-first layout with a trailing date is parsed', async () => {
  const txns = P.parseTransactions(TRAILING_DATE, { statementYear: 2026 });
  assert.equal(sum(txns, 'credit'), 1370);
  assert.equal(sum(txns, 'debit'), 19.79);
});

await reporter.check('a daily balance table is not read as transactions', async () => {
  const txns = P.parseTransactions(TRAILING_DATE, { statementYear: 2026 });
  assert.ok(!txns.some((t) => t.amount === 432.99), 'a daily balance row became a transaction');
  assert.ok(!txns.some((t) => t.amount === 818.64), 'a daily balance row became a transaction');
});

await reporter.check('prose mentioning the section words does not flip the section', async () => {
  const text = `DEPOSITS AND OTHER CREDITS
01-02-2026 Deposit Mobile 600.00
To calculate a daily running balance, subtract checks and other debits as of the date they are listed as paid. For ATM and Debit Card withdrawals, use the transaction date.
01-03-2026 Deposit Mobile 400.00`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(sum(txns, 'credit'), 1000, 'a sentence was read as the debits heading');
  assert.equal(sum(txns, 'debit'), 0);
});

await reporter.check('an explicit minus sign beats the section', async () => {
  const text = `DEPOSITS AND OTHER CREDITS
01-02-2026 Reversal -250.00`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(txns[0].direction, 'debit');
  assert.equal(txns[0].directionSource, 'sign');
});

await reporter.check('a DR/CR tag beats the section', async () => {
  const text = `DEPOSITS AND OTHER CREDITS
01-02-2026 ADJUSTMENT DR 120.00`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(txns[0].direction, 'debit');
  assert.equal(txns[0].directionSource, 'tag');
});

await reporter.check('without a section, keywords still decide', async () => {
  const text = `01/05/2026 MERCHANT SERVICE MERCH DEP 253.50
01/06/2026 POS Purchase Coffee 4.25`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(txns[0].direction, 'credit');
  assert.equal(txns[0].directionSource, 'keyword');
  assert.equal(txns[1].direction, 'debit');
});

await reporter.check('a healthcare claim payment is read as money in', async () => {
  const txns = P.parseTransactions('01/05/2026 Hmp Hcclaimpmt Admire Care Ll 92626253 480.00', { statementYear: 2026 });
  assert.equal(txns[0].direction, 'credit');
});

await reporter.check('the same cheque listed twice is counted once', async () => {
  const text = `WITHDRAWALS AND OTHER DEBITS
01-28-2026 Check 1812 557.80
Checks Paid
01-28-2026 Check 1812 557.80`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(sum(txns, 'debit'), 557.8, 'the repeated cheque listing was counted twice');
});

await reporter.check('two different cheques are both kept', async () => {
  const text = `Checks Paid
01-28-2026 Check 1812 557.80
01-29-2026 Check 1813 200.00`;
  const txns = P.parseTransactions(text, { statementYear: 2026 });
  assert.equal(sum(txns, 'debit'), 757.8);
});

await reporter.check('section detection only fires on short headings', async () => {
  assert.equal(P.sectionOf('DEPOSITS AND OTHER CREDITS'), 'credit');
  assert.equal(P.sectionOf('WITHDRAWALS AND OTHER DEBITS - CONTINUED'), 'debit');
  assert.equal(P.sectionOf('Daily Balance Summary Account # 475663022'), 'ignore');
  assert.equal(P.sectionOf('Refer to the Deposits and Other Credits section of the statement for exact amounts.'), null);
  assert.equal(P.sectionOf('deposits shown on'), null);
  assert.equal(P.sectionOf(''), null);
});

await reporter.check('two-digit and four-digit years both work', async () => {
  const a = P.parseTransactions('DEPOSITS\n01/05/26 Deposit 10.00', { statementYear: 2026 })[0];
  const b = P.parseTransactions('DEPOSITS\n01/05/2026 Deposit 10.00', { statementYear: 2026 })[0];
  assert.equal(a.date, '2026-01-05');
  assert.equal(b.date, '2026-01-05');
});

await reporter.check('a missing year falls back to the statement year', async () => {
  const txns = P.parseTransactions('DEPOSITS\n03-14 Deposit 10.00', { statementYear: 2025 });
  assert.equal(txns[0].date, '2025-03-14');
});

await reporter.check('a line with no amount is flagged, not guessed', async () => {
  const txns = P.parseTransactions('01/05/2026 SOMETHING WITH NO AMOUNT', { statementYear: 2026 });
  assert.equal(txns[0].amount, null);
  assert.equal(txns[0].reviewFlag, true);
});

await reporter.check('empty and missing text return no transactions', async () => {
  assert.deepEqual(P.parseTransactions('', {}), []);
  assert.deepEqual(P.parseTransactions(null, {}), []);
  assert.deepEqual(P.parseTransactions(undefined), []);
});

await reporter.check('amounts parse with currency, commas, parens and trailing minus', async () => {
  assert.equal(P.parseAmount('$1,234.56'), 1234.56);
  assert.equal(P.parseAmount('(1,234.56)'), -1234.56);
  assert.equal(P.parseAmount('-1,234.56'), -1234.56);
  assert.equal(P.parseAmount('1,234.56-'), -1234.56);
  assert.equal(P.parseAmount(''), null);
  assert.equal(P.parseAmount(null), null);
});

reporter.done();
