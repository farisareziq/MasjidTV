// Dev launcher: electron . dengan env dev (public dir dari packages).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const kioskDir = path.resolve(__dirname, '..');
const repo = path.resolve(kioskDir, '..', '..');

const electron = path.join(kioskDir, 'node_modules', 'electron');
const { default: electronPath } = await import(electron);

const p = spawn(electronPath, ['.'], {
  cwd: kioskDir,
  env: {
    ...process.env,
    MASJIDTV_PUBLIC_DIR: path.join(repo, 'packages', 'frontend', 'public'),
    NODE_ENV: 'development'
  },
  stdio: 'inherit'
});
p.on('exit', (c) => process.exit(c || 0));
