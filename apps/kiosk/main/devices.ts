// Enumerasi peranti video (kamera) Windows tanpa dependency native:
// 1. PnP: Get-PnpDevice (Class: Camera, Image) — nama mesin + status.
// 2. DirectShow: ffmpeg -list_devices — nama peranti SEBENAR yang ffmpeg
//    boleh guna untuk stream DSHOW (cth. "OBS Virtual Camera") — ini yang
//    perlu ditulis dalam medan URL stream DSHOW.
// Hasil ditulis ke <dataDir>/devices.json, dibaca oleh endpoint
// /api/devices-hw (lokal, menu tersembunyi) dan dilaporkan ke cloud
// (Peranti TV menunjukkan senarai nama yang boleh copy-paste).

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface HwDevice {
  id: string;
  name: string;
  status: 'OK' | 'Error' | 'Unknown';
}

export interface DshowVideoDevice {
  name: string;
}

export interface DevicesState {
  cameras: HwDevice[];
  /** Peranti video DirectShow (nama untuk URL stream DSHOW). */
  dshow: DshowVideoDevice[];
  checkedAt: number;
}

const PS = [
  '$ErrorActionPreference="SilentlyContinue"',
  'Get-PnpDevice -Class Camera,Image -PresentOnly |',
  '  Select-Object FriendlyName,InstanceId,Status |',
  '  ConvertTo-Json -Compress'
].join(' ');

function listDshow(ffmpegPath: string | null): Promise<DshowVideoDevice[]> {
  if (!ffmpegPath) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      timeout: 10000,
      windowsHide: true
    }, (_err, _stdout, stderr) => {
      const out = String(stderr || '');
      const devices: DshowVideoDevice[] = [];
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/"(.+?)"\s+\(video\)/);
        if (m) devices.push({ name: m[1] });
      }
      resolve(devices);
    });
  });
}

export function listCameras(): Promise<HwDevice[]> {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', PS], { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      try {
        const raw = JSON.parse(stdout.toString().trim()) as unknown;
        const arr = Array.isArray(raw) ? raw : [raw];
        resolve(arr
          .filter((d) => d && typeof d === 'object' && (d as { FriendlyName?: string }).FriendlyName)
          .map((d) => {
            const o = d as { FriendlyName: string; InstanceId: string; Status: string };
            return {
              id: String(o.InstanceId || '').slice(0, 120),
              name: String(o.FriendlyName).slice(0, 80),
              status: o.Status === 'OK' ? 'OK' : o.Status === 'Error' ? 'Error' : 'Unknown'
            } as HwDevice;
          }));
      } catch {
        resolve([]);
      }
    });
  });
}

export function devicesStatePath(dataDir: string): string {
  return path.join(dataDir, 'devices.json');
}

export function readDevicesState(dataDir: string): DevicesState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(devicesStatePath(dataDir), 'utf8'));
    if (raw && Array.isArray(raw.cameras)) {
      return {
        cameras: raw.cameras,
        dshow: Array.isArray(raw.dshow) ? raw.dshow : [],
        checkedAt: Number(raw.checkedAt) || 0
      };
    }
  } catch {
    /* tiada */
  }
  return null;
}

export function writeDevicesState(dataDir: string, state: DevicesState): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(devicesStatePath(dataDir), JSON.stringify(state), 'utf8');
  } catch {
    /* gagal tulis — bukan kritikal */
  }
}

// Poll kamera setiap 60sa — peranti USB plug/unplug dikesan secara dinamik.
// Bila `cloudConfig` disediakan (kiosk berjalan), laporan juga dihantar ke
// cloud (POST /api/device/report, auth device-token) supaya web admin
// menunjukkan status perkakasan + senarai nama DSHOW setiap mini PC.
export function startCameraWatch(
  dataDir: string,
  cloudConfig?: () => { cloudUrl: string; deviceToken: string } | null,
  getFfmpeg?: () => string | null
): void {
  const reportToCloud = async (cameras: HwDevice[], dshow: DshowVideoDevice[]) => {
    if (!cloudConfig) return;
    const cfg = cloudConfig();
    if (!cfg) return; // belum dipaut
    try {
      await fetch(`${cfg.cloudUrl}/api/device/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-token': cfg.deviceToken },
        body: JSON.stringify({ cameras, dshow }),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      /* cloud offline — cuba semula pada kitaran berikutnya */
    }
  };
  const check = async () => {
    const cameras = await listCameras();
    const dshow = getFfmpeg ? await listDshow(getFfmpeg()) : [];
    writeDevicesState(dataDir, { cameras, dshow, checkedAt: Date.now() });
    await reportToCloud(cameras, dshow);
  };
  check();
  setInterval(check, 60_000).unref?.();
}
