// Bina installer kiosk: electron-builder (NSIS portable + installer).
//   node tools/package.mjs          → dist-kiosk/ (installer + portable)
// Termasuk: frontend public (extraResources), bin/ffmpeg.exe, kod dist.
//
// PENTING: main process dibundel esbuild dahulu (bundle-main) supaya
// node_modules native yang tidak diperlukan (libsql, better-sqlite3) tidak
// disentuh semasa load — sama pendekatan seperti build SEA.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kioskDir = path.resolve(__dirname, '..');
const repo = path.resolve(kioskDir, '..', '..');

// Repo GitHub untuk self-updater (B1) — updater.json dihantar ke resources/
// dan dibundel electron-builder melalui extraResources (sebelah exe).
const UPDATE_REPO = 'farisareziq/MasjidTV';
const UPDATE_BINARY_NAME = 'MasjidTV-Kiosk-Setup';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

// 1) Build kebergantungan: server + frontend (dist).
console.log('[pkg] build workspace...');
run('pnpm --filter @masjidtv/server run build', repo);
run('pnpm --filter @masjidtv/frontend run build', repo);

// 2) Aset frontend → resources/frontend/public (extraResources).
const resDir = path.join(kioskDir, 'resources', 'frontend', 'public');
fs.rmSync(path.join(kioskDir, 'resources'), { recursive: true, force: true });
fs.mkdirSync(resDir, { recursive: true });
fs.cpSync(path.join(repo, 'packages', 'frontend', 'public'), resDir, { recursive: true });

// 3) ffmpeg bundled (jika bin/ffmpeg.exe sedia — jalankan download-ffmpeg).
const binDir = path.join(kioskDir, 'bin', 'ffmpeg.exe');
if (fs.existsSync(binDir)) {
  fs.mkdirSync(path.join(kioskDir, 'resources', 'bin'), { recursive: true });
  fs.copyFileSync(binDir, path.join(kioskDir, 'resources', 'bin', 'ffmpeg.exe'));
  console.log('[pkg] ffmpeg dibundel.');
} else {
  console.log('[pkg] AMARAN: bin/ffmpeg.exe tiada — jalankan tools/download-ffmpeg.mjs untuk bundel.');
}

// 3b) updater.json (B1) — {repo, binaryName} dibaca kiosk di sebelah exe.
//     extraResources meletakkannya dalam resources/ → kandidat loadConfig().
const updaterJson = { repo: UPDATE_REPO, binaryName: UPDATE_BINARY_NAME };
fs.writeFileSync(path.join(kioskDir, 'resources', 'updater.json'), JSON.stringify(updaterJson, null, 2), 'utf8');
console.log(`[pkg] updater.json ditulis (repo=${UPDATE_REPO}).`);

// 4) BUNDLE main process (esbuild CJS) — elak masalah resolve module native
//    dalam asar. Native/libsql distub keluar (server lokal guna node:sqlite
//    bila better-sqlite3 tak muat — kelakuan sedia ada @masjidtv/db).
console.log('[pkg] bundling main (esbuild)...');
const esbuildCandidates = [
  path.join(repo, 'packages', 'cloud', 'node_modules', 'esbuild'),
  path.join(repo, 'packages', 'frontend', 'node_modules', 'esbuild'),
  'esbuild'
];
let esbuild;
for (const p of esbuildCandidates) {
  try { esbuild = require(p); break; } catch { /* next */ }
}
if (!esbuild) throw new Error('esbuild tidak dijumpai');
const seaStub = {
  name: 'stub-native',
  setup(build) {
    const stub = (what) => ({
      contents: `module.exports = new Proxy({}, { get: () => { throw new Error("${what} disabled in kiosk bundle"); } });\nmodule.exports.default = module.exports;`,
      loader: 'js'
    });
    build.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: 'stub:bsql', namespace: 'stub' }));
    build.onResolve({ filter: /^@libsql\/client$/ }, () => ({ path: 'stub:libsql', namespace: 'stub' }));
    build.onLoad({ filter: /^stub:/, namespace: 'stub' }, (a) => stub(a.path.replace(/^stub:/, '')));
    // .cjs helper (asset-zip, public-assets) wujud dalam src server tapi
    // tidak dalam dist — resolve terus kepada sumber.
    build.onResolve({ filter: /\.cjs(\.js)?$/ }, (args) => {
      if (args.namespace !== '' && args.namespace !== 'file') return undefined;
      // dari packages/server/dist/*.js → ../src/<name>.cjs
      const srcPath = path.join(args.resolveDir, '..', 'src', path.basename(args.path).replace(/\.js$/, ''));
      return { path: srcPath };
    });
  }
};
await esbuild.build({
  entryPoints: [path.join(kioskDir, 'main', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: path.join(kioskDir, 'dist', 'index.js'),
  logLevel: 'info',
  plugins: [seaStub],
  // electron itu sendiri dikecualikan (disediakan runtime).
  external: ['electron']
});

// 5) electron-builder — config dalam electron-builder.json (BERASINGAN;
//    package.json TIDAK disentuh — pengajaran daripada build sebelum ini
//    yang merosakkan package.json semasa proses).
console.log('[pkg] electron-builder...');
// Folder output: stamp masa — elak EBUSY dari fail build lama yang dikunci
// (zombie proses / AV scan). Cleanup automatik: simpan stamp semasa + stamp
// terkini sahaja (rollback pantas), padam selebihnya best-effort.
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const outDir = path.join(kioskDir, 'dist-kiosk', stamp);
fs.mkdirSync(path.dirname(outDir), { recursive: true });
const stamps = fs.readdirSync(path.dirname(outDir))
  .filter((d) => /^\d{12}$/.test(d) && d !== stamp)
  .sort()
  .reverse();
for (const d of stamps.slice(1)) { // stamps[0] = terkini — disimpan
  try {
    fs.rmSync(path.join(path.dirname(outDir), d), { recursive: true, force: true });
    console.log(`[pkg] cleanup stamp lama: ${d}`);
  } catch { /* dikunci — biarkan, dibuang kemudian */ }
}
// electron-builder baca config daripada electron-builder.json; output di-
// arahkan melalui flag CLI --config.directories.output.
run(`npx electron-builder --win nsis portable --config.directories.output="${outDir}"`, kioskDir);
console.log('[pkg] siap → ' + outDir);
