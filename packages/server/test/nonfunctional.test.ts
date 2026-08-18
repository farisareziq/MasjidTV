// NON-FUNCTIONAL TESTING — objective: performance, robustness and security
// characteristics of the local server (latency budgets, malformed input
// tolerance, auth brute-force throttling, header hardening).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'node:perf_hooks';
import { startTestServer, stubJakimFetch, type TestServer } from './helpers.js';

describe('Non-Functional Testing / performance', () => {
  let srv: TestServer;
  let restoreFetch: () => void;

  beforeAll(async () => {
    restoreFetch = stubJakimFetch(); // deterministic, offline /api/today
    srv = await startTestServer();
  }, 120000);

  afterAll(async () => {
    restoreFetch();
    await srv.cleanup();
  });

  it('answers /api/health in under 50ms (p95 of 50 calls)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await srv.app.inject({ method: 'GET', url: '/api/health' });
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    // Budget is generous on purpose: wall-clock sampling includes GC pauses
    // and antivirus scans on shared Windows runners.
    expect(p95).toBeLessThan(50);
  });

  it('serves static display content in under 250ms', async () => {
    const t0 = performance.now();
    const res = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(res.statusCode).toBe(200);
    expect(performance.now() - t0).toBeLessThan(250);
  });

  it('keeps 20 concurrent /api/today requests under a 15s wall budget', async () => {
    const t0 = performance.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        srv.app.inject({ method: 'GET', url: '/api/today', headers: { 'x-display-key': srv.displayKey } })
      )
    );
    expect(performance.now() - t0).toBeLessThan(15000);
    for (const r of results) expect(r.statusCode).toBe(200);
  });
});

describe('Non-Functional Testing / robustness (malformed input)', () => {
  let srv: TestServer & { token?: string };

  beforeAll(async () => {
    srv = await startTestServer({ login: true });
  }, 120000);

  afterAll(async () => {
    await srv.cleanup();
  });

  it.each([
    ['null body', null],
    ['wrong shape', { unexpected: true }],
    ['deeply nested', { mosque: { name: { deep: { deeper: true } } } }],
    ['giant string name', { mosque: { name: 'A'.repeat(100000) } }]
  ])('PUT /api/admin/settings tolerates %s', async (_label, payload) => {
    const res = await srv.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${srv.token}` },
      payload
    });
    expect([200, 400]).toContain(res.statusCode);
    // Server must stay alive afterwards.
    const health = await srv.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
  });

  it('returns 404 (not a crash) for unknown API routes', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/api/no-such-endpoint' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Non-Functional Testing / security', () => {
  let srv: TestServer;

  beforeAll(async () => {
    srv = await startTestServer();
  }, 120000);

  afterAll(async () => {
    await srv.cleanup();
  });

  it('rate-limits brute-force login (5 failures -> 429 lockout)', async () => {
    for (let i = 0; i < 5; i++) {
      await srv.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: `brute-${i}` } });
    }
    const res = await srv.app.inject({ method: 'POST', url: '/api/admin/login', payload: { password: 'brute-x' } });
    expect(res.statusCode).toBe(429);
  });

  it('blocks path traversal on static uploads', async () => {
    const res = await srv.app.inject({ method: 'GET', url: '/uploads/../masjidtv.db' });
    expect([400, 404]).toContain(res.statusCode);
  });

  it('sets a Content-Security-Policy on served pages', async () => {
    const display = await srv.app.inject({ method: 'GET', url: '/display' });
    expect(display.headers['content-security-policy']).toBeDefined();
    const admin = await srv.app.inject({ method: 'GET', url: '/admin' });
    expect(admin.headers['content-security-policy']).toBeDefined();
  });

  it('never serves the admin dashboard or password file without auth', async () => {
    const settings = await srv.app.inject({ method: 'GET', url: '/api/admin/settings' });
    expect(settings.statusCode).toBe(401);
    const traversal = await srv.app.inject({ method: 'GET', url: '/uploads/../../ADMIN_PASSWORD.txt' });
    expect([400, 404]).toContain(traversal.statusCode);
  });
});
