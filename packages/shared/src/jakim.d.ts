import type { HijriDate, Settings, IslamicEvent } from './types.js';
export declare const BASE_URL = "https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat";
export declare const HIJRI_MONTHS: string[];
export interface JakimEntry {
    dateKey: string;
    hijri: HijriDate | null;
    day: string;
    times: {
        imsak: string | null;
        fajr: string | null;
        syuruk: string | null;
        dhuha: string | null;
        dhuhr: string | null;
        asr: string | null;
        maghrib: string | null;
        isha: string | null;
    };
}
export interface JakimResponse {
    status: string;
    prayerTime: unknown[];
}
export declare function getEntryForDate(zone: string, dateKey: string): Promise<JakimEntry | null>;
export declare function addDays(dateKey: string, days: number): string;
export interface SyncResult {
    ok: boolean;
    synced?: number;
    approximated?: number;
    lastSynced?: string;
    message?: string;
}
export interface EventsPatch {
    events?: IslamicEvent[];
    eventsSync?: Partial<Settings['eventsSync']>;
}
export declare function syncEventsFor(settings: Settings, saveFn: (patch: EventsPatch) => void | Promise<void>, force?: boolean): Promise<SyncResult>;
export declare function hijriText(hijri: HijriDate | null | undefined): string | null;
