// Autostart log masuk untuk kiosk. Kekalkan kontrak flags SEA sedia ada
// (--install-autostart / --remove-autostart) supaya dokumentasi dan skrip
// vendor tidak berubah. Gunakan electron setLoginItemSettings sebagai
// mekanisme utama; HKCU reg add sebagai fallback tanpa Electron API.

import { app } from 'electron';
import { execFileSync } from 'node:child_process';

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = 'MasjidTV';

export function installAutostart(): void {
  try {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--autostart'] });
    console.log(`Autostart dipasang: "${process.execPath}" akan mula semasa log masuk.`);
    return;
  } catch {
    /* jatuh kepada reg — contoh: env tanpa Electron API penuh */
  }
  try {
    execFileSync('reg', ['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', `"${process.execPath}"`, '/f'], { stdio: 'inherit' });
    console.log(`Autostart dipasang (reg): "${process.execPath}".`);
  } catch (err) {
    console.error('Autostart gagal dipasang:', err instanceof Error ? err.message : err);
  }
}

export function removeAutostart(): void {
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
