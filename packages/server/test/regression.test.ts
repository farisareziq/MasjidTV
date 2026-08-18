// REGRESSION TESTING — objective: prove that updates and mutations do not
// break existing behaviour (persistence across restarts, validation
// invariants, sanitization, session revocation semantics).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { startTestServer, stubJakimFetch, PUBLIC_DIR, type TestServer } from './helpers.js';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

async function rmRetry(dir: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

describe('Regression Testing / persistence across restarts', () => {
  let srv: TestServer & { token?: string };
  let announcementId: string;
  let restoreFetch: () => void;

  it('phase 1: writes settings + announcement via a live app', async () => {
    restoreFetch = stubJakimFetch();
    srv = await startTestServer({ login: true });

    const put = await srv.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${srv.token}` },
      payload: { mosque: { name: 'Masjid Kekal' }, hijriOffset: 1 }
    });
    expect(put.statusCode).toBe(200);

    const created = await srv.app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: { authorization: `Bearer ${srv.token}` },
      payload: { title: 'Program Khas', message: 'Ahad ini' }
    });
    expect(created.statusCode).toBe(201);
    announcementId = created.json().id;

    // Close but KEEP the dataDir for phase 2.
    await srv.close();
  }, 120000);

  it('phase 2: a fresh app on the same dataDir still serves them', async () => {
    const app: FastifyInstance = await buildApp({ dataDir: srv.dataDir, publicDir: PUBLIC_DIR, port: 0 });
    await app.ready();

    const settings = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { 'x-display-key': srv.displayKey }
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().mosque.name).toBe('Masjid Kekal');
    expect(settings.json().hijriOffset).toBe(1);

    const login = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: srv.password } });
    expect(login.statusCode).toBe(200); // password survives restart
    const token = login.json().token;

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/announcements',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(list.json().some((a: { id: string }) => a.id === announcementId)).toBe(true);

    const slides = await app.inject({
      method: 'GET',
      url: '/api/slides',
      headers: { 'x-display-key': srv.displayKey }
    });
    expect(slides.json().announcements.some((a: { id: string }) => a.id === announcementId)).toBe(true);

    await app.close();
    restoreFetch();
    await rmRetry(srv.dataDir);
  }, 120000);
});

describe('Regression Testing / validation invariants hold after every update', () => {
  let srv: TestServer & { token?: string };

  it('keeps clamping boundaries identical across repeated patches', async () => {
    srv = await startTestServer({ login: true });
    for (let i = 0; i < 3; i++) {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${srv.token}` },
        payload: { prayer: { iqamahOffsetMinutes: 999999 }, hijriOffset: 42 }
      });
      expect(res.json().prayer.iqamahOffsetMinutes).toBe(60);
      expect(res.json().hijriOffset).toBe(2);
    }
  }, 120000);

  it('still drops an SSRF stream on every attempt', async () => {
    for (const url of ['http://localhost/x', 'http://169.254.169.254/metadata', 'http://2130706433/x']) {
      const res = await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/streams',
        headers: { authorization: `Bearer ${srv.token}` },
        payload: { streams: [{ name: 'SSRF', type: 'hls', url }] }
      });
      expect(res.json().streams).toHaveLength(0);
    }
  });

  it('cleans up', async () => {
    await srv.cleanup();
  });
});

describe('Regression Testing / announcement sanitization stays strict', () => {
  let srv: TestServer & { token?: string };

  it('caps lengths and fixes defaults on create', async () => {
    srv = await startTestServer({ login: true });
    const res = await srv.app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: { authorization: `Bearer ${srv.token}` },
      payload: {
        title: 'T'.repeat(500),
        message: 'M'.repeat(5000),
        category: 'hacker-category',
        priority: 99,
        start: '2026-13-99'
      }
    });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item.title.length).toBeLessThanOrEqual(200);
    expect(item.message.length).toBeLessThanOrEqual(2000);
    expect(item.category).toBe('general');
    expect(item.priority).toBe(10);
    expect(item.start).toBeNull(); // invalid calendar date rejected
  }, 120000);

  it('keeps ordering stable after reorder', async () => {
    // Reorder requires the COMPLETE id list — collect every existing id.
    const existing = await srv.app.inject({
      method: 'GET',
      url: '/api/admin/announcements',
      headers: { authorization: `Bearer ${srv.token}` }
    });
    const existingIds: string[] = existing.json().map((a: { id: string }) => a.id);

    const ids: string[] = [];
    for (const title of ['C', 'A', 'B']) {
      const res = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { authorization: `Bearer ${srv.token}` },
        payload: { title }
      });
      ids.push(res.json().id);
    }
    // Reorder the full list: the 3 new items moved to the front (reversed).
    const reversed = [...ids].reverse();
    const fullList = [...reversed, ...existingIds];
    const ok = await srv.app.inject({
      method: 'POST',
      url: '/api/admin/announcements/reorder',
      headers: { authorization: `Bearer ${srv.token}` },
      payload: { ids: fullList }
    });
    expect(ok.statusCode).toBe(200);

    const list = await srv.app.inject({
      method: 'GET',
      url: '/api/admin/announcements',
      headers: { authorization: `Bearer ${srv.token}` }
    });
    const listedIds: string[] = list.json().map((a: { id: string }) => a.id);
    expect(listedIds.slice(0, reversed.length)).toEqual(reversed);
    expect(listedIds.slice(reversed.length)).toEqual(existingIds);
  });

  it('cleans up', async () => {
    await srv.cleanup();
  });
});
