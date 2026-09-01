// Settings + announcement persistence backed by SQLite (via @masjidtv/db).
// Replaces the reference's JSON-file store with atomic DB writes.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createLocalClient, applySchema, settings, announcements, eq, type LocalClient } from '@masjidtv/db';
import { DEFAULT_SETTINGS, applyPatch, jakimRowToEntry, jakimEntryToRow, type Settings, type Announcement, type JakimEntry } from '@masjidtv/shared';
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
      } catch (err) {
        // JANGAN reset secara senyap — itu memadam semua tetapan + kata laluan.
        // Sandarkan data rosak untuk pemulihan, kekalkan fail kata laluan.
        console.error('[store] tetapan rosak (JSON tidak sah) — mengekalkan nilai lalai');
        console.error('[store] punca:', err instanceof Error ? err.message : err);
        try {
          fs.writeFileSync(
            path.join(this.dataDir, `settings-corrupt-${Date.now()}.json`),
            String(rows[0].data),
            'utf8'
          );
        } catch {
          /* sandaran gagal — teruskan dengan lalai */
        }
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
    // Baris rosak (JSON tidak sah) tidak boleh merosakkan seluruh API —
    // langkau dengan log supaya boleh dibaiki/dipadam manual.
    const out: Announcement[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.data) as Announcement);
      } catch (err) {
        console.error(`[store] pengumuman rosak dilangkau (id=${r.id}):`, err instanceof Error ? err.message : err);
      }
    }
    return out;
  }

  saveAnnouncement(item: Announcement): void {
    this.saveAnnouncements([item]);
  }

  // Batch upsert dalam SATU transaksi (bukan N autocommit). Kedua-dua driver
  // mematuhi kontrak better-sqlite3: transaction(fn) pulangkan fungsi.
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

  // --- cache jakim_times (waktu solat luar talia) ----------------------------

  private static readonly UPSERT_JAKIM_SQL = `INSERT INTO jakim_times
    (zone, date_key, hijri, imsak, fajr, syuruk, dhuha, dhuhr, asr, maghrib, isha, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (zone, date_key) DO UPDATE SET
      hijri=excluded.hijri, imsak=excluded.imsak, fajr=excluded.fajr, syuruk=excluded.syuruk,
      dhuha=excluded.dhuha, dhuhr=excluded.dhuhr, asr=excluded.asr, maghrib=excluded.maghrib,
      isha=excluded.isha, synced_at=excluded.synced_at`;

  getJakimEntry(zone: string, dateKey: string): JakimEntry | null {
    const row = this.client.raw
      .prepare('SELECT * FROM jakim_times WHERE zone = ? AND date_key = ?')
      .get(zone, dateKey) as ReturnType<typeof jakimEntryToRow> | undefined;
    return row ? jakimRowToEntry(row) : null;
  }

  putJakimEntries(zone: string, entries: JakimEntry[]): void {
    if (!entries.length) return;
    const stmt = this.client.raw.prepare(Store.UPSERT_JAKIM_SQL);
    this.client.raw.transaction(() => {
      const now = Date.now();
      for (const e of entries) {
        const r = jakimEntryToRow(zone, e);
        stmt.run(r.zone, r.date_key, r.hijri, r.imsak, r.fajr, r.syuruk, r.dhuha, r.dhuhr, r.asr, r.maghrib, r.isha, now);
      }
    })();
  }

  getJakimRange(zone: string, from: string, to: string): JakimEntry[] {
    const rows = this.client.raw
      .prepare('SELECT * FROM jakim_times WHERE zone = ? AND date_key >= ? AND date_key <= ? ORDER BY date_key')
      .all(zone, from, to) as ReturnType<typeof jakimEntryToRow>[];
    return rows.map(jakimRowToEntry).filter((e): e is JakimEntry => e !== null);
  }

  getJakimMaxDate(zone: string): string | null {
    const row = this.client.raw
      .prepare('SELECT MAX(date_key) AS mx FROM jakim_times WHERE zone = ?')
      .get(zone) as { mx: string | null } | undefined;
    return row?.mx ?? null;
  }

  /** Ringkasan liputan cache per zon (untuk panel admin). */
  getJakimCoverage(): { zone: string; count: number; maxDate: string | null }[] {
    const rows = this.client.raw
      .prepare('SELECT zone, COUNT(*) AS n, MAX(date_key) AS mx FROM jakim_times GROUP BY zone ORDER BY zone')
      .all() as { zone: string; n: number; mx: string | null }[];
    return rows.map((r) => ({ zone: r.zone, count: Number(r.n), maxDate: r.mx ?? null }));
  }

  close(): void {
    this.client.close();
  }
}
