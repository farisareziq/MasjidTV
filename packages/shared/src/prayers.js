import * as adhan from 'adhan';
import { getEntryForDate } from './jakim.js';
import { getZone } from './zones.js';
import { hijriForDateKey } from './hijri.js';
import { PRAYER_KEYS, PRAYER_ORDER } from './types.js';
export const METHODS = {
    JAKIM: { label: 'JAKIM — Malaysia', fajrAngle: 20, ishaAngle: 18 },
    KEMENAG: { label: 'Kemenag — Indonesia', fajrAngle: 20, ishaAngle: 18 },
    MUIS: { label: 'MUIS — Singapore', fajrAngle: 20, ishaAngle: 18 },
    MWL: { label: 'Muslim World League', fajrAngle: 18, ishaAngle: 17 },
    EGYPT: { label: 'Egyptian General Authority', fajrAngle: 19.5, ishaAngle: 17.5 },
    KARACHI: { label: 'University of Karachi', fajrAngle: 18, ishaAngle: 18 },
    UMM_AL_QURA: { label: 'Umm Al-Qura (Makkah)', fajrAngle: 18.5, ishaAngle: 0, ishaInterval: 90 },
    DUBAI: { label: 'Dubai', fajrAngle: 18.2, ishaAngle: 18.2 },
    QATAR: { label: 'Qatar', fajrAngle: 18, ishaAngle: 0, ishaInterval: 90 },
    KUWAIT: { label: 'Kuwait', fajrAngle: 18, ishaAngle: 17.5 },
    MOON: { label: 'Moonsighting Committee', fajrAngle: 18, ishaAngle: 18 },
    TURKEY: { label: 'Diyanet — Türkiye', fajrAngle: 18, ishaAngle: 17 },
    NORTH_AMERICA: { label: 'ISNA — North America', fajrAngle: 15, ishaAngle: 15 }
};
function makeParams(methodKey) {
    const m = METHODS[methodKey] || METHODS.JAKIM;
    const params = adhan.CalculationMethod.Other();
    params.fajrAngle = m.fajrAngle;
    params.ishaAngle = m.ishaAngle;
    if (typeof m.ishaInterval === 'number')
        params.ishaInterval = m.ishaInterval;
    params.madhab = adhan.Madhab.Shafi;
    params.highLatitudeRule = adhan.HighLatitudeRule.TwilightAngle;
    return params;
}
// Intl.DateTimeFormat mahal untuk dibina — memo mengikut kunci pilihan.
// Laluan /api/today membina ~60 formatter setiap panggilan tanpa memo ini.
const FMT_CACHE = new Map();
function cachedFormatter(key, make) {
    let f = FMT_CACHE.get(key);
    if (!f) {
        f = make();
        FMT_CACHE.set(key, f);
    }
    return f;
}
export function dateKeyInZone(date, timeZone) {
    const tz = timeZone || 'Asia/Kuala_Lumpur';
    return cachedFormatter(`dk:${tz}`, () => new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit'
    })).format(date);
}
function partsOf(date, timeZone) {
    const fmt = cachedFormatter(`parts:${timeZone}`, () => new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }));
    const out = {};
    for (const p of fmt.formatToParts(date)) {
        if (p.type !== 'literal')
            out[p.type] = p.value;
    }
    return out;
}
function tzOffsetMinutes(epochMs, timeZone) {
    const p = partsOf(new Date(epochMs), timeZone);
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return (asUTC - epochMs) / 60000;
}
export function formatTime(date, timeZone) {
    const p = partsOf(date, timeZone);
    return `${p.hour}:${p.minute}`;
}
// Bina Date yang waktu dindingnya dalam `timeZone` = HH:MM pada tarikh sivil itu.
export function zonedDateTime(dateKey, hhmm, timeZone) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    const asSystem = new Date(y, m - 1, d, h, mi, 0, 0);
    const sysOffset = -asSystem.getTimezoneOffset();
    const tgtOffset = tzOffsetMinutes(asSystem.getTime(), timeZone);
    return new Date(asSystem.getTime() - (tgtOffset - sysOffset) * 60000);
}
function computeLocal(dateKey, settings) {
    const tz = settings.prayer.timezone || 'Asia/Kuala_Lumpur';
    const [y, m, d] = dateKey.split('-').map(Number);
    // Guna tarikh UTC supaya komponen tarikh sivil konsisten tanpa mengira
    // timezone server (Vercel = UTC). Waktu akhir dibina semula dalam tz masjid.
    const date = new Date(Date.UTC(y, m - 1, d));
    const coords = new adhan.Coordinates(+settings.location.latitude, +settings.location.longitude);
    const t = new adhan.PrayerTimes(coords, date, makeParams(settings.prayer.method));
    const adj = settings.prayer.adjustments || {};
    const build = (dt, deltaMin) => {
        // Waktu dinding dalam timezone masjid - konsisten walau server UTC.
        const hhmm = formatTime(dt, tz);
        return new Date(zonedDateTime(dateKey, hhmm, tz).getTime() + (Number(deltaMin) || 0) * 60000);
    };
    const times = {
        fajr: build(t.fajr, adj.fajr),
        sunrise: build(t.sunrise, adj.sunrise),
        dhuhr: build(t.dhuhr, adj.dhuhr),
        asr: build(t.asr, adj.asr),
        maghrib: build(t.maghrib, adj.maghrib),
        isha: build(t.isha, adj.isha)
    };
    if (settings.prayer.showImsak) {
        times.imsak = new Date(times.fajr.getTime() - (Number(settings.prayer.imsakOffset) || 10) * 60000);
    }
    return { times, timeZone: tz };
}
function toPayload(dateObj, timeZone) {
    return {
        time: formatTime(dateObj, timeZone),
        iso: dateObj.toISOString(),
        ms: dateObj.getTime()
    };
}
async function getDayJakim(dateKey, settings) {
    const tz = settings.prayer.timezone || 'Asia/Kuala_Lumpur';
    const zone = settings.prayer.zone;
    const entry = await getEntryForDate(zone, dateKey);
    if (!entry)
        return null;
    const z = getZone(zone);
    const times = {};
    const put = (key, hhmm) => {
        if (hhmm)
            times[key] = zonedDateTime(dateKey, hhmm, tz);
    };
    put('imsak', entry.times.imsak);
    put('fajr', entry.times.fajr);
    put('sunrise', entry.times.syuruk);
    put('dhuhr', entry.times.dhuhr);
    put('asr', entry.times.asr);
    put('maghrib', entry.times.maghrib);
    put('isha', entry.times.isha);
    return {
        times,
        timeZone: tz,
        source: 'jakim',
        hijri: entry.hijri,
        zone: z ? { code: z.zone, negeri: z.negeri, label: z.label } : { code: zone, negeri: '', label: zone }
    };
}
export async function getDay(dateKey, settings) {
    const tz = settings.prayer.timezone || 'Asia/Kuala_Lumpur';
    const local = computeLocal(dateKey, settings);
    let day = null;
    if (settings.prayer.source === 'jakim') {
        try {
            day = await getDayJakim(dateKey, settings);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[prayers] JAKIM gagal untuk ${dateKey}: ${message}`);
            day = null;
        }
    }
    if (!day) {
        day = {
            times: local.times,
            timeZone: tz,
            source: 'local',
            hijri: null,
            zone: null
        };
    }
    // Pastikan hijri sentiasa ada: guna JAKIM jika ada, selain itu fallback
    // tabular (dengan pelarasan pentadbir) supaya paparan tidak rosak.
    if (!day.hijri) {
        day.hijri = hijriForDateKey(dateKey, settings.hijriOffset);
    }
    const payload = {};
    for (const key of PRAYER_KEYS) {
        if (day.times[key])
            payload[key] = toPayload(day.times[key], tz);
    }
    if (day.times.imsak)
        payload.imsak = toPayload(day.times.imsak, tz);
    return {
        dateKey,
        timeZone: day.timeZone,
        source: day.source,
        hijri: day.hijri,
        zone: day.zone,
        times: payload
    };
}
export function nextPrayer(todayDay, tomorrowDay, now, settings) {
    const tz = settings.prayer.timezone || 'Asia/Kuala_Lumpur';
    const candidates = [];
    for (const key of PRAYER_ORDER) {
        if (todayDay.times[key]) {
            candidates.push({ key, time: todayDay.times[key], tomorrow: false });
        }
    }
    if (tomorrowDay.times.fajr) {
        candidates.push({ key: 'fajr', time: tomorrowDay.times.fajr, tomorrow: true });
    }
    const upcoming = candidates.filter((c) => c.time.ms > now.getTime());
    if (!upcoming.length)
        return null;
    const next = upcoming[0];
    const iqamahSetting = (settings.prayer.iqamah || {})[next.key];
    let iqamah = null;
    if (iqamahSetting) {
        const dateKey = next.tomorrow ? tomorrowDay.dateKey : todayDay.dateKey;
        const iqDate = zonedDateTime(dateKey, iqamahSetting, tz);
        if (iqDate.getTime() > now.getTime()) {
            iqamah = toPayload(iqDate, tz);
        }
    }
    else if (settings.prayer.iqamahOffsetMinutes) {
        const iqMs = next.time.ms + (settings.prayer.iqamahOffsetMinutes || 10) * 60000;
        iqamah = toPayload(new Date(iqMs), tz);
    }
    return { key: next.key, tomorrow: next.tomorrow, time: next.time, iqamah };
}
//# sourceMappingURL=prayers.js.map