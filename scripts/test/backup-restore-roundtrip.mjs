// Round-trip drill for turso-backup/turso-restore against a local libsql file.
// Seeds a tenant + user, backs up, wipes, restores, and diffs the dumps.
// Usage: node scripts/test/backup-restore-roundtrip.mjs
import { createCloudClient, applySchema, tenants, users } from '../../packages/db/dist/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-rt-'));
const cleanup = () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* dikunci Windows — buang kemudian */ }
};
const dbPath = path.join(tmp, 'drill.db').replaceAll('\\', '/');
const b1 = path.join(tmp, 'b1.json');
const b2 = path.join(tmp, 'b2.json');
const scripts = path.resolve(import.meta.dirname, '..');

process.env.TURSO_URL = `file:${dbPath}`;

// Seed
const client = await createCloudClient(`file:${dbPath}`, '');
await applySchema(client);
await client.db.insert(tenants).values({ id: 't1', name: 'Drill Mosque', createdAt: 1755000000000, trialUntil: 1756000000000, status: 'trial', apiKey: 'key-1', settings: '{}' });
await client.db.insert(users).values({ id: 'u1', tenantId: 't1', username: 'admin', passwordHash: 'x', name: 'Admin', active: 1, tokenVersion: 0, createdAt: 1755000000000 });
console.log('[drill] seeded 1 tenant + 1 user');
client.close();

// Backup #1
execFileSync(process.execPath, [path.join(scripts, 'turso-backup.mjs'), '--out', b1], { env: process.env, stdio: 'inherit' });

// Wipe tenant rows only (restore truncates what's in the backup anyway)
const wipe = await createCloudClient(`file:${dbPath}`, '');
await wipe.raw.execute('DELETE FROM tenants');
await wipe.raw.execute('DELETE FROM users');
console.log('[drill] wiped tenants + users');
wipe.close();

// Restore + backup #2
execFileSync(process.execPath, [path.join(scripts, 'turso-restore.mjs'), b1, '--yes', '--allow-file'], { env: process.env, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(scripts, 'turso-backup.mjs'), '--out', b2], { env: process.env, stdio: 'inherit' });

// Diff (superusers may legitimately gain the seeded admin row after app boot;
// this drill never boots the app, so dumps must be identical)
const d1 = JSON.parse(fs.readFileSync(b1, 'utf8'));
const d2 = JSON.parse(fs.readFileSync(b2, 'utf8'));
const same = JSON.stringify(d1.tables) === JSON.stringify(d2.tables);
console.log(`[drill] round-trip identical: ${same}`);
if (!same) {
  console.error('before:', JSON.stringify(d1.tables, null, 2).slice(0, 2000));
  console.error('after: ', JSON.stringify(d2.tables, null, 2).slice(0, 2000));
  cleanup();
  process.exit(1);
}
console.log('[drill] OK');
cleanup();
