import type { Announcement, AnnouncementCategory } from './types.js';
export declare const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[];
export declare function sanitizeCategory(v: unknown): AnnouncementCategory;
export declare function sortAnnouncements(items: Announcement[]): Announcement[];
export declare function isAnnouncementActive(item: Announcement, now: Date, timezone: string): boolean;
export declare function sanitizeAnnouncementCreate(input: Record<string, unknown>): Announcement;
export declare function applyAnnouncementPatch(item: Announcement, input: Record<string, unknown>): Announcement;
