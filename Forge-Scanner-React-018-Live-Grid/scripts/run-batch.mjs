/**
 * Run a real folder of documents through the built scanner and report what
 * actually happened.
 *
 * Nothing is corrected, filled in or helped along: every file goes through the
 * real UI's file input, the real queue and the real v10 engine, offline, and
 * the numbers come straight out of the scanner's own IndexedDB records.
 *
 *   node scripts/run-batch.mjs <folder> [--json <out>] [--mode regular|ocr]
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { launchScanner, SETTLED } from './lib/browser-harness.mjs';

const args = process.argv.slice(2);
const folder = args.find((arg) => !arg.startsWith('--'));
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const mode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'regular';
const pages = args.includes('--pages') ? Number(args[args.indexOf('--pages') + 1]) : null;
/** After the scan, send the files it flagged through OCR, as the button does. */
const thenOcr = args.includes('--then-ocr');

if (!folder || !existsSync(folder)) {
  console.error('Usage: node scripts/run-batch.mjs <folder> [--json <out>] [--mode regular|ocr]');
  process.exit(2);
}

const SUPPORTED = /\.(pdf|png|jpe?g)$/i;
/** Upload in chunks so one setInputFiles call is not given hundreds of files. */
const CHUNK = 12;

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (SUPPORTED.test(entry.name)) out.push(full);
  }
  return out.sort();
}

const paths = await collect(folder);
if (!paths.length) {
  console.error(`No supported documents found under ${folder}`);
  process.exit(2);
}

console.log(`Batch source : ${path.resolve(folder)}`);
console.log(`Files found  : ${paths.length}`);
console.log(`Scan mode    : ${mode}`);
console.log(`Pages        : ${pages ?? 'default'}`);
console.log('');

const scanner = await launchScanner();
const startedAt = Date.now();
let accepted = 0;

try {
  await scanner.open();
  if (mode !== 'regular') await scanner.setScanMode(mode);
  if (pages) await scanner.setRegularPages(pages);

  for (let index = 0; index < paths.length; index += CHUNK) {
    const chunk = paths.slice(index, index + CHUNK);
    const files = await Promise.all(
      chunk.map(async (file) => ({
        name: path.basename(file),
        mimeType: /\.pdf$/i.test(file) ? 'application/pdf' : 'image/png',
        bytes: await readFile(file)
      }))
    );

    await scanner.addFiles(files);
    accepted += files.length;

    // Let this chunk drain before adding more, so the queue depth stays sane.
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const docs = await scanner.readDocuments();
      const pending = docs.filter((doc) => !SETTLED.includes(doc.processingStatus));
      if (docs.length >= accepted && pending.length === 0) break;
      process.stdout.write(
        `\r  settled ${docs.filter((doc) => SETTLED.includes(doc.processingStatus)).length}/${accepted}   `
      );
      await scanner.page.waitForTimeout(1_000);
    }
  }

  process.stdout.write('\r');

  let flaggedForOcr = (await scanner.readDocuments()).filter((doc) => doc.needsOcr && !doc.usedOcr).length;
  let ocrRuntimeMs = 0;
  if (thenOcr && flaggedForOcr) {
    const ocrStarted = Date.now();
    console.log(`Running OCR on the ${flaggedForOcr} flagged file(s), as the button does...`);
    await scanner.clickRunOcr();
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const current = await scanner.readDocuments();
      if (current.every((doc) => SETTLED.includes(doc.processingStatus))) break;
      await scanner.page.waitForTimeout(500);
    }
    ocrRuntimeMs = Date.now() - ocrStarted;
  }

  const docs = await scanner.readDocuments();
  const runtimeMs = Date.now() - startedAt;

  const byStatus = (status) => docs.filter((doc) => doc.processingStatus === status);
  const completed = byStatus('complete');
  const needsReview = byStatus('needs_review');
  const failed = byStatus('failed');
  const stopped = byStatus('stopped');
  const scanned = completed.length + needsReview.length + failed.length;
  const timeouts = failed.filter((doc) => doc.processingError === 'job_timeout');
  const ocrUsed = docs.filter((doc) => doc.usedOcr);
  const retried = docs.filter((doc) => (doc.attempts ?? 0) > 1);

  // The extraction score is read straight off the rendered lead rows, so it is
  // the number the scanner actually shows rather than a second implementation
  // of the same rule.
  const shownScores = await scanner.page.evaluate(() =>
    [...document.querySelectorAll('.extract-score')]
      .map((node) => Number(node.textContent))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  const averageScore = shownScores.length
    ? shownScores.reduce((sum, value) => sum + value, 0) / shownScores.length
    : 0;
  const leadCount = await scanner.page.evaluate(() => document.querySelectorAll('.extract-score').length);

  const report = {
    source: path.resolve(folder),
    mode,
    filesOnDisk: paths.length,
    accepted,
    scanned,
    completed: completed.length,
    needsReview: needsReview.length,
    truncated: docs.filter((doc) => doc.truncated).length,
    failed: failed.length,
    stopped: stopped.length,
    timeouts: timeouts.length,
    retriedOnce: retried.length,
    ocrCount: ocrUsed.length,
    leads: leadCount,
    averageExtractionScore: Number(averageScore.toFixed(1)),
    scoredLeads: shownScores.length,
    totalRuntimeMs: runtimeMs,
    flaggedForOcr,
    manualOcrRuntimeMs: ocrRuntimeMs,
    remoteOriginsAttempted: scanner.externalAttempts.length,
    pageErrors: scanner.pageErrors,
    documents: docs
      .map((doc) => ({
        filename: doc.filename,
        status: doc.processingStatus,
        docType: doc.docType ?? null,
        attempts: doc.attempts ?? 0,
        pageCount: doc.pageCount ?? null,
        usedOcr: Boolean(doc.usedOcr),
        needsOcr: Boolean(doc.needsOcr),
        textTrusted: doc.textQuality?.trusted ?? null,
        textChars: doc.textQuality?.charCount ?? null,
        textReason: doc.textQuality?.reason ?? null,
        scannedPageCount: doc.scannedPageCount ?? null,
        truncated: Boolean(doc.truncated),
        bank: doc.bankAccount?.bank ?? null,
        accountNumber: doc.bankAccount?.accountNumber ?? null,
        company: doc.companyNameGuess ?? null,
        statementName: doc.statementIdentity?.name ?? null,
        statementDba: doc.statementIdentity?.dba ?? null,
        statementAddress: doc.statementIdentity?.address ?? null,
        opening: doc.balances?.opening ?? null,
        closing: doc.balances?.ending ?? null,
        deposits: doc.statementSummary?.deposits ?? null,
        withdrawals: doc.statementSummary?.withdrawals ?? null,
        summaryEvidence: doc.statementSummary?.evidence ?? null,
        revenue: doc.deposits?.trueRevenue ?? null,
        revenueSource: doc.deposits?.trueRevenueSource ?? null,
        reconciles: doc.reconciliation?.reconciles ?? null,
        reconcileSource: doc.reconciliation?.source ?? null,
        reconcileReason: doc.reconciliation?.reason ?? null,
        reconcileDifference: doc.reconciliation?.difference ?? null,
        confidenceLevel: doc.confidence?.level ?? null,
        confidenceReasons: doc.confidence?.reasons ?? []
      }))
      .sort((a, b) => a.filename.localeCompare(b.filename)),
    failures: failed.map((doc) => ({
      filename: doc.filename,
      reason: doc.processingError ?? 'unknown',
      message: doc.processingErrorMessage ?? '',
      attempts: doc.attempts ?? 0
    }))
  };

  const seconds = (runtimeMs / 1000).toFixed(1);
  console.log('================ BATCH RESULT ================');
  console.log(`Files on disk            : ${report.filesOnDisk}`);
  console.log(`Accepted into the queue  : ${report.accepted}`);
  console.log(`Scanned (reached an end) : ${report.scanned}`);
  console.log(`Completed                : ${report.completed}`);
  console.log(`Needs review             : ${report.needsReview}`);
  console.log(`Truncated (part-read)    : ${report.truncated}`);
  console.log(`Failed                   : ${report.failed}`);
  console.log(`Stopped                  : ${report.stopped}`);
  console.log(`Timeouts                 : ${report.timeouts}`);
  console.log(`Retried once             : ${report.retriedOnce}`);
  console.log(`Used OCR                 : ${report.ocrCount}`);
  console.log(`Flagged as needing OCR   : ${report.flaggedForOcr}`);
  if (thenOcr) console.log(`Manual OCR pass          : ${(ocrRuntimeMs / 1000).toFixed(1)}s`);
  console.log(`Leads built              : ${report.leads}`);
  console.log(`Average extraction score : ${report.averageExtractionScore}% (over ${report.scoredLeads} scored leads)`);
  console.log(`Total runtime            : ${seconds}s`);
  console.log(`Remote origins attempted : ${report.remoteOriginsAttempted}`);
  console.log(`Page errors              : ${report.pageErrors.length}`);

  const reasonCounts = new Map();
  for (const doc of report.documents) {
    for (const reason of doc.confidenceReasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  if (reasonCounts.size) {
    console.log('\nWhy documents scored the way they did:');
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${reason}`);
    }
  }

  const docTypes = new Map();
  for (const doc of report.documents) docTypes.set(doc.docType ?? 'unknown', (docTypes.get(doc.docType ?? 'unknown') ?? 0) + 1);
  console.log('\nDocument types detected:');
  for (const [type, count] of [...docTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${type}`);
  }

  const trusted = report.documents.filter((doc) => doc.textTrusted === true).length;
  console.log(`\nText layer trusted       : ${trusted}/${report.documents.length}`);

  const statements = report.documents.filter((doc) => doc.docType === 'bank_statement');
  const proven = statements.filter((doc) => doc.reconcileSource === 'statement_balance_equation');
  const mismatched = statements.filter((doc) => doc.reconciles === false);
  console.log(`Statements reconciled    : ${proven.length}/${statements.length} against the bank's own printed summary`);
  console.log(`Statements that mismatch : ${mismatched.length}`);
  for (const doc of mismatched) {
    console.log(`  ${doc.filename}  out by ${doc.reconcileDifference}`);
  }

  if (report.failures.length) {
    console.log('\nEvery failed file and its reason:');
    for (const failure of report.failures) {
      console.log(`  ${failure.filename}`);
      console.log(`    reason   : ${failure.reason}`);
      console.log(`    attempts : ${failure.attempts}`);
      console.log(`    message  : ${failure.message}`);
    }
  } else {
    console.log('\nNo failed files.');
  }

  if (jsonOut) {
    await writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nFull report written to ${jsonOut}`);
  }
} finally {
  await scanner.close();
}
