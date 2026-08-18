// Mod cloud untuk mini PC: server tempatan menjadi proksi cache dari cloud.
// Aktif bila env (CLOUD_URL + TENANT_KEY) ATAU config pairing (/pair →
// <dataDir>/cloud.json) tersedia. Config dibaca semula setiap permintaan —
// pairing berjaya mengaktifkan mod ini TANPA restart (hot-swap).
// Jika internet putus, paparan terus berjalan dengan cache (offline-first).

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply } from 'fastify';
import { readCloudConfig, cloudConfigPath, type CloudConfig } from './pair.js';

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

// Cache bacaan config dikunci kepada mtime fail — pembacaan semula berlaku
// serta-merta selepas /pair menulis cloud.json (tiada TTL stale).
let cachedCfg: { mtimeMs: number; cfg: CloudConfig | null } = { mtimeMs: -1, cfg: null };

export function activeCloudConfig(dataDir: string): CloudConfig | null {
  const envUrl = (process.env.CLOUD_URL || '').replace(/\/$/, '');
  const envKey = process.env.TENANT_KEY || '';
  if (envUrl && envKey) {
    return { cloudUrl: envUrl, deviceId: '', deviceToken: envKey };
  }
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(cloudConfigPath(dataDir)).mtimeMs;
  } catch {
    /* tiada fail */
  }
  if (mtimeMs !== cachedCfg.mtimeMs) {
    cachedCfg = { mtimeMs, cfg: mtimeMs >= 0 ? readCloudConfig(dataDir) : null };
  }
  return cachedCfg.cfg;
}

/**
 * AUTO-RESET (kelakuan Android TV): token peranti ditolak cloud (unpair
 * di admin) → buang config + cache → server kembali mod pairing.
 * Peranti akan mula sesi pairing baharu automatik.
 *
 * rejectedToken: hanya reset jika token yang ditolak MASIH menjadi config
 * semasa — elak perlumbaan di mana jambatan SSE lama (token lapuk) memadam
 * config BAHARU yang baru ditulis oleh pair semula.
 */
export function deviceUnpaired(dataDir: string, rejectedToken?: string): void {
  if (rejectedToken) {
    const cfg = readCloudConfig(dataDir);
    if (cfg && cfg.deviceToken !== rejectedToken) {
      // Config semasa sudah berubah (pair semula) — JANGAN reset.
      return;
    }
  }
  try {
    fs.unlinkSync(cloudConfigPath(dataDir));
  } catch {
    /* tidak wujud */
  }
  fs.rmSync(path.join(dataDir, 'cloud-cache'), { recursive: true, force: true });
  cachedCfg = { mtimeMs: -1, cfg: null };
  console.log('[cloud] Peranti dinyahpaut di cloud — kembali ke mod pairing.');
}

export function invalidateCloudConfigCache(): void {
  cachedCfg = { mtimeMs: -1, cfg: null };
}

export function cloudSyncEnabled(dataDir?: string): boolean {
  if (process.env.CLOUD_URL && process.env.TENANT_KEY) return true;
  if (!dataDir) return false;
  return Boolean(activeCloudConfig(dataDir));
}

function cacheDirFor(dataDir: string): string {
  return path.join(dataDir, 'cloud-cache');
}

function cacheFile(cacheDir: string, p: string): string {
  const name = p.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
  return path.join(cacheDir, name);
}

function loadCache(cacheDir: string, p: string): { savedAt: number; data: unknown } | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(cacheDir, p), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(cacheDir: string, p: string, data: unknown): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(cacheDir, p), JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
  } catch {
    /* ignore */
  }
}

function rewriteUrls(cloudUrl: string, value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('/uploads/')) return `${cloudUrl}${value}`;
    // Relay HLS kekal LOKAL — ffmpeg berjalan di mini PC (kamera/OBS ialah
    // peranti lokal; cloud tidak menjanakan HLS untuk streams ini).
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteUrls(cloudUrl, v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = rewriteUrls(cloudUrl, v);
    return out;
  }
  return value;
}

async function cloudFetch(cfg: CloudConfig, p: string): Promise<{ ok: boolean; status: number; json?: unknown }> {
  const headers: Record<string, string> = { 'x-tenant-key': cfg.deviceToken, 'x-device-token': cfg.deviceToken };
  const res = await fetch(`${cfg.cloudUrl}${p}`, {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: 200, json: await res.json() };
}

// --- SSE bridge: cloud → mini PC → paparan lokal ------------------------------
//
// Pelanggan SSE kepada cloud /api/events (device-token). Setiap event 'sync'
// → invalidate cache (refetch semula oleh poll/paparan) → broadcast SSE
// lokal '/api/events' kepada renderer. Reconnect backoff 1s→60s; rev
// catch-up: sambung semula selepas offline men-trigger refetch penuh.

type LocalSseHandler = (event: string, data: unknown) => void;
const localSseClients = new Set<LocalSseHandler>();
let sseStarted = false;
// Signal "config berubah — semak semula sekarang" (dipanggil oleh pair.ts
// selepas pairing berjaya supaya jambatan tidak menunggu kitaran retry).
let sseConfigChanged: (() => void) | null = null;

/** Notifikasi jambatan SSE bahawa cloud.json berubah (pair/unpair). */
export function notifySseConfigChanged(): void {
  try { sseConfigChanged?.(); } catch { /* tiada pendengar */ }
}

export function broadcastLocal(event: string, data: unknown): void {
  for (const h of [...localSseClients]) {
    try {
      h(event, data);
    } catch {
      localSseClients.delete(h);
    }
  }
}

export async function handleCloudSync(reply: FastifyReply, dataDir: string, p: string, rewrite = true): Promise<boolean> {
  const cfg = activeCloudConfig(dataDir);
  if (!cfg) return false;
  const cacheDir = cacheDirFor(dataDir);

  const serveFromCache = () => {
    const cache = loadCache(cacheDir, p);
    if (!cache) {
      reply.status(503).send({ error: 'Paparan offline dan tiada cache' });
      return;
    }
    reply.send(rewrite ? rewriteUrls(cfg.cloudUrl, cache.data) : cache.data);
  };

  try {
    const cloud = await cloudFetch(cfg, p);
    if (cloud.ok) {
      saveCache(cacheDir, p, cloud.json);
      // Streams cloud → relay ffmpeg lokal. Settings awam TIDAK mengandungi
      // nama peranti dshow/mirrorUrl — guna endpoint peranti khusus.
      if (p === '/api/settings') fetchDeviceStreams(dataDir).catch(() => {});
      reply.send(rewrite ? rewriteUrls(cfg.cloudUrl, cloud.json) : cloud.json);
      return true;
    }
    if (cloud.status === 403) {
      const cache = loadCache(cacheDir, p);
      if (cache && Date.now() - cache.savedAt <= GRACE_MS) {
        reply.send(rewrite ? rewriteUrls(cfg.cloudUrl, cache.data) : cache.data);
        return true;
      }
      reply.status(403).send({ error: 'Lesen diperlukan', code: 'LICENSE_REQUIRED' });
      return true;
    }
    if (cloud.status === 401) {
      // AUTO-RESET: token peranti ditolak (unpair di cloud) — buang config,
      // paparan akan reload ke mod pairing (seperti Android TV).
      deviceUnpaired(dataDir, cfg.deviceToken);
      reply.status(503).send({ error: 'Sesi peranti tidak sah — memulakan pairing semula', code: 'DEVICE_UNPAIRED' });
      return true;
    }
    serveFromCache();
    return true;
  } catch {
    serveFromCache();
    return true;
  }
}

/**
 * Halakan halaman admin ke cloud bila dipautkan. Pulang `true` bila redirect
 * telah dihantar.
 *
 * NOTA: paparan (/) TIDAK dialihkan lagi — kiosk/watchdog membuka /display
 * lokal yang berkhidmat dari proksi+cache cloud (offline-first). Redirect
 * paparan ke cloud menyebabkan loop refresh apabila internet perlahan/
 * terputus (kiosk buka semula → redirect → gagal → ulang).
 */
export function cloudPageRedirect(reply: FastifyReply, dataDir: string, page: '/' | '/display' | '/admin'): boolean {
  const cfg = activeCloudConfig(dataDir);
  if (!cfg) return false;
  if (page === '/admin') {
    reply.redirect(`${cfg.cloudUrl}/admin`);
    return true;
  }
  return false;
}

// --- Streams cloud → relay lokal ----------------------------------------------
//
// Dalam mod cloud-sync, tetapan (termasuk senarai streams) datang dari cloud
// tetapi RELAY ffmpeg mesti berjalan DI MINI PC (kamera/OBS adalah peranti
// lokal; cloud tidak boleh menariknya). Pendekatan: setiap kali settings
// cloud dikemas kini (fetch/cache/SSE sync), tulis semula senarai streams
// ke dalam store lokal dan minta StreamManager.sync() — paparan lokal kemudian
// membaca HLS dari /relay/<id>/index.m3u8 yang dijana ffmpeg lokal.

type OnCloudSettings = (settings: Record<string, unknown>) => void;
let onCloudSettingsHandler: OnCloudSettings | null = null;

/** Daftar handler kemas kini settings cloud (stream relay lokal). */
export function setOnCloudSettings(h: OnCloudSettings | null): void {
  onCloudSettingsHandler = h;
}

function notifyCloudSettings(data: unknown): void {
  if (!onCloudSettingsHandler) return;
  try {
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).streams)) {
      onCloudSettingsHandler(data as Record<string, unknown>);
    }
  } catch {
    /* handler tidak boleh menggagalkan respons paparan */
  }
}

/**
 * Fetch streams PENUH daripada cloud (endpoint peranti — termasuk nama
 * peranti dshow + mirrorUrl stream-key) dan notifikasi handler relay.
 * Dipanggil oleh jambatan SSE pada setiap sync/hello.
 */
async function fetchDeviceStreams(dataDir: string): Promise<void> {
  const cfg = activeCloudConfig(dataDir);
  if (!cfg) return;
  const res = await cloudFetch(cfg, '/api/device/streams');
  if (res.ok && res.json && Array.isArray((res.json as Record<string, unknown>).streams)) {
    notifyCloudSettings(res.json);
  }
}

/**
 * Mulakan jambatan SSE (sekali sahaja sejak proses): pelanggan SSE kepada
 * cloud dengan device-token. Event 'sync' → buang cache (paparan refetch)
 * + broadcast lokal. Reconnect dengan backoff; setiap sambungan semula
 * memicu refetch (rev catch-up — tiada perubahan tertinggal walaupun
 * beberapa event hilang semasa offline).
 */
export async function startCloudSseBridge(dataDir: string): Promise<void> {
  if (sseStarted) return;
  sseStarted = true;

  const connect = async (): Promise<void> => {
    const cfg = activeCloudConfig(dataDir);
    if (!cfg) {
      // Belum dipaut — tunggu isyarat config berubah (pairing) ATAU retry 5sa.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5000);
        sseConfigChanged = () => { clearTimeout(t); resolve(); };
      });
      sseConfigChanged = null;
      connect().catch(() => {});
      return;
    }
    let backoffMs = 1000;
    try {
      const ctrl = new AbortController();
      const res = await fetch(`${cfg.cloudUrl}/api/events`, {
        headers: { 'x-device-token': cfg.deviceToken, 'x-tenant-key': cfg.deviceToken },
        signal: ctrl.signal
      });
      if (res.status === 401) {
        // Unpair di cloud — auto-reset; jambatan akan re-check config.
        deviceUnpaired(dataDir, cfg.deviceToken);
        broadcastLocal('unpaired', {});
        setTimeout(connect, 5000).unref?.();
        return;
      }
      if (res.status === 403) {
        // Lesen/trial tamat — tiada SSE; poll+cache kekal (grace 30 hari).
        setTimeout(connect, 60_000).unref?.();
        return;
      }
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);

      backoffMs = 1000; // sambungan berjaya — reset backoff
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // Parse SSE ringkas: event/data berpasangan diakhiri baris kosong.
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let evName = 'message';
          let evData = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) evName = line.slice(6).trim();
            else if (line.startsWith('data:')) evData += line.slice(5).trim();
          }
          if (evName === 'sync' || evName === 'hello') {
            // Refetch segera: buang cache supaya poll/paparan berikutnya
            // mendapat data baharu; paparan lokal dinotifikasi via SSE.
            fs.rmSync(path.join(dataDir, 'cloud-cache'), { recursive: true, force: true });
            broadcastLocal('sync', { rev: safeRev(evData) });
            // Streams relay mesti bertindak segera — fetch streams PENUH
            // (endpoint peranti: termasuk nama peranti dshow + mirrorUrl
            // yang tidak didedahkan dalam settings awam).
            fetchDeviceStreams(dataDir).catch(() => { /* offline — cache kekal */ });
          }
        }
      }
    } catch {
      /* rangkaian putus / cloud tutup sambungan */
    }
    // Backoff 1s→2s→…→60s (maks), cuba semula.
    setTimeout(connect, backoffMs).unref?.();
    backoffMs = Math.min(backoffMs * 2, 60_000);
    // Debug halus: sambungan semula akan refetch hello → catch-up.
  };
  connect().catch(() => {});
}

function safeRev(data: string): number {
  try {
    const j = JSON.parse(data) as { rev?: number };
    return Number(j.rev) || 0;
  } catch {
    return 0;
  }
}

/**
 * SSE lokal untuk renderer: /api/events (EventSource paparan). Menerima
 * handler; dipanggil oleh app.ts dengan auth paparan sedia ada.
 */
export function addLocalSseRoute(app: import('fastify').FastifyInstance): void {
  app.get('/api/events', { preHandler: undefined }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-store',
      connection: 'keep-alive'
    });
    reply.raw.write('retry: 3000\n\n');
    const handler: LocalSseHandler = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    localSseClients.add(handler);
    handler('hello', {}); // sambungan disahkan
    const hb = setInterval(() => {
      try {
        reply.raw.write(': hb\n\n');
      } catch {
        localSseClients.delete(handler);
        clearInterval(hb);
      }
    }, 25_000);
    req.raw.on('close', () => {
      localSseClients.delete(handler);
      clearInterval(hb);
    });
  });
}
