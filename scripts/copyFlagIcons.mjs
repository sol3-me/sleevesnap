// Copies flag-icons' 4x3 SVGs into public/flags so they're served as plain
// static files (fetched on-demand per flag actually rendered, cached by the
// browser) instead of bundled — importing the package's CSS directly pulls
// every flag's url() reference into the build, inflating the CSS bundle by
// ~400KB for a feature that only ever shows a couple of tiny flags at once.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'node_modules', 'flag-icons', 'flags', '4x3');
const destDir = path.join(__dirname, '..', 'public', 'flags');

// flag-icons is a devDependency (only its SVGs are needed, at build time —
// nothing at runtime imports the package itself), so it's absent from a
// production `npm ci --omit=dev` install. That's fine: that install only
// ever runs against the already-built dist/ output, which already has
// public/flags baked in from the build stage — nothing to regenerate here.
if (!fs.existsSync(srcDir)) {
  console.log('[copyFlagIcons] flag-icons not installed (production/--omit=dev install) — skipping');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((file) => file.endsWith('.svg'));
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`[copyFlagIcons] Copied ${files.length} flag SVGs to public/flags`);
