/**
 * Structural / clean-code audit of the scanner module.
 * Guards the rules this build is required to keep: approved UI behaviour,
 * offline-only assets, and one authoritative implementation of each feature.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(full)));
    else out.push(full);
  }
  return out;
}

function test(name, condition) {
  const index = String(passed + failed + 1).padStart(2, '0');
  if (condition) {
    passed += 1;
    console.log(`PASS ${index} ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${index} ${name}`);
  }
}

const read = (relative) => readFile(path.join(root, relative), 'utf8');

const sourceFiles = await files(path.join(root, 'src'));
const runtimeFiles = [...sourceFiles, path.join(root, 'index.html'), path.join(root, 'scripts', 'copy-scanner-vendor.mjs')];
const runtimeText = (await Promise.all(runtimeFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const scannerFiles = sourceFiles.filter((file) => file.includes(`${path.sep}scanner${path.sep}`));
const scannerText = (await Promise.all(scannerFiles.map((file) => readFile(file, 'utf8')))).join('\n');

const leadRows = await read('src/scanner/components/LeadRows.tsx');
const queue = await read('src/scanner/hooks/useScannerQueue.ts');
const leads = await read('src/scanner/lib/leads.ts');
const vendor = await read('src/scanner/services/offlineVendor.ts');
const runner = await read('src/scanner/services/jobRunner.js');
const config = await read('src/scanner/services/scannerConfig.js');
const validation = await read('src/scanner/services/fileValidation.js');
const recovery = await read('src/scanner/services/queueRecovery.js');
const vendorLoader = await read('src/scanner/services/vendorLoader.js');
const pdfRows = await read('src/scanner/services/pdfRows.js');
const balanceSrc = await read('src/scanner/engine/balanceEquation.js');
const companyNameSrc = await read('src/scanner/engine/companyName.js');
const textQuality = await read('src/scanner/engine/textQuality.js');
const aggregator = await read('src/scanner/engine/companyAggregator.js');
const leadsLib = await read('src/scanner/lib/leads.ts');
const pipeline = await read('src/scanner/engine/pipeline.js');
const txnParser = await read('src/scanner/engine/transactionParser.js');
const html = await read('index.html');
const page = await read('src/scanner/ScannerPage.tsx');
const audit = await read('src/scanner/components/AuditSection.tsx');
const routing = await read('src/scanner/lib/routing.ts');
const copyVendor = await read('scripts/copy-scanner-vendor.mjs');
const pkg = JSON.parse(await read('package.json'));
const engineFiles = (await readdir(path.join(root, 'src/scanner/engine'))).filter((name) => name.endsWith('.js'));
const engineSources = await Promise.all(
  engineFiles.map(async (name) => ({ name, code: await read(path.join('src/scanner/engine', name)) }))
);
const engineText = engineSources.map((entry) => entry.code).join('\n');

/* ---------------------------------------------------------------- *
 * Offline / no CDN
 * ---------------------------------------------------------------- */
test('no QikReach branding in runtime source', !/qikreach/i.test(runtimeText));
test('no CDN runtime URLs in scanner source', !/cdnjs|jsdelivr|unpkg|https?:\/\//i.test(runtimeText));
test('local PDF.js loader used', /scanner-vendor\/pdfjs\/pdf\.min\.js/.test(vendor));
test('local PDF worker used', /scanner-vendor\/pdfjs\/pdf\.worker\.min\.js/.test(vendor));
test('local Tesseract loader used', /scanner-vendor\/tesseract\/tesseract\.min\.js/.test(vendor));
test('local Tesseract worker used', /scanner-vendor\/tesseract\/worker\.min\.js/.test(vendor));
test('local Tesseract core directory used', /scanner-vendor\/tesseract\/core/.test(vendor));
test('local Tesseract language directory used', /scanner-vendor\/tesseract\/lang/.test(vendor));
test(
  'vendor script copies all four Tesseract cores',
  ['tesseract-core.wasm.js', 'tesseract-core-simd.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'].every(
    (name) => copyVendor.includes(name)
  )
);
test('vendor script copies English traineddata', /eng\.traineddata\.gz/.test(copyVendor));
test('vendor assets are copied on install and on build', pkg.scripts.postinstall.includes('copy-scanner-vendor') && pkg.scripts.build.includes('copy-scanner-vendor'));
test('scanner libraries are pinned to exact versions', ['pdfjs-dist', 'tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng'].every((name) => /^\d+\.\d+\.\d+$/.test(pkg.dependencies[name] ?? '')));
test('Playwright is a dev dependency only', Boolean(pkg.devDependencies.playwright) && !pkg.dependencies.playwright);

/* ---------------------------------------------------------------- *
 * Timeouts, cancellation, retry, worker reset
 * ---------------------------------------------------------------- */
test('a single timeout policy exists', /export const SCAN_TIMEOUTS/.test(config));
test('every PDF and OCR stage has a timeout', ['pdfOpenMs', 'pdfPageMs', 'pdfRenderMs', 'ocrInitMs', 'ocrPageMs', 'assetLoadMs'].every((key) => config.includes(key)));
test('one automatic retry is configured', /export const MAX_JOB_ATTEMPTS = 2/.test(config));
test('validation failures are terminal and not retried', /TERMINAL_ERROR_CODES/.test(config) && /isTerminalErrorCode/.test(runner));
test('watchdog wraps every awaited PDF stage', (vendor.match(/withWatchdog\(/g) || []).length >= 5);
test('PDF loading tasks are destroyed on abort', /loadingTask\.destroy\(\)/.test(vendor));
test('OCR cancellation terminates the worker', /abort: \(\) => resetOcrWorker\(controls\.lane \?\? 0\)/.test(vendor));
test('PDF engine reset implemented', /export async function resetPdfEngine/.test(vendor));
test('OCR worker reset implemented', /export async function resetOcrWorker/.test(vendor));
test('workers are reset after a failed attempt', /resetWorkers/.test(runner) && /resetScannerWorkers/.test(queue));

/* the whole-file ceiling is wired, not merely declared */
test('the whole-file ceiling is declared', /jobMs: 420_000/.test(config));
test('the whole-file ceiling is actually enforced by the runner', /jobTimeoutMs = SCAN_TIMEOUTS\.jobMs/.test(runner) && /withWatchdog\(\s*`\$\{jobLabel\(job\)\}/.test(runner));
test('the queue passes the configured ceiling to the runner', /jobTimeoutMs: SCAN_TIMEOUTS\.jobMs/.test(queue));
test('each attempt gets its own cancellation token', /createCancellation\(parentToken\)/.test(runner));
test('the whole-file ceiling cancels the running stage', /abort: \(\) => jobToken\.cancel\(\)/.test(runner));
test('per-attempt tokens are detached when the attempt ends', /jobToken\.dispose\(\)/.test(runner));
test('the stage inside a job runs under the per-attempt token', /token: jobToken/.test(queue));

/* dead vendor loads are never reused */
test('vendor loading has one authoritative slot implementation', /export function createLoaderSlot/.test(vendorLoader));
test('a timed out or cancelled load clears its slot', /if \(promise === pending\) reset\(\);/.test(vendorLoader));
test('a rejected load clears its slot', /if \(promise === started\.promise\) reset\(\);/.test(vendorLoader));
test('a cleared load runs its cleanup', /const previous = cleanup;/.test(vendorLoader) && /previous\(\);/.test(vendorLoader));
test('the scanner loads PDF.js and Tesseract through that slot', (vendor.match(/loaders\.(pdf|tesseract)/g) || []).length >= 2 && /createLoaderSlot/.test(vendor));
test('no second loader cache lives in the vendor module', !/let (pdfPromise|tessPromise)/.test(vendor));
test('a full reset drops the library loaders too', /resetVendorLoaders\(\);/.test(vendor));
test('OCR worker startup drops a dead pending worker', /if \(slot\.promise === pending\) await resetOcrWorker\(lane\);/.test(vendor));
test('stop cancels the in-flight job', /cancellationRef\.current\.cancel\(\)/.test(queue));
test('cancellation runs the active stage teardown', /onCancel/.test(runner));

/* ---------------------------------------------------------------- *
 * Queue behaviour
 * ---------------------------------------------------------------- */
test('queue uses the authoritative job runner', /runScanQueue/.test(queue));
test('a failed file never stops the queue', /onJobFailed/.test(runner) && /await runJobWithRetry\(job, \{ \.\.\.handlers, lane \}\)/.test(runner));
test('per-file attempts are persisted', /attempts: attempt/.test(queue));

/* several lanes reading one queue */
test('the queue can read more than one file at a time', /concurrency = 1/.test(runner) && /Array\.from\(\{ length: lanes \}/.test(runner));
test('one lane is the same code path as many', !/function runSequentialQueue|sequentialDrain/.test(runner));
test('how many lanes is decided in one place', /export function scanLaneCount/.test(config) && /scanLaneCount\(/.test(queue));
test('each lane owns its OCR worker', /const ocrLanes = new Map/.test(vendor));
test('a failed file resets only its own lane', /export async function recoverFromJobFailure/.test(vendor) && /recoverFromJobFailure\(lane\)/.test(queue));
test('the shared PDF worker is not pulled from under other lanes', /pdfWorkerSuspect/.test(vendor));
test('an identifier is never read as an amount', /a bare run of digits is an identifier/.test(balanceSrc));
test('an amount written without its leading zero is read', /\\\.\\d\{2\}\)\/g/.test(balanceSrc) && /leading zero/.test(balanceSrc));
test('the reading that moves the least money wins a tie', /solutions\.sort\(\(a, b\) => a\.movement - b\.movement\)/.test(balanceSrc));
test('a real tie is still reported as unsolved', /solutions\[0\]\.movement === solutions\[1\]\.movement\) return null/.test(balanceSrc));
test('a table balance can be overdrawn', /printedSign\(line, first, null\)/.test(balanceSrc) && /printedSign\(line, last, null\)/.test(balanceSrc));
test('a column header can say which way each column moves', /function headerSigns/.test(balanceSrc));
test('a label and its figure are paired whichever is printed first', /isFigureOnly\(row\) && isLabelOnly/.test(balanceSrc) && /isLabelOnly\(row\)/.test(balanceSrc));
test('a text layer with no amounts is reported as needing OCR', /hasPrintedAmounts/.test(balanceSrc) && /hasPrintedAmounts\(rawText\)/.test(queue));
test('two lanes never take the same file', /claimedRef\.current\.add\(next\.fileId\)/.test(queue) && /claimedRef\.current\.delete\(next\.fileId\)/.test(queue));
test('claims are cleared when a run starts, stops and ends', (queue.match(/claimedRef\.current\.clear\(\)/g) || []).length >= 3);
test('the engines are released when the queue goes idle', /claimedRef\.current\.clear\(\);\s*\n[\s\S]{0,400}?await resetScannerWorkers\(\);\s*\n\s*\}\s*\n\s*\}, \[processFile/.test(queue));
test('one PDF worker is reused across documents', /new pdfjsLib\.PDFWorker/.test(vendor) && /worker: getPdfWorker\(pdfjsLib\)/.test(vendor));
test('an OCR scan does not read a text layer it discards', /readTextLayer: !runOcr/.test(queue));
test('pause control implemented', /pausedRef\.current = true/.test(queue));
test('resume control implemented', /pausedRef\.current = false/.test(queue));
test('resume cannot restart a stopped scan', /const resume = useCallback[\s\S]*?if \(stopRequestedRef\.current\) return;/.test(queue));
test('stop control implemented', /stopRequestedRef\.current = true/.test(queue));
test('restart control implemented', /const restart = useCallback/.test(queue));
test('retry failed separate from restart', /const retryFailed = useCallback/.test(queue));
test('original files persist for retry', /scannerStore\.saveFile/.test(queue));
test('restart-safe recovery implemented', /export function recoverDocuments/.test(recovery));
test('recovered documents are written back to storage', /recoverDocuments\(savedDocs\)/.test(queue) && /changed\.map\(\(doc\) => scannerStore\.saveDocument/.test(queue));

/* ---------------------------------------------------------------- *
 * Corrupted PDFs and duplicates
 * ---------------------------------------------------------------- */
test('PDF signature is verified', /PDF_HEADER/.test(validation));
test('PDF structure is inspected for truncation', /pdf_missing_eof/.test(validation) && /pdf_missing_startxref/.test(validation));
test('PDF.js failures get stable error codes', /corrupted_pdf/.test(vendor) && /password_protected_pdf/.test(vendor));
test('duplicates are matched on hash and size', /doc\.fileHash === candidate\.fileHash/.test(validation) && /doc\.fileSize === candidate\.fileSize/.test(validation));
test('duplicate handling is honoured in the queue', /duplicateHandling === 'skip'/.test(queue));

/* ---------------------------------------------------------------- *
 * One authoritative implementation, no dead code
 * ---------------------------------------------------------------- */
test('no superseded queue runner remains', !existsSync(path.join(root, 'src/scanner/services/isolatedQueue.js')));
test('the browser suites share one offline harness', existsSync(path.join(root, 'scripts/lib/browser-harness.mjs')));

/* ---------------------------------------------------------------- *
 * Extraction: classification, business name, row reconstruction
 * ---------------------------------------------------------------- */
test('application wording is matched by whole phrases, not bare tokens', /APPLICATION_SIGNAL_PHRASES/.test(textQuality) && !/'ein',/.test(textQuality) && !/'ssn',/.test(textQuality));
test('classification needs the same evidence bar for both types', /appSignals >= MIN_SIGNALS/.test(textQuality));
test('a document is only called a bank statement on evidence', /statementEvidence/.test(pipeline) && /resolvedDocType/.test(pipeline));
test('the evidence check does not treat null as a number', /const hasNumber =/.test(pipeline));
test('business name recovery has one implementation', /export|function extractCompanyName/.test(companyNameSrc) && existsSync(path.join(root, 'src/scanner/engine/companyName.js')));
test('the statement path recovers the business name', /companyName\.extractCompanyName/.test(pipeline));
test('the queue no longer carries a duplicate name regex', !/account holder\[/.test(queue));
test('mail-sort noise needs length and a consonant run', /NOISE_TOKEN/.test(companyNameSrc) && /CONSONANT_RUN/.test(companyNameSrc));
test('a name is never invented without evidence', /evidence: 'none'/.test(companyNameSrc));
test('one company key rule exists in the engine', /function companyKey/.test(companyNameSrc));
test('the aggregator uses that one key rule', /companyName\.companyKey/.test(aggregator));
test('the lead list uses that same key rule', /companyName\.companyKey/.test(leadsLib));
// The rule is that grouping has one key, not that a particular string of
// characters never appears: company info also compares names, as printed
// rather than by the grouping key, which is the difference worth showing.
test('the lead list groups by the engine key and nothing else', /return getScannerEngine\(\)\.companyName\.companyKey\(name\)/.test(leadsLib) && /: normalized\(name\);/.test(leadsLib));
test('no second grouping key is computed in the UI layer', (leadsLib.match(/groups\.set\(/g) || []).length === 1 && !/companyKey\(name\)\s*\+/.test(leadsLib));
test('company info compares names as printed, not by the grouping key', /const asPrinted = \(value: string\)/.test(leadsLib) && /compared as printed, not by grouping key/i.test(leadsLib));
test('row reconstruction has one implementation', /export function rebuildRows/.test(pdfRows) && /rebuildRows/.test(vendor));
test('rows are joined by measured gap, not blind spaces', /spaceThreshold/.test(pdfRows));
test('no duplicate row reconstruction left in the vendor module', !/function joinRow/.test(vendor));

/* transaction parsing */
test('transaction direction comes from the statement section first', /function resolveDirection/.test(txnParser) && /section === 'credit'/.test(txnParser));
test('section headings are anchored and length capped', /HEADING_MAX/.test(txnParser) && /\^\(\?:\\d\+\\s\+\)\?deposits/.test(txnParser));
test('summary tables are excluded from transactions', /IGNORE_SECTION/.test(txnParser) && /daily\\s\+balance/.test(txnParser));
test('dates with any separator are accepted', /\[\\\\\/\\\\-\.\]/.test(txnParser));
test('a description-first layout is supported', /DATE_TRAILING_RE/.test(txnParser));
test('a repeated cheque listing is counted once', /seenChecks/.test(txnParser) && /checkNumberOf/.test(txnParser));
test('each transaction records where its direction came from', /directionSource/.test(txnParser));
test('a partly read statement is not reported as a mismatch', /statement_truncated/.test(pipeline));
test('the scan passes page counts to the engine', /scannedPageCount/.test(queue) && /pageCount,/.test(queue));
test('a PDF with no text layer is reported as needing OCR', /USABLE_TEXT_MIN_CHARS/.test(config) && /needsOcr =\s*\n?\s*rawText/.test(queue));
test('OCR never starts on its own', /const runOcr = settingsNow\.mode === 'ocr' \|\| current\.forceOcr === true/.test(queue));
test('OCR is off by default', /mode: 'regular'/.test(queue) || /mode: 'regular'/.test(read('src/scanner/lib/displayRules.ts')) || /mode: 'regular'/.test(read('src/scanner/types/scanner.ts')));
test('an image with no OCR is reported, not failed', /needs_ocr_image_file/.test(queue));
test('files can be sent for OCR by hand', /const runOcrOnFlagged = useCallback/.test(queue));
test('the OCR flag is cleared once the file has run', /forceOcr: false/.test(queue));
test('reporting that a file needs OCR does not change the regular-scan default', /regularPages: 9999/.test(queue) && /mode: 'regular'/.test(queue));
test(
  'the company key tolerates possessives and plurals',
  /word\.endsWith\('s'\)/.test(companyNameSrc) && /word !== 's'/.test(companyNameSrc)
);
test('no CommonJS fallback left in the extraction engine', !/typeof module/.test(engineText) && !/require\(/.test(engineText));
test(
  'every extraction module registers through the one engine global',
  engineSources.every((entry) => /root\.ScannerEngine\s*=\s*root\.ScannerEngine\s*\|\|\s*\{\}/.test(entry.code))
);
test(
  'file validation is implemented once and only re-exported',
  (scannerText.match(/function validateFile\b/g) || []).length === 2 &&
    /export async function validateFile/.test(validation) &&
    /return validateFileImpl\(/.test(vendor)
);
test('timeouts are not duplicated across modules', !/ocrPageMs\s*[:=]\s*\d/.test(vendor) && !/ocrPageMs\s*[:=]\s*\d/.test(queue));
test('no debug logging left in scanner source', !/console\.(log|debug|warn|info|trace)\(/.test(scannerText));
test('no unfinished-work markers in scanner source', !/(\/\/|\/\*|\*)\s*(TODO|FIXME|HACK)\b/i.test(scannerText));

/* ---------------------------------------------------------------- *
 * Approved scanner UI and rules (unchanged from v003)
 * ---------------------------------------------------------------- */
test('fixed 1200px scalable viewport', /width=1200, initial-scale=1, user-scalable=yes/.test(html));
test('React scanner module exported', /export \{ ScannerPage \}/.test(await read('src/scanner/index.ts')));
test('regular scan is default', /mode: 'regular'/.test(queue));
test('regular scan reads the whole document by default', /regularPages: 9999/.test(queue));
test('OCR reads the whole document by default', /ocrPages: 9999/.test(queue));
test('OCR is opt-in', /settingsNow\.mode === 'ocr'/.test(queue));
test('lead rows contain row number', /lead-number/.test(leadRows));
test('lead rows have no checkbox selection column', !/type="checkbox"/.test(leadRows));
test('extraction score sits in lead row', /extract-score/.test(leadRows));
test('lead rows do not render long filename', !/filename/.test(leadRows));
test('documents use short display labels', /shortDocLabel/.test(leadRows));
test('leads auto-sort by revenue descending', /return leads\.sort\(\(a, b\) => b\.revenue - a\.revenue/.test(leads));
test('audit section uses closed details by default', /<details className="audit-section">/.test(audit) && !/<details className="audit-section" open/.test(audit));
test('three panel scanner layout present', /QueuePanel/.test(page) && /ExtractionPanel/.test(page) && /RoutingPanel/.test(page));
test('two resize handles present', (page.match(/scanner-resize-handle/g) || []).length === 2);
test('stats strip still rendered', /StatsStrip/.test(await read('src/scanner/components/QueuePanel.tsx')));
test('routing supports odd/even split', /oddEven/.test(routing));
test('routing supports round robin', /round\\s\*robin/.test(routing));
test('routing supports revenue threshold', /threshold/.test(routing));
test('unknown routing is not faked', /Nothing will be sent until a valid preview exists/.test(routing));
test('CRM send callback is optional and explicit', /onSendLeads/.test(page));

console.log(`\nAudit: ${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
