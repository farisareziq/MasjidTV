// Laluan admin masjid (tenant): status, settings, pengumuman, media/upload,
// sync acara, streams, kata laluan, lesen. Semua memerlukan requireAdmin.

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  buildEventsPayload, syncEventsFor, buildTodayPayload,
  UPLOAD_TYPES,
  sanitizeAnnouncementCreate, applyAnnouncementPatch,
  sortAnnouncements, isAnnouncementActive,
  dateKeyInZone, addDays, fetchJakimRange, planZoneYearSync, hijriText, getZone,
  type JakimEntry
} from '@masjidtv/shared';
import { signToken, comparePassword } from '../auth.js';
import { verifyLicense, licenseStatus } from '../license.js';
import { getStorage } from '../storage.js';
import { jsonError, requireAdmin, type TenantReq } from './helpers.js';
import type { RouteContext } from './context.js';

// Base URL untuk pautan paparan/admin: keutamaan env (elak host-header
// injection), jatuh kembali kepada host permintaan yang sah.
function baseDisplayUrl(req: FastifyRequest): string {
  const configured = process.env.MASJIDTV_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.headers.host}`;
}

// Token bucket per-tenant untuk presigned upload URL (W1-b). In-memory —
// pada serverless setiap instance ada salinannya sendiri, jadi siling berkesan
// ialah ~limit × instance; masih menghalang penyalahgunaan paling kasar.
const uploadUrlRate = (() => {
  const hits = new Map<string, { start: number; count: number }>();
  const LIMIT = 30; // presigned URL per tenant per minit
  return {
    allow(tenantId: string): boolean {
      const now = Date.now();
      const h = hits.get(tenantId);
      if (!h || now - h.start >= 60_000) { hits.set(tenantId, { start: now, count: 1 }); return true; }
      if (h.count >= LIMIT) return false;
      h.count++;
      return true;
    }
  };
})();

export function registerAdminRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store, startedAt } = ctx;
  const storage = getStorage();

  app.get('/api/admin/status', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const all = await store.listAnnouncements(tenant.id);
    const settings = tenant.settings;
    const nowDate = new Date();
    const tz = settings.prayer.timezone;
    const activeCount = all.filter((a) => isAnnouncementActive(a, nowDate, tz)).length;
    const events = buildEventsPayload(settings.events || [], nowDate, tz);
    reply.send({
      version: '1.1.2',
      uptime: (Date.now() - startedAt) / 1000,
      startedAt: new Date(startedAt).toISOString(),
      screenUrl: `${baseDisplayUrl(req)}/display?key=${tenant.apiKey}`,
      adminUrl: `${baseDisplayUrl(req)}/admin`,
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
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    reply.send(tenant.settings);
  });

  app.put('/api/admin/settings', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    try {
      const before = tenant.settings.prayer.zone;
      const wasEnabled = tenant.settings.eventsSync.enabled;
      const updated = await store.updateSettings(tenant.id, (req.body || {}) as Record<string, unknown>);
      if (before !== updated!.prayer.zone || (!wasEnabled && updated!.eventsSync.enabled)) {
        syncEventsFor(updated!, async (patch) => {
          await store.updateSettings(tenant.id, patch as Record<string, unknown>);
        }, false).catch(() => {});
      }
      reply.send(updated);
    } catch {
      jsonError(reply, 500, 'Gagal menyimpan tetapan');
    }
  });

  app.get('/api/admin/announcements', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
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
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const input = (req.body || {}) as Record<string, unknown>;
    const all = await store.listAnnouncements(tenant.id);
    const item = sanitizeAnnouncementCreate(input);
    item.sortOrder = all.reduce((m, a) => Math.max(m, Number(a.sortOrder) || 0), 0) + 1;
    const saved = await store.addAnnouncement(tenant.id, item);
    reply.status(201).send(saved);
  });

  app.put('/api/admin/announcements/:id', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
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
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    await store.deleteAnnouncement(tenant.id, (req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.post('/api/admin/announcements/reorder', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
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

  // --- Cache waktu solat JAKIM (luar talia + suntingan manual) ----------------
  //
  // Jadual jakim_times GLOBAL (dikongsi semua tenant — data awam per zon).
  // Suntingan manual dibaca daripada settings tenant (prayer.overrides) dan
  // digabung dalam respons supaya panel memaparkan nilai sebenar paparan.

  app.get('/api/admin/jakim-times', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const s = tenant.settings;
    const tz = s.prayer.timezone || 'Asia/Kuala_Lumpur';
    const q = (req.query || {}) as { zone?: string; from?: string; to?: string };
    const zone = (typeof q.zone === 'string' && getZone(q.zone)) ? q.zone : s.prayer.zone;
    const today = dateKeyInZone(new Date(), tz);
    const from = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : today;
    const maxTo = addDays(from, 30);
    let to = typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : addDays(from, 6);
    if (to > maxTo) to = maxTo;
    if (to < from) to = from;

    const entries = new Map((await store.getJakimRange(zone, from, to)).map((e) => [e.dateKey, e]));
    const overrides = s.prayer.overrides || {};
    const days: unknown[] = [];
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      const entry = entries.get(cursor) as (JakimEntry & { times: Record<string, string | null> }) | undefined;
      const dayOverride = overrides[cursor];
      const overridden = !!dayOverride && Object.keys(dayOverride).length > 0;
      const times: Record<string, string | null> | null = entry ? { ...entry.times } : null;
      let effective: Record<string, string | null> | null = times ? { ...times } : null;
      if (dayOverride) {
        if (!effective) effective = {};
        if (dayOverride.imsak) effective.imsak = dayOverride.imsak;
        if (dayOverride.fajr) effective.fajr = dayOverride.fajr;
        if (dayOverride.sunrise) effective.syuruk = dayOverride.sunrise;
        if (dayOverride.dhuhr) effective.dhuhr = dayOverride.dhuhr;
        if (dayOverride.asr) effective.asr = dayOverride.asr;
        if (dayOverride.maghrib) effective.maghrib = dayOverride.maghrib;
        if (dayOverride.isha) effective.isha = dayOverride.isha;
      }
      days.push({
        dateKey: cursor,
        hijri: entry?.hijri ? hijriText(entry.hijri) : null,
        times,
        effective,
        overrides: dayOverride || null,
        overridden
      });
    }

    const year = Number(today.slice(0, 4));
    const coverageRows = await store.getJakimCoverage();
    reply.send({
      zone,
      from,
      to,
      days,
      coverage: {
        totalZones: 60,
        zonesCached: coverageRows.length,
        zonesFullYear: coverageRows.filter((r) => r.maxDate && r.maxDate >= `${year}-12-31`).length
      }
    });
  });

  // Sync zon tenant (≤3 permintaan JAKIM — sama ikatan seperti /api/admin/events/sync
  // yang menarik julat setahun). Tidak ada sync semua-zon di serverless.
  app.post('/api/admin/jakim-sync', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const body = (req.body || {}) as { zone?: string; force?: boolean };
    const zone = (typeof body.zone === 'string' && getZone(body.zone))
      ? body.zone
      : tenant.settings.prayer.zone;
    const tz = tenant.settings.prayer.timezone || 'Asia/Kuala_Lumpur';
    const today = dateKeyInZone(new Date(), tz);
    const plan = planZoneYearSync(await store.getJakimMaxDate(zone), body.force === true, today);
    if (plan.complete) {
      return reply.send({ done: true, complete: true, synced: 0 });
    }
    try {
      const entries = await fetchJakimRange(zone, plan.from, plan.to);
      reply.send({ done: true, complete: true, synced: entries.length });
    } catch (err) {
      jsonError(reply, 502, `Sync JAKIM gagal: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Combined admin sync — returns status + today + announcements in ONE
  // response. Replaces 3 separate function invocations per admin poll cycle.
  app.get('/api/admin/sync', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const settings = tenant.settings;
    const nowDate = new Date();
    const tz = settings.prayer.timezone;
    const all = await store.listAnnouncements(tenant.id);
    const activeCount = all.filter((a) => isAnnouncementActive(a, nowDate, tz)).length;
    const events = buildEventsPayload(settings.events || [], nowDate, tz);
    const status = {
      version: '1.1.2',
      uptime: (Date.now() - startedAt) / 1000,
      startedAt: new Date(startedAt).toISOString(),
      screenUrl: `${baseDisplayUrl(req)}/display?key=${tenant.apiKey}`,
      adminUrl: `${baseDisplayUrl(req)}/admin`,
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
    };
    let today: Awaited<ReturnType<typeof buildTodayPayload>> | null = null;
    try { today = await buildTodayPayload(settings); } catch { /* computation error */ }
    const announcements = sortAnnouncements(all).map((a) => ({
      ...a,
      status: isAnnouncementActive(a, nowDate, tz) ? 'active' : 'inactive'
    }));
    reply.send({ status, today, announcements });
  });

  // Media upload (direct to Blob if configured, else local fs).
  app.post('/api/admin/upload', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const contentType = req.headers['content-type'] || '';
    const type = UPLOAD_TYPES[contentType];
    if (!type) return jsonError(reply, 400, 'Jenis fail tidak disokong');
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!buffer.length) return jsonError(reply, 400, 'Tiada data');
    if (!type.magic(buffer)) return jsonError(reply, 400, `Fail bukan ${type.kind} sah`);
    const filename = `media/${tenant.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    if (!storage.isConfigured()) {
      return jsonError(reply, 400, 'Storan tidak dikonfigurasi — tetapkan MASJIDTV_UPLOADS_DIR atau VERCEL_BLOB_READ_WRITE_TOKEN');
    }
    try {
      const { url } = await storage.put(filename, buffer);
      await store.addMedia(tenant.id, { filename, kind: type.kind });
      return reply.send({ url, kind: type.kind });
    } catch {
      return jsonError(reply, 500, 'Gagal muat naik fail');
    }
  });

  app.post('/api/admin/upload-url', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    // Rate-limit per-tenant: token admin bocor boleh minta presigned URL 50MB
    // tanpa had → blob yatim memenuhi storan (W1-b). Siling 30 minta/minit.
    if (!uploadUrlRate.allow(tenant.id)) {
      return jsonError(reply, 429, 'Terlalu banyak permintaan muat naik — cuba sebentar lagi');
    }
    const storage_ = getStorage();
    if (!storage_.isConfigured()) {
      return jsonError(reply, 400, 'Storan tidak dikonfigurasi — tetapkan MASJIDTV_UPLOADS_DIR atau VERCEL_BLOB_READ_WRITE_TOKEN');
    }
    const { contentType } = (req.body || {}) as { contentType?: string };
    const type = UPLOAD_TYPES[contentType || ''];
    if (!type) return jsonError(reply, 400, 'Jenis fail tidak disokong');
    const pathname = `media/${tenant.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${type.ext}`;
    if (storage_.presignUpload) {
      try {
        const result = await storage_.presignUpload(pathname, contentType!);
        if (result) return reply.send({ presignedUrl: result.presignedUrl, pathname: result.pathname, kind: type.kind });
      } catch {
        return jsonError(reply, 500, 'Gagal sediakan muat naik');
      }
    }
    // Local storage: no presigned URL — frontend falls back to direct upload.
    return jsonError(reply, 400, 'Presigned URL tidak tersedia — gunakan muat naik terus');
  });

  app.post('/api/admin/upload-confirm', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const storage_ = getStorage();
    const { pathname, kind } = (req.body || {}) as { pathname?: string; kind?: string };
    if (!storage_.isConfigured() || !/^[\w./-]+$/.test(String(pathname || '')) || !String(pathname).startsWith(`media/${tenant.id}/`)) {
      return jsonError(reply, 400, 'Parameter tidak sah');
    }
    try {
      const blob = await storage_.head(String(pathname));
      if (!blob) return jsonError(reply, 404, 'Fail tidak dijumpai');
      const mediaKind = ['image', 'video', 'audio'].includes(kind || '') ? kind : 'video';
      await store.addMedia(tenant.id, { filename: String(pathname), kind: mediaKind! });
      reply.send({ url: blob.url, kind: mediaKind });
    } catch {
      jsonError(reply, 500, 'Gagal sahkan muat naik');
    }
  });

  app.get('/api/admin/media', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const rows = await store.listMedia(tenant.id);
    reply.send(rows.map((m) => ({ ...m, url: storage.publicUrl(m.filename) })));
  });

  app.delete('/api/admin/media/:id', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const row = await store.getMedia(tenant.id, (req.params as { id: string }).id);
    if (!row) return jsonError(reply, 404, 'Media tidak dijumpai');
    // Padam baris DB dahulu (sumber kebenaran UI); pemadaman Blob
    // best-effort selepasnya — kegagalan Blob tidak menggagalkan permintaan
    // (blob yatim tidak lagi dirujuk oleh mana-mana respons API).
    await store.deleteMedia(tenant.id, row.id);
    if (storage.isConfigured()) {
      try { await storage.del(row.filename); } catch { /* best-effort */ }
    }
    reply.send({ ok: true });
  });

  app.post('/api/admin/events/sync', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const result = await syncEventsFor(tenant.settings, async (patch) => {
      await store.updateSettings(tenant.id, patch as Record<string, unknown>);
    }, true);
    reply.send(result);
  });

  app.get('/api/admin/streams', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const streams = (tenant.settings.streams || []).map((s) => ({
      id: s.id, name: s.name, type: s.type, url: s.url, duration: s.duration, enabled: s.enabled,
      status: s.enabled ? 'configured' : 'disabled',
      hlsUrl: ['rtsp', 'rtmp', 'onvif'].includes(s.type) ? `/relay/${s.id}/index.m3u8` : null
    }));
    // Hos awan TIADA ffmpeg & tiada endpoint /relay — stream kamera/cermin
    // hanya berfungsi melalui kiosk mini PC berpasangan. Laporkan ffmpegOk
    // secara jujur sebagai proksi "ada kiosk berpasangan" supaya UI tidak
    // mendakwa relay tersedia pada mesin ini; kioskRequired menandakan pada
    // klien bahawa relay memerlukan kiosk (bukan ffmpeg pelayan).
    const devices = await store.listDevices(tenant.id);
    reply.send({ streams, ffmpegOk: devices.length > 0, kioskRequired: true });
  });

  app.put('/api/admin/streams', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
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
    const tenant = await requireAdmin(store, req, reply);
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
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    reply.send({ ...(req as FastifyRequest & TenantReq).license, apiKey: tenant.apiKey });
  });

  app.post('/api/admin/license', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const { code } = (req.body || {}) as { code?: string };
    const verified = verifyLicense(String(code || '').trim());
    // Bezakan kegagalan KONFIGURASI PELAYAN (kunci awam lesen belum diset /
    // tidak sah pada server) daripada kod salah — mesej generik "kod tidak
    // sah" mengelirukan admin apabila puncanya LICENSE_PUBLIC_KEY tiada.
    if (!verified.ok && (verified.reason === 'no-public-key' || verified.reason === 'key')) {
      return jsonError(reply, 400, 'Konfigurasi lesen pelayan belum selesai — hubungi penyedia untuk mengaktifkan pengesahan lesen. (License server is not configured — LICENSE_PUBLIC_KEY missing/invalid.)', 'LICENSE_SERVER_UNCONFIGURED');
    }
    if (!verified.ok || verified.tenantId !== tenant.id) {
      return jsonError(reply, 400, verified.ok ? 'Kod lesen tidak untuk masjid ini' : 'Kod lesen tidak sah');
    }
    const updated = await store.saveTenant(tenant.id, {
      license_code: String(code).trim(), license_verified_at: Date.now(), status: 'licensed'
    });
    reply.send({ ...licenseStatus(updated!), apiKey: updated!.apiKey });
  });

  // --- pairing (admin): tuntut kod & urus peranti tenant -----------------

  app.post('/api/admin/pair', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const { code, name } = (req.body || {}) as { code?: string; name?: string };
    if (!code || typeof code !== 'string') return jsonError(reply, 400, 'Kod diperlukan');
    const s = await store.getPairingSession(code.trim().toUpperCase());
    if (!s) return jsonError(reply, 404, 'Kod tidak dijumpai');
    if (Date.now() > Number(s.expiresAt)) return jsonError(reply, 400, 'Kod telah tamat tempoh');
    if (s.status === 'paired') return jsonError(reply, 400, 'Kod sudah digunakan');
    // Tuntut sesi dahulu (CAS) — baru cipta/kemas kini peranti. Susunan ini
    // mengelakkan lumba yang memadam peranti sedia ada bila admin lain
    // menuntut kod yang sama serentak.
    const claimed = await store.pairSession(s.code, tenant.id);
    if (!claimed) return jsonError(reply, 409, 'Kod sudah digunakan');
    const token = crypto.randomBytes(24).toString('hex');
    await store.createDevice(tenant.id, s.deviceId, String(name || '').slice(0, 60), token);
    reply.send({ ok: true, token });
  });

  app.get('/api/admin/devices', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    reply.send({ devices: await store.listDevices(tenant.id) });
  });

  // Namakan semula peranti TV (paparan senarai & rujukan admin).
  app.patch('/api/admin/devices/:id', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    const { id } = req.params as { id: string };
    const { name } = (req.body || {}) as { name?: string };
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return jsonError(reply, 400, 'Nama diperlukan');
    await store.renameDevice(tenant.id, id, clean);
    reply.send({ ok: true });
  });

  app.delete('/api/admin/devices/:id', async (req, reply) => {
    const tenant = await requireAdmin(store, req, reply);
    if (!tenant) return;
    await store.deleteDevice(tenant.id, (req.params as { id: string }).id);
    reply.send({ ok: true });
  });
}
