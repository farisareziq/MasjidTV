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

const require = createRequire(import.meta.url);
const handler = require(bundlePath).default;

const server = createServer((req, res) => handler(req, res));
await new Promise((resolve) => server.listen(8887, '127.0.0.1', resolve));

async function get(p) {
  const r = await fetch(`http://127.0.0.1:8887${p}`);
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
