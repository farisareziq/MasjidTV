// Akses data ber-tenant via Drizzle (libsql). Semua query ditapis mengikut tenant_id.
// Port of reference cloud/store.js. NOTE: libsql drizzle queries are async, so
// every method awaits its query.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  tenants, users, superusers, cloudAnnouncements, cloudMedia,
  pairingSessions, tvDevices, loginAttempts, eq, and, lt, sql, type CloudDatabase
} from '@masjidtv/db';
import { DEFAULT_SETTINGS, applyPatch, type Settings, type Announcement } from '@masjidtv/shared';
import { hashPassword } from './auth.js';

function now(): number {
  return Date.now();
}

// Parse JSON hw_report dengan selamat (data rosak → null).
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
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

  // In-memory tenant cache (30s TTL). Eliminates the Turso round-trip on the
  // hot poll path — display polls every 30s with the same API key. Writes bust
  // the cache so admin changes are visible on the next poll (max 30s stale).
  private _tenantCache = new Map<string, TenantRow>();
  private _tenantCacheExpiry = new Map<string, number>();
  private static readonly CACHE_TTL = 30_000;

  private _cacheTenant(row: TenantRow): TenantRow {
    const exp = now() + CloudStore.CACHE_TTL;
    this._tenantCache.set(`id:${row.id}`, row);
    this._tenantCache.set(`key:${row.apiKey}`, row);
    this._tenantCacheExpiry.set(`id:${row.id}`, exp);
    this._tenantCacheExpiry.set(`key:${row.apiKey}`, exp);
    return row;
  }

  private _bustTenant(tenantId: string): void {
    const row = this._tenantCache.get(`id:${tenantId}`);
    this._tenantCache.delete(`id:${tenantId}`);
    this._tenantCacheExpiry.delete(`id:${tenantId}`);
    if (row) {
      this._tenantCache.delete(`key:${row.apiKey}`);
      this._tenantCacheExpiry.delete(`key:${row.apiKey}`);
    }
  }

  private _cached(key: string): TenantRow | null {
    const row = this._tenantCache.get(key);
    if (!row) return null;
    const exp = this._tenantCacheExpiry.get(key);
    if (!exp || now() > exp) {
      this._tenantCache.delete(key);
      this._tenantCacheExpiry.delete(key);
      return null;
    }
    return row;
  }

  // Device-token cache (30s TTL). Eliminates the tvDevices lookup DB
  // round-trip on kiosk polls. The throttled lastSeen write still fires
  // based on the cached lastSeen value.
  private _deviceCache = new Map<string, { tenantId: string; lastSeen: number }>();
  private _deviceCacheExpiry = new Map<string, number>();

  private _cacheDevice(token: string, tenantId: string, lastSeen: number): void {
    const exp = now() + CloudStore.CACHE_TTL;
    this._deviceCache.set(`dev:${token}`, { tenantId, lastSeen });
    this._deviceCacheExpiry.set(`dev:${token}`, exp);
  }

  private _cachedDevice(token: string): { tenantId: string; lastSeen: number } | null {
    const dev = this._deviceCache.get(`dev:${token}`);
    if (!dev) return null;
    const exp = this._deviceCacheExpiry.get(`dev:${token}`);
    if (!exp || now() > exp) {
      this._deviceCache.delete(`dev:${token}`);
      this._deviceCacheExpiry.delete(`dev:${token}`);
      return null;
    }
    return dev;
  }

  private _bustDevice(token: string): void {
    this._deviceCache.delete(`dev:${token}`);
    this._deviceCacheExpiry.delete(`dev:${token}`);
  }

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
        // Laluan boleh diatasi env (ujian/terisolasi) — lalai tetap tempatan
        // mesin supaya pemasang boleh membacanya selepas deploy awal.
        const file = process.env.MASJIDTV_SUPERUSER_PIN_FILE
          || path.join(os.tmpdir(), 'MASJIDTV_SUPERUSER_PIN.txt');
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
    const cached = this._cached(`id:${id}`);
    if (cached) return cached;
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).all();
    return rows[0] ? this._cacheTenant(rowToTenant(rows[0])) : null;
  }

  async getTenantByApiKey(key: string): Promise<TenantRow | null> {
    const cached = this._cached(`key:${key}`);
    if (cached) return cached;
    const rows = await this.db.select().from(tenants).where(eq(tenants.apiKey, key)).all();
    return rows[0] ? this._cacheTenant(rowToTenant(rows[0])) : null;
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
    this._bustTenant(id);
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

  // Senarai media tenant (pustaka media admin) — disusun terkini dahulu.
  async listMedia(tenantId: string) {
    const rows = await this.db.select({
      id: cloudMedia.id, filename: cloudMedia.filename,
      kind: cloudMedia.kind, createdAt: cloudMedia.createdAt
    }).from(cloudMedia).where(eq(cloudMedia.tenantId, tenantId)).all();
    return rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  }

  // Ambil satu baris media (ditapis tenant — elak baca/padam merentas tenant).
  async getMedia(tenantId: string, id: string) {
    const rows = await this.db.select().from(cloudMedia)
      .where(and(eq(cloudMedia.tenantId, tenantId), eq(cloudMedia.id, id))).all();
    return rows[0] || null;
  }

  async deleteMedia(tenantId: string, id: string): Promise<void> {
    await this.db.delete(cloudMedia).where(and(eq(cloudMedia.tenantId, tenantId), eq(cloudMedia.id, id))).run();
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

  async pairSession(code: string, tenantId: string): Promise<boolean> {
    // Kemas kini bersyarat (Compare-And-Swap): hanya tuntut sesi masih
    // 'pending'. 0 baris berubah = kod sudah dipasangkan oleh admin lain —
    // pemanggil mesti anggap gagal dan gulung balik peranti yang dicipta.
    const result = await this.db.run(
      sql`UPDATE pairing_sessions SET status = 'paired', tenant_id = ${tenantId} WHERE code = ${code} AND status = 'pending'`
    );
    return Number((result as unknown as { rowsAffected?: number; changes?: number })?.rowsAffected
      ?? (result as unknown as { changes?: number })?.changes
      ?? 0) > 0;
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
    const cached = this._cachedDevice(token);
    let tenantId: string;
    let lastSeen: number;
    if (cached) {
      tenantId = cached.tenantId;
      lastSeen = cached.lastSeen;
    } else {
      const rows = await this.db.select().from(tvDevices).where(eq(tvDevices.token, token)).all();
      const dev = rows[0];
      if (!dev) return null;
      tenantId = dev.tenantId;
      lastSeen = Number(dev.lastSeen || 0);
      this._cacheDevice(token, tenantId, lastSeen);
    }
    // Throttle kemas kini lastSeen (≥1 minit) — elak tulisan DB setiap poll.
    if (now() - lastSeen > 60000) {
      const newLastSeen = now();
      await this.db.update(tvDevices).set({ lastSeen: newLastSeen }).where(eq(tvDevices.token, token)).run();
      this._cacheDevice(token, tenantId, newLastSeen);
    }
    return this.getTenant(tenantId);
  }

  async listDevices(tenantId: string) {
    const rows = await this.db.select({
      id: tvDevices.id, deviceId: tvDevices.deviceId, name: tvDevices.name,
      createdAt: tvDevices.createdAt, lastSeen: tvDevices.lastSeen,
      hwReport: tvDevices.hwReport
    }).from(tvDevices).where(eq(tvDevices.tenantId, tenantId)).all();
    return rows.map((r) => ({
      ...r,
      hw: r.hwReport ? safeParse(r.hwReport) : null
    }));
  }

  // Simpan laporan perkakasan peranti (kamera dsb.) — dipanggil oleh
  // kiosk heartbeat /api/device/report.
  async saveHwReport(token: string, report: unknown): Promise<void> {
    const json = JSON.stringify(report).slice(0, 4000);
    await this.db.update(tvDevices).set({ hwReport: json, lastSeen: now() })
      .where(eq(tvDevices.token, token)).run();
    const cached = this._deviceCache.get(`dev:${token}`);
    if (cached) this._cacheDevice(token, cached.tenantId, now());
  }

  async deleteDevice(tenantId: string, id: string): Promise<void> {
    await this.db.delete(tvDevices).where(and(eq(tvDevices.tenantId, tenantId), eq(tvDevices.id, id))).run();
  }

  async renameDevice(tenantId: string, id: string, name: string): Promise<void> {
    await this.db.update(tvDevices).set({ name }).where(and(eq(tvDevices.tenantId, tenantId), eq(tvDevices.id, id))).run();
  }

  async deleteDeviceByToken(tenantId: string, token: string): Promise<void> {
    this._bustDevice(token);
    await this.db.delete(tvDevices).where(and(eq(tvDevices.tenantId, tenantId), eq(tvDevices.token, token))).run();
  }

  async deleteTenant(id: string): Promise<void> {
    this._bustTenant(id);
    await this.db.delete(tenants).where(eq(tenants.id, id)).run();
    await this.db.delete(users).where(eq(users.tenantId, id)).run();
    await this.db.delete(cloudAnnouncements).where(eq(cloudAnnouncements.tenantId, id)).run();
    await this.db.delete(cloudMedia).where(eq(cloudMedia.tenantId, id)).run();
    await this.db.delete(tvDevices).where(eq(tvDevices.tenantId, id)).run();
    await this.db.delete(pairingSessions).where(eq(pairingSessions.tenantId, id)).run();
  }

  // Pembersihan berkala: buang sesi pemadanan tamat tempoh dan kaunter
  // rate-limit yang telah matang — elak jadual membesar tanpa had (Turso).
  async purgeExpired(): Promise<void> {
    const t = now();
    await this.db.delete(pairingSessions).where(lt(pairingSessions.expiresAt, t - 3600_000)).run();
    await this.db.delete(loginAttempts).where(
      and(lt(loginAttempts.lockedUntil, t - 3600_000), lt(loginAttempts.count, 5))
    ).run();
  }
}
