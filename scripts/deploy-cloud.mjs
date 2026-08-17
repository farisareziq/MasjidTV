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
