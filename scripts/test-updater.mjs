// Ujian updater kiosk (B1) — pelayan GitHub Releases PALSU tempatan + mock
// Electron 'app'. Mengesahkan aliran check → download → checksum → (dry-run)
// install TANPA menyentuh GitHub sebenar atau memasang apa-apa.
//
// Senario disahkan:
//   1. Checksum TEPAT   → state 'ready', installer ditulis ke %TEMP%
//   2. Checksum SALAH   → state 'error' lastError 'checksum' (fail-closed)
//   3. Asset .sha256 TIADA → fail-closed (lastError 'checksum')
//   4. Asset setup TIADA   → state 'idle', lastError 'asset … tiada'
//   5. Mod PORTABLE        → state 'available' sahaja (tiada auto-install)
//
// Jalan: node scripts/test-updater.mjs   (keluar 0 = semua lulus)

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_VERSION = '9.9.9';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// ---------------------------------------------------------------------------
// Installer palsu + checksum
// ---------------------------------------------------------------------------
const fakeInstaller = Buffer.from(`MASJIDTV-FAKE-INSTALLER-${NEW_VERSION}-` + crypto.randomBytes(128).toString('hex'));
const fakeSha = crypto.createHash('sha256').update(fakeInstaller).digest('hex');
const tamperedInstaller = Buffer.from('TAMPERED-' + crypto.randomBytes(128).toString('hex'));

// ---------------------------------------------------------------------------
// Pelayan releases palsu (API GitHub + muat turun asset)
// ---------------------------------------------------------------------------
function makeReleaseServer({ tamper = false, omitChecksum = false, omitSetup = false } = {}) {
  const payload = tamper ? tamperedInstaller : fakeInstaller;
  const assets = [];
  if (!omitSetup) assets.push({ name: `MasjidTV-Kiosk-Setup-${NEW_VERSION}.exe`, browser_download_url: `http://127.0.0.1:__P__/dl/setup.exe`, size: payload.length });
  if (!omitChecksum) assets.push({ name: `MasjidTV-Kiosk-Setup-${NEW_VERSION}.exe.sha256`, browser_download_url: `http://127.0.0.1:__P__/dl/setup.sha256` });
  const release = { tag_name: `v${NEW_VERSION}`, assets };
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/releases/latest')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(release).replace(/__P__/g, String(server.address().port)));
    } else if (req.url === '/dl/setup.exe') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(payload);
    } else if (req.url === '/dl/setup.sha256') {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`${fakeSha}  MasjidTV-Kiosk-Setup-${NEW_VERSION}.exe`);
    } else { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------------------
// Persekitaran ujian: mock 'electron' (CJS) + runner yang panggil checkOnce().
// updater.js ialah CommonJS → mock melalui require cache (Module._cache),
// bukan ESM loader.
// ---------------------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-upd-'));
const updaterPath = path.join(ROOT, 'apps', 'kiosk', 'dist', 'updater.js');
fs.writeFileSync(path.join(work, 'run.cjs'), `
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
// Mock 'electron' SEBELUM updater dimuat — require cache disuntik supaya
// require('electron') memulangkan app palsu (getVersion 1.1.0).
const fakeApp = {
  getVersion: () => '1.1.0',
  isPackaged: true,
  getPath: () => __dirname, // exe dir → updater.json tiada → fallback env
  quitCalled: false,
  quit() { this.quitCalled = true; },
  once() {}
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return 'electron';
  return origResolve.call(this, request, ...args);
};
Module._cache['electron'] = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { app: fakeApp }
};
(async () => {
  const { KioskUpdater } = require(${JSON.stringify(updaterPath.replace(/\\/g, '\\\\'))});
  const u = new KioskUpdater(process.env.DATA_DIR);
  await u.checkOnce();
  const s = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'update-status.json'), 'utf8'));
  console.log('RESULT:' + JSON.stringify(s));
})().catch((e) => { console.error('RUNNER-ERR: ' + (e && e.message)); process.exit(2); });
`, 'utf8');

async function runScenario(label, serverOpts, envExtra = {}) {
  console.log(`\n▸ ${label}`);
  const server = await makeReleaseServer(serverOpts);
  const port = server.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-upddata-'));
  const env = {
    ...process.env,
    MASJIDTV_UPDATE_HOST: `http://127.0.0.1:${port}`,
    MASJIDTV_UPDATE_REPO: 'test/MasjidTV',
    MASJIDTV_UPDATE_DRY_RUN: '1',
    DATA_DIR: dataDir,
    ...envExtra
  };
  const child = spawn(process.execPath, [path.join(work, 'run.cjs')], {
    env, stdio: ['ignore', 'pipe', 'inherit']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const status = await new Promise((resolve) => child.on('close', () => {
    const line = out.split(/\r?\n/).find((l) => l.startsWith('RESULT:'));
    try { resolve(line ? JSON.parse(line.slice(7)) : null); } catch { resolve(null); }
  }));
  server.close();
  return status;
}

// Kompil kiosk dahulu supaya dist/main/updater.js wujud (tsc terus —
// mengelak isu shell pnpm dalam proses anak).
console.log('▸ Kompil kiosk…');
await new Promise((resolve, reject) => {
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const c = spawn(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: path.join(ROOT, 'apps/kiosk'), stdio: 'inherit' });
  c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tsc keluar ${code}`))));
});

// 1) Checksum TEPAT → ready + installer disahkan + ditulis.
{
  const s = await runScenario('Checksum tepat → ready + installer disahkan');
  ok(s && s.state === 'ready', `state ready (dapat: ${s && s.state})`);
  ok(s && s.availableVersion === NEW_VERSION, `availableVersion ${NEW_VERSION} (dapat: ${s && s.availableVersion})`);
  ok(s && s.lastError === null, 'tiada ralat');
  const inst = path.join(os.tmpdir(), 'masjidtv-kiosk-update', `MasjidTV-Kiosk-Setup-${NEW_VERSION}.exe`);
  ok(fs.existsSync(inst), 'installer ditulis ke %TEMP%');
  ok(fs.existsSync(inst) && crypto.createHash('sha256').update(fs.readFileSync(inst)).digest('hex') === fakeSha, 'kandungan installer sepadan checksum');
}

// 2) Checksum SALAH → fail-closed.
{
  const s = await runScenario('Installer diubah (checksum mismatch) → fail-closed', { tamper: true });
  ok(s && s.state === 'error', `state error (dapat: ${s && s.state})`);
  ok(s && s.lastError === 'checksum', `lastError checksum (dapat: ${s && s.lastError})`);
}

// 3) Asset .sha256 TIADA → fail-closed.
{
  const s = await runScenario('Asset .sha256 tiada → fail-closed', { omitChecksum: true });
  ok(s && s.state === 'error', `state error (dapat: ${s && s.state})`);
  ok(s && s.lastError === 'checksum', `lastError checksum (dapat: ${s && s.lastError})`);
}

// 4) Asset setup TIADA → idle + lastError 'asset … tiada'.
{
  const s = await runScenario('Asset setup tiada → langkau', { omitSetup: true });
  ok(s && s.state === 'idle', `state idle (dapat: ${s && s.state})`);
  ok(s && /asset .+ tiada/.test(s && s.lastError || ''), `lastError asset tiada (dapat: ${s && s.lastError})`);
}

// 5) Mod PORTABLE → notis sahaja, tiada auto-install.
{
  const s = await runScenario('Mod portable → notis sahaja', {}, { PORTABLE_EXECUTABLE_FILE: 'C:\\x\\MasjidTV.exe' });
  ok(s && s.state === 'available', `state available (dapat: ${s && s.state})`);
  ok(s && s.portable === true, 'flag portable dikesan');
}

console.log(`\n════════ RINGKASAN: ${passed} lulus, ${failed} gagal ════════`);
process.exit(failed ? 1 : 0);
