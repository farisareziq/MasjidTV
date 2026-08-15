// Builds the Vercel deployment via the Build Output API (v3):
// .vercel/output/
//   static/            -> placeholder (all routing goes to the function)
//   functions/api/index.func/  -> the esbuild bundle + runtime bootstrap
// This bypasses framework detection entirely — deterministic function shape.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..'); // packages/cloud
const monoRoot = path.join(pkgRoot, '..', '..');
const outRoot = path.join(pkgRoot, '.vercel', 'output');

// 1. Build workspace deps (shared, db).
const tsc = path.join(monoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'shared', 'tsconfig.json')], { stdio: 'inherit' });
execFileSync(process.execPath, [tsc, '-p', path.join(monoRoot, 'packages', 'db', 'tsconfig.json')], { stdio: 'inherit' });

// (Typecheck runs in CI locally; the Vercel builder resolves @masjidtv/db
// types through an install-time snapshot that produces phantom errors.
// esbuild below fails loudly on real breakage.)

// 2. esbuild bundle the serverless entry.
fs.rmSync(path.join(pkgRoot, 'dist'), { recursive: true, force: true });

// Stub for better-sqlite3: cloud never uses the local client; a static
// import of the native addon would crash on the serverless runtime.
const stubDir = path.join(pkgRoot, '.build-stubs');
fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, 'better-sqlite3.js'),
  'export default function unavailable() { throw new Error("better-sqlite3 is not available in the cloud bundle"); }\n');
// @vercel/blob lazily requires @neon-rs/load only for Neon Postgres flows we
// never use — stub it so bundling doesn't leave a dangling require.
fs.writeFileSync(path.join(stubDir, 'neon-rs-load.js'),
  'module.exports = function load() { throw new Error("@neon-rs/load is not available in the cloud bundle"); };\n');

await build({
  entryPoints: [path.join(pkgRoot, 'src', 'api', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(pkgRoot, 'dist', 'api', 'index.cjs'),
  alias: {
    '@masjidtv/shared': path.join(monoRoot, 'packages', 'shared', 'src', 'index.ts'),
    '@masjidtv/db': path.join(monoRoot, 'packages', 'db', 'src', 'index.ts'),
    'better-sqlite3': path.join(stubDir, 'better-sqlite3.js'),
    '@neon-rs/load': path.join(stubDir, 'neon-rs-load.js')
  },
  // @libsql/client stays EXTERNAL — its JS+native dependency cluster is
  // copied wholesale into the function dir below (bundling it produced a
  // broken hrana-only client; the real package resolves the correct
  // http/ws protocol against libsql:// URLs).
  external: ['@libsql/client']
});

// 3. Assemble Build Output API layout.
fs.rmSync(outRoot, { recursive: true, force: true });

// (No static dir — see config note below.)

// function
const funcDir = path.join(outRoot, 'functions', 'api', 'index.func');
fs.mkdirSync(funcDir, { recursive: true });
// .cjs forces CommonJS regardless of any "type": "module" in scope.
fs.copyFileSync(path.join(pkgRoot, 'dist', 'api', 'index.cjs'), path.join(funcDir, 'index.cjs'));
fs.writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
// Function externals (@libsql/client + its whole dep cluster) resolve at
// RUNTIME from node_modules installed by the Vercel build (Linux variants).
// includeFiles references the repo's pnpm store with an ABSOLUTE path
// (computed at build time) — nft ships the traced subset with the function.
fs.writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.cjs',
  maxDuration: 30,
  memory: 1024,
  includeFiles: path.join(monoRoot, 'node_modules', '.pnpm') + '/**'
}, null, 2));

// config: default routing (function auto-served at /api/index). Path
// rewrites (/api/*, /, /display...) come from vercel.json which Vercel
// merges into the build output config.
fs.writeFileSync(path.join(outRoot, 'config.json'), JSON.stringify({
  version: 3
}, null, 2));

console.log('[cloud-build] build output assembled at', outRoot);
