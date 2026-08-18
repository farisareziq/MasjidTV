// SYSTEM TESTING — objective: exercise the complete local server (Fastify +
// SQLite store + announcements + streams + static pages) end to end.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { startTestServer, stubJakimFetch, type TestServer } from './helpers.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('System Testing / local server', () => {
  let srv: TestServer & { token?: string };
  let token: string;
  let restoreFetch: () => void;

  beforeAll(async () => {
    restoreFetch = stubJakimFetch(); // /api/today must not hit e-solat.gov.my
    srv = await startTestServer({ login: true });
    token = srv.token!;
  }, 120000);
  afterAll(async () => {
    restoreFetch();
    await srv.cleanup();
  });

  describe('system surface', () => {
    it('serves /api/health', async () => {
      const res = await srv.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().service).toBe('masjidtv');
    });

    it('serves prayer methods and zones', async () => {
      const m = await srv.app.inject({ method: 'GET', url: '/api/methods' });
      expect(m.statusCode).toBe(200);
      expect(Object.keys(m.json())).toHaveLength(13);

      const z = await srv.app.inject({ method: 'GET', url: '/api/zones' });
      expect(z.statusCode).toBe(200);
      expect(Object.keys(z.json().zones).length).toBeGreaterThan(0);
    });

    it('serves the display page', async () => {
      const res = await srv.app.inject({ method: 'GET', url: '/display' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<html');
    });
  });

  describe('display key security', () => {
    it('rejects /api/settings without a key', async () => {
      const res = await srv.app.inject({ method: 'GET', url: '/api/settings' });
      expect(res.statusCode).toBe(401);
    });

    it('accepts /api/settings with the display key', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mosque).toBeDefined();
    });
  });

  describe('admin session', () => {
    it('rejects a wrong password', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'wrong-password' }
      });
      expect(res.statusCode).toBe(401);
    });

    it('locks login after 5 failures', async () => {
      for (let i = 0; i < 5; i++) {
        await srv.app.inject({
          method: 'POST',
          url: '/api/admin/login',
          payload: { password: `wrong-${i}` }
        });
      }
      const locked = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: srv.password }
      });
      expect(locked.statusCode).toBe(429);
    });

    it('rejects admin endpoints without a session token', async () => {
      const res = await srv.app.inject({ method: 'GET', url: '/api/admin/status' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('settings flow', () => {
    it('updates settings via PATCH-validated PUT', async () => {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { mosque: { name: 'Masjid Sistem Uji' } }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().mosque.name).toBe('Masjid Sistem Uji');
    });

    it('validates a timezone change before accepting it', async () => {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { prayer: { timezone: 'Not/A_Zone' } }
      });
      expect(res.json().prayer.timezone).toBe('Asia/Kuala_Lumpur');
    });

    it('exposes the updated mosque name on the public settings projection', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.json().mosque.name).toBe('Masjid Sistem Uji');
    });
  });

  describe('announcements flow', () => {
    let id: string;

    it('creates an announcement (201)', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Kuliah Maghrib', message: 'Sabtu malam', category: 'event' }
      });
      expect(res.statusCode).toBe(201);
      id = res.json().id;
    });

    it('lists it with an active status', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/admin/announcements',
        headers: { authorization: `Bearer ${token}` }
      });
      const item = res.json().find((a: { id: string }) => a.id === id);
      expect(item.status).toBe('active');
    });

    it('deactivates it via update', async () => {
      const res = await srv.app.inject({
        method: 'PUT',
        url: `/api/admin/announcements/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { active: false }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().active).toBe(false);
    });

    it('falls back to builtin content on /api/slides when nothing is active', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/slides',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().announcements).toHaveLength(0);
      expect(res.json().builtin.length).toBeGreaterThan(0);
    });

    it('deletes it', async () => {
      const res = await srv.app.inject({
        method: 'DELETE',
        url: `/api/admin/announcements/${id}`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it('404s when updating an unknown announcement', async () => {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/announcements/does-not-exist',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'x' }
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('media upload validation', () => {
    it('accepts a real PNG (magic bytes ok)', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/upload',
        headers: { 'content-type': 'image/png', authorization: `Bearer ${token}` },
        payload: PNG_BYTES
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().kind).toBe('image');
      expect(res.json().url).toMatch(/^\/uploads\//);
    });

    it('rejects mismatched magic bytes', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/upload',
        headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${token}` },
        payload: Buffer.from([0x00, 0x01, 0x02, 0x03])
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unsupported content types (415 before reaching handler logic)', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/upload',
        headers: { 'content-type': 'application/x-executable', authorization: `Bearer ${token}` },
        payload: Buffer.from('MZ')
      });
      expect(res.statusCode).toBe(415);
    });

    it('rejects unauthenticated uploads before parsing the body', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/upload',
        headers: { 'content-type': 'image/png', authorization: 'Bearer invalid' },
        payload: PNG_BYTES
      });
      expect(res.statusCode).toBe(401);
    });

    it('actually persisted the accepted file to the uploads dir', () => {
      const files = fs.readdirSync(path.join(srv.dataDir, 'uploads'));
      expect(files.some((f) => f.endsWith('.png'))).toBe(true);
    });
  });

  describe('streams flow', () => {
    it('accepts a valid hls stream and reports its status', async () => {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/streams',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          streams: [{ name: 'Live KL', type: 'hls', url: 'https://example.com/live.m3u8', duration: 60, enabled: true }]
        }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().streams).toHaveLength(1);
      expect(res.json().streams[0].status).toBe('configured');
    });

    it('stores the sanitized stream on settings', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.json().streams).toHaveLength(1);
      expect(res.json().streams[0].type).toBe('hls');
    });
  });

  describe('password change revokes sessions', () => {
    it('logs out every session after a password change', async () => {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/password',
        headers: { authorization: `Bearer ${token}` },
        payload: { currentPassword: srv.password, newPassword: 'new-pass-123' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const after = await srv.app.inject({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(after.statusCode).toBe(401);
    });

    it('rejects a too-short new password with 400 (min length)', async () => {
      // Fresh app: the main app's IP is login-locked by the brute-force test
      // above (429), which would mask the 400 length-validation path.
      const fresh = await startTestServer({ login: true });
      try {
        // Change once so currentPassword is known-stable.
        await fresh.app.inject({
          method: 'POST',
          url: '/api/admin/password',
          headers: { authorization: `Bearer ${fresh.token}` },
          payload: { currentPassword: fresh.password, newPassword: 'new-pass-123' }
        });
        const relogin = await fresh.app.inject({
          method: 'POST',
          url: '/api/admin/login',
          payload: { password: 'new-pass-123' }
        });
        const freshToken = relogin.json().token;

        const res = await fresh.app.inject({
          method: 'POST',
          url: '/api/admin/password',
          headers: { authorization: `Bearer ${freshToken}` },
          payload: { currentPassword: 'new-pass-123', newPassword: '123' }
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await fresh.cleanup();
      }
    });
  });
});
