// Turso backup: dumps all cloud tables to a local JSON file.
// Usage: node scripts/turso-backup.mjs [--out backup.json]
import { createCloudClient } from '../packages/db/dist/index.js';
import fs from 'node:fs';

const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const url = process.env.TURSO_URL;
const token = process.env.TURSO_AUTH_TOKEN || '';
if (!url) {
  console.error('TURSO_URL is required (set it in the environment).');
  process.exit(1);
}

const client = await createCloudClient(url, token);
const tables = ['tenants', 'users', 'superusers', 'cloud_announcements', 'cloud_media', 'pairing_sessions', 'tv_devices'];
const backup = { exportedAt: new Date().toISOString(), tables: {} };

for (const t of tables) {
  try {
    const result = await client.raw.execute(`SELECT * FROM ${t}`);
    backup.tables[t] = result.rows;
    console.log(`[backup] ${t}: ${result.rows.length} rows`);
  } catch (err) {
    console.warn(`[backup] ${t}: skipped (${err.message})`);
  }
}

const out = argVal('--out', `turso-backup-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(backup, null, 2));
console.log(`[backup] written to ${out}`);
client.close();
