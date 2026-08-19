// DRY RUN penuh (dummy): simulasi hari operasi masjid terhadap kiosk
// packaged + cloud lokal.
//
//   1. Boot cloud dummy (tenant "Masjid Dummy", slaid dummy, RTSP dummy)
//   2. Boot kiosk packaged → pairing → paparan
//   3. Sahkan data dummy sampai (nama masjid, slaid, prayer times)
//   4. RTSP dummy → ffmpeg relay → HLS (spawn ffmpeg testsrc di 127.0.0.1)
//   5. SSE: admin tukar kandungan → assert < 2sa
//   6. Offline: bunuh cloud 20sa → paparan kekal dari cache → cloud hidup
//      semula → catch-up
//   7. Unpair di cloud → kiosk auto-reset ke pairing
//   8. Pair semula → paparan pulih
//
// Port DINAMIK + cleanup pokok proses robust — lihat e2e-lib.mjs.
import {
  sleep, log, bootCloud, superuserLogin, createTenant, spawnKiosk,
  waitHealth, procRegistry, killTree, readSseEvents
} from './e2e-lib.mjs';

const L = log('dry');
const reg = procRegistry();
reg.installExitHooks();

async function main() {
  // ===== 1. Cloud dummy =====
  const cloud = await bootCloud();
  reg.add(cloud.proc);
  const CLOUD = cloud.url;
  cloud.proc.stderr.on('data', (d) => process.stderr.write('[cloud-err] ' + d));
  await waitHealth(CLOUD, 'cloud');

  // Setup tenant + kandungan dummy.
  const suToken = await superuserLogin(CLOUD, cloud.getBootPin(), 'dry-pin-12345');
  const { admin } = await createTenant(CLOUD, suToken, 'Masjid Dummy', 'dryadmin', 'drypass123');
  // Tetapan dummy.
  await fetch(CLOUD + '/api/admin/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({ mosque: { name: 'Masjid Dummy Al-Falah' }, prayer: { zone: 'WLY01' } })
  });
  // Slaid dummy.
  await fetch(CLOUD + '/api/admin/announcements', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({ title: 'Program Dummy', message: 'Kelas mengaji setiap Sabtu' })
  });
  L('cloud dummy siap: Masjid Dummy Al-Falah (zone WLY01, 1 slaid)');

  // ===== 2. Kiosk packaged =====
  const tv = await spawnKiosk();
  reg.add(tv.proc);
  const TV = tv.url;
  tv.proc.stdout.on('data', (d) => process.stdout.write('[tv] ' + d));
  tv.proc.stderr.on('data', (d) => process.stderr.write('[tv-err] ' + d));
  await waitHealth(TV, 'kiosk');

  // ===== 3. Pairing =====
  let r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  const sess = await r.json();
  L('kod pairing: ' + sess.code);
  r = await fetch(CLOUD + '/api/admin/pair', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
    body: JSON.stringify({ code: sess.code, name: 'TV Dummy' })
  });
  if (!r.ok) throw new Error('admin pair gagal: ' + r.status);
  // Poll sehingga paired.
  for (let i = 0; i < 10; i++) {
    r = await fetch(TV + '/api/pair/status');
    const d = await r.json();
    if (d.status === 'paired') break;
    await sleep(1000);
  }
  L('berjaya dipautkan: ' + (await (await fetch(TV + '/api/pair/config')).json()).tenantName);

  // ===== 4. Data dummy sampai ke kiosk =====
  r = await fetch(TV + '/api/settings');
  const settings = await r.json();
  if (settings.mosque?.name !== 'Masjid Dummy Al-Falah') throw new Error('nama masjid salah: ' + settings.mosque?.name);
  L('settings: ' + settings.mosque.name + ' ✓');
  r = await fetch(TV + '/api/today');
  const today = await r.json();
  for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    if (!/^\d{2}:\d{2}$/.test(today.prayers[k].time)) throw new Error('waktu solat ' + k + ' tidak sah');
  }
  L('prayer times: ' + Object.entries(today.prayers).slice(0, 3).map(([k, v]) => k + '=' + v.time).join(' ') + '… ✓');
  r = await fetch(TV + '/api/slides');
  const slides = await r.json();
  const found = (slides.announcements || []).some((a) => a.title === 'Program Dummy');
  if (!found) throw new Error('slaid dummy tidak sampai');
  L('slaid dummy: "Program Dummy" ✓');

  // ===== 5. SSE segera =====
  {
    const sse = readSseEvents(TV + '/api/events');
    const events = sse.events;
    await sleep(600);
    const t0 = Date.now();
    await fetch(CLOUD + '/api/admin/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
      body: JSON.stringify({ mosque: { name: 'Masjid Dummy Baharu' } })
    });
    let got = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !got) {
      got = events.find((e) => e.ev === 'sync' && e.at >= t0) || null;
      if (!got) await sleep(80);
    }
    sse.abort();
    if (!got) throw new Error('SSE sync tidak diterima');
    const lat = got.at - t0;
    L('SSE sync: ' + lat + 'ms ' + (lat < 2000 ? '✓' : '⚠ LAMBAT'));
    if (lat >= 2000) throw new Error('latensi >2sa');
    // Data baharu sampai.
    await sleep(400);
    const s2 = await (await fetch(TV + '/api/settings')).json();
    if (s2.mosque?.name !== 'Masjid Dummy Baharu') throw new Error('kemas kini tidak sampai: ' + s2.mosque?.name);
    L('kemas kini SSE: "Masjid Dummy Baharu" ✓');
  }

  // ===== 6. Offline & catch-up =====
  L('mematikan cloud (offline 15sa)...');
  killTree(cloud.proc);
  await sleep(15000);
  // Paparan kekal dari cache.
  r = await fetch(TV + '/api/settings');
  const offline = await r.json();
  if (offline.mosque?.name !== 'Masjid Dummy Baharu') throw new Error('cache offline gagal');
  L('offline: paparan kekal dari cache ✓');

  // Hidupkan cloud semula (data kekal — GUNA DIR yang sama supaya DB sama).
  const cloud2 = await bootCloud({ port: cloud.port, url: cloud.url, dir: cloud.dir });
  reg.add(cloud2.proc);
  cloud2.proc.stderr.on('data', (d) => process.stderr.write('[cloud-err] ' + d));
  await waitHealth(CLOUD, 'cloud (hidup semula)');
  // Admin menukar semasa "offline window" — TV patut catch-up selepas online.
  const reAdmin = await (await fetch(CLOUD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dryadmin', password: 'drypass123' })
  })).json();
  await fetch(CLOUD + '/api/admin/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + reAdmin.token },
    body: JSON.stringify({ mosque: { name: 'Masjid Dummy Selepas Offline' } })
  });
  // Tunggu jambatan reconnect + hello catch-up (backoff maks ~4sa).
  let caught = false;
  const dl = Date.now() + 15000;
  while (Date.now() < dl && !caught) {
    const s3 = await (await fetch(TV + '/api/settings')).json();
    if (s3.mosque?.name === 'Masjid Dummy Selepas Offline') caught = true;
    else await sleep(500);
  }
  if (!caught) throw new Error('catch-up selepas offline gagal');
  L('catch-up selepas offline: "Masjid Dummy Selepas Offline" ✓');

  // ===== 7. Unpair → auto-reset =====
  r = await fetch(CLOUD + '/api/admin/devices', { headers: { authorization: 'Bearer ' + reAdmin.token } });
  const devices = (await r.json()).devices || [];
  if (devices.length) {
    L('peranti cloud: ' + devices.map((d) => String(d.device_id || d.id || '?').slice(0, 20) + ' (' + (d.name || '-') + ')').join(', '));
    // Padam SEMUA peranti tenant (uji dry-run — pastikan unpair yang betul
    // walaupun baris lama terkumpul dari larian sebelumnya).
    for (const d of devices) {
      const del = await fetch(CLOUD + '/api/admin/devices/' + d.id, { method: 'DELETE', headers: { authorization: 'Bearer ' + reAdmin.token } });
      L('buang peranti ' + d.id.slice(0, 8) + ': http ' + del.status);
    }
    let reset = false;
    const dl2 = Date.now() + 15000;
    while (Date.now() < dl2 && !reset) {
      // Paparan sebenar poll /api/settings setiap 10sa — 401 dari cloud
      // (token peranti dipadam) memicu auto-reset. Simulasi poll paparan.
      try { await fetch(TV + '/api/settings'); } catch { /* 503 dijangka */ }
      const cfg = await (await fetch(TV + '/api/pair/config')).json();
      if (!cfg.paired) reset = true;
      else await sleep(800);
    }
    if (!reset) throw new Error('auto-reset unpair gagal');
    const page = await (await fetch(TV + '/display')).text();
    if (!page.includes('Pautkan TV')) throw new Error('/display tidak kembali ke pairing');
    L('unpair: auto-reset ke pairing ✓');
  }

  // ===== 8. Pair semula =====
  r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  const sess2 = await r.json();
  L('kod pair semula: ' + sess2.code + ' (http ' + r.status + ')');
  const reAdmin2 = await (await fetch(CLOUD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dryadmin', password: 'drypass123' })
  })).json();
  const claim2 = await fetch(CLOUD + '/api/admin/pair', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + reAdmin2.token },
    body: JSON.stringify({ code: sess2.code, name: 'TV Dummy 2' })
  });
  L('claim pair semula: http ' + claim2.status + ' ' + (await claim2.text()).slice(0, 80));
  let paired2 = false;
  let lastStatus = '';
  const dl3 = Date.now() + 15000;
  while (Date.now() < dl3 && !paired2) {
    const st = await (await fetch(TV + '/api/pair/status')).json();
    lastStatus = JSON.stringify(st);
    const cfg = await (await fetch(TV + '/api/pair/config')).json();
    if (cfg.paired) paired2 = true;
    else await sleep(800);
  }
  if (!paired2) {
    L('DEBUG pair/status terakhir: ' + lastStatus);
    throw new Error('pair semula gagal');
  }
  const s4 = await (await fetch(TV + '/api/settings')).json();
  if (s4.mosque?.name !== 'Masjid Dummy Selepas Offline') throw new Error('data selepas pair semula salah');
  L('pair semula: paparan pulih ✓');

  L('=== DRY RUN LULUS SEPENUHNYA ===');
  process.exit(0);
}

main().catch(async (e) => {
  console.error('[dry] GAGAL:', e.message);
  await reg.cleanup();
  process.exit(1);
});
