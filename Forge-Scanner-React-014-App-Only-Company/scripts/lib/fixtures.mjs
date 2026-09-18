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

function pageContent(lines, fontSize) {
  return [
    'BT',
    `/F1 ${fontSize} Tf`,
    ...lines.map((line, index) => `1 0 0 1 60 ${720 - index * (fontSize + 12)} Tm (${escapePdfText(line)}) Tj`),
    'ET'
  ].join('\n');
}

/**
 * Real multi-page PDF 1.4 with a Helvetica text layer and a correct
 * cross-reference table. `pages` is one array of lines per page.
 */
export function buildPdf(pages, { fontSize = 14 } = {}) {
  const pageCount = pages.length;
  // 1 catalog, 2 pages tree, 3 font, then one page object + one content
  // stream per page.
  const firstPageObj = 4;
  const kids = pages.map((_, index) => `${firstPageObj + index * 2} 0 R`).join(' ');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  pages.forEach((lines, index) => {
    const contentObj = firstPageObj + index * 2 + 1;
    const content = pageContent(lines, fontSize);
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

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

/**
 * A page that draws marks but carries no text layer, which is what a scan of
 * paper looks like to PDF.js: real pages, zero extractable characters.
 */
export function buildImageOnlyPdf() {
  const content = ['0.2 0.2 0.2 rg', '60 600 480 120 re f', '60 480 300 60 re f'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
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

/** One-page PDF with a Helvetica text layer containing `lines`. */
export function buildTextPdf(lines) {
  return buildPdf([lines]);
}

/**
 * A long PDF. Used to keep a scan running long enough that Stop can be
 * clicked while a page is genuinely being processed.
 */
export function buildLongPdf(pageCount, lines) {
  return buildPdf(
    Array.from({ length: pageCount }, (_, index) => [`Page ${index + 1} of ${pageCount}`, ...lines])
  );
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
