import type { PrayerMethodDef, PrayerMethodKey, Settings, PrayerDay, NextPrayer } from './types.js';
export declare const METHODS: Record<PrayerMethodKey, PrayerMethodDef>;
export declare function dateKeyInZone(date: Date, timeZone?: string): string;
export declare function formatTime(date: Date, timeZone: string): string;
export declare function zonedDateTime(dateKey: string, hhmm: string, timeZone: string): Date;
export declare function getDay(dateKey: string, settings: Settings): Promise<PrayerDay>;
export declare function nextPrayer(todayDay: PrayerDay, tomorrowDay: PrayerDay, now: Date, settings: Settings): NextPrayer | null;
