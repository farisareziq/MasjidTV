// INTEGRATION TESTING — objective: verify that modules work together
// (prayer engine <-> JAKIM client <-> payload builder <-> events calendar).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDay, nextPrayer } from '../src/prayers.js';
import { getEntryForDate, addDays, hijriText } from '../src/jakim.js';
import { buildTodayPayload } from '../src/payloads.js';
import { nextOccurrence, daysUntil, buildEventsPayload } from '../src/events.js';
import { DEFAULT_SETTINGS } from '../src/validate.js';
import type { Settings, PrayerDay, IslamicEvent } from '../src/types.js';

const WEEK_RESPONSE = {
  status: 'OK!',
  prayerTime: [
    {
      date: '15-Ogos-2026', hijri: '1448-1-29', day: 'Sabtu',
      imsak: '05:45:00', fajr: '05:55:00', syuruk: '07:12:00', dhuha: '07:35:00',
      dhuhr: '13:18:00', asr: '16:40:00', maghrib: '19:27:00', isha: '20:40:00'
    },
    {
      date: '16-Ogos-2026', hijri: '1448-2-1', day: 'Ahad',
      imsak: '05:45:00', fajr: '05:55:00', syuruk: '07:12:00', dhuha: '07:35:00',
      dhuhr: '13:18:00', asr: '16:40:00', maghrib: '19:26:00', isha: '20:40:00'
    }
  ]
};

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => WEEK_RESPONSE
  })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Integration Testing / JAKIM client + prayer engine', () => {
  it('feeds a parsed JAKIM week through getDay', async () => {
    stubFetch();
    const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const day = await getDay('2026-08-15', settings);
    expect(day.source).toBe('jakim');
    expect(day.hijri).toEqual({ year: 1448, month: 1, day: 29 });
    expect(day.times.fajr!.time).toBe('05:55');
    expect(day.times.maghrib!.time).toBe('19:27');
  });

  it('returns null when the date is outside the fetched week', async () => {
    stubFetch();
    expect(await getEntryForDate('JHR04', '2026-08-20')).toBeNull();
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-08-15', 5)).toBe('2026-08-20');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('formats hijri text with month names', () => {
    expect(hijriText({ year: 1448, month: 1, day: 29 })).toBe('29 Muharram 1448H');
    expect(hijriText(null)).toBeNull();
  });
});

describe('Integration Testing / prayer engine + nextPrayer', () => {
  const mkDay = (dateKey: string, times: Record<string, { ms: number }>): PrayerDay => ({
    dateKey,
    timeZone: 'Asia/Kuala_Lumpur',
    source: 'local',
    hijri: null,
    zone: null,
    times: Object.fromEntries(
      Object.entries(times).map(([k, v]) => [k, { time: '00:00', iso: '', ms: v.ms }])
    )
  });

  const base = new Date('2026-08-15T00:00:00Z').getTime();
  const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

  it('picks the next prayer from today', () => {
    const today = mkDay('2026-08-15', {
      fajr: { ms: base - 3600000 },
      dhuhr: { ms: base + 3600000 },
      asr: { ms: base + 7200000 }
    });
    const tomorrow = mkDay('2026-08-16', { fajr: { ms: base + 86400000 } });
    const next = nextPrayer(today, tomorrow, new Date(base), settings);
    expect(next!.key).toBe('dhuhr');
    expect(next!.tomorrow).toBe(false);
  });

  it('rolls to tomorrow fajr when today is done', () => {
    const today = mkDay('2026-08-15', {
      fajr: { ms: base - 7200000 },
      isha: { ms: base - 3600000 }
    });
    const tomorrow = mkDay('2026-08-16', { fajr: { ms: base + 86400000 } });
    const next = nextPrayer(today, tomorrow, new Date(base), settings);
    expect(next!.key).toBe('fajr');
    expect(next!.tomorrow).toBe(true);
  });

  it('derives iqamah from the configured offset', () => {
    const today = mkDay('2026-08-15', { dhuhr: { ms: base + 600000 } });
    const tomorrow = mkDay('2026-08-16', { fajr: { ms: base + 86400000 } });
    const next = nextPrayer(today, tomorrow, new Date(base), settings)!;
    expect(next.iqamah!.ms).toBe((base + 600000) + 10 * 60000);
  });

  it('returns null when no upcoming prayers exist', () => {
    const today = mkDay('2026-08-15', { fajr: { ms: base - 1000 } });
    const tomorrow = mkDay('2026-08-16', {});
    expect(nextPrayer(today, tomorrow, new Date(base), settings)).toBeNull();
  });
});

describe('Integration Testing / settings + /api/today payload builder', () => {
  it('builds a complete today payload from local settings', async () => {
    const settings: Settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    settings.prayer.source = 'local';
    const now = new Date('2026-08-15T02:00:00Z'); // 10:00 MYT
    const payload = await buildTodayPayload(settings, now);

    expect(payload.timeZone).toBe('Asia/Kuala_Lumpur');
    expect(payload.today).toBe('2026-08-15');
    expect(payload.source).toBe('local');
    for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
      expect(payload.prayers[key]).toBeDefined();
      expect(payload.iqamah[key]).toBeDefined();
    }
    expect(payload.next).not.toBeNull();
    // Prayer times must be in chronological order.
    const ms = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].map((k) => payload.prayers[k]!.ms);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
  });
});

describe('Integration Testing / events calendar', () => {
  const recurring: IslamicEvent = {
    id: 'e1', name: 'Awal Muharam', nameEn: 'Islamic New Year',
    date: '2026-06-06', recurring: true
  };

  const oneOff: IslamicEvent = {
    id: 'e2', name: 'Sekali sahaja', nameEn: 'One-off',
    date: '2026-10-01', recurring: false
  };

  it('computes the next occurrence of recurring events', () => {
    expect(nextOccurrence(recurring, '2026-01-01')).toBe('2026-06-06');
    expect(nextOccurrence(recurring, '2026-06-07')).toBe('2027-06-06');
  });

  it('drops passed one-off events', () => {
    expect(nextOccurrence(oneOff, '2026-11-01')).toBeNull();
    expect(nextOccurrence(oneOff, '2026-01-01')).toBe('2026-10-01');
  });

  it('computes days until an event', () => {
    expect(daysUntil('2026-06-06', '2026-06-01')).toBe(5);
    expect(daysUntil('2026-06-01', '2026-06-01')).toBe(0);
  });

  it('builds the payload sorted by daysLeft', () => {
    const payload = buildEventsPayload([recurring, oneOff], new Date('2026-01-01T00:00:00Z'));
    expect(payload.length).toBe(2);
    expect(payload[0].daysLeft).toBeLessThanOrEqual(payload[1].daysLeft);
  });
});
