import type { Announcement } from './types.js';
export interface QuranVerse {
    arabic: string;
    text_ms: string;
    text_en: string;
    ref: string;
}
export declare const VERSES: QuranVerse[];
export declare function quranVerseForDate(dateKey: string): QuranVerse;
export declare function resolveQuranAnnouncements<T extends Announcement>(announcements: T[], todayKey: string): T[];
