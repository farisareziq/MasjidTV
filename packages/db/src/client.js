// Client factory: better-sqlite3 for local, @libsql/client for cloud.
// Both drivers are wrapped so callers get a consistent surface. Drizzle is
// used for type-safe queries; raw SQL is used for migrations/seed parity.
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient as createLibsqlClient } from '@libsql/client';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
// Local SQLite file (better-sqlite3). `filePath` is a filesystem path.
export function createLocalClient(filePath) {
    const raw = new Database(filePath);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    const db = drizzle(raw, { schema });
    return { kind: 'local', raw, db, close: () => raw.close() };
}
// In-memory local client (tests).
export function createMemoryClient() {
    return createLocalClient(':memory:');
}
// Cloud client (Turso/libsql). `url` may be libsql://, https://, or file:.
export function createCloudClient(url, authToken) {
    const raw = createLibsqlClient({ url, authToken });
    const db = drizzleLibsql(raw, { schema });
    return { kind: 'cloud', raw, db, close: () => raw.close() };
}
// Apply the base schema (CREATE TABLE IF NOT EXISTS) for a given client.
export function applySchema(client) {
    if (client.kind === 'local') {
        client.raw.exec(LOCAL_SCHEMA_SQL);
    }
    else {
        client.raw.batch(CLOUD_SCHEMA_SQL);
    }
}
const LOCAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
`;
const CLOUD_SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    trial_until INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'trial',
    api_key TEXT NOT NULL,
    license_code TEXT DEFAULT '',
    license_verified_at INTEGER,
    settings TEXT NOT NULL DEFAULT '{}'
  )`,
    // Index laluan auth paparan (setiap poll display → getTenantByApiKey).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants (api_key)`,
    `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    token_version INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(tenant_id, username)
  )`,
    `CREATE TABLE IF NOT EXISTS superusers (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    must_change_pin INTEGER DEFAULT 1,
    token_version INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS cloud_announcements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
    // Index laluan paling panas cloud: /api/slides setiap 10sa per paparan.
    `CREATE INDEX IF NOT EXISTS idx_cloud_announcements_tenant ON cloud_announcements (tenant_id)`,
    `CREATE TABLE IF NOT EXISTS cloud_media (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    locked_until INTEGER DEFAULT 0
  )`,
    `CREATE TABLE IF NOT EXISTS pairing_sessions (
    code TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    tenant_id TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
    `CREATE TABLE IF NOT EXISTS tv_devices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen INTEGER DEFAULT 0,
    UNIQUE(tenant_id, device_id)
  )`,
    // Index auth peranti (x-device-token pada setiap permintaan paparan TV).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_tv_devices_token ON tv_devices (token)`
];
//# sourceMappingURL=client.js.map