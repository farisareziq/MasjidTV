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
import fs from 'node:fs';
import { startServer } from './server-stub.js';
import { resolveFfmpeg } from './ffmpeg.js';
import { installAutostart, removeAutostart } from './autostart.js';
import { startCameraWatch } from './devices.js';
import { startKioskUpdater } from './updater.js';

const args = process.argv.slice(2);
const hasFlag = (n: string) => args.includes(n);
const flagValue = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const PORT = Number(flagValue('--port') || process.env.PORT || 3000);

let mainWindow: BrowserWindow | null = null;
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

  // AUTOHIDE cursor: sembunyi 3sa selepas gerakan terakhir — kiosk TV tidak
  // patut menunjukkan kursor tetikus rehat. CSS injection pada setiap
  // navigasi (halaman pairing/paparan).
  win.webContents.on('did-navigate', () => injectCursorHider(win));
  win.webContents.once('did-finish-load', () => injectCursorHider(win));

  // MENU TERSEMBUNYI (Ctrl+Shift+M): panel status kiosk — pairing, kamera,
  // ffmpeg, autostart, unpair. Dilaksanakan sebagai overlay dalam renderer
  // (berfungsi pada halaman pairing & paparan).
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'm') {
      win.webContents.executeJavaScript(HIDDEN_MENU_JS).catch(() => {});
    }
  });

  return win;
}

// Overlay menu tersembunyi — dibina dari API lokal; tiada dialog Electron
// (renderer sandbox kekal). Klik luar/tutup membuang overlay.
const HIDDEN_MENU_JS = `(async function () {
  var old = document.getElementById('__kioskMenu');
  if (old) { old.remove(); return; }
  var box = document.createElement('div');
  box.id = '__kioskMenu';
  box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,20,12,.92);color:#eef7f2;font-family:Segoe UI,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;';
  box.innerHTML = '<div style="max-width:520px;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:28px 32px">'
    + '<h2 style="margin:0 0 4px;font-size:20px">Menu Kiosk MasjidTV</h2>'
    + '<p style="color:#9fc3b2;font-size:12px;margin:0 0 18px">Ctrl+Shift+M untuk tutup</p>'
    + '<div id="__kmBody" style="font-size:14px;line-height:1.9">Memuat…</div>'
    + '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">'
    + '<button id="__kmUnpair" style="padding:10px 18px;border:0;border-radius:8px;background:#8a3b2f;color:#fff;cursor:pointer;font-size:13px">Nyahpaut & Pair Semula</button>'
    + '<button id="__kmClose" style="padding:10px 18px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:transparent;color:#eef7f2;cursor:pointer;font-size:13px">Tutup</button>'
    + '</div></div>';
  document.body.appendChild(box);
  box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
  document.getElementById('__kmClose').onclick = function () { box.remove(); };
  document.getElementById('__kmUnpair').onclick = async function () {
    await fetch('/api/pair/unpair', { method: 'POST' });
    location.replace('/display');
  };
  var body = document.getElementById('__kmBody');
  try {
    var cfg = await (await fetch('/api/pair/config')).json();
    var hw = await (await fetch('/api/devices-hw')).json();
    var cams = (hw.cameras || []).map(function (c) { return c.name + (c.status === 'OK' ? '' : ' (' + c.status + ')'); });
    var dshow = (hw.dshow || []).map(function (c) { return 'video=' + c.name; });
    var streamRow = '';
    try {
      var st = await (await fetch('/api/streams-status')).json();
      streamRow = (st.streams || []).map(function (s) {
        return '<div><b>Stream:</b> ' + s.name + ' — ' + s.status + (s.lastError ? ' <span style="color:#ff9d9d">(' + s.lastError + ')</span>' : '') + '</div>';
      }).join('');
    } catch (e) { /* tidak kritikal */ }
    // Status self-updater (B1) — endpoint lokal; gagal = updater tidak aktif.
    var updRow = '';
    try {
      var upd = await (await fetch('/api/update-status')).json();
      var ustate = { idle: 'Terkini', checking: 'Menyemak…', downloading: 'Memuat turun…', ready: 'Sedia dipasang', installing: 'Memasang…', error: 'Ralat (cuba semula automatik)', available: 'Tersedia', disabled: 'Tidak aktif' }[upd.state] || upd.state;
      var uline = '<b>Kemas kini:</b> v' + upd.currentVersion + ' — ' + ustate;
      if (upd.availableVersion) uline += ' → <b style="color:#8fd6a8">v' + upd.availableVersion + '</b>';
      if (upd.state === 'available' && upd.portable) uline += '<br><span style="color:#ffd28f;font-size:12px">Mod portable — muat turun manual portable exe baharu dari GitHub Releases.</span>';
      if (upd.state === 'error' && upd.lastError) uline += ' <span style="color:#ff9d9d;font-size:12px">(' + upd.lastError + ')</span>';
      if (upd.lastCheckAt) uline += '<br><span style="color:#86a99a;font-size:12px">Semakan terakhir: ' + new Date(upd.lastCheckAt).toLocaleString() + '</span>';
      updRow = '<div style="margin-top:10px">' + uline + '</div>';
    } catch (e) { /* updater tidak aktif */ }
    body.innerHTML =
      '<div><b>Status:</b> ' + (cfg.paired ? 'Dipaut' : 'Belum dipaut') + '</div>'
      + (cfg.paired ? '<div><b>Masjid:</b> ' + (cfg.tenantName || '-') + '<br><b>Cloud:</b> ' + cfg.cloudUrl + '</div>' : '')
      + '<div style="margin-top:10px"><b>Kamera (PnP):</b> ' + (cams.length ? cams.join(' • ') : 'tiada dikesan') + '</div>'
      + '<div><b>Peranti DSHOW (ffmpeg):</b> ' + (dshow.length ? dshow.join(' • ') : 'tiada — OBS: tekan Start Virtual Camera') + '</div>'
      + streamRow
      + updRow
      + '<div style="color:#86a99a;font-size:12px;margin-top:8px">Semakan: ' + (hw.checkedAt ? new Date(hw.checkedAt).toLocaleString() : '-') + '</div>';
  } catch (e) {
    body.innerHTML = 'Gagal memuat status: ' + e.message;
  }
})()`;

function injectCursorHider(win: BrowserWindow): void {
  const css = `
    html, body { cursor: default; }
    html.cursor-idle, html.cursor-idle * { cursor: none !important; }
  `;
  win.webContents.insertCSS(css).catch(() => {});
  win.webContents.executeJavaScript(`
    (function () {
      if (window.__cursorHider) return;
      window.__cursorHider = true;
      var t = null;
      document.addEventListener('mousemove', function () {
        document.documentElement.classList.remove('cursor-idle');
        if (t) clearTimeout(t);
        t = setTimeout(function () {
          document.documentElement.classList.add('cursor-idle');
        }, 3000);
      }, { passive: true });
      document.documentElement.classList.add('cursor-idle');
    })();
  `).catch(() => {});
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

  // AUTOSTART FIRST-RUN: pemasangan (NSIS) & portable — semasa pelancaran
  // GUI pertama, daftar autostart secara automatik supaya reboot tidak
  // memerlukan langkah manual. Marker fail elak ulang; --no-autostart
  // melangkau (pemasangan debug/kedai demo). --remove-autostart membuang
  // marker bersama pendaftaran.
  if (!hasFlag('--no-autostart') && !hasFlag('--autostart')) {
    const marker = path.join(dataDir(), '.autostart-done');
    if (!fs.existsSync(marker)) {
      try {
        installAutostart();
        fs.mkdirSync(dataDir(), { recursive: true });
        fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
        console.log('[kiosk] autostart didaftarkan secara automatik (first-run).');
      } catch (err) {
        console.error('[kiosk] autostart automatik gagal:', err instanceof Error ? err.message : err);
      }
    }
  }

  // ffmpeg: selesaikan sebelum pelayan (settings.media.ffmpegPath).
  const ffmpeg = await resolveFfmpeg(dataDir());
  if (ffmpeg) console.log(`[ffmpeg] ${ffmpeg}`);
  else console.log('[ffmpeg] tiada — RTSP/RTMP/ONVIF tidak tersedia sehingga dibekalkan');

  // Pelayan (kod sedia ada) — node:sqlite, pairing Android TV, cloud-sync SSE.
  await startServer({ dataDir: dataDir(), port: PORT, ffmpegPath: ffmpeg });
  console.log(`[server] http://localhost:${PORT}/display`);

  // Self-updater (PLAN B1): poll GitHub Releases 6 jam — NSIS senyap untuk
  // pemasangan terpasang; notis sahaja untuk portable. Status ditulis ke
  // <dataDir>/update-status.json → /api/update-status → menu tersembunyi.
  startKioskUpdater(dataDir());

  // Deteksi peranti (kamera USB + peranti DSHOW ffmpeg) — tulis devices.json,
  // dibaca endpoint /api/devices-hw; laporan berkala ke cloud bila dipaut
  // (web admin nampak status kamera + senarai nama DSHOW setiap mini PC).
  startCameraWatch(dataDir(), () => {
    const cloudJsonPath = path.join(dataDir(), 'cloud.json');
    try {
      const raw = JSON.parse(fs.readFileSync(cloudJsonPath, 'utf8'));
      if (raw?.cloudUrl && raw?.deviceToken) {
        return { cloudUrl: String(raw.cloudUrl), deviceToken: String(raw.deviceToken) };
      }
    } catch { /* belum dipaut */ }
    return null;
  }, () => (ffmpeg && ffmpeg !== 'ffmpeg' ? ffmpeg : null));

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
  // Rujukan crash-recovery: pastikan tetingkap utama tertutup bersih supaya
  // `window-all-closed` (relaunch kiosk) tidak terpicu oleh quirk lifecycle.
  try {
    mainWindow?.destroy();
  } catch { /* sudah musnah */ }
  mainWindow = null;
});
