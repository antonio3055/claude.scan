export interface ZipExtractResult {
  pdfs: File[];
  skipped: string[];
}

const JUNK = /(?:^|\/)(?:\.DS_Store|Thumbs\.db|__MACOSX\/|\._)/i;

export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.zip') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.type === 'application/x-zip'
  );
}

/** Unzips a dropped/picked .zip client-side, including nested folders. */
export async function extractPdfsFromZip(zipFile: File): Promise<ZipExtractResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  const pdfs: File[] = [];
  const skipped: string[] = [];
  const jobs: Promise<void>[] = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (JUNK.test(relativePath)) return;
    const base = relativePath.split('/').pop() ?? relativePath;
    if (base.startsWith('.')) return;
    if (base.toLowerCase().endsWith('.pdf')) {
      jobs.push(
        entry.async('blob').then((blob) => {
          pdfs.push(new File([blob], relativePath.replace(/\\/g, '/'), { type: 'application/pdf' }));
        })
      );
    } else {
      skipped.push(base);
    }
  });

  await Promise.all(jobs);
  pdfs.sort((a, b) => a.name.localeCompare(b.name));
  return { pdfs, skipped };
}

/**
 * Expands every zip in `files` into the PDFs it contains and passes
 * non-zip files through untouched. Used by the upload handler so a zip
 * behaves exactly like dropping its PDFs directly.
 */
export async function expandZips(files: File[]): Promise<{ files: File[]; notices: string[] }> {
  const expanded: File[] = [];
  const notices: string[] = [];

  for (const file of files) {
    if (!isZipFile(file)) {
      expanded.push(file);
      continue;
    }
    try {
      const { pdfs, skipped } = await extractPdfsFromZip(file);
      notices.push(`${pdfs.length} file${pdfs.length === 1 ? '' : 's'} found in ${file.name}`);
      if (skipped.length) {
        const preview = skipped.slice(0, 3).join(', ');
        notices.push(`Skipped non-PDF in ${file.name}: ${preview}${skipped.length > 3 ? ` +${skipped.length - 3} more` : ''}`);
      }
      expanded.push(...pdfs);
    } catch {
      notices.push(`Could not read ${file.name}`);
    }
  }

  return { files: expanded, notices };
}
