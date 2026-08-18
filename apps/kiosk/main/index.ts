// Entry utama Electron — modaliti kiosk mini PC.
//
//   masjidtv-kiosk.exe                 → kiosk penuh (server + tetingkap fullscreen)
//   --install-autostart / --remove-autostart → urus autostart log masuk
//   --no-kiosk                         → server sahaja (debug)
//
// Satu proses memiliki SEMUA: pelayan Fastify (kod @masjidtv/server sedia
// ada), tetingkap kiosk, ffmpeg relay, dan lifecycle recovery. Tiada lagi
// watchdog luar yang boleh lumba dengan proses browser.

import { app, BrowserWindow, powerSaveBlocker, session } from 'electron';
import path from 'node:path';
import { startServer } from './server-stub.js';
import { resolveFfmpeg } from './ffmpeg.js';
import { installAutostart, removeAutostart } from './autostart.js';

const args = process.argv.slice(2);
const hasFlag = (n: string) => args.includes(n);
const flagValue = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const PORT = Number(flagValue('--port') || process.env.PORT || 3000);

let mainWindow: BrowserWindow | null;
let powerBlockerId: number | -1 = -1;

function dataDir(): string {
  return process.env.MASJIDTV_DATA_DIR
    || path.join(app.getPath('appData'), 'MasjidTV');
}

function createKioskWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    kiosk: true,
    fullscreen: true,
    closable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: '#060f0c',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // Paparan muat dari pelayan lokal — pelayan tentukan pairing ↔ paparan.
  const url = `http://localhost:${PORT}/display`;
  win.loadURL(url).catch((err) => {
    console.error('[kiosk] gagal memuat paparan:', err.message);
    setTimeout(() => win.loadURL(url).catch(() => {}), 3000);
  });

  // Pemulihan deterministik: renderer crash → reload (bukan relaunch app).
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[kiosk] renderer hilang:', details.reason, '— reload.');
    win.loadURL(url).catch(() => {});
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url2, isMain) => {
    if (!isMain) return;
    // Server mungkin belum sedia / restart sekejap — cuba semula.
    setTimeout(() => win.loadURL(`http://localhost:${PORT}/display`).catch(() => {}), 2000);
  });

  // Sekat navigasi keluar dari pelayan lokal (keselamatan kiosk).
  win.webContents.on('will-navigate', (e, u) => {
    if (!String(u).startsWith(`http://localhost:${PORT}`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  return win;
}

async function bootstrap(): Promise<void> {
  if (hasFlag('--install-autostart')) {
    installAutostart();
    app.exit(0);
    return;
  }
  if (hasFlag('--remove-autostart')) {
    removeAutostart();
    app.exit(0);
    return;
  }

  // ffmpeg: selesaikan sebelum pelayan (settings.media.ffmpegPath).
  const ffmpeg = await resolveFfmpeg(dataDir());
  if (ffmpeg) console.log(`[ffmpeg] ${ffmpeg}`);
  else console.log('[ffmpeg] tiada — RTSP/RTMP/ONVIF tidak tersedia sehingga dibekalkan');

  // Pelayan (kod sedia ada) — node:sqlite, pairing Android TV, cloud-sync SSE.
  await startServer({ dataDir: dataDir(), port: PORT, ffmpegPath: ffmpeg });
  console.log(`[server] http://localhost:${PORT}/display`);

  if (hasFlag('--no-kiosk')) {
    console.log('[kiosk] mod --no-kiosk — tetingkap dilangkau.');
    return;
  }

  // Autoplay audio azan tanpa gerak pengguna.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['audio', 'media', 'fullscreen'].includes(permission));
  });

  mainWindow = createKioskWindow();

  // Pastikan skrin tidak sleep semasa azan/paparan.
  powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');
}

// Kematian proses tunggal: sebarang ralat tak tertangkap → relaunch bersih
// (data SQLite selamat — WAL). Elak kiosk mati senyap di masjid.
process.on('uncaughtException', (err) => {
  console.error('[kiosk] uncaught:', err);
  app.relaunch();
  app.exit(1);
});

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[kiosk] gagal bermula:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  // Kiosk tidak boleh ditutup secara normal — jika berlaku (Alt+F4 dihook),
  // relaunch supaya paparan kembali.
  if (process.platform === 'win32' && !hasFlag('--no-kiosk')) {
    app.relaunch();
  }
  app.quit();
});

app.on('before-quit', () => {
  try {
    if (powerBlockerId >= 0) powerSaveBlocker.stop(powerBlockerId);
  } catch { /* sudah berhenti */ }
});
