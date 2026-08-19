// Laluan superuser: pengurusan tenant (CRUD), lesen tenant, api-key, pengguna.
// Semua memerlukan requireSuperuser.

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { syncEventsFor } from '@masjidtv/shared';
import { verifyLicense, licenseStatus } from '../license.js';
import { jsonError, requireSuperuser } from './helpers.js';
import type { RouteContext } from './context.js';

export function registerSuperRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { store } = ctx;

  app.get('/api/super/tenants', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
    const list = await store.listTenants();
    reply.send(list.map((t) => ({ ...t, settings: undefined, license: licenseStatus(t) })));
  });

  app.post('/api/super/tenants', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
    const { name, username, password } = (req.body || {}) as { name?: string; username?: string; password?: string };
    if (!String(name || '').trim()) return jsonError(reply, 400, 'Nama masjid diperlukan');
    if (!String(username || '').trim()) return jsonError(reply, 400, 'Username admin diperlukan');
    if (String(username).toLowerCase() === 'admin') return jsonError(reply, 400, 'Username "admin" dikhaskan untuk superuser');
    if (String(password || '').length < 6) return jsonError(reply, 400, 'Kata laluan mesti sekurang-kurangnya 6 aksara');
    const existing = await store.getUserByUsername(String(username));
    if (existing) return jsonError(reply, 409, 'Username sudah wujud');
    const tenant = await store.createTenant({ name: String(name).trim(), username: String(username).trim(), password: String(password) });
    syncEventsFor(tenant.settings, async (patch) => {
      await store.updateSettings(tenant.id, patch as Record<string, unknown>);
    }, true).catch(() => {});
    reply.status(201).send({ id: tenant.id, name: tenant.name, apiKey: tenant.apiKey, trialUntil: tenant.trialUntil, status: tenant.status });
  });

  app.get('/api/super/tenants/:id', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    reply.send({ ...t, settings: undefined, license: licenseStatus(t) });
  });

  app.patch('/api/super/tenants/:id', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
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
    if (!(await requireSuperuser(store, req, reply))) return;
    await store.deleteTenant((req.params as { id: string }).id);
    reply.send({ ok: true });
  });

  app.post('/api/super/tenants/:id/license', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
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
    if (!(await requireSuperuser(store, req, reply))) return;
    const t = await store.getTenant((req.params as { id: string }).id);
    if (!t) return jsonError(reply, 404, 'Tenant tidak dijumpai');
    const apiKey = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 40);
    const updated = await store.saveTenant(t.id, { api_key: apiKey });
    reply.send({ apiKey: updated!.apiKey });
  });

  app.get('/api/super/tenants/:id/users', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
    reply.send(await store.listUsers((req.params as { id: string }).id));
  });

  app.post('/api/super/tenants/:id/users', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
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
    if (!(await requireSuperuser(store, req, reply))) return;
    const u = await store.getUserById((req.params as { id: string }).id);
    if (!u) return jsonError(reply, 404, 'Pengguna tidak dijumpai');
    await store.deleteUser(u.tenantId, u.id);
    reply.send({ ok: true });
  });

  app.patch('/api/super/users/:id', async (req, reply) => {
    if (!(await requireSuperuser(store, req, reply))) return;
    const u = await store.getUserById((req.params as { id: string }).id);
    if (!u) return jsonError(reply, 404, 'Pengguna tidak dijumpai');
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.active === 'boolean') await store.setUserActive(u.tenantId, u.id, body.active);
    if (typeof body.password === 'string' && body.password.length >= 6) await store.resetUserPassword(u.tenantId, u.id, body.password);
    reply.send({ ok: true });
  });
}
