// Compile TS sources (verbatim JS bodies + type-only annotations) back to the
// same public*/js paths the HTML pages load. Type-only imports are erased by
// esbuild, so runtime behavior is identical to the original baseline JS.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Paths must resolve from THIS script's location — the cloud build invokes it
// with a different cwd (repo root on Vercel), which broke relative entries.
const targets = [
  ['src/display.ts', 'public/js/display.js'],
  ['src/admin.ts', 'public/js/admin.js'],
  ['src/display-cloud.ts', 'public-cloud/js/display.js'],
  ['src/admin-cloud.ts', 'public-cloud/js/admin.js']
];

for (const [entry, outfile] of targets) {
  await build({
    entryPoints: [path.join(__dirname, entry)],
    outfile: path.join(__dirname, outfile),
    target: 'es2022',
    sourcemap: false,
    logLevel: 'info'
  });
}
