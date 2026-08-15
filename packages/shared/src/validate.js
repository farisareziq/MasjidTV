// Port logik validasi tetapan daripada server/config.js (kekal sama untuk pariti).
import crypto from 'node:crypto';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function clampNum(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
// Sekatan SSRF untuk URL stream: skema mesti sepadan jenis, host dinyahkod
// kepada IP dan ditolak jika loopback/link-local/metadata cloud. Rangkaian
// peribadi LAN (cth 192.168.x.x kamera) kekal dibenarkan.
export function isSafeStreamUrl(url, type) {
    const s = String(url || '').trim();
    if (!s)
        return true; // URL kosong dibenarkan (belum diisi)
    let parsed;
    try {
        parsed = new URL(s);
    }
    catch {
        return false;
    }
    const scheme = parsed.protocol.replace(':', '');
    const allowed = {
        rtsp: ['rtsp'], rtmp: ['rtmp'], onvif: ['rtsp', 'http', 'https'],
        hls: ['http', 'https'], youtube: ['http', 'https'], webrtc: ['http', 'https']
    };
    if (!allowed[type] || !allowed[type].includes(scheme))
        return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    // Nama metadada cloud (boleh jadi bukan IP literal).
    if (['localhost', 'metadata.google.internal'].includes(host))
        return false;
    // Nyahkod semua encoding IP (perpuluhan/heks/oktal IPv4, IPv6 termasuk
    // ::ffff: mapped) — blocklist string mudah dilangkau.
    const ip = parseIpLiteral(host);
    if (ip) {
        if (isBlockedIp(ip))
            return false;
    }
    return true;
}
// Parse hostname kepada IPv4/IPv6 literal; menyokong bentuk bukan bertitik.
function parseIpLiteral(host) {
    // IPv6 murni/mapped (contoh ::1, ::ffff:127.0.0.1)
    if (host.includes(':')) {
        return normalizeIpv6(host);
    }
    // IPv4 bertitik
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host))
        return host;
    // IPv4 satu-integer / heks / oktal (contoh 2130706433, 0x7f000001)
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
        const n = host.startsWith('0x') || host.startsWith('0X')
            ? parseInt(host, 16)
            : /^\d+$/.test(host) ? Number(host) : NaN;
        if (!Number.isFinite(n) || n < 0 || n > 0xffffffff)
            return null;
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
    return null;
}
function normalizeIpv6(host) {
    // Bentuk ::ffff:a.b.c.d — pokok kepada IPv4 untuk semakan.
    const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped)
        return mapped[1];
    return host; // IPv6 lain — semakan rentetan di bawah
}
function isBlockedIp(ip) {
    // Loopback IPv4/IPv6
    if (ip === '127.0.0.1' || ip.startsWith('127.') || ip === '0.0.0.0' || ip === '::1')
        return true;
    // Link-local 169.254.0.0/16 (termasuk metadata cloud) dan 100.100.100.200
    if (/^169\.254\./.test(ip) || ip === '100.100.100.200')
        return true;
    // Link-local IPv6 fe80::/10
    if (/^fe[89ab][0-9a-f]?:/i.test(ip))
        return true;
    return false;
}
export function applyPatch(current, patch) {
    const settings = JSON.parse(JSON.stringify(current));
    if (!patch || typeof patch !== 'object')
        return settings;
    if (patch.mosque && typeof patch.mosque === 'object') {
        const m = settings.mosque;
        const p = patch.mosque;
        if (typeof p.name === 'string')
            m.name = p.name.trim().slice(0, 120) || m.name;
        if (typeof p.tagline === 'string')
            m.tagline = p.tagline.trim().slice(0, 120);
        if (typeof p.address === 'string')
            m.address = p.address.trim().slice(0, 200);
        if (typeof p.logo === 'string')
            m.logo = p.logo.trim().slice(0, 300);
    }
    if (patch.location && typeof patch.location === 'object') {
        const l = settings.location;
        const p = patch.location;
        if (p.latitude !== undefined)
            l.latitude = clampNum(p.latitude, -90, 90, l.latitude);
        if (p.longitude !== undefined)
            l.longitude = clampNum(p.longitude, -180, 180, l.longitude);
        if (typeof p.name === 'string')
            l.name = p.name.trim().slice(0, 120);
    }
    if (patch.prayer && typeof patch.prayer === 'object') {
        const pr = settings.prayer;
        const p = patch.prayer;
        if (typeof p.method === 'string')
            pr.method = p.method;
        if (p.source === 'jakim' || p.source === 'local')
            pr.source = p.source;
        if (typeof p.zone === 'string' && /^[A-Z]{3}\d{2}$/.test(p.zone))
            pr.zone = p.zone;
        if (typeof p.timezone === 'string' && p.timezone.trim())
            pr.timezone = p.timezone.trim();
        if (p.adjustments && typeof p.adjustments === 'object') {
            const a = p.adjustments;
            for (const key of Object.keys(pr.adjustments)) {
                if (a[key] !== undefined) {
                    pr.adjustments[key] = clampNum(a[key], -120, 120, pr.adjustments[key]);
                }
            }
        }
        if (typeof p.showImsak === 'boolean')
            pr.showImsak = p.showImsak;
        if (p.imsakOffset !== undefined)
            pr.imsakOffset = clampNum(p.imsakOffset, 1, 60, pr.imsakOffset);
        if (typeof p.showSunrise === 'boolean')
            pr.showSunrise = p.showSunrise;
        if (p.azanLeadMinutes !== undefined)
            pr.azanLeadMinutes = clampNum(p.azanLeadMinutes, 1, 60, pr.azanLeadMinutes);
        if (p.iqamahOffsetMinutes !== undefined)
            pr.iqamahOffsetMinutes = clampNum(p.iqamahOffsetMinutes, 1, 60, pr.iqamahOffsetMinutes);
        if (p.jemaahDurationMinutes !== undefined)
            pr.jemaahDurationMinutes = clampNum(p.jemaahDurationMinutes, 1, 120, pr.jemaahDurationMinutes);
        if (p.afterIqamah === 'jemaah' || p.afterIqamah === 'black')
            pr.afterIqamah = p.afterIqamah;
        if (p.iqamah && typeof p.iqamah === 'object') {
            const iq = p.iqamah;
            for (const key of Object.keys(pr.iqamah)) {
                const v = String(iq[key] || '').trim();
                if (v === '')
                    pr.iqamah[key] = '';
                else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
                    pr.iqamah[key] = v;
            }
        }
    }
    if (patch.display && typeof patch.display === 'object') {
        const d = settings.display;
        const p = patch.display;
        if (p.language === 'ms' || p.language === 'en')
            d.language = p.language;
        if (p.theme === 'dark' || p.theme === 'light')
            d.theme = p.theme;
        if (p.headingFont === 'sans' || p.headingFont === 'serif' || p.headingFont === 'classic')
            d.headingFont = p.headingFont;
        if (p.slideshowInterval !== undefined)
            d.slideshowInterval = clampNum(p.slideshowInterval, 5, 300, d.slideshowInterval);
        if (typeof p.showTicker === 'boolean')
            d.showTicker = p.showTicker;
        if (typeof p.showWeather === 'boolean')
            d.showWeather = p.showWeather;
        if (p.clockFormat === '24h' || p.clockFormat === '12h')
            d.clockFormat = p.clockFormat;
        if (typeof p.showSeconds === 'boolean')
            d.showSeconds = p.showSeconds;
        if (p.tickerSpeed === 'slow' || p.tickerSpeed === 'normal' || p.tickerSpeed === 'fast')
            d.tickerSpeed = p.tickerSpeed;
        if (p.safeMargin !== undefined)
            d.safeMargin = clampNum(p.safeMargin, 0, 8, d.safeMargin);
        if (p.mediaFit === 'stretch' || p.mediaFit === 'fit' || p.mediaFit === 'crop')
            d.mediaFit = p.mediaFit;
        if (typeof p.tickerCustom === 'string')
            d.tickerCustom = p.tickerCustom.trim().slice(0, 1000);
        if (p.colors && typeof p.colors === 'object') {
            const c = p.colors;
            const hex = (v, fb) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : fb);
            d.colors.bgTop = hex(c.bgTop, d.colors.bgTop);
            d.colors.bgBottom = hex(c.bgBottom, d.colors.bgBottom);
            d.colors.text = hex(c.text, d.colors.text);
            d.colors.muted = hex(c.muted, d.colors.muted);
            d.colors.gold = hex(c.gold, d.colors.gold);
            d.colors.teal = hex(c.teal, d.colors.teal);
        }
        if (typeof p.backgroundImage === 'string')
            d.backgroundImage = p.backgroundImage.trim().slice(0, 500);
        if (p.backgroundOpacity !== undefined)
            d.backgroundOpacity = clampNum(p.backgroundOpacity, 0, 100, d.backgroundOpacity);
        if (p.testMode && typeof p.testMode === 'object') {
            const tm = p.testMode;
            if (typeof tm.enabled === 'boolean')
                d.testMode.enabled = tm.enabled;
            if (typeof tm.date === 'string')
                d.testMode.date = /^\d{4}-\d{2}-\d{2}$/.test(tm.date) ? tm.date : '';
            if (typeof tm.time === 'string')
                d.testMode.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(tm.time) ? tm.time : '';
        }
        if (p.staticBanner && typeof p.staticBanner === 'object') {
            const sb = d.staticBanner || (d.staticBanner = { enabled: false, title: '', message: '', image: '' });
            const s = p.staticBanner;
            if (typeof s.enabled === 'boolean')
                sb.enabled = s.enabled;
            if (typeof s.title === 'string')
                sb.title = s.title.trim().slice(0, 120);
            if (typeof s.message === 'string')
                sb.message = s.message.trim().slice(0, 300);
            if (typeof s.image === 'string')
                sb.image = s.image.trim().slice(0, 500);
        }
        if (typeof p.fridayKhutbahUntil === 'string' && /^\d{2}:\d{2}$/.test(p.fridayKhutbahUntil)) {
            d.fridayKhutbahUntil = p.fridayKhutbahUntil;
        }
    }
    if (patch.weather && typeof patch.weather === 'object') {
        const p = patch.weather;
        if (typeof p.enabled === 'boolean')
            settings.weather.enabled = p.enabled;
        if (p.unit === 'c' || p.unit === 'f')
            settings.weather.unit = p.unit;
    }
    if (patch.audio && typeof patch.audio === 'object') {
        const p = patch.audio;
        if (typeof p.enabled === 'boolean')
            settings.audio.enabled = p.enabled;
        if (typeof p.adhanUrl === 'string')
            settings.audio.adhanUrl = p.adhanUrl.trim().slice(0, 500);
        if (typeof p.iqamahUrl === 'string')
            settings.audio.iqamahUrl = p.iqamahUrl.trim().slice(0, 500);
    }
    if (patch.media && typeof patch.media === 'object') {
        const p = patch.media;
        if (typeof p.ffmpegPath === 'string') {
            settings.media.ffmpegPath = p.ffmpegPath.trim().slice(0, 300) || 'ffmpeg';
        }
    }
    if (patch.eventsSync && typeof patch.eventsSync === 'object') {
        const p = patch.eventsSync;
        if (typeof p.enabled === 'boolean')
            settings.eventsSync.enabled = p.enabled;
        if (typeof p.lastSynced === 'string')
            settings.eventsSync.lastSynced = p.lastSynced;
        if (typeof p.status === 'string')
            settings.eventsSync.status = p.status.slice(0, 40);
        if (typeof p.message === 'string')
            settings.eventsSync.message = p.message.slice(0, 300);
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
        const r = patch.roster;
        for (const day of Object.keys(settings.roster)) {
            const entry = r[day];
            if (entry && typeof entry === 'object') {
                const e = entry;
                settings.roster[day].imam = String(e.imam || '').trim().slice(0, 120);
                settings.roster[day].bilal = String(e.bilal || '').trim().slice(0, 120);
            }
        }
    }
    if (Array.isArray(patch.streams)) {
        const validTypes = ['rtsp', 'rtmp', 'onvif', 'hls', 'youtube', 'webrtc'];
        settings.streams = patch.streams
            .filter((s) => s && typeof s.name === 'string' && validTypes.includes(s.type) && isSafeStreamUrl(s.url, s.type))
            .map((s) => ({
            // ID hanya aksara selamat laluan fail (elak path traversal dalam
            // laluan relay/<id>/ HLS).
            id: typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s.id) ? s.id : crypto.randomUUID(),
            name: s.name.trim().slice(0, 120),
            type: s.type,
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
export const DEFAULT_SETTINGS = {
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
        testMode: { enabled: false, date: '', time: '' },
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
    roster: Object.fromEntries(WEEKDAYS.map((d) => [d, { imam: '', bilal: '' }])),
    streams: [],
    hijriOffset: 0,
    createdAt: null
};
//# sourceMappingURL=validate.js.map