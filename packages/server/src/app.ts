// Fastify app with full parity REST surface — port of reference server/index.js.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import {
  METHODS, getZonesGrouped, getZone, buildEventsPayload, syncEventsFor, dateKeyInZone,
  resolveQuranAnnouncements, resolveDoaAnnouncements, content as builtinContent,
  UPLOAD_TYPES,
  publicSettings as buildPublicSettings, publicStream, buildTodayPayload,
  isAnnouncementActive, setJakimCacheAdapter, addDays, hijriText,
  type Settings, type Stream, type JakimEntry
} from '@masjidtv/shared';
import { Store } from './store.js';
import { AnnouncementService } from './announcements.js';
import { StreamManager } from './streams.js';
import { JakimSyncService } from './jakim-sync.js';
import { cloudSyncEnabled, handleCloudSync, cloudPageRedirect, startCloudSseBridge, addLocalSseRoute, setOnCloudSettings } from './cloudsync.js';
import { applyPairing, PAIR_PAGE_HTML_SRC } from './pair.js';
import { ensureFfmpeg } from './ensure-ffmpeg.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const VERSION = '1.1.3';

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
  /** Laluan ffmpeg ditetapkan oleh hos (cth. app kiosk yang membundel binari). */
  ffmpegPathOverride?: string;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const store = await Store.open({ dataDir: opts.dataDir });
  const announcements = new AnnouncementService(store);
  const streams = new StreamManager(
    opts.dataDir,
    () => store.getSettings().streams,
    () => store.getSettings().media.ffmpegPath
  );
  // Cache luar talia JAKIM: carian DB dahulu (L1) → memori → rangkaian; hasil
  // rangkaian disimpan balik ke DB. Waktu solat terus berkhidmat bila
  // e-solat.gov.my tidak dapat dihubungi.
  setJakimCacheAdapter({
    get: (zone, dateKey) => store.getJakimEntry(zone, dateKey),
    put: (zone, entries) => store.putJakimEntries(zone, entries)
  });
  // Sync latar belakang: tahun penuh × 60 zon (incremental harian).
  const jakimSync = new JakimSyncService(store, {
    isCloudPaired: () => cloudSyncEnabled(opts.dataDir)
  });
  jakimSync.start();

  // Had badan global kecil: auth berjalan SELEPAS badan dihurai, jadi had
  // besar global membenarkan sesiapa sahaja di LAN memaksa buffer 150MB
  // diperuntukkan sebelum 401. Laluan muat naik menaikkan hadnya sendiri.
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const tokens = new Map<string, number>();
  const loginAttempts = new Map<string, { count: number; until: number }>();
  const PORT = opts.port || Number(process.env.PORT) || 3000;
  // Mod cloud-sync (hot): endpoint paparan SENTIASA didaftarkan sekali; bila
  // config pairing aktif mereka berkhidmat dari cloud (proksi+cache), bila
  // tidak — data tempatan. Tiada restart diperlukan selepas /pair.
  // cloudMode hanya mengawal tugas latar (ffmpeg/JAKIM) semasa boot.
  const cloudMode = cloudSyncEnabled(opts.dataDir);

  const settings = () => store.getSettings();
  const tz = () => settings().prayer.timezone || 'Asia/Kuala_Lumpur';

  app.addHook('onClose', async () => {
    // Hentikan relay ffmpeg supaya tiada proses encoder yatim selepas tutup.
    streams.stopAll();
    store.close();
    // Lepaskan adapter cache (ujian boleh buka app berturut dalam satu proses).
    setJakimCacheAdapter(null);
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
    // Dipaut dengan cloud? Token peranti = akses paparan (kelakuan TV).
    if (cloudSyncEnabled(opts.dataDir)) return done();
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
    // Kunci paparan dihantar melalui ?key= — halang ia bocor ke pihak ketiga
    // melalui header Referer (cth. skrip/vendor luar) pada halaman display.
    reply.header('Referrer-Policy', 'same-origin');
  });

  // Static uploads (raw file serving, no path traversal).
  app.register(import('@fastify/static'), {
    root: path.join(opts.dataDir, 'uploads'),
    prefix: '/uploads/',
    decorateReply: false
  });

  // Static public files (display/admin/sw.js). publicDir mungkin folder
  // sebenar ATAU 'masjidtv-assets://virtual' (binari SEA — aset dari memori).
  const VIRTUAL_PREFIX = 'masjidtv-assets://virtual';
  const virtualAssets = opts.publicDir.startsWith(VIRTUAL_PREFIX)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ? (require('./public-assets.cjs') as { getPublicAssets: () => { get(file: string): Buffer | null } | null }).getPublicAssets()
    : null;
  if (opts.publicDir.startsWith(VIRTUAL_PREFIX) && !virtualAssets) {
    throw new Error('Aset maya diminta tetapi tidak tersedia (bukan runtime SEA?)');
  }
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
  };
  // Layar fail awam dari publicDir (folder) atau aset maya (SEA).
  const servePublic = (reply: FastifyReply, file: string): boolean => {
    if (virtualAssets) {
      const buf = virtualAssets.get(file);
      if (!buf) return false;
      reply.header('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      if (file === 'sw.js') reply.header('Cache-Control', 'no-cache, no-store');
      reply.send(buf);
      return true;
    }
    reply.type('text/html').sendFile(file);
    return true;
  };  if (!virtualAssets) {
    app.register(import('@fastify/static'), {
      root: opts.publicDir,
      prefix: '/'
    });
  }

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

  // Mod pairing mini PC: halaman /pair + API (sentiasa tersedia — kedua-dua
  // mod lokal dan cloud-sync; pasangan berjaya diaktifkan secara hot).
  applyPairing(app, opts.dataDir);

  // SSE lokal untuk paparan (sync segera; berfungsi dalam & luar mod cloud —
  // luar mod cloud tiada event sync, hanya hello/heartbeat).
  addLocalSseRoute(app);

  // Status ringkas stream relay untuk menu tersembunyi kiosk — tanpa auth
  // (mod cloud tiada login admin lokal) tetapi HANYA nama/status/lastError;
  // URL (kredensial kamera) tidak didedahkan.
  app.get('/api/streams-status', async (_req, reply) => {
    reply.send({
      streams: streams.allStatus().map((s: Record<string, unknown>) => ({
        name: s.name,
        type: s.type,
        status: s.status,
        lastError: s.lastError || undefined
      }))
    });
  });

  // --- Public (display) endpoints ------------------------------------------

  app.get('/api/health', async (_req, reply) => {
    reply.send({ ok: true, service: 'masjidtv', version: VERSION, uptime: process.uptime(), now: new Date().toISOString() });
  });

  app.get('/api/methods', async (_req, reply) => reply.send(METHODS));
  app.get('/api/zones', async (_req, reply) => reply.send({ zones: getZonesGrouped() }));

  app.get('/api/settings', { preHandler: requireDisplayKey }, async (_req, reply) => {
    if (await handleCloudSync(reply, opts.dataDir, '/api/settings', true)) return;
    const pub = buildPublicSettings(settings(), { includeEventsSync: true });
    pub.events = buildEventsPayload((pub.events as Settings['events']) || [], new Date(), tz());
    pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);
    reply.send(pub);
  });

  app.get('/api/today', { preHandler: requireDisplayKey }, async (_req, reply) => {
    if (await handleCloudSync(reply, opts.dataDir, '/api/today', false)) return;
    try {
      reply.send(await buildTodayPayload(settings()));
    } catch (err) {
      console.error('[api] /api/today failed:', err instanceof Error ? err.message : err);
      jsonError(reply, 500, 'Failed to compute prayer times');
    }
  });

  app.get('/api/slides', { preHandler: requireDisplayKey }, async (_req, reply) => {
    if (await handleCloudSync(reply, opts.dataDir, '/api/slides', true)) return;
    const active = announcements.listActive(new Date(), tz());
    const resolved = resolveDoaAnnouncements(
      resolveQuranAnnouncements(active, dateKeyInZone(new Date(), tz())),
      dateKeyInZone(new Date(), tz())
    );
    reply.send({ announcements: resolved, builtin: resolved.length ? [] : builtinContent });
  });

  // Sync gabungan paparan — settings + today + slides dalam SATU respons.
  // Paparan (display-core) kini mengundi endpoint ini sahaja; tanpa laluan
  // ini paparan lokal/kiosk mendapat 404 pada setiap kitaran sync dan
  // waktu solat tidak pernah dikemas kini. Bentuk payload seragam dengan
  // /api/sync cloud (proxy mod cloud-sync memulangkan bentuk yang sama).
  app.get('/api/sync', { preHandler: requireDisplayKey }, async (_req, reply) => {
    if (await handleCloudSync(reply, opts.dataDir, '/api/sync', true)) return;
    const s = settings();
    const now = new Date();
    const pub = buildPublicSettings(s, { includeEventsSync: true });
    pub.events = buildEventsPayload((pub.events as Settings['events']) || [], now, tz());
    pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);

    let today: Awaited<ReturnType<typeof buildTodayPayload>> | null = null;
    try {
      today = await buildTodayPayload(s);
    } catch (err) {
      // Jangan gagalkan keseluruhan sync — settings/slaid kekal dihantar
      // (pariti dengan laluan cloud /api/sync).
      console.error('[api] /api/sync today:', err instanceof Error ? err.message : err);
    }

    const todayKey = dateKeyInZone(now, tz());
    const active = announcements.listActive(now, tz());
    const resolved = resolveDoaAnnouncements(resolveQuranAnnouncements(active, todayKey), todayKey);

    reply.send({
      settings: pub,
      today,
      slides: { announcements: resolved, builtin: resolved.length ? [] : builtinContent }
    });
  });

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

  // Senarai peranti DirectShow (kamera USB / OBS Virtual Camera) — untuk
  // pilihan stream DSHOW di admin. Laluan admin (token) — maklumat peranti
  // tidak didedahkan kepada paparan umum.
  app.get('/api/admin/dshow-devices', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const { listDshowDevices } = await import('./dshow.js');
      const ff = settings().media.ffmpegPath || 'ffmpeg';
      const devices = await listDshowDevices(ff);
      reply.send({ devices: devices.filter((d) => d.kind === 'video') });
    } catch (err) {
      reply.status(500).send({ error: 'Gagal senaraikan peranti', detail: err instanceof Error ? err.message : String(err) });
    }
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

  // --- Cache waktu solat JAKIM (luar talia + suntingan manual) ---------------
  //
  // GET  /api/admin/jakim-times  → minggu (7 hari lalai) untuk zon semasa:
  //        hari cache + suntingan manual digabung + status sync + liputan.
  // POST /api/admin/jakim-sync   → tarik data JAKIM ({zone} | {all:true}).
  //        Zon tunggal: di-await (≤3 permintaan, ~2-10sa). Semua zon:
  //        latar belakang (60 zon × ~3 permintaan — terlalu lama untuk 1 req).

  app.get('/api/admin/jakim-times', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query || {}) as { zone?: string; from?: string; to?: string };
    const s = settings();
    const zone = (typeof q.zone === 'string' && getZone(q.zone)) ? q.zone : s.prayer.zone;
    const today = dateKeyInZone(new Date(), tz());
    const from = typeof q.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : today;
    const maxTo = addDays(from, 30); // had 31 hari — elak muat beribu baris
    let to = typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : addDays(from, 6);
    if (to > maxTo) to = maxTo;
    if (to < from) to = from;

    const entries = new Map(store.getJakimRange(zone, from, to).map((e) => [e.dateKey, e]));
    const overrides = s.prayer.overrides || {};
    const days: unknown[] = [];
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
      const entry = entries.get(cursor) as (JakimEntry & { times: Record<string, string | null> }) | undefined;
      const dayOverride = overrides[cursor];
      const overridden = !!dayOverride && Object.keys(dayOverride).length > 0;
      // times = cache MENTAH (tanpa suntingan) — diff suntingan di klien.
      // effective = nilai sebenar paparan (cache + suntingan digabung);
      // wujud walaupun tanpa cache jika ada suntingan (boleh disunting/dibuang).
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
    const coverageRows = store.getJakimCoverage();
    reply.send({
      zone,
      from,
      to,
      days,
      sync: jakimSync.getStatus(),
      coverage: {
        totalZones: 60,
        zonesCached: coverageRows.length,
        zonesFullYear: coverageRows.filter((r) => r.maxDate && r.maxDate >= `${year}-12-31`).length
      }
    });
  });

  app.post('/api/admin/jakim-sync', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body || {}) as { zone?: string; all?: boolean; force?: boolean };
    if (body.all === true) {
      if (jakimSync.getStatus().running) {
        return reply.send({ started: false, sync: jakimSync.getStatus() });
      }
      // Latar belakang — 60 zon mengambil masa beberapa minit.
      jakimSync.runAll(body.force === true).catch((err) => {
        console.error('[jakim] sync semua zon gagal:', err instanceof Error ? err.message : err);
      });
      return reply.send({ started: true, sync: jakimSync.getStatus() });
    }
    const zone = (typeof body.zone === 'string' && getZone(body.zone))
      ? body.zone
      : settings().prayer.zone;
    const sync = await jakimSync.runAll(body.force === true, zone);
    reply.send({ started: false, done: true, sync });
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
      if (before !== after) {
        // Zon baharu — panaskan cache JAKIM untuk zon itu serta-merta (latar
        // belakang; tidak menyekat respons).
        jakimSync.runAll(false, after).catch(() => {});
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
  // KELAKUAN ANDROID TV: satu URL /display untuk semua keadaan.
  //   - Belum dipaut + tiada display key → halaman pairing (auto kod).
  //   - Belum dipaut + ada display key (setup lokal normal) → paparan lokal.
  //   - Dipaut → paparan lokal berkhidmat dari proksi+cache cloud.
  // Unpair di cloud (401) → auto-reset → paparan reload → pairing.

  app.get('/', async (_req, reply) => {
    reply.redirect('/display');
  });
  app.get('/display', (req, reply) => {
    const paired = cloudSyncEnabled(opts.dataDir);
    const expected = settings().security?.displayKey;
    const urlKey = (req.query as Record<string, string>).key;
    const hdrKey = req.headers['x-display-key'] as string | undefined;
    const keyOk = expected ? (urlKey && safeEqualStr(urlKey, expected)) || (hdrKey && safeEqualStr(hdrKey, expected)) : true;
    // KELAKUAN ANDROID TV: belum dipaut + tiada kunci sah → skrin pairing.
    // (Kiosk launcher sentiasa bawa ?key= — jadi paparan lokal kekal untuk
    // pemasangan lokal sedia ada; TV berpandukan cloud tidak perlu kunci.)
    if (!paired && !keyOk) {
      reply.type('text/html').send(PAIR_PAGE_HTML_SRC);
      return;
    }
    servePublic(reply, 'display.html');
  });
  app.get('/admin', (_req, reply) => {
    if (cloudPageRedirect(reply, opts.dataDir, '/admin')) return;
    servePublic(reply, 'admin.html');
  });
  app.get('/pair', async (_req, reply) => {
    reply.type('text/html').send(PAIR_PAGE_HTML_SRC);
  });

  app.get('/sw.js', (_req, reply) => {
    reply.header('Cache-Control', 'no-cache, no-store');
    servePublic(reply, 'sw.js');
  });

  app.setNotFoundHandler((req, reply) => {
    if (cloudMode && req.url.startsWith('/api/admin')) {
      reply.status(404).send({ error: 'Admin hanya di cloud' });
      return;
    }
    // Mod maya (SEA): aset statik awam dilayani di sini (tiada @fastify/static).
    if (virtualAssets) {
      const file = (req.url || '').split('?')[0].replace(/^\/+/, '');
      if (file && !file.includes('..') && !file.startsWith('api/') && servePublic(reply, file)) return;
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

  // Jambatan SSE cloud→lokal (sync segera; selamat dipanggil walau belum
  // dipaut — ia akan menunggu config pairing muncul).
  startCloudSseBridge(opts.dataDir).catch(() => {});

  // CLOUD-SYNC STREAMS: kamera/OBS ialah peranti mini PC — relay ffmpeg
  // mesti berjalan LOKAL walaupun tetapan datang dari cloud. Setiap kemas
  // kini settings cloud (fetch proksi / SSE sync) tulis semula streams ke
  // store lokal dan StreamManager.sync() menguruskan proses ffmpeg.
  setOnCloudSettings((cloudSettings) => {
    const streams = cloudSettings.streams;
    if (Array.isArray(streams)) {
      const cur = app.masjidStore.getSettings().streams || [];
      const same = JSON.stringify(cur) === JSON.stringify(streams);
      if (!same) {
        app.masjidStore.updateSettings({ streams });
        app.masjidStreams.sync().catch(() => {});
        console.log(`[cloud] streams dikemas kini (${(streams as unknown[]).length} entri) — relay lokal.`);
      }
    }
  });

  // Pariti rujukan: semak ffmpeg + sync relay, dan sync acara Islam pada
  // permulaan (plus ulang setiap 12 jam). ffmpeg/relay sentiasa disediakan
  // (dipautkan atau tidak) kerana relay ialah kerja lokal.
  {
    const presetFfmpeg = opts.ffmpegPathOverride;
    if (presetFfmpeg) {
      const cur = app.masjidStore.getSettings().media.ffmpegPath;
      if (!cur || cur === 'ffmpeg') {
        app.masjidStore.updateSettings({ media: { ffmpegPath: presetFfmpeg } });
        app.masjidStreams.resetFfmpegCheck();
      }
      app.masjidStreams.checkFfmpeg().then(() => app.masjidStreams.sync());
      console.log(`  ffmpeg: ${presetFfmpeg}`);
    } else {
      ensureFfmpeg(opts.dataDir).then(async (r) => {
        console.log(`  ffmpeg: ${r.ok ? 'available' : 'NOT FOUND — RTSP/RTMP/ONVIF streams need ffmpeg'}${r.ok && r.path ? ` (${r.path})` : ''}`);
        if (!r.ok) console.log(`  ffmpeg: ${r.message}`);
        if (r.ok && r.path) {
          const cur = app.masjidStore.getSettings().media.ffmpegPath;
          if (!cur || cur === 'ffmpeg') {
            app.masjidStore.updateSettings({ media: { ffmpegPath: r.path } });
            app.masjidStreams.resetFfmpegCheck();
          }
        }
        app.masjidStreams.checkFfmpeg().then(() => app.masjidStreams.sync());
      });
    }
  }
  if (!cloudSyncEnabled(opts.dataDir)) {
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
