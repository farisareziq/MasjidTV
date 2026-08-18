// Enumerasi peranti video (kamera) Windows tanpa dependency native:
// PowerShell Get-PnpDevice (Class: Camera, Image) — pantas & standard.
// Dipanggil berkala oleh kiosk; hasil dihantar ke pelayan lokal melalui
// file state (<dataDir>/devices.json) yang dibaca oleh endpoint
// /api/admin/devices-hw (lokal) dan dilaporkan ke cloud oleh SSE bridge.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface HwDevice {
  id: string;
  name: string;
  status: 'OK' | 'Error' | 'Unknown';
}

const PS = [
  '$ErrorActionPreference="SilentlyContinue"',
  'Get-PnpDevice -Class Camera,Image -PresentOnly |',
  '  Select-Object FriendlyName,InstanceId,Status |',
  '  ConvertTo-Json -Compress'
].join(' ');

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

export interface DevicesState {
  cameras: HwDevice[];
  checkedAt: number;
}

export function devicesStatePath(dataDir: string): string {
  return path.join(dataDir, 'devices.json');
}

export function readDevicesState(dataDir: string): DevicesState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(devicesStatePath(dataDir), 'utf8'));
    if (raw && Array.isArray(raw.cameras)) {
      return { cameras: raw.cameras, checkedAt: Number(raw.checkedAt) || 0 };
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
// menunjukkan status perkakasan setiap mini PC.
export function startCameraWatch(dataDir: string, cloudConfig?: () => { cloudUrl: string; deviceToken: string } | null): void {
  const reportToCloud = async (cameras: HwDevice[]) => {
    if (!cloudConfig) return;
    const cfg = cloudConfig();
    if (!cfg) return; // belum dipaut
    try {
      await fetch(`${cfg.cloudUrl}/api/device/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-token': cfg.deviceToken },
        body: JSON.stringify({ cameras }),
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      /* cloud offline — cuba semula pada kitaran berikutnya */
    }
  };
  const check = async () => {
    const cameras = await listCameras();
    writeDevicesState(dataDir, { cameras, checkedAt: Date.now() });
    await reportToCloud(cameras);
  };
  check();
  setInterval(check, 60_000).unref?.();
}
