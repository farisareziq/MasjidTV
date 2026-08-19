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
  // Display entries import display-core.ts at runtime (value import) — they
  // must be BUNDLED so esbuild inlines the shared module (an emitted bare
  // import would 404 in the browser, which loads these as classic scripts).
  // Admin entries stay self-contained/unbundled → output byte-identical.
  ['src/display.ts', 'public/js/display.js', true],
  ['src/admin.ts', 'public/js/admin.js', false],
  ['src/display-cloud.ts', 'public-cloud/js/display.js', true],
  ['src/admin-cloud.ts', 'public-cloud/js/admin.js', false]
];

for (const [entry, outfile, bundle] of targets) {
  await build({
    entryPoints: [path.join(__dirname, entry)],
    outfile: path.join(__dirname, outfile),
    target: 'es2022',
    bundle: !!bundle,
    sourcemap: false,
    logLevel: 'info'
  });
}
