// Shared API payload builders — single source of truth for local server and
// cloud (eliminates the duplicated publicSettings / publicStream / /api/today
// projections that previously drifted between the two apps).

import type { Settings, Stream, StreamType } from './types.js';
import { getDay, nextPrayer, dateKeyInZone, zonedDateTime, formatTime } from './prayers.js';
import { hijriText } from './jakim.js';
import type { PrayerDay } from './types.js';

export const RELAY_TYPES: ReadonlySet<StreamType> = new Set<StreamType>(['rtsp', 'rtmp', 'onvif']);

export function isRelayType(type: StreamType): boolean {
  return RELAY_TYPES.has(type);
}

export function parseYouTubeId(url: string): string | null {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export function publicStream(s: Stream): Record<string, unknown> {
  const base = { id: s.id, name: s.name, type: s.type, enabled: s.enabled, duration: s.duration };
  if (isRelayType(s.type)) {
    // url diperlukan oleh app Android TV (ExoPlayer native RTSP/RTMP);
    // paparan bukan-Android guna hlsUrl relay tempatan.
    return { ...base, kind: 'relay', url: s.url, hlsUrl: `/relay/${s.id}/index.m3u8` };
  }
  if (s.type === 'hls') return { ...base, kind: 'hls', url: s.url };
  if (s.type === 'youtube') {
    return { ...base, kind: 'youtube', youtubeId: parseYouTubeId(s.url), url: s.url };
  }
  return { ...base, kind: 'embed', url: s.url };
}

// Public (display) settings projection. The local server includes
// `eventsSync` (reference server behavior); the cloud omits it (reference
// cloud behavior) — controlled by includeEventsSync.
// NOTA KESELAMATAN: `media` (laluan ffmpeg internal) dan URL mentah stream
// (kredensial RTSP) TIDAK didedahkan — hanya projetksi publicStream().
export function publicSettings(s: Settings, opts: { includeEventsSync?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mosque: s.mosque,
    prayer: {
      method: s.prayer.method,
      source: s.prayer.source,
      zone: s.prayer.zone,
      timezone: s.prayer.timezone,
      showImsak: s.prayer.showImsak,
      imsakOffset: s.prayer.imsakOffset,
      showSunrise: s.prayer.showSunrise,
      azanLeadMinutes: s.prayer.azanLeadMinutes,
      iqamahOffsetMinutes: s.prayer.iqamahOffsetMinutes,
      jemaahDurationMinutes: s.prayer.jemaahDurationMinutes,
      afterIqamah: s.prayer.afterIqamah,
      iqamah: s.prayer.iqamah
    },
    display: s.display,
    weather: s.weather,
    audio: s.audio,
    hijriOffset: s.hijriOffset,
    events: s.events,
    roster: s.roster,
    streams: (s.streams || []).map(publicStream)
  };
  if (opts.includeEventsSync) out.eventsSync = s.eventsSync;
  return out;
}

export interface TodayPayload {
  now: string;
  today: string;
  timeZone: string;
  source: PrayerDay['source'];
  hijri: (NonNullable<PrayerDay['hijri']> & { text: string | null }) | null;
  zone: PrayerDay['zone'];
  prayers: PrayerDay['times'];
  iqamah: Record<string, { time: string; ms: number }>;
  next: ReturnType<typeof nextPrayer>;
}

// Build the /api/today response body — identical math for local and cloud.
export async function buildTodayPayload(settings: Settings, now = new Date()): Promise<TodayPayload> {
  const tz = settings.prayer.timezone || 'Asia/Kuala_Lumpur';
  const todayKey = dateKeyInZone(now, tz);
  const tomorrowKey = dateKeyInZone(new Date(now.getTime() + 86400000), tz);

  const [today, tomorrowDay] = await Promise.all([getDay(todayKey, settings), getDay(tomorrowKey, settings)]);
  const next = nextPrayer(today, tomorrowDay, now, settings);

  const iqamah: Record<string, { time: string; ms: number }> = {};
  for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
    const azan = today.times[key];
    if (!azan) continue;
    const explicit = (settings.prayer.iqamah || {})[key];
    const iqDate = explicit
      ? zonedDateTime(todayKey, explicit, tz)
      : new Date(azan.ms + (settings.prayer.iqamahOffsetMinutes || 10) * 60000);
    iqamah[key] = { time: formatTime(iqDate, tz), ms: iqDate.getTime() };
  }

  return {
    now: now.toISOString(),
    today: todayKey,
    timeZone: today.timeZone,
    source: today.source,
    hijri: today.hijri ? { ...today.hijri, text: hijriText(today.hijri) } : null,
    zone: today.zone || null,
    prayers: today.times,
    iqamah,
    next
  };
}
