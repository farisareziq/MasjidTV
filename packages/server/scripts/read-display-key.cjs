// Reads the display key from the local SQLite DB and prints it to stdout.
// Used by start-kiosk.ps1 to inject ?key= into the kiosk display URL.
// ESM dynamic import — @masjidtv/db is an ES-module-only workspace package;
// resolves from the bundle's flattened node_modules or the repo layout.
const path = require('path');
const fs = require('fs');
const os = require('os');

const dbPath = process.env.MASJIDTV_DATA_DIR
  ? path.join(process.env.MASJIDTV_DATA_DIR, 'masjidtv.db')
  : path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'MasjidTV', 'masjidtv.db');

async function main() {
  let dbUrl;
  const candidates = [
    path.join(__dirname, '..', 'node_modules', '@masjidtv', 'db'), // bundle: scripts/ → node_modules
    path.join(__dirname, '..', '..', '..', 'node_modules', '@masjidtv', 'db'), // repo: packages/server/scripts → packages/server/node_modules
    path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@masjidtv', 'db') // repo fallback
  ];
  const found = candidates.find((c) => fs.existsSync(path.join(c, 'dist', 'index.js')));
  if (!found) {
    // ESM-style resolve fallback (works when exports map allows import).
    dbUrl = 'file:///' + path.join(__dirname, '..', 'node_modules', '@masjidtv', 'db', 'dist', 'index.js').replace(/\\/g, '/');
  } else {
    dbUrl = 'file:///' + path.join(found, 'dist', 'index.js').replace(/\\/g, '/');
  }
  const { createLocalClient } = await import(dbUrl);
  const client = await createLocalClient(dbPath);
  const row = client.raw.prepare('SELECT data FROM settings WHERE id = 1').get();
  client.close();
  if (row) {
    const doc = JSON.parse(row.data);
    process.stdout.write((doc.security && doc.security.displayKey) || '');
  }
}

main().catch((err) => {
  if (process.env.MASJIDTV_DEBUG) {
    process.stderr.write(`[read-display-key] ${err && err.message}\n`);
  }
});
