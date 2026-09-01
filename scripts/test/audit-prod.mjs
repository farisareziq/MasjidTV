// Audit produksi pasca-deploy — sapuan menyeluruh permukaan awam.
// Guna: node scripts/test/audit-prod.mjs [url]
const base = (process.argv[2] || process.env.PREFLIGHT_URL || 'https://masjidtv.vercel.app').replace(/\/+$/, '');
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (cond) pass++;
  else fail++;
};

// 1. Health & identity (versi dibaca daripada package.json — jangan hardcode)
import fs from 'node:fs';
const pkgVersion = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
let r = await fetch(base + '/api/health');
let h = await r.json();
check(`health 200 + ok:true + version ${pkgVersion}`, r.status === 200 && h.ok === true && h.version === pkgVersion, JSON.stringify(h));

// 2. Public endpoints
r = await fetch(base + '/api/methods');
const methods = await r.json();
check('methods 200 + 13 kaedah', r.status === 200 && Object.keys(methods).length === 13);
r = await fetch(base + '/api/zones');
const zones = await r.json();
check('zones 200 + negeri berkelompok', r.status === 200 && Object.keys(zones.zones).length >= 14);
const cacheH = r.headers.get('cache-control') || '';
check('zones cache header CDN', cacheH.includes('86400'), cacheH);

// 3. Auth gates
for (const p of ['/api/settings', '/api/today', '/api/slides', '/api/sync', '/api/admin/jakim-times', '/api/admin/status']) {
  r = await fetch(base + p);
  check('auth gate ' + p, r.status === 401 || r.status === 403, 'got ' + r.status);
}
r = await fetch(base + '/api/admin/jakim-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('auth gate POST jakim-sync', r.status === 401, 'got ' + r.status);

// 4. Ralat framework
r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
check('urlencoded POST -> 415 (bukan 500)', r.status === 415, 'got ' + r.status);
r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
check('JSON rosak -> 400 (bukan 500)', r.status === 400, 'got ' + r.status);
r = await fetch(base + '/api/nonexistent');
check('404 JSON', r.status === 404);

// 5. SSE dimatikan di edge
r = await fetch(base + '/api/events');
check('SSE edge 204 (kos serverless)', r.status === 204, 'got ' + r.status);

// 6. Halaman + aset statik
for (const p of ['/', '/admin', '/display?key=abc', '/sw.js', '/css/admin.css', '/js/admin.js', '/vendor/hls.min.js', '/manifest.webmanifest']) {
  r = await fetch(base + p);
  check('aset ' + p, r.status === 200, 'got ' + r.status);
}

// 7. Header keselamatan
r = await fetch(base + '/display?key=abc');
const csp = r.headers.get('content-security-policy') || '';
check('CSP pada /display', csp.includes("script-src 'self'"), csp.slice(0, 60));
check('nosniff', (r.headers.get('x-content-type-options') || '') === 'nosniff');
check('frame-ancestors none', csp.includes('frame-ancestors'), csp.slice(0, 60));

// 8. Latensi
const t0 = Date.now();
await fetch(base + '/api/health');
check('health latensi <300ms', Date.now() - t0 < 300, (Date.now() - t0) + 'ms');

console.log('');
console.log('=== AUDIT PRODUKSI: ' + pass + ' lulus, ' + fail + ' gagal ===');
process.exit(fail ? 1 : 0);
