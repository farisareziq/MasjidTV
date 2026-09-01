// Supervisor binari tunggal (SEA): entry point masjidtv.exe.
//
//   masjidtv.exe                     → kiosk penuh (server + Edge + watchdog)
//   masjidtv.exe --install-autostart → daftar HKCU Run ke diri sendiri
//   masjidtv.exe --remove-autostart  → buang pendaftaran autostart
//   masjidtv.exe --no-kiosk          → server sahaja (tanpa Edge/watchdog)
//   masjidtv.exe --port 3000         → tukar port
//
// Dalam binari SEA, aset frontend (display.html dll.) dibundled sebagai
// blob zip dibaca dari memori; pelayan menerima publicDir maya melalui
// protokol masjidtv-asset: yang diselesaikan oleh asset handler di bawah.

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './app.js';
import { Updater } from './updater.js';

const args = process.argv.slice(2);
const hasFlag = (name: string): boolean => args.includes(name);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const PORT = Number(flagValue('--port') || process.env.PORT || 3000);
const DATA_DIR = process.env.MASJIDTV_DATA_DIR
  || path.join(process.env.APPDATA || path.join(process.env.HOME || '', '.config'), 'MasjidTV');

// --- Aset maya (blob SEA) ---------------------------------------------------
// build-exe.mjs menulis frontend.zip sebagai aset SEA; public-assets.cjs
// membacanya melalui node:sea.getAsset (fallback null dalam dev).

interface VirtualAsset {
  get(file: string): Buffer | null;
  list(): string[];
}

function loadVirtualAssets(): VirtualAsset | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPublicAssets } = require('./public-assets.cjs') as { getPublicAssets: () => VirtualAsset | null };
    return getPublicAssets();
  } catch {
    return null;
  }
}

// --- Autostart HKCU ----------------------------------------------------------

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = 'MasjidTV';

function installAutostart(): void {
  const exe = process.execPath;
  execFileSync('reg', ['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', `"${exe}"`, '/f'], { stdio: 'inherit' });
  console.log(`Autostart dipasang: "${exe}" akan mula semasa log masuk.`);
}

function removeAutostart(): void {
  try {
    execFileSync('reg', ['delete', RUN_KEY, '/v', AUTOSTART_NAME, '/f'], { stdio: 'inherit' });
    console.log('Autostart dibuang.');
  } catch {
    console.log('Autostart tidak wujud — tiada tindakan.');
  }
}

// --- Kiosk Edge ---------------------------------------------------------------

function findEdge(): string | null {
  const candidates = [
    process.env.EDGE_PATH || '',
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function launchEdgeKiosk(displayUrl: string) {
  const edge = findEdge();
  if (!edge) {
    console.log('[kiosk] Edge tidak dijumpai — membuka pelayar lalai.');
    spawn('cmd', ['/c', 'start', '', displayUrl], { detached: true, stdio: 'ignore' }).unref();
    return null;
  }
  // Profil khusus: TANPA ini, msedge --kiosk menyerah kepada tika background
  // sedia ada (startup boost) dan terus keluar — watchdog kemudian menganggap
  // Edge "mati" dan melancarkan semula setiap 10sa → paparan asyik refresh.
  // Profil berasingan menjadikan kiosk tika penuh yang boleh dipantau.
  const userDataDir = path.join(DATA_DIR, 'edge-kiosk-profile');
  return spawn(edge, [
    '--kiosk', displayUrl,
    '--edge-kiosk-type=fullscreen',
    '--user-data-dir=' + userDataDir,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI,msEdgeFirstRunExperience',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble'
  ], { detached: true, stdio: 'ignore' });
}

// --- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
  if (hasFlag('--install-autostart')) {
    installAutostart();
    process.exit(0);
  }
  if (hasFlag('--remove-autostart')) {
    removeAutostart();
    process.exit(0);
  }

  const kiosk = !hasFlag('--no-kiosk');
  const assets = loadVirtualAssets();

  // Public dir: maya (SEA) atau fail sebenar (dev).
  const publicDir = assets
    ? 'masjidtv-assets://virtual'
    : path.resolve(path.dirname(process.argv[1] || '.'), '..', 'frontend', 'public');

  // Halang dua tika serentak (autostart + klik manual) melalui port bind:
  // startServer akan gagal dengan EADDRINUSE jika sudah berjalan — itu OK.
  await startServer({ dataDir: DATA_DIR, publicDir, port: PORT });

  console.log('');
  console.log('  MasjidTV 1.0.0 — kiosk binari tunggal');
  console.log(`  Display : http://localhost:${PORT}/display`);
  console.log(`  Pairing : http://localhost:${PORT}/pair`);
  console.log(`  Admin   : http://localhost:${PORT}/admin`);
  console.log(`  Data    : ${DATA_DIR}`);
  console.log('');

  // Self-updater: aktif bila updater.json wujud di sebelah exe —
  // { "repo": "owner/masjidtv", "binaryName": "masjidtv.exe" }.
  // (Diedarkan vendor; pelanggan tidak perlu menyentuh ini.)
  try {
    const updaterCfgPath = path.join(path.dirname(process.execPath), 'updater.json');
    if (fs.existsSync(updaterCfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(updaterCfgPath, 'utf8')) as { repo?: string; binaryName?: string };
      if (cfg.repo) {
        new Updater({
          repo: cfg.repo,
          currentVersion: '1.1.3',
          installDir: path.dirname(process.execPath),
          binaryName: cfg.binaryName || 'masjidtv.exe'
        }).start();
        console.log(`  Updater : aktif (${cfg.repo})`);
      }
    }
  } catch {
    /* config rosak — biarkan tanpa updater */
  }

  if (kiosk) {
    // URL kiosk: /display biasa — KELAKUAN ANDROID TV. Server tentukan
    // kandungan: belum dipaut → skrin pairing automatik; dipaut → paparan
    // (data proksi cloud, tiada kunci diperlukan).
    const displayUrl = `http://localhost:${PORT}/display`;
    let edge = launchEdgeKiosk(displayUrl);
    // Watchdog: pastikan Edge kekal hidup (server dipantau oleh watchdog
    // dalaman Fastify onClose + pakcage luar tidak diperlukan).
    setInterval(() => {
      if (!edge || edge.exitCode !== null) {
        console.log('[kiosk] Edge tertutup — membuka semula.');
        edge = launchEdgeKiosk(displayUrl);
      }
    }, 10000).unref();
  }
}

main().catch((err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.log('[masjidtv] Server sudah berjalan — buka paparan sahaja.');
    launchEdgeKiosk(`http://localhost:${PORT}/display`);
    process.exit(0);
  }
  console.error('[masjidtv] gagal bermula:', err);
  process.exit(1);
});
