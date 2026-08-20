// API cloud MasjidTV — multi-tenant, bentuk respon sama seperti server tempatan (pariti).
// Port of reference cloud/app.js to Fastify + Drizzle.
//
// Pembinaan aplikasi sahaja di sini — laluan dipecahkan kepada modul di
// ./routes/. Susunan pendaftaran hook/parser MESTI kekal seperti asal (lihat
// nota pada setiap blok) supaya gelagat tidak berubah.

import Fastify, { type FastifyInstance } from 'fastify';
import { UPLOAD_TYPES } from '@masjidtv/shared';
import { createCloudClient, applySchema } from '@masjidtv/db';
import { CloudStore } from './store.js';
import { bumpRev, registerSse } from './sse.js';
import { ASSETS } from './pages.generated.js';
import { jsonError, tenantFromRequest } from './routes/helpers.js';
import type { RouteContext } from './routes/context.js';
import { initErrorReporting } from './reporting.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSuperRoutes } from './routes/super.js';
import { registerPairingRoutes } from './routes/pairing.js';
import { registerDeviceRoutes } from './routes/device.js';

export async function createCloudApp(): Promise<FastifyInstance> {
  // Fail-fast: tanpa TURSO_URL di produksi, fallback fail tempatan akan 500
  // untuk setiap permintaan — lebih baik mati semasa init dengan mesej jelas.
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  if (isProd && !process.env.TURSO_URL) {
    throw new Error('TURSO_URL diperlukan — tetapkan pemboleh ubah persekitaran TURSO_URL sebelum deploy produksi');
  }
  const db = await createCloudClient(
    process.env.TURSO_URL || 'file:./cloud-data/masjidtv.db',
    process.env.TURSO_AUTH_TOKEN || ''
  );
  await applySchema(db);
  const store = new CloudStore(db.db);
  await store.seedSuperuser();

  // trustProxy: di Vercel, socket remote adalah IP LB dalaman — tanpa ini
  // semua pelanggan berkongsi bucket rate-limit yang sama (30 kegagalan
  // merata melumpuhkan login seluruh platform selama 15 minit).
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: true });
  const startedAt = Date.now();
  const ctx: RouteContext = { db: db.db, store, startedAt };

  // Pembersihan berkala: sesi pemadanan tamat tempoh + kaunter rate-limit
  // matang. Interval tidak akan menghalang proses serverless keluar.
  const purgeTimer = setInterval(() => {
    store.purgeExpired().catch(() => {});
  }, 60 * 60 * 1000);
  purgeTimer.unref?.();

  app.addHook('onClose', async () => {
    await db.close();
  });

  // SYNC SEGERA: setiap laluan TULIS /api/admin/* yang berjaya (2xx) untuk
  // sebuah tenant → bumpRev → SSE 'sync' kepada paparan. Hook onResponse
  // tunggal menggantikan bump manual pada setiap laluan (minimum damage).
  app.addHook('onResponse', async (req, reply) => {
    const m = req.method;
    if (m !== 'PUT' && m !== 'POST' && m !== 'PATCH' && m !== 'DELETE') return;
    if (!(req.url || '').startsWith('/api/admin/')) return;
    if (reply.statusCode >= 300) return;
    // Laluan yang tidak mengubah kandungan paparan — langkau.
    if (/\/api\/admin\/(password|license|events\/sync)$/.test(req.url || '')) return;
    try {
      const tenant = await tenantFromRequest(store, req);
      if (tenant) bumpRev(tenant.id);
    } catch { /* SSE gagal tidak boleh gagalkan balasan */ }
  });

  for (const ct of Object.keys(UPLOAD_TYPES)) {
    app.addContentTypeParser(ct, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body as Buffer);
    });
  }

  // --- pages & static assets (parity with reference cloud/app.js) -------

  const CSP = {
    display: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' blob: data: https: http:",
      "font-src 'self' data:",
      "connect-src 'self' https: http:",
      "frame-src http: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    admin: [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' blob: https: http:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    api: "default-src 'none'; frame-ancestors 'none'"
  };
  function cspFor(p: string): string {
    if (p === '/display') return CSP.display;
    if (p === '/admin' || p === '/guide') return CSP.admin;
    if (p === '/sw.js') {
      return [
        "default-src 'self'",
        "script-src 'self'",
        "connect-src 'self' https: http:",
        "img-src 'self' data: blob: https: http:",
        "media-src 'self' blob: data: https: http:"
      ].join('; ');
    }
    return CSP.api;
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=()');
    reply.header('Content-Security-Policy', cspFor(req.url.split('?')[0]));
  });

  function contentTypeFor(urlPath: string): string {
    if (urlPath.endsWith('.webmanifest')) return 'application/manifest+json';
    if (urlPath.endsWith('.png')) return 'image/png';
    if (urlPath.endsWith('.svg')) return 'image/svg+xml';
    if (urlPath.endsWith('.js')) return 'application/javascript';
    if (urlPath.endsWith('.css')) return 'text/css';
    return 'application/octet-stream';
  }

  // Embedded assets served before any route (base64 in pages.generated.ts).
  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url.split('?')[0];
    const b64 = ASSETS[urlPath];
    if (!b64) return;
    reply.header('Cache-Control', 'no-cache');
    reply.type(contentTypeFor(urlPath)).send(Buffer.from(b64, 'base64'));
  });

  // --- route registration (susunan mengikut app.ts asal) -----------------

  registerPageRoutes(app);
  registerAuthRoutes(app, ctx);
  registerPublicRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerSuperRoutes(app, ctx);
  registerPairingRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);

  // SSE untuk sync segera paparan (lihat sse.ts).
  registerSse(app, store);

  app.setNotFoundHandler((_req, reply) => jsonError(reply, 404, 'Tidak dijumpai'));
  app.setErrorHandler((err, _req, reply) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cloud] ralat:', msg);
    reply.status(500).send({ error: 'Ralat dalaman' });
  });

  // Pelaporan ralat ENV-GATED (C4) — hook onError selepas handler asal;
  // no-op sepenuhnya tanpa SENTRY_DSN (tiada dependency baru).
  initErrorReporting(app);

  return app;
}
