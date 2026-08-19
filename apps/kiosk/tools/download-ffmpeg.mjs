// Muat turun ffmpeg.exe (BtbN FFmpeg-Builds, GPL, win64) untuk dibundel
// dalam installer kiosk. Sekali sahaja — disimpan dalam apps/kiosk/bin/.
//
// SUPPLY-CHAIN HARDENING: binari pihak ketiga yang diagihkan kepada pelanggan
// tidak boleh bergantung pada "latest" tanpa pengesahan. Dua lapisan:
//   1. PIN versi + hash: tetapkan FFMPEG_SHA256 (sha256 zip penuh, dari
//      nota release BtbN/API `digest`) untuk build rilis yang boleh
//      diulang-terus (reproducible). Skrip GAGAL jika hash tidak padan.
//   2. Tanpa pin: sahkan sha256 zip yang dimuat turun sepadan dengan digest
//      yang diumumkan oleh GitHub API (masih bergantung pada upstream, tetapi
//      menangkap kerosakan MITM/tampering dalam transit).
// Jika FFMPEG_SHA256 kosong DAN digest API tidak diperoleh → ABORT (ralat
// jelas) kecuali FFMPEG_ALLOW_UNVERIFIED=1 (dev tempatan sahaja).
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
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

const REPO = 'BtbN/FFmpeg-Builds';
// Pin versi di sini untuk rilis boleh-ulang; kosong = latest (API-verified).
const PIN_TAG = ''; // cth. 'autobuild-2026-08-18-12-50'
const ZIP_NAME = 'ffmpeg-master-latest-win64-gpl.zip';
const PIN_SHA256 = (process.env.FFMPEG_SHA256 || '').toLowerCase().replace(/^sha256:/, '');

const tmpZip = path.join(kioskDir, '.ffmpeg-tmp.zip');

async function expectedSha256() {
  if (PIN_SHA256) return PIN_SHA256;
  try {
    const tag = PIN_TAG || 'latest';
    const api = PIN_TAG
      ? `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
      : `https://api.github.com/repos/${REPO}/releases/${tag}`;
    const res = await fetch(api, {
      headers: { 'user-agent': 'masjidtv-kiosk-build', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => a.name === ZIP_NAME);
    const digest = String(asset?.digest || ''); // format "sha256:<hex>"
    return digest.startsWith('sha256:') ? digest.slice(7).toLowerCase() : null;
  } catch {
    return null;
  }
}

const url = PIN_TAG
  ? `https://github.com/${REPO}/releases/download/${PIN_TAG}/${ZIP_NAME}`
  : `https://github.com/${REPO}/releases/download/latest/${ZIP_NAME}`;

console.log(`[ffmpeg] memuat turun ${url} ...`);
const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
if (!res.ok) throw new Error(`muat turun gagal: HTTP ${res.status}`);
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpZip));
const sizeMb = (fs.statSync(tmpZip).size / 1e6).toFixed(1);

// Pengesahan integriti (wajib untuk rilis; FFMPEG_ALLOW_UNVERIFIED=1 memintas
// untuk dev tempatan dengan amaran jelas).
const expected = await expectedSha256();
if (expected) {
  console.log(`[ffmpeg] zip siap (${sizeMb}MB) — mengesahkan sha256...`);
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(tmpZip);
    s.on('data', (c) => hash.update(c));
    s.on('end', resolve);
    s.on('error', reject);
  });
  const actual = hash.digest('hex');
  if (actual !== expected) {
    fs.rmSync(tmpZip, { force: true });
    throw new Error(`[ffmpeg] INTEGRITI GAGAL: sha256 ${actual} != ${expected} — zip dibuang, tiada pemasangan.`);
  }
  console.log(`[ffmpeg] sha256 OK (${actual.slice(0, 16)}…)`);
} else if (process.env.FFMPEG_ALLOW_UNVERIFIED === '1') {
  console.warn('[ffmpeg] AMARAN: tiada hash untuk disahkan — pemasangan TANPA pengesahan (FFMPEG_ALLOW_UNVERIFIED=1). JANGAN gunakan untuk rilis pelanggan.');
} else {
  fs.rmSync(tmpZip, { force: true });
  throw new Error('[ffmpeg] tiada digest untuk pengesahan (API GitHub tidak capai?) — rujuk FFMPEG_SHA256/FFMPEG_ALLOW_UNVERIFIED');
}

console.log(`[ffmpeg] mengekstrak ffmpeg.exe ...`);
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
