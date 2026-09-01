import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// Local (single-tenant) tables — offline-first mini PC server.
// ---------------------------------------------------------------------------

// Settings stored as a single JSON document (mirrors reference settings.json).
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: integer('updated_at').notNull()
});

// Announcements (replaces reference announcements.json).
export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  createdAt: integer('created_at').notNull()
});

// Login attempt rate limiting (local admin).
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  lockedUntil: integer('locked_until').notNull().default(0)
});

// Cermin data waktu solat JAKIM (e-Solat) — cache luar talia untuk SEMUA zon.
// Dipenuhi oleh fetch rangkaian (minggu semasa) + sync tahunan (semua zon).
// Suntingan manual admin TIDAK disimpan di sini — ia dalam settings
// (prayer.overrides) supaya tersebar merentas peranti melalui saluran tetapan
// sedia ada. Hijri = JSON {year,month,day} atau ''.
export const jakimTimes = sqliteTable('jakim_times', {
  zone: text('zone').notNull(),
  dateKey: text('date_key').notNull(),
  hijri: text('hijri').notNull().default(''),
  imsak: text('imsak'),
  fajr: text('fajr'),
  syuruk: text('syuruk'),
  dhuha: text('dhuha'),
  dhuhr: text('dhuhr'),
  asr: text('asr'),
  maghrib: text('maghrib'),
  isha: text('isha'),
  syncedAt: integer('synced_at').notNull().default(0)
}, (t) => ({
  pk: primaryKey({ columns: [t.zone, t.dateKey] })
}));

// ---------------------------------------------------------------------------
// Cloud (multi-tenant) tables — used only by the cloud app.
// ---------------------------------------------------------------------------

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  trialUntil: integer('trial_until').notNull(),
  status: text('status').notNull().default('trial'),
  apiKey: text('api_key').notNull(),
  licenseCode: text('license_code').notNull().default(''),
  licenseVerifiedAt: integer('license_verified_at'),
  settings: text('settings').notNull().default('{}')
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull().default(''),
  active: integer('active').notNull().default(1),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: integer('created_at').notNull()
});

export const superusers = sqliteTable('superusers', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  pinHash: text('pin_hash').notNull(),
  mustChangePin: integer('must_change_pin').notNull().default(1),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: integer('created_at').notNull()
});

export const cloudAnnouncements = sqliteTable('cloud_announcements', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  data: text('data').notNull(),
  createdAt: integer('created_at').notNull()
});

export const cloudMedia = sqliteTable('cloud_media', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  filename: text('filename').notNull(),
  kind: text('kind').notNull(),
  createdAt: integer('created_at').notNull()
});

export const pairingSessions = sqliteTable('pairing_sessions', {
  code: text('code').primaryKey(),
  deviceId: text('device_id').notNull(),
  status: text('status').notNull().default('pending'),
  tenantId: text('tenant_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull()
});

export const tvDevices = sqliteTable('tv_devices', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  deviceId: text('device_id').notNull(),
  name: text('name').notNull().default(''),
  token: text('token').notNull(),
  createdAt: integer('created_at').notNull(),
  lastSeen: integer('last_seen').notNull().default(0),
  // Laporan perkakasan terkini dari kiosk (kamera USB dsb.) — JSON string.
  hwReport: text('hw_report').notNull().default('')
});
