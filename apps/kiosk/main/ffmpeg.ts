// Rantai resolusi ffmpeg untuk app kiosk:
//   env FFMPEG_PATH → binari dibundel (extraResources) → fallback muat turun
//   ensure-ffmpeg ke <dataDir>/bin (binaan statik BtbN).
// dipakai semasa bootstrap; laluan disuntik ke pelayan melalui
// AppOptions.ffmpegPathOverride.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensureFfmpeg } from '@masjidtv/server/dist/ensure-ffmpeg.js';

function ffmpegWorks(exe: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(exe, ['-version'], { stdio: 'ignore', timeout: 8000 });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

export async function resolveFfmpeg(dataDir: string): Promise<string | null> {
  // 1) Env eksplisit.
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }

  // 2) Binari dibundel oleh electron-builder (extraResources bin/ffmpeg.exe).
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe'),
    path.join(__dirname, '..', '..', 'resources', 'bin', 'ffmpeg.exe')
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c) && await ffmpegWorks(c)) return c;
    } catch { /* resourcesPath belum sedia */ }
  }

  // 3) Lalai sistem PATH.
  if (await ffmpegWorks('ffmpeg')) return 'ffmpeg';

  // 4) Fallback: muat turun binaan statik (sekali sahaja) ke dataDir/bin.
  const r = await ensureFfmpeg(dataDir);
  if (r.ok && r.path) return r.path;
  return null;
}
