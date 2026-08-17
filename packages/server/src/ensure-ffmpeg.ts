// Auto-provision ffmpeg untuk relay RTSP/RTMP/ONVIF->HLS pada mini PC.
//
// Jika ffmpeg tiada pada sistem dan tiada media.ffmpegPath dikonfigurasi,
// muat turun binaan statik (BtbN/FFmpeg-Builds untuk Windows, johnvansickle
// untuk Linux) ke <dataDir>/bin/ffmpeg[.exe], tanda sebagai executable, dan
// kembalikan laluan mutlak. Muat turun adalah sekali sahaja — boot seterusnya
// terus guna fail sedia ada.
//
// Laluan yang dikembalikan (atau null jika gagal) disimpan ke
// settings.media.ffmpegPath oleh pemanggil supaya admin nampak sumbernya.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const FFMPEG_VERSION_TAG = 'latest';

interface StaticBuild {
  url: string;
  /** Laluan ffmpeg DALAM arkib (zip/tar.xz), relatif kepada akar. */
  innerPath: string;
  kind: 'zip' | 'tar-xz';
}

function staticBuildFor(platform: NodeJS.Platform, arch: string): StaticBuild | null {
  if (platform === 'win32') {
    const a = arch === 'arm64' ? 'arm64' : 'win64';
    return {
      url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_VERSION_TAG}/ffmpeg-master-${FFMPEG_VERSION_TAG}-${a}-gpl.zip`,
      innerPath: `ffmpeg-master-${FFMPEG_VERSION_TAG}-${a}-gpl/bin/ffmpeg.exe`,
      kind: 'zip'
    };
  }
  if (platform === 'linux') {
    const a = arch === 'arm64' || arch === 'arm' ? 'arm64' : 'amd64';
    if (a !== 'amd64') {
      // johnvansickle.com hanya menyediakan x86_64; arm64 perlu pakej distro.
      return null;
    }
    return {
      url: `https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${a}-static.tar.xz`,
      innerPath: `ffmpeg-*-static/ffmpeg`,
      kind: 'tar-xz'
    };
  }
  return null;
}

export function ffmpegBinPath(dataDir: string): string {
  return path.join(dataDir, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}

/** Semak sama ada binari ffmpeg boleh dilaksanakan. */
export function probeFfmpeg(binPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(binPath, ['-version'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

async function downloadTo(url: string, dest: string, redirectBudget = 5): Promise<void> {
  if (redirectBudget <= 0) throw new Error('terlalu banyak redirect');
  const res = await fetch(url, { redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
    const next = new URL(res.headers.get('location')!, url).toString();
    return downloadTo(next, dest, redirectBudget - 1);
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest));
}

/**
 * Ekstrak fail tunggal daripada arkib tanpa dependency luar.
 * - zip (Windows): cari local file header (PK\x03\x04) dengan nama sepadan
 *   dan salin data tersimpan (stored/deflate melalui zlib).
 * - tar.xz (Linux): dekompres setiap ahli melalui zlib lzma? — Node tiada
 *   lzma built-in; gunakan tar sistem bila tersedia (hampir selalu pada
 *   Linux), jika tidak, gagal dengan mesej jelas.
 */
async function extractFile(archive: string, innerPath: string, kind: 'zip' | 'tar-xz', outPath: string): Promise<void> {
  if (kind === 'tar-xz') {
    // Linux: gunakan tar sistem (selalu ada pada distro mini PC).
    const dir = path.dirname(outPath);
    const glob = innerPath.includes('*') ? innerPath : innerPath;
    await new Promise<void>((resolve, reject) => {
      const p = spawn('tar', ['-xJf', archive, '-C', dir, '--strip-components=1', '--wildcards', glob], {
        windowsHide: true
      });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
    });
    // tar mengekstrak sebagai <dir>/ffmpeg (strip 1 komponen glob).
    const extracted = path.join(dir, 'ffmpeg');
    if (extracted !== outPath) {
      fs.renameSync(extracted, outPath);
    }
    return;
  }

  // zip: parser minimum untuk stored + deflate (binaan BtbN guna deflate).
  const zlib = await import('node:zlib');
  const buf = fs.readFileSync(archive);
  const sig = 0x04034b50;
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== sig) { off++; continue; }
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    // Saiz termampat 0 bermakna data-descriptor selepas data (bit 3) —
    // imbas ke hadapan untuk signature seterusnya adalah rapuh; binaan
    // BtbN menulis saiz dalam header, jadi laluan ini jarang diperlukan.
    if (compSize === 0) { off = dataStart; continue; }
    const isMatch = innerPath.includes('*')
      ? new RegExp('^' + innerPath.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(name)
      : name === innerPath;
    if (isMatch) {
      const comp = buf.subarray(dataStart, dataStart + compSize);
      const data = method === 0 ? comp : zlib.inflateRawSync(comp);
      fs.writeFileSync(outPath, data);
      fs.chmodSync(outPath, 0o755);
      return;
    }
    off = dataStart + compSize;
  }
  throw new Error(`fail ${innerPath} tidak dijumpai dalam arkib`);
}

async function sha256(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h as never);
  return h.digest('hex');
}

export interface EnsureResult {
  ok: boolean;
  path?: string;
  message: string;
}

/**
 * Pastikan ffmpeg tersedia:
 * 1. Jika binari <dataDir>/bin/ffmpeg sedia & boleh laku → guna.
 * 2. Jika ffmpeg pada PATH boleh laku → tiada kerja perlu.
 * 3. Jika tidak → muat turun binaan statik sekali ke <dataDir>/bin/.
 */
export async function ensureFfmpeg(dataDir: string, log = console.log): Promise<EnsureResult> {
  const local = ffmpegBinPath(dataDir);

  // 1. Binari tempatan sedia ada (boot seterusnya).
  if (fs.existsSync(local) && await probeFfmpeg(local)) {
    return { ok: true, path: local, message: 'ffmpeg (tempatan) sedia' };
  }

  // 2. Sistem.
  const sys = await probeFfmpeg('ffmpeg');
  if (sys) {
    return { ok: true, message: 'ffmpeg (sistem) sedia' };
  }

  // 3. Muat turun binaan statik.
  const build = staticBuildFor(process.platform, process.arch);
  if (!build) {
    return { ok: false, message: `tiada binaan statik untuk ${process.platform}/${process.arch} — pasang ffmpeg manual` };
  }

  const binDir = path.dirname(local);
  fs.mkdirSync(binDir, { recursive: true });
  const archive = local + (build.kind === 'zip' ? '.zip' : '.tar.xz');
  try {
    log(`[ffmpeg] tiada pada sistem — memuat turun binaan statik ke ${binDir} ...`);
    await downloadTo(build.url, archive);
    await extractFile(archive, build.innerPath, build.kind, local);
    if (process.platform !== 'win32') fs.chmodSync(local, 0o755);
    if (!(await probeFfmpeg(local))) {
      throw new Error('binari dimuat turun tidak boleh dilaksanakan');
    }
    // Buang arkib selepas berjaya (ruang cakera mini PC terhad).
    fs.rmSync(archive, { force: true });
    return { ok: true, path: local, message: `ffmpeg dimuat turun: ${local} (sha256 ${await sha256(local)})` };
  } catch (err) {
    // Buang sisa gagal supaya boot seterusnya cuba semula bersih.
    fs.rmSync(archive, { force: true });
    fs.rmSync(local, { force: true });
    return { ok: false, message: `muat turun ffmpeg gagal: ${err instanceof Error ? err.message : err}` };
  }
}
