import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEntryForDate, addDays, hijriText, HIJRI_MONTHS } from '../src/jakim.js';

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

describe('jakim', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('parses week response and finds entry by date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => WEEK_RESPONSE
    })));

    const entry = await getEntryForDate('JHR04', '2026-08-15');
    expect(entry).not.toBeNull();
    expect(entry!.hijri).toEqual({ year: 1448, month: 1, day: 29 });
    expect(entry!.times.fajr).toBe('05:55');
    expect(entry!.times.syuruk).toBe('07:12');
  });

  it('returns null when date not in week', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => WEEK_RESPONSE
    })));

    const entry = await getEntryForDate('JHR04', '2026-08-20');
    expect(entry).toBeNull();
  });

  it('adds days across month/year boundaries', () => {
    expect(addDays('2026-08-15', 5)).toBe('2026-08-20');
    expect(addDays('2026-08-30', 5)).toBe('2026-09-04');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('formats hijri text', () => {
    expect(hijriText({ year: 1448, month: 1, day: 29 })).toBe('29 Muharram 1448H');
    expect(hijriText(null)).toBeNull();
  });

  it('has 12 hijri months', () => {
    expect(HIJRI_MONTHS).toHaveLength(12);
    expect(HIJRI_MONTHS[0]).toBe('Muharram');
  });
});
