// Build a portable Windows .exe of the MasjidTV license generator using
// esbuild bundling + Node Single Executable Application (SEA).
// Result: tools/license-gen-cli/masjidtv-license.exe (single file, no
// Node installation required on the target machine).
//
// Usage: node tools/license-gen-cli/build.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const outDir = __dirname;
const bundle = path.join(outDir, 'bundle.cjs');
const exe = path.join(outDir, 'masjidtv-license.exe');

// 1) Bundle to one CJS file (no deps — pure node: modules).
// esbuild is a devDependency of workspace packages — resolve via absolute
// lib paths (works under pnpm's symlink layout on Windows).
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const esbuildCandidates = [
  path.join(repoRoot, 'packages', 'cloud', 'node_modules', 'esbuild'),
  path.join(repoRoot, 'packages', 'frontend', 'node_modules', 'esbuild'),
  'esbuild'
];
let esbuild;
for (const p of esbuildCandidates) {
  try { esbuild = require(p); break; } catch { /* next */ }
}
if (!esbuild) {
  console.error('esbuild not found — expected as devDependency of @masjidtv/cloud or @masjidtv/frontend.');
  process.exit(1);
}
await esbuild.build({
  entryPoints: [path.join(outDir, 'main.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: bundle,
  logLevel: 'info'
});

// 2) Prepare SEA config + blob.
const seaConfig = path.join(os.tmpdir(), 'masjidtv-license-sea.json');
const blob = path.join(outDir, 'sea-prep.blob');
fs.writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));

const nodeBin = process.execPath;
const postjectCli = path.join(repoRoot, 'node_modules', 'postject', 'dist', 'cli.js');
if (!fs.existsSync(postjectCli)) {
  console.error('postject not found — install it: pnpm add -Dw postject');
  process.exit(1);
}

// 3) Create a copy of node.exe to inject into.
fs.copyFileSync(nodeBin, exe);

// 4) node --experimental-sea-config
execFileSync(nodeBin, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 5) postject inject (NODE_SEA_BLOB resource, guarded by the SEA fuse).
// Node >= 24 renamed the sentinel from NODE_JS_FUSE_ to NODE_SEA_FUSE_ —
// detect which one the runtime binary actually contains.
const nodeBytes = fs.readFileSync(nodeBin);
const FUSE_HEX = 'fce680ab2cc467b6e072b8b5df1996b2';
const fuseName = nodeBytes.includes(Buffer.from(`NODE_SEA_FUSE_${FUSE_HEX}`))
  ? `NODE_SEA_FUSE_${FUSE_HEX}`
  : `NODE_JS_FUSE_${FUSE_HEX}`;
execFileSync(nodeBin, [
  postjectCli, exe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', fuseName
], { stdio: 'inherit' });

// (Windows) step from Node docs: remove the signature is handled by postject
// automatically for unsigned node.exe copies; signing is recommended but
// optional for private vendor tooling.

console.log(`\nBuilt: ${exe}`);
console.log('Test:   masjidtv-license.exe help');

// cleanup intermediates
fs.rmSync(blob, { force: true });
fs.rmSync(bundle, { force: true });
fs.rmSync(seaConfig, { force: true });
