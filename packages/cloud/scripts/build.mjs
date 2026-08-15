// Builds the Vercel serverless function with esbuild:
// 1. typecheck with tsc (paths map workspace pkgs to source, noEmit)
// 2. bundle api entry (+ inline workspace sources) into dist/api/index.js
// Bundling removes cross-package .d.ts resolution entirely (the source of the
// Vercel-only type collapse) and improves cold-start size.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..'); // packages/cloud
const monoRoot = path.join(pkgRoot, '..', '..');

// Stub for better-sqlite3 in the cloud bundle: the cloud app never uses the
// local (better-sqlite3) client; importing it at runtime would fail on the
// serverless runtime (native addon). The stub throws only if actually called.
const stubDir = path.join(pkgRoot, '.build-stubs');
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, 'better-sqlite3.js'),
  'export default function unavailable() { throw new Error("better-sqlite3 is not available in the cloud bundle"); }\n');

// 1. Build workspace deps (shared, db) — the cloud typecheck resolves them
// through node_modules workspace links to their dist output.
const tsc = path.join(monoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'shared', 'tsconfig.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'db', 'tsconfig.json')], { stdio: 'inherit' });

// 2. Typecheck the cloud app (plain node_modules resolution).
execFileSync(process.execPath, [tsc, '-p', path.join(pkgRoot, 'tsconfig.json'), '--noEmit'], {
  stdio: 'inherit'
});

// 2. Bundle the api entry.
fs.rmSync(path.join(pkgRoot, 'dist'), { recursive: true, force: true });
await build({
  entryPoints: [path.join(pkgRoot, 'src', 'api', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: path.join(pkgRoot, 'dist', 'api', 'index.js'),
  external: [],
  alias: {
    '@masjidtv/shared': path.join(monoRoot, 'packages', 'shared', 'src', 'index.ts'),
    '@masjidtv/db': path.join(monoRoot, 'packages', 'db', 'src', 'index.ts'),
    'better-sqlite3': path.join(stubDir, 'better-sqlite3.js')
  },
  // Native/platform packages stay external — resolved from node_modules at
  // runtime (esbuild would otherwise inline the wrong platform binary).
  external: ['@libsql/client', '@libsql/core', '@libsql/linux-x64-gnu', 'jsonwebtoken', 'bcryptjs'],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __ffurl } from 'node:url';",
      "import { dirname as __dname } from 'node:path';",
      "const __filename = __ffurl(import.meta.url);",
      "const __dirname = __dname(__filename);",
      "const require = __createRequire(import.meta.url);"
    ].join('\n')
  }
});

console.log('[cloud-build] bundled -> dist/api/index.js');
