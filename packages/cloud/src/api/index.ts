// Titik masuk serverless Vercel — Fastify sebagai satu fungsi (init malas).
// Mirrors reference api/index.js, adapted to Fastify.
import type { FastifyInstance } from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createCloudApp } from '../app.js';

let appPromise: Promise<FastifyInstance> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    appPromise ??= createCloudApp();
    const app = await appPromise;
    await app.ready();
    app.server.emit('request', req, res);
  } catch (err) {
    console.error('[vercel] inisialisasi gagal:', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Inisialisasi gagal' }));
  }
}
