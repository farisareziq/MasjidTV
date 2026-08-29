// UNIT TESTING — objective: verify individual shared components in isolation.

import { describe, it, expect } from 'vitest';
import { getZone, getZonesGrouped, ZONES } from '../src/zones.js';
import { hijriForDateKey } from '../src/hijri.js';
import { formatTime, dateKeyInZone, zonedDateTime, METHODS } from '../src/prayers.js';
import { quranVerseForDate } from '../src/quran.js';
import { DOAS, doaForDate, resolveDoaAnnouncements } from '../src/doa.js';
import { isSafeStreamUrl, applyPatch, DEFAULT_SETTINGS } from '../src/validate.js';

describe('Unit Testing / zones', () => {
  it('looks up a known zone code', () => {
    expect(getZone('WLY01')).toEqual({
      zone: 'WLY01', negeri: 'Wilayah Persekutuan', label: 'Kuala Lumpur, Putrajaya'
    });
  });

  it('returns null for unknown zone', () => {
    expect(getZone('ZZZ99')).toBeNull();
  });

  it('keeps zone codes unique', () => {
    const codes = ZONES.map((z) => z.zone);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('groups zones by state', () => {
    const groups = getZonesGrouped();
    expect(groups['Selangor'].length).toBeGreaterThan(0);
    expect(groups['Sabah'].length).toBeGreaterThan(0);
  });
});

describe('Unit Testing / hijri tabular calendar', () => {
  it('converts a known Gregorian date to Hijri', () => {
    expect(hijriForDateKey('2026-08-01')).toEqual({ year: 1448, month: 2, day: 17 });
  });

  it('rejects malformed dates', () => {
    expect(hijriForDateKey('not-a-date')).toBeNull();
    expect(hijriForDateKey('2026-8-15')).toBeNull();
  });

  it('applies the admin hijriOffset', () => {
    const base = hijriForDateKey('2026-08-15', 0);
    const shifted = hijriForDateKey('2026-08-15', 1);
    expect(shifted!.day).not.toBe(base!.day);
  });

  it('is deterministic', () => {
    expect(hijriForDateKey('2026-08-15')).toEqual(hijriForDateKey('2026-08-15'));
  });
});

describe('Unit Testing / timezone helpers', () => {
  it('computes the civil date inside a timezone', () => {
    // UTC 17:30 Aug 14 == MYT 01:30 Aug 15 (crosses the date boundary)
    expect(dateKeyInZone(new Date('2026-08-14T17:30:00Z'), 'Asia/Kuala_Lumpur')).toBe('2026-08-15');
  });

  it('formats a wall-clock time in a timezone', () => {
    expect(formatTime(new Date('2026-08-15T05:18:00Z'), 'Asia/Kuala_Lumpur')).toBe('13:18');
  });

  it('builds an exact instant from a wall-clock HH:MM in a timezone', () => {
    const d = zonedDateTime('2026-08-15', '13:18', 'Asia/Kuala_Lumpur');
    expect(d.getTime()).toBe(new Date('2026-08-15T05:18:00Z').getTime());
  });

  it('exposes the 13 calculation methods', () => {
    expect(Object.keys(METHODS)).toHaveLength(13);
    expect(METHODS.JAKIM.fajrAngle).toBe(20);
    expect(METHODS.UMM_AL_QURA.ishaInterval).toBe(90);
  });
});

describe('Unit Testing / daily Quran verse', () => {
  it('picks a verse deterministically per date', () => {
    expect(quranVerseForDate('2026-08-15')).toEqual(quranVerseForDate('2026-08-15'));
  });

  it('changes the verse between dates', () => {
    const a = quranVerseForDate('2026-08-15');
    const b = quranVerseForDate('2026-08-16');
    expect(a.ref).not.toBe(b.ref);
  });
});

describe('Unit Testing / daily doa (kitaran bulanan)', () => {
  it('has 31 doa — satu setiap haribulan', () => {
    expect(DOAS).toHaveLength(31);
    for (const d of DOAS) {
      expect(d.arabic.trim()).toBeTruthy();
      expect(d.text_ms.trim()).toBeTruthy();
      expect(d.text_en.trim()).toBeTruthy();
      expect(d.ref.trim()).toBeTruthy();
    }
  });

  it('picks the doa by day of month (1 haribulan = doa #1)', () => {
    expect(doaForDate('2026-08-01')).toEqual(DOAS[0]);
    expect(doaForDate('2026-08-15')).toEqual(DOAS[14]);
    expect(doaForDate('2026-08-31')).toEqual(DOAS[30]);
  });

  it('auto-renews on the 1st of the next month', () => {
    expect(doaForDate('2026-08-01')).toEqual(doaForDate('2026-09-01'));
    expect(doaForDate('2026-08-01').arabic).not.toBe(doaForDate('2026-08-02').arabic);
  });

  it('falls back to the first doa for malformed dates', () => {
    expect(doaForDate('not-a-date')).toEqual(DOAS[0]);
  });

  it('fills empty doa announcement fields but honours overrides', () => {
    const base = {
      id: 'x', title: 'Doa Harian', message: '', category: 'doa' as const,
      image: null, video: null, quranDaily: true, doaDaily: true,
      arabic: '', translationMs: '', translationEn: '', ref: '',
      sortOrder: 1, start: null, end: null, active: true, priority: 0,
      createdAt: '', updatedAt: ''
    };
    const today = '2026-08-05';
    const [filled] = resolveDoaAnnouncements([base], today);
    expect(filled.arabic).toBe(DOAS[4].arabic);
    expect(filled.translationMs).toBe(DOAS[4].text_ms);
    expect(filled.ref).toBe(DOAS[4].ref);

    const custom = { ...base, arabic: 'دُعَاءٌ خَاصٌّ', ref: 'Custom' };
    const [kept] = resolveDoaAnnouncements([custom], today);
    expect(kept.arabic).toBe('دُعَاءٌ خَاصٌّ');
    expect(kept.ref).toBe('Custom');
    expect(kept.translationMs).toBe(DOAS[4].text_ms); // medan kosong tetap diisi
  });

  it('leaves non-doa announcements untouched', () => {
    const base = {
      id: 'x', title: 'Tazkirah', message: 'hi', category: 'announcement' as const,
      image: null, video: null, quranDaily: true, doaDaily: true,
      arabic: '', translationMs: '', translationEn: '', ref: '',
      sortOrder: 1, start: null, end: null, active: true, priority: 0,
      createdAt: '', updatedAt: ''
    };
    const [same] = resolveDoaAnnouncements([base], '2026-08-05');
    expect(same).toEqual(base);
  });
});


describe('Unit Testing / SSRF stream URL guard', () => {
  it('allows LAN rtsp camera and https hls', () => {
    expect(isSafeStreamUrl('rtsp://192.168.1.50:554/stream', 'rtsp')).toBe(true);
    expect(isSafeStreamUrl('https://example.com/stream.m3u8', 'hls')).toBe(true);
  });

  it('dshow: accepts OBS Virtual Camera device name, rejects arbitrary URLs', () => {
    expect(isSafeStreamUrl('video=OBS Virtual Camera', 'dshow')).toBe(true);
    expect(isSafeStreamUrl('video=USB2.0 HD UVC WebCam', 'dshow')).toBe(true);
    // Bukan nama peranti — ia bukan URL sah dan mesti ditolak.
    expect(isSafeStreamUrl('rtsp://192.168.1.50/stream', 'dshow')).toBe(false);
    expect(isSafeStreamUrl('http://169.254.169.254/x', 'dshow')).toBe(false);
  });

  it('allows an empty URL (not configured yet)', () => {
    expect(isSafeStreamUrl('', 'rtsp')).toBe(true);
  });

  it('rejects a scheme that does not match the stream type', () => {
    expect(isSafeStreamUrl('http://example.com', 'rtsp')).toBe(false);
  });

  it('rejects loopback and cloud metadata targets', () => {
    expect(isSafeStreamUrl('http://localhost:3000/admin', 'hls')).toBe(false);
    expect(isSafeStreamUrl('http://169.254.169.254/latest/meta-data', 'hls')).toBe(false);
    expect(isSafeStreamUrl('http://metadata.google.internal', 'hls')).toBe(false);
  });

  it('rejects non-IP-literal obfuscated loopbacks', () => {
    expect(isSafeStreamUrl('http://2130706433/x', 'hls')).toBe(false);    // 127.0.0.1 as integer
    expect(isSafeStreamUrl('http://0x7f000001/x', 'hls')).toBe(false);    // 127.0.0.1 as hex
    expect(isSafeStreamUrl('http://[::1]/x', 'hls')).toBe(false);         // IPv6 loopback
  });

  it('rejects IPv6-mapped, NAT64-embedded and link-local targets', () => {
    expect(isSafeStreamUrl('http://[::ffff:127.0.0.1]/x', 'hls')).toBe(false);
    expect(isSafeStreamUrl('http://[::ffff:7f00:1]/x', 'hls')).toBe(false);   // URL-normalized mapped form
    expect(isSafeStreamUrl('http://[::ffff:169.254.169.254]/x', 'hls')).toBe(false);
    expect(isSafeStreamUrl('http://[64:ff9b::127.0.0.1]/x', 'hls')).toBe(false); // NAT64 loopback
    expect(isSafeStreamUrl('http://[64:ff9b::7f00:1]/x', 'hls')).toBe(false);    // NAT64 hex form
    expect(isSafeStreamUrl('http://[64:ff9b::169.254.169.254]/x', 'hls')).toBe(false);
    expect(isSafeStreamUrl('http://[fe80::1]/x', 'hls')).toBe(false);       // link-local
    expect(isSafeStreamUrl('http://[::]/x', 'hls')).toBe(false);            // unspecified
  });

  it('rejects malformed URLs', () => {
    expect(isSafeStreamUrl('not-a-url', 'hls')).toBe(false);
  });
});

describe('Unit Testing / settings patch validation', () => {
  it('clamps out-of-range numbers', () => {
    const next = applyPatch(DEFAULT_SETTINGS, {
      prayer: { iqamahOffsetMinutes: 9999, azanLeadMinutes: -5 },
      display: { safeMargin: 100 },
      hijriOffset: 99
    });
    expect(next.prayer.iqamahOffsetMinutes).toBe(60);
    expect(next.prayer.azanLeadMinutes).toBe(1);
    expect(next.display.safeMargin).toBe(8);
    expect(next.hijriOffset).toBe(2);
  });

  it('validates color hex values', () => {
    const next = applyPatch(DEFAULT_SETTINGS, {
      display: { colors: { bgTop: 'not-a-color', gold: '#ffaa00' } }
    });
    expect(next.display.colors.bgTop).toBe(DEFAULT_SETTINGS.display.colors.bgTop);
    expect(next.display.colors.gold).toBe('#ffaa00');
  });

  it('filters invalid streams', () => {
    const next = applyPatch(DEFAULT_SETTINGS, {
      streams: [
        { name: 'OK', type: 'hls', url: 'https://x.com/a.m3u8' },
        { name: 'SSRF', type: 'hls', url: 'http://localhost/x' },
        { name: 'BadType', type: 'foo', url: 'https://x.com' }
      ]
    });
    expect(next.streams).toHaveLength(1);
    expect(next.streams[0].name).toBe('OK');
  });

  it('never mutates the original settings object', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS);
    applyPatch(DEFAULT_SETTINGS, { mosque: { name: 'New Name' } });
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
  });
});
