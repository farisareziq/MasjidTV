// Build masjidtv.exe — binari tunggal Windows (Node SEA).
//
//   node scripts/build-exe.mjs
//
// Hasil: dist/masjidtv-exe/masjidtv.exe
//   - Server Fastify penuh + pairing cloud + supervisor kiosk
//   - Aset frontend dibundled sebagai aset SEA (frontend.zip)
//   - SQLite melalui node:sqlite (tiada addon native — tiada isu ABI)
//   - Autostart: masjidtv.exe --install-autostart / --remove-autostart
//   - Kiosk: Edge fullscreen + watchdog (lalai); --no-kiosk untuk server sahaja
//
// Keperluan: Node >= 22.5 (node:sqlite + SEA), postject (devDependencies akar).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'dist', 'masjidtv-exe');
const bundle = path.join(outDir, 'bundle.cjs');
const frontendZip = path.join(outDir, 'frontend.zip');
const blob = path.join(outDir, 'sea-prep.blob');
const exe = path.join(outDir, 'masjidtv.exe');

// Node runtime mesti menyokong node:sqlite & SEA.
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`Node >= 22.5 diperlukan untuk SEA + node:sqlite (semasa: ${process.versions.node}).`);
  process.exit(1);
}

// 1) Build workspace (server dist + frontend public).
console.log('[build-exe] building workspace...');
execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });

// 2) Zip aset frontend (STORE — tiada kompresi; dibaca oleh asset-zip.cjs).
console.log('[build-exe] packing frontend assets...');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
zipDir(path.join(repoRoot, 'packages', 'frontend', 'public'), frontendZip);

// 3) Bundle CJS tunggal (esbuild dari devDependencies workspace).
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
  console.error('esbuild tidak dijumpai — devDependency @masjidtv/cloud atau @masjidtv/frontend.');
  process.exit(1);
}
// Plugin: modul yang tidak boleh masuk SEA (native/cloud-only) digantikan
// dengan stub yang throw Error biasa — createLocalClient menangkap dan
// jatuh kepada node:sqlite; laluan cloud (@libsql) tidak pernah dipanggil
// dalam pelayan lokal.
const seaStubPlugin = {
  name: 'sea-stub-native-modules',
  setup(build) {
    const stubContents = (what) => ({
      contents: `module.exports = new Proxy({}, { get: () => { throw new Error("${what} disabled in SEA build"); } });\n` +
        'module.exports.default = module.exports;',
      loader: 'js'
    });
    build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: 'stub:bsql', namespace: 'sea-stub' }));
    build.onResolve({ filter: /^@libsql\/client$/ }, () => ({ path: 'stub:libsql', namespace: 'sea-stub' }));
    build.onLoad({ filter: /^stub:/, namespace: 'sea-stub' }, (args) => stubContents(args.path.replace(/^stub:/, '')));
  }
};
console.log('[build-exe] bundling server (esbuild -> CJS)...');
await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages', 'server', 'src', 'main-exe.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${major}`,
  outfile: bundle,
  logLevel: 'info',
  plugins: [seaStubPlugin]
});

// 4) SEA config + blob (aset frontend dibundled).
console.log('[build-exe] preparing SEA blob...');
const seaConfig = path.join(os.tmpdir(), 'masjidtv-sea.json');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
  assets: { 'frontend.zip': frontendZip }
}));
const nodeBin = process.execPath;
execFileSync(nodeBin, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

// 5) Inject ke salinan node.exe.
const postjectCli = path.join(repoRoot, 'node_modules', 'postject', 'dist', 'cli.js');
if (!fs.existsSync(postjectCli)) {
  console.error('postject tidak dijumpai — pnpm add -Dw postject');
  process.exit(1);
}
fs.copyFileSync(nodeBin, exe);
const nodeBytes = fs.readFileSync(nodeBin);
const FUSE_HEX = 'fce680ab2cc467b6e072b8b5df1996b2';
const fuseName = nodeBytes.includes(Buffer.from(`NODE_SEA_FUSE_${FUSE_HEX}`))
  ? `NODE_SEA_FUSE_${FUSE_HEX}`
  : `NODE_JS_FUSE_${FUSE_HEX}`;
execFileSync(nodeBin, [postjectCli, exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', fuseName], { stdio: 'inherit' });

// 6) Kosongkan perantara (kecuali KEEP_BUNDLE=1 untuk debug).
if (!process.env.KEEP_BUNDLE) {
  fs.rmSync(blob, { force: true });
  fs.rmSync(bundle, { force: true });
  fs.rmSync(frontendZip, { force: true });
}
fs.rmSync(seaConfig, { force: true });

console.log(`\nBuilt: ${exe}`);
console.log('Uji : masjidtv.exe --no-kiosk   (server sahaja, http://localhost:3000)');
console.log('       masjidtv.exe             (kiosk penuh: server + Edge fullscreen)');

// --- helper: zip STORE tanpa dependency --------------------------------------
function zipDir(src, dest) {
  const entries = [];
  const walk = (dir, base) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const name = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, name);
      else entries.push({ name, data: fs.readFileSync(full) });
    }
  };
  walk(src, '');
  const local = (name, data) => {
    const n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);        // local file header
    h.writeUInt16LE(20, 4);                 // version needed
    h.writeUInt16LE(0, 6);                  // flags
    h.writeUInt16LE(0, 8);                  // method STORE
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); // time/date
    h.writeUInt32LE(crc32(data), 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26);
    h.writeUInt16LE(0, 28);
    return Buffer.concat([h, n, data]);
  };
  const central = (name, data, off) => {
    const n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0, 8); h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12); h.writeUInt16LE(0, 14);
    h.writeUInt32LE(crc32(data), 16);
    h.writeUInt32LE(data.length, 20); h.writeUInt32LE(data.length, 24);
    h.writeUInt16LE(n.length, 28); h.writeUInt16LE(0, 30); h.writeUInt16LE(0, 32);
    h.writeUInt16LE(0, 34); h.writeUInt16LE(0, 36);
    h.writeUInt32LE(0, 38);
    h.writeUInt32LE(off, 42);
    return Buffer.concat([h, n]);
  };
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    locals.push(local(e.name, e.data));
    centrals.push(central(e.name, e.data, offset));
    offset += locals[locals.length - 1].length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(dest, Buffer.concat([...locals, cd, eocd]));
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
