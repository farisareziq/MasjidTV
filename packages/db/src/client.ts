// Client factory: better-sqlite3 for local, @libsql/client for cloud.
// Both drivers are wrapped so callers get a consistent surface. Drizzle is
// used for type-safe queries; raw SQL is used for migrations/seed parity.
// NOTE: better-sqlite3 is imported LAZILY (dynamic import inside
// createLocalClient) so cloud/serverless bundles that only use the libsql
// path never load the native addon.
//
// DUAL-MODE: bila env MASJIDTV_NODE_SQLITE=1 (atau better-sqlite3 gagal
// dimuat, cth. dalam binari SEA tanpa addon native), guna node:sqlite
// (terbina dalam Node >= 22.5) melalui shim serasi better-sqlite3.

import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibsql, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

// @libsql/client hanya dipuatkan secara LAZY dalam createCloudClient —
// pelayan lokal (termasuk binari SEA, di mana modul native libsql
// distubkeluarkan) tidak pernah memuatkan ia pada bootstrap.
type LibsqlClientFactory = typeof import('@libsql/client')['createClient'];
let libsqlFactory: LibsqlClientFactory | null = null;
async function loadLibsql(): Promise<LibsqlClientFactory> {
  if (!libsqlFactory) {
    const mod = await import('@libsql/client');
    libsqlFactory = mod.createClient;
  }
  return libsqlFactory;
}

export type LocalDatabase = BetterSQLite3Database<typeof schema>;
export type CloudDatabase = LibSQLDatabase<typeof schema>;

/** Subset better-sqlite3 yang digunakan aplikasi (drizzle + store). */
export interface SqliteRaw {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  pragma(src: string): unknown;
  /** better-sqlite3: transaction(fn) PULANGKAN fungsi boleh laksana. */
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

export interface LocalClient {
  kind: 'local';
  /** better-sqlite3 Database ATAU shim node:sqlite (SEA) — lihat SqliteRaw. */
  raw: SqliteRaw;
  db: LocalDatabase;
  driver: 'better-sqlite3' | 'node:sqlite';
  close: () => void;
}

export interface CloudClient {
  kind: 'cloud';
  raw: ReturnType<LibsqlClientFactory>;
  db: CloudDatabase;
  close: () => void;
}

export type AppClient = LocalClient | CloudClient;

// Shim node:sqlite (DatabaseSync) kepada surface better-sqlite3 yang
// digunakan aplikasi. Perbezaan yang ditutup:
//   - node:sqlite tiada .transaction() → implement via BEGIN/COMMIT/ROLLBACK
//   - node:sqlite .all() pulang baris null-prototype → Object.create(null)
//     sudah serasi dengan drizzle; bungkus sebagai objek biasa untuk kekal
//     selamat dengan JSON.stringify kaller lama.
//   - run() pulang {changes, lastInsertRowid} — nama medan sama.
function wrapNodeSqlite(db: import('node:sqlite').DatabaseSync): SqliteRaw {
  const plain = (row: unknown): unknown => {
    if (row === null || row === undefined || typeof row !== 'object') return row;
    return { ...(row as Record<string, unknown>) };
  };
  const wrapStatement = (st: import('node:sqlite').StatementSync) => {
    const self = {
      run: (...params: unknown[]) => {
        const r = st.run(...(params as never[])) as { changes: number | bigint; lastInsertRowid: number | bigint };
        return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
      },
      get: (...params: unknown[]) => plain(st.get(...(params as never[]))),
      all: (...params: unknown[]) => (st.all(...(params as never[])) as unknown[]).map(plain),
      iterate: (...params: unknown[]) => st.iterate(...(params as never[])) as IterableIterator<unknown>,
      // Drizzle better-sqlite3 PreparedQuery: stmt.raw() ialah KAEDAH
      // better-sqlite3 yang menukar statement kepada mod baris-mentah
      // (array nilai) dan MEMULANGKAN statement itu sendiri. Pulangkan
      // wrapper yang menyokong .get/.all sebagai array — kami format
      // melalui Object.values supaya mapResultRow terima array seperti
      // better-sqlite3 mod raw.
      raw: (_mode?: boolean) => ({
        get: (...params: unknown[]) => {
          const row = st.get(...(params as never[])) as Record<string, unknown> | undefined;
          return row === undefined ? undefined : Object.values(row);
        },
        all: (...params: unknown[]) => {
          const rows = st.all(...(params as never[])) as Record<string, unknown>[];
          return rows.map(Object.values);
        }
      })
    };
    return self;
  };
  return {
    prepare(sql: string) {
      const wrapped = wrapStatement(db.prepare(sql));
      // Drizzle memanggil stmt.raw(true/false) semasa migrasi schema —
      // pulangkan iterator baris mentah; surface kami sudah serasi.
      return wrapped;
    },
    exec: (sql: string) => db.exec(sql),
    pragma: (src: string) => db.exec(`PRAGMA ${src}`),
    // better-sqlite3 contract: transaction(fn) PULANGKAN fungsi; laksana
    // BEGIN/fn/COMMIT hanya bila fungsi itu dipanggil.
    transaction<T>(fn: () => T): () => T {
      return () => {
        db.exec('BEGIN');
        try {
          const out = fn();
          db.exec('COMMIT');
          return out;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* autocommit mungkin sudah rollback */
          }
          throw err;
        }
      };
    },
    close: () => db.close()
  };
}

// Local SQLite file. Driver: better-sqlite3 (lalai) atau node:sqlite bila
// MASJIDTV_NODE_SQLITE=1 / addon gagal dimuatkan (SEA bundel).
export async function createLocalClient(filePath: string): Promise<LocalClient> {
  if (!process.env.MASJIDTV_NODE_SQLITE) {
    try {
      const { default: Database } = await import('better-sqlite3');
      const raw = new Database(filePath) as unknown as SqliteRaw;
      raw.pragma('journal_mode = WAL');
      raw.pragma('foreign_keys = ON');
      const db = drizzle(raw as never, { schema });
      return { kind: 'local', raw, db, driver: 'better-sqlite3', close: () => raw.close() };
    } catch (err) {
      // Jatuh kepada node:sqlite — kecuali fail DB sendiri bermasalah
      // ( SQLITE_NOTDB dsb.), itu mesti kekal ralat.
      const msg = err instanceof Error ? err.message : String(err);
      if (/SQLITE_|file is not a database|unable to open/i.test(msg)) throw err;
      console.warn(`[db] better-sqlite3 tidak tersedia (${msg}) — guna node:sqlite`);
    }
  }
  const { DatabaseSync } = await import('node:sqlite');
  const raw = wrapNodeSqlite(new DatabaseSync(filePath));
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  const db = drizzle(raw as never, { schema });
  return { kind: 'local', raw, db, driver: 'node:sqlite', close: () => raw.close() };
}

// In-memory local client (tests).
export function createMemoryClient(): Promise<LocalClient> {
  return createLocalClient(':memory:');
}

// Cloud client (Turso/libsql). `url` may be libsql://, https://, or file:.
// Async kerana @libsql/client dimuatkan secara lazy (keserasian SEA).
export async function createCloudClient(url: string, authToken?: string): Promise<CloudClient> {
  const createLibsqlClient = await loadLibsql();
  const raw = createLibsqlClient({ url, authToken });
  const db = drizzleLibsql(raw, { schema });
  return { kind: 'cloud', raw, db, close: () => raw.close() };
}

// Apply the base schema (CREATE TABLE IF NOT EXISTS) for a given client.
export function applySchema(client: AppClient): void {
  if (client.kind === 'local') {
    client.raw.exec(LOCAL_SCHEMA_SQL);
  } else {
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
