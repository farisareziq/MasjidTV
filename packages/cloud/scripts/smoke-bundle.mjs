// Smoke-test the bundled cloud function locally: spin it up as an HTTP
// listener via the Fastify app and hit /api/health + zones.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(__dirname, '..', 'dist', 'api', 'index.js');

process.env.NODE_ENV = 'production'; // exercise the fail-fast checks (TURSO_URL is set)

const { default: handler } = await import(pathToFileURL(bundlePath).href);

const server = createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(8899, '127.0.0.1', resolve));

async function get(p) {
  const r = await fetch(`http://127.0.0.1:8899${p}`);
  const body = await r.json();
  return { status: r.status, body };
}

const health = await get('/api/health');
console.log('health:', health.status, JSON.stringify(health.body).slice(0, 80));

const zones = await get('/api/zones');
console.log('zones:', zones.status, Object.keys(zones.body.zones || {}).length, 'negeri');

const settings = await get('/api/settings');
console.log('settings (no key):', settings.status, '(expect 401)');

server.close();
process.exit(health.status === 200 && zones.status === 200 && settings.status === 401 ? 0 : 1);
