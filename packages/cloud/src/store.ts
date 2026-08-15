// Akses data ber-tenant via Drizzle (libsql). Semua query ditapis mengikut tenant_id.
// Port of reference cloud/store.js. NOTE: libsql drizzle queries are async, so
// every method awaits its query.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tenants, users, superusers, cloudAnnouncements, cloudMedia,
  pairingSessions, tvDevices, eq, and, type CloudDatabase
} from '@masjidtv/db';
import { DEFAULT_SETTINGS, applyPatch, type Settings, type Announcement } from '@masjidtv/shared';
import { hashPassword } from './auth.js';

function now(): number {
  return Date.now();
}

function uid(): string {
  return crypto.randomUUID();
}

export interface TenantRow {
  id: string;
  name: string;
  createdAt: number;
  trialUntil: number;
  status: string;
  apiKey: string;
  licenseCode: string;
  licenseVerifiedAt: number | null;
  settings: Settings;
}

type TenantSelect = typeof tenants.$inferSelect;

function rowToTenant(row: TenantSelect): TenantRow {
  return {
    id: row.id,
    name: row.name,
    createdAt: Number(row.createdAt),
    trialUntil: Number(row.trialUntil),
    status: row.status,
    apiKey: row.apiKey,
    licenseCode: row.licenseCode || '',
    licenseVerifiedAt: row.licenseVerifiedAt ? Number(row.licenseVerifiedAt) : null,
    settings: typeof row.settings === 'string' ? JSON.parse(row.settings) : {}
  };
}

export class CloudStore {
  constructor(private db: CloudDatabase) {}

  async seedSuperuser(): Promise<void> {
    // PIN bootstrap RAWAK (bukan 00000000 tetap) — ditulis ke fail setempat
    // sekali sahaja supaya tiada tetingkat masa untuk perebutan akaun pada
    // deployment awam. ON CONFLICT DO NOTHING — selamat untuk cold start
    // serentak di serverless.
    const rows = await this.db.select().from(superusers).where(eq(superusers.username, 'admin')).all();
    if (rows.length === 0) {
      const pin = crypto.randomBytes(6).toString('base64url');
      const pinHash = await hashPassword(pin);
      await this.db.insert(superusers)
        .values({ id: uid(), username: 'admin', pinHash, mustChangePin: 1, createdAt: now() })
        .onConflictDoNothing({ target: superusers.username })
        .run();
      try {
        const file = path.join(os.tmpdir(), 'MASJIDTV_SUPERUSER_PIN.txt');
        fs.writeFileSync(file, `MasjidTV superuser PIN\n=====================\n\nadmin / ${pin}\n\nChange it immediately after first login.\n`, 'utf8');
        console.log(`[cloud] Superuser 'admin' dicipta. PIN bootstrap: ${pin} (also in ${file}) — tukar selepas login pertama.`);
      } catch {
        console.log(`[cloud] Superuser 'admin' dicipta. PIN bootstrap: ${pin} — tukar selepas login pertama.`);
      }
    }
  }

  async getSuperuser(username: string) {
    const rows = await this.db.select().from(superusers).where(eq(superusers.username, username)).all();
    return rows[0] || null;
  }

  async setSuperuserPin(id: string, pinHash: string): Promise<void> {
    const su = await this.getSuperuser('admin');
    const nextVersion = Number(su?.tokenVersion || 0) + 1;
    await this.db.update(superusers)
      .set({ pinHash, mustChangePin: 0, tokenVersion: nextVersion })
      .where(eq(superusers.id, id))
      .run();
  }

  async createTenant({ name, username, password }: { name: string; username: string; password: string }): Promise<TenantRow> {
    const id = uid();
    const apiKey = `${uid().replace(/-/g, '')}${uid().replace(/-/g, '')}`.slice(0, 40);
    const t0 = now();
    const trialMs = 14 * 24 * 60 * 60 * 1000;
    const passwordHash = await hashPassword(password);
    await this.db.insert(tenants).values({
      id, name, createdAt: t0, trialUntil: t0 + trialMs, status: 'trial', apiKey,
      licenseCode: '', settings: JSON.stringify(DEFAULT_SETTINGS)
    }).run();
    await this.db.insert(users).values({
      id: uid(), tenantId: id, username, passwordHash, active: 1, tokenVersion: 0, createdAt: t0, name: ''
    }).run();
    return (await this.getTenant(id))!;
  }

  async getTenant(id: string): Promise<TenantRow | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).all();
    return rows[0] ? rowToTenant(rows[0]) : null;
  }

  async getTenantByApiKey(key: string): Promise<TenantRow | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.apiKey, key)).all();
    return rows[0] ? rowToTenant(rows[0]) : null;
  }

  async listTenants(): Promise<TenantRow[]> {
    const rows = await this.db.select().from(tenants).all();
    return rows.map(rowToTenant);
  }

  async saveTenant(id: string, patch: Record<string, unknown>): Promise<TenantRow | null> {
    const mapping: Record<string, keyof typeof tenants.$inferInsert> = {
      name: 'name', status: 'status', api_key: 'apiKey',
      license_code: 'licenseCode', license_verified_at: 'licenseVerifiedAt',
      trial_until: 'trialUntil', settings: 'settings'
    };
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const col = mapping[k];
      if (col) set[col] = v;
    }
    if (Object.keys(set).length > 0) {
      await this.db.update(tenants).set(set as never).where(eq(tenants.id, id)).run();
    }
    return this.getTenant(id);
  }

  async updateSettings(tenantId: string, patch: Record<string, unknown>): Promise<Settings | null> {
    const t = await this.getTenant(tenantId);
    if (!t) return null;
    const next = applyPatch(t.settings, patch);
    await this.saveTenant(tenantId, { settings: JSON.stringify(next) });
    return next;
  }

  async getUserByUsername(username: string) {
    const rows = await this.db.select().from(users).where(eq(users.username, username)).all();
    return rows[0] || null;
  }

  async getUserById(id: string) {
    const rows = await this.db.select().from(users).where(eq(users.id, id)).all();
    return rows[0] || null;
  }

  async createUser(tenantId: string, { username, password, name = '' }: { username: string; password: string; name?: string }) {
    const passwordHash = await hashPassword(password);
    const id = uid();
    await this.db.insert(users).values({ id, tenantId, username, passwordHash, name, active: 1, tokenVersion: 0, createdAt: now() }).run();
    return { id, username, name, active: 1 };
  }

  async listUsers(tenantId: string) {
    return this.db.select({ id: users.id, username: users.username, name: users.name, active: users.active, createdAt: users.createdAt })
      .from(users).where(eq(users.tenantId, tenantId)).all();
  }

  async deleteUser(tenantId: string, id: string): Promise<void> {
    await this.db.delete(users).where(and(eq(users.tenantId, tenantId), eq(users.id, id))).run();
  }

  async setUserActive(tenantId: string, id: string, active: boolean): Promise<void> {
    const u = await this.getUserById(id);
    const nextVersion = Number(u?.tokenVersion || 0) + 1;
    await this.db.update(users).set({ active: active ? 1 : 0, tokenVersion: nextVersion })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id))).run();
  }

  async resetUserPassword(tenantId: string, id: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const u = await this.getUserById(id);
    const nextVersion = Number(u?.tokenVersion || 0) + 1;
    await this.db.update(users).set({ passwordHash, tokenVersion: nextVersion })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, id))).run();
  }

  async listAnnouncements(tenantId: string): Promise<Announcement[]> {
    const rows = await this.db.select().from(cloudAnnouncements).where(eq(cloudAnnouncements.tenantId, tenantId)).all();
    return rows.map((r) => JSON.parse(r.data) as Announcement);
  }

  async getAnnouncement(tenantId: string, id: string): Promise<Announcement | null> {
    const rows = await this.db.select().from(cloudAnnouncements)
      .where(and(eq(cloudAnnouncements.tenantId, tenantId), eq(cloudAnnouncements.id, id))).all();
    return rows[0] ? JSON.parse(rows[0].data) : null;
  }

  async addAnnouncement(tenantId: string, item: Announcement): Promise<Announcement> {
    await this.db.insert(cloudAnnouncements).values({ id: item.id, tenantId, data: JSON.stringify(item), createdAt: now() }).run();
    return item;
  }

  async updateAnnouncement(tenantId: string, id: string, item: Announcement): Promise<Announcement> {
    await this.db.update(cloudAnnouncements).set({ data: JSON.stringify(item) })
      .where(and(eq(cloudAnnouncements.tenantId, tenantId), eq(cloudAnnouncements.id, id))).run();
    return item;
  }

  async deleteAnnouncement(tenantId: string, id: string): Promise<void> {
    await this.db.delete(cloudAnnouncements).where(and(eq(cloudAnnouncements.tenantId, tenantId), eq(cloudAnnouncements.id, id))).run();
  }

  async addMedia(tenantId: string, { filename, kind }: { filename: string; kind: string }): Promise<void> {
    await this.db.insert(cloudMedia).values({ id: uid(), tenantId, filename, kind, createdAt: now() }).run();
  }

  async createPairingSession(code: string, deviceId: string, ttlMs: number): Promise<void> {
    const t0 = now();
    await this.db.insert(pairingSessions).values({
      code, deviceId, status: 'pending', tenantId: '', createdAt: t0, expiresAt: t0 + ttlMs
    }).run();
  }

  async getPairingSession(code: string) {
    const rows = await this.db.select().from(pairingSessions).where(eq(pairingSessions.code, code)).all();
    return rows[0] || null;
  }

  async pairSession(code: string, tenantId: string): Promise<void> {
    await this.db.update(pairingSessions).set({ status: 'paired', tenantId })
      .where(eq(pairingSessions.code, code)).run();
  }

  async createDevice(tenantId: string, deviceId: string, name: string, token: string): Promise<void> {
    const existing = await this.db.select().from(tvDevices)
      .where(and(eq(tvDevices.tenantId, tenantId), eq(tvDevices.deviceId, deviceId))).all();
    if (existing[0]) {
      await this.db.update(tvDevices).set({ name, token }).where(eq(tvDevices.id, existing[0].id)).run();
    } else {
      await this.db.insert(tvDevices).values({ id: uid(), tenantId, deviceId, name, token, createdAt: now(), lastSeen: 0 }).run();
    }
  }

  async getDeviceByPair(deviceId: string, tenantId: string) {
    const rows = await this.db.select().from(tvDevices)
      .where(and(eq(tvDevices.deviceId, deviceId), eq(tvDevices.tenantId, tenantId))).all();
    return rows[0] || null;
  }

  async getTenantByDeviceToken(token: string): Promise<TenantRow | null> {
    const rows = await this.db.select().from(tvDevices).where(eq(tvDevices.token, token)).all();
    const dev = rows[0];
    if (!dev) return null;
    // Throttle kemas kini lastSeen (≥1 minit) — elak tulisan DB setiap poll 10sa.
    if (now() - Number(dev.lastSeen || 0) > 60000) {
      await this.db.update(tvDevices).set({ lastSeen: now() }).where(eq(tvDevices.token, token)).run();
    }
    return this.getTenant(dev.tenantId);
  }

  async listDevices(tenantId: string) {
    return this.db.select({
      id: tvDevices.id, deviceId: tvDevices.deviceId, name: tvDevices.name,
      createdAt: tvDevices.createdAt, lastSeen: tvDevices.lastSeen
    }).from(tvDevices).where(eq(tvDevices.tenantId, tenantId)).all();
  }

  async deleteDevice(tenantId: string, id: string): Promise<void> {
    await this.db.delete(tvDevices).where(and(eq(tvDevices.tenantId, tenantId), eq(tvDevices.id, id))).run();
  }

  async deleteTenant(id: string): Promise<void> {
    await this.db.delete(tenants).where(eq(tenants.id, id)).run();
    await this.db.delete(users).where(eq(users.tenantId, id)).run();
    await this.db.delete(cloudAnnouncements).where(eq(cloudAnnouncements.tenantId, id)).run();
    await this.db.delete(cloudMedia).where(eq(cloudMedia.tenantId, id)).run();
  }
}
