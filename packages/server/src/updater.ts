// Self-updater: polls GitHub Releases for a newer single binary, downloads it
// to a temp file, verifies a checksum, and atomically swaps it on next restart.
// No npm/git required on the mini PC. On failure, the last-good binary is kept.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface UpdaterOptions {
  repo: string; // e.g. "owner/masjidtv"
  currentVersion: string;
  installDir: string; // directory containing the running binary
  binaryName: string; // e.g. "masjidtv.exe"
  pollIntervalMs?: number;
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

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export class Updater {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: UpdaterOptions) {}

  start(): void {
    const interval = this.opts.pollIntervalMs || 6 * 60 * 60 * 1000;
    this.check().catch((err) => console.error('[updater] check failed:', err.message));
    this.timer = setInterval(() => {
      this.check().catch((err) => console.error('[updater] check failed:', err.message));
    }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private binaryPath(): string {
    return path.join(this.opts.installDir, this.opts.binaryName);
  }

  async check(): Promise<void> {
    const { repo, currentVersion } = this.opts;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'masjidtv-updater', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return;
    const release = (await res.json()) as Release;
    const tag = release.tag_name.replace(/^v/, '');
    // Skip jika versi sama ATAU lebih lama (elak downgrade melalui release
    // yanked + elak muat turun semula berulang selepas swap berjaya).
    if (compareVersions(tag, currentVersion) <= 0) return;

    const asset = release.assets.find((a) => a.name === this.opts.binaryName);
    if (!asset) return;

    // Download to temp, verify checksum (if a .sha256 asset exists), then swap.
    const tmp = `${this.binaryPath()}.tmp`;
    const dl = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(300000) });
    if (!dl.ok) return;
    const buf = Buffer.from(await dl.arrayBuffer());
    fs.writeFileSync(tmp, buf);

    // Optional checksum verification — FAIL CLOSED: jika asset checksum wujud
    // tetapi tidak dapat dimuat turun/disahkan, batalkan kemas kini.
    const sumAsset = release.assets.find((a) => a.name === `${this.opts.binaryName}.sha256`);
    if (sumAsset) {
      let expected: string | null = null;
      try {
        const sumRes = await fetch(sumAsset.browser_download_url, { signal: AbortSignal.timeout(20000) });
        if (sumRes.ok) expected = (await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
      } catch {
        expected = null;
      }
      if (!expected) {
        fs.unlinkSync(tmp);
        console.error('[updater] checksum asset gagal dimuat turun — mengekalkan binari semasa');
        return;
      }
      const actual = crypto.createHash('sha256').update(buf).digest('hex');
      if (expected !== actual) {
        fs.unlinkSync(tmp);
        console.error('[updater] checksum mismatch — keeping current binary');
        return;
      }
    }

    // Atomic swap: rename over the running binary (Windows allows this on next
    // process exit). Keep the current as a rollback copy; restore it if the
    // final rename fails (AV/lock) supaya servis masih boleh mula selepas reboot.
    const binary = this.binaryPath();
    const backup = `${binary}.bak`;
    let hadBackup = false;
    try {
      fs.renameSync(binary, backup);
      hadBackup = true;
    } catch {
      /* no current binary (dev mode) */
    }
    try {
      fs.renameSync(tmp, binary);
    } catch (err) {
      console.error('[updater] swap gagal — memulihkan binari semasa:', err instanceof Error ? err.message : err);
      try {
        if (hadBackup) fs.renameSync(backup, binary);
        else fs.unlinkSync(tmp);
      } catch {
        /* biarkan .tmp/.bak untuk pemulihan manual */
      }
      return;
    }
    console.log(`[updater] updated ${currentVersion} -> ${tag}; restart to apply`);
  }
}
