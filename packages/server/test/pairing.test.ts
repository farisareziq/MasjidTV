// PAIRING TESTING — objective: validate the mini-PC cloud pairing flow
// (OOB): /pair page → start session → poll status → config saved →
// cloud-sync hot activation → unpair.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startTestServer, type TestServer } from './helpers.js';
import { readCloudConfig, cloudConfigPath } from '../src/pair.js';

// Stub cloud: counter-based endpoints with the same contract as
// packages/cloud (/api/pair/start, /api/pair/status, /api/settings).
function stubCloudFetch(): { restore: () => void; pairNow: (token: string, tenant: string) => void; goOffline: (off: boolean) => void } {
  const original = globalThis.fetch;
  // issuedToken = token terakhir yang diterbitkan oleh /api/pair/status.
  // /api/settings hanya terima token yang sama (selain itu 401 — unpair).
  const state = { issuedToken: '', tenant: '', offline: false };
  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    if (state.offline) throw new TypeError('fetch failed'); // network down
    const u = new URL(url);
    if (u.pathname === '/api/pair/start' && init?.method === 'POST') {
      return Response.json({ code: 'ABC123', expiresAt: Date.now() + 15 * 60_000 });
    }
    if (u.pathname === '/api/pair/status') {
      if (!state.issuedToken) return Response.json({ status: 'pending' });
      return Response.json({ status: 'paired', token: state.issuedToken, tenantName: state.tenant });
    }
    if (u.pathname === '/api/settings') {
      const hdr = (init?.headers as Record<string, string>) || {};
      const supplied = hdr['x-device-token'] || hdr['x-tenant-key'] || '';
      if (!state.issuedToken || supplied !== state.issuedToken) {
        return new Response('unauthorized', { status: 401 });
      }
      return Response.json({ mosque: { name: state.tenant }, source: 'cloud-stub' });
    }
    return new Response('not found', { status: 404 });
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    pairNow: (token: string, tenant: string) => {
      state.issuedToken = token;
      state.tenant = tenant;
    },
    goOffline: (off: boolean) => {
      state.offline = off;
    }
  };
}

describe('Pairing Testing / mini-PC cloud pairing (OOB)', () => {
  let srv: TestServer;
  let cloud: ReturnType<typeof stubCloudFetch>;

  beforeAll(async () => {
    cloud = stubCloudFetch();
    srv = await startTestServer({});
  }, 120000);

  afterAll(async () => {
    cloud.restore();
    await srv.cleanup();
  });

  it('serves the /pair page and script (auto-start)', async () => {
    const page = await srv.app.inject({ method: 'GET', url: '/pair' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Pautkan TV');
    expect(page.body).toContain('/pair.js');

    const js = await srv.app.inject({ method: 'GET', url: '/pair.js' });
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('api/pair/start');
    // AUTO-START: skrip memulakan pairing tanpa klik butang.
    expect(js.body).toContain("start(cfg && cfg.cloudUrl ? cfg.cloudUrl : null)");
  });

  it('GET /api/pair/config reports unpaired initially', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/api/pair/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ paired: false, cloudUrl: '', tenantName: '', deviceId: '' });
  });

  it('/display without key shows the pairing page (Android TV behaviour)', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Pautkan TV');
    // Dengan display key yang sah → paparan lokal biasa.
    const ok = await srv.app.inject({ method: 'GET', url: `/display?key=${srv.displayKey}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('display.js');
  });

  it('rejects an invalid cloud URL', async () => {
    const res = await srv.app.inject({
      method: 'POST', url: '/api/pair/start',
      payload: { cloudUrl: 'ftp://bogus' }
    });
    expect(res.statusCode).toBe(400);
  });

  it('starts a pairing session and returns the 6-char code', async () => {
    const res = await srv.app.inject({
      method: 'POST', url: '/api/pair/start',
      payload: { cloudUrl: 'https://cloud.example.com/' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe('ABC123');

    // Session persisted for cross-refresh polling.
    const sess = JSON.parse(fs.readFileSync(path.join(srv.dataDir, '.pair-session.json'), 'utf8'));
    expect(sess.cloudUrl).toBe('https://cloud.example.com');
    expect(sess.deviceId).toMatch(/^minipc-/);
  });

  it('IDEMPOTENT: repeated /api/pair/start resumes the same session/code', async () => {
    // Simula watchdog-restart / refresh berulang — kod TIDAK berubah.
    const calls: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await srv.app.inject({
        method: 'POST', url: '/api/pair/start',
        payload: { cloudUrl: 'https://cloud.example.com' }
      });
      expect(res.statusCode).toBe(200);
      calls.push(res.json().code);
    }
    expect(new Set(calls).size).toBe(1); // semua sama
    expect(calls[0]).toBe('ABC123');
  });

  it('polls pending before admin claims the code', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/api/pair/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
  });

  it('completes pairing after admin claim: token saved, config written', async () => {
    cloud.pairNow('dev-token-123', 'Masjid Al-Falah');
    const res = await srv.app.inject({ method: 'GET', url: '/api/pair/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'paired', tenantName: 'Masjid Al-Falah' });

    const cfg = readCloudConfig(srv.dataDir);
    expect(cfg).not.toBeNull();
    expect(cfg!.cloudUrl).toBe('https://cloud.example.com');
    expect(cfg!.deviceToken).toBe('dev-token-123');
    expect(cfg!.tenantName).toBe('Masjid Al-Falah');
    // Session file cleaned up.
    expect(fs.existsSync(path.join(srv.dataDir, '.pair-session.json'))).toBe(false);
  });

  it('cloud-sync activates hot: /api/settings proxies from the cloud', async () => {
    const res = await srv.app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-display-key': srv.displayKey }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe('cloud-stub');

    const cfgRes = await srv.app.inject({ method: 'GET', url: '/api/pair/config' });
    expect(cfgRes.json().paired).toBe(true);
    expect(cfgRes.json().tenantName).toBe('Masjid Al-Falah');
  });
  it('/display serves the local page when paired (proxy data, no key needed)', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('display.js'); // bukan halaman pairing

    // API paparan kini terbuka (token peranti = akses, kelakuan TV).
    const settings = await srv.app.inject({ method: 'GET', url: '/api/settings' });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().source).toBe('cloud-stub');

    const admin = await srv.app.inject({ method: 'GET', url: '/admin' });
    expect(admin.statusCode).toBe(302);
    expect(admin.headers.location).toBe('https://cloud.example.com/admin');
  });

  it('serves from cache when the cloud is unreachable (offline-first)', async () => {
    // Settings were cached by the previous request — drop the network.
    cloud.goOffline(true);
    const res = await srv.app.inject({
      method: 'GET', url: '/api/settings'
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe('cloud-stub'); // from cache
    cloud.goOffline(false);
  });

  it('AUTO-RESET: cloud rejects the device token (401) → unpair + cache cleared', async () => {
    // Token ditarik balik di cloud (unpair oleh admin).
    cloud.pairNow('INVALID', 'x');
    const res = await srv.app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('DEVICE_UNPAIRED');

    // Config + cache dibuang automatik.
    expect(fs.existsSync(cloudConfigPath(srv.dataDir))).toBe(false);
    expect(fs.existsSync(path.join(srv.dataDir, 'cloud-cache'))).toBe(false);

    // /display kembali ke skrin pairing (kelakuan Android TV).
    const display = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(display.statusCode).toBe(200);
    expect(display.body).toContain('Pautkan TV');

    cloud.pairNow('dev-token-123', 'Masjid Al-Falah');
  });

  it('manual unpair returns the server to full local mode', async () => {
    // Pasang semula config melalui pairing (cloud masih valid).
    const res = await srv.app.inject({ method: 'POST', url: '/api/pair/unpair' });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(cloudConfigPath(srv.dataDir))).toBe(false);

    const display = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(display.statusCode).toBe(200);
    expect(display.body).toContain('Pautkan TV'); // belum dipaut lagi → pairing
  });
});
