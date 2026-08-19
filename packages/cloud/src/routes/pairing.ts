// Laluan pemadanan peranti TV (mula kod + status). Diakses oleh TV kiosk
// tanpa auth — hanya rate-limit IP melindungi daripada brute-force.

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { checkRateLimit, recordFailure } from '../auth.js';
import { jsonError, ipOf } from './helpers.js';
import type { RouteContext } from './context.js';

const PAIR_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function registerPairingRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, store } = ctx;

  app.post('/api/pair/start', async (req, reply) => {
    const ip = ipOf(req);
    // Kunci v2: had lebih longgar (permintaan sah = 1 kembara setiap pelancaran
    // aplikasi TV) + tempoh kunci pendek. Tetapan lama terlalu ketat — TV yang
    // dimulakan semula berulang kali (pemasangan/sideload) mengunci dirinya.
    const rl = await checkRateLimit(db, `pair-start-v2:${ip}`);
    if (rl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan — cuba lagi kemudian');
    await recordFailure(db, `pair-start-v2:${ip}`, 120, 5 * 60 * 1000);
    const { deviceId } = (req.body || {}) as { deviceId?: string };
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 100) return jsonError(reply, 400, 'deviceId diperlukan');
    let code = '';
    // Had iterasi: ruang 32^6 ≈ 1.07B jadi perlanggaran hampir mustahil, tetapi
    // gelung tak terbatas pada laluan panas wajar dihadkan (S4-b).
    for (let attempt = 0; attempt < 10; attempt++) {
      code = Array.from({ length: 6 }, () => PAIR_CODE_CHARS[crypto.randomInt(PAIR_CODE_CHARS.length)]).join('');
      if (!(await store.getPairingSession(code))) break;
      code = '';
    }
    if (!code) return jsonError(reply, 503, 'Gagal menjana kod — cuba lagi');
    await store.createPairingSession(code, deviceId.slice(0, 100), 15 * 60 * 1000);
    reply.send({ code, expiresAt: Date.now() + 15 * 60 * 1000 });
  });

  app.get('/api/pair/status', async (req, reply) => {
    const { code, device } = req.query as { code?: string; device?: string };
    if (!code || !device) return jsonError(reply, 400, 'Parameter tidak lengkap');
    const codeUpper = String(code).toUpperCase();
    const ip = ipOf(req);
    // Kunci hanya dienforced terhadap brute-force: poll TV sah (kod wujud)
    // tidak dikira sebagai kegagalan — jika tidak TV yang menunggu lama akan
    // mengunci dirinya sendiri (20 poll/min × 15 min = 300, dekat had 400).
    const ipKey = `pair-status-v2:${ip}`;
    const ipRl = await checkRateLimit(db, ipKey);
    if (ipRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan — cuba lagi kemudian');
    const s = await store.getPairingSession(codeUpper);
    if (!s) {
      // Kod tidak wujud = tanda brute-force — barulah kira.
      await recordFailure(db, ipKey, 400, 15 * 60 * 1000);
      return reply.send({ status: 'not_found' });
    }
    if (Date.now() > Number(s.expiresAt)) return reply.send({ status: 'expired' });
    if (s.status !== 'paired' || !s.tenantId) return reply.send({ status: 'pending' });
    const dev = await store.getDeviceByPair(String(device), s.tenantId);
    if (!dev) return reply.send({ status: 'pending' });
    const tenant = await store.getTenant(s.tenantId);
    reply.send({ status: 'paired', token: dev.token, tenantName: tenant?.name || '' });
  });
}
