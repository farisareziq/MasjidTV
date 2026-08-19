// Mod pairing mini PC: pasangkan pelayan lokal dengan cloud melalui kod
// 6-digit (aliran sama seperti app Android TV). Config tersimpan dalam
// <dataDir>/cloud.json; sekali berjaya, mod cloud-sync aktif serta-merta
// (baca semula config setiap permintaan — tiada restart diperlukan).
//
// Aliran:
//   1. GET  /pair                → halaman pairing (masukkan URL cloud)
//   2. POST /api/pair/start      → POST cloud /api/pair/start → kod di skrin
//   3. GET  /api/pair/status     → poll cloud /api/pair/status
//   4. Admin tuntut kod di web admin cloud (TV & Displays)
//   5. Status=paired → simpan cloud.json → cloud-sync aktif hot

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { notifySseConfigChanged } from './cloudsync.js';

export interface CloudConfig {
  cloudUrl: string;
  deviceId: string;
  deviceToken: string;
  tenantName?: string;
  pairedAt?: string;
}

export function cloudConfigPath(dataDir: string): string {
  return path.join(dataDir, 'cloud.json');
}

export function readCloudConfig(dataDir: string): CloudConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cloudConfigPath(dataDir), 'utf8'));
    if (raw && typeof raw.cloudUrl === 'string' && typeof raw.deviceToken === 'string' && raw.deviceToken) {
      return {
        cloudUrl: String(raw.cloudUrl).replace(/\/$/, ''),
        deviceId: String(raw.deviceId || ''),
        deviceToken: String(raw.deviceToken),
        tenantName: raw.tenantName ? String(raw.tenantName) : undefined,
        pairedAt: raw.pairedAt ? String(raw.pairedAt) : undefined
      };
    }
  } catch {
    /* tiada config / rosak — mod lokal */
  }
  return null;
}

export function writeCloudConfig(dataDir: string, cfg: CloudConfig): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(cloudConfigPath(dataDir), JSON.stringify(cfg, null, 2), 'utf8');
}

export function clearCloudConfig(dataDir: string): void {
  try {
    fs.unlinkSync(cloudConfigPath(dataDir));
  } catch {
    /* tidak wujud */
  }
}

function stableDeviceId(dataDir: string): string {
  // deviceId stabil & berterusan (disimpan selepas penjanaan pertama) supaya
  // unpair+pair semula menggunakan baris peranti yang sama di cloud.
  const marker = path.join(dataDir, '.device-id');
  try {
    const existing = fs.readFileSync(marker, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* belum wujud */
  }
  const id = `minipc-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(marker, id, 'utf8');
  } catch {
    /* gagal simpan — guna id sesi ini */
  }
  return id;
}

async function cloudJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json?: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status, json: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

function jsonError(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ error: message });
}

const PAIR_PAGE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(1200px 700px at 50% 20%, #123b2e 0%, #0b1f18 55%, #060f0c 100%);
    color: #eef7f2; min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .card {
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.12);
    border-radius: 18px; padding: 40px 48px; text-align: center;
    max-width: 720px; width: 100%; box-shadow: 0 24px 80px rgba(0,0,0,.45);
  }
  h1 { font-size: 26px; margin-bottom: 6px; letter-spacing: .5px; }
  .sub { color: #9fc3b2; font-size: 15px; margin-bottom: 20px; }
  .logo { width: 74px; height: 74px; margin: 0 auto 14px; border-radius: 16px; background: rgba(126,240,176,.12);
    display: flex; align-items: center; justify-content: center; }
  .logo svg { width: 44px; height: 44px; }
  .code {
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 80px; font-weight: 700; letter-spacing: 16px;
    color: #7ef0b0; text-shadow: 0 0 34px rgba(126,240,176,.4);
    margin: 14px 0 6px; padding-left: 16px; /* imbangi letter-spacing */
  }
  .expiry { color: #86a99a; font-size: 13px; margin-bottom: 14px; min-height: 18px; }
  .status { font-size: 16.5px; color: #cfe7db; min-height: 26px; margin-bottom: 8px; }
  .status .en { display: block; color: #86a99a; font-size: 13px; margin-top: 2px; }
  .err-tip { color: #f0c27e; font-size: 13.5px; line-height: 1.55; min-height: 20px; margin-bottom: 14px; }
  .steps {
    text-align: left; margin: 0 auto 18px; max-width: 520px;
    background: rgba(126,240,176,.06); border: 1px solid rgba(126,240,176,.15);
    border-radius: 12px; padding: 16px 20px;
  }
  .steps ol { padding-left: 20px; }
  .steps li { font-size: 14.5px; line-height: 1.7; color: #cfe7db; margin-bottom: 4px; }
  .steps li .en { display: block; color: #86a99a; font-size: 12.5px; }
  .steps a, .admin-url { color: #7ef0b0; font-weight: 600; text-decoration: none; word-break: break-all; }
  .steps b { color: #7ef0b0; }
  .hint { color: #86a99a; font-size: 13px; line-height: 1.6; }
  .ok-badge { color: #7ef0b0; font-size: 20px; font-weight: 700; margin: 10px 0 22px; }
`;

// Halaman /pair — tiada skrip inline (CSP ketat, gaya sama seperti admin).
// Skrip berada di /pair.js (dihantar dari memori, bukan fail statik).
const PAIR_PAGE_HTML = `<!doctype html>
<html lang="ms">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MasjidTV — Pautkan TV</title>
<style>${PAIR_PAGE_CSS}</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="#7ef0b0" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 21h16"/><path d="M6 21V9l-3 2"/><path d="M18 21V9l3 2"/>
      <path d="M12 3a4 4 0 0 1 4 4c0 1.1-.45 2.1-1.17 2.83L12 13 9.17 9.83A4 4 0 0 1 12 3z"/>
      <circle cx="12" cy="7" r="1"/>
    </svg>
  </div>
  <h1 id="title">Pautkan TV</h1>
  <p class="sub">Pair this TV — MasjidTV</p>
  <div id="view-waiting">
    <div class="code" id="code">······</div>
    <div class="expiry" id="expiry"></div>
    <div class="status" id="status">Menyambung ke cloud…<span class="en">Connecting to cloud…</span></div>
    <div class="err-tip" id="errTip"></div>
    <div class="steps">
      <ol>
        <li>Buka <a id="adminUrl" href="#" target="_blank" rel="noopener">—</a> pada telefon/komputer anda
          <span class="en">Open the admin page above on your phone/computer</span></li>
        <li>Log masuk, kemudian pergi ke <b>TV &amp; Paparan</b>
          <span class="en">Log in, then go to <b>TV &amp; Screens</b></span></li>
        <li>Masukkan kod 6-digit ini
          <span class="en">Enter this 6-digit code</span></li>
      </ol>
    </div>
    <p class="hint">Belum ada akaun? Hubungi pentadbir sistem masjid anda.<br>
    <span class="en">No account yet? Contact your mosque's system administrator.</span></p>
  </div>
  <div id="view-done" style="display:none">
    <div class="ok-badge">✓ Berjaya dipautkan / Paired successfully</div>
    <div class="status" id="doneTenant"></div>
    <p class="hint">Paparan akan bermula segera…<br><span class="en">The display will start shortly…</span></p>
  </div>
</div>
<script src="/pair.js"></script>
</body>
</html>`;

// Skrip halaman pairing — AUTO-START kelakuan Android TV: tiada butang,
// kod muncul serta-merta (guna URL cloud tersimpan atau lalai), auto-retry
// bila gagal, auto-restart bila kod tamat tempoh. Poll setiap 3sa.
const PAIR_PAGE_JS = `(function () {
  'use strict';
  var DEFAULT_URL = 'https://masjidtv.vercel.app';
  var vWait = document.getElementById('view-waiting');
  var vDone = document.getElementById('view-done');
  var elCode = document.getElementById('code');
  var elStatus = document.getElementById('status');
  var elExpiry = document.getElementById('expiry');
  var elErrTip = document.getElementById('errTip');
  var elAdmin = document.getElementById('adminUrl');
  var elTenant = document.getElementById('doneTenant');
  var timer = null;
  var expiryTimer = null;
  var expiresAt = 0;
  var lastCloudUrl = DEFAULT_URL;

  function show(view) {
    vWait.style.display = view === 'wait' ? '' : 'none';
    vDone.style.display = view === 'done' ? '' : 'none';
  }

  function setStatus(ms, en) {
    elStatus.innerHTML = '';
    elStatus.appendChild(document.createTextNode(ms));
    if (en) {
      var span = document.createElement('span');
      span.className = 'en';
      span.textContent = en;
      elStatus.appendChild(span);
    }
  }

  function setErrTip(text) { elErrTip.textContent = text || ''; }

  function adminUrlFor(cloudUrl) {
    return cloudUrl.replace(/\\/+$/, '') + '/admin';
  }

  function renderExpiry() {
    if (!expiresAt) { elExpiry.textContent = ''; return; }
    var left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    var mm = Math.floor(left / 60), ss = left % 60;
    elExpiry.textContent = 'Kod sah untuk ' + mm + ':' + (ss < 10 ? '0' : '') + ss + ' lagi — Code valid for '
      + mm + ':' + (ss < 10 ? '0' : '') + ss + ' more';
  }

  function start(url) {
    lastCloudUrl = url || DEFAULT_URL;
    elCode.textContent = '······';
    expiresAt = 0;
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    setStatus('Menyambung ke cloud…', 'Connecting to cloud…');
    setErrTip('');
    show('wait');
    fetch('/api/pair/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cloudUrl: lastCloudUrl })
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        if (res.s !== 200) {
          setStatus('Gagal menghubungi cloud', 'Cannot reach the cloud');
          setErrTip('Semak sambungan internet mini PC ini (kabel/Wi-Fi). Cuba semula secara automatik… '
            + '(Check this mini PC\\'s internet connection — retrying automatically…)');
          setTimeout(function () { start(url); }, 10000);
          return;
        }
        elCode.textContent = res.d.code;
        expiresAt = Number(res.d.expiresAt) || 0;
        var aUrl = adminUrlFor(lastCloudUrl);
        if (elAdmin) { elAdmin.textContent = aUrl; elAdmin.href = aUrl; }
        setStatus('Menunggu pengesahan admin…', 'Waiting for admin confirmation…');
        setErrTip('');
        renderExpiry();
        if (expiryTimer) clearInterval(expiryTimer);
        expiryTimer = setInterval(renderExpiry, 1000);
        if (timer) clearInterval(timer);
        timer = setInterval(check, 3000);
      })
      .catch(function () {
        setStatus('Tidak dapat menghubungi pelayan', 'Cannot reach the server');
        setErrTip('Semak sambungan internet mini PC ini (kabel/Wi-Fi). Cuba semula secara automatik… '
          + '(Check this mini PC\\'s internet connection — retrying automatically…)');
        setTimeout(function () { start(url); }, 10000);
      });
  }

  function check() {
    fetch('/api/pair/status').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      if (d.status === 'paired') {
        clearInterval(timer);
        if (expiryTimer) clearInterval(expiryTimer);
        elTenant.textContent = d.tenantName ? ('Masjid: ' + d.tenantName) : '';
        show('done');
        setTimeout(function () { location.replace('/display'); }, 3000);
      } else if (d.status === 'expired' || d.status === 'none') {
        // Kod tamat / sesi hilang — maklumkan pengguna, kemudian mula semula.
        clearInterval(timer);
        if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
        setStatus('Kod tamat tempoh — kod baharu dijana…', 'Code expired — generating a new code…');
        setErrTip('');
        setTimeout(function () { start(null); }, 1500);
      }
    }).catch(function () {});
  }

  // AUTO-START: guna URL cloud tersimpan (sesi sedia ada disambung semula
  // selepas refresh) atau lalai.
  fetch('/api/pair/config').then(function (r) { return r.json(); }).then(function (cfg) {
    start(cfg && cfg.cloudUrl ? cfg.cloudUrl : null);
  }).catch(function () { start(null); });
})();
`;

function jsonScript(reply: FastifyReply, js: string): void {
  reply.header('Cache-Control', 'no-cache, no-store')
    .type('application/javascript')
    .send(js);
}

// Halaman pairing (dipakai oleh /pair dan /display mod-TV dalam app.ts).
export { PAIR_PAGE_HTML as PAIR_PAGE_HTML_SRC };

// QR: kod 6-digit cukup pendek untuk ditaip di web admin; QR dilangkau
// (tiada dependency, tiada kebocoran URL ke perkhidmatan QR pihak ketiga).
export function applyPairing(app: FastifyInstance, dataDir: string): void {
  // Skrip pairing (halaman dihantar oleh app.ts /display + /pair).
  app.get('/pair.js', (_req, reply) => jsonScript(reply, PAIR_PAGE_JS));

  // Status semasa (untuk halaman & debug + ringkasan sokongan menu kiosk).
  app.get('/api/pair/config', async (_req, reply) => {
    const cfg = readCloudConfig(dataDir);
    reply.send({
      paired: Boolean(cfg),
      cloudUrl: cfg?.cloudUrl || '',
      tenantName: cfg?.tenantName || '',
      deviceId: cfg?.deviceId || ''
    });
  });

  // Status perkakasan mini PC (kamera USB dsb.) — ditulis oleh app kiosk
  // melalui devices.json (lihat apps/kiosk/main/devices.ts). Endpoint lokal
  // untuk menu tersembunyi; cloud membaca salinan ini melalui jambatan SSE.
  // cameras = PnP (kelas Camera/Image); dshow = peranti video DirectShow
  // ffmpeg (OBS Virtual Camera ialah peranti virtual — TIDAK muncul dalam
  // PnP Camera, hanya dalam senarai dshow).
  app.get('/api/devices-hw', async (_req, reply) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'devices.json'), 'utf8'));
      reply.send({
        cameras: Array.isArray(raw.cameras) ? raw.cameras : [],
        dshow: Array.isArray(raw.dshow) ? raw.dshow : [],
        checkedAt: Number(raw.checkedAt) || 0
      });
    } catch {
      reply.send({ cameras: [], dshow: [], checkedAt: 0 });
    }
  });

  // Status self-updater kiosk (B1) — ditulis oleh app kiosk melalui
  // update-status.json (lihat apps/kiosk/main/updater.ts). Endpoint lokal
  // tanpa auth untuk menu tersembunyi, sama pola seperti /api/devices-hw;
  // hanya status (tiada rahsia). Server legacy (tiada updater) → state
  // 'disabled'.
  app.get('/api/update-status', async (_req, reply) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'update-status.json'), 'utf8'));
      reply.send({
        state: typeof raw.state === 'string' ? raw.state : 'disabled',
        currentVersion: typeof raw.currentVersion === 'string' ? raw.currentVersion : '',
        availableVersion: typeof raw.availableVersion === 'string' ? raw.availableVersion : null,
        lastCheckAt: Number(raw.lastCheckAt) || null,
        // Had 80 aksara — updater kini menulis enum pendek (network/checksum/
        // http-N/spawn); had ini perlindungan tambahan untuk fail tulisan luar.
        lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 80) : null,
        portable: Boolean(raw.portable)
      });
    } catch {
      reply.send({ state: 'disabled', currentVersion: '', availableVersion: null, lastCheckAt: null, lastError: null, portable: false });
    }
  });

  // Mulakan sesi pairing di cloud — IDEMPOTEN: jika sesi aktif untuk cloud
  // yang sama masih belum tamat tempoh, pulangkan semula kod sedia ada.
  // Ini mengelakkan setiap page-load/watchdog-restart menjana kod baharu
  // (kod "asyik bertukar" + admin menuntut kod lapuk).
  app.post('/api/pair/start', async (req, reply) => {
    const body = (req.body || {}) as { cloudUrl?: string };
    const cloudUrl = String(body.cloudUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(cloudUrl)) return jsonError(reply, 400, 'URL cloud tidak sah');
    const deviceId = stableDeviceId(dataDir);

    // Sambung sesi sedia ada jika masih sah (>30sa lagi) dan belum paired.
    const sessionFile = path.join(dataDir, '.pair-session.json');
    try {
      const existing = JSON.parse(fs.readFileSync(sessionFile, 'utf8')) as {
        cloudUrl: string; code: string; deviceId: string; expiresAt: number;
      };
      if (existing.cloudUrl === cloudUrl && existing.deviceId === deviceId
        && Date.now() < existing.expiresAt - 30_000) {
        reply.send({ code: existing.code, expiresAt: existing.expiresAt });
        return;
      }
    } catch {
      /* tiada sesi — cipta baharu */
    }

    const res = await cloudJson(`${cloudUrl}/api/pair/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    if (!res.ok || !(res.json as { code?: string })?.code) {
      const msg = res.status === 429 ? 'Cloud sibuk — cuba lagi kemudian' : `Gagal menghubungi cloud (HTTP ${res.status})`;
      return jsonError(reply, 502, msg);
    }
    const { code, expiresAt } = res.json as { code: string; expiresAt: number };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ cloudUrl, code, deviceId, expiresAt }), 'utf8');
    reply.send({ code, expiresAt });
  });

  // Poll status sesi pairing.
  app.get('/api/pair/status', async (_req, reply) => {
    let sess: { cloudUrl: string; code: string; deviceId: string; expiresAt: number };
    try {
      sess = JSON.parse(fs.readFileSync(path.join(dataDir, '.pair-session.json'), 'utf8'));
    } catch {
      return reply.send({ status: 'none' });
    }
    if (Date.now() > sess.expiresAt) return reply.send({ status: 'expired' });
    const res = await cloudJson(`${sess.cloudUrl}/api/pair/status?code=${encodeURIComponent(sess.code)}&device=${encodeURIComponent(sess.deviceId)}`);
    if (!res.ok) return reply.send({ status: res.status === 429 ? 'pending' : 'error' });
    const data = res.json as { status?: string; token?: string; tenantName?: string };
    if (data.status === 'paired' && data.token) {
      writeCloudConfig(dataDir, {
        cloudUrl: sess.cloudUrl,
        deviceId: sess.deviceId,
        deviceToken: data.token,
        tenantName: data.tenantName,
        pairedAt: new Date().toISOString()
      });
      // Jambatan SSE sambung serta-merta (tiada menunggu retry 5sa).
      notifySseConfigChanged();
      try {
        fs.unlinkSync(path.join(dataDir, '.pair-session.json'));
      } catch {
        /* sudah tiada */
      }
      reply.send({ status: 'paired', tenantName: data.tenantName || '' });
      return;
    }
    reply.send({ status: data.status || 'pending' });
  });

  // Nyah-paut (kembali ke mod lokal penuh).
  app.post('/api/pair/unpair', async (_req, reply) => {
    clearCloudConfig(dataDir);
    notifySseConfigChanged();
    reply.send({ ok: true });
  });
}
