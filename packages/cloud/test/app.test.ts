import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCloudApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

describe('cloud app', () => {
  let app: FastifyInstance;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'masjidtv-cloud-'));

  beforeAll(async () => {
    process.env.TURSO_URL = `file:${path.join(tmpDir, 'cloud.db')}`;
    process.env.JWT_SECRET = 'test-secret';
    app = await createCloudApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Windows may briefly hold the SQLite file handle; retry cleanup.
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  });

  it('serves health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('masjidtv-cloud');
  });

  it('serves zones and methods without auth', async () => {
    const z = await app.inject({ method: 'GET', url: '/api/zones' });
    expect(z.statusCode).toBe(200);
    const m = await app.inject({ method: 'GET', url: '/api/methods' });
    expect(m.statusCode).toBe(200);
  });

  it('rejects settings without tenant key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('seeds superuser with a RANDOM bootstrap PIN (not a public default)', async () => {
    // The bootstrap PIN is random and printed to stdout/otp file; the fixed
    // public default 00000000 must NOT work (takeover-race fix).
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/superuser/login',
      payload: { username: 'admin', pin: '00000000' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects unknown superuser credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/superuser/login',
      payload: { username: 'admin', pin: 'wrong-pin' }
    });
    expect(res.statusCode).toBe(401);
  });
});
