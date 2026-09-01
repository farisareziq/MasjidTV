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

// 1b. Rebuild frontend TS -> public*/js (elak drift: embed sentiasa padan
// dengan src/*.ts, bukan output lama yang ter-commit).
execFileSync(process.execPath, [path.join(monoRoot, 'packages', 'frontend', 'build.mjs')], { stdio: 'inherit' });

// 1c. Embed frontend assets (packages/frontend/public-cloud) into the bundle.
execFileSync(process.execPath, [path.join(__dirname, 'gen-pages.mjs')], { stdio: 'inherit' });

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

// Static assets: everything in frontend/public-cloud EXCEPT the HTML pages and
// sw.js (which stay in the function — /display needs server-side meta injection
// + CSP, and sw.js needs Cache-Control: no-cache, no-store). Serving CSS/JS/
// images/vendor/manifest from .vercel/output/static keeps them on Vercel's CDN
// and OUT of the serverless function — zero function invocations for assets.
const staticRoot = path.join(outRoot, 'static');
fs.mkdirSync(staticRoot, { recursive: true });
const KEEP_IN_FUNC = new Set(['admin.html', 'display.html', 'guide.html', 'sw.js']);
function copyStatic(srcDir, rel = '') {
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) copyStatic(src, relPath);
    else if (KEEP_IN_FUNC.has(e.name)) continue; // served by the function
    else {
      const dest = path.join(staticRoot, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}
copyStatic(path.join(pkgRoot, '..', 'frontend', 'public-cloud'));
console.log('[cloud-build] static assets emitted to .vercel/output/static/');

// function
const funcDir = path.join(outRoot, 'functions', 'api', 'index.func');
fs.mkdirSync(funcDir, { recursive: true });
// .cjs forces CommonJS regardless of any "type": "module" in scope.
fs.copyFileSync(path.join(pkgRoot, 'dist', 'api', 'index.cjs'), path.join(funcDir, 'index.cjs'));
fs.writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
// Copy the full dependency cluster for external packages into the function's
// node_modules. Walks each package's real store path and its deps recursively
// (production deps only), dereferencing pnpm symlinks — guaranteeing the
// runtime require succeeds regardless of nft/pnpm quirks.
function copyDeps(names) {
  const copied = new Set();
  const nmRoot = path.join(monoRoot, 'node_modules');

  function resolvePkg(name, fromDirs) {
    for (const dir of fromDirs) {
      const cand = path.join(dir, name);
      if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    }
    return null;
  }

  function pkgDeps(pkgDir) {
    const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    // Include optionalDependencies — that's where the platform-native
    // binaries live (only the build platform's variant is installed).
    return Object.keys({ ...pj.dependencies, ...pj.optionalDependencies });
  }

  function walk(name, searchDirs) {
    if (copied.has(name)) return;
    const real = resolvePkg(name, searchDirs);
    if (!real) {
      console.warn(`[cloud-build] WARN: cannot resolve ${name}`);
      return;
    }
    const realPath = fs.realpathSync(real);
    copied.add(name);
    fs.cpSync(realPath, path.join(funcDir, 'node_modules', name), { recursive: true, dereference: true });
    const deps = pkgDeps(realPath);
    // pnpm store layout: a package's deps are SIBLINGS inside its store
    // entry's node_modules: .pnpm/<pkg>@<ver>/node_modules/<dep>.
    const storeNm = path.dirname(path.dirname(realPath));
    const nextDirs = [
      path.join(realPath, 'node_modules'),   // nested (rare)
      path.join(storeNm, 'node_modules'),    // pnpm siblings
      storeNm,                                // already is <entry>/node_modules
      nmRoot
    ];
    for (const dep of deps) walk(dep, nextDirs);
  }

  for (const n of names) walk(n, [path.join(pkgRoot, 'node_modules'), path.join(monoRoot, 'packages', 'db', 'node_modules'), nmRoot]);
  return copied;
}

const copiedDeps = copyDeps(['@libsql/client']);
console.log('[cloud-build] copied runtime deps:', [...copiedDeps].join(', '));

fs.writeFileSync(path.join(funcDir, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs20.x',
  handler: 'index.cjs',
  maxDuration: 30,
  // 128MB halves GB-seconds vs 256 — sufficient for this lightweight handler
  // (no in-memory media buffering, assets on CDN, body limit 1MB, bcrypt
  // lazy-loaded). Vercel serverless handles one request per instance, so
  // peak memory is a single request, not concurrency.
  memory: 128
}, null, 2));

// config: default routing (function auto-served at /api/index). Path
// rewrites (/api/*, /, /display...) come from vercel.json which Vercel
// merges into the build output config.
//
// /api/events: jawab 204 TERUS di edge — JANGAN invoke fungsi. Klien lama
// (kiosk/TV yang masih pegang JS lama) memanggil /api/events setiap ~1.3sa dan
// mengabaikan 204 (EventSource WebView lama tak patuh spec stop-on-204). Melayan
// di edge menjadikan banjir ini PERCUMA (sifar invokasi fungsi). Laluan ini
// diletak dahulu supaya ia menang sebelum rewrite /api/(.*) → fungsi.
//
// /api/health: jawab 200 TERUS di edge — uptime monitor (UptimeRobot dsb.)
// memanggil ini setiap 1-5 minit; melayan di edge menjadikan setiap ping
// PERCUMA (sifar invokasi fungsi).
fs.writeFileSync(path.join(outRoot, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/api/events/?$', status: 204, headers: { 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } },
    { src: '^/api/health/?$', status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  ]
}, null, 2));

console.log('[cloud-build] build output assembled at', outRoot);
