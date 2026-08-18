// Enumerasi peranti DirectShow (kamera/vebenar OBS) melalui ffmpeg
// -list_devices. Output dihantar ke /api/admin/dshow-devices (kiosk) dan
// digunakan oleh menu tersembunyi + web admin (pilihan dropdown).

import { execFile } from 'node:child_process';

export interface DshowDevice {
  name: string;
  alt: string;
  kind: 'video' | 'audio';
}

export function listDshowDevices(ffmpegPath: string): Promise<DshowDevice[]> {
  return new Promise((resolve) => {
    execFile(ffmpegPath || 'ffmpeg', ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], {
      timeout: 10000,
      windowsHide: true
    }, (_err, _stdout, stderr) => {
      // ffmpeg sentiasa "gagal" (tiada input dummy) tetapi senarai peranti
      // dicetak ke stderr.
      const out = String(stderr || '');
      const devices: DshowDevice[] = [];
      const lines = out.split(/\r?\n/);
      for (const line of lines) {
        // Format: "name" (video) / "name" (audio)
        const m = line.match(/"(.+?)"\s+\((video|audio)\)/);
        if (m) {
          devices.push({ name: m[1], alt: '', kind: m[2] as 'video' | 'audio' });
        }
        // Baris berikut: Alternative name "@device_cm_..."
        const alt = line.match(/Alternative name\s+"(.+?)"/);
        if (alt && devices.length) {
          devices[devices.length - 1].alt = alt[1];
        }
      }
      resolve(devices);
    });
  });
}
