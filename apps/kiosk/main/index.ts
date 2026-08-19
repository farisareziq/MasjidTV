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
import { initCrashReporter } from './crash-report.js';

const args = process.argv.slice(2);
const hasFlag = (n: string) => args.includes(n);
const flagValue = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

const PORT = Number(flagValue('--port') || process.env.PORT || 3000);

let mainWindow: BrowserWindow | null = null;
let powerBlockerId: number | -1 = -1;
// Pelapor crash (C4) — diinisialisasi sebaik app ready (perlu dataDir).
let crashReporter: ReturnType<typeof initCrashReporter> | null = null;

function dataDir(): string {
  return process.env.MASJIDTV_DATA_DIR
    || path.join(app.getPath('appData'), 'MasjidTV');
}

// Destinasi muat naik crash dari cloud.json pairing (pola sama seperti
// devices.ts) — null bila belum dipaut.
function crashCloudTarget(): { cloudUrl: string; deviceToken: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir(), 'cloud.json'), 'utf8'));
    if (raw?.cloudUrl && raw?.deviceToken) {
      return { cloudUrl: String(raw.cloudUrl), deviceToken: String(raw.deviceToken) };
    }
  } catch { /* belum dipaut */ }
  return null;
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
    crashReporter?.record('renderer-gone', `reason=${details.reason} exitCode=${details.exitCode}`);
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
  box.innerHTML = '<div style="max-width:560px;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:28px 32px;max-height:88vh;overflow-y:auto">'
    + '<h2 style="margin:0 0 4px;font-size:20px">Menu Kiosk MasjidTV</h2>'
    + '<p style="color:#9fc3b2;font-size:12px;margin:0 0 18px">Ctrl+Shift+M untuk tutup</p>'
    + '<div id="__kmBody" style="font-size:14px;line-height:1.85">Memuat…</div>'
    + '<div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">'
    + '<button id="__kmUnpair" style="padding:10px 18px;border:0;border-radius:8px;background:#8a3b2f;color:#fff;cursor:pointer;font-size:13px">Nyahpaut & Pair Semula</button>'
    + '<button id="__kmClose" style="padding:10px 18px;border:1px solid rgba(255,255,255,.25);border-radius:8px;background:transparent;color:#eef7f2;cursor:pointer;font-size:13px">Tutup</button>'
    + '</div></div>';
  document.body.appendChild(box);
  box.addEventListener('click', function (e) { if (e.target === box) box.remove(); });
  document.getElementById('__kmClose').onclick = function () { box.remove(); };
  // CONFIRM: nyahpaut memutuskan sambungan TV ke cloud — pastikan dahulu.
  document.getElementById('__kmUnpair').onclick = async function () {
    var ok = window.confirm(
      'Nyahpaut TV ini daripada cloud?\\n\\n'
      + 'Skrin akan berhenti menerima tetapan daripada cloud dan menunjukkan kod pairing baharu. '
      + 'Anda perlu memasukkan kod baharu itu di Web Admin untuk memaut semula.\\n\\nTeruskan?'
    );
    if (!ok) return;
    await fetch('/api/pair/unpair', { method: 'POST' });
    location.replace('/display');
  };
  var body = document.getElementById('__kmBody');
  // Escape sebelum innerHTML — nilai dari endpoint LAN (updater/stream/peranti)
  // boleh dipengaruhi pihak ketiga (DNS-spoof / fail tempatan) → elak XSS.
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function row(label, valueHtml) { return '<div style="margin:4px 0"><b>' + label + ':</b> ' + valueHtml + '</div>'; }
  try {
    var cfg = await (await fetch('/api/pair/config')).json();
    var hw = await (await fetch('/api/devices-hw')).json();

    // Capaian internet/cloud — soalan pertama yang sokongan akan tanya.
    var netLine = '<span style="color:#ffd28f">menyemak…</span>';
    var cloudTarget = cfg.paired && cfg.cloudUrl ? cfg.cloudUrl : null;

    var cams = (hw.cameras || []).map(function (c) { return esc(c.name) + (c.status === 'OK' ? '' : ' ⚠'); });
    var dshow = (hw.dshow || []).map(function (c) { return 'video=' + esc(c.name); });
    var camHtml = cams.length
      ? '<span style="color:#8fd6a8">✔</span> ' + cams.join(' • ')
      : '<span style="color:#ff9d9d">✖ Tiada kamera dikesan</span> — pastikan kamera USB dipasang rapi';
    var dshowHtml = dshow.length
      ? dshow.join(' • ')
      : '<span style="color:#86a99a">Tiada</span> — jika guna OBS, tekan <b>Start Virtual Camera</b>';

    var streamRow = '';
    try {
      var st = await (await fetch('/api/streams-status')).json();
      var ss = st.streams || [];
      streamRow = ss.length ? ss.map(function (s) {
        var okRun = String(s.status).toLowerCase() === 'running';
        var chip = okRun ? '<span style="color:#8fd6a8">berjalan</span>' : '<span style="color:#ff9d9d">' + esc(s.status) + '</span>';
        return row('Stream “' + esc(s.name) + '”', chip + (s.lastError ? ' <span style="color:#ff9d9d;font-size:12px">(' + esc(s.lastError) + ')</span>' : ''));
      }).join('') : '';
    } catch (e) { /* tidak kritikal */ }

    // Status self-updater (B1) — endpoint lokal; gagal = updater tidak aktif.
    var updRow = '';
    try {
      var upd = await (await fetch('/api/update-status')).json();
      var ustate = { idle: 'Terkini ✔', checking: 'Menyemak…', downloading: 'Memuat turun…', ready: 'Sedia dipasang', installing: 'Memasang…', error: 'Ralat (cuba semula automatik)', available: 'Tersedia', disabled: 'Tidak aktif' }[upd.state] || upd.state;
      var uline = '<b>Kemas kini:</b> v' + esc(upd.currentVersion) + ' — ' + esc(ustate);
      if (upd.availableVersion) uline += ' → <b style="color:#8fd6a8">v' + esc(upd.availableVersion) + '</b>';
      if (upd.state === 'available' && upd.portable) uline += '<br><span style="color:#ffd28f;font-size:12px">Mod portable — muat turun manual portable exe baharu dari GitHub Releases.</span>';
      if (upd.state === 'error' && upd.lastError) uline += ' <span style="color:#ff9d9d;font-size:12px">(' + esc(upd.lastError) + ')</span>';
      if (upd.lastCheckAt) uline += '<br><span style="color:#86a99a;font-size:12px">Semakan terakhir: ' + new Date(upd.lastCheckAt).toLocaleString() + '</span>';
      updRow = '<div style="margin-top:10px">' + uline + '</div>';
    } catch (e) { /* updater tidak aktif */ }

    // Ringkasan sokongan satu baris — senang dibaca melalui telefon/WhatsApp.
    var supportLine = (cfg.paired ? 'DIPAUT' : 'BELUM DIPAUT')
      + ' • ' + esc(cfg.tenantName || '-')
      + ' • ID: ' + esc(cfg.deviceId || '-')
      + ' • ' + esc(cfg.cloudUrl || '-');

    body.innerHTML =
      row('Status', cfg.paired ? '<span style="color:#8fd6a8">✔ Dipaut — semua OK</span>' : '<span style="color:#ffd28f">Belum dipaut</span> — masukkan kod di Web Admin')
      + (cfg.paired ? row('Masjid', esc(cfg.tenantName || '-')) : '')
      + row('Internet / Cloud', netLine)
      + row('Kamera', camHtml)
      + row('Kamera maya (OBS)', dshowHtml)
      + streamRow
      + updRow
      + '<div style="color:#86a99a;font-size:12px;margin-top:12px;border-top:1px solid rgba(255,255,255,.12);padding-top:10px">'
      + '<b>Ringkasan sokongan</b> (baca ini bila hubungi sokongan):<br>' + supportLine
      + '<br>Semakan perkakasan: ' + (hw.checkedAt ? new Date(hw.checkedAt).toLocaleString() : '-')
      + '</div>';

    // Isi baris capaian secara async (selepas render utama supaya menu pantas).
    (async function () {
      var el = body.querySelectorAll('b');
      var target = null;
      for (var i = 0; i < el.length; i++) if (el[i].textContent === 'Internet / Cloud') target = el[i].parentNode;
      var result;
      if (!cloudTarget) {
        result = '<span style="color:#86a99a">—</span> (TV belum dipaut)';
      } else {
        try {
          var r = await fetch(cloudTarget + '/api/health', { signal: AbortSignal.timeout(6000) });
          result = r.ok
            ? '<span style="color:#8fd6a8">✔ Boleh capai cloud</span> (' + esc(cloudTarget) + ')'
            : '<span style="color:#ff9d9d">✖ Cloud balas HTTP ' + r.status + '</span> — semak internet';
        } catch (e) {
          result = '<span style="color:#ff9d9d">✖ Tidak dapat capai cloud</span> — semak kabel/Wi-Fi internet mini PC ini';
        }
      }
      if (target) target.innerHTML = '<b>Internet / Cloud:</b> ' + result;
    })();
  } catch (e) {
    body.innerHTML = 'Gagal memuat status: ' + esc(e.message);
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

  // Pelaporan crash (C4): log berputar <dataDir>/logs/crash-*.log sentiasa
  // aktif; muat naik ke cloud pilihan (MASJIDTV_CRASH_UPLOAD=1).
  crashReporter = initCrashReporter(dataDir(), crashCloudTarget);

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
  crashReporter?.record('uncaught', `${err.name}: ${err.message}`);
  app.relaunch();
  app.exit(1);
});

console.log('[kiosk] rintisan — menunggu app ready...');
app.whenReady().then(() => {
  console.log('[kiosk] app ready.');
  return bootstrap();
}).catch((err) => {
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
