import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMemoryClient, applySchema } from '../src/client.js';
import { settings, announcements } from '../src/schema.js';
import { eq } from 'drizzle-orm';

describe('db client (better-sqlite3)', () => {
  let client: Awaited<ReturnType<typeof createMemoryClient>>;

  beforeAll(async () => {
    client = await createMemoryClient();
  });

  afterAll(() => client.close());

  it('applies local schema', () => {
    applySchema(client);
    const row = client.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = (row as { name: string }[]).map((r) => r.name);
    expect(names).toContain('settings');
    expect(names).toContain('announcements');
    expect(names).toContain('login_attempts');
    // Local client must NOT create cloud-only tables.
    expect(names).not.toContain('tenants');
    expect(names).not.toContain('tv_devices');
  });

  it('persists settings via drizzle', () => {
    client.db.insert(settings).values({ id: 1, data: JSON.stringify({ name: 'test' }), updatedAt: Date.now() }).run();
    const rows = client.db.select().from(settings).where(eq(settings.id, 1)).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toEqual({ name: 'test' });
  });

  it('persists announcements via drizzle', () => {
    client.db.insert(announcements).values({ id: 'a1', data: JSON.stringify({ title: 'Hello' }), createdAt: Date.now() }).run();
    const rows = client.db.select().from(announcements).all();
    expect(rows).toHaveLength(1);
  });
});
