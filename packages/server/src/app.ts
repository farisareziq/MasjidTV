// Fastify app with full parity REST surface — port of reference server/index.js.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import {
  METHODS, getZonesGrouped, buildEventsPayload, syncEventsFor, dateKeyInZone,
  resolveQuranAnnouncements, content as builtinContent,
  UPLOAD_TYPES,
  publicSettings as buildPublicSettings, publicStream, buildTodayPayload,
  isAnnouncementActive,
  type Settings, type Stream
} from '@masjidtv/shared';
import { Store } from './store.js';
import { AnnouncementService } from './announcements.js';
import { StreamManager } from './streams.js';
import { applyCloudSync, cloudSyncEnabled } from './cloudsync.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = '1.0.0';

const CSP_DISPLAY = [
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
].join('; ');

const CSP_ADMIN = [
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
].join('; ');

export interface AppOptions {
  dataDir: string;
  publicDir: string;
  port?: number;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const store = await Store.open({ dataDir: opts.dataDir });
  const announcements = new AnnouncementService(store);
  const streams = new StreamManager(
    opts.dataDir,
    () => store.getSettings().streams,
    () => store.getSettings().media.ffmpegPath
  );

  // Had badan global kecil: auth berjalan SELEPAS badan dihurai, jadi had
  // besar global membenarkan sesiapa sahaja di LAN memaksa buffer 150MB
  // diperuntukkan sebelum 401. Laluan muat naik menaikkan hadnya sendiri.
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const tokens = new Map<string, number>();
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const PORT = opts.port || Number(process.env.PORT) || 3000;
  // Mod cloud-sync: laluan paparan tempatan dilumpuhkan (proksi cloud ambil alih).
  const cloudMode = cloudSyncEnabled();

  const settings = () => store.getSettings();
  const tz = () => settings().prayer.timezone || 'Asia/Kuala_Lumpur';

  app.addHook('onClose', async () => {
    // Hentikan relay ffmpeg supaya tiada proses encoder yatim selepas tutup.
    streams.stopAll();
    store.close();
  });

  // Accept raw media bodies for the upload endpoint (magic-byte validated).
  for (const ct of Object.keys(UPLOAD_TYPES)) {
    app.addContentTypeParser(ct, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body as Buffer);
    });
  }

  function loginLocked(ip: string): boolean {
    const e = loginAttempts.get(ip);
    return !!e && e.until > Date.now();
  }

  function recordLoginFailure(ip: string): { locked: boolean } {
    const now = Date.now();
    const e = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (e.until > now) return { locked: true };
    const count = e.count + 1;
    if (count >= 5) {
      loginAttempts.set(ip, { count: 0, until: now + 15 * 60 * 1000 });
      return { locked: true };
    }
    loginAttempts.set(ip, { count, until: 0 });
    return { locked: false };
  }

  function clearLoginFailures(ip: string): void {
    loginAttempts.delete(ip);
  }

  // Bandingkan kunci paparan secara selamat-masa (timing-safe) melalui
  // ringkasan SHA-256 panjang tetap.
  function safeEqualStr(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function requireDisplayKey(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
    const expected = settings().security?.displayKey;
    if (!expected) return done();
    const key = (req.headers['x-display-key'] as string) || (req.query as Record<string, string>).key || '';
    if (key && safeEqualStr(key, expected)) return done();
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = tokens.get(token);
    if (token && expiry && expiry >= Date.now()) return done();
    reply.status(401).send({ error: 'Kunci paparan tidak sah' });
  }

  function requireAuth(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = tokens.get(token);
    if (!token || !expiry || expiry < Date.now()) {
      if (expiry) tokens.delete(token);
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    done();
  }

  function jsonError(reply: FastifyReply, status: number, message: string): FastifyReply {
    return reply.status(status).send({ error: message });
  }

  // CSP via onRequest per route (parity with reference setCsp).
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url || '';
    if (url.startsWith('/display') || url === '/') reply.header('Content-Security-Policy', CSP_DISPLAY);
    else if (url.startsWith('/admin')) reply.header('Content-Security-Policy', CSP_ADMIN);
  });

  // Static uploads (raw file serving, no path traversal).
  app.register(import('@fastify/static'), {
    root: path.join(opts.dataDir, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false
  });

  // Static public files (display/admin/sw.js).
  app.register(import('@fastify/static'), {
    root: opts.publicDir,
    prefix: '/'
  });

  // Relay output (HLS segments) with no-cache headers.
  app.register(import('@fastify/static'), {
    root: path.join(opts.dataDir, 'relay'),
    prefix: '/relay/',
    decorateReply: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.m3u8') || filePath.endsWith('.ts')) {
        res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  });

  // Cloud sync mode (proxy + cache) — takes precedence when enabled. In this
  // mode the local display/admin routes below are NOT registered (Fastify
  // rejects duplicate method+url, unlike Express first-wins).
  applyCloudSync(app, opts.dataDir);

  // --- Public (display) endpoints ------------------------------------------

  app.get('/api/health', async (_req, reply) => {
    reply.send({ ok: true, service: 'masjidtv', version: VERSION, uptime: process.uptime(), now: new Date().toISOString() });
  });

  app.get('/api/methods', async (_req, reply) => reply.send(METHODS));
  app.get('/api/zones', async (_req, reply) => reply.send({ zones: getZonesGrouped() }));

  if (!cloudMode) {
    app.get('/api/settings', { preHandler: requireDisplayKey }, async (_req, reply) => {
      const pub = buildPublicSettings(settings(), { includeEventsSync: true });
      pub.events = buildEventsPayload((pub.events as Settings['events']) || [], new Date(), tz());
      pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);
      reply.send(pub);
    });

    app.get('/api/today', { preHandler: requireDisplayKey }, async (_req, reply) => {
      try {
        reply.send(await buildTodayPayload(settings()));
      } catch (err) {
        console.error('[api] /api/today failed:', err instanceof Error ? err.message : err);
        jsonError(reply, 500, 'Failed to compute prayer times');
      }
    });

    app.get('/api/slides', { preHandler: requireDisplayKey }, async (_req, reply) => {
      const active = announcements.listActive(new Date(), tz());
      const resolved = resolveQuranAnnouncements(active, dateKeyInZone(new Date(), tz()));
      reply.send({ announcements: resolved, builtin: resolved.length ? [] : builtinContent });
    });
  }

  // --- Admin auth -----------------------------------------------------------

  app.post('/api/admin/login', async (req, reply) => {
    const { password } = (req.body || {}) as { password?: string };
    const ip = req.ip || req.socket?.remoteAddress || 'x';
    if (loginLocked(ip)) {
      return jsonError(reply, 429, 'Terlalu banyak percubaan — cuba lagi selepas 15 minit');
    }
    if (!store.verifyPassword(password || '')) {
      recordLoginFailure(ip);
      return jsonError(reply, 401, 'Wrong password');
    }
    clearLoginFailures(ip);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, Date.now() + SESSION_TTL_MS);
    for (const [t, exp] of tokens) {
      if (exp < Date.now()) tokens.delete(t);
    }
    reply.send({ token });
  });

  app.get('/api/admin/status', { preHandler: requireAuth }, async (req, reply) => {
    const s = settings();
    const all = announcements.listAll();
    reply.send({
      version: VERSION,
      uptime: process.uptime(),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      screenUrl: `http://${req.hostname}:${PORT}/display` + (s.security?.displayKey ? `?key=${s.security.displayKey}` : ''),
      adminUrl: `http://${req.hostname}:${PORT}/admin`,
      counts: {
        announcements: all.length,
        activeAnnouncements: all.filter((a) => isAnnouncementActive(a, new Date(), tz())).length
      },
      mosque: s.mosque.name,
      language: s.display.language,
      prayerMethod: s.prayer.method,
      prayerSource: s.prayer.source,
      prayerZone: s.prayer.zone,
      eventsSync: s.eventsSync,
      audioEnabled: s.audio.enabled,
      streamCount: (s.streams || []).length,
      activeStreamCount: (s.streams || []).filter((x) => x.enabled).length,
      nextEvent: buildEventsPayload(s.events || [], new Date(), tz())[0] || null,
      adminPasswordFile: fs.existsSync(path.join(opts.dataDir, 'ADMIN_PASSWORD.txt'))
    });
  });

  app.get('/api/admin/streams', { preHandler: requireAuth }, async (_req, reply) => {
    const ok = await streams.checkFfmpeg();
    reply.send({ streams: streams.allStatus(), ffmpegOk: ok });
  });

  app.put('/api/admin/streams', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body || {}) as { streams?: unknown };
    if (!Array.isArray(body.streams)) return jsonError(reply, 400, 'Expected { streams: [...] }');
    store.updateSettings({ streams: body.streams });
    await streams.sync();
    reply.send({ streams: streams.allStatus() });
  });

  app.post('/api/admin/events/sync', { preHandler: requireAuth }, async (_req, reply) => {
    const result = await syncEventsFor(settings(), (patch) => {
      store.updateSettings(patch as Record<string, unknown>);
      return Promise.resolve();
    }, true);
    reply.send(result);
  });

  app.get('/api/admin/settings', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send(settings());
  });

  app.put('/api/admin/settings', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const before = settings().prayer.zone;
      const wasEnabled = settings().eventsSync.enabled;
      const updated = store.updateSettings((req.body || {}) as Record<string, unknown>);
      streams.resetFfmpegCheck();
      await streams.sync();
      const after = settings().prayer.zone;
      const nowEnabled = settings().eventsSync.enabled;
      if (before !== after || (!wasEnabled && nowEnabled)) {
        syncEventsFor(settings(), (patch) => {
          store.updateSettings(patch as Record<string, unknown>);
          return Promise.resolve();
        }, false).catch(() => {});
      }
      reply.send(updated);
    } catch (err) {
      console.error('[api] settings update failed:', err);
      jsonError(reply, 500, 'Failed to save settings');
    }
  });

  app.post('/api/admin/password', { preHandler: requireAuth }, async (req, reply) => {
    const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
    if (!store.verifyPassword(currentPassword || '')) {
      return jsonError(reply, 401, 'Current password is incorrect');
    }
    if (!store.changePassword(newPassword || '')) {
      return jsonError(reply, 400, 'New password must be at least 6 characters');
    }
    // Tarik balik semua sesi sedia ada — token bocor tidak kekal sah selepas
    // penukaran kata laluan.
    tokens.clear();
    try {
      fs.unlinkSync(path.join(opts.dataDir, 'ADMIN_PASSWORD.txt'));
    } catch {
      /* may not exist */
    }
    reply.send({ ok: true });
  });

  app.get('/api/admin/announcements', { preHandler: requireAuth }, async (_req, reply) => {
    const all = announcements.listAll().map((a) => ({ ...a, status: isAnnouncementActive(a, new Date(), tz()) ? 'active' : 'inactive' }));
    reply.send(all);
  });

  app.post('/api/admin/announcements', { preHandler: requireAuth }, async (req, reply) => {
    const item = announcements.create((req.body || {}) as Record<string, unknown>);
    reply.status(201).send(item);
  });

  app.put('/api/admin/announcements/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = announcements.update(id, (req.body || {}) as Record<string, unknown>);
    if (!item) return jsonError(reply, 404, 'Announcement not found');
    reply.send(item);
  });

  app.delete('/api/admin/announcements/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!announcements.remove(id)) return jsonError(reply, 404, 'Announcement not found');
    reply.send({ ok: true });
  });

  app.post('/api/admin/announcements/reorder', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body || {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : [];
    if (!announcements.reorder(ids)) return jsonError(reply, 400, 'Senarai susunan tidak lengkap');
    reply.send({ ok: true });
  });

  // Media upload (raw body with magic-byte validation).
  app.post('/api/admin/upload', { preHandler: requireAuth, bodyLimit: 150 * 1024 * 1024 }, async (req, reply) => {
    const contentType = req.headers['content-type'] || '';
    const type = UPLOAD_TYPES[contentType];
    if (!type) return jsonError(reply, 400, 'Unsupported file type');

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!buffer.length) return jsonError(reply, 400, 'No image data');
    if (!type.magic(buffer)) return jsonError(reply, 400, `File is not a valid ${type.kind}`);

    const uploadsDir = path.join(opts.dataDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    reply.send({ url: `/uploads/${filename}`, kind: type.kind });
  });

  // --- Pages ----------------------------------------------------------------

  if (!cloudMode) {
    app.get('/', async (_req, reply) => reply.redirect('/display'));
    app.get('/display', (_req, reply) => {
      reply.type('text/html').sendFile('display.html');
    });
    app.get('/admin', (_req, reply) => {
      reply.type('text/html').sendFile('admin.html');
    });
    app.get('/sw.js', (_req, reply) => {
      reply.header('Cache-Control', 'no-cache, no-store').type('application/javascript').sendFile('sw.js');
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (cloudMode && req.url.startsWith('/api/admin')) {
      reply.status(404).send({ error: 'Admin hanya di cloud' });
      return;
    }
    reply.status(404).send({ error: 'Not found' });
  });

  // Expose managers for the startup sequence (streams/events sync) and tests.
  app.decorate('masjidStore', store);
  app.decorate('masjidStreams', streams);
  app.decorate('masjidAnnouncements', announcements);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    masjidStore: Store;
    masjidStreams: StreamManager;
    masjidAnnouncements: AnnouncementService;
  }
}

export async function startServer(opts: AppOptions): Promise<FastifyInstance> {
  const app = await buildApp(opts);
  const PORT = opts.port || Number(process.env.PORT) || 3000;
  await app.listen({ port: PORT, host: '0.0.0.0' });

  // Pariti rujukan: semak ffmpeg + sync relay, dan sync acara Islam pada
  // permulaan (plus ulang setiap 12 jam).
  if (!cloudSyncEnabled()) {
    app.masjidStreams.checkFfmpeg().then((ok) => {
      console.log(`  ffmpeg: ${ok ? 'available' : 'NOT FOUND — RTSP/RTMP/ONVIF streams need ffmpeg'}`);
      app.masjidStreams.sync();
    });
    syncEventsFor(app.masjidStore.getSettings(), (patch) => {
      app.masjidStore.updateSettings(patch as Record<string, unknown>);
      return Promise.resolve();
    }, false).then((r) => {
      console.log(`[jakim] events sync: ${r.ok ? `ok (${r.synced} tarikh)` : r.message}`);
    }).catch((err) => {
      console.error('[jakim] events sync gagal:', err instanceof Error ? err.message : err);
    });
    setInterval(() => {
      syncEventsFor(app.masjidStore.getSettings(), (patch) => {
        app.masjidStore.updateSettings(patch as Record<string, unknown>);
        return Promise.resolve();
      }, false).catch(() => {});
    }, 12 * 60 * 60 * 1000).unref?.();
  }

  return app;
}
