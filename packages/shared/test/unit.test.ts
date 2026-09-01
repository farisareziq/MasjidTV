// UNIT TESTING — objective: verify individual shared components in isolation.

import { describe, it, expect } from 'vitest';
import { getZone, getZonesGrouped, ZONES } from '../src/zones.js';
import { hijriForDateKey } from '../src/hijri.js';
import { formatTime, dateKeyInZone, zonedDateTime, METHODS } from '../src/prayers.js';
import { VERSES, quranVerseForDate } from '../src/quran.js';
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

describe('Unit Testing / daily Quran verse (kitaran bulanan)', () => {
  it('has 31 verses — satu setiap haribulan', () => {
    expect(VERSES).toHaveLength(31);
    for (const v of VERSES) {
      expect(v.arabic.trim()).toBeTruthy();
      expect(v.text_ms.trim()).toBeTruthy();
      expect(v.text_en.trim()).toBeTruthy();
      expect(v.ref.trim()).toBeTruthy();
    }
  });

  it('picks the verse by day of month (1 haribulan = ayat #1)', () => {
    expect(quranVerseForDate('2026-08-01')).toEqual(VERSES[0]);
    expect(quranVerseForDate('2026-08-15')).toEqual(VERSES[14]);
    expect(quranVerseForDate('2026-08-31')).toEqual(VERSES[30]);
  });

  it('auto-renews on the 1st of the next month', () => {
    expect(quranVerseForDate('2026-08-01')).toEqual(quranVerseForDate('2026-09-01'));
    expect(quranVerseForDate('2026-08-01').arabic).not.toBe(quranVerseForDate('2026-08-02').arabic);
  });

  it('picks a verse deterministically per date', () => {
    expect(quranVerseForDate('2026-08-15')).toEqual(quranVerseForDate('2026-08-15'));
  });

  it('falls back to the first verse for malformed dates', () => {
    expect(quranVerseForDate('not-a-date')).toEqual(VERSES[0]);
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

describe('Unit Testing / prayer.overrides (suntingan manual)', () => {
  const today = dateKeyInZone(new Date(), 'Asia/Kuala_Lumpur');

  it('upserts per-date overrides and validates HH:MM values', () => {
    const next = applyPatch(DEFAULT_SETTINGS, {
      prayer: { overrides: { [today]: { fajr: '05:58', maghrib: '19:30' } } }
    });
    expect(next.prayer.overrides?.[today]).toEqual({ fajr: '05:58', maghrib: '19:30' });
    const next2 = applyPatch(next, {
      prayer: { overrides: { [today]: { fajr: '06:01', bad: '25:99', isha: 'abc' } } }
    });
    // Kunci tidak sah dibuang; nilai sah menimpa; kunci tiada dalam patch kekal.
    expect(next2.prayer.overrides?.[today]).toEqual({ fajr: '06:01', maghrib: '19:30' });
  });

  it('deletes a date override with null and preserves untouched dates', () => {
    const withTwo = applyPatch(DEFAULT_SETTINGS, {
      prayer: { overrides: {
        '2026-01-01': { fajr: '05:00' },
        '2026-01-02': { isha: '20:00' }
      } }
    });
    const cleared = applyPatch(withTwo, {
      prayer: { overrides: { '2026-01-01': null } }
    });
    expect(cleared.prayer.overrides?.['2026-01-01']).toBeUndefined();
    expect(cleared.prayer.overrides?.['2026-01-02']).toEqual({ isha: '20:00' });
  });

  it('rejects malformed date keys and caps the map size', () => {
    const big: Record<string, unknown> = { 'not-a-date': { fajr: '05:00' } };
    for (let i = 0; i < 450; i++) big[`2026-${String(Math.floor(i / 31) + 1).padStart(2, '0')}-${String(i % 31 + 1).padStart(2, '0')}`] = { fajr: '05:00' };
    const next = applyPatch(DEFAULT_SETTINGS, { prayer: { overrides: big } });
    expect(next.prayer.overrides?.['not-a-date']).toBeUndefined();
    expect(Object.keys(next.prayer.overrides || {}).length).toBeLessThanOrEqual(400);
  });

  it('a saved override wins over the JAKIM/local time in getDay', async () => {
    const { getDay } = await import('../src/prayers.js');
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
    // Pastikan tarikh ujian stabil: guna hari semasa MYT supaya getDay
    // menyelesaikan hari yang sama.
    s.prayer.source = 'local';
    const base = await getDay(today, s);
    const baseFajr = base.times.fajr!.time;
    s.prayer.overrides = { [today]: { fajr: '05:11' } };
    const edited = await getDay(today, s);
    expect(edited.times.fajr!.time).toBe('05:11');
    expect(edited.times.fajr!.time).not.toBe(baseFajr);
    // Kunci lain tidak berubah.
    expect(edited.times.dhuhr!.time).toBe(base.times.dhuhr!.time);
  });
});

describe('Unit Testing / jakim cache helpers', () => {
  it('parses the NEW e-Solat date format (English abbreviated months)', async () => {
    // e-Solat menukar format tarikh (~Sep 2026): "01-Sep-2026" (singkatan
    // Inggeris) bukan "01-September-2026" (Melayu penuh). Tanpa peta bulan
    // yang diperluas, SEMUA entri gagal dihurai → fallback tempatan senyap.
    const { parseEntry } = await import('../src/jakim.js');
    const raw = {
      hijri: '1448-03-19', date: '01-Sep-2026', day: 'Tuesday',
      imsak: '05:50:00', fajr: '06:00:00', syuruk: '07:07:00', dhuha: '07:32:00',
      dhuhr: '13:16:00', asr: '16:24:00', maghrib: '19:21:00', isha: '20:30:00'
    };
    const entry = parseEntry(raw);
    expect(entry).not.toBeNull();
    expect(entry!.dateKey).toBe('2026-09-01');
    expect(entry!.hijri).toEqual({ year: 1448, month: 3, day: 19 });
    expect(entry!.times).toEqual({
      imsak: '05:50', fajr: '06:00', syuruk: '07:07', dhuha: '07:32',
      dhuhr: '13:16', asr: '16:24', maghrib: '19:21', isha: '20:30'
    });
    // Semua 12 singkatan Inggeris + semua nama Melayu mesti dihurai.
    const ENG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MELAYU = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
    for (let i = 0; i < 12; i++) {
      expect(parseEntry({ date: `15-${ENG[i]}-2026` })?.dateKey).toBe(`2026-${String(i + 1).padStart(2, '0')}-15`);
      expect(parseEntry({ date: `15-${MELAYU[i]}-2026` })?.dateKey).toBe(`2026-${String(i + 1).padStart(2, '0')}-15`);
    }
  });

  it('round-trips a JakimEntry through the row conversion', async () => {
    const { jakimEntryToRow, jakimRowToEntry } = await import('../src/jakim.js');
    const entry = {
      dateKey: '2026-09-01',
      hijri: { year: 1448, month: 3, day: 9 },
      day: 'Selasa',
      times: { imsak: '05:44', fajr: '05:54', syuruk: '07:08', dhuha: '07:32', dhuhr: '13:15', asr: '16:36', maghrib: '19:22', isha: '20:34' }
    };
    const row = jakimEntryToRow('WLY01', entry);
    expect(row.zone).toBe('WLY01');
    expect(row.date_key).toBe('2026-09-01');
    expect(JSON.parse(row.hijri)).toEqual(entry.hijri);
    const back = jakimRowToEntry(row);
    expect(back).not.toBeNull();
    expect(back!.dateKey).toBe(entry.dateKey);
    expect(back!.times).toEqual(entry.times);
  });

  it('tolerates corrupted hijri JSON and null times', async () => {
    const { jakimRowToEntry } = await import('../src/jakim.js');
    const row = {
      zone: 'WLY01', date_key: '2026-09-01', hijri: '{oops',
      imsak: null, fajr: '05:54', syuruk: null, dhuha: null,
      dhuhr: '13:15', asr: null, maghrib: null, isha: null
    };
    const entry = jakimRowToEntry(row);
    expect(entry).not.toBeNull();
    expect(entry!.hijri).toBeNull();
    expect(entry!.times.fajr).toBe('05:54');
    expect(entry!.times.asr).toBeNull();
  });

  it('plans the yearly sync range from the cached max date', async () => {
    const { planZoneYearSync } = await import('../src/jakim.js');
    const today = '2026-09-01';
    // Tiada cache → tahun penuh.
    expect(planZoneYearSync(null, false, today)).toEqual({ from: '2026-01-01', to: '2026-12-31', complete: false });
    // Cache hingga semalam → hanya hari semasa seterusnya.
    expect(planZoneYearSync('2026-08-31', false, today)).toEqual({ from: '2026-09-01', to: '2026-12-31', complete: false });
    // Cache tahun lama (sebelum tahun semasa) → mula semula dari 1 Jan.
    expect(planZoneYearSync('2025-12-31', false, today)).toEqual({ from: '2026-01-01', to: '2026-12-31', complete: false });
    // Lengkap → tiada yang perlu ditarik.
    expect(planZoneYearSync('2026-12-31', false, today).complete).toBe(true);
    // Paksa → tarik semula tahun penuh.
    expect(planZoneYearSync('2026-12-31', true, today).complete).toBe(false);
  });

  it('serves getEntryForDate fully offline once the DB cache has the day', async () => {
    const { setJakimCacheAdapter, getEntryForDate, jakimEntryToRow, jakimRowToEntry } = await import('../src/jakim.js');
    const entry = {
      dateKey: '2026-09-01',
      hijri: { year: 1448, month: 3, day: 9 },
      day: 'Selasa',
      times: { imsak: '05:44', fajr: '05:54', syuruk: '07:08', dhuha: '07:32', dhuhr: '13:15', asr: '16:36', maghrib: '19:22', isha: '20:34' }
    };
    // Adapter ingat-berterusan: hari tersimpan TIDAK boleh mencetuskan sebarang
    // panggilan rangkaian — fetch ditukar kepada fungsi yang gagal ujian.
    let putCalls = 0;
    setJakimCacheAdapter({
      get: (_zone, dateKey) => (dateKey === '2026-09-01' ? jakimRowToEntry(jakimEntryToRow('WLY01', entry)) : null),
      put: () => { putCalls++; }
    });
    try {
      const found = await getEntryForDate('WLY01', '2026-09-01');
      expect(found).not.toBeNull();
      expect(found!.times.fajr).toBe('05:54');
      expect(putCalls).toBe(0); // cache hit — tiada tulisan
    } finally {
      setJakimCacheAdapter(null);
    }
  });
});
