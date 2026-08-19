// E2E: cloud lokal (file: DB) + kiosk mini-PC (port dinamik) + admin menuntut kod.
// Meliputi: pair/start lokal → claim oleh admin cloud → status paired →
// hot-activation → /display redirect → /api/settings dari cloud (token peranti).
//
// Port DINAMIK (elak berlanggar) + cleanup pokok proses robust — lihat e2e-lib.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {
  sleep, log, bootCloud, superuserLogin, createTenant, spawnKiosk,
  waitHealth, procRegistry, readSseEvents
} from './e2e-lib.mjs';

const L = log('e2e');
const reg = procRegistry();
reg.installExitHooks();

try {
  // 1) Boot cloud lokal dari sumber (tsx) — port bebas automatik.
  const cloud = await bootCloud();
  reg.add(cloud.proc);
  cloud.proc.stdout.on('data', (d) => process.stdout.write('[cloud] ' + d));
  cloud.proc.stderr.on('data', (d) => process.stderr.write('[cloud-err] ' + d));
  await waitHealth(cloud.url, 'cloud');
  const CLOUD = cloud.url;

  // 2) PIN superuser ditangkap dari stdout bootstrap cloud.
  for (let i = 0; i < 20 && !cloud.getBootPin(); i++) await sleep(500);
  const pin = cloud.getBootPin();
  if (!pin) throw new Error('PIN bootstrap cloud tidak diperoleh');
  L('superuser PIN: ' + pin);

  // 3) Login superuser → cipta tenant → admin tenant.
  const suToken = await superuserLogin(CLOUD, pin, 'e2e-pin-12345');
  const { admin } = await createTenant(CLOUD, suToken, 'Masjid E2E', 'e2eadmin', 'e2epass123');
  L('tenant + admin sedia');

  // 4) Boot TV — kiosk packaged (win-unpacked baharu) ATAU electron dev.
  const tv = await spawnKiosk();
  reg.add(tv.proc);
  tv.proc.stdout.on('data', (d) => process.stdout.write('[tv] ' + d));
  tv.proc.stderr.on('data', (d) => process.stderr.write('[tv-err] ' + d));
  const TV = tv.url;
  await waitHealth(TV, 'TV kiosk (' + (tv.packaged ? 'packaged' : 'dev') + ')');

  // 5) Mula pairing dari TV.
  let r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  if (!r.ok) throw new Error('pair/start: ' + r.status + ' ' + await r.text());
  const sess = await r.json();
  L('kod pairing: ' + sess.code);

  // 6) Status — pending.
  r = await fetch(TV + '/api/pair/status');
  L('status sebelum claim: ' + JSON.stringify(await r.json()));

  // 7) ADMIN menuntut kod di cloud.
  r = await fetch(CLOUD + '/api/admin/pair', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({ code: sess.code, name: 'Mini PC Uji' })
  });
  if (!r.ok) throw new Error('admin pair: ' + r.status + ' ' + await r.text());
  L('admin menuntut kod: OK');

  // 8) TV poll — patut paired + token.
  r = await fetch(TV + '/api/pair/status');
  const done = await r.json();
  L('status selepas claim: ' + JSON.stringify({ ...done, token: done.token ? '(tersembunyi)' : undefined }));
  if (done.status !== 'paired') throw new Error('TV tidak paired: ' + JSON.stringify(done));

  // 9) HOT-ACTIVATION: /api/settings TV kini dari cloud.
  // Dapatkan display key lokal untuk akses API TV.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(tv.dir, 'masjidtv.db'));
  const srow = db.prepare('SELECT data FROM settings WHERE id=1').get();
  const displayKey = JSON.parse(srow.data).security.displayKey;
  db.close();

  r = await fetch(TV + '/api/settings?key=' + displayKey);
  L('TV /api/settings: ' + r.status);
  if (!r.ok) throw new Error('settings gagal: ' + await r.text());
  const settings = await r.json();
  L('settings dari cloud? mosque.name=' + (settings.mosque?.name ?? '(tiada)'));
  L('uploads di-rewrite? contoh: ' + (JSON.stringify(settings).includes(CLOUD) ? 'ya (URL cloud)' : 'tiada medan uploads'));

  // 10) /display kekal dilayan LOKAL (offline-first) — data datang dari
  // proksi cloud. Hanya /admin dialihkan ke cloud.
  r = await fetch(TV + '/display', { redirect: 'manual' });
  L('TV /display: ' + r.status + (r.status === 302 ? ' -> ' + r.headers.get('location') : ' (paparan lokal)'));
  if (r.status !== 200) throw new Error('/display sepatutnya dilayan lokal selepas pairing');

  // 10b) STREAMS CLOUD→RELAY LOKAL: admin menambah stream relay → SSE/fetch
  // tulis streams ke store lokal → /relay/<id>/index.m3u8 dijana ffmpeg.
  // STREAMS PENUH datang melalui /api/device/streams (device-token) —
  // termasuk URL dshow yang TIDAK ada dalam settings awam.
  await fetch(CLOUD + '/api/admin/streams', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({
      streams: [
        { id: 'cam1', name: 'Cam', type: 'dshow', url: 'video=OBS Virtual Camera', duration: 30, enabled: true },
        { id: 'ipcam', name: 'IP', type: 'rtsp', url: 'rtsp://192.168.1.50/s', duration: 30, enabled: false }
      ]
    })
  });
  // Beri masa SSE sync → device/streams fetch → store tulis.
  await sleep(2500);
  // Settings awam: url dshow mesti kelihatan (nama peranti, bukan rahsia).
  r = await fetch(TV + '/api/settings');
  const sSettings = await r.json();
  const pubStream = (sSettings.streams || []).find((x) => x.id === 'cam1');
  L('stream dshow (awam): ' + JSON.stringify(pubStream));
  if (!pubStream) throw new Error('stream dshow tidak sampai ke TV');
  if (String(pubStream.hlsUrl || '') !== '/relay/cam1/index.m3u8') {
    throw new Error('hlsUrl mesti /relay/cam1/index.m3u8 (lokal), dapat: ' + pubStream.hlsUrl);
  }
  L('hlsUrl relay lokal ✓');
  // Store LOKAL (relay ffmpeg): mesti ada URL dshow penuh.
  const db2 = new DatabaseSync(path.join(tv.dir, 'masjidtv.db'));
  const row2 = db2.prepare('SELECT data FROM settings WHERE id = 1').get();
  db2.close();
  const localStreams = JSON.parse(row2.data).streams || [];
  const localDshow = localStreams.find((x) => x.id === 'cam1');
  L('store lokal cam1: url=' + localDshow?.url);
  if (localDshow?.url !== 'video=OBS Virtual Camera') throw new Error('URL dshow tidak sampai ke store lokal: ' + localDshow?.url);
  L('relay lokal menerima URL dshow penuh ✓');

  r = await fetch(TV + '/admin', { redirect: 'manual' });
  const aloc = r.headers.get('location') || '';
  L('TV /admin: ' + r.status + ' -> ' + aloc);
  if (r.status !== 302 || !aloc.startsWith(CLOUD)) throw new Error('/admin tidak redirect ke cloud');

  // 11) Cloud display page + API dengan token peranti sebenar.
  const devToken = JSON.parse(fs.readFileSync(path.join(tv.dir, 'cloud.json'), 'utf8')).deviceToken;
  r = await fetch(CLOUD + '/display?token=' + devToken);
  L('cloud /display?token: ' + r.status + ' (' + (await r.text()).length + ' bytes)');
  r = await fetch(CLOUD + '/api/settings', { headers: { 'x-device-token': devToken } });
  L('cloud /api/settings dgn device token: ' + r.status);
  if (!r.ok) throw new Error('cloud settings dgn device token gagal: ' + r.status);

  // 11b) SYNC SEGERA SSE: sambung SSE lokal TV sebagai paparan, admin ubah
  // settings → jangka event 'sync' tiba <2sa.
  {
    const sse = readSseEvents(TV + '/api/events');
    const events = sse.events;

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
    sse.abort();
    if (!got) throw new Error('SSE sync TIDAK diterima dalam 5sa');
    const latency = got.at - t0;
    L('SSE sync diterima dalam ' + latency + 'ms' + (latency < 2000 ? ' ✓ (<2sa)' : ' ⚠ >2sa'));
    if (latency >= 2000) throw new Error('latensi sync ' + latency + 'ms melebihi sasaran 2sa');

    // Sahkan data baharu sampai ke proksi TV.
    r = await fetch(TV + '/api/settings');
    const s = await r.json();
    L('TV settings selepas ubah: mosque.name=' + (s.mosque?.name ?? '?'));
    if (s.mosque?.name !== 'Masjid SSE Test') throw new Error('data baharu tidak sampai ke TV');
  }

  // 12) AUTO-RESET: admin membuang peranti di cloud → TV 401 → reset.
  r = await fetch(CLOUD + '/api/admin/devices', { headers: { authorization: 'Bearer ' + admin.token } });
  const devices = (await r.json()).devices || [];
  const dev = devices[0];
  if (dev) {
    r = await fetch(CLOUD + '/api/admin/devices/' + dev.id, { method: 'DELETE', headers: { authorization: 'Bearer ' + admin.token } });
    L('admin membuang peranti: ' + r.status);
    // TV kini patut 401 → auto-reset → /display kembali pairing.
    r = await fetch(TV + '/api/settings');
    L('TV /api/settings selepas unpair: ' + r.status + ' (503 = DEVICE_UNPAIRED)');
    r = await fetch(TV + '/api/pair/config');
    L('TV config: ' + JSON.stringify(await r.json()));
    r = await fetch(TV + '/display');
    const body = await r.text();
    L('TV /display: ' + r.status + ' pairing-page=' + body.includes('Pautkan TV'));
  }

  L('=== E2E LULUS SEPENUHNYA ===');
  process.exitCode = 0;
} catch (e) {
  console.error('[e2e] GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await reg.cleanup();
  process.exit(process.exitCode || 0);
}
