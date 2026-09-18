export interface ZipExtractResult {
  pdfs: File[];
  skipped: string[];
}

const JUNK = /(?:^|\/)(?:\.DS_Store|Thumbs\.db|__MACOSX\/|\._)/i;

export async function extractPdfsFromZip(zipFile: File): Promise<ZipExtractResult> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipFile);
  const pdfs: File[] = [];
  const skipped: string[] = [];
  const jobs: Promise<void>[] = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    if (JUNK.test(relativePath)) return;
    const base = relativePath.split("/").pop() ?? relativePath;
    if (base.startsWith(".")) return;
    if (base.toLowerCase().endsWith(".pdf")) {
      jobs.push(
        entry.async("blob").then((blob) => {
          const named = relativePath.replace(/\\/g, "/");
          pdfs.push(new File([blob], named, { type: "application/pdf" }));
        }),
      );
    } else {
      skipped.push(base);
    }
  });

  await Promise.all(jobs);
  pdfs.sort((a, b) => a.name.localeCompare(b.name));
  return { pdfs, skipped };
}

export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.type === "application/x-zip"
  );
}

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
}
