// Announcement CRUD — backed by the Store; sanitization/active-window/ordering
// live in @masjidtv/shared (single source for local server and cloud).

import {
  sanitizeAnnouncementCreate,
  applyAnnouncementPatch,
  sortAnnouncements,
  isAnnouncementActive,
  type Announcement
} from '@masjidtv/shared';
import type { Store } from './store.js';

export { isAnnouncementActive as isActive };

export class AnnouncementService {
  constructor(private store: Store) {}

  listAll(): Announcement[] {
    return sortAnnouncements(this.store.listAnnouncements());
  }

  listActive(now: Date, timezone: string): Announcement[] {
    return sortAnnouncements(this.store.listAnnouncements().filter((a) => isAnnouncementActive(a, now, timezone)));
  }

  create(input: Record<string, unknown>): Announcement {
    const items = this.store.listAnnouncements();
    const item = sanitizeAnnouncementCreate(input);
    item.sortOrder = items.reduce((m, i) => Math.max(m, Number(i.sortOrder) || 0), 0) + 1;
    this.store.saveAnnouncement(item);
    return { ...item };
  }

  update(id: string, input: Record<string, unknown>): Announcement | null {
    const items = this.store.listAnnouncements();
    const idx = items.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const item = applyAnnouncementPatch({ ...items[idx] }, input);
    this.store.saveAnnouncement(item);
    return { ...item };
  }

  remove(id: string): boolean {
    return this.store.deleteAnnouncement(id);
  }

  reorder(ids: string[]): boolean {
    const items = this.store.listAnnouncements();
    const byId = new Map(items.map((a) => [a.id, a]));
    if (!Array.isArray(ids) || ids.length !== items.length || ids.some((id) => !byId.has(id))) return false;
    const changed = ids.map((id, i) => {
      const item = byId.get(id)!;
      return { ...item, sortOrder: i };
    });
    // Satu transaksi untuk semua susunan semula (bukan N autocommit fsync).
    this.store.saveAnnouncements(changed);
    return true;
  }
}
