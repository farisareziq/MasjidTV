import type { Settings, Stream, StreamType } from './types.js';
import { nextPrayer } from './prayers.js';
import type { PrayerDay } from './types.js';
export declare const RELAY_TYPES: ReadonlySet<StreamType>;
export declare function isRelayType(type: StreamType): boolean;
export declare function parseYouTubeId(url: string): string | null;
export declare function publicStream(s: Stream): Record<string, unknown>;
export declare function publicSettings(s: Settings, opts?: {
    includeEventsSync?: boolean;
}): Record<string, unknown>;
export interface TodayPayload {
    now: string;
    today: string;
    timeZone: string;
    source: PrayerDay['source'];
    hijri: (NonNullable<PrayerDay['hijri']> & {
        text: string | null;
    }) | null;
    zone: PrayerDay['zone'];
    prayers: PrayerDay['times'];
    iqamah: Record<string, {
        time: string;
        ms: number;
    }>;
    next: ReturnType<typeof nextPrayer>;
}
export declare function buildTodayPayload(settings: Settings, now?: Date): Promise<TodayPayload>;
