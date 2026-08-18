// INTEGRATION TESTING — objective: the @masjidtv/db layer working with the
// SQLite driver: schema application, local-vs-cloud schema separation, and
// drizzle persistence round-trips.

import { describe, it, expect } from 'vitest';
import { createMemoryClient, applySchema } from '../src/client.js';
import { settings, announcements } from '../src/schema.js';
import { eq } from 'drizzle-orm';

describe('Integration Testing / db client (better-sqlite3)', () => {
  it('applies the local schema and keeps cloud tables OUT of it', async () => {
    const client = await createMemoryClient();
    try {
      applySchema(client);
      const row = client.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const names = (row as { name: string }[]).map((r) => r.name);
      expect(names).toContain('settings');
      expect(names).toContain('announcements');
      expect(names).toContain('login_attempts');
      // INVARIANT: the local client must never create cloud-only tables —
      // a schema drift here would leak tenant data into single-mosque installs.
      expect(names).not.toContain('tenants');
      expect(names).not.toContain('tv_devices');
    } finally {
      client.close();
    }
  });

  it('persists settings via drizzle and survives reconnect', async () => {
    const client = await createMemoryClient();
    applySchema(client);
    await client.db.insert(settings).values({ id: 1, data: JSON.stringify({ name: 'test' }), updatedAt: Date.now() }).run();
    const rows = await client.db.select().from(settings).where(eq(settings.id, 1)).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toEqual({ name: 'test' });
    client.close();
  });

  it('persists announcements via drizzle with upsert semantics', async () => {
    const client = await createMemoryClient();
    applySchema(client);
    const base = { id: 'a1', data: JSON.stringify({ title: 'Hello' }), createdAt: Date.now() };
    await client.db.insert(announcements).values(base).run();
    await client.db.insert(announcements)
      .values({ ...base, data: JSON.stringify({ title: 'Updated' }) })
      .onConflictDoUpdate({ target: announcements.id, set: { data: JSON.stringify({ title: 'Updated' }) } })
      .run();
    const rows = await client.db.select().from(announcements).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].data)).toEqual({ title: 'Updated' });
    client.close();
  });
});
