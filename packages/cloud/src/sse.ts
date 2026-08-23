// SSE hub untuk sync segera admin-web → TV. Setiap penulisan tenant
// (settings/slaid/media) membump rev (disimpan dalam settings._rev — tiada
// migrasi skema) dan broadcast event 'sync' kepada semua sambungan tenant.
// Paparan mini PC (jambatan SSE) kemudian refetch serta-merta.
//
// Reconnect selamat: client boleh banding rev terakhir diterima vs rev
// semasa melalui event 'hello' — jika tertinggal, full resync.
//
// BATASAN SERVERLESS (Vercel): `subs` + `revCounters` ialah in-memory —
// sambungan SSE dan penulisan admin boleh mendarat pada instance fungsi
// BERBEZA, jadi bumpRev mungkin tiada subscriber untuk diberitahu; had masa
// fungsi (~60sa hobby) juga memutuskan stream. Paparan/display-core ada
// fallback poll 10sa (bumpRev tetap menaikkan _rev yang dikesan semula),
// jadi kelakuan DEGRADED dengan selamat: sync kekal berlaku, hanya bukan
// "segera <2sa". Untuk instant-sync sebenar di prod, gunakan pub/sub luar
// (cth. Turso/Redis/Ably) atau terima mod polling.

import type { FastifyInstance } from 'fastify';
import type { CloudStore } from './store.js';

interface Sub {
  tenantId: string;
  send: (event: string, data: unknown) => void;
  close: () => void;
}

const subs = new Set<Sub>();
const revCounters = new Map<string, number>();
// Siling subscriber setiap instance — pada serverless, jika platform membekukan
// fungsi tanpa 'close' bersih, Set boleh membesar tanpa had (S1-b).
const MAX_SUBS = 500;

// Pengurangan kos Hobby: tetapkan MASJIDTV_DISABLE_SSE=1 untuk mematikan SSE
// sepenuhnya pada Vercel dan bergantung pada fallback poll paparan (10sa).
// Paparan masih sync — cuma bukan "segera <2sa" (lihat PLAN.md nota SSE).
// Semasa disable, /api/events membalas 503 serta-merta; varian paparan awan
// dengan sseEnabled:false tidak membuka EventSource langsung (tiada reconnect
// churn), jadi poll 10sa mengambil alih secara senyap.
const SSE_DISABLED = process.env.MASJIDTV_DISABLE_SSE === '1';

// Hayat maksimum sambungan SSE per sub — elak sambungan terbuka tanpa had yang
// membakar GB-saat pada Hobby (serverless membilas setiap saat sementara fungsi
// hidup). Paparan auto-reconnect selepas putus; rev catch-up menutup jurang.
const MAX_SUB_AGE_MS = Number(process.env.MASJIDTV_SSE_MAX_AGE_MS || 30 * 60 * 1000);

export function bumpRev(tenantId: string): number {
  const next = (revCounters.get(tenantId) || 0) + 1;
  revCounters.set(tenantId, next);
  // Broadcast kepada semua sambungan tenant ini.
  for (const s of subs) {
    if (s.tenantId === tenantId) {
      try {
        s.send('sync', { rev: next });
      } catch {
        subs.delete(s);
      }
    }
  }
  return next;
}

export function currentRev(tenantId: string): number {
  return revCounters.get(tenantId) || 0;
}

// Pulih rev selepas restart sejuk (rev dari settings._rev jika ada).
export function restoreRev(tenantId: string, rev: number): void {
  if (rev > (revCounters.get(tenantId) || 0)) revCounters.set(tenantId, rev);
}

export function registerSse(app: FastifyInstance, store: CloudStore): void {
  app.get('/api/events', async (req, reply) => {
    // SSE dimatikan (pengurangan kos Hobby) — paparan jatuh ke poll 10sa.
    if (SSE_DISABLED) {
      reply.status(503).send({ error: 'SSE dilumpuhkan — guna polling' });
      return;
    }
    // Auth sama seperti API paparan: x-device-token / x-tenant-key / Bearer.
    const h = req.headers;
    let tenantId: string | null = null;
    const devToken = String(h['x-device-token'] || '');
    const apiKey = String(h['x-tenant-key'] || '');
    const bearer = String(h.authorization || '').replace(/^Bearer /, '');
    if (devToken) {
      const t = await store.getTenantByDeviceToken(devToken);
      if (t) tenantId = t.id;
    }
    if (!tenantId && apiKey) {
      const t = await store.getTenantByApiKey(apiKey);
      if (t) tenantId = t.id;
    }
    if (!tenantId && bearer) {
      try {
        const { verifyToken } = await import('./auth.js');
        const payload = verifyToken(bearer);
        if (payload?.role === 'admin' && payload?.tid && payload?.uid) {
          // Sahkan pengguna masih aktif & versi token semasa — elak token lama
          // (pengguna dilumpuhkan / kata laluan ditukar) memegang sambungan SSE.
          const user = await store.getUserById(String(payload.uid));
          if (user && user.tenantId === payload.tid && user.active === 1
            && Number(user.tokenVersion || 0) === Number(payload.v || 0)) {
            tenantId = String(payload.tid);
          }
        }
      } catch { /* token tidak sah */ }
    }
    if (!tenantId) {
      reply.status(401).send({ error: 'Sesi tidak sah' });
      return;
    }
    if (subs.size >= MAX_SUBS) {
      reply.status(503).send({ error: 'Terlalu banyak sambungan — cuba lagi' });
      return;
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    reply.raw.write(`retry: 3000\n\n`);
    const sub: Sub = {
      tenantId,
      send: (event, data) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close: () => { reply.raw.end(); }
    };
    subs.add(sub);
    // Hello membawa rev semasa — client tahu jika tertinggal segera.
    sub.send('hello', { rev: currentRev(tenantId) });

    // Heartbeat 25sa — elak timeout proxy/idle kill (Vercel caps pada ~ juga,
    // client auto-reconnect dan rev catch-up menutup jurang).
    const hb = setInterval(() => {
      try {
        reply.raw.write(`: hb\n\n`);
      } catch {
        subs.delete(sub);
        clearInterval(hb);
      }
    }, 25_000);

    const drop = () => {
      subs.delete(sub);
      clearInterval(hb);
      clearTimeout(maxAge);
    };
    req.raw.on('close', drop);
    reply.raw.on('error', drop);

    // Had hayat sambungan — tutup selepas MAX_SUB_AGE_MS supaya tiada sub yang
    // tersangkut terbuka tanpa had (GB-saat pada serverless). Paparan
    // auto-reconnect dan rev catch-up menyambung tanpa kehilangan data.
    const maxAge = setTimeout(() => {
      try {
        reply.raw.write('event: hello\ndata: {}\n\n');
      } catch { /* ditutup sudah */ }
      drop();
    }, MAX_SUB_AGE_MS);
    maxAge.unref?.();
  });
}
