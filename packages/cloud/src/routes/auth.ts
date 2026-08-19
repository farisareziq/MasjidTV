// Laluan auth: login superuser, tukar PIN superuser, login admin tenant.

import type { FastifyInstance } from 'fastify';
import {
  signToken, verifyToken, hashPassword, comparePassword, checkRateLimit, recordFailure, clearFailures
} from '../auth.js';
import { jsonError, ipOf } from './helpers.js';
import type { RouteContext } from './context.js';

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { db, store } = ctx;

  app.post('/api/auth/superuser/login', async (req, reply) => {
    const { username, pin } = (req.body || {}) as { username?: string; pin?: string };
    const ip = ipOf(req);
    const key = `su:${ip}:${String(username || '')}`;
    const ipKey = `su-ip:${ip}`;
    const [rl, ipRl] = await Promise.all([checkRateLimit(db, key), checkRateLimit(db, ipKey)]);
    if (rl.locked || ipRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan. Cuba lagi selepas 15 minit.');
    const su = await store.getSuperuser(String(username || ''));
    const ok = su && (await comparePassword(String(pin || ''), su.pinHash));
    if (!ok) {
      await recordFailure(db, key);
      await recordFailure(db, ipKey, 10, 15 * 60 * 1000);
      return jsonError(reply, 401, 'Username atau PIN salah');
    }
    await clearFailures(db, key);
    const token = signToken({ userId: su.id, tenantId: null, role: 'superuser', version: su.tokenVersion || 0 });
    reply.send({ token, role: 'superuser', mustChangePin: su.mustChangePin === 1, username: su.username });
  });

  app.post('/api/auth/superuser/pin', async (req, reply) => {
    const ip = ipOf(req);
    const rlKey = `su-pin:${ip}`;
    const rl = await checkRateLimit(db, rlKey);
    if (rl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan. Cuba lagi selepas 15 minit.');
    await recordFailure(db, rlKey, 20, 15 * 60 * 1000);
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const payload = verifyToken(token);
    if (!payload || payload.role !== 'superuser') return jsonError(reply, 401, 'Sesi superuser tidak sah');
    const su = await store.getSuperuser('admin');
    if (!su || su.id !== payload.uid) return jsonError(reply, 401, 'Sesi superuser tidak sah');
    if (Number(su.tokenVersion || 0) !== Number(payload.v || 0)) return jsonError(reply, 401, 'Sesi superuser tidak sah');
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
    const [rl, ipRl] = await Promise.all([checkRateLimit(db, key), checkRateLimit(db, ipKey)]);
    if (rl.locked || ipRl.locked) return jsonError(reply, 429, 'Terlalu banyak percubaan. Cuba lagi selepas 15 minit.');
    const user = await store.getUserByUsername(String(username || ''));
    const ok = user && user.active === 1 && (await comparePassword(String(password || ''), user.passwordHash));
    if (!ok) {
      await recordFailure(db, key);
      await recordFailure(db, ipKey, 30, 15 * 60 * 1000);
      return jsonError(reply, 401, 'Username atau kata laluan salah');
    }
    await clearFailures(db, key);
    await clearFailures(db, ipKey);
    const token = signToken({ userId: user.id, tenantId: user.tenantId, role: 'admin', version: user.tokenVersion || 0 });
    reply.send({ token, role: 'admin', username: user.username, name: user.name });
  });
}
