// Copia el worker y el WASM de libarchive.js a public/vendor/libarchive.
//
// libarchive.js carga su worker desde una URL y el WASM se resuelve de forma
// relativa al worker, por lo que ambos archivos deben servirse juntos.
// Se ejecuta en predev/prebuild para que el build de Astro los incluya.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const srcDir = join(root, 'node_modules', 'libarchive.js', 'dist');
const destDir = join(root, 'public', 'vendor', 'libarchive');

const files = ['worker-bundle.js', 'libarchive.wasm'];

try {
  await mkdir(destDir, { recursive: true });
  await Promise.all(files.map((file) => copyFile(join(srcDir, file), join(destDir, file))));
  console.log('[libarchive] worker y wasm copiados a public/vendor/libarchive');
} catch (error) {
  console.warn('[libarchive] No se pudieron copiar los archivos:', error.message);
}
