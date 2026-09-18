import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = [
  'coreUtils','textQuality','bankRecognizer','companyName','balanceEquation','summaryExtractor','accountNumber','statementDate','transactionParser','reconciliation',
  'depositAnalysis','expenseAnalysis','nsfDetector','mcaDetector','cashFlow','confidenceEngine',
  'applicationExtractor','companyAggregator','reviewWorkflow','pipeline'
];
for (const name of names) await import(pathToFileURL(path.join(root, 'src/scanner/engine', `${name}.js`)));
const E = globalThis.ScannerEngine;
let n = 0;
function test(name, fn) {
  n += 1;
  try { fn(); console.log(`PASS ${String(n).padStart(2,'0')} ${name}`); }
  catch (error) { console.error(`FAIL ${String(n).padStart(2,'0')} ${name}`); throw error; }
}

test('engine global initialized', () => assert.ok(E));
test('all engine modules loaded', () => names.forEach((name) => assert.ok(E[name], name)));
test('trusted statement text detected', () => assert.equal(E.textQuality.assessTextQuality('Account Statement\nBeginning Balance\nEnding Balance\n'.repeat(20)).trusted, true));
test('short text rejected', () => assert.equal(E.textQuality.assessTextQuality('hello').trusted, false));
test('bank statement classified', () => assert.equal(E.textQuality.classifyDocument('Account Statement Beginning Balance Ending Balance Deposits and Other Credits '.repeat(10)), 'bank_statement'));
test('application classified', () => assert.equal(E.textQuality.classifyDocument('Application\nRequested Funding Amount: $50000\nOwnership Percentage: 100\nEIN: 12-3456789\nSSN: 123-45-6789'), 'application'));
test('Chase recognized', () => assert.equal(E.bankRecognizer.recognizeBank('JPMorgan Chase Bank business statement').bank, 'Chase'));
test('unknown bank stays unknown', () => assert.equal(E.bankRecognizer.recognizeBank('Example Financial House').bank, null));
test('account number extractor returns API result', () => assert.ok(E.accountNumber.extractAccountNumber('Account Number: 1234567890')));
test('statement date recovery returns API result', () => assert.ok(E.statementDate.recoverStatementDate('Statement Period 08/01/2026 - 08/31/2026', 'AUG.pdf')));
test('transaction parser returns array', () => assert.ok(Array.isArray(E.transactionParser.parseTransactions('08/02 ACH CREDIT 1000.00\n08/03 RENT 250.00', { statementYear: 2026 }))));
test('reconciliation API exists', () => assert.equal(typeof E.reconciliation.reconcile, 'function'));
test('deposit analysis API exists', () => assert.equal(typeof E.depositAnalysis.analyzeDeposits, 'function'));
test('expense analysis API exists', () => assert.equal(typeof E.expenseAnalysis.analyzeExpenses, 'function'));
test('NSF detector API exists', () => assert.equal(typeof E.nsfDetector.detectNsfOverdraft, 'function'));
test('MCA detector API exists', () => assert.equal(typeof E.mcaDetector.detectMcaPositions, 'function'));
test('cash flow API exists', () => assert.equal(typeof E.cashFlow.analyzeDailyCashFlow, 'function'));
test('confidence high with all strong signals', () => assert.equal(E.confidenceEngine.scoreDocument({ bankRecognized:true,textTrusted:true,usedOcr:false,reconciles:true,reviewFlaggedTxnRatio:0 }).level, 'high'));
test('confidence forces review on mismatch', () => assert.equal(E.confidenceEngine.scoreDocument({ bankRecognized:true,textTrusted:true,usedOcr:false,reconciles:false,reviewFlaggedTxnRatio:0 }).level, 'needs_review'));
test('application legal name extracted', () => assert.equal(E.applicationExtractor.extractApplicationFields('Legal Business Name: Test Company LLC\nEIN: 12-3456789').legalName, 'Test Company LLC'));
test('application EIN extracted', () => assert.equal(E.applicationExtractor.extractApplicationFields('Legal Business Name: Test Company LLC\nEIN: 12-3456789').ein, '12-3456789'));
test('application phone extracted', () => assert.equal(E.applicationExtractor.extractApplicationFields('Phone: (212) 555-0101').phones[0], '(212) 555-0101'));
test('application email extracted', () => assert.equal(E.applicationExtractor.extractApplicationFields('Email: owner@example.com').emails[0], 'owner@example.com'));
test('SSN is masked', () => assert.equal(E.applicationExtractor.extractApplicationFields('SSN: 123-45-6789').ssn, 'XXX-XX-6789'));
// The key deliberately ignores case, punctuation and the legal entity suffix,
// so one business whose statements print its name inconsistently stays one lead.
test('company normalizer ignores case, punctuation and entity suffix', () => assert.equal(E.companyAggregator.normalizeCompanyKey('Test Company, LLC'), 'test company'));
test('company normalizer merges entity-suffix variants', () => {
  const key = E.companyAggregator.normalizeCompanyKey('4Bs Entertainment LLC');
  assert.equal(E.companyAggregator.normalizeCompanyKey('4BS ENTERTAINMENT'), key);
  assert.equal(E.companyAggregator.normalizeCompanyKey('4Bs Entertainment, L.L.C.'), key);
});
test('company normalizer keeps different businesses apart', () => {
  assert.notEqual(
    E.companyAggregator.normalizeCompanyKey('Northwind Trading LLC'),
    E.companyAggregator.normalizeCompanyKey('Southwind Trading LLC')
  );
});
test('company aggregator returns list', () => assert.ok(Array.isArray(E.companyAggregator.aggregateByCompany([]))));
test('pipeline returns application result', () => assert.equal(E.pipeline.processDocument({ fileId:'a', filename:'APP.pdf', rawText:'Application\nLegal Business Name: Test Company LLC\nRequested Funding Amount: $50000\nOwnership Percentage: 100\nEIN: 12-3456789\nSSN: 123-45-6789', usedOcr:false }).docType, 'application'));
test('pipeline preserves application company name', () => assert.equal(E.pipeline.processDocument({ fileId:'a2', filename:'APP.pdf', rawText:'Application\nLegal Business Name: Test Company LLC\nRequested Funding Amount: $50000\nOwnership Percentage: 100\nEIN: 12-3456789\nSSN: 123-45-6789', usedOcr:false }).companyNameGuess, 'Test Company LLC'));
test('pipeline returns bank statement result', () => assert.equal(E.pipeline.processDocument({ fileId:'b', filename:'AUG.pdf', rawText:('Chase Account Statement Beginning Balance: $1000.00 Ending Balance: $1000.00 Deposits and Other Credits Transaction Description Daily Balance\n').repeat(10), usedOcr:false }).docType, 'bank_statement'));
test('pipeline marks native extraction method', () => assert.equal(E.pipeline.processDocument({ fileId:'b2', filename:'AUG.pdf', rawText:('Chase Account Statement Beginning Balance: $1000.00 Ending Balance: $1000.00 Deposits and Other Credits Transaction Description Daily Balance\n').repeat(10), usedOcr:false }).extractionMethod, 'native_text'));
test('pipeline marks OCR extraction method', () => assert.equal(E.pipeline.processDocument({ fileId:'b3', filename:'AUG.pdf', rawText:('Chase Account Statement Beginning Balance: $1000.00 Ending Balance: $1000.00 Deposits and Other Credits Transaction Description Daily Balance\n').repeat(10), usedOcr:true }).extractionMethod, 'ocr'));
test('MCA aliases list is populated', () => assert.ok(E.mcaDetector.MCA_ALIASES.length > 10));
test('expense category payroll works', () => assert.equal(E.expenseAnalysis.categorize('ADP PAYROLL'), 'Payroll'));
test('expense category rent works', () => assert.equal(E.expenseAnalysis.categorize('Monthly Rent'), 'Rent'));
test('field confidence missing works', () => assert.equal(E.confidenceEngine.scoreField(null), 'missing'));
test('field confidence document evidence high', () => assert.equal(E.confidenceEngine.scoreField('document_text_label'), 'high'));
test('review workflow API exists', () => assert.ok(E.reviewWorkflow));
test('pipeline correction recalculation API exists', () => assert.equal(typeof E.pipeline.recalculateAfterCorrection, 'function'));


test('v10 Wells Fargo marker recognized', () => assert.equal(E.bankRecognizer.recognizeBank('Account Detail - Wells Fargo wellsFargo.com').bank, 'Wells Fargo'));
test('v10 masked account preserved', () => assert.equal(E.accountNumber.extractAccountNumber('Account Number: XXXXXX6700').masked, 'XXXXXX6700'));
test('v10 application monthly revenue extracted', () => assert.equal(E.applicationExtractor.extractApplicationFields('Legal Business Name: Test LLC\nMonthly Revenue: $125,000', {filename:'APP.pdf'}).statedRevenue, 125000));
test('v10 application annual revenue converted monthly', () => assert.equal(E.applicationExtractor.extractApplicationFields('Legal Business Name: Test LLC\nAnnual Revenue: $1,200,000', {filename:'APP.pdf'}).statedRevenue, 100000));
test('v10 summary label values extracted', () => {
  const r=E.summaryExtractor.extractSummary('Beginning balance\n$10,000.00\nDeposits & Credits\n$25,000.00\nWithdrawals\n$5,000.00\nEnding balance\n$30,000.00', {usedOcr:false});
  assert.equal(r.deposits,25000); assert.equal(r.ending,30000);
});
test('v10 raw-text MCA detection works', () => {
  const hits=E.mcaDetector.detectMcaFromText('Withdrawals and Debits\n08/01 Forward Financing ACH DEBIT $500.00\n08/02 Forward Financing ACH DEBIT $500.00');
  assert.equal(hits[0].funder,'Forward Financing'); assert.equal(hits[0].status,'verified');
});
test('pipeline uses v10 summary deposits', () => {
  const text=('Chase Account Statement\nBeginning balance $10,000.00\nDeposits & Credits $25,000.00\nWithdrawals $5,000.00\nEnding balance $30,000.00\nTransaction Description Daily Balance\n').repeat(3);
  const r=E.pipeline.processDocument({fileId:'v10sum',filename:'AUG.pdf',rawText:text,usedOcr:false});
  assert.equal(r.statementSummary.deposits,25000); assert.equal(r.balances.ending,30000);
});

console.log(`\nEngine tests: ${n} passed.`);
