// Laluan peranti kiosk (device-token auth): laporan perkakasan + streams penuh.

import type { FastifyInstance } from 'fastify';
import { licenseStatus } from '../license.js';
import { jsonError } from './helpers.js';
import type { RouteContext } from './context.js';

export function registerDeviceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store } = ctx;

  // Heartbeat + laporan perkakasan peranti kiosk (kamera USB dsb.).
  // Auth: device-token peranti (sama seperti paparan).
  // Medan `errors` PILIHAN (C4): ringkasan ralat kiosk (crash renderer dsb.).
  // Had 10 entri × 200 aksara supaya JSON keseluruhan kekal di bawah had
  // 4000 aksara saveHwReport (JSON terpotong = hwReport tidak sah dibaca).
  app.post('/api/device/report', async (req, reply) => {
    const devToken = String(req.headers['x-device-token'] || '');
    if (!devToken) return jsonError(reply, 401, 'Token peranti diperlukan');
    const t = await store.getTenantByDeviceToken(devToken);
    if (!t) return jsonError(reply, 401, 'Token peranti tidak sah');
    const lic = licenseStatus(t);
    if (!lic.unlocked) return jsonError(reply, 403, lic.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
    const body = (req.body || {}) as { cameras?: unknown; dshow?: unknown; errors?: unknown };
    const cameras = Array.isArray(body.cameras)
      ? body.cameras.slice(0, 10).map((c) => {
          const o = (c || {}) as { id?: string; name?: string; status?: string };
          return {
            id: String(o.id || '').slice(0, 120),
            name: String(o.name || '').slice(0, 80),
            status: o.status === 'OK' ? 'OK' : o.status === 'Error' ? 'Error' : 'Unknown'
          };
        })
      : [];
    const dshow = Array.isArray(body.dshow)
      ? body.dshow.slice(0, 10).map((c) => String((c as { name?: string })?.name || '').slice(0, 100)).filter(Boolean)
      : [];
    // Ralat pilihan: maksimum 10 entri {at, message} × 200 aksara — dipotong
    // agresif supaya payload tidak boleh diguna untuk sembunyi data & JSON
    // tersimpan kekal di bawah had lajur (lihat komen fungsi di atas).
    const errors = Array.isArray(body.errors)
      ? body.errors.slice(0, 10).map((e) => {
          const o = (e || {}) as { at?: unknown; message?: unknown };
          return {
            at: Number(o.at) || Date.now(),
            message: String(o.message || '').slice(0, 200)
          };
        }).filter((e) => e.message)
      : [];
    const report: { cameras: unknown[]; dshow: unknown[]; at: number; errors?: unknown[] } = { cameras, dshow, at: Date.now() };
    if (errors.length) report.errors = errors;
    // Pastikan JSON muat dalam had 4000 aksara saveHwReport (JSON terpotong
    // = hwReport tidak sah dibaca). Kurangkan entri ralat dahulu (paling
    // besar), kemudian kamera/dshow, sehingga muat — kes tipikal jauh di
    // bawah had, jadi gelung ini hampir tidak pernah berjalan.
    while (JSON.stringify(report).length > 3500) {
      if (Array.isArray(report.errors) && report.errors.length > 1) report.errors.pop();
      else if (report.cameras.length > 0) report.cameras.pop();
      else if (report.dshow.length > 0) report.dshow.pop();
      else break;
    }
    await store.saveHwReport(devToken, report);
    reply.send({ ok: true });
  });

  // Streams PENUH untuk kiosk mini PC (termasuk mirrorUrl stream-key FB dan
  // nama peranti dshow) — relay ffmpeg lokal memerlukan nilai sebenar yang
  // tidak didedahkan dalam /api/settings awam. Auth device-token.
  app.get('/api/device/streams', async (req, reply) => {
    const devToken = String(req.headers['x-device-token'] || '');
    if (!devToken) return jsonError(reply, 401, 'Token peranti diperlukan');
    const t = await store.getTenantByDeviceToken(devToken);
    if (!t) return jsonError(reply, 401, 'Token peranti tidak sah');
    const lic = licenseStatus(t);
    if (!lic.unlocked) return jsonError(reply, 403, lic.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
    reply.send({ streams: t.settings.streams || [] });
  });
}
