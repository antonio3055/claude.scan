/**
 * Strict one-by-one test runner.
 *
 * Every suite runs in its own Node process, in order, and the real pass/fail
 * counts are parsed from each suite's own output. Nothing is summarised
 * optimistically: a suite that exits non-zero is reported as failed, and the
 * run ends non-zero.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUITES = [
  { name: 'Clean-code audit', script: 'scripts/audit.mjs' },
  { name: 'Extraction engine (v10)', script: 'scripts/test-engine.mjs' },
  { name: 'Extraction (classification + company name)', script: 'scripts/test-extraction.mjs' },
  { name: 'Statement balance equation', script: 'scripts/test-balance.mjs' },
  { name: 'Transaction parsing', script: 'scripts/test-transactions.mjs' },
  { name: 'File validation / corruption / duplicates', script: 'scripts/test-validation.mjs' },
  { name: 'Queue recovery (app restart)', script: 'scripts/test-recovery.mjs' },
  { name: 'Queue isolation', script: 'scripts/test-queue.mjs' },
  { name: 'Job runner (timeout / cancel / retry)', script: 'scripts/test-jobrunner.mjs' },
  { name: 'Vendor loader (dead-load recovery)', script: 'scripts/test-vendorloader.mjs' },
  { name: 'Offline browser (PDF.js + Tesseract)', script: 'scripts/test-offline-browser.mjs', needsBuild: true },
  { name: 'Stop cancellation (real browser)', script: 'scripts/test-stop-browser.mjs', needsBuild: true },
  { name: 'Queue failure (real browser)', script: 'scripts/test-queue-browser.mjs', needsBuild: true },
  { name: 'Manual OCR (real browser)', script: 'scripts/test-manual-ocr-browser.mjs', needsBuild: true },
  { name: 'Company info (real browser)', script: 'scripts/test-company-info-browser.mjs', needsBuild: true }
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, script)], { cwd: root });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** Read the counts the suite itself printed, not what we hoped they were. */
function parseCounts(output) {
  const summary = output.match(/:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?\./);
  if (summary) return { passed: Number(summary[1]), failed: Number(summary[2] ?? 0) };
  return {
    passed: (output.match(/^PASS /gm) || []).length,
    failed: (output.match(/^FAIL /gm) || []).length
  };
}

const results = [];

for (const suite of SUITES) {
  if (suite.needsBuild && !existsSync(path.join(root, 'dist', 'index.html'))) {
    console.log(`\n=== ${suite.name} ===`);
    console.error('SKIPPED: dist/ is missing. Run `npm run build` first.');
    results.push({ ...suite, passed: 0, failed: 0, code: 1, skipped: true });
    continue;
  }

  console.log(`\n=== ${suite.name} ===`);
  const { code, output } = await run(suite.script);
  const counts = parseCounts(output);
  results.push({ ...suite, ...counts, code });
}

const totalPassed = results.reduce((sum, item) => sum + item.passed, 0);
const totalFailed = results.reduce((sum, item) => sum + item.failed, 0);
const brokenSuites = results.filter((item) => item.code !== 0);

console.log('\n================ TEST SUMMARY ================');
for (const item of results) {
  const status = item.skipped ? 'SKIPPED' : item.code === 0 ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(8)} ${String(item.passed).padStart(3)} passed  ${String(item.failed).padStart(3)} failed  ${item.name}`);
}
console.log('---------------------------------------------');
console.log(`TOTAL    ${String(totalPassed).padStart(3)} passed  ${String(totalFailed).padStart(3)} failed  across ${results.length} suites`);

if (brokenSuites.length) {
  console.error(`\n${brokenSuites.length} suite(s) did not pass: ${brokenSuites.map((item) => item.name).join(', ')}`);
  process.exit(1);
}

console.log('\nAll suites passed.');
