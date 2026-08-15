// Build a distributable MasjidTV bundle (zip-build distribution).
//
// The reference flagged Node SEA + better-sqlite3 as the highest-risk item.
// better-sqlite3 is a native addon that does NOT bundle cleanly into a Node SEA
// single binary. This script therefore produces the documented mitigation:
// a self-contained `dist/masjidtv/` folder that runs on plain Node (no npm/git
// on the mini PC), containing the compiled server, frontend, and the required
// native better-sqlite3 module for the target platform.
//
// Usage: node scripts/build-dist.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist', 'masjidtv');

function copy(src, dst, { dereference = true } = {}) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, dereference });
}

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('[build-dist] compiling server...');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', 'packages/server/tsconfig.json'], {
  cwd: root,
  stdio: 'inherit'
});

rm(outDir);
fs.mkdirSync(outDir, { recursive: true });

// Compiled server + shared + db packages (dereference pnpm symlinks!).
console.log('[build-dist] bundling compiled JS...');
copy(path.join(root, 'packages/server/dist'), path.join(outDir, 'server'));
for (const pkg of ['shared', 'db']) {
  const dest = path.join(outDir, 'node_modules', '@masjidtv', pkg);
  copy(path.join(root, `packages/${pkg}/dist`), path.join(dest, 'dist'));
  // package.json diperlukan supaya require.resolve('@masjidtv/<pkg>') berjaya.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, `packages/${pkg}/package.json`), 'utf8'));
  const minimal = {
    name: manifest.name,
    version: manifest.version,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }
  };
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(minimal, null, 2));
}

// Frontend public assets — at server/../frontend/public so the default
// PUBLIC_DIR (join(__dirname,'..','frontend','public') from server/index.js)
// resolves correctly in the bundle.
console.log('[build-dist] bundling frontend...');
copy(path.join(root, 'packages/frontend/public'), path.join(outDir, 'frontend', 'public'));

// Kiosk scripts.
console.log('[build-dist] bundling kiosk scripts...');
copy(path.join(root, 'packages/server/scripts'), path.join(outDir, 'scripts'));

// Runtime dependencies — dereference pnpm's symlink layout into real files.
// Walk EVERY workspace package's node_modules (pnpm keeps each package's deps
// in its own node_modules; e.g. @libsql/client lives under packages/db, not
// packages/server) and merge into one flat node_modules.
console.log('[build-dist] flattening node_modules (this can take a minute)...');
for (const pkg of ['shared', 'db', 'server']) {
  copyPackage(path.join(root, 'packages', pkg, 'node_modules'), path.join(outDir, 'node_modules'));
}
// pnpm's hoisted store (node_modules/.pnpm/node_modules) contains ALL
// transitive deps — copy it last so every import resolves from the flat root
// (covers sibling deps like @libsql/core for @libsql/client).
const hoisted = path.join(root, 'node_modules', '.pnpm', 'node_modules');
if (fs.existsSync(hoisted)) {
  copyPackage(hoisted, path.join(outDir, 'node_modules'));
}

function copyPackage(pkgDir, destBase) {
  if (!fs.existsSync(pkgDir)) return;
  for (const entry of fs.readdirSync(pkgDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = path.join(pkgDir, entry.name);
    const destPath = path.join(destBase, entry.name);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(srcPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(real, destPath, { recursive: true, dereference: true });
    } else if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        copyPackage(srcPath, destPath);
      } else {
        fs.mkdirSync(destPath, { recursive: true });
        fs.cpSync(srcPath, destPath, { recursive: true, dereference: true });
      }
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Startup scripts. start.bat sets PUBLIC_DIR for belt-and-braces; node
// server\index.js also works standalone via the corrected default depth.
const startBat = `@echo off
set "MASJIDTV_PUBLIC_DIR=%~dp0frontend\\public"
node "%~dp0server\\index.js"
`;
fs.writeFileSync(path.join(outDir, 'start.bat'), startBat);

console.log(`[build-dist] done -> ${outDir}`);
