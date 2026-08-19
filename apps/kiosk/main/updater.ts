// Self-updater kiosk Electron (PLAN.md B1): poll GitHub Releases, muat turun
// installer NSIS + sahkan sha256, pasang senyap, relaunch.
//
// KENAPA installer NSIS & bukan tukar exe in-place: portable exe yang
// menggantikan dirinya semasa berjalan GAGAL di Windows (fail dikunci);
// installer NSIS one-click `/S` memasang semula atas pemasangan sedia ada
// dengan selamat — app hanya perlu quit. Mod PORTABLE pula tidak boleh
// dipasang semula secara senyap (tiada installer berdaftar) → hanya TUNJUK
// notis kemas kini dalam menu tersembunyi (Ctrl+Shift+M) + log arahan.
//
// Prinsip offline-first: SEMUA panggilan rangkaian ada timeout & dibalut
// try/catch — kegagalan log sahaja, kiosk TIDAK PERNAH crash kerana updater.
//
// Konfigurasi: updater.json di sebelah exe ({repo, binaryName}) — ditulis oleh
// tools/package.mjs ke resources/ dan dihantar electron-builder melalui
// extraResources. Override env: MASJIDTV_UPDATE_REPO (ujian),
// MASJIDTV_DISABLE_UPDATER=1 (matikan sepenuhnya).
//
// Status didedahkan ke menu tersembunyi melalui <dataDir>/update-status.json
// → endpoint /api/update-status (pola sama seperti devices.json →
// /api/devices-hw) — tiada IPC preload diperlukan.
//
// Nota: logik checksum/semver diduplikasi sedikit daripada
// packages/server/src/updater.ts (laluan SEA legacy — JANGAN diubah). Bundle
// esbuild kiosk merangkumi @masjidtv/server, tetapi mengimport updater.ts
// legacy turut menyeret rekaan atomic-swap exe yang tidak relevan di sini —
// duplikasi ~30 baris lebih selamat daripada memecahkan bundle.

import { app } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type UpdateState =
  | 'disabled'      // updater dimatikan / tiada updater.json
  | 'idle'          // menunggu kitaran poll berikutnya
  | 'checking'      // sedang semak GitHub Releases
  | 'available'     // versi baru dikesan (mod portable — notis sahaja)
  | 'downloading'   // sedang muat turun installer + checksum
  | 'ready'         // checksum OK — installer akan dilancarkan bila app quit
  | 'installing'    // installer dilancarkan — app sedang quit
  | 'error';        // ralat terakhir (dilog; kitaran seterusnya cuba semula)

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  availableVersion: string | null;
  lastCheckAt: number | null;
  lastError: string | null;
  portable: boolean;
}

interface UpdaterConfig {
  repo: string;       // cth. "owner/MasjidTV"
  binaryName: string; // nama asas, cth. "MasjidTV-Kiosk" (tanpa "-Setup")
}

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
const STARTUP_DELAY_MS = 60_000;             // semakan pertama ~60sa selepas mula
// Override host API GitHub — hanya untuk ujian tempatan (pelayan releases
// palsu). JANGAN ditetapkan dalam produksi; lalai ke api.github.com.
const UPDATE_HOST = (process.env.MASJIDTV_UPDATE_HOST || 'https://api.github.com').replace(/\/$/, '');
const NET_TIMEOUT_MS = 15_000;               // semua panggilan rangkaian ~15sa
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // installer ~150MB — muat turun lebih lama
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024; // siling saiz installer (400MB)

// Peta mesej ralat dalaman (mengandungi URL/IP/laluan fail) kepada enum pendek
// selamat untuk didedahkan melalui /api/update-status tanpa-auth (LAN) —
// mengelak kebocoran maklumat dalaman kepada klien LAN.
function sanitizeError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('econnrefused') || m.includes('enotfound') || m.includes('etimedout')
    || m.includes('econnreset') || m.includes('timeout') || m.includes('network')
    || m.includes('fetch failed') || m.includes('socket') || m.includes('dns')) return 'network';
  if (m.includes('checksum')) return 'checksum';
  if (m.includes('http ')) return `http-${(m.match(/http (\d+)/) || [])[1] || 'error'}`;
  if (m.includes('spawn') || m.includes('enoent') || m.includes('eacces') || m.includes('installer')) return 'spawn';
  return 'error';
}

// Bandingkan tag semver "a.b.c" — pulangkan >0 jika a>b, <0 jika a<b, 0 jika sama.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Deteksi mod portable electron-builder: launcher menetapkan
// PORTABLE_EXECUTABLE_FILE/DIR semasa runtime, dan mengekstrak app ke %TEMP%
// (process.execPath berada dalam folder temp). Sama heuristik seperti
// autostart.ts — installer NSIS meninggalkan kunci uninstall, portable tidak.
function isPortableMode(): boolean {
  // Env electron-builder portable ialah isyarat utama; regex laluan %TEMP%
  // hanya fallback — benarkan '-'/'.'/''_' dalam nama folder temp (B1).
  if (process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) return true;
  return /\\Temp\\[a-zA-Z0-9._-]+\\[^\\]*MasjidTV/i.test(process.execPath);
}

// Baca updater.json di sebelah exe (extraResources → resources/updater.json).
// Fallback: repo dari env (ujian), nama binari lalai mengikut artifactName NSIS.
function loadConfig(): UpdaterConfig | null {
  const envRepo = process.env.MASJIDTV_UPDATE_REPO;
  try {
    const exeDir = path.dirname(app.getPath('exe'));
    const candidates = [
      path.join(exeDir, 'updater.json'),                       // sebelah exe
      path.join(process.resourcesPath || '', 'updater.json'),  // extraResources (resources/)
      path.join(exeDir, 'resources', 'updater.json')
    ];
    for (const c of candidates) {
      try {
        const raw = JSON.parse(fs.readFileSync(c, 'utf8')) as Partial<UpdaterConfig>;
        const repo = envRepo || raw.repo;
        if (repo && raw.binaryName) return { repo, binaryName: raw.binaryName };
      } catch { /* fail tiada/rosak — cuba calon seterusnya */ }
    }
    // Dev/u jalur: updater.json tiada — benarkan ujian melalui env sahaja.
    if (envRepo) return { repo: envRepo, binaryName: 'MasjidTV-Kiosk' };
  } catch { /* app belum sedia */ }
  return null;
}

export class KioskUpdater {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private cfg: UpdaterConfig;
  private portable: boolean;
  private installerPath: string | null = null;
  private installing = false;
  private status: UpdateStatus;
  private statusFile: string | null;
  private lastStatusWrite = 0;

  constructor(dataDir?: string) {
    this.portable = isPortableMode();
    const disabled = process.env.MASJIDTV_DISABLE_UPDATER === '1';
    const cfg = disabled ? null : loadConfig();
    this.cfg = cfg || { repo: '', binaryName: '' };
    this.statusFile = dataDir ? path.join(dataDir, 'update-status.json') : null;
    this.status = {
      state: cfg ? 'idle' : 'disabled',
      currentVersion: app.getVersion(),
      availableVersion: null,
      lastCheckAt: null,
      lastError: null,
      portable: this.portable
    };
    if (disabled) console.log('[updater] dilumpuhkan (MASJIDTV_DISABLE_UPDATER=1).');
    else if (!cfg) console.log('[updater] updater.json tiada — self-update tidak aktif.');
    else console.log(`[updater] aktif — repo=${cfg.repo} versi=${this.status.currentVersion} portable=${this.portable}`);
    this.writeStatus();
  }

  // Tulis status ke <dataDir>/update-status.json — dibaca /api/update-status
  // (menu tersembunyi). Throttled 2sa pada laluan biasa; force=true memintas
  // throttle (keadaan terminal + ujian automatik yang membaca fail segera).
  private writeStatus(force = false): void {
    if (!this.statusFile) return;
    const now = Date.now();
    if (!force && now - this.lastStatusWrite < 2000) return;
    this.lastStatusWrite = now;
    try {
      fs.writeFileSync(this.statusFile, JSON.stringify(this.status), 'utf8');
    } catch { /* gagal tulis — bukan kritikal */ }
  }

  start(): void {
    if (this.status.state === 'disabled') return;
    // Semakan pertama lewat sedikit — beri pelayan/paparan mula dahulu.
    this.startupTimer = setTimeout(() => { void this.safeCheck(); }, STARTUP_DELAY_MS);
    this.startupTimer.unref?.();
    this.timer = setInterval(() => { void this.safeCheck(); }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.timer = null;
    this.startupTimer = null;
  }

  // Balutan mutlak: updater TIDAK BOLEH crash kiosk — log sahaja.
  private async safeCheck(): Promise<void> {
    try {
      await this.check();
    } catch (err) {
      this.status.state = 'error';
      this.status.lastError = sanitizeError(err instanceof Error ? err.message : String(err));
      console.error('[updater] semakan gagal (senyap):', err instanceof Error ? err.message : String(err));
      this.writeStatus();
    }
  }

  // checkOnce: dedah satu kitaran semakan untuk harness ujian automatik
  // (scripts/test-updater.mjs) — memintas pemasa startup/poll + throttle
  // status (ujian membaca fail segera selepas pulang). Produk menggunakan
  // start() biasa; ini hanya untuk ujian.
  async checkOnce(): Promise<void> {
    await this.safeCheck();
    this.writeStatus(true);
  }

  private async check(): Promise<void> {
    this.status.state = 'checking';
    const res = await fetch(`${UPDATE_HOST}/repos/${this.cfg.repo}/releases/latest`, {
      headers: { 'User-Agent': 'masjidtv-kiosk-updater', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(NET_TIMEOUT_MS)
    });
    this.status.lastCheckAt = Date.now();
    if (!res.ok) {
      this.status.state = 'idle';
      this.status.lastError = `http-${res.status}`;
      this.writeStatus();
      return;
    }
    const release = (await res.json()) as Release;
    const tag = String(release.tag_name || '').replace(/^v/, '');
    // Langkau jika versi sama/lama — elak downgrade & muat turun berulang.
    if (!tag || compareVersions(tag, this.status.currentVersion) <= 0) {
      this.status.state = 'idle';
      this.status.lastError = null;
      this.writeStatus();
      return;
    }
    this.status.availableVersion = tag;
    console.log(`[updater] versi baru dikesan: ${this.status.currentVersion} -> ${tag}`);

    // PORTABLE: tidak boleh pasang semula senyap — notis sahaja (menu
    // tersembunyi memaparkan status ini + arahan muat turun manual).
    if (this.portable) {
      this.status.state = 'available';
      this.writeStatus();
      console.log(`[updater] mod portable — muat turun manual MasjidTV-Kiosk-Portable-${tag}.exe dari GitHub Releases.`);
      return;
    }

    await this.downloadAndVerify(release, tag);
  }

  private async downloadAndVerify(release: Release, tag: string): Promise<void> {
    // Nama asset sepadan artifactName dalam electron-builder.json + release.yml.
    const setupName = `${this.cfg.binaryName}-Setup-${tag}.exe`;
    const setupAsset = release.assets.find((a) => a.name === setupName);
    if (!setupAsset) {
      this.status.state = 'idle';
      this.status.lastError = `asset ${setupName} tiada dalam release`;
      console.error(`[updater] ${this.status.lastError} — langkau.`);
      this.writeStatus();
      return;
    }

    this.status.state = 'downloading';
    this.writeStatus();
    const dir = path.join(os.tmpdir(), 'masjidtv-kiosk-update');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, setupName);

    // Had saiz: tolak asset luar biasa besar SEBELUM muat turun — elak OOM
    // pada mini PC low-spec (arrayBuffer menampung keseluruhan fail dalam RAM).
    if (typeof setupAsset.size === 'number' && setupAsset.size > MAX_INSTALLER_BYTES) {
      this.status.state = 'error';
      this.status.lastError = 'error';
      console.error(`[updater] asset ${setupName} ${setupAsset.size} bait melebihi siling ${MAX_INSTALLER_BYTES} — kemas kini dibatalkan.`);
      this.writeStatus();
      return;
    }

    const dl = await fetch(setupAsset.browser_download_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!dl.ok) {
      this.status.state = 'error';
      this.status.lastError = `http-${dl.status}`;
      this.writeStatus();
      return;
    }
    const buf = Buffer.from(await dl.arrayBuffer());

    // Checksum sha256 WAJIB — FAIL CLOSED: asset .sha256 tiada ATAU gagal
    // disahkan = kemas kini dibatalkan. release.yml sentiasa mengupload
    // <nama>.sha256; ketiadaannya = anomali/serangan, BUKAN keadaan normal.
    const sumAsset = release.assets.find((a) => a.name === `${setupName}.sha256`);
    if (!sumAsset) {
      this.status.state = 'error';
      this.status.lastError = 'checksum';
      console.error('[updater] asset .sha256 tiada dalam release — kemas kini dibatalkan (fail-closed).');
      this.writeStatus();
      return;
    }
    let expected: string | null = null;
    try {
      const sumRes = await fetch(sumAsset.browser_download_url, { signal: AbortSignal.timeout(NET_TIMEOUT_MS) });
      if (sumRes.ok) expected = (await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
    } catch {
      expected = null;
    }
    const actual = sha256Hex(buf);
    if (!expected || expected !== actual) {
      this.status.state = 'error';
      this.status.lastError = 'checksum';
      console.error(`[updater] checksum ${expected ? 'tidak sepadan' : 'gagal dimuat turun'} — kemas kini dibatalkan.`);
      this.writeStatus();
      return;
    }

    fs.writeFileSync(dest, buf);
    this.installerPath = dest;
    this.status.state = 'ready';
    this.status.lastError = null;
    this.writeStatus();
    console.log(`[updater] installer ${setupName} disahkan — sedia dipasang.`);

    // UJIAN (MASJIDTV_UPDATE_DRY_RUN=1): sahkan checksum + tulis installer,
    // tetapi JANGAN lancarkan installer / quit — untuk harness automatik
    // (scripts/test-updater.mjs). Tiada kesan dalam produksi.
    if (process.env.MASJIDTV_UPDATE_DRY_RUN === '1') {
      console.log('[updater] DRY-RUN — pemasangan dilangkau (ujian).');
      return;
    }

    // Pasang serta-merta: kemas kini kiosk tidak patut menunggu reboot —
    // paparan terputus beberapa saat kemudian dilancarkan semula oleh NSIS
    // (runAfterFinish). Pasang hanya bila app quit semula jadi (before-quit).
    this.installNow();
  }

  // Lancar installer NSIS senyap (/S) kemudian quit — installer memasang atas
  // pemasangan sedia ada & melancarkan semula app versi baru.
  private installNow(): void {
    if (!this.installerPath || this.installing) return;
    this.installing = true;
    this.status.state = 'installing';
    this.writeStatus();
    try {
      const child = spawn(this.installerPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.on('error', (err) => {
        console.error('[updater] installer gagal dilancarkan:', err.message);
        this.installing = false;
        this.status.state = 'error';
        this.status.lastError = `installer: ${err.message}`;
        this.writeStatus();
      });
      child.unref();
      console.log('[updater] installer dilancarkan (/S) — app quit untuk pemasangan.');
      // Sedikit lengah supaya proses installer stabil sebelum app keluar.
      setTimeout(() => {
        try { app.quit(); } catch { /* sudah quit */ }
      }, 2000);
    } catch (err) {
      this.installing = false;
      this.status.state = 'error';
      this.status.lastError = err instanceof Error ? err.message : String(err);
      console.error('[updater] install gagal:', this.status.lastError);
      this.writeStatus();
    }
  }
}

let instance: KioskUpdater | null = null;

export function startKioskUpdater(dataDir?: string): KioskUpdater {
  if (!instance) {
    instance = new KioskUpdater(dataDir);
    instance.start();
  }
  return instance;
}
