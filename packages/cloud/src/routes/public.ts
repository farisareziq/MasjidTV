// Laluan paparan awam (tenant key) + maklumat statik (zon/kaedah) + kesihatan.
// Sebahagian memerlukan tenant sah (requireTenant); zon/methods/health terbuka.

import type { FastifyInstance } from 'fastify';
import {
  METHODS, getZonesGrouped, buildEventsPayload, dateKeyInZone,
  resolveQuranAnnouncements, resolveDoaAnnouncements, content as builtinContent,
  publicSettings as buildPublicSettings, publicStream, buildTodayPayload,
  sortAnnouncements, isAnnouncementActive,
  type Settings, type Stream
} from '@masjidtv/shared';
import { jsonError, requireTenant } from './helpers.js';
import type { RouteContext } from './context.js';

export function registerPublicRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store, startedAt } = ctx;

  app.get('/api/health', async (_req, reply) => {
    reply.send({ ok: true, service: 'masjidtv-cloud', version: '1.1.1', uptime: (Date.now() - startedAt) / 1000, now: new Date().toISOString() });
  });

  // --- display (tenant key) ---------------------------------------------

  app.get('/api/settings', async (req, reply) => {
    const tenant = await requireTenant(store, req, reply);
    if (!tenant) return;
    const pub = buildPublicSettings(tenant.settings);
    pub.events = buildEventsPayload((pub.events as Settings['events']) || [], new Date(), tenant.settings.prayer.timezone);
    pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);
    reply.send(pub);
  });

  app.get('/api/today', async (req, reply) => {
    const tenant = await requireTenant(store, req, reply);
    if (!tenant) return;
    try {
      reply.send(await buildTodayPayload(tenant.settings));
    } catch (err) {
      console.error('[cloud] /api/today:', err instanceof Error ? err.message : err);
      jsonError(reply, 500, 'Gagal mengira waktu solat');
    }
  });

  app.get('/api/slides', async (req, reply) => {
    const tenant = await requireTenant(store, req, reply);
    if (!tenant) return;
    const all = await store.listAnnouncements(tenant.id);
    const nowDate = new Date();
    const tz = tenant.settings.prayer.timezone;
    const todayKey = dateKeyInZone(nowDate, tz);
    const active = sortAnnouncements(all.filter((a) => isAnnouncementActive(a, nowDate, tz)));
    const announcements = resolveDoaAnnouncements(resolveQuranAnnouncements(active, todayKey), todayKey);
    reply.send({ announcements, builtin: announcements.length ? [] : builtinContent });
  });

  // Combined display sync — returns settings + today + slides in ONE response.
  // Replaces 3 separate function invocations (/api/settings + /api/today +
  // /api/slides) with a single invocation per poll cycle. The tenant lookup
  // DB query is shared across all three payloads.
  app.get('/api/sync', async (req, reply) => {
    const tenant = await requireTenant(store, req, reply);
    if (!tenant) return;
    const tz = tenant.settings.prayer.timezone;
    const nowDate = new Date();

    const pub = buildPublicSettings(tenant.settings);
    pub.events = buildEventsPayload((pub.events as Settings['events']) || [], nowDate, tz);
    pub.streams = ((pub.streams as Stream[]) || []).map(publicStream);

    let today: Awaited<ReturnType<typeof buildTodayPayload>> | null = null;
    try {
      today = await buildTodayPayload(tenant.settings);
    } catch (err) {
      console.error('[cloud] /api/sync today:', err instanceof Error ? err.message : err);
    }

    const all = await store.listAnnouncements(tenant.id);
    const todayKey = dateKeyInZone(nowDate, tz);
    const active = sortAnnouncements(all.filter((a) => isAnnouncementActive(a, nowDate, tz)));
    const announcements = resolveDoaAnnouncements(resolveQuranAnnouncements(active, todayKey), todayKey);

    reply.header('Cache-Control', 'private, max-age=55, stale-while-revalidate=60');
    reply.send({
      settings: pub,
      today,
      slides: { announcements, builtin: announcements.length ? [] : builtinContent }
    });
  });

  app.get('/api/zones', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    reply.send({ zones: getZonesGrouped() });
  });
  app.get('/api/methods', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    reply.send(METHODS);
  });
}
