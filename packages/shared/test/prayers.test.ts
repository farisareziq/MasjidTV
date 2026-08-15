import { describe, it, expect } from 'vitest';
import { METHODS, dateKeyInZone, formatTime, zonedDateTime, nextPrayer } from '../src/prayers.js';
import type { PrayerDay, Settings } from '../src/types.js';
import { DEFAULT_SETTINGS } from '../src/validate.js';

describe('prayers', () => {
  it('exposes 13 calculation methods', () => {
    expect(Object.keys(METHODS)).toHaveLength(13);
    expect(METHODS.JAKIM).toEqual({ label: 'JAKIM — Malaysia', fajrAngle: 20, ishaAngle: 18 });
    expect(METHODS.UMM_AL_QURA.ishaInterval).toBe(90);
  });

  it('formats dateKeyInZone correctly', () => {
    // UTC 00:30 on Aug 15 == MYT 08:30 Aug 15
    expect(dateKeyInZone(new Date('2026-08-15T00:30:00Z'), 'Asia/Kuala_Lumpur')).toBe('2026-08-15');
    // UTC 17:30 on Aug 14 == MYT 01:30 Aug 15 (crosses date boundary)
    expect(dateKeyInZone(new Date('2026-08-14T17:30:00Z'), 'Asia/Kuala_Lumpur')).toBe('2026-08-15');
  });

  it('formats time in a timezone', () => {
    // 13:18 MYT == 05:18 UTC
    const d = new Date('2026-08-15T05:18:00Z');
    expect(formatTime(d, 'Asia/Kuala_Lumpur')).toBe('13:18');
  });

  it('builds zonedDateTime for a wall-clock HH:MM in tz', () => {
    const d = zonedDateTime('2026-08-15', '13:18', 'Asia/Kuala_Lumpur');
    expect(d.getTime()).toBe(new Date('2026-08-15T05:18:00Z').getTime());
  });

  describe('nextPrayer', () => {
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
      const now = new Date(base);
      const next = nextPrayer(today, tomorrow, now, settings);
      expect(next!.key).toBe('dhuhr');
      expect(next!.tomorrow).toBe(false);
    });

    it('rolls to tomorrow fajr when today is done', () => {
      const today = mkDay('2026-08-15', {
        fajr: { ms: base - 7200000 },
        dhuhr: { ms: base - 3600000 }
      });
      const tomorrow = mkDay('2026-08-16', { fajr: { ms: base + 86400000 } });
      const now = new Date(base);
      const next = nextPrayer(today, tomorrow, now, settings);
      expect(next!.key).toBe('fajr');
      expect(next!.tomorrow).toBe(true);
    });

    it('computes iqamah from offset', () => {
      const today = mkDay('2026-08-15', { dhuhr: { ms: base + 600000 } });
      const tomorrow = mkDay('2026-08-16', { fajr: { ms: base + 86400000 } });
      const now = new Date(base);
      const next = nextPrayer(today, tomorrow, now, settings)!;
      expect(next.iqamah).not.toBeNull();
      expect(next.iqamah!.ms).toBe((base + 600000) + 10 * 60000);
    });

    it('returns null when no upcoming prayers', () => {
      const today = mkDay('2026-08-15', { fajr: { ms: base - 1000 } });
      const tomorrow = mkDay('2026-08-16', {});
      const now = new Date(base);
      expect(nextPrayer(today, tomorrow, now, settings)).toBeNull();
    });
  });
});
