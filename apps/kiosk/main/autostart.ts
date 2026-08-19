// Autostart log masuk untuk kiosk. Dua mekanisme:
//   1. Terpasang (NSIS): app.setLoginItemSettings — Electron urus kunci Run.
//   2. PORTABLE: Windows Run key dengan portable exe tidak kekal (launcher
//      spawn anak kemudian parent keluar — Windows anggap app tamat).
//      Penyelesaian: shortcut (.lnk) dalam Startup folder membidik portable
//      exe — shortcut kekal walaupun launcher keluar.
import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = 'MasjidTV';
const SHORTCUT_NAME = 'MasjidTV Kiosk.lnk';

function startupFolder(): string {
  return path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

function isPortable(): boolean {
  // Isyarat paling boleh dipercayai ialah env electron-builder portable.
  // Regex laluan %TEMP% hanyalah fallback — nama folder temp electron-builder
  // boleh mengandungi '-'/'.'/'_' (cth. "<hash>.tmp"), jadi kelas aksara
  // [a-zA-Z0-9] dahulu akan gagal padan (B1). Benarkan aksara tersebut.
  if (process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) return true;
  const p = process.execPath;
  return /\\Temp\\[a-zA-Z0-9._-]+\\[^\\]*MasjidTV/i.test(p) || portableMarkerExists();
}

function portableMarkerExists(): boolean {
  try {
    // Portable launcher mengekstrak bersebelahan fail penanda .portable
    const dir = path.dirname(process.execPath);
    return fs.existsSync(path.join(dir, '..', '.portable')) || process.env.PORTABLE_EXECUTABLE_DIR !== undefined;
  } catch {
    return false;
  }
}

function makeShortcut(target: string): void {
  const lnk = path.join(startupFolder(), SHORTCUT_NAME);
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}')`,
    `$s.TargetPath = '${target.replace(/'/g, "''")}'`,
    `$s.WorkingDirectory = '${path.dirname(target).replace(/'/g, "''")}'`,
    `$s.Save()`
  ].join('; ');
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

function removeShortcut(): void {
  const lnk = path.join(startupFolder(), SHORTCUT_NAME);
  try {
    if (fs.existsSync(lnk)) fs.unlinkSync(lnk);
  } catch { /* dikunci */ }
}

export function installAutostart(): void {
  const exe = process.execPath;
  if (isPortable() && process.env.PORTABLE_EXECUTABLE_DIR) {
    // PORTABLE_EXECUTABLE_DIR = lokasi sebenar fail portable .exe.
    const portableExe = path.join(process.env.PORTABLE_EXECUTABLE_DIR, path.basename(exe));
    const target = fs.existsSync(portableExe) ? portableExe : exe;
    makeShortcut(target);
    console.log(`Autostart (portable) dipasang: shortcut Startup → "${target}".`);
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
    console.log(`Autostart dipasang: "${exe}" akan mula semasa log masuk.`);
    return;
  } catch {
    /* jatuh kepada reg */
  }
  try {
    execFileSync('reg', ['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', `"${exe}"`, '/f'], { stdio: 'inherit' });
    console.log(`Autostart dipasang (reg): "${exe}".`);
  } catch (err) {
    console.error('Autostart gagal dipasang:', err instanceof Error ? err.message : err);
  }
}

export function removeAutostart(): void {
  removeShortcut();
  try {
    app.setLoginItemSettings({ openAtLogin: false });
    console.log('Autostart dibuang.');
  } catch {
    /* jatuh kepada reg */
  }
  try {
    execFileSync('reg', ['delete', RUN_KEY, '/v', AUTOSTART_NAME, '/f'], { stdio: 'inherit' });
    console.log('Autostart dibuang (reg).');
  } catch {
    console.log('Autostart tidak wujud — tiada tindakan.');
  }
}
