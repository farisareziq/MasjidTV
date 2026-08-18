// Jambatan kepada pelayan @masjidtv/server sedia ada. Dalam Electron main
// process, Node adalah penuh — better-sqlite3/node:sqlite, pairing Android
// TV, cloud-sync: SEMUA kod sedia ada diguna semula tanpa perubahan.
//
// Perbezaan daripada index.ts server: tiada updater env (kiosk dikemas
// kini melalui installer/electron-builder), dan publicDir boleh datang
// dari aset app (resources/frontend/public) atau folder dev.

import path from 'node:path';
import fs from 'node:fs';
import { startServer as bootServer, type AppOptions } from '@masjidtv/server/dist/app.js';

export interface KioskServerOptions {
  dataDir: string;
  port: number;
  ffmpegPath?: string | null;
}

function resolvePublicDir(): string {
  // 1) Env eksplisit (dev / pakar).
  if (process.env.MASJIDTV_PUBLIC_DIR) return process.env.MASJIDTV_PUBLIC_DIR;
  // 2) Aset dibundel: <exe-dir>/resources/frontend/public (electron-builder
  //    extraResources) atau <app>/resources/frontend/public dalam dev.
  const candidates = [
    path.join(process.resourcesPath || '', 'frontend', 'public'),
    path.join(__dirname, '..', '..', 'resources', 'frontend', 'public'),
    path.join(__dirname, '..', '..', '..', 'packages', 'frontend', 'public')
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(path.join(c, 'display.html'))) return c;
    } catch { /* resourcesPath belum sedia */ }
  }
  return candidates[candidates.length - 1];
}

export async function startServer(opts: KioskServerOptions): Promise<void> {
  const serverOpts: AppOptions = {
    dataDir: opts.dataDir,
    publicDir: resolvePublicDir(),
    port: opts.port,
    ffmpegPathOverride: opts.ffmpegPath || undefined
  };
  await bootServer(serverOpts);
}
