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

/** Lets the browser actually paint before/during a long synchronous stretch
 *  (zip inflate is CPU-bound and single-threaded -- Promise.all alone never
 *  yields control back to the event loop, so the page can freeze solid with
 *  nothing on screen even though a state update already fired). */
function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Unzips a dropped/picked .zip client-side, including nested folders.
 * Entries are inflated one at a time (not Promise.all'd) with a real yield
 * between each, so the page stays responsive and `onProgress` can paint a
 * live count instead of the browser going silent for however long the
 * whole archive takes.
 */
export async function extractPdfsFromZip(
  zipFile: Blob,
  onProgress?: (found: number, scanned: number, total: number) => void,
  // Where a zip found inside another zip sat, so its PDFs land in that same
  // folder -- next to the company's other files -- rather than on their own.
  pathPrefix = '',
  // One level of zip-in-a-zip, as CRM submissions arrive; never deeper, so a
  // hostile archive cannot recurse without end.
  depth = 0
): Promise<ZipExtractResult> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  const pdfs: File[] = [];
  const skipped: string[] = [];

  const entries: Array<[string, (typeof zip.files)[string]]> = [];
  zip.forEach((relativePath, entry) => entries.push([relativePath, entry]));
  const total = entries.length;

  for (let i = 0; i < entries.length; i += 1) {
    const [relativePath, entry] = entries[i];
    if (!entry.dir && !JUNK.test(relativePath)) {
      const path = `${pathPrefix}${relativePath.replace(/\\/g, '/')}`;
      const base = relativePath.split('/').pop() ?? relativePath;
      if (!base.startsWith('.')) {
        if (base.toLowerCase().endsWith('.pdf')) {
          const blob = await entry.async('blob');
          pdfs.push(new File([blob], path, { type: 'application/pdf' }));
        } else if (base.toLowerCase().endsWith('.zip') && depth === 0) {
          try {
            const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
            const inner = await extractPdfsFromZip(await entry.async('blob'), undefined, folder, depth + 1);
            pdfs.push(...inner.pdfs);
            skipped.push(...inner.skipped);
          } catch {
            skipped.push(base);
          }
        } else {
          skipped.push(base);
        }
      }
    }
    onProgress?.(pdfs.length, i + 1, total);
    await yieldToBrowser();
  }

  pdfs.sort((a, b) => a.name.localeCompare(b.name));
  return { pdfs, skipped };
}

/**
 * Expands every zip in `files` into the PDFs it contains and passes
 * non-zip files through untouched. Used by the upload handler so a zip
 * behaves exactly like dropping its PDFs directly.
 */
export async function expandZips(
  files: File[],
  onProgress?: (found: number, scanned: number, total: number) => void
): Promise<{ files: File[]; notices: string[] }> {
  const expanded: File[] = [];
  const notices: string[] = [];

  for (const file of files) {
    if (!isZipFile(file)) {
      expanded.push(file);
      continue;
    }
    try {
      const { pdfs, skipped } = await extractPdfsFromZip(file, onProgress);
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
