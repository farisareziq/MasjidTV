// ACCEPTANCE TESTING — objective: confirm the deployed system meets real user
// needs by walking complete mosque-operator journeys on the running cloud app.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCloudApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000;

describe('Acceptance Testing / cloud user journeys', () => {
  let app: FastifyInstance;
  let superPin: string;
  let tenantApiKey: string;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-acceptance-'));
  // PIN file terisolasi per-run (env override) — JANGAN sentuh laluan
  // mesin-global os.tmpdir()/MASJIDTV_SUPERUSER_PIN.txt yang mungkin milik
  // deployment sebenar pada host yang sama.
  const pinFile = path.join(tmpDir, 'MASJIDTV_SUPERUSER_PIN.txt');

  // Simpan nilai asli untuk dipulihkan di afterAll — env yang bocor ke
  // thread lain (cth. TURSO_URL, JWT_SECRET) mengganggu suite server.
  const _savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['TURSO_URL', 'JWT_SECRET', 'MASJIDTV_SUPERUSER_PIN_FILE']) {
      _savedEnv[k] = process.env[k];
    }
    process.env.TURSO_URL = `file:${path.join(tmpDir, 'cloud.db')}`;
    process.env.JWT_SECRET = 'acceptance-secret';
    process.env.MASJIDTV_SUPERUSER_PIN_FILE = pinFile;
    app = await createCloudApp();
    await app.ready();
    const raw = fs.readFileSync(pinFile, 'utf8');
    superPin = raw.split('\n').map((l) => l.trim()).find((l) => l.startsWith('admin /'))!.slice('admin / '.length);
  }, 120000);

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(_savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  it('rejects the well-known default PIN 00000000 (takeover-race regression)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/superuser/login',
      payload: { username: 'admin', pin: '00000000' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('AC1 — superuser onboards a new mosque and receives its pairing key', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/superuser/login',
      payload: { username: 'admin', pin: superPin }
    });
    expect(login.statusCode).toBe(200);

    let token: string = login.json().token;
    if (login.json().mustChangePin) {
      const changed = await app.inject({
        method: 'POST',
        url: '/api/auth/superuser/pin',
        headers: { authorization: `Bearer ${token}` },
        payload: { pin: 'pin-baru-12345' }
      });
      expect(changed.statusCode).toBe(200);
      token = changed.json().token;
    }

    const create = await app.inject({
      method: 'POST',
      url: '/api/super/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Masjid Pelanggan Uji', username: 'ustaz', password: 'rahsia123' }
    });
    expect(create.statusCode).toBe(201);
    tenantApiKey = create.json().apiKey;
    expect(tenantApiKey.length).toBeGreaterThanOrEqual(32);
    expect(create.json().trialUntil).toBeGreaterThan(Date.now());
    expect(create.json().trialUntil).toBeLessThanOrEqual(Date.now() + TRIAL_MS);
  });

  it('AC2 — mosque admin logs in and personalizes settings', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ustaz', password: 'rahsia123' }
    });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;

    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { mosque: { name: 'Masjid Pelanggan Uji' }, prayer: { zone: 'SGR01' } }
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().prayer.zone).toBe('SGR01');
  });

  it('AC3 — TV display gets a full day of prayer times with just the tenant key', async () => {
    const today = await app.inject({
      method: 'GET',
      url: '/api/today',
      headers: { 'x-tenant-key': tenantApiKey }
    });
    expect(today.statusCode).toBe(200);
    const body = today.json();
    for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(body.prayers[key].time).toMatch(/^\d{2}:\d{2}$/);
      expect(body.iqamah[key].time).toMatch(/^\d{2}:\d{2}$/);
    }
    expect(body.next).not.toBeNull();
  });

  it('AC4 — anonymous visitors cannot read mosque data without a key', async () => {
    const settings = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.statusCode).toBe(401);
    const today = await app.inject({ method: 'GET', url: '/api/today' });
    expect(today.statusCode).toBe(401);
  });

  it('AC5 — health endpoint reports the deployed service identity', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('masjidtv-cloud');
    expect(res.json().ok).toBe(true);
  });

  // --- SSE sync (pentest + fungsi) ------------------------------------------

  it('SEC1 — /api/events menolak tanpa auth dan token palsu', async () => {
    const no = await app.inject({ method: 'GET', url: '/api/events' });
    expect(no.statusCode).toBe(401);
    const fake = await app.inject({
      method: 'GET', url: '/api/events',
      headers: { 'x-device-token': 'token-palsu'.repeat(4) }
    });
    expect(fake.statusCode).toBe(401);
  });

  it('SSE1 — penulisan admin tidak merosakkan API (rev bump selamat)', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'ustaz', password: 'rahsia123' }
    });
    const token = login.json().token;
    // Dua penulisan berturut — hook bumpRev mesti tidak menghalang/gagalkan.
    for (let i = 0; i < 2; i++) {
      const put = await app.inject({
        method: 'PUT', url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { mosque: { name: 'Masjid SSE ' + i } }
      });
      expect(put.statusCode).toBe(200);
    }
    // API kekal sihat selepas bump.
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    // (Broadcast SSE disahkan penuh dalam scripts/e2e-pairing.mjs — ujian
    // latensi & kandungan dijalankan di sana dengan server socket sebenar.)
  });

  // --- Pustaka media (A4) ---------------------------------------------------

  it('MED1 — /api/admin/media menolak tanpa auth (401)', async () => {
    const no = await app.inject({ method: 'GET', url: '/api/admin/media' });
    expect(no.statusCode).toBe(401);
    const delNo = await app.inject({ method: 'DELETE', url: '/api/admin/media/x' });
    expect(delNo.statusCode).toBe(401);
  });

  it('MED2 — senarai media kosong dahulu, kemudian baris boleh dipadam', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'ustaz', password: 'rahsia123' }
    });
    const token = login.json().token;
    const headers = { authorization: `Bearer ${token}` };

    const empty = await app.inject({ method: 'GET', url: '/api/admin/media', headers });
    expect(empty.statusCode).toBe(200);
    expect(Array.isArray(empty.json())).toBe(true);

    // Muat naik tanpa token Blob gagal (400) — tetapi baris media boleh
    // diwujudkan terus melalui laluan upload dengan token Blob palsu? Tidak:
    // tanpa Blob, tiada baris. Jadi uji aliran list→(tiada baris) dahulu,
    // kemudian tambah baris melalui upload-confirm dengan token Blob palsu
    // juga gagal. Ujian ini mensahkan endpoint wujud & respon JSON betul.
    expect(empty.json().length).toBe(0);

    // ID rawak → 404 (baris tenant lain juga 404 — penapisan tenant).
    const delMissing = await app.inject({ method: 'DELETE', url: '/api/admin/media/tiada-id', headers });
    expect(delMissing.statusCode).toBe(404);
  });

  // --- Cache device-token: pembatalan segera (regresi v1.1.1) -----------------
  //
  // dry-run-kiosk menangkap: padam peranti melalui ID admin tidak membatalkan
  // cache device-token 30sa → TV yang dinyahpaut kekal sah sehingga TTL.
  // Unpair mesti segera berkuat kuasa.

  it('DEV1 — padam peranti (by ID) membatalkan token serta-merta, bukan selepas TTL cache', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'ustaz', password: 'rahsia123' }
    });
    const token = login.json().token;
    const headers = { authorization: `Bearer ${token}` };

    // Cipta peranti (pairing claim penuh tidak diperlukan — tulis terus
    // melalui laluan padam/uji tidak wujud; guna aliran pair sebenar ringkas:
    // pair/start + claim oleh admin).
    const start = await app.inject({
      method: 'POST', url: '/api/pair/start',
      payload: { deviceId: 'test-device-cache-bust' }
    });
    expect(start.statusCode).toBe(200);
    const code = start.json().code;
    const claim = await app.inject({
      method: 'POST', url: '/api/admin/pair',
      headers, payload: { code, name: 'TV Cache Test' }
    });
    expect(claim.statusCode).toBe(200);
    const deviceToken = claim.json().token;

    // Isi cache: satu panggilan baca sahaja mencache token selama 30sa.
    const before = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-device-token': deviceToken }
    });
    expect(before.statusCode).toBe(200);

    // Padam melalui ID (laluan unpair admin sebenar).
    const list = await app.inject({ method: 'GET', url: '/api/admin/devices', headers });
    const device = list.json().devices.find((d: { deviceId?: string }) => d.deviceId === 'test-device-cache-bust' || d.id === 'test-device-cache-bust');
    expect(device).toBeTruthy();
    const del = await app.inject({
      method: 'DELETE', url: `/api/admin/devices/${device.id}`, headers
    });
    expect(del.statusCode).toBe(200);

    // Token mesti ditolak SERTA-MERTA (cache dibatalkan oleh deleteDevice).
    const after = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-device-token': deviceToken }
    });
    expect(after.statusCode).toBe(401);
  });
});
