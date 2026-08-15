import type { IslamicEvent } from './types.js';
import { dateKeyInZone } from './prayers.js';
export { dateKeyInZone };
export declare function nextOccurrence(event: IslamicEvent, todayKey: string): string | null;
export declare function daysUntil(dateKey: string, todayKey: string): number;
export interface EventPayload extends IslamicEvent {
    next: string;
    daysLeft: number;
    today: boolean;
}
export declare function buildEventsPayload(events: IslamicEvent[], now?: Date, timezone?: string): EventPayload[];
