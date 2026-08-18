// Shared harness for the local-server test suites — single owner of the
// bootstrap contract (temp dataDir, ADMIN_PASSWORD.txt parsing, display key,
// login) and the Windows-safe teardown so suites cannot drift apart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

export const PUBLIC_DIR = path.join(process.cwd(), 'packages', 'frontend', 'public');

export interface TestServer {
  app: FastifyInstance;
  dataDir: string;
  password: string;
  displayKey: string;
  /** Close the app but KEEP the dataDir (restart/persistence scenarios). */
  close: () => Promise<void>;
  /** Close the app and remove the temp dataDir. */
  cleanup: () => Promise<void>;
}

// Boot an isolated app instance; resolves the generated admin password and
// display key. `login: true` also performs the login round-trip.
export async function startTestServer(opts: { login?: boolean } = {}): Promise<TestServer & { token?: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-test-'));
  const app = await buildApp({ dataDir, publicDir: PUBLIC_DIR, port: 0 });
  await app.ready();

  // ADMIN_PASSWORD.txt format is owned by store.createInitialSettings().
  const password = fs.readFileSync(path.join(dataDir, 'ADMIN_PASSWORD.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).find((l) => l.startsWith('tvm-'))!;
  const displayKey = app.masjidStore.getSettings().security!.displayKey;

  let token: string | undefined;
  if (opts.login) {
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', payload: { password } });
    token = res.json().token;
  }

  const rmDataDir = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        // Windows may briefly hold the SQLite file handle — back off.
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  };

  return {
    app, dataDir, password, displayKey, token,
    close: async () => {
      await app.close();
    },
    cleanup: async () => {
      await app.close();
      await rmDataDir();
    }
  };
}

// --- Offline JAKIM e-Solat stub -------------------------------------------
// The static fixture cannot be used: getEntryForDate only matches entries for
// the REAL current date, so the stub must synthesise a week anchored on
// today (MYT) — otherwise getDay falls back to local computation.

const MALAY_MONTHS = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
  'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

const STUB_TIMES = {
  imsak: '05:45:00', fajr: '05:55:00', syuruk: '07:12:00', dhuha: '07:35:00',
  dhuhr: '13:18:00', asr: '16:40:00', maghrib: '19:27:00', isha: '20:40:00'
};

function jakimWeekFixture(): unknown {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start + i * 86400000);
    return {
      date: `${String(dt.getUTCDate()).padStart(2, '0')}-${MALAY_MONTHS[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`,
      hijri: '1448-3-1', day: 'Sabtu',
      ...STUB_TIMES
    };
  });
}

// Stub global fetch so every e-solat.gov.my call resolves instantly offline
// and deterministically (fajr 05:55, maghrib 19:27 for today & tomorrow).
// Returns the restore function.
export function stubJakimFetch(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'OK!', prayerTime: jakimWeekFixture() })
  })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
