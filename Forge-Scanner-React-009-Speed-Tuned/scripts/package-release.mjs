/**
 * Assemble the delivery ZIP and split it into parts small enough to send.
 *
 * The ZIP carries everything needed to install, build and test with no
 * internet: source, tests, the vendor assets, the built `dist/` and a populated
 * npm cache. It refuses to run if any of those are missing, so the package can
 * never claim to contain something it does not.
 *
 *   node scripts/package-release.mjs [--out <dir>] [--part-size-mb 28]
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = path.basename(root);
const parent = path.dirname(root);

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : parent;
const partSizeMb = args.includes('--part-size-mb') ? Number(args[args.indexOf('--part-size-mb') + 1]) : 28;
const partSize = partSizeMb * 1024 * 1024;

/** Everything the README promises is in the package. */
const REQUIRED = [
  'package.json',
  'package-lock.json',
  'README.md',
  'VERIFICATION.txt',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'src/scanner/ScannerPage.tsx',
  'src/scanner/services/jobRunner.js',
  'src/scanner/services/vendorLoader.js',
  'src/scanner/services/pdfRows.js',
  'src/scanner/engine/companyName.js',
  'src/scanner/engine/balanceEquation.js',
  'scripts/test-balance.mjs',
  'dist/index.html',
  'dist/scanner-vendor/pdfjs/pdf.min.js',
  'dist/scanner-vendor/pdfjs/pdf.worker.min.js',
  'dist/scanner-vendor/tesseract/tesseract.min.js',
  'dist/scanner-vendor/tesseract/worker.min.js',
  'dist/scanner-vendor/tesseract/core/tesseract-core.wasm.js',
  'dist/scanner-vendor/tesseract/core/tesseract-core-simd.wasm.js',
  'dist/scanner-vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'dist/scanner-vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'dist/scanner-vendor/tesseract/lang/eng.traineddata.gz',
  'public/scanner-vendor/pdfjs/pdf.min.js',
  'public/scanner-vendor/tesseract/lang/eng.traineddata.gz',
  'fixtures/good-statement.pdf',
  'fixtures/long-statement-8-pages.pdf',
  'fixtures/corrupted-body.pdf',
  'fixtures/truncated.pdf',
  'fixtures/not-a-pdf.pdf',
  'npm-cache'
];

const missing = [];
for (const relative of REQUIRED) {
  const full = path.join(root, relative);
  if (!existsSync(full)) {
    missing.push(relative);
    continue;
  }
  const info = await stat(full);
  if (info.isFile() && info.size === 0) missing.push(`${relative} (empty)`);
}

if (missing.length) {
  console.error('Refusing to package. These are missing or empty:');
  for (const entry of missing) console.error(`  ${entry}`);
  console.error('\nRun `npm install` and `npm run build` first.');
  process.exit(1);
}

const cacheEntries = await readdir(path.join(root, 'npm-cache'));
if (!cacheEntries.length) {
  console.error('Refusing to package: npm-cache/ is empty.');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const zipPath = path.join(outDir, `${name}.zip`);
await rm(zipPath, { force: true });
for (const entry of await readdir(outDir)) {
  if (entry.startsWith(`${name}.zip.part`)) await rm(path.join(outDir, entry));
}

console.log(`Packaging ${name} ...`);
await run('zip', ['-rq', zipPath, name, '-x', `${name}/node_modules/*`, '-x', '*.DS_Store'], { cwd: parent });

const zipInfo = await stat(zipPath);
console.log(`ZIP: ${zipPath} (${(zipInfo.size / 1024 / 1024).toFixed(1)} MB)`);

if (zipInfo.size <= partSize) {
  console.log('Small enough to send whole; no split needed.');
  process.exit(0);
}

// Split into numbered parts that rejoin with a plain `cat`.
const partCount = Math.ceil(zipInfo.size / partSize);
const source = await open(zipPath, 'r');
try {
  for (let index = 0; index < partCount; index += 1) {
    const partPath = `${zipPath}.part${String(index).padStart(2, '0')}`;
    const target = await open(partPath, 'w');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let written = 0;
      while (written < partSize) {
        const chunk = Math.min(buffer.length, partSize - written);
        const { bytesRead } = await source.read(buffer, 0, chunk, index * partSize + written);
        if (bytesRead === 0) break;
        await target.write(buffer, 0, bytesRead);
        written += bytesRead;
      }
      console.log(`  ${path.basename(partPath)}  ${(written / 1024 / 1024).toFixed(1)} MB`);
    } finally {
      await target.close();
    }
  }
} finally {
  await source.close();
}

console.log(`\nRejoin with:\n  cat ${name}.zip.part* > ${name}.zip`);
