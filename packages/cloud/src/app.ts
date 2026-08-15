// API cloud MasjidTV — multi-tenant, bentuk respon sama seperti server tempatan (pariti).
// Port of reference cloud/app.js to Fastify + Drizzle.

import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { put, issueSignedToken, presignUrl, head } from '@vercel/blob';
import {
  METHODS, getZonesGrouped, buildEventsPayload, syncEventsFor, dateKeyInZone,
  resolveQuranAnnouncements, content as builtinContent,
  UPLOAD_TYPES,
  publicSettings as buildPublicSettings, publicStream, buildTodayPayload,
  sanitizeAnnouncementCreate, applyAnnouncementPatch,
  sortAnnouncements, isAnnouncementActive,
  type Settings, type Stream
} from '@masjidtv/shared';
import { createCloudClient, applySchema, type CloudDatabase } from '@masjidtv/db';
import { CloudStore, type TenantRow } from './store.js';
import {
  signToken, verifyToken, hashPassword, comparePassword, checkRateLimit, recordFailure, clearFailures
} from './auth.js';
import { verifyLicense, licenseStatus, type LicenseStatus } from './license.js';

const PAIR_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Types for request decorations.
interface TenantReq {
  tenant?: TenantRow;
  license?: LicenseStatus;
  userId?: string;
  superuser?: unknown;
}

export async function createCloudApp(): Promise<FastifyInstance> {
  // Fail-fast: tanpa TURSO_URL di produksi, fallback fail tempatan akan 500
  // untuk setiap permintaan — lebih baik mati semasa init dengan mesej jelas.
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  if (isProd && !process.env.TURSO_URL) {
    throw new Error('TURSO_URL diperlukan — tetapkan pemboleh ubah persekitaran TURSO_URL sebelum deploy produksi');
  }
  const db = createCloudClient(
    process.env.TURSO_URL || 'file:./cloud-data/masjidtv.db',
    process.env.TURSO_AUTH_TOKEN || ''
  );
  applySchema(db);
  const store = new CloudStore(db.db);
  await store.seedSuperuser();

  const app = Fastify({ logger: false, bodyLimit: 150 * 1024 * 1024 });
  const startedAt = Date.now();

  app.addHook('onClose', async () => {
    await db.close();
  });

  for (const ct of Object.keys(UPLOAD_TYPES)) {
    app.addContentTypeParser(ct, { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body as Buffer);
    });
  }

  function jsonError(reply: FastifyReply, status: number, message: string, code?: string): FastifyReply {
    return reply.status(status).send(code ? { error: message, code } : { error: message });
  }

  // --- tenant resolution -------------------------------------------------

  async function tenantFromRequest(req: FastifyRequest): Promise<TenantRow | null> {
    const key = req.headers['x-tenant-key'];
    if (key) {
      const byKey = await store.getTenantByApiKey(String(key));
      if (byKey) return byKey;
    }
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = verifyToken(token);
    if (payload && payload.role === 'admin' && payload.tid) {
      const t = await store.getTenant(payload.tid);
      if (t) return t;
    }
    const devToken = req.headers['x-device-token'];
    if (devToken) {
      const t = await store.getTenantByDeviceToken(String(devToken));
      if (t) return t;
    }
    return null;
  }

  async function requireTenant(req: FastifyRequest, reply: FastifyReply): Promise<TenantRow | null> {
    const tenant = await tenantFromRequest(req);
    if (!tenant) {
      jsonError(reply, 401, 'Kunci tenant atau sesi tidak sah');
      return null;
    }
    const lic = licenseStatus(tenant);
    if (!lic.unlocked) {
      jsonError(reply, 403, lic.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
      return null;
    }
    (req as FastifyRequest & TenantReq).tenant = tenant;
    (req as FastifyRequest & TenantReq).license = lic;
    return tenant;
  }

  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<TenantRow | null> {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'admin' || !payload.tid) {
      jsonError(reply, 401, 'Sesi tidak sah');
      return null;
    }
    const user = await store.getUserById(payload.uid);
    const tenant = await store.getTenant(payload.tid);
    if (!user || user.tenantId !== payload.tid || user.active !== 1 || Number(user.tokenVersion || 0) !== Number(payload.v || 0)) {
      jsonError(reply, 401, 'Sesi tidak sah');
      return null;
    }
    if (!tenant) {
      jsonError(reply, 401, 'Tenant tidak wujud');
      return null;
    }
    const lic = licenseStatus(tenant);
    if (!lic.unlocked) {
      jsonError(reply, 403, lic.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
      return null;
    }
    (req as FastifyRequest & TenantReq).tenant = tenant;
    (req as FastifyRequest & TenantReq).userId = user.id;
    (req as FastifyRequest & TenantReq).license = lic;
    return tenant;
  }

  async function requireSuperuser(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superuser') {
      jsonError(reply, 401, 'Sesi superuser tidak sah');
      return false;
    }
    const su = await store.getSuperuser('admin');
    if (!su || su.id !== payload.uid) {
      jsonError(reply, 401, 'Sesi superuser tidak sah');
      return false;
    }
    if (Number(su.tokenVersion || 0) !== Number(payload.v || 0)) {
      jsonError(reply, 401, 'Sesi superuser tidak sah');
      return false;
    }
    if (su.mustChangePin === 1) {
      jsonError(reply, 403, 'PIN perlu ditukar dahulu', 'PIN_CHANGE_REQUIRED');
      return false;
    }
    return true;
  }

  function ipOf(req: FastifyRequest): string {
    return req.ip || req.socket?.remoteAddress || 'x';
  }

  // --- auth endpoints ----------------------------------------------------

  app.post('/api/auth/superuser/login', async (req, reply) => {
    const { username, pin } = (req.body || {}) as { username?: string; pin?: string };
    const ip = ipOf(req);
    const key = `su:${ip}:${String(username || '')}`;
    const ipKey = `su-ip:${ip}`;
    const [rl, ipRl] = await Promise.all([checkRateLimit(db.db, key), checkRateLimit(db.db, ipKey)]);
    if (rl.locked || ipRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan. Cuba lagi selepas 15 minit.');
    const su = await store.getSuperuser(String(username || ''));
    const ok = su && (await comparePassword(String(pin || ''), su.pinHash));
    if (!ok) {
      await recordFailure(db.db, key);
      await recordFailure(db.db, ipKey, 10, 15 * 60 * 1000);
      return jsonError(reply, 401, 'Username atau PIN salah');
    }
    await clearFailures(db.db, key);
    const token = signToken({ userId: su.id, tenantId: null, role: 'superuser', version: su.tokenVersion || 0 });
    reply.send({ token, role: 'superuser', mustChangePin: su.mustChangePin === 1, username: su.username });
  });

  app.post('/api/auth/superuser/pin', async (req, reply) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superuser') return jsonError(reply, 401, 'Sesi superuser tidak sah');
    const su = await store.getSuperuser('admin');
    if (!su || su.id !== payload.uid) return jsonError(reply, 401, 'Sesi superuser tidak sah');
    const { pin } = (req.body || {}) as { pin?: string };
    if (String(pin || '').length < 8) return jsonError(reply, 400, 'PIN mesti sekurang-kurangnya 8 aksara');
    await store.setSuperuserPin(su.id, await hashPassword(String(pin)));
    const next = await store.getSuperuser('admin');
    const nextToken = signToken({ userId: next.id, tenantId: null, role: 'superuser', version: next.tokenVersion || 0 });
    reply.send({ ok: true, token: nextToken });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body || {}) as { username?: string; password?: string };
    const ip = ipOf(req);
    const key = `login:${ip}:${String(username || '')}`;
    const ipKey = `login-ip:${ip}`;
    const [rl, ipRl] = await Promise.all([checkRateLimit(db.db, key), checkRateLimit(db.db, ipKey)]);
    if (rl.locked || ipRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan. Cuba lagi selepas 15 minit.');
    const user = await store.getUserByUsername(String(username || ''));
    const ok = user && user.active === 1 && (await comparePassword(String(password || ''), user.passwordHash));
    if (!ok) {
      await recordFailure(db.db, key);
      await recordFailure(db.db, ipKey, 30, 15 * 60 * 1000);
      return jsonError(reply, 401, 'Username atau kata laluan salah');
    }
    await clearFailures(db.db, key);
    const token = signToken({ userId: user.id, tenantId: user.tenantId, role: 'admin', version: user.tokenVersion || 0 });
    reply.send({ token, role: 'admin', username: user.username, name: user.name });
  });

  app.get('/api/health', async (_req, reply) => {
    reply.send({ ok: true, service: 'masjidtv-cloud', version: '1.0.0', uptime: (Date.now() - startedAt) / 1000, now: new Date().toISOString() });
  });

  // --- display (tenant key) ---------------------------------------------

  app.get('/api/settings', async (req, reply) => {
    const tenant = await requireTenant(req, reply);
    if (!tenant) return;
    const pub = buildPublicSettings(tenant.settings);
    pub.events = buildEventsPayload((pub.events as Settings['events']) || [], new Date(), tenant.settings.prayer.timezone);
    pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);
    reply.send(pub);
  });

  app.get('/api/today', async (req, reply) => {
    const tenant = await requireTenant(req, reply);
    if (!tenant) return;
    try {
      reply.send(await buildTodayPayload(tenant.settings));
    } catch (err) {
      console.error('[cloud] /api/today:', err instanceof Error ? err.message : err);
      jsonError(reply, 500, 'Gagal mengira waktu solat');
    }
  });

  app.get('/api/slides', async (req, reply) => {
    const tenant = await requireTenant(req, reply);
    if (!tenant) return;
    const all = await store.listAnnouncements(tenant.id);
    const nowDate = new Date();
    const tz = tenant.settings.prayer.timezone;
    const todayKey = dateKeyInZone(nowDate, tz);
    const active = sortAnnouncements(all.filter((a) => isAnnouncementActive(a, nowDate, tz)));
    const announcements = resolveQuranAnnouncements(active, todayKey);
    reply.send({ announcements, builtin: announcements.length ? [] : builtinContent });
  });

  app.get('/api/zones', async (_req, reply) => reply.send({ zones: getZonesGrouped() }));
  app.get('/api/methods', async (_req, reply) => reply.send(METHODS));

  // --- admin (mosque) ----------------------------------------------------

  app.get('/api/admin/status', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const all = await store.listAnnouncements(tenant.id);
    const settings = tenant.settings;
    const nowDate = new Date();
    const tz = settings.prayer.timezone;
    const activeCount = all.filter((a) => isAnnouncementActive(a, nowDate, tz)).length;
    const events = buildEventsPayload(settings.events || [], nowDate, tz);
    reply.send({
      version: '1.0.0',
      uptime: (Date.now() - startedAt) / 1000,
      startedAt: new Date(startedAt).toISOString(),
      screenUrl: `${req.protocol}://${req.headers.host}/display?key=${tenant.apiKey}`,
      adminUrl: `${req.protocol}://${req.headers.host}/admin`,
      counts: { announcements: all.length, activeAnnouncements: activeCount },
      mosque: settings.mosque.name,
      language: settings.display.language,
      prayerMethod: settings.prayer.method,
      prayerSource: settings.prayer.source,
      prayerZone: settings.prayer.zone,
      eventsSync: settings.eventsSync,
      audioEnabled: settings.audio.enabled,
      streamCount: (settings.streams || []).length,
      activeStreamCount: (settings.streams || []).filter((s) => s.enabled).length,
      nextEvent: events[0] || null,
      license: (req as FastifyRequest & TenantReq).license,
      adminPasswordFile: false
    });
  });

  app.get('/api/admin/settings', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    reply.send(tenant.settings);
  });

  app.put('/api/admin/settings', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    try {
      const before = tenant.settings.prayer.zone;
      const wasEnabled = tenant.settings.eventsSync.enabled;
      const updated = await store.updateSettings(tenant.id, (req.body || {}) as Record<string, unknown>);
      if (before !== updated!.prayer.zone || (!wasEnabled && updated!.eventsSync.enabled)) {
        syncEventsFor(updated!, (patch) => {
          store.updateSettings(tenant.id, patch as Record<string, unknown>);
          return Promise.resolve();
        }, false).catch(() => {});
      }
      reply.send(updated);
    } catch (err) {
      jsonError(reply, 500, 'Gagal menyimpan tetapan');
    }
  });

  app.get('/api/admin/announcements', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const all = await store.listAnnouncements(tenant.id);
    const tz = tenant.settings.prayer.timezone;
    const nowDate = new Date();
    const withStatus = sortAnnouncements(all).map((a) => ({
      ...a,
      status: isAnnouncementActive(a, nowDate, tz) ? 'active' : 'inactive'
    }));
    reply.send(withStatus);
  });

  app.post('/api/admin/announcements', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const input = (req.body || {}) as Record<string, unknown>;
    const all = await store.listAnnouncements(tenant.id);
    const item = sanitizeAnnouncementCreate(input);
    item.sortOrder = all.reduce((m, a) => Math.max(m, Number(a.sortOrder) || 0), 0) + 1;
    const saved = await store.addAnnouncement(tenant.id, item);
    reply.status(201).send(saved);
  });

  app.put('/api/admin/announcements/:id', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const { id } = req.params as { id: string };
    const existing = await store.getAnnouncement(tenant.id, id);
    if (!existing) return jsonError(reply, 404, 'Pengumuman tidak dijumpai');
    const input = (req.body || {}) as Record<string, unknown>;
    const item = applyAnnouncementPatch(existing, input);
    await store.updateAnnouncement(tenant.id, id, item);
    reply.send(item);
  });

  app.delete('/api/admin/announcements/:id', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    await store.deleteAnnouncement(tenant.id, (req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.post('/api/admin/announcements/reorder', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const body = (req.body || {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map((x) => String(x)) : [];
    const all = await store.listAnnouncements(tenant.id);
    const byId = new Map(all.map((a) => [a.id, a]));
    if (ids.length !== all.length || ids.some((id) => !byId.has(id))) return jsonError(reply, 400, 'Senarai susunan tidak lengkap');
    for (let i = 0; i < ids.length; i++) {
      const a = byId.get(ids[i])!;
      a.sortOrder = i;
      await store.updateAnnouncement(tenant.id, a.id, a);
    }
    reply.send({ ok: true });
  });

  // Media upload (direct to Blob if configured, else local fs).
  app.post('/api/admin/upload', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const contentType = req.headers['content-type'] || '';
    const type = UPLOAD_TYPES[contentType];
    if (!type) return jsonError(reply, 400, 'Jenis fail tidak disokong');
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!buffer.length) return jsonError(reply, 400, 'Tiada data');
    if (!type.magic(buffer)) return jsonError(reply, 400, `Fail bukan ${type.kind} sah`);
    const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    const blobToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (blobToken) {
      try {
        const { url } = await put(filename, buffer, { access: 'public', token: blobToken });
        await store.addMedia(tenant.id, { filename, kind: type.kind });
        return reply.send({ url, kind: type.kind });
      } catch (err) {
        return jsonError(reply, 500, 'Gagal muat naik ke Blob');
      }
    }
    return jsonError(reply, 400, 'Blob tidak dikonfigurasi');
  });

  app.post('/api/admin/upload-url', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const blobToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) return jsonError(reply, 400, 'Blob tidak dikonfigurasi');
    const { contentType } = (req.body || {}) as { contentType?: string };
    const type = UPLOAD_TYPES[contentType || ''];
    if (!type) return jsonError(reply, 400, 'Jenis fail tidak disokong');
    const pathname = `media/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    try {
      const signedToken = await issueSignedToken({
        token: blobToken, pathname, operations: ['put'],
        allowedContentTypes: [contentType!], maximumSizeInBytes: 500 * 1024 * 1024
      });
      const { presignedUrl } = await presignUrl(signedToken, {
        operation: 'put', pathname, access: 'public', allowedContentTypes: [contentType!], addRandomSuffix: false
      });
      reply.send({ presignedUrl, pathname, kind: type.kind });
    } catch (err) {
      jsonError(reply, 500, 'Gagal sediakan muat naik');
    }
  });

  app.post('/api/admin/upload-confirm', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const blobToken = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
    const { pathname, kind } = (req.body || {}) as { pathname?: string; kind?: string };
    if (!blobToken || !String(pathname || '').startsWith('media/')) return jsonError(reply, 400, 'Parameter tidak sah');
    try {
      const blob = await head(String(pathname), { token: blobToken });
      const mediaKind = ['image', 'video', 'audio'].includes(kind || '') ? kind : 'video';
      await store.addMedia(tenant.id, { filename: String(pathname), kind: mediaKind! });
      reply.send({ url: blob.url, kind: mediaKind });
    } catch (err) {
      jsonError(reply, 500, 'Gagal sahkan muat naik');
    }
  });

  app.post('/api/admin/events/sync', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const result = await syncEventsFor(tenant.settings, (patch) => {
      store.updateSettings(tenant.id, patch as Record<string, unknown>);
      return Promise.resolve();
    }, true);
    reply.send(result);
  });

  app.get('/api/admin/streams', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const streams = (tenant.settings.streams || []).map((s) => ({
      id: s.id, name: s.name, type: s.type, url: s.url, duration: s.duration, enabled: s.enabled,
      status: s.enabled ? 'configured' : 'disabled',
      hlsUrl: ['rtsp', 'rtmp', 'onvif'].includes(s.type) ? `/relay/${s.id}/index.m3u8` : null
    }));
    reply.send({ streams, ffmpegOk: true });
  });

  app.put('/api/admin/streams', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const body = (req.body || {}) as { streams?: unknown };
    if (!Array.isArray(body.streams)) return jsonError(reply, 400, 'Dijangka { streams: [...] }');
    const updated = await store.updateSettings(tenant.id, { streams: body.streams });
    reply.send({
      streams: (updated!.streams || []).map((s) => ({
        id: s.id, name: s.name, type: s.type, url: s.url, duration: s.duration, enabled: s.enabled,
        status: s.enabled ? 'configured' : 'disabled',
        hlsUrl: ['rtsp', 'rtmp', 'onvif'].includes(s.type) ? `/relay/${s.id}/index.m3u8` : null
      }))
    });
  });

  app.post('/api/admin/password', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const userId = (req as FastifyRequest & TenantReq).userId!;
    const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
    const user = await store.getUserById(userId);
    if (!user || !(await comparePassword(String(currentPassword || ''), user.passwordHash))) {
      return jsonError(reply, 401, 'Kata laluan semasa salah');
    }
    if (String(newPassword || '').length < 6) return jsonError(reply, 400, 'Kata laluan baharu mesti sekurang-kurangnya 6 aksara');
    await store.resetUserPassword(tenant.id, userId, String(newPassword));
    const updated = await store.getUserById(userId);
    const token = signToken({ userId: updated.id, tenantId: updated.tenantId, role: 'admin', version: updated.tokenVersion || 0 });
    reply.send({ ok: true, token });
  });

  app.get('/api/admin/license', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    reply.send({ ...(req as FastifyRequest & TenantReq).license, apiKey: tenant.apiKey });
  });

  app.post('/api/admin/license', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const { code } = (req.body || {}) as { code?: string };
    const verified = verifyLicense(String(code || '').trim());
    if (!verified.ok || verified.tenantId !== tenant.id) {
      return jsonError(reply, 400, verified.ok ? 'Kod lesen tidak untuk masjid ini' : 'Kod lesen tidak sah');
    }
    const updated = await store.saveTenant(tenant.id, {
      license_code: String(code).trim(), license_verified_at: Date.now(), status: 'licensed'
    });
    reply.send({ ...licenseStatus(updated!), apiKey: updated!.apiKey });
  });

  // --- superuser ---------------------------------------------------------

  app.get('/api/super/tenants', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const list = await store.listTenants();
    reply.send(list.map((t) => ({ ...t, settings: undefined, license: licenseStatus(t) })));
  });

  app.post('/api/super/tenants', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const { name, username, password } = (req.body || {}) as { name?: string; username?: string; password?: string };
    if (!String(name || '').trim()) return jsonError(reply, 400, 'Nama masjid diperlukan');
    if (!String(username || '').trim()) return jsonError(reply, 400, 'Username admin diperlukan');
    if (String(username).toLowerCase() === 'admin') return jsonError(reply, 400, 'Username "admin" dikhaskan untuk superuser');
    if (String(password || '').length < 6) return jsonError(reply, 400, 'Kata laluan mesti sekurang-kurangnya 6 aksara');
    const existing = await store.getUserByUsername(String(username));
    if (existing) return jsonError(reply, 409, 'Username sudah wujud');
    const tenant = await store.createTenant({ name: String(name).trim(), username: String(username).trim(), password: String(password) });
    syncEventsFor(tenant.settings, (patch) => {
      store.updateSettings(tenant.id, patch as Record<string, unknown>);
      return Promise.resolve();
    }, true).catch(() => {});
    reply.status(201).send({ id: tenant.id, name: tenant.name, apiKey: tenant.apiKey, trialUntil: tenant.trialUntil, status: tenant.status });
  });

  app.get('/api/super/tenants/:id', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    reply.send({ ...t, settings: undefined, license: licenseStatus(t) });
  });

  app.patch('/api/super/tenants/:id', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    const body = (req.body || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (['trial', 'licensed', 'locked', 'suspended'].includes(body.status as string)) patch.status = body.status;
    if (Object.keys(patch).length === 0) return jsonError(reply, 400, 'Tiada perubahan');
    const updated = await store.saveTenant(t.id, patch);
    reply.send({ ...updated, settings: undefined, license: licenseStatus(updated!) });
  });

  app.delete('/api/super/tenants/:id', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    await store.deleteTenant((req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.post('/api/super/tenants/:id/license', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    const { code } = (req.body || {}) as { code?: string };
    const verified = verifyLicense(String(code || '').trim());
    if (!verified.ok || verified.tenantId !== t.id) {
      return jsonError(reply, 400, verified.ok ? 'Kod lesen tidak untuk masjid ini' : 'Kod lesen tidak sah');
    }
    const updated = await store.saveTenant(t.id, { license_code: String(code).trim(), license_verified_at: Date.now(), status: 'licensed' });
    reply.send({ ...updated, settings: undefined, license: licenseStatus(updated!) });
  });

  app.post('/api/super/tenants/:id/api-key', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    const apiKey = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 40);
    const updated = await store.saveTenant(t.id, { api_key: apiKey });
    reply.send({ apiKey: updated!.apiKey });
  });

  app.get('/api/super/tenants/:id/users', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    reply.send(await store.listUsers((req.params as { id: string }).id));
  });

  app.post('/api/super/tenants/:id/users', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const { username, password, name } = (req.body || {}) as { username?: string; password?: string; name?: string };
    if (!String(username || '').trim()) return jsonError(reply, 400, 'Username diperlukan');
    if (String(username).toLowerCase() === 'admin') return jsonError(reply, 400, 'Username "admin" dikhaskan untuk superuser');
    if (String(password || '').length < 6) return jsonError(reply, 400, 'Kata laluan mesti sekurang-kurangnya 6 aksara');
    const existing = await store.getUserByUsername(String(username));
    if (existing) return jsonError(reply, 409, 'Username sudah wujud');
    const user = await store.createUser((req.params as { id: string }).id, { username: String(username).trim(), password: String(password), name: String(name || '') });
    reply.status(201).send(user);
  });

  app.delete('/api/super/users/:id', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const u = await store.getUserById((req.params as { id: string }).id);
    if (!u) return jsonError(reply, 404, 'Pengguna tidak dijumpai');
    await store.deleteUser(u.tenantId, u.id);
    reply.send({ ok: true });
  });

  app.patch('/api/super/users/:id', async (req, reply) => {
    if (!(await requireSuperuser(req, reply))) return;
    const u = await store.getUserById((req.params as { id: string }).id);
    if (!u) return jsonError(reply, 404, 'Pengguna tidak dijumpai');
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.active === 'boolean') await store.setUserActive(u.tenantId, u.id, body.active);
    if (typeof body.password === 'string' && body.password.length >= 6) await store.resetUserPassword(u.tenantId, u.id, body.password);
    reply.send({ ok: true });
  });

  // --- pairing -----------------------------------------------------------

  app.post('/api/pair/start', async (req, reply) => {
    const ip = ipOf(req);
    const rl = await checkRateLimit(db.db, `pair-start:${ip}`);
    if (rl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan — cuba lagi kemudian');
    await recordFailure(db.db, `pair-start:${ip}`, 20, 15 * 60 * 1000);
    const { deviceId } = (req.body || {}) as { deviceId?: string };
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 100) return jsonError(reply, 400, 'deviceId diperlukan');
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => PAIR_CODE_CHARS[crypto.randomInt(PAIR_CODE_CHARS.length)]).join('');
    } while (await store.getPairingSession(code));
    await store.createPairingSession(code, deviceId.slice(0, 100), 15 * 60 * 1000);
    reply.send({ code, expiresAt: Date.now() + 15 * 60 * 1000 });
  });

  app.get('/api/pair/status', async (req, reply) => {
    const { code, device } = req.query as { code?: string; device?: string };
    if (!code || !device) return jsonError(reply, 400, 'Parameter tidak lengkap');
    const codeUpper = String(code).toUpperCase();
    const ip = ipOf(req);
    const ipKey = `pair-status-ip:${ip}`;
    const codeKey = `pair-status-code:${codeUpper}`;
    const [ipRl, codeRl] = await Promise.all([checkRateLimit(db.db, ipKey), checkRateLimit(db.db, codeKey)]);
    if (ipRl.locked || codeRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan — cuba lagi kemudian');
    await recordFailure(db.db, ipKey, 1200, 15 * 60 * 1000);
    await recordFailure(db.db, codeKey, 400, 15 * 60 * 1000);
    const s = await store.getPairingSession(codeUpper);
    if (!s) return reply.send({ status: 'not_found' });
    if (Date.now() > Number(s.expiresAt)) return reply.send({ status: 'expired' });
    if (s.status !== 'paired' || !s.tenantId) return reply.send({ status: 'pending' });
    const dev = await store.getDeviceByPair(String(device), s.tenantId);
    if (!dev) return reply.send({ status: 'pending' });
    const tenant = await store.getTenant(s.tenantId);
    reply.send({ status: 'paired', token: dev.token, tenantName: tenant?.name || '' });
  });

  app.post('/api/admin/pair', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    const { code, name } = (req.body || {}) as { code?: string; name?: string };
    if (!code || typeof code !== 'string') return jsonError(reply, 400, 'Kod diperlukan');
    const s = await store.getPairingSession(code.trim().toUpperCase());
    if (!s) return jsonError(reply, 404, 'Kod tidak dijumpai');
    if (Date.now() > Number(s.expiresAt)) return jsonError(reply, 400, 'Kod telah tamat tempoh');
    if (s.status === 'paired') return jsonError(reply, 400, 'Kod sudah digunakan');
    const token = crypto.randomBytes(24).toString('hex');
    await store.createDevice(tenant.id, s.deviceId, String(name || '').slice(0, 60), token);
    await store.pairSession(s.code, tenant.id);
    reply.send({ ok: true, token });
  });

  app.get('/api/admin/devices', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    reply.send({ devices: await store.listDevices(tenant.id) });
  });

  app.delete('/api/admin/devices/:id', async (req, reply) => {
    const tenant = await requireAdmin(req, reply);
    if (!tenant) return;
    await store.deleteDevice(tenant.id, (req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.setNotFoundHandler((_req, reply) => jsonError(reply, 404, 'Tidak dijumpai'));
  app.setErrorHandler((err, _req, reply) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cloud] ralat:', msg);
    reply.status(500).send({ error: 'Ralat dalaman' });
  });

  return app;
}
