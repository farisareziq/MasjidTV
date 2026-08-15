import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';
import { Updater } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.MASJIDTV_DATA_DIR
  || path.join(process.env.APPDATA || path.join(process.env.HOME || '', '.config'), 'MasjidTV');

// PUBLIC_DIR: dalam pepohon dev = packages/frontend/public (2 aras dari
// packages/server/dist/); dalam bundel dist/masjidtv/ = server/../frontend/
// public (1 aras dari dist/masjidtv/server/). Env sentiasa diutamakan.
function defaultPublicDir(): string {
  const up1 = path.join(__dirname, '..', 'frontend', 'public');   // bundle
  const up2 = path.join(__dirname, '..', '..', 'frontend', 'public'); // dev
  return fs.existsSync(up1) ? up1 : up2;
}

const PUBLIC_DIR = process.env.MASJIDTV_PUBLIC_DIR || defaultPublicDir();

const PORT = Number(process.env.PORT) || 3000;

startServer({ dataDir: DATA_DIR, publicDir: PUBLIC_DIR, port: PORT })
  .then((app) => {
    console.log('');
    console.log('  MasjidTV 1.0.0 — mosque signage server');
    console.log(`  Display screen : http://localhost:${PORT}/display`);
    console.log(`  Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`  Data dir       : ${DATA_DIR}`);
    console.log(`  Listening on all interfaces (LAN) — port ${PORT}`);
    console.log('');

    // Self-updater: aktif hanya bila env dikonfigurasi (binari tunggal).
    const repo = process.env.MASJIDTV_UPDATE_REPO;
    const installDir = process.env.MASJIDTV_UPDATE_DIR;
    const binaryName = process.env.MASJIDTV_UPDATE_BINARY;
    if (repo && installDir && binaryName) {
      new Updater({ repo, currentVersion: '1.0.0', installDir, binaryName }).start();
      console.log(`  Self-updater   : enabled (${repo})`);
    }
  })
  .catch((err) => {
    console.error('[masjidtv] failed to start:', err);
    process.exit(1);
  });
