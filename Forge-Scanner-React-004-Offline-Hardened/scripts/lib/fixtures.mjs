/**
 * Real test fixtures, built in memory.
 *
 * `buildTextPdf` emits a genuine PDF 1.4 file with a correct cross-reference
 * table, so PDF.js parses it for real in the offline browser test instead of
 * us mocking the parser.
 */

const encoder = new TextEncoder();

function escapePdfText(text) {
  return text.replace(/([\\()])/g, '\\$1');
}

/** One-page PDF with a Helvetica text layer containing `lines`. */
export function buildTextPdf(lines) {
  const content = [
    'BT',
    '/F1 14 Tf',
    ...lines.map((line, index) => `1 0 0 1 60 ${720 - index * 26} Tm (${escapePdfText(line)}) Tj`),
    'ET'
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return encoder.encode(pdf);
}

/** A PDF whose trailer and end-of-file marker were cut off mid-write. */
export function buildTruncatedPdf() {
  const full = buildTextPdf(['TRUNCATED FIXTURE']);
  return full.slice(0, Math.floor(full.length * 0.55));
}

/** Correct header, body replaced by noise: parses as a PDF, fails to load. */
export function buildCorruptedPdf() {
  const header = encoder.encode('%PDF-1.4\n');
  const noise = new Uint8Array(900);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37) % 251;
  const tail = encoder.encode('\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n');
  const out = new Uint8Array(header.length + noise.length + tail.length);
  out.set(header, 0);
  out.set(noise, header.length);
  out.set(tail, header.length + noise.length);
  return out;
}

/** Not a PDF at all, regardless of the filename. */
export function buildNonPdfBytes() {
  return encoder.encode('This document is plain text pretending to be a PDF.\n');
}

export function toFile(bytes, name, type) {
  return new File([bytes], name, { type });
}
