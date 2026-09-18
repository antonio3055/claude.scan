/**
 * File validation, corrupted-PDF detection and duplicate handling.
 *
 * Runs the production `fileValidation.js` against real `File` objects and real
 * PDF bytes — Node provides both `File` and WebCrypto, so nothing is stubbed.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import {
  findDuplicate,
  hashFile,
  inspectPdfStructure,
  validateFile
} from '../src/scanner/services/fileValidation.js';
import {
  buildCorruptedPdf,
  buildNonPdfBytes,
  buildTextPdf,
  buildTruncatedPdf,
  toFile
} from './lib/fixtures.mjs';

const reporter = createReporter('Validation tests');

const settings = {
  mode: 'regular',
  regularPages: 3,
  ocrPages: 1,
  maxFiles: 500,
  maxFileBytes: 40 * 1024 * 1024,
  duplicateHandling: 'flag'
};

const goodPdfBytes = buildTextPdf(['ACCOUNT HOLDER: NORTHWIND TRADING LLC', 'TOTAL DEPOSITS 125,430.00']);

await reporter.check('an empty file is rejected', async () => {
  const result = await validateFile(toFile(new Uint8Array(0), 'empty.pdf', 'application/pdf'), settings);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'empty_file');
});

await reporter.check('an oversized file is rejected', async () => {
  const result = await validateFile(toFile(goodPdfBytes, 'big.pdf', 'application/pdf'), {
    ...settings,
    maxFileBytes: 10
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'file_too_large');
});

await reporter.check('an unsupported extension is rejected', async () => {
  const result = await validateFile(toFile(goodPdfBytes, 'statement.docx', 'application/octet-stream'), settings);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'unsupported_file_type');
});

await reporter.check('a non-PDF renamed to .pdf is rejected on its signature', async () => {
  const result = await validateFile(toFile(buildNonPdfBytes(), 'fake.pdf', 'application/pdf'), settings);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'not_a_real_pdf_signature');
});

await reporter.check('a real PDF passes with no structure warnings', async () => {
  const result = await validateFile(toFile(goodPdfBytes, 'statement.pdf', 'application/pdf'), settings);
  assert.equal(result.valid, true);
  assert.equal(result.kind, 'pdf');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.corrupted, false);
});

await reporter.check('a truncated PDF is detected as corrupted before PDF.js is called', async () => {
  const result = await validateFile(toFile(buildTruncatedPdf(), 'cut-off.pdf', 'application/pdf'), settings);
  assert.equal(result.valid, true, 'it still gets its attempt plus one retry');
  assert.equal(result.corrupted, true);
  assert.deepEqual(result.warnings, ['pdf_missing_eof', 'pdf_missing_startxref']);
});

await reporter.check('structure inspection reports a missing end-of-file marker on its own', async () => {
  const bytes = buildTextPdf(['NO EOF']);
  const withoutEof = bytes.slice(0, bytes.length - 7);
  const result = await inspectPdfStructure(toFile(withoutEof, 'no-eof.pdf', 'application/pdf'));
  assert.deepEqual(result.warnings, ['pdf_missing_eof']);
  assert.equal(result.corrupted, false, 'one warning alone is not proof of corruption');
});

await reporter.check('a PDF with a valid header but destroyed body still validates for a scan attempt', async () => {
  const result = await validateFile(toFile(buildCorruptedPdf(), 'garbage.pdf', 'application/pdf'), settings);
  assert.equal(result.valid, true);
  assert.equal(result.kind, 'pdf');
});

await reporter.check('a PNG is accepted as an image', async () => {
  const result = await validateFile(toFile(new Uint8Array([137, 80, 78, 71, 1, 2, 3]), 'scan.png', 'image/png'), settings);
  assert.equal(result.valid, true);
  assert.equal(result.kind, 'image');
});

await reporter.check('hashing is content based and stable', async () => {
  const a = await hashFile(toFile(goodPdfBytes, 'one.pdf', 'application/pdf'));
  const b = await hashFile(toFile(goodPdfBytes, 'renamed.pdf', 'application/pdf'));
  const c = await hashFile(toFile(buildTruncatedPdf(), 'other.pdf', 'application/pdf'));
  assert.equal(a, b, 'the same bytes under a different name are the same document');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

await reporter.check('a duplicate is found by hash and size together', async () => {
  const docs = [
    { fileId: 'doc_1', fileHash: 'aaa', fileSize: 100 },
    { fileId: 'doc_2', fileHash: 'bbb', fileSize: 200 }
  ];
  const hit = findDuplicate(docs, { fileId: 'doc_3', fileHash: 'aaa', fileSize: 100 });
  assert.equal(hit.fileId, 'doc_1');
});

await reporter.check('a file is never a duplicate of itself', async () => {
  const docs = [{ fileId: 'doc_1', fileHash: 'aaa', fileSize: 100 }];
  assert.equal(findDuplicate(docs, { fileId: 'doc_1', fileHash: 'aaa', fileSize: 100 }), null);
});

await reporter.check('a matching hash with a different size is not treated as a duplicate', async () => {
  const docs = [{ fileId: 'doc_1', fileHash: 'aaa', fileSize: 100 }];
  assert.equal(findDuplicate(docs, { fileId: 'doc_2', fileHash: 'aaa', fileSize: 999 }), null);
});

await reporter.check('a document with no hash yet is never matched', async () => {
  const docs = [{ fileId: 'doc_1', fileHash: 'aaa', fileSize: 100 }];
  assert.equal(findDuplicate(docs, { fileId: 'doc_2', fileHash: undefined, fileSize: 100 }), null);
});

reporter.done();
