// Perkongsian pembantu auth/tenant antara modul laluan dan hook global app.ts.
// Gelagat mesti kekal sama seperti app.ts asal — jangan ubah mesej/status.

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CloudStore, TenantRow } from '../store.js';
import { verifyToken } from '../auth.js';
import { licenseStatus, type LicenseStatus } from '../license.js';

// Types for request decorations.
export interface TenantReq {
  tenant?: TenantRow;
  license?: LicenseStatus;
  userId?: string;
  superuser?: unknown;
}

export function jsonError(reply: FastifyReply, status: number, message: string, code?: string): FastifyReply {
  return reply.status(status).send(code ? { error: message, code } : { error: message });
}

export function ipOf(req: FastifyRequest): string {
  return req.ip || req.socket?.remoteAddress || 'x';
}

// --- tenant resolution -------------------------------------------------

export async function tenantFromRequest(store: CloudStore, req: FastifyRequest): Promise<TenantRow | null> {
  const key = req.headers['x-tenant-key'];
  if (key) {
    const byKey = await store.getTenantByApiKey(String(key));
    if (byKey) return byKey;
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const payload = verifyToken(token);
  if (payload && payload.role === 'admin' && payload.tid) {
    // Sahkan pengguna masih aktif & versi token semasa — elak token lama
    // (pengguna dilumpuhkan / kata laluan ditukar) terus membaca data.
    const user = await store.getUserById(payload.uid);
    if (user && user.tenantId === payload.tid && user.active === 1
      && Number(user.tokenVersion || 0) === Number(payload.v || 0)) {
      const t = await store.getTenant(payload.tid);
      if (t) return t;
    }
  }
  const devToken = req.headers['x-device-token'];
  if (devToken) {
    const t = await store.getTenantByDeviceToken(String(devToken));
    if (t) return t;
  }
  return null;
}

export async function requireTenant(store: CloudStore, req: FastifyRequest, reply: FastifyReply): Promise<TenantRow | null> {
  const tenant = await tenantFromRequest(store, req);
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

export async function requireAdmin(store: CloudStore, req: FastifyRequest, reply: FastifyReply): Promise<TenantRow | null> {
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
  (req as FastifyRequest & TenantReq).tenant = tenant;
  (req as FastifyRequest & TenantReq).userId = user.id;
  (req as FastifyRequest & TenantReq).license = licenseStatus(tenant);
  // Gerbang lesen: laluan lesen/password mesti kekal boleh diakses walaupun
  // percubaan tamat — jika tidak, tenant tersekat tidak boleh mengaktifkan
  // lesen (kebuntuan ayam-bertelur).
  const path = req.url.split('?')[0];
  const licenseExempt = (req.method === 'POST' && path === '/api/admin/license')
    || (req.method === 'POST' && path === '/api/admin/password');
  if (!licenseExempt && !(req as FastifyRequest & TenantReq).license!.unlocked) {
    jsonError(reply, 403, (req as FastifyRequest & TenantReq).license!.message || 'Lesen diperlukan', 'LICENSE_REQUIRED');
    return null;
  }
  return tenant;
}

export async function requireSuperuser(store: CloudStore, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
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
