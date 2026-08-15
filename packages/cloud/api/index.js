// Vercel function entry (committed shim). Vercel's builder needs a real
// api/index.js at the package root; it lazily imports the compiled handler
// from ../dist (built by the `vercel-build` script before deploy).
let handlerPromise = null;

export default async function handler(req, res) {
  try {
    handlerPromise ??= import('../dist/api/index.cjs').then((m) => m.default);
    const handler = await handlerPromise;
    return await handler(req, res);
  } catch (err) {
    console.error('[vercel] handler load failed:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Handler unavailable — build the app first (pnpm --filter @masjidtv/cloud build)' }));
  }
}
