// E2E: cloud lokal (file: DB) + exe mini-PC (port 3211) + admin menuntut kod.
// Meliputi: pair/start lokal → claim oleh admin cloud → status paired →
// hot-activation → /display redirect → /api/settings dari cloud (token peranti).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLOUD_PORT = 3299;
const TV_PORT = 3211;
const CLOUD = `http://localhost:${CLOUD_PORT}`;
const TV = `http://localhost:${TV_PORT}`;

const cloudDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cloud-'));
const tvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tv-'));
const log = (m) => console.log('[e2e]', m);

// 1) Boot cloud lokal dari sumber (tsx) — listen di port CLOUD_PORT.
const cloudEnv = {
  ...process.env,
  TURSO_URL: `file:${path.join(cloudDir, 'cloud.db')}`,
  JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef0123456789abcdef',
  MASJIDTV_PUBLIC_URL: CLOUD,
  PORT: String(CLOUD_PORT)
};
const cloudProc = spawn(process.execPath, [
  '--import', 'tsx', '-e', `
    import { createCloudApp } from './src/app.js';
    const app = await createCloudApp();
    await app.listen({ port: ${CLOUD_PORT}, host: '127.0.0.1' });
    console.log('cloud listening on ${CLOUD_PORT}');
  `
], {
  cwd: path.join(process.cwd(), 'packages', 'cloud'),
  env: cloudEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});
let bootPin = '';
let tvProc = null;
cloudProc.stdout.on('data', (d) => {
  const s = String(d);
  process.stdout.write('[cloud] ' + d);
  const m = s.match(/PIN bootstrap:\s*(\S+)/);
  if (m) bootPin = m[1];
});
cloudProc.stderr.on('data', (d) => process.stderr.write('[cloud-err] ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealth(url, label) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) { log(label + ' siap'); return true; }
    } catch { /* belum */ }
    await sleep(500);
  }
  throw new Error(label + ' tidak sedia');
}

try {
  await waitHealth(CLOUD, 'cloud');

  // 2) PIN superuser ditangkap dari stdout bootstrap cloud.
  for (let i = 0; i < 20 && !bootPin; i++) await sleep(500);
  const pin = bootPin;
  if (!pin) throw new Error('PIN bootstrap cloud tidak diperoleh');
  log('superuser PIN: ' + pin);

  // 3) Login superuser → cipta tenant → dapatkan apiKey.
  let r = await fetch(CLOUD + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin })
  });
  if (!r.ok) throw new Error('superuser login: ' + r.status + ' ' + await r.text());
  const su = await r.json();
  log('superuser token diterima (mustChangePin=' + su.mustChangePin + ')');

  // Tukar PIN dahulu (dikehendaki sebelum operasi superuser lain).
  r = await fetch(CLOUD + '/api/auth/superuser/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token },
    body: JSON.stringify({ pin: 'e2e-pin-12345' })
  });
  if (!r.ok) throw new Error('tukar PIN: ' + r.status + ' ' + await r.text());
  // Login semula dengan PIN baharu.
  r = await fetch(CLOUD + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin: 'e2e-pin-12345' })
  });
  if (!r.ok) throw new Error('relogin superuser: ' + r.status);
  const su2 = await r.json();
  su.token = su2.token;

  r = await fetch(CLOUD + '/api/super/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token },
    body: JSON.stringify({ name: 'Masjid E2E', username: 'e2eadmin', password: 'e2epass123' })
  });
  if (!r.ok) throw new Error('create tenant: ' + r.status + ' ' + await r.text());
  const tenant = await r.json();
  log('tenant: ' + tenant.id + ' apiKey: ' + (tenant.apiKey || '').slice(0, 8) + '...');

  // Login admin tenant.
  r = await fetch(CLOUD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'e2eadmin', password: 'e2epass123' })
  });
  if (!r.ok) throw new Error('tenant login: ' + r.status);
  const admin = await r.json();

  // 4) Boot TV — kiosk packaged (win-unpacked baharu) ATAU electron dev.
  //    E2E_KIOSK_EXE=… untuk exe spesifik; lalai: stamp terkini dist-kiosk.
  let kioskExe = process.env.E2E_KIOSK_EXE;
  if (!kioskExe) {
    const base = path.join(process.cwd(), 'apps', 'kiosk', 'dist-kiosk');
    const stamps = fs.existsSync(base)
      ? fs.readdirSync(base).filter((d) => /^\d{12}$/.test(d)).sort()
      : [];
    if (stamps.length) {
      const p2 = path.join(base, stamps[stamps.length - 1], 'win-unpacked', 'MasjidTV Kiosk.exe');
      if (fs.existsSync(p2)) kioskExe = p2;
    }
  }
  // Spawn dengan fallback: Windows Smart App Control menyekat exe tidak
  // ditandatangani (spawn UNKNOWN) — jatuh kepada electron dev binary.
  const spawnKiosk = () => {
    if (kioskExe) {
      try {
        return spawn(kioskExe, ['--no-kiosk', '--port', String(TV_PORT)], {
          env: { ...process.env, MASJIDTV_DATA_DIR: tvDir },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch {
        console.error('[e2e] packaged exe disekat (Smart App Control) — guna electron dev');
      }
    }
    return spawn(path.join(process.cwd(), 'apps', 'kiosk', 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--no-kiosk', '--port', String(TV_PORT)], {
      cwd: path.join(process.cwd(), 'apps', 'kiosk'),
      env: {
        ...process.env,
        MASJIDTV_DATA_DIR: tvDir,
        MASJIDTV_PUBLIC_DIR: path.join(process.cwd(), 'packages', 'frontend', 'public')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  };
  tvProc = spawnKiosk();
  tvProc.stdout.on('data', (d) => process.stdout.write('[tv] ' + d));
  tvProc.stderr.on('data', (d) => process.stderr.write('[tv-err] ' + d));
  await waitHealth(TV, 'TV kiosk (' + (kioskExe ? 'packaged' : 'dev') + ')');

  // 5) Mula pairing dari TV.
  r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  if (!r.ok) throw new Error('pair/start: ' + r.status + ' ' + await r.text());
  const sess = await r.json();
  log('kod pairing: ' + sess.code);

  // 6) Status — pending.
  r = await fetch(TV + '/api/pair/status');
  log('status sebelum claim: ' + JSON.stringify(await r.json()));

  // 7) ADMIN menuntut kod di cloud.
  r = await fetch(CLOUD + '/api/admin/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({ code: sess.code, name: 'Mini PC Uji' })
  });
  if (!r.ok) throw new Error('admin pair: ' + r.status + ' ' + await r.text());
  log('admin menuntut kod: OK');

  // 8) TV poll — patut paired + token.
  r = await fetch(TV + '/api/pair/status');
  const done = await r.json();
  log('status selepas claim: ' + JSON.stringify({ ...done, token: done.token ? '(tersembunyi)' : undefined }));
  if (done.status !== 'paired') throw new Error('TV tidak paired: ' + JSON.stringify(done));

  // 9) HOT-ACTIVATION: /api/settings TV kini dari cloud.
  const dk = JSON.parse(fs.readFileSync(path.join(tvDir, 'masjidtv.db'), 'utf8').slice(0, 0) || '{}'); // tidak—guna API
  // Dapatkan display key lokal untuk akses API TV.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(tvDir, 'masjidtv.db'));
  const srow = db.prepare('SELECT data FROM settings WHERE id=1').get();
  const displayKey = JSON.parse(srow.data).security.displayKey;
  db.close();

  r = await fetch(TV + '/api/settings?key=' + displayKey);
  log('TV /api/settings: ' + r.status);
  if (!r.ok) throw new Error('settings gagal: ' + await r.text());
  const settings = await r.json();
  log('settings dari cloud? mosque.name=' + (settings.mosque?.name ?? '(tiada)'));
  log('uploads di-rewrite? contoh: ' + (JSON.stringify(settings).includes(CLOUD) ? 'ya (URL cloud)' : 'tiada medan uploads'));

  // 10) /display kekal dilayan LOKAL (offline-first) — data datang dari
  // proksi cloud. Hanya /admin dialihkan ke cloud.
  r = await fetch(TV + '/display', { redirect: 'manual' });
  log('TV /display: ' + r.status + (r.status === 302 ? ' -> ' + r.headers.get('location') : ' (paparan lokal)'));
  if (r.status !== 200) throw new Error('/display sepatutnya dilayan lokal selepas pairing');

  r = await fetch(TV + '/admin', { redirect: 'manual' });
  const aloc = r.headers.get('location') || '';
  log('TV /admin: ' + r.status + ' -> ' + aloc);
  if (r.status !== 302 || !aloc.startsWith(CLOUD)) throw new Error('/admin tidak redirect ke cloud');

  // 11) Cloud display page + API dengan token peranti sebenar.
  const devToken = JSON.parse(fs.readFileSync(path.join(tvDir, 'cloud.json'), 'utf8')).deviceToken;
  r = await fetch(CLOUD + '/display?token=' + devToken);
  log('cloud /display?token: ' + r.status + ' (' + (await r.text()).length + ' bytes)');
  r = await fetch(CLOUD + '/api/settings', { headers: { 'x-device-token': devToken } });
  log('cloud /api/settings dgn device token: ' + r.status);
  if (!r.ok) throw new Error('cloud settings dgn device token gagal: ' + r.status);

  // 11b) SYNC SEGERA SSE: sambung SSE lokal TV sebagai paparan, admin ubah
  // settings → jangka event 'sync' tiba <2sa.
  {
    const ctl = new AbortController();
    const sse = await fetch(TV + '/api/events', { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
    const reader = sse.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events = [];
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            let ev = 'message', da = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) ev = line.slice(6).trim();
              else if (line.startsWith('data:')) da += line.slice(5).trim();
            }
            events.push({ ev, da, at: Date.now() });
          }
        }
      } catch { /* abort dijangka */ }
    })();

    // Tunggu hello dulu (sambungan lokal siap).
    await sleep(700);
    const t0 = Date.now();
    // Admin mengubah nama masjid.
    r = await fetch(CLOUD + '/api/admin/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
      body: JSON.stringify({ mosque: { name: 'Masjid SSE Test' } })
    });
    if (!r.ok) throw new Error('admin PUT settings: ' + r.status);
    // Tunggu event sync (maks 5sa — sasaran <2sa).
    let got = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !got) {
      got = events.find((e) => e.ev === 'sync' && e.at >= t0) || null;
      if (!got) await sleep(100);
    }
    ctl.abort();
    if (!got) throw new Error('SSE sync TIDAK diterima dalam 5sa');
    const latency = got.at - t0;
    log('SSE sync diterima dalam ' + latency + 'ms' + (latency < 2000 ? ' ✓ (<2sa)' : ' ⚠ >2sa'));
    if (latency >= 2000) throw new Error('latensi sync ' + latency + 'ms melebihi sasaran 2sa');

    // Sahkan data baharu sampai ke proksi TV.
    r = await fetch(TV + '/api/settings');
    const s = await r.json();
    log('TV settings selepas ubah: mosque.name=' + (s.mosque?.name ?? '?'));
    if (s.mosque?.name !== 'Masjid SSE Test') throw new Error('data baharu tidak sampai ke TV');
  }

  // 12) AUTO-RESET: admin membuang peranti di cloud → TV 401 → reset.
  r = await fetch(CLOUD + '/api/admin/devices', { headers: { authorization: 'Bearer ' + admin.token } });
  const devices = (await r.json()).devices || [];
  const dev = devices.find((d) => d.device_id === sess.code && false) || devices[0];
  if (dev) {
    r = await fetch(CLOUD + '/api/admin/devices/' + dev.id, { method: 'DELETE', headers: { authorization: 'Bearer ' + admin.token } });
    log('admin membuang peranti: ' + r.status);
    // TV kini patut 401 → auto-reset → /display kembali pairing.
    r = await fetch(TV + '/api/settings');
    log('TV /api/settings selepas unpair: ' + r.status + ' (503 = DEVICE_UNPAIRED)');
    r = await fetch(TV + '/api/pair/config');
    log('TV config: ' + JSON.stringify(await r.json()));
    r = await fetch(TV + '/display');
    const body = await r.text();
    log('TV /display: ' + r.status + ' pairing-page=' + body.includes('Pautkan TV'));
  }

  log('=== E2E LULUS SEPENUHNYA ===');
  process.exitCode = 0;
} catch (e) {
  console.error('[e2e] GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  try { process.kill(-cloudProc.pid); } catch { cloudProc.kill(); }
  try { tvProc.kill(); } catch {}
  process.exit(process.exitCode || 0);
}
