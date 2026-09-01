// Turso backup: dumps all cloud tables to a local JSON file.
// Usage: node scripts/turso-backup.mjs [--out backup.json]
//
// FAIL-LOUD: jika sebarang jadual tidak dapat dibaca (kebenaran hilang, skema
// drift, sambungan terputus), skrip GAGAL dengan exit 1 — jangan tulis backup
// separuh dan beri ilusi "success". Backup harian CI memerlukan kepastian
// integriti; lihat backup.yml "Verify backup integrity" + "Restore round-trip".
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
// jakim_times DIKECUALIKAN secara sengaja: cache awam JAKIM (60 zon × setahun,
// ~22k baris/tahun) yang dibina semula automatik daripada e-solat.gov.my —
// bukan data tenant/pengguna. Restore (turso-restore.mjs) tidak menyentuh
// jadual yang tiada dalam backup. Jangan tambah melainkan keputusan berubah.
const tables = ['tenants', 'users', 'superusers', 'cloud_announcements', 'cloud_media', 'pairing_sessions', 'tv_devices'];
const backup = { exportedAt: new Date().toISOString(), tables: {} };
const errors = [];

for (const t of tables) {
  try {
    const result = await client.raw.execute(`SELECT * FROM ${t}`);
    backup.tables[t] = result.rows;
    console.log(`[backup] ${t}: ${result.rows.length} rows`);
  } catch (err) {
    // Jangan tolak terus — kumpul semua ralat dahulu supaya log menunjukkan
    // gambaran penuh (jadual mana yang gagal) sebelum keluar.
    errors.push({ table: t, message: err instanceof Error ? err.message : String(err) });
    console.error(`[backup] ${t}: FAILED — ${err instanceof Error ? err.message : err}`);
  }
}

client.close();

if (errors.length) {
  // Tulis apa yang berjaya untuk diagnosis (artifacts CI) tapi GAGAL —
  // backup separuh tidak boleh dipulihkan dengan selamat.
  const out = argVal('--out', `turso-backup-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(backup, null, 2));
  console.error(`[backup] ${errors.length}/${tables.length} table(s) failed — aborting (partial backup written to ${out} for diagnosis only).`);
  for (const e of errors) console.error(`  ✗ ${e.table}: ${e.message}`);
  process.exit(1);
}

const out = argVal('--out', `turso-backup-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(backup, null, 2));
console.log(`[backup] written to ${out}`);
