// RUN E2E PENUH — satu arahan untuk seluruh saluran ujian MasjidTV:
//
//   node scripts/run-e2e.mjs              # semua peringkat
//   node scripts/run-e2e.mjs --fast       # langkau dry-run-kiosk (perlahan ~2min)
//   node scripts/run-e2e.mjs --only lint,test,dry-run
//
// Peringkat (berurutan, gagal awal = berhenti):
//   1. build      — pnpm build (semua pakej; server dist diperlukan e2e)
//   2. typecheck  — semua pakej termasuk kiosk
//   3. lint       — eslint (0 error; warning dibenarkan tapi dilaporkan)
//   4. test       — vitest (unit + integration)
//   5. dry-run    — E2E pelayan lokal (API, JAKIM, CRUD, muat naik)
//   6. pentest    — keselamatan penuh (cloud lokal + server lokal)
//   7. e2e-pairing — cloud lokal + kiosk Electron: pairing→SSE→unpair
//   8. dry-run-kiosk — simulasi hari operasi (offline, catch-up, pair semula)
//
// Peringkat 7-8 perlukan Windows + Electron (fallback dev binary automatik).
// Guna --fast utk CI tanpa kiosk. Keluar 0 = semua hijau.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const fast = args.includes('--fast');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 && args[onlyIdx + 1] ? args[onlyIdx + 1].split(',') : null;

const isWindows = process.platform === 'win32';

// Windows: pnpm ialah .ps1/.cmd — spawn tanpa shell gagal (EINVAL). Paling
// selamat: jalankan pnpm melalui node <pnpm.mjs> (tiada shell parsing).
const PNPM_CLI = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'
);
const pnpmCmd = isWindows && fs.existsSync(PNPM_CLI)
  ? [process.execPath, PNPM_CLI]
  : ['pnpm'];

const STAGES = [
  {
    name: 'build',
    desc: 'Bina semua pakej (dist diperlukan oleh e2e/kiosk)',
    cmd: pnpmCmd,
    args: ['build'],
    skip: false
  },
  {
    name: 'typecheck',
    desc: 'Typecheck semua pakej + kiosk',
    cmd: pnpmCmd,
    args: ['typecheck'],
    skip: false
  },
  {
    name: 'lint',
    desc: 'ESLint — 0 error',
    cmd: pnpmCmd,
    args: ['lint'],
    skip: false
  },
  {
    name: 'test',
    desc: 'Vitest — unit + integration',
    cmd: pnpmCmd,
    args: ['test'],
    skip: false
  },
  {
    name: 'dry-run',
    desc: 'E2E pelayan lokal (API penuh + paparan)',
    cmd: 'node',
    args: ['scripts/dry-run.mjs'],
    skip: false
  },
  {
    name: 'pentest',
    desc: 'Pentest keselamatan (cloud lokal + server lokal)',
    cmd: 'node',
    args: ['scripts/pentest.mjs'],
    skip: false
  },
  {
    name: 'e2e-pairing',
    desc: 'E2E pairing kiosk ↔ cloud (SSE <2sa, hot-activation)',
    cmd: 'node',
    args: ['scripts/e2e-pairing.mjs'],
    // Electron diperlukan — lompat di luar Windows kecuali E2E_KIOSK_EXE diberi.
    skip: !isWindows && !process.env.E2E_KIOSK_EXE
  },
  {
    name: 'dry-run-kiosk',
    desc: 'Simulasi hari operasi kiosk (offline/catch-up/unpair/repair)',
    cmd: 'node',
    args: ['scripts/dry-run-kiosk.mjs'],
    skip: (!isWindows && !process.env.E2E_KIOSK_EXE) || fast
  }
];

const t0 = Date.now();
const results = [];

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║   MasjidTV — Ujian E2E & Pentest Penuh           ║');
console.log('╚══════════════════════════════════════════════════╝\n');

for (const stage of STAGES) {
  if (only && !only.includes(stage.name)) {
    results.push({ name: stage.name, status: 'skip' });
    continue;
  }
  if (stage.skip) {
    console.log(`▸ ${stage.name} — DILANGKAU (${!isWindows ? 'bukan Windows' : '--fast'})`);
    results.push({ name: stage.name, status: 'skip' });
    continue;
  }
  console.log(`\n▸ ${stage.name} — ${stage.desc}`);
  console.log('  ' + '─'.repeat(60));
  const st = Date.now();
  const cmd = Array.isArray(stage.cmd) ? stage.cmd[0] : stage.cmd;
  const cmdArgs = [...(Array.isArray(stage.cmd) ? stage.cmd.slice(1) : []), ...stage.args];
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root,
    shell: false,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' }
  });
  const ms = Date.now() - st;
  const ok = r.status === 0;
  results.push({ name: stage.name, status: ok ? 'ok' : 'fail', ms });
  console.log(`  ${'─'.repeat(60)}`);
  console.log(`  ${ok ? '✓' : '✗'} ${stage.name} (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) {
    console.error(`\n❌ PERINGKAT "${stage.name}" GAGAL — berhenti (fail-fast).`);
    printSummary(results, Date.now() - t0, false);
    process.exit(1);
  }
}

printSummary(results, Date.now() - t0, true);
process.exit(0);

function printSummary(results, totalMs, allOk) {
  const okN = results.filter((r) => r.status === 'ok').length;
  const skipN = results.filter((r) => r.status === 'skip').length;
  const failN = results.filter((r) => r.status === 'fail').length;
  console.log('\n╔══════════════ RINGKASAN ══════════════╗');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✓' : r.status === 'skip' ? '–' : '✗';
    const time = r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : '';
    console.log(`║ ${icon} ${r.name.padEnd(18)}${r.status.toUpperCase()}${time}`);
  }
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Lulus: ${okN}  Langkau: ${skipN}  Gagal: ${failN}`);
  console.log(`║ Jumlah masa: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`║ ${allOk ? 'SEMUA HIJAU ✓' : 'ADA KEGAGALAN ✗'}`);
  console.log('╚════════════════════════════════════════╝\n');
}
