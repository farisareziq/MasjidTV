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

await build({
  entryPoints: [path.join(pkgRoot, 'src', 'api', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(pkgRoot, 'dist', 'api', 'index.js'),
  alias: {
    '@masjidtv/shared': path.join(monoRoot, 'packages', 'shared', 'src', 'index.ts'),
    '@masjidtv/db': path.join(monoRoot, 'packages', 'db', 'src', 'index.ts'),
    'better-sqlite3': path.join(stubDir, 'better-sqlite3.js')
  },
  // Only the libsql native driver stack stays external — everything else
  // (fastify, jwt, bcrypt, drizzle...) is bundled. The @libsql/* pure-JS
  // packages are bundled too; they dynamically require the platform binary
  // package (e.g. @libsql/linux-x64-gnu) which resolves from node_modules
  // at runtime via includeFiles below.
  external: ['@libsql/linux-x64-gnu', '@libsql/win32-x64-msvc', '@libsql/darwin-x64', '@libsql/darwin-arm64', 'libsql']
});

// 3. Assemble Build Output API layout.
fs.rmSync(outRoot, { recursive: true, force: true });

// static placeholder
fs.mkdirSync(path.join(outRoot, 'static'), { recursive: true });
fs.writeFileSync(path.join(outRoot, 'static', 'index.html'), '<!doctype html><title>MasjidTV</title>');

// function
const funcDir = path.join(outRoot, 'functions', 'api', 'index.func');
fs.mkdirSync(funcDir, { recursive: true });
fs.copyFileSync(path.join(pkgRoot, 'dist', 'api', 'index.js'), path.join(funcDir, 'index.js'));
fs.writeFileSync(path.join(funcDir, 'vc-config.json'), JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.js',
  maxDuration: 30,
  memory: 1024,
  // Ship the libsql platform binaries with the function (the bundle's
  // dynamic require of @libsql/<platform> resolves against these).
  includeFiles: 'node_modules/@libsql/** node_modules/libsql/**'
}, null, 2));

// routes: everything -> function
fs.writeFileSync(path.join(outRoot, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { "src": "/.*", "dest": "/api/index" }
  ]
}, null, 2));

console.log('[cloud-build] build output assembled at', outRoot);
