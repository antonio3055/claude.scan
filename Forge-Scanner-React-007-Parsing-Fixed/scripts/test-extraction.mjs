/**
 * Extraction fixes: document classification and business-name recovery.
 *
 * The text samples below are taken from the real documents in the supplied
 * batch — the same wording the engine failed on — with account numbers and
 * personal identifiers replaced. They run against the production engine.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReporter } from './lib/report.mjs';
import { joinRow, rebuildRows, spaceThreshold } from '../src/scanner/services/pdfRows.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = [
  'coreUtils',
  'textQuality',
  'bankRecognizer',
  'companyName',
  'summaryExtractor',
  'accountNumber',
  'statementDate',
  'transactionParser',
  'reconciliation',
  'depositAnalysis',
  'expenseAnalysis',
  'nsfDetector',
  'mcaDetector',
  'cashFlow',
  'confidenceEngine',
  'applicationExtractor',
  'companyAggregator',
  'reviewWorkflow',
  'pipeline'
];
for (const name of modules) {
  await import(pathToFileURL(path.join(root, 'src/scanner/engine', `${name}.js`)));
}
const E = globalThis.ScannerEngine;

const reporter = createReporter('Extraction tests');

/* ---------------------------------------------------------------- *
 * Real samples
 * ---------------------------------------------------------------- */

const APPLICATION = `Company Information
Legal Company Name: 1950'S Original
Website: Industry: Restaurant Food Truck
Incorporation State: NJ Tax ID: 00-0000000 Legal Entity: LLC Corp Sole Prop.
Business Address: 325 Broadway City: Westwood State: NJ Zip: 07675
Business Start Date: 2023-04-28 0:00:00 Business Telephone#: 0000000000
Average Monthly Revenue:$ 41372.97 Monthly Credit Card Processing:$
Requested Financing Amount:$ Use of Funds:
Existing Business Loan\\Advance? If yes, list the loan balance:$
Business Owner Information(1) Business Owner Information(2)
Full Name: Michael Materasso
% Ownership:
Social Security NO: 000-00-0000
Date of Birth: 1962-07-07 0:00:00
AUTHORIZATIONS`;

const STATEMENT_CREDIT_UNION = `Account Statement
The Cash Back
Credit Union
F I N A N C I A L
400 Town Center Drive, Dearborn, MI 48126
Page 1 of 4
Member Number 000000000
From 01/01/26 Thru 01/31/26
ACS MAINTENANCE SERVICES INC
4443 EMERSON AVE SOUTH ST
SAINT PETERSBURG FL 33711
ACCOUNTS SUMMARY ACCOUNT NUMBER BALANCE YTD DIV
Business Checking 212380547 $2,368.47 $0.00
Beginning balance on January 01, 2026 $16,615.88
Deposits and other credits $11,085.35
Withdrawals and other debits $25,330.76
Ending balance on January 31, 2026 $2,368.47`;

const STATEMENT_WITH_DBA = `339
4Bs Entertainment LLC
DBA Biele Street Pub and Liquors
1100 Shapiro Dr
Festus MO 63028-2300
Bank Statement
Primary Account Number: 000000000
Statement Date: January 31, 2026
Account Summary
Beginning Balance on January 1, 2026 $ 107.40
Deposits & Other Credits + 29,724.58
Ending Balance on January 31, 2026 $ 11.59`;

const STATEMENT_NOISY = `ACCESS BUSINESS BANKING
P. O. Box 718
ACCOUNT INFORMATION
Evansville, IN 47705
DATE 01/31/2026
ACCOUNT NUMBER XXXXXX8830
PAGE 1 OF 6
APBKFPBOBLEKBLBIGPAJEMFK
AKCONDGPJPEOLEPMLKGPLOKK
CLIENT CARE CONTACT INFORMATION
A-1 SERVICES GOES ANYWHERE LLC
C/O MATTHEW A RISHOVD
1819 11TH ST N
MOORHEAD MN 56560-1407
ACCOUNT SUMMARY
Previous Statement Balance 12/31/2025 $3,587.62
Beginning balance $3,587.62
Deposits/Credits 23 $32,268.60
Ending balance $1,200.00`;

/* ---------------------------------------------------------------- *
 * Classification
 * ---------------------------------------------------------------- */

await reporter.check('a real application PDF is classified as an application', async () => {
  assert.equal(E.textQuality.classifyDocument(APPLICATION), 'application');
});

await reporter.check('a real application is no longer mislabelled a bank statement', async () => {
  const result = E.pipeline.processDocument({
    fileId: 'doc_app',
    filename: '1950S Original USE_THIS_APP.pdf',
    rawText: APPLICATION,
    usedOcr: false
  });
  assert.equal(result.docType, 'application');
});

await reporter.check('bank statements are still classified as bank statements', async () => {
  assert.equal(E.textQuality.classifyDocument(STATEMENT_CREDIT_UNION), 'bank_statement');
  assert.equal(E.textQuality.classifyDocument(STATEMENT_WITH_DBA), 'bank_statement');
  assert.equal(E.textQuality.classifyDocument(STATEMENT_NOISY), 'bank_statement');
});

await reporter.check('a statement mentioning a date of birth is still a statement', async () => {
  // One stray application-ish phrase must not flip a document with real
  // statement evidence.
  const text = `${STATEMENT_CREDIT_UNION}\nDate of Birth: 1970-01-01`;
  assert.equal(E.textQuality.classifyDocument(text), 'bank_statement');
});

await reporter.check('one application phrase alone is not enough evidence', async () => {
  assert.equal(E.textQuality.classifyDocument('Please supply your date of birth below.'), 'unknown');
});

await reporter.check('empty text is unreadable, not a bank statement', async () => {
  assert.equal(E.textQuality.classifyDocument(''), 'unreadable');
  assert.equal(E.textQuality.classifyDocument('   \n  \n '), 'unreadable');
});

await reporter.check('a document with no statement evidence is not labelled a bank statement', async () => {
  const result = E.pipeline.processDocument({
    fileId: 'doc_blank',
    filename: 'mystery.pdf',
    rawText: 'Nothing here resembles a financial document at all.',
    usedOcr: false
  });
  assert.notEqual(result.docType, 'bank_statement');
  assert.equal(result.docType, 'unknown');
});

await reporter.check('a weakly worded statement with real evidence is still a bank statement', async () => {
  // No classifier signal phrases, but a recognisable account number and period:
  // the evidence decides, so nothing that used to extract stops extracting.
  const result = E.pipeline.processDocument({
    fileId: 'doc_weak',
    filename: 'odd-format.pdf',
    rawText: 'Primary Account Number: 475663022\nStatement Date: January 31, 2026\nTotals 1,200.00',
    usedOcr: false
  });
  assert.equal(result.docType, 'bank_statement');
});

/* ---------------------------------------------------------------- *
 * Business name recovery
 * ---------------------------------------------------------------- */

await reporter.check('an all-caps holder line with INC is recovered', async () => {
  const found = E.companyName.extractCompanyName(STATEMENT_CREDIT_UNION, { bank: null });
  assert.equal(found.legalName, 'ACS MAINTENANCE SERVICES INC');
  assert.equal(found.evidence, 'entity_suffix');
});

await reporter.check('a mixed-case holder line with LLC is recovered, with its DBA', async () => {
  const found = E.companyName.extractCompanyName(STATEMENT_WITH_DBA, { bank: null });
  assert.equal(found.legalName, '4Bs Entertainment LLC');
  assert.equal(found.dba, 'Biele Street Pub and Liquors');
});

await reporter.check('a holder line is found among address and mail-sort noise', async () => {
  const found = E.companyName.extractCompanyName(STATEMENT_NOISY, { bank: null });
  assert.equal(found.legalName, 'A-1 SERVICES GOES ANYWHERE LLC');
});

await reporter.check('the care-of person is not mistaken for the business', async () => {
  const found = E.companyName.extractCompanyName(STATEMENT_NOISY, { bank: null });
  assert.ok(!/MATTHEW/i.test(found.legalName ?? ''), `picked the wrong line: ${found.legalName}`);
});

await reporter.check("the bank's own name is never returned as the holder", async () => {
  const text = `Wells Fargo Bank, N.A.\nAccount Statement\nBeginning balance\nEnding balance\nNORTHWIND TRADING LLC\n100 Main St`;
  const found = E.companyName.extractCompanyName(text, { bank: 'Wells Fargo' });
  assert.equal(found.legalName, 'NORTHWIND TRADING LLC');
});

await reporter.check('an explicit label wins over a guessed line', async () => {
  const text = `SOME OTHER HOLDINGS LLC\nAccount Holder: Riverbend Catering Co Inc\nBeginning balance`;
  const found = E.companyName.extractCompanyName(text, { bank: null });
  assert.equal(found.legalName, 'Riverbend Catering Co Inc');
  assert.equal(found.evidence, 'labelled');
});

await reporter.check('statement furniture carrying a suffix is not treated as a name', async () => {
  const text = `Account Summary\nPage 1 of 6\nCustomer Service Company\nDeposits and other credits`;
  const found = E.companyName.extractCompanyName(text, { bank: null });
  assert.equal(found.legalName, null);
});

await reporter.check('an address line is never returned as a name', async () => {
  const text = `1100 Shapiro Dr\nP. O. Box 718\nSuite 400 LLC Plaza\nBeginning balance`;
  const found = E.companyName.extractCompanyName(text, { bank: null });
  assert.ok(!/Shapiro|Box|Suite/i.test(found.legalName ?? ''), `picked an address: ${found.legalName}`);
});

await reporter.check('no evidence means null, never an invented name', async () => {
  const found = E.companyName.extractCompanyName('Beginning balance 100.00\nEnding balance 50.00', { bank: null });
  assert.equal(found.legalName, null);
  assert.equal(found.dba, null);
  assert.equal(found.evidence, 'none');
});

await reporter.check('empty and missing text are handled without throwing', async () => {
  assert.equal(E.companyName.extractCompanyName('', {}).legalName, null);
  assert.equal(E.companyName.extractCompanyName(null, {}).legalName, null);
  assert.equal(E.companyName.extractCompanyName(undefined).legalName, null);
});

/* ---------------------------------------------------------------- *
 * End to end through the pipeline
 * ---------------------------------------------------------------- */

await reporter.check('a statement now carries the business name through the pipeline', async () => {
  const result = E.pipeline.processDocument({
    fileId: 'doc_stmt',
    filename: 'Biz 2026 Jan 0547.pdf',
    rawText: STATEMENT_CREDIT_UNION,
    usedOcr: false
  });
  assert.equal(result.companyNameGuess, 'ACS MAINTENANCE SERVICES INC');
  assert.equal(result.companyNameEvidence, 'entity_suffix');
});

await reporter.check('an application carries its legal company name', async () => {
  const result = E.pipeline.processDocument({
    fileId: 'doc_app2',
    filename: 'USE_THIS_APP.pdf',
    rawText: APPLICATION,
    usedOcr: false
  });
  assert.ok(/1950/.test(result.companyNameGuess ?? ''), `got ${result.companyNameGuess}`);
});

await reporter.check('documents from one company now aggregate into one lead', async () => {
  const docs = [
    E.pipeline.processDocument({ fileId: 'a', filename: 'jan.pdf', rawText: STATEMENT_CREDIT_UNION, usedOcr: false }),
    E.pipeline.processDocument({ fileId: 'b', filename: 'feb.pdf', rawText: STATEMENT_CREDIT_UNION, usedOcr: false }),
    E.pipeline.processDocument({ fileId: 'c', filename: 'mar.pdf', rawText: STATEMENT_CREDIT_UNION, usedOcr: false })
  ];
  const companies = E.companyAggregator.aggregateByCompany(docs);
  assert.equal(companies.length, 1, 'three statements from one business must be one lead');
  assert.equal(companies[0].companyNameGuess, 'ACS MAINTENANCE SERVICES INC');
});

await reporter.check('statements from different businesses stay separate leads', async () => {
  const docs = [
    E.pipeline.processDocument({ fileId: 'a', filename: 'a.pdf', rawText: STATEMENT_CREDIT_UNION, usedOcr: false }),
    E.pipeline.processDocument({ fileId: 'b', filename: 'b.pdf', rawText: STATEMENT_WITH_DBA, usedOcr: false })
  ];
  const companies = E.companyAggregator.aggregateByCompany(docs);
  assert.equal(companies.length, 2);
});

await reporter.check('the statement extraction fields are unchanged by this work', async () => {
  const result = E.pipeline.processDocument({
    fileId: 'doc_fields',
    filename: 'Biz 2026 Jan 0547.pdf',
    rawText: STATEMENT_CREDIT_UNION,
    usedOcr: false
  });
  assert.equal(result.balances.opening, 16615.88);
  assert.equal(result.balances.ending, 2368.47);
  assert.equal(result.statementSummary.deposits, 11085.35);
  assert.ok(result.bankAccount, 'bank account block must still be present');
  assert.ok(Array.isArray(result.transactions), 'transactions must still be present');
  assert.ok(result.confidence, 'confidence must still be present');
});

/* ---------------------------------------------------------------- *
 * PDF row reconstruction
 * ---------------------------------------------------------------- */

/** Build PDF.js-shaped items laid out flush, the way a real PDF emits them. */
function layOut(pieces, { y = 700, size = 10, startX = 60 } = {}) {
  let x = startX;
  return pieces.map((piece) => {
    const text = typeof piece === 'string' ? piece : piece.text;
    const gap = typeof piece === 'string' ? 0 : piece.gap ?? 0;
    x += gap;
    const width = text.length * size * 0.5;
    const item = { str: text, width, transform: [size, 0, 0, size, x, y] };
    x += width;
    return item;
  });
}

await reporter.check('characters emitted one at a time are rebuilt into words', async () => {
  // Exactly how Truist statements render: one item per glyph, flush, with
  // explicit space items between words.
  const items = layOut([...'23HUNDRED', ' ', ...'VENTURES', ' ', ...'INC']);
  assert.equal(joinRow(items.map((item) => ({
    x: item.transform[4],
    width: item.width,
    size: item.transform[0],
    text: item.str
  }))), '23HUNDRED VENTURES INC');
});

await reporter.check('ordinary word-per-item rows are unchanged', async () => {
  const items = layOut(['Beginning', { text: 'balance', gap: 4 }, { text: '16,615.88', gap: 4 }]);
  assert.equal(rebuildRows(items).trim(), 'Beginning balance 16,615.88');
});

await reporter.check('a wide gap between items still becomes a space', async () => {
  const items = layOut(['Deposits', { text: '11,085.35', gap: 120 }]);
  assert.equal(rebuildRows(items).trim(), 'Deposits 11,085.35');
});

await reporter.check('rows are ordered top to bottom and columns left to right', async () => {
  const top = layOut(['Account', { text: 'Statement', gap: 4 }], { y: 700 });
  const bottom = layOut(['Ending', { text: 'balance', gap: 4 }], { y: 600 });
  assert.equal(rebuildRows([...bottom, ...top]).trim(), 'Account Statement\nEnding balance');
});

await reporter.check('the space threshold scales with the glyph size', async () => {
  assert.ok(spaceThreshold(10) > 0);
  assert.ok(spaceThreshold(20) > spaceThreshold(10));
  assert.ok(spaceThreshold(0) >= 0.5, 'a missing size must not produce a zero threshold');
});

await reporter.check('empty and malformed item lists are handled without throwing', async () => {
  assert.equal(rebuildRows([]).trim(), '');
  assert.equal(rebuildRows(undefined).trim(), '');
  assert.equal(rebuildRows([{}, { str: null }]).trim(), '');
});

/* ---------------------------------------------------------------- *
 * Company key and mail-sort noise
 * ---------------------------------------------------------------- */

await reporter.check('a mail-sort barcode prefix is stripped from the name', async () => {
  const found = E.companyName.extractCompanyName(
    'ACECMKMEIGOCICAAMGOAGCMK A-1 SERVICES GOES ANYWHERE LLC\n1819 11TH ST N',
    { bank: null }
  );
  assert.equal(found.legalName, 'A-1 SERVICES GOES ANYWHERE LLC');
});

await reporter.check('a long legitimate capitalised name is not mistaken for noise', async () => {
  assert.equal(E.companyName.stripNoisePrefix('INTERNATIONAL LLC'), 'INTERNATIONAL LLC');
  assert.equal(E.companyName.stripNoisePrefix('TRANSPORTATION SERVICES INC'), 'TRANSPORTATION SERVICES INC');
});

await reporter.check('noise is only stripped when a business name remains', async () => {
  // Nothing recognisable left, so the original is kept rather than mangled.
  assert.equal(E.companyName.stripNoisePrefix('ACECMKMEIGOCICAAMGOAGCMK 1819'), 'ACECMKMEIGOCICAAMGOAGCMK 1819');
});

await reporter.check('the same business written three ways is one key', async () => {
  const key = E.companyName.companyKey('4Bs Entertainment LLC');
  assert.equal(E.companyName.companyKey('4BS ENTERTAINMENT'), key);
  assert.equal(E.companyName.companyKey('4Bs Entertainment, L.L.C.'), key);
  assert.equal(E.companyName.companyKey('ACECMKMEIGOCICAAMGOAGCMK 4Bs Entertainment LLC'), key);
});

await reporter.check('different businesses never collapse into one key', async () => {
  assert.notEqual(E.companyName.companyKey('Northwind Trading LLC'), E.companyName.companyKey('Southwind Trading LLC'));
  assert.notEqual(E.companyName.companyKey('Admire Care'), E.companyName.companyKey('Admire Health'));
});

await reporter.check('a missing name maps to the unassociated key', async () => {
  assert.equal(E.companyName.companyKey(null), 'unassociated');
  assert.equal(E.companyName.companyKey(''), 'unassociated');
  assert.equal(E.companyName.companyKey('   '), 'unassociated');
});

await reporter.check('a name that is only an entity suffix still produces a key', async () => {
  assert.ok(E.companyName.companyKey('LLC').length > 0);
});

await reporter.check('possessive and plural spellings of one business are one key', async () => {
  const key = E.companyName.companyKey("1950'S Original");
  assert.equal(E.companyName.companyKey('1950 ORIGINALS LLC'), key);
  assert.equal(E.companyName.companyKey('1950 Originals'), key);
});

await reporter.check('plural tolerance does not merge unrelated businesses', async () => {
  assert.notEqual(E.companyName.companyKey('Aaria Tees LLC'), E.companyName.companyKey('Aaria Tea LLC'));
  assert.notEqual(E.companyName.companyKey('Admire Care'), E.companyName.companyKey('Admire Cares Group'));
});

await reporter.check('a document read only in part is not called a mismatch', async () => {
  const text = 'Account Statement\nBeginning balance 1,000.00\nEnding balance 500.00\nDEPOSITS AND OTHER CREDITS\n01-02-2026 Deposit 10.00';
  const partial = E.pipeline.processDocument({
    fileId: 'p', filename: 's.pdf', rawText: text, usedOcr: false, pageCount: 9, scannedPageCount: 3
  });
  assert.equal(partial.truncated, true);
  assert.equal(partial.reconciliation.reconciles, null);
  assert.equal(partial.reconciliation.reason, 'statement_truncated');
  assert.ok(partial.reviewItems.some((item) => item.type === 'statement_truncated'));
  assert.ok(!partial.reviewItems.some((item) => item.type === 'reconciliation_mismatch'));
});

await reporter.check('a fully read document still reconciles normally', async () => {
  const text = 'Account Statement\nBeginning balance 1,000.00\nEnding balance 500.00\nDEPOSITS AND OTHER CREDITS\n01-02-2026 Deposit 10.00';
  const full = E.pipeline.processDocument({
    fileId: 'f', filename: 's.pdf', rawText: text, usedOcr: false, pageCount: 3, scannedPageCount: 3
  });
  assert.equal(full.truncated, false);
  assert.notEqual(full.reconciliation.reason, 'statement_truncated');
});

reporter.done();
