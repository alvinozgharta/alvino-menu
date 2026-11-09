import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));

mkdirSync(publicDirectory, { recursive: true });

for (const [source, destination] of [
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['legacy/build/pdf.worker.min.mjs', 'pdf.worker.legacy.min.mjs'],
]) {
  copyFileSync(join(pdfjsRoot, source), join(publicDirectory, destination));
}
