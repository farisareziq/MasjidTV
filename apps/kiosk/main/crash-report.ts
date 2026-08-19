// Pelaporan crash kiosk (PLAN.md C4) — log tempatan BERPUTAR SENTIASA AKTIF,
// muat naik ke cloud PILIHAN sahaja (env MASJIDTV_CRASH_UPLOAD=1, lalai OFF).
//
//   <dataDir>/logs/crash-YYYY-MM-DD.log   (satu fail sehari)
//   simpan 7 hari — fail lebih lama dipadam semasa mula & setiap tulis.
//
// Ditangkap:
//   - process.on('uncaughtException')  (proses utama — sebelum relaunch)
//   - 'render-process-gone'            (renderer crash — reload oleh index.ts)
//
// Muat naik: hanya baris BAHARU sejak laporan lepas dihantar ke
// POST /api/device/report sebagai medan `errors` PILIHAN (lihat
// packages/cloud/src/routes/device.ts). Semua panggilan rangkaian ada
// timeout & dibalut try/catch — pelapor crash TIDAK PERNAH crash kiosk.
//
// Konfigurasi:
//   MASJIDTV_CRASH_UPLOAD=1   → aktifkan muat naik (lalai: log tempatan sahaja)
//   cloud.json (pairing)      → { cloudUrl, deviceToken } — diperlukan untuk
//                               muat naik; tanpa pairing tiada destinasi.

import fs from 'node:fs';
import path from 'node:path';

export interface CrashEntry {
  at: number;
  kind: 'uncaught' | 'renderer-gone';
  message: string;
}

interface CloudTarget {
  cloudUrl: string;
  deviceToken: string;
}

const KEEP_DAYS = 7; // simpan log 7 hari
const UPLOAD_TIMEOUT_MS = 8_000;
const MAX_UPLOAD_ENTRIES = 10; // sepadan had laluan cloud (10 × 200 aksara)
const MAX_MESSAGE_LEN = 200;   // sepadan had laluan cloud

function logDir(dataDir: string): string {
  return path.join(dataDir, 'logs');
}

function logFileFor(dataDir: string, d: Date): string {
  const day = d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC — konsisten merentas zon)
  return path.join(logDir(dataDir), `crash-${day}.log`);
}

// Padam fail crash-*.log lebih tua daripada KEEP_DAYS. Gagal = bukan kritikal.
function pruneOldLogs(dataDir: string): void {
  try {
    const dir = logDir(dataDir);
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(/^crash-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!m) continue;
      const dayMs = Date.parse(`${m[1]}T00:00:00Z`);
      if (Number.isFinite(dayMs) && dayMs < cutoff) {
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* sedang digunakan */ }
      }
    }
  } catch { /* folder belum wujud — tiada apa untuk dipadam */ }
}

// Tulis satu entri ke fail log hari ini (append, cipta folder jika perlu).
function writeLocal(dataDir: string, entry: CrashEntry): void {
  try {
    fs.mkdirSync(logDir(dataDir), { recursive: true });
    const line = JSON.stringify({ ...entry, iso: new Date(entry.at).toISOString() }) + '\n';
    fs.appendFileSync(logFileFor(dataDir, new Date(entry.at)), line, 'utf8');
  } catch (err) {
    console.error('[crash] gagal tulis log tempatan (ditelan):', err instanceof Error ? err.message : err);
  }
}

// Kumpul entri BELUM dilaporkan (cursor = capaian masa laporan lepas).
function readUnreported(dataDir: string, sinceMs: number): CrashEntry[] {
  const out: CrashEntry[] = [];
  try {
    const dir = logDir(dataDir);
    const files = fs.readdirSync(dir)
      .filter((n) => /^crash-\d{4}-\d{2}-\d{2}\.log$/.test(n))
      .sort(); // kronologi mengikut nama fail
    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line) as { at?: unknown; kind?: unknown; message?: unknown };
          const at = Number(raw.at) || 0;
          if (at <= sinceMs) continue;
          const kind = raw.kind === 'renderer-gone' ? 'renderer-gone' : 'uncaught';
          out.push({ at, kind, message: String(raw.message || '').slice(0, MAX_MESSAGE_LEN) });
        } catch { /* baris rosak — langkau */ }
      }
    }
  } catch { /* tiada log lagi */ }
  return out.slice(-MAX_UPLOAD_ENTRIES);
}

// Muat naik entri baharu ke cloud (auth device-token). Cursor disimpan dalam
// <dataDir>/logs/.crash-upload-cursor supaya entri sama tidak dihantar dua
// kali walaupun selepas restart. Fire-and-forget — gagal ditelan.
async function uploadEntries(target: CloudTarget, entries: CrashEntry[]): Promise<boolean> {
  if (!entries.length) return true;
  try {
    const res = await fetch(`${target.cloudUrl}/api/device/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-token': target.deviceToken },
      body: JSON.stringify({ errors: entries.map((e) => ({ at: e.at, message: `[${e.kind}] ${e.message}` })) }),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
    return res.ok;
  } catch {
    return false; // cloud offline — cuba semula pada entri berikutnya
  }
}

export class CrashReporter {
  private dataDir: string;
  private getTarget: () => CloudTarget | null;
  private uploadEnabled: boolean;
  private lastUploadedAt: number;
  private lastPruneAt = 0;

  constructor(dataDir: string, getTarget: () => CloudTarget | null) {
    this.dataDir = dataDir;
    this.getTarget = getTarget;
    this.uploadEnabled = process.env.MASJIDTV_CRASH_UPLOAD === '1';
    this.lastUploadedAt = this.readCursor();
    pruneOldLogs(dataDir);
    console.log(`[crash] log tempatan aktif di ${logDir(dataDir)} (simpan ${KEEP_DAYS} hari).`);
    console.log(`[crash] muat naik cloud: ${this.uploadEnabled ? 'AKTIF (MASJIDTV_CRASH_UPLOAD=1)' : 'OFF (lalai)'}.`);
  }

  private cursorPath(): string {
    return path.join(logDir(this.dataDir), '.crash-upload-cursor');
  }

  private readCursor(): number {
    try {
      return Number(fs.readFileSync(this.cursorPath(), 'utf8').trim()) || 0;
    } catch {
      return 0;
    }
  }

  private writeCursor(at: number): void {
    try {
      fs.writeFileSync(this.cursorPath(), String(at), 'utf8');
    } catch { /* bukan kritikal */ }
  }

  // Rekod satu kejadian crash. Sinkron & pantas — selamat dipanggil dari
  // handler uncaughtException (sebelum relaunch) & render-process-gone.
  // pruneOldLogs DITHROTTLE 1 jam — imbasan direktori sync penuh pada setiap
  // rekod adalah kos I/O berulang tepat ketika proses cuba pulih (crash-loop).
  record(kind: CrashEntry['kind'], message: string): void {
    const entry: CrashEntry = { at: Date.now(), kind, message: message.slice(0, MAX_MESSAGE_LEN) };
    writeLocal(this.dataDir, entry);
    if (Date.now() - this.lastPruneAt >= 60 * 60 * 1000) {
      this.lastPruneAt = Date.now();
      pruneOldLogs(this.dataDir);
    }
    if (!this.uploadEnabled) return;
    const target = this.getTarget();
    if (!target) return; // belum dipaut — tiada destinasi
    // Flush SEMUA entri belum dilaporkan (bukan hanya yang baharu) supaya
    // crash semasa offline turut sampai bila cloud kembali.
    const pending = readUnreported(this.dataDir, this.lastUploadedAt);
    void uploadEntries(target, pending).then((ok) => {
      if (ok && pending.length) {
        this.lastUploadedAt = Math.max(...pending.map((e) => e.at));
        this.writeCursor(this.lastUploadedAt);
      }
    }).catch(() => { /* ditelan — pelapor tidak boleh crash kiosk */ });
  }
}

let instance: CrashReporter | null = null;

export function initCrashReporter(dataDir: string, getTarget: () => CloudTarget | null): CrashReporter {
  if (!instance) instance = new CrashReporter(dataDir, getTarget);
  return instance;
}
