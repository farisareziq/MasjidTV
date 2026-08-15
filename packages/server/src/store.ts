// Settings + announcement persistence backed by SQLite (via @masjidtv/db).
// Replaces the reference's JSON-file store with atomic DB writes.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createLocalClient, applySchema, settings, announcements, eq, type LocalClient } from '@masjidtv/db';
import { DEFAULT_SETTINGS, applyPatch, type Settings, type Announcement } from '@masjidtv/shared';
import fs from 'node:fs';
import path from 'node:path';

const SETTINGS_ID = 1;

export interface StoreOptions {
  dataDir: string;
}

export class Store {
  readonly dataDir: string;
  readonly client: LocalClient;
  private settingsDoc: Settings;

  private constructor(dataDir: string, client: LocalClient) {
    this.dataDir = dataDir;
    this.client = client;
    this.settingsDoc = this.loadSettings();
  }

  // Async factory: createLocalClient lazily imports better-sqlite3.
  static async open(opts: StoreOptions): Promise<Store> {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    const client = await createLocalClient(path.join(opts.dataDir, 'masjidtv.db'));
    applySchema(client);
    return new Store(opts.dataDir, client);
  }

  // --- settings -------------------------------------------------------------

  private loadSettings(): Settings {
    const rows = this.client.db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).all();
    if (rows.length > 0) {
      try {
        const existing = JSON.parse(rows[0].data);
        return this.migrate(existing);
      } catch {
        // fall through to defaults
      }
    }
    const s = this.createInitialSettings();
    this.saveSettings(s);
    return s;
  }

  private migrate(existing: Partial<Settings>): Settings {
    // Deep-merge existing over defaults, preserving auth/security/createdAt and
    // any other fields not present in DEFAULT_SETTINGS.
    const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
    const merged = this.mergeDefaults(defaults, existing);
    if ((merged.prayer.source as string) === 'auto' || (merged.prayer.source as string) === 'api') {
      merged.prayer.source = 'jakim';
    }
    if (!merged.prayer.zone) merged.prayer.zone = 'WLY01';
    return merged;
  }

  // Port of reference mergeDefaults: fill missing keys from defaults while
  // preserving existing (including auth/security/createdAt).
  private mergeDefaults(target: Settings, source: Partial<Settings>): Settings {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;
      const t = target as unknown as Record<string, unknown>;
      if (typeof value === 'object' && !Array.isArray(value)) {
        t[key] = t[key] && typeof t[key] === 'object' && !Array.isArray(t[key])
          ? { ...(t[key] as Record<string, unknown>), ...(value as Record<string, unknown>) }
          : JSON.parse(JSON.stringify(value));
      } else {
        t[key] = Array.isArray(value) ? JSON.parse(JSON.stringify(value)) : value;
      }
    }
    return target;
  }

  private createInitialSettings(): Settings {
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
    s.createdAt = new Date().toISOString();
    const password = `tvm-${crypto.randomBytes(4).toString('base64url')}`;
    s.auth = { passwordSalt: '', passwordHash: bcrypt.hashSync(password, 10) };
    s.security = s.security || { displayKey: '' };
    if (!s.security.displayKey) {
      s.security.displayKey = crypto.randomBytes(24).toString('hex');
    }
    try {
      fs.writeFileSync(
        path.join(this.dataDir, 'ADMIN_PASSWORD.txt'),
        `MasjidTV admin password\n=======================\n\n${password}\n\n`
          + `Keep this file private. You can delete it after changing the password\n`
          + `in the admin dashboard (Settings -> Change password).\n`,
        'utf8'
      );
    } catch {
      /* non-fatal */
    }
    return s;
  }

  private saveSettings(s: Settings): void {
    this.client.db
      .insert(settings)
      .values({ id: SETTINGS_ID, data: JSON.stringify(s), updatedAt: Date.now() })
      .onConflictDoUpdate({ target: settings.id, set: { data: JSON.stringify(s), updatedAt: Date.now() } })
      .run();
  }

  getSettings(): Settings {
    return this.settingsDoc;
  }

  updateSettings(patch: Record<string, unknown>): Settings {
    this.settingsDoc = applyPatch(this.settingsDoc, patch);
    if (!this.settingsDoc.security?.displayKey) {
      this.settingsDoc.security = this.settingsDoc.security || { displayKey: '' };
      this.settingsDoc.security.displayKey = crypto.randomBytes(24).toString('hex');
    }
    this.saveSettings(this.settingsDoc);
    return this.settingsDoc;
  }

  verifyPassword(password: string): boolean {
    const { passwordHash, passwordSalt } = this.settingsDoc.auth || {};
    if (!passwordHash) return false;
    const pw = String(password);
    if (passwordHash.startsWith('$2')) {
      return bcrypt.compareSync(pw, passwordHash);
    }
    if (!passwordSalt) return false;
    const hash = crypto.createHash('sha256').update(`${passwordSalt}::${pw}`).digest('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(passwordHash, 'hex');
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (ok) {
      this.settingsDoc.auth = { passwordSalt: '', passwordHash: bcrypt.hashSync(pw, 10) };
      this.saveSettings(this.settingsDoc);
    }
    return ok;
  }

  changePassword(newPassword: string): boolean {
    const pw = String(newPassword || '');
    if (pw.length < 6) return false;
    this.settingsDoc.auth = { passwordSalt: '', passwordHash: bcrypt.hashSync(pw, 10) };
    this.saveSettings(this.settingsDoc);
    return true;
  }

  // --- announcements ----------------------------------------------------------

  listAnnouncements(): Announcement[] {
    const rows = this.client.db.select().from(announcements).orderBy(announcements.createdAt).all();
    return rows.map((r) => JSON.parse(r.data) as Announcement);
  }

  saveAnnouncement(item: Announcement): void {
    this.saveAnnouncements([item]);
  }

  // Batch upsert dalam SATU transaksi better-sqlite3 (bukan N autocommit).
  saveAnnouncements(items: Announcement[]): void {
    this.client.raw.transaction(() => {
      for (const item of items) {
        this.client.db
          .insert(announcements)
          .values({ id: item.id, data: JSON.stringify(item), createdAt: Date.now() })
          .onConflictDoUpdate({ target: announcements.id, set: { data: JSON.stringify(item) } })
          .run();
      }
    })();
  }

  deleteAnnouncement(id: string): boolean {
    const result = this.client.db.delete(announcements).where(eq(announcements.id, id)).run();
    return result.changes > 0;
  }

  close(): void {
    this.client.close();
  }
}
