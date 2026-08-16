// Vitest globalSetup: pastikan keperluan build wujud sebelum suite berjalan
// pada fresh clone (tanpa `pnpm build` terlebih dahulu):
// 1. packages/{shared,db}/dist — diimport oleh suite server/cloud melalui
//    package exports (main: ./dist/index.js).
// 2. packages/cloud/src/pages.generated.ts — diimport oleh src/app.ts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname; // vitest.setup.mts duduk di akar repo (global/)
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

export default function setup(): void {
  for (const pkg of ['shared', 'db']) {
    const dist = path.join(root, 'packages', pkg, 'dist');
    if (!fs.existsSync(dist)) {
      console.log(`[vitest-setup] building @masjidtv/${pkg} (dist hilang)...`);
      execFileSync(process.execPath, [tsc, '-p', path.join(root, 'packages', pkg, 'tsconfig.json')], { stdio: 'inherit' });
    }
  }

  execFileSync(
    process.execPath,
    [path.join(root, 'packages', 'cloud', 'scripts', 'gen-pages.mjs')],
    { stdio: 'inherit' }
  );
}
