/**
 * Write the generated test fixtures to disk so they can be opened and checked
 * by hand. The tests build these in memory from `scripts/lib/fixtures.mjs`;
 * this script just materialises the same bytes.
 *
 *   node scripts/write-fixtures.mjs [outDir]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCorruptedPdf,
  buildLongPdf,
  buildNonPdfBytes,
  buildTextPdf,
  buildTruncatedPdf
} from './lib/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'fixtures'));

const STATEMENT = [
  'FIRST NATIONAL BANK',
  'Account Statement',
  'ACCOUNT HOLDER: NORTHWIND TRADING LLC',
  'Account Number: 1234567890',
  'Statement Period: 01/01/2026 - 01/31/2026',
  'Beginning Balance 12,500.00',
  'Total Deposits 125,430.00',
  'Total Withdrawals 98,220.00',
  'Ending Balance 39,710.00'
];

const fixtures = {
  'good-statement.pdf': buildTextPdf(STATEMENT),
  'long-statement-8-pages.pdf': buildLongPdf(8, STATEMENT),
  'corrupted-body.pdf': buildCorruptedPdf(),
  'truncated.pdf': buildTruncatedPdf(),
  'not-a-pdf.pdf': buildNonPdfBytes()
};

await mkdir(outDir, { recursive: true });
for (const [name, bytes] of Object.entries(fixtures)) {
  const target = path.join(outDir, name);
  await writeFile(target, bytes);
  console.log(`${String(bytes.length).padStart(8)} bytes  ${target}`);
}

console.log(`\n${Object.keys(fixtures).length} fixtures written to ${outDir}`);
console.log('The OCR fixture is not a file: it is drawn onto a canvas in the browser');
console.log('during the offline test, then read back by Tesseract.');
