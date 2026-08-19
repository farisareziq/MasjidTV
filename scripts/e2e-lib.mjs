// Utiliti E2E bersama: port dinamik, boot cloud lokal (tsx), spawn kiosk,
// cleanup proses robust (tiada ffmpeg/electron yatim), tunggu health.
//
// Semua skrip e2e (e2e-pairing.mjs, dry-run-kiosk.mjs, pentest.mjs, run-e2e.mjs)
// memakai modul ini supaya:
//   - Port TIDAK hardcode 3211/3299 (elak berlanggar antara larian &
//     larian CI serentak) — dapatkan port bebas melalui server net.
//   - Cleanup: bunuh seluruh pokok proses anak (taskkill /T /F di Windows)
//     + ffmpeg.exe baki — proses yatim tidak kekal selepas kegagalan.

import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const log = (prefix) => (m) => console.log(`[${prefix}] ${m}`);

/**
 * Baca aliran SSE (EventSource tanpa pelayar). Mengumpul semua event sehingga
 * `signal` di-abort; memulangkan janji yang diselesaikan dengan array penuh.
 * Caller biasanya tidak menunggu janji ini — baca `events` secara langsung
 * dalam gelung polling.
 *
 *   const { events, abort } = readSseEvents(url);
 *   ...tunggu...
 *   abort();
 *
 * Dikongsi oleh e2e-pairing, dry-run-kiosk & pentest supaya pemisahan frame
 * (event:/data: pada sempadan \n\n) konsisten — jangan salin-tampal loop ini.
 */
export function readSseEvents(url, { headers = {} } = {}) {
  const ctl = new AbortController();
  const events = [];
  const done = (async () => {
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'text/event-stream', ...headers } });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          let ev = 'message', da = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) da += line.slice(5).trim();
          }
          events.push({ ev, da, at: Date.now() });
        }
      }
    } catch { /* abort dijangka / sambungan ditutup */ }
  })();
  return { events, abort: () => ctl.abort(), done };
}

/** Dapatkan port TCP bebas (bind 0 → port ephemeral). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Bunuh proses + seluruh pokok anaknya (robust di Windows). */
export function killTree(proc, _label = 'proc') {
  if (!proc || proc.exitCode !== null || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      // taskkill /T bunuh pokok penuh — electron spawn anak ffmpeg.
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
    }
  } catch {
    try { proc.kill('SIGKILL'); } catch { /* sudah mati */ }
  }
}

/**
 * Bersihkan semua proses ffmpeg yatim (Windows) — spawn relay oleh server
 * anak mungkin terselamat bila proses induk dibunuh paksa di tengah jalan.
 */
export function killOrphanFfmpeg() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('taskkill', ['/f', '/im', 'ffmpeg.exe'], { stdio: 'ignore' });
  } catch { /* tiada proses ffmpeg berjalan */ }
}

/** Tunggu endpoint /api/health sedia. */
export async function waitHealth(url, label, tries, intervalMs = 500) {
  // CI runner Windows headless: Electron GUI (app.whenReady) lambat mula —
  // benarkan override melalui env (saat). Lalai kekal 45sa untuk larian lokal.
  const defTries = Number(process.env.E2E_HEALTH_TIMEOUT_S || 45) * 2;
  tries = tries || defTries;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* belum sedia */ }
    await sleep(intervalMs);
  }
  throw new Error(label + ' tidak sedia dalam ' + Math.round(tries * intervalMs / 1000) + 'sa');
}

/**
 * Boot cloud lokal (tsx dari sumber) — return { proc, port, url, dir, getBootPin }.
 * DB fail SQLite dalam dir sementara; JWT_SECRET ujian ditetapkan.
 * `dir` boleh diberikan untuk MENGKONGSI DB antara boot (cth. simulasi
 * restart cloud dalam dry-run: data mesti kekal merentas restart).
 */
export async function bootCloud({ port, url, dir } = {}) {
  port = port || await freePort();
  url = url || `http://localhost:${port}`;
  const cloudDir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cloud-'));
  const env = {
    ...process.env,
    TURSO_URL: `file:${path.join(cloudDir, 'cloud.db')}`,
    JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef0123456789abcdef',
    MASJIDTV_PUBLIC_URL: url,
    PORT: String(port)
  };
  const proc = spawn(process.execPath, [
    '--import', 'tsx', '-e', `
      import { createCloudApp } from './src/app.js';
      const app = await createCloudApp();
      await app.listen({ port: ${port}, host: '127.0.0.1' });
      console.log('cloud listening on ${port}');
    `
  ], {
    cwd: path.join(process.cwd(), 'packages', 'cloud'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let bootPin = '';
  proc.stdout.on('data', (d) => {
    const s = String(d);
    const m = s.match(/PIN bootstrap:\s*(\S+)/);
    if (m) bootPin = m[1];
  });
  return { proc, port, url, dir: cloudDir, getBootPin: () => bootPin };
}

/**
 * Login superuser (bootstrap PIN → tukar PIN → relogin) → return token.
 * Sesudah ini superuser boleh mencipta tenant.
 */
export async function superuserLogin(cloudUrl, pin, newPin) {
  let r = await fetch(cloudUrl + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin })
  });
  if (!r.ok) throw new Error('superuser login: ' + r.status + ' ' + await r.text());
  let su = await r.json();
  if (!su.mustChangePin) return su.token;
  r = await fetch(cloudUrl + '/api/auth/superuser/pin', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + su.token },
    body: JSON.stringify({ pin: newPin })
  });
  if (!r.ok) throw new Error('tukar PIN: ' + r.status + ' ' + await r.text());
  r = await fetch(cloudUrl + '/api/auth/superuser/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', pin: newPin })
  });
  if (!r.ok) throw new Error('relogin superuser: ' + r.status);
  return (await r.json()).token;
}

/** Cipta tenant + admin tenant → return { tenant, admin }. */
export async function createTenant(cloudUrl, suToken, name = 'Masjid E2E', username = 'e2eadmin', password = 'e2epass123') {
  let r = await fetch(cloudUrl + '/api/super/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + suToken },
    body: JSON.stringify({ name, username, password })
  });
  if (!r.ok) throw new Error('create tenant: ' + r.status + ' ' + await r.text());
  const tenant = await r.json();
  r = await fetch(cloudUrl + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!r.ok) throw new Error('tenant login: ' + r.status);
  return { tenant, admin: await r.json() };
}

/**
 * Spawn kiosk Electron untuk ujian e2e.
 * return { proc, port, url, dir, packaged }.
 *
 * Lalai: ELECTRON DEV binary dari kod semasa (dist/index.js tsc +
 * @masjidtv/server/dist) — ujian mesti menguji KOD SEMASA, bukan stamp
 * packaged yang mungkin lapuk.
 * E2E_KIOSK_EXE=<path> atau E2E_KIOSK_USE_PACKAGED=1: guna packaged exe
 * (ujian rilis/prerilis — pastikan `pnpm --filter @masjidtv/kiosk package`
 * dijalankan dahulu supaya stamp mengandungi kod semasa).
 *
 * PENTING: buang ELECTRON_RUN_AS_NODE dari env anak — VS Code/agent kerap
 * menetapkannya pada sesi (agent berjalan DALAM Electron-as-Node), dan tanpa
 * ini Electron kiosk akan boot sebagai Node biasa (require('electron')
 * memulangkan laluan string, bukan API) → "app is undefined".
 */
export async function spawnKiosk({ port, dataDir } = {}) {
  port = port || await freePort();
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tv-'));
  const { ELECTRON_RUN_AS_NODE, ...cleanEnv } = process.env;
  void ELECTRON_RUN_AS_NODE;
  const base = path.join(process.cwd(), 'apps', 'kiosk', 'dist-kiosk');
  const stamps = fs.existsSync(base)
    ? fs.readdirSync(base).filter((d) => /^\d{12}$/.test(d)).sort()
    : [];
  const stamp = stamps.length ? stamps[stamps.length - 1] : null;
  const wantPackaged = Boolean(process.env.E2E_KIOSK_EXE || process.env.E2E_KIOSK_USE_PACKAGED === '1');
  const kioskExe = wantPackaged
    ? (process.env.E2E_KIOSK_EXE
      || (stamp ? path.join(base, stamp, 'win-unpacked', 'MasjidTV Kiosk.exe') : null))
    : null;
  const bundledFfmpeg = stamp
    ? path.join(base, stamp, 'win-unpacked', 'resources', 'bin', 'ffmpeg.exe')
    : null;

  // Cuba packaged exe bila diminta; Smart App Control mungkin menyekatnya.
  if (kioskExe && fs.existsSync(kioskExe)) {
    try {
      const proc = spawn(kioskExe, ['--no-kiosk', '--no-autostart', '--port', String(port)], {
        env: { ...cleanEnv, MASJIDTV_DATA_DIR: dir },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      await sleep(1500);
      if (proc.exitCode === null) {
        return { proc, port, url: `http://localhost:${port}`, dir, packaged: true };
      }
      console.error('[e2e] packaged exe terkeluar awal (code ' + proc.exitCode + ') — fallback electron dev');
    } catch {
      console.error('[e2e] packaged exe disekat (Smart App Control) — guna electron dev');
    }
  }

  // Runner CI Windows ialah headless (tiada display/GPU sebenar) — Electron
  // gagal menyelesaikan app.whenReady() dalam mod GPU lalai walaupun
  // --no-kiosk melangkau tetingkap. Tambahkan flag headless/disable-gpu bila
  // E2E_HEADLESS=1 (atau CI automatik) supaya Electron mula tanpa GPU.
  const headless = process.env.E2E_HEADLESS === '1' || Boolean(process.env.CI);
  const headlessArgs = headless
    ? ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--disable-software-rasterizer']
    : [];

  const proc = spawn(
    path.join(process.cwd(), 'apps', 'kiosk', 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['.', ...headlessArgs, '--no-kiosk', '--no-autostart', '--port', String(port)],
    {
      cwd: path.join(process.cwd(), 'apps', 'kiosk'),
      env: {
        ...cleanEnv,
        MASJIDTV_DATA_DIR: dir,
        MASJIDTV_PUBLIC_DIR: path.join(process.cwd(), 'packages', 'frontend', 'public'),
        ...(bundledFfmpeg && fs.existsSync(bundledFfmpeg) ? { FFMPEG_PATH: bundledFfmpeg } : {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  return { proc, port, url: `http://localhost:${port}`, dir, packaged: false };
}

/** Manager proses ringkas — daftar proses, bersihkan semua pada exit. */
export function procRegistry() {
  const procs = [];
  const reg = {
    add(p) { procs.push(p); return p; },
    async cleanup() {
      for (const p of procs) killTree(p);
      killOrphanFfmpeg();
    },
    installExitHooks() {
      const bye = () => { for (const p of procs) killTree(p); killOrphanFfmpeg(); };
      process.on('exit', bye);
      process.on('SIGINT', () => { bye(); process.exit(130); });
      process.on('SIGTERM', () => { bye(); process.exit(143); });
      process.on('uncaughtException', (e) => {
        console.error('[e2e] uncaught:', e);
        bye();
        process.exit(1);
      });
    }
  };
  return reg;
}
