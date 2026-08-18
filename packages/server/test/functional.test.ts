// FUNCTIONAL TESTING — objective: validate business requirements — for each
// MasjidTV feature the public API must return exactly what the spec promises.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, stubJakimFetch, type TestServer } from './helpers.js';

describe('Functional Testing / feature requirements', () => {
  let srv: TestServer & { token?: string };
  let token: string;
  let restoreFetch: () => void;

  beforeAll(async () => {
    restoreFetch = stubJakimFetch(); // keep /api/today offline & deterministic
    srv = await startTestServer({ login: true });
    token = srv.token!;
  }, 120000);

  afterAll(async () => {
    restoreFetch();
    await srv.cleanup();
  });

  describe('FR1 — digital prayer times display', () => {
    it('GET /api/today returns today times, iqamah, hijri, next prayer', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/today',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.timeZone).toBe('Asia/Kuala_Lumpur');
      expect(body.source).toBe('jakim'); // stubbed JAKIM week is used
      for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
        expect(body.prayers[key].time).toMatch(/^\d{2}:\d{2}$/);
        expect(body.iqamah[key].time).toMatch(/^\d{2}:\d{2}$/);
      }
      expect(body.next).not.toBeNull();
      expect(body.next.time.ms).toBeGreaterThan(Date.parse(body.now));
    });

    it('serves the JAKIM schedule for the requested day', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/today',
        headers: { 'x-display-key': srv.displayKey }
      });
      const body = res.json();
      // Times come straight from the stubbed e-Solat week (zone WLY01).
      expect(body.prayers.fajr.time).toBe('05:55');
      expect(body.prayers.maghrib.time).toBe('19:27');
    });

    it('iqamah defaults to azan + offset minutes', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/today',
        headers: { 'x-display-key': srv.displayKey }
      });
      const body = res.json();
      for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
        expect(body.iqamah[key].ms - body.prayers[key].ms).toBe(10 * 60000);
      }
    });

    it('honours an explicit iqamah time over the offset', async () => {
      await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { prayer: { iqamah: { maghrib: '20:30' } } }
      });
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/today',
        headers: { 'x-display-key': srv.displayKey }
      });
      const body = res.json();
      expect(body.iqamah.maghrib.time).toBe('20:30');
      expect(body.iqamah.maghrib.ms - body.prayers.maghrib.ms).not.toBe(10 * 60000);
    });
  });

  describe('FR2 — mosque identity', () => {
    it('public settings expose the mosque profile', async () => {
      await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { mosque: { name: 'Masjid Al-Falah', tagline: 'Makmur Bersama' } }
      });
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.json().mosque.name).toBe('Masjid Al-Falah');
      expect(res.json().mosque.tagline).toBe('Makmur Bersama');
    });

    it('public settings never leak admin auth material', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      const body = res.json();
      expect(body.auth).toBeUndefined();
      expect(body.security).toBeUndefined();
    });
  });

  describe('FR3 — announcement slides', () => {
    it('an active announcement appears on /api/slides; a deactivated one does not', async () => {
      const created = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Kelas Tahfiz', message: 'Setiap pagi' }
      });
      const id = created.json().id;

      const withActive = await srv.app.inject({
        method: 'GET',
        url: '/api/slides',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(withActive.json().announcements.some((a: { id: string }) => a.id === id)).toBe(true);
      expect(withActive.json().builtin).toHaveLength(0); // builtin only when empty

      await srv.app.inject({
        method: 'PUT',
        url: `/api/admin/announcements/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { active: false }
      });

      const afterDeactivate = await srv.app.inject({
        method: 'GET',
        url: '/api/slides',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(afterDeactivate.json().announcements.some((a: { id: string }) => a.id === id)).toBe(false);
    });

    it('quran-category announcements are auto-filled with the daily verse', async () => {
      const created = await srv.app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Ayat Hari Ini', category: 'quran' }
      });
      const slides = await srv.app.inject({
        method: 'GET',
        url: '/api/slides',
        headers: { 'x-display-key': srv.displayKey }
      });
      const item = slides.json().announcements.find((a: { id: string }) => a.id === created.json().id);
      expect(item.arabic.length).toBeGreaterThan(0);
      expect(item.ref).toMatch(/ \d+:\d+$/);
    });
  });

  describe('FR4 — Islamic events countdown', () => {
    it('public settings include computed event countdowns', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      const events = res.json().events;
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.daysLeft).toBeGreaterThanOrEqual(0);
      }
      const daysLeft = events.map((e: { daysLeft: number }) => e.daysLeft);
      expect([...daysLeft].sort((a, b) => a - b)).toEqual(daysLeft);
    });
  });

  describe('FR5 — live media streams', () => {
    it('relay streams are exposed with a local HLS url; youtube streams with an id', async () => {
      await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/streams',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          streams: [
            { name: 'Kamera', type: 'rtsp', url: 'rtsp://192.168.1.50:554/stream', duration: 60, enabled: true },
            { name: 'YouTube Live', type: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 60, enabled: true }
          ]
        }
      });
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      const streams = res.json().streams;
      expect(streams).toHaveLength(2);
      expect(streams[0].kind).toBe('relay');
      expect(streams[0].hlsUrl).toBe(`/relay/${streams[0].id}/index.m3u8`);
      expect(streams[1].kind).toBe('youtube');
      expect(streams[1].youtubeId).toBe('dQw4w9WgXcQ');
    });

    it('camera credentials embedded in the stream URL are stripped from public output', async () => {
      await srv.app.inject({
        method: 'PUT',
        url: '/api/admin/streams',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          streams: [{ name: 'Kamera Rahsia', type: 'rtsp', url: 'rtsp://admin:secret123@192.168.1.60:554/stream', duration: 60, enabled: true }]
        }
      });
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { 'x-display-key': srv.displayKey }
      });
      expect(res.json().streams[0].url).not.toContain('secret123');
      expect(res.json().streams[0].url).not.toContain('admin:');
    });
  });

  describe('FR6 — admin dashboard status', () => {
    it('GET /api/admin/status summarizes the running system', async () => {
      const res = await srv.app.inject({
        method: 'GET',
        url: '/api/admin/status',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mosque).toBe('Masjid Al-Falah');
      expect(body.screenUrl).toContain('/display');
      expect(body.adminUrl).toContain('/admin');
      expect(body.counts.announcements).toBeGreaterThan(0);
      expect(body.nextEvent).not.toBeNull();
    });
  });
});
