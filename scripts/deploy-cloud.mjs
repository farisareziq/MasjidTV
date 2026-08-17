// Deploy the MasjidTV cloud app to Vercel (from repo root).
// Usage: node scripts/deploy-cloud.mjs
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cloudDir = path.join(repoRoot, 'packages', 'cloud');

// Vercel deploys from the package dir with the compiled api entry.
if (!fs.existsSync(path.join(cloudDir, 'dist'))) {
  console.error('[deploy] Build first: pnpm --filter @masjidtv/cloud build');
  process.exit(1);
}

// Project linked with rootDirectory=packages/cloud → deploy from repo root
// (running inside packages/cloud makes Vercel double the path).
console.log('[deploy] Deploying packages/cloud to Vercel...');
execSync('vercel deploy --prod --yes', { cwd: repoRoot, stdio: 'inherit' });

// Post-deploy: fail loudly if production is misconfigured (missing env,
// broken health endpoint) instead of shipping a silently broken release.
const url = process.env.MASJIDTV_PUBLIC_URL || process.env.PREFLIGHT_URL;
if (url) {
  console.log(`[deploy] Running preflight against ${url}...`);
  try {
    execSync(`node "${path.join(__dirname, 'preflight.mjs')}" --url "${url.replace(/\/+$/, '')}"`, { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error('[deploy] PREFLIGHT FAILED after deploy — production may be misconfigured. Fix and redeploy.');
    process.exit(1);
  }
} else {
  console.log('[deploy] Skipped post-deploy preflight (set MASJIDTV_PUBLIC_URL or PREFLIGHT_URL to enable).');
}
