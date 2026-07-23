// Copies jscanify's bundled opencv.js build into public/ so it's served
// self-hosted (matches the landing cover pool's self-hosting precedent)
// instead of pulling the ~8MB WASM/asm.js blob from docs.opencv.org at
// runtime. jscanify itself expects a global `cv` — see lib/sleeveDetector.ts,
// which loads this file via a runtime <script> tag only when the camera's
// auto-capture mode is actually used, not on app boot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcFile = path.join(__dirname, '..', 'node_modules', 'jscanify', 'src', 'opencv.js');
const destFile = path.join(__dirname, '..', 'public', 'opencv.js');

if (!fs.existsSync(srcFile)) {
  console.log('[copyOpenCv] jscanify not installed — skipping');
  process.exit(0);
}

fs.copyFileSync(srcFile, destFile);
console.log('[copyOpenCv] Copied opencv.js to public/opencv.js');
