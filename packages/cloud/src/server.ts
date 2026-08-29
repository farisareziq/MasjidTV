// VPS standalone server entry point — replaces the Vercel serverless handler
// for self-hosted deployment. Creates the Fastify app, serves static assets
// from the filesystem, and listens on a configurable port.
//
// Usage:
//   pnpm --filter @masjidtv/cloud run build:vps
//   pnpm --filter @masjidtv/cloud start
//   (or: node packages/cloud/dist/server.js)

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default static dir: dist/public/ (next to dist/server.js).
// The build:vps script copies frontend public-cloud assets there.
if (!process.env.MASJIDTV_STATIC_DIR) {
  const defaultDir = path.join(__dirname, 'public');
  if (fs.existsSync(defaultDir)) {
    process.env.MASJIDTV_STATIC_DIR = defaultDir;
  }
}

// SQLite tempatan (TURSO_URL=file:...): libsql GAGAL membuka fail jika direktori
// induk belum wujud (SQLITE_CANTOPEN 14 — fatal semasa init). Cipta dahulu.
const tursoUrl = process.env.TURSO_URL || '';
if (tursoUrl.startsWith('file:')) {
  const dbPath = path.resolve(tursoUrl.slice(5));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  const app = await createCloudApp({
    staticDir: process.env.MASJIDTV_STATIC_DIR
  });
  await app.listen({ port, host });
  console.log(`[server] MasjidTV cloud listening on http://${host}:${port}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[server] ${signal} received — shutting down...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] Fatal:', err);
  process.exit(1);
});
