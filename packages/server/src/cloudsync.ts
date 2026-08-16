// Mod cloud untuk mini PC: server tempatan menjadi proksi cache dari cloud.
// Aktifkan dengan env: CLOUD_URL (cth. https://tvmasjid.vercel.app) + TENANT_KEY.
// Jika internet putus, paparan terus berjalan dengan cache (offline-first).

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const CLOUD_URL = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const TENANT_KEY = process.env.TENANT_KEY || '';
const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export function cloudSyncEnabled(): boolean {
  return Boolean(CLOUD_URL && TENANT_KEY);
}

function cacheFile(cacheDir: string, p: string): string {
  const name = p.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
  return path.join(cacheDir, name);
}

function loadCache(cacheDir: string, p: string): { savedAt: number; data: unknown } | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(cacheDir, p), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(cacheDir: string, p: string, data: unknown): void {
  try {
    fs.writeFileSync(cacheFile(cacheDir, p), JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
  } catch {
    /* ignore */
  }
}

function rewriteUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('/uploads/')) return `${CLOUD_URL}${value}`;
    // Relay HLS adalah tidak sah di pelayan lokal (tiada ffmpeg dalam mod
    // cloud) — arahkan terus ke hos cloud. URL mutlak tidak disentuh.
    if (value.startsWith('/relay/')) return `${CLOUD_URL}${value}`;
    return value;
  }
  if (Array.isArray(value)) return value.map(rewriteUrls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteUrls(v);
    return out;
  }
  return value;
}

async function cloudFetch(p: string): Promise<{ ok: boolean; status: number; json?: unknown }> {
  const res = await fetch(`${CLOUD_URL}${p}`, {
    headers: { 'x-tenant-key': TENANT_KEY },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: 200, json: await res.json() };
}

export function applyCloudSync(
  app: FastifyInstance,
  dataDir: string,
  requireDisplayKey?: (req: import('fastify').FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => void
): void {
  if (!cloudSyncEnabled()) return;
  const cacheDir = path.join(dataDir, 'cloud-cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const serveFromCache = (reply: FastifyReply, p: string, rewrite: boolean) => {
    const cache = loadCache(cacheDir, p);
    if (!cache) {
      reply.status(503).send({ error: 'Paparan offline dan tiada cache' });
      return;
    }
    const data = rewrite ? rewriteUrls(cache.data) : cache.data;
    reply.send(data);
  };

  const syncEndpoint = async (reply: FastifyReply, p: string, rewrite = true) => {
    try {
      const cloud = await cloudFetch(p);
      if (cloud.ok) {
        saveCache(cacheDir, p, cloud.json);
        reply.send(rewrite ? rewriteUrls(cloud.json) : cloud.json);
        return;
      }
      if (cloud.status === 403) {
        const cache = loadCache(cacheDir, p);
        if (cache && Date.now() - cache.savedAt <= GRACE_MS) {
          reply.send(rewrite ? rewriteUrls(cache.data) : cache.data);
          return;
        }
        reply.status(403).send({ error: 'Lesen diperlukan', code: 'LICENSE_REQUIRED' });
        return;
      }
      serveFromCache(reply, p, rewrite);
    } catch {
      serveFromCache(reply, p, rewrite);
    }
  };

  // Endpoint proksi cloud turut memerlukan kunci paparan tempatan — tanpa ini
  // sesiapa di LAN boleh membaca tetapan (termasuk URL strim) tanpa kunci.
  // Guna preHandler yang sama dengan endpoint tempatan bila disediakan.
  const opts = requireDisplayKey ? { preHandler: requireDisplayKey } : {};

  app.get('/api/settings', opts, async (_req, reply) => syncEndpoint(reply, '/api/settings', true));
  app.get('/api/slides', opts, async (_req, reply) => syncEndpoint(reply, '/api/slides', true));
  app.get('/api/today', opts, async (_req, reply) => syncEndpoint(reply, '/api/today', false));

  app.get('/admin', async (_req, reply) => reply.redirect(`${CLOUD_URL}/admin`));
  // Paparan tempatan kekal boleh dilalui (kiosk/watchdog membuka /display):
  // halakan ke hos cloud — TV kemudian berkhidmat terus dari cloud.
  app.get('/', async (_req, reply) => reply.redirect(`${CLOUD_URL}/display`));
  app.get('/display', async (_req, reply) => reply.redirect(`${CLOUD_URL}/display`));
}
