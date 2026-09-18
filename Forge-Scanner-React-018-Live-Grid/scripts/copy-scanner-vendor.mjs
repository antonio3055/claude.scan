import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'scanner-vendor');

async function copyRequired(from, to) {
  if (!existsSync(from)) throw new Error(`Missing vendor file: ${from}`);
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to);
}

async function findFile(dir, fileName) {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = path.join(dir, name);
    const s = await stat(full);
    if (s.isFile() && name === fileName) return full;
    if (s.isDirectory()) {
      const found = await findFile(full, fileName);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  const nm = path.join(root, 'node_modules');
  if (!existsSync(nm)) {
    console.error('node_modules is missing. Run npm install first.');
    process.exit(2);
  }

  const pdfRoot = path.join(nm, 'pdfjs-dist');
  await copyRequired(path.join(pdfRoot, 'build', 'pdf.min.js'), path.join(out, 'pdfjs', 'pdf.min.js'));
  await copyRequired(path.join(pdfRoot, 'build', 'pdf.worker.min.js'), path.join(out, 'pdfjs', 'pdf.worker.min.js'));

  const tessRoot = path.join(nm, 'tesseract.js');
  await copyRequired(path.join(tessRoot, 'dist', 'tesseract.min.js'), path.join(out, 'tesseract', 'tesseract.min.js'));
  await copyRequired(path.join(tessRoot, 'dist', 'worker.min.js'), path.join(out, 'tesseract', 'worker.min.js'));

  const coreRoot = path.join(nm, 'tesseract.js-core');
  for (const f of [
    'tesseract-core.wasm.js',
    'tesseract-core-simd.wasm.js',
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm.js'
  ]) {
    await copyRequired(path.join(coreRoot, f), path.join(out, 'tesseract', 'core', f));
  }

  const langRoot = path.join(nm, '@tesseract.js-data', 'eng');
  const trained = await findFile(langRoot, 'eng.traineddata.gz');
  if (!trained) throw new Error(`eng.traineddata.gz was not found under ${langRoot}`);
  await copyRequired(trained, path.join(out, 'tesseract', 'lang', 'eng.traineddata.gz'));

  // The full Latin + Latin Extended range of the Inter Variable font (weight
  // axis 100-900, which is what lets the UI's non-integer font-weight values
  // like 520/650 render as real in-between weights instead of snapping to a
  // handful of static cuts). Other Unicode ranges the package ships
  // (Cyrillic, Greek, Vietnamese, ...) are left out: this UI is English-only.
  const fontRoot = path.join(nm, '@fontsource-variable', 'inter', 'files');
  for (const f of ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']) {
    await copyRequired(path.join(fontRoot, f), path.join(out, 'fonts', f));
  }

  console.log('Scanner vendor assets copied locally. Runtime CDN access is not required.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
