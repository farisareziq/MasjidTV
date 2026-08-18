// Muat turun ffmpeg.exe (BtbN FFmpeg-Builds, GPL, win64) untuk dibundel
// dalam installer kiosk. Sekali sahaja — disimpan dalam apps/kiosk/bin/.
// Lokasi: github.com/BtbN/FFmpeg-Builds/releases (latest/ffmpeg-master-
// latest-win64-gpl.zip). Diekstrak: hanya ffmpeg.exe (~160MB→…).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kioskDir = path.resolve(__dirname, '..');
const binDir = path.join(kioskDir, 'bin');
const ffmpegPath = path.join(binDir, 'ffmpeg.exe');

if (fs.existsSync(ffmpegPath) && fs.statSync(ffmpegPath).size > 10_000_000) {
  console.log(`[ffmpeg] sedia: ${ffmpegPath}`);
  process.exit(0);
}

const URL_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest';
const zipName = 'ffmpeg-master-latest-win64-gpl.zip';
const tmpZip = path.join(kioskDir, '.ffmpeg-tmp.zip');

console.log(`[ffmpeg] memuat turun ${URL_BASE}/${zipName} ...`);
const res = await fetch(`${URL_BASE}/${zipName}`, { signal: AbortSignal.timeout(600000) });
if (!res.ok) throw new Error(`muat turun gagal: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpZip));
console.log(`[ffmpeg] zip siap (${(fs.statSync(tmpZip).size / 1e6).toFixed(1)}MB) — mengekstrak ffmpeg.exe ...`);

fs.mkdirSync(binDir, { recursive: true });
// PowerShell Expand-Archive: ekstrak kemudian pindahkan ffmpeg.exe sahaja.
const extractDir = path.join(kioskDir, '.ffmpeg-extract');
fs.rmSync(extractDir, { recursive: true, force: true });
execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${extractDir}' -Force"`, { stdio: 'inherit' });
const found = findFile(extractDir, 'ffmpeg.exe');
if (!found) throw new Error('ffmpeg.exe tidak dijumpai dalam zip');
fs.copyFileSync(found, ffmpegPath);

fs.rmSync(tmpZip, { force: true });
fs.rmSync(extractDir, { recursive: true, force: true });
console.log(`[ffmpeg] siap: ${ffmpegPath} (${(fs.statSync(ffmpegPath).size / 1e6).toFixed(1)}MB)`);

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}
