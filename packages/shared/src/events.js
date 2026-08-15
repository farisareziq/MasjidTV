// Helper untuk mengira tarikh seterusnya bagi hari kebesaran Islam.
// Pengiraan guna tarikh sivil (YYYY-MM-DD) dalam timezone masjid, bukan
// timezone server - supaya Vercel (UTC) tidak terlewat 1 hari dari Malaysia.
import { dateKeyInZone } from './prayers.js';
export { dateKeyInZone };
function dayNumber(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
}
function withYear(dateKey, year) {
    return `${year}${dateKey.slice(4)}`;
}
export function nextOccurrence(event, todayKey) {
    const today = dayNumber(todayKey);
    if (event.recurring === false) {
        return dayNumber(event.date) >= today ? event.date : null;
    }
    const thisYear = withYear(event.date, Number(todayKey.slice(0, 4)));
    if (dayNumber(thisYear) >= today)
        return thisYear;
    return withYear(event.date, Number(todayKey.slice(0, 4)) + 1);
}
export function daysUntil(dateKey, todayKey) {
    return dayNumber(dateKey) - dayNumber(todayKey);
}
export function buildEventsPayload(events, now = new Date(), timezone = 'Asia/Kuala_Lumpur') {
    const todayKey = dateKeyInZone(now, timezone);
    return events
        .map((e) => {
        const next = nextOccurrence(e, todayKey);
        if (!next)
            return null;
        return {
            ...e,
            next,
            daysLeft: daysUntil(next, todayKey),
            today: daysUntil(next, todayKey) <= 0
        };
    })
        .filter((e) => e !== null)
        .sort((a, b) => a.daysLeft - b.daysLeft);
}
//# sourceMappingURL=events.js.map