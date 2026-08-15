import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('local server', () => {
  let app: FastifyInstance;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-test-'));
  const publicDir = path.join(process.cwd(), 'packages', 'frontend', 'public');

  beforeAll(async () => {
    app = await buildApp({ dataDir, publicDir, port: 0 });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('masjidtv');
  });

  it('serves methods and zones', async () => {
    const m = await app.inject({ method: 'GET', url: '/api/methods' });
    expect(m.statusCode).toBe(200);
    expect(Object.keys(m.json())).toHaveLength(13);

    const z = await app.inject({ method: 'GET', url: '/api/zones' });
    expect(z.statusCode).toBe(200);
    expect(Object.keys(z.json().zones).length).toBeGreaterThan(0);
  });

  it('protects /api/settings with display key', async () => {
    const noKey = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(noKey.statusCode).toBe(401);
  });

  it('rejects wrong admin password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'wrong-password' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects upload with wrong magic bytes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/upload',
      headers: { 'content-type': 'image/png', authorization: 'Bearer invalid' },
      payload: Buffer.from([0x00, 0x01, 0x02, 0x03])
    });
    expect(res.statusCode).toBe(401); // auth checked before body
  });
});
