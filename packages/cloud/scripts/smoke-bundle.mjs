// Smoke-test the bundled cloud function locally. The bundle's externals
// (@libsql/client) resolve from the workspace node_modules by placing the
// function bundle in packages/cloud/dist (resolution walks up to the
// workspace root). On Vercel the runtime resolves them via includeFiles.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, '..', 'dist', 'api', 'index.cjs');

process.env.NODE_ENV = 'production';
process.env.JWT_SECRET ||= 'smoke-test-secret';
process.env.TURSO_URL ||= 'file:./cloud-data/smoke.db';

const require = createRequire(import.meta.url);
const handler = require(bundlePath).default;

const server = createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(8887, '127.0.0.1', resolve));

async function get(p, raw = false) {
  const r = await fetch(`http://127.0.0.1:8887${p}`, { redirect: 'manual' });
  const body = raw ? await r.text() : await r.json();
  return { status: r.status, body, type: r.headers.get('content-type'), csp: r.headers.get('content-security-policy'), location: r.headers.get('location') };
}

let failed = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}

const health = await get('/api/health');
check('health 200', health.status === 200, JSON.stringify(health.body).slice(0, 60));

const zones = await get('/api/zones');
check('zones 200', zones.status === 200, Object.keys(zones.body.zones || {}).length + ' negeri');

const settings = await get('/api/settings');
check('settings no-key 401', settings.status === 401);

const root = await get('/', true);
check('root redirects to /admin', (root.status === 302 || root.status === 301) && String(root.location).startsWith('/display') === false && (root.location === '/admin' || String(root.location).startsWith('/display')), `status=${root.status} loc=${root.location}`);

const admin = await get('/admin', true);
check('admin page 200 html', admin.status === 200 && String(admin.type).includes('text/html') && String(admin.body).includes('<!doctype html>'));
check('admin CSP', String(admin.csp || '').includes("script-src 'self'"));

const display = await get('/display?key=abc', true);
check('display page 200 html', display.status === 200 && String(display.body).includes('MasjidTV') || String(display.body).includes('display'));
check('display CSP allows frames', String(display.csp || '').includes('frame-src http: https:'));

const sw = await get('/sw.js', true);
check('sw.js 200 js', sw.status === 200 && String(sw.type).includes('javascript'), `status=${sw.status} type=${sw.type}`);

const css = await get('/css/display.css', true);
check('css asset 200', css.status === 200 && String(css.type).includes('text/css'), String(css.body).length + ' bytes');

const js = await get('/js/admin.js', true);
check('js asset 200', js.status === 200 && String(js.type).includes('javascript'));

const icon = await get('/icons/icon-192.png', true);
check('binary asset 200', icon.status === 200, String(icon.type));

const vendor = await get('/vendor/hls.min.js', true);
check('vendor asset 200', vendor.status === 200);

const manifest = await get('/manifest.webmanifest', true);
check('manifest 200', manifest.status === 200, String(manifest.type));

const missing = await get('/nonexistent');
check('404 still json', missing.status === 404 && missing.body.error === 'Tidak dijumpai');

server.close();
process.exit(failed ? 1 : 0);
