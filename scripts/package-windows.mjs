// Packages a portable Windows kiosk bundle into dist/masjidtv-windows/:
//   MasjidTV/
//     server/          compiled server + db + shared (dist), package.json
//     frontend/        public/ assets (local variant)
//     node_modules/    pruned runtime deps (better-sqlite3 prebuilt binary included)
//     start-server.bat starts the Fastify server on port 3000
//     start-kiosk.bat  starts server + Edge in assigned-access-style kiosk mode
//     install-autostart.bat / remove-autostart.bat  HKCU Run key
//     README.txt
// Usage: node scripts/package-windows.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'masjidtv-windows', 'MasjidTV');
const tmp = path.join(root, 'dist', '.pkg-tmp');

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// Match directories under `base` matching `pattern` (simple prefix glob,
// e.g. 'better-sqlite3@*') and append `tail` — for pnpm .pnpm store lookups.
function globResolve(base, pattern, tail) {
  if (!fs.existsSync(base)) return [];
  const prefix = pattern.replace(/\*$/, '');
  return fs.readdirSync(base)
    .filter((n) => n.startsWith(prefix))
    .map((n) => path.join(base, n, tail));
}

function copyDir(src, dest, { filter } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(entry)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    // pnpm creates junctions/symlinks into its store; resolve to the real path
    const real = fs.realpathSync(s);
    const st = fs.statSync(real);
    if (st.isDirectory()) copyDir(real, d, { filter });
    else fs.copyFileSync(real, d);
  }
}

// Clean output
fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });

// 1) Build workspace
run('pnpm build', root);

// 2) Runtime install via npm (real nested node_modules, self-contained —
// unlike pnpm's symlink store layout which doesn't survive copying).
// Workspace deps are excluded and provided from our built dist/ instead.
fs.mkdirSync(tmp, { recursive: true });
const srvPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'server', 'package.json'), 'utf8'));
const dbPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'db', 'package.json'), 'utf8'));
const sharedPkg = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'shared', 'package.json'), 'utf8'));
const stripWs = (p) => ({
  name: p.name, version: p.version, type: 'module', main: p.main,
  exports: p.exports, dependencies: p.dependencies,
});
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
  name: 'masjidtv-runtime', version: '1.0.0', private: true, type: 'module',
  dependencies: {
    fastify: srvPkg.dependencies.fastify,
    '@fastify/static': srvPkg.dependencies['@fastify/static'],
    bcryptjs: srvPkg.dependencies.bcryptjs,
    'drizzle-orm': srvPkg.dependencies['drizzle-orm'],
    'better-sqlite3': dbPkg.dependencies['better-sqlite3'],
    '@libsql/client': dbPkg.dependencies['@libsql/client'],
    adhan: sharedPkg.dependencies.adhan,
  },
}, null, 2));
// empty index so npm has an entry point
fs.writeFileSync(path.join(tmp, 'index.js'), '// runtime deps only\n');
run('npm install --omit=dev --no-audit --no-fund', tmp);
void stripWs; void sharedPkg;

// 3) Assemble bundle
fs.mkdirSync(path.join(out, 'server'), { recursive: true });
copyDir(path.join(root, 'packages', 'server', 'dist'), path.join(out, 'server', 'dist'));
copyDir(path.join(root, 'packages', 'db', 'dist'), path.join(out, 'server', 'node_modules', '@masjidtv', 'db', 'dist'));
copyDir(path.join(root, 'packages', 'shared', 'dist'), path.join(out, 'server', 'node_modules', '@masjidtv', 'shared', 'dist'));
copyDir(path.join(root, 'packages', 'frontend', 'public'), path.join(out, 'frontend', 'public'));
fs.copyFileSync(path.join(root, 'packages', 'server', 'package.json'), path.join(out, 'server', 'package.json'));

// server/package.json deps resolve from server/node_modules (walked up from
// server/dist/index.js): runtime deps from the npm install, workspace
// packages (@masjidtv/db, @masjidtv/shared) from their built dist/.
copyDir(path.join(tmp, 'node_modules'), path.join(out, 'server', 'node_modules'), {
  filter: (e) => e.name !== '.bin',
});
copyDir(path.join(root, 'packages', 'db', 'dist'), path.join(out, 'server', 'node_modules', '@masjidtv', 'db', 'dist'));
copyDir(path.join(root, 'packages', 'shared', 'dist'), path.join(out, 'server', 'node_modules', '@masjidtv', 'shared', 'dist'));
fs.writeFileSync(path.join(out, 'server', 'node_modules', '@masjidtv', 'db', 'package.json'), JSON.stringify({
  name: '@masjidtv/db', version: '1.0.0', type: 'module',
  main: './dist/index.js', exports: { '.': { import: './dist/index.js' } },
}, null, 2));
fs.writeFileSync(path.join(out, 'server', 'node_modules', '@masjidtv', 'shared', 'package.json'), JSON.stringify({
  name: '@masjidtv/shared', version: '1.0.0', type: 'module',
  main: './dist/index.js', exports: { '.': { import: './dist/index.js' } },
}, null, 2));
// @masjidtv/db's own deps (better-sqlite3, drizzle-orm, @libsql/client) also
// come from the npm install — they are at the top of server/node_modules.
// --ignore-scripts was dropped so optional native deps (@libsql/win32-x64-msvc)
// install via their own prebuilt-download scripts. better-sqlite3 also builds
// or downloads its binding during npm install; verify and fall back to the
// workspace binding if needed.
// Fallback resolution order (pnpm hoists bindings into the .pnpm store —
// the old single hardcoded path packages/server/node_modules/@masjidtv/db/…
// breaks when pnpm symlinks to the store instead of nesting):
//   1. require.resolve from @masjidtv/db in the live workspace
//   2. node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/build
const bsqlDst = path.join(out, 'server', 'node_modules', 'better-sqlite3', 'build');
if (!fs.existsSync(path.join(bsqlDst, 'Release', 'better_sqlite3.node'))) {
  const candidates = [
    // (legacy layout, kept for pnpm configs that nest)
    path.join(root, 'packages', 'server', 'node_modules', '@masjidtv', 'db', 'node_modules', 'better-sqlite3', 'build'),
    // pnpm store layout: node_modules/.pnpm/better-sqlite3@x.y.z/node_modules/better-sqlite3/build
    ...globResolve(path.join(root, 'node_modules', '.pnpm'), 'better-sqlite3@*', path.join('node_modules', 'better-sqlite3', 'build')),
  ];
  const bsqlSrc = candidates.find((c) => fs.existsSync(path.join(c, 'Release', 'better_sqlite3.node')));
  if (bsqlSrc) {
    copyDir(bsqlSrc, bsqlDst);
  } else {
    throw new Error('better_sqlite3.node not found (workspace install atau .pnpm store) — run pnpm install first');
  }
}

// 4) Launchers + docs
fs.writeFileSync(path.join(out, 'start-server.bat'), [
  '@echo off',
  'cd /d "%~dp0"',
  'title MasjidTV Server',
  'start "" /D"%~dp0" node server\\dist\\index.js',
  'echo MasjidTV server starting on http://localhost:3000',
  'echo Display : http://localhost:3000/display',
  'echo Admin   : http://localhost:3000/admin',
  'timeout /t 3 >nul',
  'start "" http://localhost:3000/admin',
].join('\r\n'));

fs.writeFileSync(path.join(out, 'start-kiosk.bat'), [
  '@echo off',
  'cd /d "%~dp0"',
  'title MasjidTV Kiosk',
  'REM Start server hidden, then open Edge in fullscreen kiosk on the display page.',
  'start "" /B node server\\dist\\index.js',
  'REM Wait for the server to accept connections.',
  'powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000/api/today -TimeoutSec 2 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; exit ([int](-not $ok))"',
  'if errorlevel 1 (',
  '  echo Server did not start - opening admin page for setup instead.',
  '  start "" http://localhost:3000/admin',
  '  exit /b 1',
  ')',
  'set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
  'if exist "%EDGE%" (',
  '  start "" "%EDGE%" --kiosk http://localhost:3000/display --edge-kiosk-type=fullscreen --no-first-run --no-default-browser-check',
  ') else (',
  '  start "" http://localhost:3000/display',
  ')',
  'REM Keep the console open so the server keeps running; closing this window stops it.',
  'echo Kiosk running. Close this window (or Ctrl+C) to stop.',
  ':loop',
  'timeout /t 3600 >nul',
  'goto loop',
].join('\r\n'));

fs.writeFileSync(path.join(out, 'install-autostart.bat'), [
  '@echo off',
  'reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v MasjidTV /t REG_SZ /d "\\"%~dp0start-kiosk.bat\\"" /f',
  'echo MasjidTV autostart installed for the current user.',
  'pause',
].join('\r\n'));

fs.writeFileSync(path.join(out, 'remove-autostart.bat'), [
  '@echo off',
  'reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v MasjidTV /f',
  'echo MasjidTV autostart removed.',
  'pause',
].join('\r\n'));

fs.writeFileSync(path.join(out, 'pair-cloud.bat'), [
  '@echo off',
  'cd /d "%~dp0"',
  'title MasjidTV - Pair with Cloud',
  'REM Start the local server if not running, then open the pairing page.',
  'powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 20;$i++){ try { Invoke-WebRequest -UseBasicParsing -Uri http://localhost:3000/api/health -TimeoutSec 2 | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 500 } }; exit ([int](-not $ok))"',
  'if errorlevel 1 (',
  '  start "" /B node server\\dist\\index.js',
  '  timeout /t 3 >nul',
  ')',
  'start "" http://localhost:3000/pair',
  'echo Pairing page opened in your browser.',
  'echo Enter your cloud admin URL, then claim the 6-char code in the',
  'echo cloud admin dashboard (TV & Displays) to link this mini PC.',
].join('\r\n'));

fs.writeFileSync(path.join(out, 'README.txt'), [
  'MasjidTV - portable Windows kiosk package',
  '=========================================',
  '',
  'Requirements: Node.js 20+ installed on this machine (https://nodejs.org).',
  '',
  'Quick start (standalone/local)',
  '------------------------------',
  '1. Double-click start-kiosk.bat',
  '   - starts the local server (port 3000)',
  '   - opens Microsoft Edge in fullscreen kiosk mode on the display page',
  '   - first run: open http://localhost:3000/admin to configure prayer times',
  '2. For day-to-day TV use: install-autostart.bat (starts kiosk at login).',
  '3. To stop: close the "MasjidTV Kiosk" console window.',
  '',
  'Pair with cloud (managed by web admin)',
  '---------------------------------------',
  '1. Double-click pair-cloud.bat (or open http://localhost:3000/pair).',
  '2. Enter your cloud admin URL (e.g. https://masjidtv.vercel.app).',
  '3. A 6-char code appears on this screen.',
  '4. In the cloud admin dashboard (TV & Displays), claim the code.',
  '5. This mini PC now syncs settings/slides from the cloud:',
  '   - /display and / redirect to the cloud display',
  '   - /admin redirects to the cloud admin dashboard',
  '   - offline: the display keeps running from the local cache',
  'To unlink: POST http://localhost:3000/api/pair/unpair (or delete',
  '%APPDATA%\\MasjidTV\\cloud.json).',
  '',
  'Files',
  '-----',
  'start-server.bat       server + opens admin dashboard (setup mode)',
  'start-kiosk.bat        server + Edge fullscreen kiosk on /display',
  'pair-cloud.bat         server + opens the cloud pairing page (/pair)',
  'install-autostart.bat  add HKCU Run entry so kiosk starts at login',
  'remove-autostart.bat   undo autostart',
  'server/                Fastify server (compiled)',
  'frontend/              display + admin web assets',
  'node_modules/          runtime dependencies',
  '',
  'Data (sqlite DB, uploads) is stored in %APPDATA%\\MasjidTV.',
  '',
  'True assigned-access kiosk (locks Windows to one app):',
  '  Settings > Accounts > Other users > Set up kiosk > choose Microsoft Edge,',
  '  then point the kiosk URL to http://localhost:3000/display',
  '',
  'Cloud mode instead of local: pair the Android TV app with',
  'https://masjidtv.vercel.app (see apps/android-tv).',
].join('\r\n'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Packaged: ${out}`);
