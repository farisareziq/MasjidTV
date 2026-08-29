// Shared announcement logic — sanitization, active-window, ordering.
// Single source of truth for local server and cloud (previously 3 copies).

import crypto from 'node:crypto';
import { zonedDateTime } from './prayers.js';
import type { Announcement, AnnouncementCategory } from './types.js';

export const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = [
  'general', 'event', 'announcement', 'welcome', 'tabung', 'quran', 'doa'
];

export function sanitizeCategory(v: unknown): AnnouncementCategory {
  return ANNOUNCEMENT_CATEGORIES.includes(v as AnnouncementCategory)
    ? (v as AnnouncementCategory)
    : 'general';
}

export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort(
    (a, b) =>
      (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      (b.priority || 0) - (a.priority || 0) ||
      a.title.localeCompare(b.title)
  );
}

// Active window: start at 00:00 local, end at 23:59:59 local (inclusive).
// Kalis ranap: tarikh rosak (data lama sebelum sanitasi) dianggap "tiada
// tetingkap" — jangan biarkan satu baris rosak meruntuhkan /api/slides.
export function isAnnouncementActive(item: Announcement, now: Date, timezone: string): boolean {
  if (!item.active) return false;
  if (item.start) {
    const start = zonedDateTime(item.start, '00:00', timezone).getTime();
    if (Number.isNaN(start)) return false; // tarikh tidak sah — tidak aktif
    if (start > now.getTime()) return false;
  }
  if (item.end) {
    const end = zonedDateTime(item.end, '23:59:59', timezone).getTime();
    if (Number.isNaN(end)) return false;
    if (end < now.getTime()) return false;
  }
  return true;
}

function dateOrNull(v: unknown): string | null {
  // Hantar format YYYY-MM-DD sahaja DAN tarikh kalendar sebenar — elak
  // rentetan sewenang-wenangnya (disimpan-XSS) & tarikh tidak sah (cth
  // 2026-13-99) yang merosakkan pengiraan tetingkap aktif.
  if (typeof v !== 'string' || !v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return v;
}

export function sanitizeAnnouncementCreate(input: Record<string, unknown>): Announcement {
  const nowIso = new Date().toISOString();
  const sortOrder = 1; // caller assigns the real max+1
  return {
    id: crypto.randomUUID(),
    title: String(input.title || '').trim().slice(0, 200) || 'Announcement',
    message: String(input.message || '').trim().slice(0, 2000),
    category: sanitizeCategory(input.category),
    image: typeof input.image === 'string' ? input.image.slice(0, 300) : null,
    video: typeof input.video === 'string' ? input.video.slice(0, 300) : null,
    quranDaily: input.quranDaily !== false,
    doaDaily: input.doaDaily !== false,
    arabic: String(input.arabic || '').trim().slice(0, 2000),
    translationMs: String(input.translationMs || '').trim().slice(0, 2000),
    translationEn: String(input.translationEn || '').trim().slice(0, 2000),
    ref: String(input.ref || '').trim().slice(0, 200),
    sortOrder,
    start: dateOrNull(input.start),
    end: dateOrNull(input.end),
    active: input.active !== false,
    priority: Math.max(0, Math.min(10, Number(input.priority) || 0)),
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

export function applyAnnouncementPatch(item: Announcement, input: Record<string, unknown>): Announcement {
  if (typeof input.title === 'string') item.title = input.title.trim().slice(0, 200) || item.title;
  if (typeof input.message === 'string') item.message = input.message.trim().slice(0, 2000);
  if (input.category !== undefined) {
    const cat = sanitizeCategory(input.category);
    item.category = cat;
  }
  if (typeof input.image === 'string') item.image = input.image.slice(0, 300) || null;
  if (typeof input.video === 'string') item.video = input.video.slice(0, 300) || null;
  if (typeof input.quranDaily === 'boolean') item.quranDaily = input.quranDaily;
  if (typeof input.doaDaily === 'boolean') item.doaDaily = input.doaDaily;
  if (typeof input.arabic === 'string') item.arabic = input.arabic.trim().slice(0, 2000);
  if (typeof input.translationMs === 'string') item.translationMs = input.translationMs.trim().slice(0, 2000);
  if (typeof input.translationEn === 'string') item.translationEn = input.translationEn.trim().slice(0, 2000);
  if (typeof input.ref === 'string') item.ref = input.ref.trim().slice(0, 200);
  if (input.start !== undefined) item.start = dateOrNull(input.start);
  if (input.end !== undefined) item.end = dateOrNull(input.end);
  if (typeof input.active === 'boolean') item.active = input.active;
  if (input.priority !== undefined) item.priority = Math.max(0, Math.min(10, Number(input.priority) || 0));
  item.updatedAt = new Date().toISOString();
  return item;
}
