// Laluan peranti kiosk (device-token auth): laporan perkakasan + streams penuh.

import type { FastifyInstance } from 'fastify';
import { licenseStatus } from '../license.js';
import { jsonError } from './helpers.js';
import type { RouteContext } from './context.js';

export function registerDeviceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store } = ctx;

  // Heartbeat + laporan perkakasan peranti kiosk (kamera USB dsb.).
  // Auth: device-token peranti (sama seperti paparan).
  app.post('/api/device/report', async (req, reply) => {
    const devToken = String(req.headers['x-device-token'] || '');
    if (!devToken) return jsonError(reply, 401, 'Token peranti diperlukan');
    const t = await store.getTenantByDeviceToken(devToken);
    if (!t) return jsonError(reply, 401, 'Token peranti tidak sah');
    const lic = licenseStatus(t);
    if (!lic.unlocked) return jsonError(reply, 403, lic.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
    const body = (req.body || {}) as { cameras?: unknown; dshow?: unknown };
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
    await store.saveHwReport(devToken, { cameras, dshow, at: Date.now() });
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
