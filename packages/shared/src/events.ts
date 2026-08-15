// Helper untuk mengira tarikh seterusnya bagi hari kebesaran Islam.
// Pengiraan guna tarikh sivil (YYYY-MM-DD) dalam timezone masjid, bukan
// timezone server - supaya Vercel (UTC) tidak terlewat 1 hari dari Malaysia.

import type { IslamicEvent } from './types.js';
import { dateKeyInZone } from './prayers.js';

export { dateKeyInZone };

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function withYear(dateKey: string, year: number): string {
  return `${year}${dateKey.slice(4)}`;
}

export function nextOccurrence(event: IslamicEvent, todayKey: string): string | null {
  const today = dayNumber(todayKey);
  if (event.recurring === false) {
    return dayNumber(event.date) >= today ? event.date : null;
  }
  const thisYear = withYear(event.date, Number(todayKey.slice(0, 4)));
  if (dayNumber(thisYear) >= today) return thisYear;
  return withYear(event.date, Number(todayKey.slice(0, 4)) + 1);
}

export function daysUntil(dateKey: string, todayKey: string): number {
  return dayNumber(dateKey) - dayNumber(todayKey);
}

export interface EventPayload extends IslamicEvent {
  next: string;
  daysLeft: number;
  today: boolean;
}

export function buildEventsPayload(
  events: IslamicEvent[],
  now = new Date(),
  timezone = 'Asia/Kuala_Lumpur'
): EventPayload[] {
  const todayKey = dateKeyInZone(now, timezone);
  return events
    .map((e) => {
      const next = nextOccurrence(e, todayKey);
      if (!next) return null;
      return {
        ...e,
        next,
        daysLeft: daysUntil(next, todayKey),
        today: daysUntil(next, todayKey) <= 0
      };
    })
    .filter((e): e is EventPayload => e !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}
