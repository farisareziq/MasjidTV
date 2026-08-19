// Turso restore — rebuild cloud tables from a turso-backup.mjs JSON dump.
// Usage: node scripts/turso-restore.mjs <backup.json> [--yes]
//
// WARNING: destructive — truncates each table present in the backup before
// reinserting rows. Run against an EMPTY/new database unless you know what
// you are doing. Tables absent from the backup are left untouched.
import { createCloudClient, applySchema, tenants, users, superusers, cloudAnnouncements, cloudMedia, pairingSessions, tvDevices } from '../packages/db/dist/index.js';
import fs from 'node:fs';

// DB table name (as written by turso-backup.mjs) -> Drizzle table export.
const TABLES = {
  tenants,
  users,
  superusers,
  cloud_announcements: cloudAnnouncements,
  cloud_media: cloudMedia,
  pairing_sessions: pairingSessions,
  tv_devices: tvDevices
};

const [file, ...rest] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node scripts/turso-restore.mjs <backup.json> [--yes]');
  process.exit(1);
}
const assumeYes = rest.includes('--yes');
const allowFile = rest.includes('--allow-file'); // local drill/testing only

const url = process.env.TURSO_URL;
const token = process.env.TURSO_AUTH_TOKEN || '';
if (!url || !(url.startsWith('libsql://') || (allowFile && url.startsWith('file:')))) {
  console.error('TURSO_URL (libsql://...) is required — refusing to restore to a local file (use --allow-file for a local drill).');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
const tables = Object.keys(backup.tables || {});
if (tables.length === 0) {
  console.error('Backup contains no tables — nothing to restore.');
  process.exit(1);
}

const rowCounts = tables.map((t) => `${t}: ${(backup.tables[t] || []).length} rows`).join(', ');
console.log(`[restore] target ${url}\n[restore] source ${file} (exported ${backup.exportedAt})\n[restore] ${rowCounts}`);

if (!assumeYes) {
  console.log('\nThis will TRUNCATE the tables above on the target database. Re-run with --yes to confirm.');
  process.exit(0);
}

const client = await createCloudClient(url, token);
await applySchema(client);

// Map a raw row (DB column names, e.g. tenant_id) to Drizzle's TS property
// names (tenantId) using each table's column definitions.
function toDrizzleRow(table, rawRow) {
  const out = {};
  for (const [prop, col] of Object.entries(table)) {
    if (col && typeof col === 'object' && 'name' in col && rawRow[col.name] !== undefined) {
      out[prop] = rawRow[col.name];
    }
  }
  return out;
}

let inserted = 0;
for (const t of tables) {
  const table = TABLES[t];
  if (!table) {
    console.warn(`[restore] ${t}: unknown table in schema — skipped`);
    continue;
  }
  const rows = backup.tables[t] || [];
  await client.raw.execute(`DELETE FROM ${t}`);
  for (const rawRow of rows) {
    await client.db.insert(table).values(toDrizzleRow(table, rawRow));
    inserted++;
  }
  console.log(`[restore] ${t}: restored ${rows.length} rows`);
}

console.log(`[restore] done — ${inserted} rows total.`);
client.close();
