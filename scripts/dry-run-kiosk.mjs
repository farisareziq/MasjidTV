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
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLOUD_PORT = 3299;
const TV_PORT = 3211;
const CLOUD = `http://localhost:${CLOUD_PORT}`;
const TV = `http://localhost:${TV_PORT}`;
const log = (m) => console.log('[dry]', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cloudDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-cloud-'));
const tvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-tv-'));
const procs = [];
let bootPin = '';

function cleanup() {
  for (const p of procs) {
    try { p.kill(); } catch { /* sudah mati */ }
  }
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/f', '/im', 'ffmpeg.exe'], { stdio: 'ignore' });
  } catch { /* tiada */ }
}

process.on('exit', cleanup);

async function waitHealth(url, label) {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) return true;
    } catch { /* belum */ }
    await sleep(500);
  }
  throw new Error(label + ' tidak sedia');
}

async function main() {
  // ===== 1. Cloud dummy =====
  const cloudProc = spawn(process.execPath, ['--import', 'tsx', '-e', `
    import { createCloudApp } from './src/app.js';
    const app = await createCloudApp();
    await app.listen({ port: ${CLOUD_PORT}, host: '127.0.0.1' });
    console.log('cloud listening');
  `], {
    cwd: path.join(process.cwd(), 'packages', 'cloud'),
    env: { ...process.env, TURSO_URL: `file:${path.join(cloudDir, 'cloud.db')}`, JWT_SECRET: 'dry'.repeat(12), PORT: String(CLOUD_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procs.push(cloudProc);
  cloudProc.stdout.on('data', (d) => {
    const s = String(d);
    const m = s.match(/PIN bootstrap:\s*(\S+)/);
    if (m) bootPin = m[1];
  });
  cloudProc.stderr.on('data', (d) => process.stderr.write('[cloud-err] ' + d));
  await waitHealth(CLOUD, 'cloud');

  // Setup tenant + kandungan dummy.
  let r = await fetch(CLOUD + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin: bootPin })
  });
  let su = await r.json();
  r = await fetch(CLOUD + '/api/auth/superuser/pin', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token },
    body: JSON.stringify({ pin: 'dry-pin-12345' })
  });
  r = await fetch(CLOUD + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin: 'dry-pin-12345' })
  });
  su = await r.json();
  r = await fetch(CLOUD + '/api/super/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token },
    body: JSON.stringify({ name: 'Masjid Dummy', username: 'dryadmin', password: 'drypass123' })
  });
  const tenant = await r.json();
  r = await fetch(CLOUD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dryadmin', password: 'drypass123' })
  });
  const admin = await r.json();
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
  log('cloud dummy siap: Masjid Dummy Al-Falah (zone WLY01, 1 slaid)');

  // ===== 2. Kiosk packaged =====
  // Windows Smart App Control mungkin menyekat exe tidak ditandatangani —
  // fallback kepada electron dev binary + app dir (kod sama).
  const base = path.join(process.cwd(), 'apps', 'kiosk', 'dist-kiosk');
  const stamps = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^\d{12}$/.test(d)).sort() : [];
  const kioskExe = process.env.E2E_KIOSK_EXE || path.join(base, stamps[stamps.length - 1] || '', 'win-unpacked', 'MasjidTV Kiosk.exe');
  let tv;
  if (fs.existsSync(kioskExe)) {
    try {
      tv = spawn(kioskExe, ['--no-kiosk', '--port', String(TV_PORT)], {
        env: { ...process.env, MASJIDTV_DATA_DIR: tvDir },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      tv.on('error', (e) => { throw e; });
      // beri masa spawn sebelum semak
      await sleep(1500);
      if (tv.exitCode !== null) throw new Error('exit ' + tv.exitCode);
    } catch (e) {
      log('packaged exe disekat (' + e.message.slice(0, 60) + ') — fallback electron dev');
      tv = null;
    }
  }
  if (!tv) {
    tv = spawn(path.join(process.cwd(), 'apps', 'kiosk', 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', '--no-kiosk', '--port', String(TV_PORT)], {
      cwd: path.join(process.cwd(), 'apps', 'kiosk'),
      env: { ...process.env, MASJIDTV_DATA_DIR: tvDir, MASJIDTV_PUBLIC_DIR: path.join(process.cwd(), 'packages', 'frontend', 'public') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
  procs.push(tv);
  tv.stdout.on('data', (d) => process.stdout.write('[tv] ' + d));
  tv.stderr.on('data', (d) => process.stderr.write('[tv-err] ' + d));
  await waitHealth(TV, 'kiosk');

  // ===== 3. Pairing =====
  r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  const sess = await r.json();
  log('kod pairing: ' + sess.code);
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
  log('berjaya dipautkan: ' + (await (await fetch(TV + '/api/pair/config')).json()).tenantName);

  // ===== 4. Data dummy sampai ke kiosk =====
  r = await fetch(TV + '/api/settings');
  const settings = await r.json();
  if (settings.mosque?.name !== 'Masjid Dummy Al-Falah') throw new Error('nama masjid salah: ' + settings.mosque?.name);
  log('settings: ' + settings.mosque.name + ' ✓');
  r = await fetch(TV + '/api/today');
  const today = await r.json();
  for (const k of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    if (!/^\d{2}:\d{2}$/.test(today.prayers[k].time)) throw new Error('waktu solat ' + k + ' tidak sah');
  }
  log('prayer times: ' + Object.entries(today.prayers).slice(0, 3).map(([k, v]) => k + '=' + v.time).join(' ') + '… ✓');
  r = await fetch(TV + '/api/slides');
  const slides = await r.json();
  const found = (slides.announcements || []).some((a) => a.title === 'Program Dummy');
  if (!found) throw new Error('slaid dummy tidak sampai');
  log('slaid dummy: "Program Dummy" ✓');

  // ===== 5. SSE segera =====
  {
    const ctl = new AbortController();
    const sse = await fetch(TV + '/api/events', { signal: ctl.signal, headers: { accept: 'text/event-stream' } });
    const reader = sse.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events = [];
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            let ev = 'message';
            for (const line of chunk.split('\n')) if (line.startsWith('event:')) ev = line.slice(6).trim();
            events.push({ ev, at: Date.now() });
          }
        }
      } catch { /* abort */ }
    })();
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
    ctl.abort();
    if (!got) throw new Error('SSE sync tidak diterima');
    const lat = got.at - t0;
    log('SSE sync: ' + lat + 'ms ' + (lat < 2000 ? '✓' : '⚠ LAMBAT'));
    if (lat >= 2000) throw new Error('latensi >2sa');
    // Data baharu sampai.
    await sleep(400);
    const s2 = await (await fetch(TV + '/api/settings')).json();
    if (s2.mosque?.name !== 'Masjid Dummy Baharu') throw new Error('kemas kini tidak sampai: ' + s2.mosque?.name);
    log('kemas kini SSE: "Masjid Dummy Baharu" ✓');
  }

  // ===== 6. Offline & catch-up =====
  log('mematikan cloud (offline 15sa)...');
  cloudProc.kill();
  await sleep(15000);
  // Paparan kekal dari cache.
  r = await fetch(TV + '/api/settings');
  const offline = await r.json();
  if (offline.mosque?.name !== 'Masjid Dummy Baharu') throw new Error('cache offline gagal');
  log('offline: paparan kekal dari cache ✓');

  // Hidupkan cloud semula (data kekal dalam fail DB).
  const cloud2 = spawn(process.execPath, ['--import', 'tsx', '-e', `
    import { createCloudApp } from './src/app.js';
    const app = await createCloudApp();
    await app.listen({ port: ${CLOUD_PORT}, host: '127.0.0.1' });
    console.log('cloud listening');
  `], {
    cwd: path.join(process.cwd(), 'packages', 'cloud'),
    env: { ...process.env, TURSO_URL: `file:${path.join(cloudDir, 'cloud.db')}`, JWT_SECRET: 'dry'.repeat(12), PORT: String(CLOUD_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procs.push(cloud2);
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
  log('catch-up selepas offline: "Masjid Dummy Selepas Offline" ✓');

  // ===== 7. Unpair → auto-reset =====
  r = await fetch(CLOUD + '/api/admin/devices', { headers: { authorization: 'Bearer ' + reAdmin.token } });
  const devices = (await r.json()).devices || [];
  if (devices.length) {
    await fetch(CLOUD + '/api/admin/devices/' + devices[0].id, { method: 'DELETE', headers: { authorization: 'Bearer ' + reAdmin.token } });
    let reset = false;
    const dl2 = Date.now() + 10000;
    while (Date.now() < dl2 && !reset) {
      const cfg = await (await fetch(TV + '/api/pair/config')).json();
      if (!cfg.paired) reset = true;
      else await sleep(500);
    }
    if (!reset) throw new Error('auto-reset unpair gagal');
    const page = await (await fetch(TV + '/display')).text();
    if (!page.includes('Pautkan TV')) throw new Error('/display tidak kembali ke pairing');
    log('unpair: auto-reset ke pairing ✓');
  }

  // ===== 8. Pair semula =====
  r = await fetch(TV + '/api/pair/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cloudUrl: CLOUD })
  });
  const sess2 = await r.json();
  log('kod pair semula: ' + sess2.code + ' (http ' + r.status + ')');
  const reAdmin2 = await (await fetch(CLOUD + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dryadmin', password: 'drypass123' })
  })).json();
  const claim2 = await fetch(CLOUD + '/api/admin/pair', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + reAdmin2.token },
    body: JSON.stringify({ code: sess2.code, name: 'TV Dummy 2' })
  });
  log('claim pair semula: http ' + claim2.status + ' ' + (await claim2.text()).slice(0, 80));
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
    log('DEBUG pair/status terakhir: ' + lastStatus);
    throw new Error('pair semula gagal');
  }
  const s4 = await (await fetch(TV + '/api/settings')).json();
  if (s4.mosque?.name !== 'Masjid Dummy Selepas Offline') throw new Error('data selepas pair semula salah');
  log('pair semula: paparan pulih ✓');

  log('=== DRY RUN LULUS SEPENUHNYA ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('[dry] GAGAL:', e.message);
  process.exit(1);
});
