/**
 * File validation, corruption detection and duplicate detection.
 *
 * Deliberately free of DOM and PDF.js APIs: it only needs Blob/File and
 * WebCrypto, both of which exist in the browser and in Node, so the exact
 * production implementation is what the Node test suite exercises.
 */

const PDF_HEADER = '%PDF-';
const TAIL_BYTES = 2048;

const decoder = new TextDecoder('latin1');

async function readSlice(file, start, end) {
  const buffer = await file.slice(start, end).arrayBuffer();
  return decoder.decode(new Uint8Array(buffer));
}

/**
 * Structural checks beyond the header. A PDF that fails these is very likely
 * truncated or corrupted; we record the reason instead of letting PDF.js fail
 * later with an opaque message.
 */
export async function inspectPdfStructure(file) {
  const warnings = [];
  const tail = await readSlice(file, Math.max(0, file.size - TAIL_BYTES), file.size);

  if (!tail.includes('%%EOF')) warnings.push('pdf_missing_eof');
  if (!tail.includes('startxref')) warnings.push('pdf_missing_startxref');

  return { warnings, corrupted: warnings.length === 2 };
}

export async function validateFile(file, settings) {
  if (!file || file.size === 0) {
    return { valid: false, reason: 'empty_file' };
  }
  if (file.size > settings.maxFileBytes) {
    return { valid: false, reason: 'file_too_large' };
  }

  const isPdf = /\.pdf$/i.test(file.name);
  const isImage = /\.(png|jpe?g)$/i.test(file.name);
  if (!isPdf && !isImage) {
    return { valid: false, reason: 'unsupported_file_type' };
  }

  if (!isPdf) {
    return { valid: true, kind: 'image', warnings: [] };
  }

  const header = await readSlice(file, 0, PDF_HEADER.length);
  if (header !== PDF_HEADER) {
    return { valid: false, reason: 'not_a_real_pdf_signature' };
  }

  const structure = await inspectPdfStructure(file);
  if (structure.corrupted) {
    // No trailer and no end-of-file marker: the file is truncated. It is still
    // handed to PDF.js, which is given one attempt plus one retry, but the
    // cause is already recorded so a later failure is explainable.
    return { valid: true, kind: 'pdf', warnings: structure.warnings, corrupted: true };
  }

  return { valid: true, kind: 'pdf', warnings: structure.warnings, corrupted: false };
}

export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * First already-known document with the same content hash. Size is compared
 * as well so a hash collision cannot merge two genuinely different files.
 */
export function findDuplicate(documents, candidate) {
  if (!candidate?.fileHash) return null;
  return (
    documents.find(
      (doc) =>
        doc.fileId !== candidate.fileId &&
        doc.fileHash === candidate.fileHash &&
        doc.fileSize === candidate.fileSize
    ) ?? null
  );
}
