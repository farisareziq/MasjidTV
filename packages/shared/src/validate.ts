// Port logik validasi tetapan daripada server/config.js (kekal sama untuk pariti).

import crypto from 'node:crypto';
import { METHODS } from './prayers.js';
import type { Settings, StreamType, Weekday } from './types.js';

const WEEKDAYS: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Sekatan SSRF untuk URL stream: skema mesti sepadan jenis, host dinyahkod
// kepada IP dan ditolak jika loopback/link-local/metadata cloud. Rangkaian
// peribadi LAN (cth 192.168.x.x kamera) kekal dibenarkan.
export function isSafeStreamUrl(url: unknown, type: StreamType): boolean {
  const s = String(url || '').trim();
  if (!s) return true; // URL kosong dibenarkan (belum diisi)
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(':', '');
  const allowed: Record<StreamType, string[]> = {
    rtsp: ['rtsp'], rtmp: ['rtmp'], onvif: ['rtsp', 'http', 'https'],
    hls: ['http', 'https'], youtube: ['http', 'https'], webrtc: ['http', 'https']
  };
  if (!allowed[type] || !allowed[type].includes(scheme)) return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Nama metadada cloud (boleh jadi bukan IP literal).
  if (['localhost', 'metadata.google.internal'].includes(host)) return false;

  // Nyahkod semua encoding IP (perpuluhan/heks/oktal IPv4, IPv6 termasuk
  // ::ffff: mapped) — blocklist string mudah dilangkau.
  const ip = parseIpLiteral(host);
  if (ip) {
    if (isBlockedIp(ip)) return false;
  }
  return true;
}

// Parse hostname kepada bait IPv4/IPv6; menyokong semua encoding inet_aton:
// perpuluhan/heks/oktal bertitik, bentuk ringkas 1-3 bahagian, satu-integer,
// dan IPv6 (termasuk ::, ::ffff: mapped). Sentiasa memulangkan BAIT supaya
// isBlockedIp mengaji susunan bait yang konsisten.
function parseIpLiteral(host: string): number[] | null {
  // IPv6 murni/mapped (contoh ::1, ::ffff:127.0.0.1)
  if (host.includes(':')) {
    return parseIpv6Bytes(host);
  }
  // IPv4 bertitik (termasuk heks/oktal setiap bahagian) dan bentuk ringkas
  // a / a.b / a.b.c / a.b.c.d (semantik inet_aton).
  const parts = host.split('.');
  if (parts.length >= 1 && parts.length <= 4 && parts.every((p) => /^[0-9a-fx]+$/i.test(p))) {
    const vals = parts.map((p) => {
      if (p === '') return NaN;
      if (/^0[xX]/.test(p)) return parseInt(p.slice(2), 16);
      if (p.length > 1 && p.startsWith('0')) return parseInt(p, 8);
      return parseInt(p, 10);
    });
    if (vals.some((v) => !Number.isFinite(v) || v < 0)) return null;
    if (parts.length === 4) {
      if (vals.some((v) => v > 255)) return null;
      return [...vals];
    }
    // Bentuk ringkas: bahagian terakhir memegang baki bit (8/16/24).
    const lastMax = 256 ** (5 - parts.length); // a=2^32, a.b=2^24, a.b.c=2^16
    if ((vals[vals.length - 1] as number) >= lastMax) return null;
    if (vals.slice(0, -1).some((v) => v > 255)) return null;
    const out: number[] = vals.slice(0, -1).map(Number);
    while (out.length < 3) out.push(0);
    out.push(vals[vals.length - 1] as number);
    return out;
  }
  // IPv4 satu-integer / heks (contoh 2130706433, 0x7f000001)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    const n = host.startsWith('0x') || host.startsWith('0X')
      ? parseInt(host, 16)
      : Number(host);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  return null;
}

// Parse IPv6 (termasuk ::, bentuk ringkas, zon diabaikan) kepada 8 kumpulan
// 16-bit. Sufiks IPv4 (cth ::ffff:127.0.0.1) dikira sebagai 2 kumpulan
// terakhir oleh parseGroup — tiada kes khas diperlukan.
function parseIpv6Groups(h: string): number[] | null {
  let host = h;
  const zone = host.indexOf('%');
  if (zone >= 0) host = host.slice(0, zone);
  if (!host.includes(':')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  // Bahagian berakhir dengan IPv4 dianggap sebagai 2 kumpulan terakhir.
  const parseGroup = (s: string): number[] | null => {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      const v4 = parseIpLiteral(s);
      if (!v4) return null;
      if (v4[0] > 255 || v4[1] > 255 || v4[2] > 255 || v4[3] > 255) return null;
      return [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    }
    if (!/^[0-9a-f]{1,4}$/i.test(s)) return null;
    return [parseInt(s, 16)];
  };
  const headGroups: number[] = [];
  for (const seg of head) {
    const g = parseGroup(seg);
    if (!g) return null;
    headGroups.push(...g);
  }
  const tailGroups: number[] = [];
  for (const seg of tail) {
    const g = parseGroup(seg);
    if (!g) return null;
    tailGroups.push(...g);
  }
  const total = headGroups.length + tailGroups.length;
  const fill = 8 - total;
  if (halves.length === 2 ? fill < 0 : total !== 8) return null;
  return [...headGroups, ...new Array(halves.length === 2 ? fill : 0).fill(0), ...tailGroups];
}

// Ratakan kumpulan 16-bit kepada 16 bait — isBlockedIp mengjangka bait
// (pemformatan kumpulan lama membuat ::1 dilihat sebagai [0,1] dan terlepas
// sekatan loopback).
function parseIpv6Bytes(h: string): number[] | null {
  const groups = parseIpv6Groups(h);
  if (!groups) return null;
  const out: number[] = [];
  for (const g of groups) out.push((g >> 8) & 0xff, g & 0xff);
  return out;
}

function isBlockedIp(bytes: number[]): boolean {
  // Loopback IPv4/IPv6 (0.0.0.0/8 dan 127.0.0.0/8, ::, ::1)
  if (bytes.length === 4) {
    if (bytes[0] === 127 || bytes[0] === 0) return true;
    // Link-local 169.254.0.0/16 (termasuk metadata cloud) dan 100.100.100.200
    if (bytes[0] === 169 && bytes[1] === 254) return true;
    if (bytes[0] === 100 && bytes[1] === 100 && bytes[2] === 100 && bytes[3] === 200) return true;
    return false;
  }
  if (bytes.length === 16) {
    const isAllZero = bytes.every((b) => b === 0);
    if (isAllZero) return true; // ::
    if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // ::1
    // IPv4-mapped ::ffff:a.b.c.d -> semak sebagai IPv4
    if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
      return isBlockedIp(bytes.slice(12));
    }
    // NAT64 well-known prefix 64:ff9b::/96 — IPv4 sesiri di hujung; host
    // seperti ini dihala semula ke IPv4 sebenar, jadi semak seperti IPv4.
    if (bytes[0] === 0 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
      && bytes.slice(4, 12).every((b) => b === 0)) {
      return isBlockedIp(bytes.slice(12));
    }
    // Link-local fe80::/10
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;
    return false;
  }
  return false;
}

type AnyPatch = Record<string, any>;

export function applyPatch(current: Settings, patch: AnyPatch): Settings {
  const settings = JSON.parse(JSON.stringify(current)) as Settings;
  if (!patch || typeof patch !== 'object') return settings;

  // Isi medan baharu yang tiada pada tetapan lama (tenant sedia ada) — elak
  // crash capaian `.testMode.runFullTest` pada objek bentuk lama.
  settings.display = settings.display || ({} as Settings['display']);
  settings.display.testMode = {
    ...DEFAULT_SETTINGS.display.testMode,
    ...(settings.display.testMode || {})
  };

  if (patch.mosque && typeof patch.mosque === 'object') {
    const m = settings.mosque;
    const p = patch.mosque as Record<string, unknown>;
    if (typeof p.name === 'string') m.name = p.name.trim().slice(0, 120) || m.name;
    if (typeof p.tagline === 'string') m.tagline = p.tagline.trim().slice(0, 120);
    if (typeof p.address === 'string') m.address = p.address.trim().slice(0, 200);
    if (typeof p.logo === 'string') m.logo = p.logo.trim().slice(0, 300);
  }

  if (patch.location && typeof patch.location === 'object') {
    const l = settings.location;
    const p = patch.location as Record<string, unknown>;
    if (p.latitude !== undefined) l.latitude = clampNum(p.latitude, -90, 90, l.latitude);
    if (p.longitude !== undefined) l.longitude = clampNum(p.longitude, -180, 180, l.longitude);
    if (typeof p.name === 'string') l.name = p.name.trim().slice(0, 120);
  }

  if (patch.prayer && typeof patch.prayer === 'object') {
    const pr = settings.prayer;
    const p = patch.prayer as Record<string, unknown>;
    if (typeof p.method === 'string' && p.method in METHODS) pr.method = p.method as Settings['prayer']['method'];
    if (p.source === 'jakim' || p.source === 'local') pr.source = p.source;
    if (typeof p.zone === 'string' && /^[A-Z]{3}\d{2}$/.test(p.zone)) pr.zone = p.zone;
    // Zon waktu mesti sah — nilai tidak sah membuat new Intl.DateTimeFormat
    // mempapar dan merosakkan /api/today.
    if (typeof p.timezone === 'string' && p.timezone.trim()) {
      try {
        new Intl.DateTimeFormat(p.timezone.trim());
        pr.timezone = p.timezone.trim();
      } catch {
        /* kekal nilai semasa */
      }
    }
    if (p.adjustments && typeof p.adjustments === 'object') {
      const a = p.adjustments as Record<string, unknown>;
      for (const key of Object.keys(pr.adjustments)) {
        if (a[key] !== undefined) {
          (pr.adjustments as unknown as Record<string, number>)[key] = clampNum(a[key], -120, 120, (pr.adjustments as unknown as Record<string, number>)[key]);
        }
      }
    }
    if (typeof p.showImsak === 'boolean') pr.showImsak = p.showImsak;
    if (p.imsakOffset !== undefined) pr.imsakOffset = clampNum(p.imsakOffset, 1, 60, pr.imsakOffset);
    if (typeof p.showSunrise === 'boolean') pr.showSunrise = p.showSunrise;
    if (p.azanLeadMinutes !== undefined) pr.azanLeadMinutes = clampNum(p.azanLeadMinutes, 1, 60, pr.azanLeadMinutes);
    if (p.iqamahOffsetMinutes !== undefined) pr.iqamahOffsetMinutes = clampNum(p.iqamahOffsetMinutes, 1, 60, pr.iqamahOffsetMinutes);
    if (p.jemaahDurationMinutes !== undefined) pr.jemaahDurationMinutes = clampNum(p.jemaahDurationMinutes, 1, 120, pr.jemaahDurationMinutes);
    if (p.afterIqamah === 'jemaah' || p.afterIqamah === 'black') pr.afterIqamah = p.afterIqamah;
    if (p.iqamah && typeof p.iqamah === 'object') {
      const iq = p.iqamah as Record<string, unknown>;
      for (const key of Object.keys(pr.iqamah)) {
        const v = String(iq[key] || '').trim();
        if (v === '') pr.iqamah[key as PrayerKeyIndex] = '';
        else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) pr.iqamah[key as PrayerKeyIndex] = v;
      }
    }
  }

  if (patch.display && typeof patch.display === 'object') {
    const d = settings.display;
    const p = patch.display as Record<string, unknown>;
    if (p.language === 'ms' || p.language === 'en') d.language = p.language;
    if (p.theme === 'dark' || p.theme === 'light') d.theme = p.theme;
    if (p.headingFont === 'sans' || p.headingFont === 'serif' || p.headingFont === 'classic') d.headingFont = p.headingFont;
    if (p.slideshowInterval !== undefined) d.slideshowInterval = clampNum(p.slideshowInterval, 5, 300, d.slideshowInterval);
    if (typeof p.showTicker === 'boolean') d.showTicker = p.showTicker;
    if (typeof p.showWeather === 'boolean') d.showWeather = p.showWeather;
    if (p.clockFormat === '24h' || p.clockFormat === '12h') d.clockFormat = p.clockFormat;
    if (typeof p.showSeconds === 'boolean') d.showSeconds = p.showSeconds;
    if (p.tickerSpeed === 'slow' || p.tickerSpeed === 'normal' || p.tickerSpeed === 'fast') d.tickerSpeed = p.tickerSpeed;
    if (p.safeMargin !== undefined) d.safeMargin = clampNum(p.safeMargin, 0, 8, d.safeMargin);
    if (p.mediaFit === 'stretch' || p.mediaFit === 'fit' || p.mediaFit === 'crop') d.mediaFit = p.mediaFit;
    if (typeof p.tickerCustom === 'string') d.tickerCustom = p.tickerCustom.trim().slice(0, 1000);
    if (p.colors && typeof p.colors === 'object') {
      const c = p.colors as Record<string, unknown>;
      const hex = (v: unknown, fb: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : fb);
      d.colors.bgTop = hex(c.bgTop, d.colors.bgTop);
      d.colors.bgBottom = hex(c.bgBottom, d.colors.bgBottom);
      d.colors.text = hex(c.text, d.colors.text);
      d.colors.muted = hex(c.muted, d.colors.muted);
      d.colors.gold = hex(c.gold, d.colors.gold);
      d.colors.teal = hex(c.teal, d.colors.teal);
    }
    if (typeof p.backgroundImage === 'string') d.backgroundImage = p.backgroundImage.trim().slice(0, 500);
    if (p.backgroundOpacity !== undefined) d.backgroundOpacity = clampNum(p.backgroundOpacity, 0, 100, d.backgroundOpacity);
    if (p.testMode && typeof p.testMode === 'object') {
      const tm = p.testMode as Record<string, unknown>;
      if (typeof tm.enabled === 'boolean') d.testMode.enabled = tm.enabled;
      if (typeof tm.date === 'string') d.testMode.date = /^\d{4}-\d{2}-\d{2}$/.test(tm.date) ? tm.date : '';
      if (typeof tm.time === 'string') d.testMode.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(tm.time) ? tm.time : '';
      if (typeof tm.runFullTest === 'boolean') d.testMode.runFullTest = tm.runFullTest;
      if (tm.startDelaySec !== undefined) d.testMode.startDelaySec = clampNum(tm.startDelaySec, 0, 300, d.testMode.startDelaySec);
      if (typeof tm.prayerKey === 'string' && ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jumaah'].includes(tm.prayerKey)) d.testMode.prayerKey = tm.prayerKey;
      if (tm.savedAtMs !== undefined) d.testMode.savedAtMs = clampNum(tm.savedAtMs, 0, Number.MAX_SAFE_INTEGER, d.testMode.savedAtMs);
      if (tm.phaseMs !== undefined) d.testMode.phaseMs = clampNum(tm.phaseMs, 5000, 900000, d.testMode.phaseMs);
    }
    if (p.staticBanner && typeof p.staticBanner === 'object') {
      const sb = d.staticBanner || (d.staticBanner = { enabled: false, title: '', message: '', image: '' });
      const s = p.staticBanner as Record<string, unknown>;
      if (typeof s.enabled === 'boolean') sb.enabled = s.enabled;
      if (typeof s.title === 'string') sb.title = s.title.trim().slice(0, 120);
      if (typeof s.message === 'string') sb.message = s.message.trim().slice(0, 300);
      if (typeof s.image === 'string') sb.image = s.image.trim().slice(0, 500);
    }
    if (typeof p.fridayKhutbahUntil === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.fridayKhutbahUntil)) {
      d.fridayKhutbahUntil = p.fridayKhutbahUntil;
    }
  }

  if (patch.weather && typeof patch.weather === 'object') {
    const p = patch.weather as Record<string, unknown>;
    if (typeof p.enabled === 'boolean') settings.weather.enabled = p.enabled;
    if (p.unit === 'c' || p.unit === 'f') settings.weather.unit = p.unit;
  }

  if (patch.audio && typeof patch.audio === 'object') {
    const p = patch.audio as Record<string, unknown>;
    if (typeof p.enabled === 'boolean') settings.audio.enabled = p.enabled;
    if (typeof p.adhanUrl === 'string') settings.audio.adhanUrl = p.adhanUrl.trim().slice(0, 500);
    if (typeof p.iqamahUrl === 'string') settings.audio.iqamahUrl = p.iqamahUrl.trim().slice(0, 500);
  }

  if (patch.media && typeof patch.media === 'object') {
    const p = patch.media as Record<string, unknown>;
    if (typeof p.ffmpegPath === 'string') {
      settings.media.ffmpegPath = p.ffmpegPath.trim().slice(0, 300) || 'ffmpeg';
    }
  }

  if (patch.eventsSync && typeof patch.eventsSync === 'object') {
    const p = patch.eventsSync as Record<string, unknown>;
    if (typeof p.enabled === 'boolean') settings.eventsSync.enabled = p.enabled;
    if (typeof p.lastSynced === 'string') settings.eventsSync.lastSynced = p.lastSynced;
    if (typeof p.status === 'string') settings.eventsSync.status = p.status.slice(0, 40);
    if (typeof p.message === 'string') settings.eventsSync.message = p.message.slice(0, 300);
  }

  if (Array.isArray(patch.events)) {
    settings.events = patch.events
      .filter((e) => e && typeof e.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''))
      .map((e) => ({
        id: typeof e.id === 'string' ? e.id.slice(0, 64) : crypto.randomUUID(),
        name: e.name.trim().slice(0, 120),
        nameEn: typeof e.nameEn === 'string' ? e.nameEn.trim().slice(0, 120) : '',
        date: e.date,
        recurring: e.recurring !== false,
        custom: e.custom === true,
        source: typeof e.source === 'string' ? e.source.slice(0, 20) : undefined,
        syncedAt: typeof e.syncedAt === 'string' ? e.syncedAt.slice(0, 40) : undefined
      }));
  }

  if (patch.roster && typeof patch.roster === 'object') {
    const r = patch.roster as Record<string, unknown>;
    for (const day of Object.keys(settings.roster)) {
      const entry = r[day];
      if (entry && typeof entry === 'object') {
        const e = entry as Record<string, unknown>;
        settings.roster[day as Weekday].imam = String(e.imam || '').trim().slice(0, 120);
        settings.roster[day as Weekday].bilal = String(e.bilal || '').trim().slice(0, 120);
      }
    }
  }

  if (Array.isArray(patch.streams)) {
    const validTypes: StreamType[] = ['rtsp', 'rtmp', 'onvif', 'hls', 'youtube', 'webrtc'];
    settings.streams = patch.streams
      .filter((s) => s && typeof s.name === 'string' && validTypes.includes(s.type as StreamType) && isSafeStreamUrl(s.url, s.type as StreamType))
      .map((s) => ({
        // ID hanya aksara selamat laluan fail (elak path traversal dalam
        // laluan relay/<id>/ HLS).
        id: typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) ? s.id : crypto.randomUUID(),
        name: s.name.trim().slice(0, 120),
        type: s.type as StreamType,
        url: String(s.url || '').trim().slice(0, 1000),
        duration: clampNum(s.duration, 10, 600, 30),
        enabled: s.enabled !== false
      }));
  }

  if (patch.hijriOffset !== undefined) {
    settings.hijriOffset = clampNum(patch.hijriOffset, -2, 2, settings.hijriOffset);
  }

  return settings;
}

type PrayerKeyIndex = keyof Settings['prayer']['iqamah'];

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  mosque: { name: 'Masjid Al-Hidayah', tagline: 'Jom Ke Masjid', address: 'Kuala Lumpur, Malaysia', logo: '' },
  location: { latitude: 3.139, longitude: 101.6869, name: 'Kuala Lumpur' },
  prayer: {
    method: 'JAKIM', source: 'jakim', zone: 'WLY01', timezone: 'Asia/Kuala_Lumpur',
    adjustments: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
    showImsak: true, imsakOffset: 10, showSunrise: true,
    azanLeadMinutes: 5, iqamahOffsetMinutes: 10, jemaahDurationMinutes: 15,
    afterIqamah: 'jemaah',
    iqamah: { fajr: '', dhuhr: '', asr: '', maghrib: '', isha: '' }
  },
  display: {
    language: 'ms', theme: 'dark', headingFont: 'sans', slideshowInterval: 12,
    showTicker: true, showWeather: true, clockFormat: '24h', showSeconds: true,
    tickerSpeed: 'normal', safeMargin: 2, mediaFit: 'stretch', tickerCustom: '',
    colors: { bgTop: '#06101f', bgBottom: '#0a1a2f', text: '#f3f6fb', muted: '#8fa4bd', gold: '#e0bc6a', teal: '#62d9c6' },
    backgroundImage: '', backgroundOpacity: 0,
    testMode: { enabled: false, date: '', time: '', runFullTest: false, startDelaySec: 10, prayerKey: 'maghrib', savedAtMs: 0, phaseMs: 60000 },
    staticBanner: { enabled: false, title: '', message: '', image: '' },
    fridayKhutbahUntil: '13:55'
  },
  weather: { enabled: true, unit: 'c' },
  audio: { enabled: true, adhanUrl: '', iqamahUrl: '' },
  media: { ffmpegPath: 'ffmpeg' },
  eventsSync: { enabled: true, lastSynced: null, status: 'idle', message: '' },
  // Tarikh rujukan takwim Malaysia (anggaran). Sila sahkan dengan JAKIM
  // setiap tahun. Auto-sync JAKIM mengemas kini selepas boot pertama.
  events: [
    { id: 'evt-maulid-2026', name: 'Maulidur Rasul', nameEn: 'Mawlid al-Nabi', date: '2026-09-25', recurring: true },
    { id: 'evt-ramadan-2027', name: 'Awal Ramadan', nameEn: 'Start of Ramadan', date: '2027-02-08', recurring: true },
    { id: 'evt-nuzul-2027', name: 'Nuzul Al-Quran', nameEn: 'Revelation of the Quran', date: '2027-02-24', recurring: true },
    { id: 'evt-fitri-2027', name: 'Hari Raya Aidilfitri', nameEn: 'Eid al-Fitr', date: '2027-03-09', recurring: true },
    { id: 'evt-arafah-2027', name: 'Hari Arafah', nameEn: 'Day of Arafah', date: '2027-05-16', recurring: true },
    { id: 'evt-adha-2027', name: 'Hari Raya Aidiladha', nameEn: 'Eid al-Adha', date: '2027-05-17', recurring: true },
    { id: 'evt-muharam-2027', name: 'Awal Muharam', nameEn: 'Islamic New Year', date: '2027-06-06', recurring: true }
  ],
  roster: Object.fromEntries(WEEKDAYS.map((d) => [d, { imam: '', bilal: '' }])) as Settings['roster'],
  streams: [],
  hijriOffset: 0,
  createdAt: null
};
