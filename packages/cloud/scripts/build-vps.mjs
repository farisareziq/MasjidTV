// Builds the MasjidTV cloud app for VPS deployment (not Vercel).
// Produces packages/cloud/dist/ with:
//   server.js          — standalone server entry point
//   app.js + routes/   — compiled cloud app
//   public/            — static assets (CSS/JS/images/vendor/manifest)
//
// Run: node scripts/build-vps.mjs
// Then: node dist/server.js  (with .env configured)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');
const monoRoot = path.join(pkgRoot, '..', '..');

// 1. Build workspace deps (shared, db).
const tsc = path.join(monoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'shared', 'tsconfig.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'db', 'tsconfig.json')], { stdio: 'inherit' });

// 2. Build frontend TS -> public-cloud*/js (avoid drift).
execFileSync(process.execPath, [path.join(monoRoot, 'packages', 'frontend', 'build.mjs')], { stdio: 'inherit' });

// 3. Embed HTML pages + sw.js into pages.generated.ts.
execFileSync(process.execPath, [path.join(__dirname, 'gen-pages.mjs')], { stdio: 'inherit' });

// 4. Compile cloud TypeScript -> dist/.
fs.rmSync(path.join(pkgRoot, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', path.join(pkgRoot, 'tsconfig.json')], { stdio: 'inherit' });

// 5. Copy static assets (CSS/JS/images/vendor/manifest) to dist/public/.
// HTML pages + sw.js are already embedded in pages.generated.ts (base64) —
// skip them to keep dist/public/ lean.
const publicCloud = path.join(pkgRoot, '..', 'frontend', 'public-cloud');
const destPublic = path.join(pkgRoot, 'dist', 'public');
fs.mkdirSync(destPublic, { recursive: true });
const SKIP = new Set(['admin.html', 'display.html', 'guide.html', 'sw.js']);
function copyStatic(srcDir, rel = '') {
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) copyStatic(src, relPath);
    else if (SKIP.has(e.name)) continue;
    else {
      const dest = path.join(destPublic, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}
copyStatic(publicCloud);
console.log('[vps-build] static assets copied to dist/public/');

console.log('[vps-build] build complete.');
console.log('');
console.log('Next steps:');
console.log('  1. Copy .env.vps.example -> .env, fill in values');
console.log('  2. node dist/server.js');
console.log('  Or: pnpm --filter @masjidtv/cloud start');
