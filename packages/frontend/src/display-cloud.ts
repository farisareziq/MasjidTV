'use strict';

// Module scope (bukan skrip global) — setiap halaman memuatkan satu fail sahaja.

// ------------------------------------------------------------- jenis domain
// Nota: jenis diimport daripada teras domain @masjidtv/shared (jenis sahaja,
// dipadam semasa kompil — kelakuan runtime kekal serupa dengan baseline JS).
import type {
  Settings, Stream, Announcement, TodayPayload, PrayerTimePayload,
  EventPayload, Language, TickerSpeed, HeadingFont, MediaFit, DisplayColors,
  StaticBannerSettings, TestModeSettings
} from '@masjidtv/shared';
import type { BuiltinContentItem } from '@masjidtv/shared';

type PublicStream = { id?: string; name?: string; kind?: string; url?: string; hlsUrl?: string; youtubeId?: string | null; duration?: number; enabled?: boolean } & Record<string, unknown>;
type SlideData = { announcements: Announcement[]; builtin: BuiltinContentItem[] };

interface PrayerEventEntry { key: string; azan: number; iqamah: number; tomorrow: boolean }
interface ActivePrayerEvent extends PrayerEventEntry { lead: number; off: number; jDur: number; end: number }
interface WeatherResponse { current?: { weather_code?: number; temperature_2m?: number } }

interface Slide {
  kind: string;
  category?: string;
  title?: string | null;
  message?: string | null;
  arabic?: string | null;
  ref?: string | null;
  translation?: string;
  image?: string | null;
  video?: string | null;
  stream?: PublicStream;
}

interface DisplayState {
  settings: (Record<string, any> & Partial<Settings>) | null;
  today: TodayPayload | null;
  slides: Slide[];
  slidesData: SlideData | null;
  slideIndex: number;
  slideTimer: ReturnType<typeof setTimeout> | null;
  videoGuardTimer: ReturnType<typeof setTimeout> | null;
  hls: { destroy(): void } | null;
  audioCache: Map<string, HTMLAudioElement>;
  playedAdhan: Set<string>;
  playedIqamah: Set<string>;
  pendingAudio: { key: string; url: string; targetMs: number } | null;
  weatherTimer: ReturnType<typeof setTimeout> | null;
}

declare const Hls: any;
// Adapter AndroidBridge dua mod (sepadan display.ts):
// 1. Kaedah terus (rujukan Kotlin addJavascriptInterface): setStreamSlot(...) dll.
// 2. postMessage (Flutter webview_flutter addJavaScriptChannel): hantar
//    {"method":"...","args":[...]} melalui AndroidBridge.postMessage().
const AndroidBridgeRef = (): AndroidBridge => {
  const raw = (window as any).AndroidBridge;
  if (!raw) return raw;
  if (typeof raw.setStreamSlot === 'function') return raw; // mod native penuh
  const send = (method: string) => (...args: unknown[]) => {
    raw.postMessage(JSON.stringify({ method, args }));
  };
  return {
    setStreamSlot: send('setStreamSlot'),
    playStream: send('playStream'),
    stopStream: send('stopStream'),
    setStreamMuted: send('setStreamMuted'),
    playAudio: send('playAudio'),
    stopAudio: send('stopAudio'),
    onSessionExpired: send('onSessionExpired')
  };
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const I18N: Record<Language, {
  prayerTimes: string; prayerTimesAr: string; nextPrayer: string; adhan: string; iqamah: string;
  tomorrow: string; info: string; source: string; api: string; local: string; imam: string;
  bilal: string; dutyTitle: string; kutipanTitle: string; eventTitle: string; daysLeft: string;
  today: string; kutipan: string; live: string; streamOffline: string; jemaah: string;
  fridayName: string; fridayJemaah: string; welcome: string;
  names: Record<string, string>;
  namesAr: Record<string, string>;
  weather: Record<number, string>;
}> = {
  ms: {
    prayerTimes: 'Waktu Solat',
    prayerTimesAr: 'اَلْأَوْقَات',
    nextPrayer: 'Solat Seterusnya',
    adhan: 'Azan',
    iqamah: 'Iqamah',
    tomorrow: 'Esok',
    info: 'MAKLUMAT',
    source: 'Sumber',
    api: 'JAKIM / Aladhan',
    local: 'Pengiraan Tempatan',
    imam: 'Imam',
    bilal: 'Bilal',
    dutyTitle: 'Bertugas Hari Ini',
    kutipanTitle: 'Kutipan',
    eventTitle: 'Hari Kebesaran',
    daysLeft: '{n} hari lagi',
    today: 'Hari ini',
    kutipan: 'Kutipan',
    live: 'LIVE',
    streamOffline: 'Stream tidak tersedia',
    jemaah: 'Solat Jemaah',
    fridayName: 'Jumaat',
    fridayJemaah: 'Khutbah & Solat Jumaat',
    welcome: 'Selamat datang ke masjid. Jom hidupkan masjid bersama-sama!',
    names: {
      imsak: 'Imsak', fajr: 'Subuh', sunrise: 'Syuruk', dhuhr: 'Zohor',
      asr: 'Asar', maghrib: 'Maghrib', isha: 'Isyak'
    },
    namesAr: {
      imsak: 'إِمْسَاك', fajr: 'صُبْح', sunrise: 'شُرُوق', dhuhr: 'ظُهْر',
      asr: 'عَصْر', maghrib: 'مَغْرِب', isha: 'عِشَاء'
    },
    weather: {
      0: 'Cerah', 1: 'Cerah', 2: 'Separa Berawan', 3: 'Mendung',
      45: 'Berkabus', 48: 'Berkabus', 51: 'Hujan Renyai', 53: 'Hujan Renyai',
      55: 'Hujan Renyai', 61: 'Hujan', 63: 'Hujan', 65: 'Hujan Lebat',
      66: 'Hujan Ais', 67: 'Hujan Ais', 71: 'Salji', 73: 'Salji', 75: 'Salji Lebat',
      80: 'Hujan Ribut', 81: 'Hujan Ribut', 82: 'Hujan Ribut', 95: 'Ribut Petir',
      96: 'Ribut Petir', 99: 'Ribut Petir'
    }
  },
  en: {
    prayerTimes: 'Prayer Times',
    prayerTimesAr: 'اَلْأَوْقَات',
    nextPrayer: 'Next Prayer',
    adhan: 'Adhan',
    iqamah: 'Iqamah',
    tomorrow: 'Tomorrow',
    info: 'INFO',
    source: 'Source',
    api: 'JAKIM / Aladhan',
    local: 'Local Calculation',
    imam: 'Imam',
    bilal: 'Bilal',
    dutyTitle: "Today's Duty",
    kutipanTitle: 'Collection',
    eventTitle: 'Islamic Events',
    daysLeft: '{n} days left',
    today: 'Today',
    kutipan: 'Collection',
    live: 'LIVE',
    streamOffline: 'Stream unavailable',
    jemaah: 'Congregational Prayer',
    fridayName: "Jumu'ah",
    fridayJemaah: 'Khutbah & Friday Prayer',
    welcome: 'Welcome to the mosque. Let us bring the mosque to life together!',
    names: {
      imsak: 'Imsak', fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr',
      asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha'
    },
    namesAr: {
      imsak: 'إِمْسَاك', fajr: 'صُبْح', sunrise: 'شُرُوق', dhuhr: 'ظُهْر',
      asr: 'عَصْر', maghrib: 'مَغْرِب', isha: 'عِشَاء'
    },
    weather: {
      0: 'Clear', 1: 'Clear', 2: 'Partly Cloudy', 3: 'Overcast',
      45: 'Foggy', 48: 'Foggy', 51: 'Drizzle', 53: 'Drizzle',
      55: 'Drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy Rain',
      66: 'Freezing Rain', 67: 'Freezing Rain', 71: 'Snow', 73: 'Snow', 75: 'Heavy Snow',
      80: 'Rain Showers', 81: 'Rain Showers', 82: 'Rain Showers', 95: 'Thunderstorm',
      96: 'Thunderstorm', 99: 'Thunderstorm'
    }
  }
};

const WEATHER_ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '🌧️', 95: '⛈️', 96: '⛈️', 99: '⛈️'
};

const state: DisplayState = {
  settings: null,
  today: null,
  slides: [],
  slidesData: null,
  slideIndex: 0,
  slideTimer: null,
  videoGuardTimer: null,
  hls: null,
  audioCache: new Map(),
  playedAdhan: new Set(),
  playedIqamah: new Set(),
  pendingAudio: null,
  weatherTimer: null
};

const screenName = new URLSearchParams(location.search).get('screen') || '';
const debugMode = new URLSearchParams(location.search).get('debug') === '1';
// Domain khas (mis. tvdisplay.masjidlabis.my): server suntik key melalui
// <meta name="tvm-key"> tanpa skrip inline (CSP ketat). Baca meta dan kemas
// kini URL supaya paparan berfungsi seperti URL berkey biasa.
const metaKey = document.querySelector('meta[name="tvm-key"]')?.getAttribute('content');
if (!new URLSearchParams(location.search).get('key') && !new URLSearchParams(location.search).get('token') && metaKey) {
  const qs = new URLSearchParams(location.search);
  qs.set('key', metaKey as string);
  history.replaceState(null, '', `/display?${qs.toString()}`);
}
const tz = (): string => (state.settings?.prayer?.timezone) || 'Asia/Kuala_Lumpur';
const lang = (): Language => (state.settings?.display?.language) || 'ms';
const t = (key: string): string => (I18N[lang()] as Record<string, any>)[key] ?? key;
// Mod Android TV (app hibrid): bridge untuk stream RTSP/RTMP & mute audio azan.
const isAndroid = typeof window !== 'undefined' && typeof window.AndroidBridge !== 'undefined';
let bridgeMuted = false;
let sessionInvalidNotified = false;
// Deteksi keupayaan playAudio native (APK baharu): hantar probe dan tunggu
// jangka pendek — mod postMessage tidak kembali ralat walau APK lama tidak
// mempunyai kaedah ini. Tanpa pengesahan, audio azan pada APK lama akan
// hilang senyap (kunci ditanda "dimainkan" tetapi tiada bunyi).
let nativeAudioCapable = false;
if (isAndroid) {
  try {
    AndroidBridgeRef().playAudio('', 'probe:');
    nativeAudioCapable = true;
  } catch { /* APK lama tanpa playAudio — kekal fallback HTMLAudioElement */ }
}

// Hari Jumaat: Zohor dipaparkan sebagai "Jumaat" dan fasa jemaah menjadi
// "Khutbah & Solat Jumaat". Countdown azan/iqamah kekal seperti biasa.
const isFriday = (): boolean => {
  const tm = testMode();
  const dk = tm.enabled && tm.date ? tm.date : state.today?.today;
  if (!dk) return false;
  // Kira hari dalam timezone masjid (bukan timezone peranti) — konsisten
  // dengan renderSideCards yang guna Intl dengan tz().
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz(), weekday: 'short' }).format(zonedMs(dk, '12:00', tz())) === 'Fri';
  } catch {
    return new Date(`${dk}T00:00:00`).getDay() === 5;
  }
};
const prayerLabel = (key: string): string => (key === 'dhuhr' && isFriday() ? t('fridayName') : (((t('names') as unknown) as Record<string, string>)[key] || key));

// Tamat paparan "Khutbah & Solat Jumaat" (lalai 13:55) — kekal statik sehingga itu.
const fridayJemaahEndMs = (): number | null => {
  const until = state.settings?.display?.fridayKhutbahUntil || '13:55';
  if (!/^\d{2}:\d{2}$/.test(until)) return null;
  const tm = testMode();
  const dk = tm.enabled && tm.date ? tm.date : state.today?.today;
  return dk ? zonedMs(dk, until, tz()) : null;
};

function notifySessionInvalid(): void {
  if (sessionInvalidNotified) return;
  sessionInvalidNotified = true;
  if (isAndroid) {
    try { AndroidBridgeRef().onSessionExpired(); } catch {}
  }
}

// Paparan yang dimuatkan sebelum ini (mis. kiosk / Android TV) mungkin masih
// berjalan tanpa kunci dalam URL -> API 401. Pada domain khas, server kini
// menyuntik key melalui history.replaceState semasa muat semula, jadi muat
// semula sekali (had 5 minit) untuk pulih sendiri tanpa perlu sentuh TV.
function recoverMissingKey(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.get('key') || params.get('token')) return false;
  try {
    const RELOAD_KEY = 'tvm:auto-reload';
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 5 * 60000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* penyimpanan sesi tidak tersedia */ }
  location.reload();
  return true;
}

async function api(url: string): Promise<any> {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  const token = params.get('token');
  // Kunci/token dihantar melalui header, bukan query string (elak kebocoran
  // dalam log/history). Hantar kedua-dua header supaya cloud & server lokal
  // masing-masing guna yang sepadan.
  const headers: Record<string, string> = {};
  if (key) {
    headers['x-tenant-key'] = key;
    headers['x-display-key'] = key;
  }
  if (token) headers['x-device-token'] = token;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// -------------------------------------------------- warna & latar custom

function hexToRgba(hex: string, alpha: number): string {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(255, 255, 255, ${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenHex(hex: string, amt: number): string {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return hex || '#e0bc6a';
  const mix = (v: number) => Math.round(v + (255 - v) * amt);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function applyColors() {
  const c: DisplayColors = state.settings!.display!.colors || ({} as DisplayColors);
  const root = document.documentElement.style;
  const bgTop = c.bgTop || '#06101f';
  const bgBottom = c.bgBottom || '#0a1a2f';
  const text = c.text || '#f3f6fb';
  const muted = c.muted || '#8fa4bd';
  const gold = c.gold || '#e0bc6a';
  const teal = c.teal || '#62d9c6';
  root.setProperty('--bg-0', bgTop);
  root.setProperty('--bg-1', bgBottom);
  root.setProperty('--text', text);
  root.setProperty('--muted', muted);
  root.setProperty('--gold', gold);
  root.setProperty('--gold-bright', lightenHex(gold, 0.32));
  root.setProperty('--teal', teal);
  root.setProperty('--gold-dim', hexToRgba(gold, 0.14));
  root.setProperty('--teal-dim', hexToRgba(teal, 0.12));
  root.setProperty('--border', hexToRgba(text, 0.10));
  root.setProperty('--panel', hexToRgba(text, 0.055));
  root.setProperty('--panel-strong', hexToRgba(text, 0.10));
  root.setProperty('--glow-1', hexToRgba(gold, 0.20));
  root.setProperty('--glow-2', hexToRgba(teal, 0.18));
  const FONT_HEAD: Record<HeadingFont, string> = {
    sans: 'inherit',
    serif: "Georgia, 'Times New Roman', 'Playfair Display', serif",
    classic: "Garamond, 'Palatino Linotype', 'Book Antiqua', serif"
  };
  root.setProperty('--font-head', FONT_HEAD[state.settings.display.headingFont] || 'inherit');
  const img = state.settings.display.backgroundImage || '';
  root.setProperty('--bg-img', img ? `url("${img}")` : 'none');
  root.setProperty('--bg-img-opacity', String((Number(state.settings.display.backgroundOpacity) || 0) / 100));
  const MEDIA_FIT_CSS: Record<MediaFit, string> = { stretch: 'fill', fit: 'contain', crop: 'cover' };
  root.setProperty('--media-fit', MEDIA_FIT_CSS[state.settings.display.mediaFit] || 'fill');
}

// ------------------------------------------------------------------ render

function renderHeader() {
  $('mosqueName').textContent = state.settings.mosque.name;
  $('mosqueMeta').textContent = [state.settings.mosque.tagline, state.settings.mosque.address].filter(Boolean).join(' • ');
  const mark = $('brandMark') as HTMLImageElement;
  if (state.settings.mosque.logo) {
    mark.src = state.settings.mosque.logo;
    mark.classList.add('logo');
  } else {
    mark.src = '/assets/logo.png';
    mark.classList.remove('logo');
  }
  const label = $('screenLabel');
  if (screenName) {
    label.textContent = screenName;
    label.hidden = false;
  }
  document.documentElement.dataset.theme = state.settings.display.theme;
  document.documentElement.lang = lang();
  const safe = Math.max(0, Math.min(8, Number(state.settings.display.safeMargin) || 0));
  document.documentElement.style.setProperty('--safe', `${safe}vw`);
  $('tickerLabel').textContent = t('info');
  $('soundChip').hidden = !state.settings.audio?.enabled || !(state.settings.audio.adhanUrl || state.settings.audio.iqamahUrl);
}

function tickDebug(): void {
  if (!debugMode) return;
  const el = $('debugChip');
  if (!el) return;
  const boxes: string[] = [];
  for (const id of ['brandMark', 'mosqueName', 'clock', 'dateRow']) {
    const node = document.getElementById(id);
    if (node) {
      const r = node.getBoundingClientRect();
      boxes.push(`${id}:${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  // Fasa semasa + baki masa — memudahkan pengesahan aliran ujian azan/iqamah.
  const st = computePrayerPhase();
  const phaseInfo = st.phase === 'normal' ? 'normal' : `${st.phase} ${Math.ceil((st.remaining || 0) / 1000)}s`;
  el.textContent = `${innerWidth}×${innerHeight} dpr${devicePixelRatio} | ${phaseInfo} | ${boxes.join(' | ')}`;
  el.hidden = false;
}

function renderPrayerStrip(): void {
  const s = state.settings!.prayer!;
  const rows: string[] = [];
  if (s.showImsak && state.today.prayers.imsak) rows.push('imsak');
  rows.push('fajr');
  if (s.showSunrise && state.today.prayers.sunrise) rows.push('sunrise');
  rows.push('dhuhr', 'asr', 'maghrib', 'isha');

  const nextKey = state.today?.next?.key;
  const nextTomorrow = state.today?.next?.tomorrow === true;
  const iqamah: Record<string, string> = s.iqamah || {};

  $('stripTimes').innerHTML = rows.map((key) => {
    const prayer = (state.today!.prayers as Record<string, PrayerTimePayload | undefined>)[key];
    if (!prayer) return '';
    const isNext = key === nextKey && !nextTomorrow;
    const isTomorrow = key === nextKey && nextTomorrow && key === 'fajr';
    // iqamah[key] ialah input teks bebas admin — sanitasi sebelum innerHTML.
    const iq = iqamah[key] ? escapeHtml(fmtPrayerTime(iqamah[key])) : '';
    return `
      <div class="prayer-item${isNext || isTomorrow ? ' next' : ''}">
        <span class="p-name">${prayerLabel(key)}</span>
        <span class="p-time">${escapeHtml(fmtPrayerTime(prayer.time))}</span>
        ${isTomorrow ? `<span class="p-iqamah">${t('tomorrow')}</span>` : (iq ? `<span class="p-iqamah">${t('iqamah')} ${iq}</span>` : '')}
      </div>`;
  }).join('');
}

function renderSource(): void {
  let sourceLabel: string;
  if (state.today.source === 'jakim' && state.today.zone) {
    sourceLabel = `JAKIM • ${state.today.zone.code} — ${state.today.zone.label}`;
  } else if (state.today.source === 'local') {
    sourceLabel = `${t('local')} • ${state.settings.prayer.method}`;
  } else {
    sourceLabel = `JAKIM (offline) • ${t('local')}`;
  }
  $('sourceLine').textContent = sourceLabel;
}

function tickClock(): void {
  const now = new Date(nowMs());
  const hour12 = state.settings?.display?.clockFormat === '12h';
  const withSeconds = state.settings?.display?.showSeconds !== false;
  let text: string;
  if (hour12) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz(), hour: 'numeric', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: true
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(now)) {
      if (p.type !== 'literal') parts[p.type] = p.value;
    }
    const ampm = parts.dayPeriod === 'AM'
      ? (lang() === 'ms' ? 'PG' : 'AM')
      : (lang() === 'ms' ? 'PTG' : 'PM');
    text = `${parts.hour.padStart(2, '0')}:${parts.minute}${withSeconds ? `:${parts.second}` : ''} ${ampm}`;
  } else {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz(), hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hourCycle: 'h23'
    });
    text = fmt.format(now);
  }
  $('clock').textContent = text;
  const blackClock = $('ovBlackClock');
  if (blackClock && !blackClock.hidden) blackClock.textContent = text;

  const loc = lang() === 'ms' ? 'ms-MY' : 'en-MY';
  const dateFmt = new Intl.DateTimeFormat(loc, {
    timeZone: tz(),
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  $('gregorianDate').textContent = dateFmt.format(now);

  const jakimHijri = state.today?.hijri?.text;
  if (jakimHijri) {
    $('hijriDate').textContent = jakimHijri;
  } else {
    try {
      const offset = (Number(state.settings?.hijriOffset) || 0) * 86400000;
      const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        timeZone: tz(),
        day: 'numeric', month: 'long', year: 'numeric'
      });
      $('hijriDate').textContent = hijriFmt.format(new Date(now.getTime() + offset));
    } catch {
      // Sesetengah WebView tidak menyokong islamic-umalqura — jangan rosakkan jam.
      $('hijriDate').textContent = '—';
    }
  }
}

// -------------------------------------------- fasa azan / iqamah / jemaah

const ADHAN_CALL_MS = 7000;
const IQAMAH_LEAD_MS = 30000; // bunyi iqamah 30 saat sebelum waktu iqamah

function getActivePrayerEvent(now: number): ActivePrayerEvent | null {
  const s = state.settings?.prayer;
  if (!s || !state.today) return null;
  // Ujian penuh: setiap fasa dipendekkan kepada 1 minit (boleh laras) supaya
  // keseluruhan aliran boleh disahkan dengan cepat.
  const fullTest = fullTestActive();
  const lead = (fullTest ? (Number(testMode().phaseMs) || 60000) / 60000 : (Number(s.azanLeadMinutes) || 5)) * 60000;
  const off = (fullTest ? (Number(testMode().phaseMs) || 60000) : (Number(s.iqamahOffsetMinutes) || 10) * 60000);
  const jDur = (fullTest ? (Number(testMode().phaseMs) || 60000) : (Number(s.jemaahDurationMinutes) || 15) * 60000);
  const tm = testMode();
  const simulate = tm.enabled && tm.date && tm.time;
  const anchor = (timeStr: string, iqStr: string | undefined): { azanMs: number; iqMs: number; anchorDate: string | null } => {
    if (!simulate) return { azanMs: 0, iqMs: 0, anchorDate: null };
    const azanMs = zonedMs(tm.date, timeStr, tz());
    // Ujian penuh: paksa iqamah = azan + 1 fasa (abaikan masa tetap) supaya
    // tempoh setiap fasa tepat seperti dikonfigurasi.
    const iqMs = fullTest ? azanMs + off : (iqStr ? zonedMs(tm.date, iqStr, tz()) : azanMs + off);
    return { azanMs, iqMs, anchorDate: tm.date };
  };
  const list: PrayerEventEntry[] = [];
  for (const key of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']) {
    const a = (state.today.prayers as Record<string, PrayerTimePayload | undefined>)[key];
    if (!a) continue;
    if (simulate) {
      const { azanMs, iqMs } = anchor(a.time, (state.today.iqamah as Record<string, { time: string; ms: number } | undefined>)?.[key]?.time);
      list.push({ key, azan: azanMs, iqamah: iqMs, tomorrow: false });
    } else {
      const iq = (state.today.iqamah as Record<string, { time: string; ms: number } | undefined>)?.[key]?.ms || (a.ms + off);
      list.push({ key, azan: a.ms, iqamah: iq, tomorrow: false });
    }
  }
  const nxt = state.today.next;
  if (nxt?.tomorrow && nxt.key === 'fajr' && !simulate) {
    list.push({ key: 'fajr', azan: nxt.time.ms, iqamah: nxt.time.ms + off, tomorrow: true });
  } else if (simulate && (state.today.prayers as Record<string, PrayerTimePayload | undefined>).fajr) {
    const tomorrow = zonedMs(addDaysKey(tm.date, 1), (state.today.prayers as Record<string, PrayerTimePayload | undefined>).fajr!.time, tz());
    list.push({ key: 'fajr', azan: tomorrow, iqamah: tomorrow + off, tomorrow: true });
  }
  for (const e of list) {
    // Ujian penuh: fasa khutbah Jumaat turut dimampatkan kepada 1 fasa
    // (masa tetap sebenar 13:55 tidak boleh dicapai dalam simulasi 1 minit).
    const fEnd = e.key === 'dhuhr' && isFriday()
      ? (fullTest ? e.iqamah + jDur : fridayJemaahEndMs())
      : null;
    const end = fEnd ? Math.max(fEnd, e.iqamah + jDur) : e.iqamah + jDur;
    if (now >= e.azan - lead && now < end) return { ...e, lead, off, jDur, end };
  }
  return null;
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function computePrayerPhase(now: number = nowMs()): { phase: string; ev?: ActivePrayerEvent; remaining?: number } {
  const ev = getActivePrayerEvent(now);
  if (!ev) return { phase: 'normal' };
  if (now < ev.azan) return { phase: 'azan-countdown', ev, remaining: ev.azan - now };
  if (now < ev.azan + ADHAN_CALL_MS) return { phase: 'azan-call', ev, remaining: ev.azan + ADHAN_CALL_MS - now };
  if (now < ev.iqamah) return { phase: 'iqamah-countdown', ev, remaining: ev.iqamah - now };
  return { phase: 'jemaah', ev, remaining: (ev.end || ev.iqamah + ev.jDur) - now };
}

function tickPrayerMode(): void {
  const st = computePrayerPhase();
  if (isAndroid) {
    const muted = st.phase !== 'normal';
    if (muted !== bridgeMuted) {
      bridgeMuted = muted;
      try { AndroidBridgeRef().setStreamMuted(muted); } catch {}
    }
  }
  const ov = $('prayerOverlay');
  if (!ov) return;
  if (st.phase === 'normal') {
    if (!ov.hidden) ov.hidden = true;
    return;
  }
  ov.hidden = false;
  const blackClock = $('ovBlackClock');
  const blackMode = st.phase === 'jemaah' && state.settings?.prayer?.afterIqamah === 'black';
  ov.classList.toggle('black-mode', blackMode);
  if (blackClock) blackClock.hidden = !blackMode;
  if (blackMode) return; // skrin hitam + jam - tickClock mengemas kini jam
  const { ev } = st;
  const name = prayerLabel(ev.key);
  const time = ev.tomorrow ? state.today?.next?.time?.time : (state.today!.prayers as Record<string, PrayerTimePayload | undefined>)[ev.key]?.time;
  const kicker = $('ovKicker');
  const arabic = $('ovArabic');
  const ovName = $('ovName');
  const sub = $('ovSub');
  const count = $('ovCountdown');
  arabic.classList.remove('big');
  switch (st.phase) {
    case 'azan-countdown':
      kicker.textContent = 'AZAN';
      arabic.textContent = 'الأَذَان';
      ovName.textContent = `${name}${time ? ` — ${fmtPrayerTime(time)}` : ''}`;
      sub.textContent = '';
      count.textContent = formatDuration(st.remaining);
      break;
    case 'azan-call':
      kicker.textContent = 'WAKTU SOLAT';
      arabic.textContent = 'اللهُ أَكْبَر';
      arabic.classList.add('big');
      ovName.textContent = `${name}${time ? ` • ${fmtPrayerTime(time)}` : ''}`;
      sub.textContent = '';
      count.textContent = '';
      break;
    case 'iqamah-countdown':
      kicker.textContent = 'IQAMAH';
      arabic.textContent = 'إِقَامَة';
      arabic.classList.add('big');
      ovName.textContent = name;
      sub.textContent = time ? `${((t('names') as unknown) as Record<string, string>)[ev.key]} — ${fmtPrayerTime(time)}` : '';
      count.textContent = formatDuration(st.remaining);
      break;
    case 'jemaah':
      kicker.textContent = '';
      arabic.textContent = 'صَلَاةُ الْجَمَاعَة';
      ovName.textContent = ev.key === 'dhuhr' && isFriday() ? t('fridayJemaah') : t('jemaah');
      sub.textContent = time ? `${name} — ${fmtPrayerTime(time)}` : name;
      count.textContent = '';
      break;
  }
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// Tukar "05:58" -> "05:58 PG" (12 jam) mengikut bahasa.
function timeTo12h(hhmm: string): string {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!h && h !== 0) return hhmm;
  const meridiem = lang() === 'ms' ? (h < 12 ? 'PG' : 'PTG') : (h < 12 ? 'AM' : 'PM');
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${meridiem}`;
}

// Paparkan waktu solat mengikut format jam semasa (12/24 jam).
function fmtPrayerTime(hhmm: string): string {
  return state.settings?.display?.clockFormat === '12h' ? timeTo12h(hhmm) : hhmm;
}

// ------------------------------------------- simulasi jam & tarikh (ujian)

function testMode(): TestModeSettings {
  return state.settings?.display?.testMode || ({} as TestModeSettings);
}

// Mod ujian penuh: anchor masa simulasi bergerak mengikut masa sebenar
// sejak testMode.savedAtMs (jam simulasi "hidup", bukan beku), dengan jeda
// permulaan startDelaySec sebelum fasa countdown azan bermula.
const fullTestActive = (): boolean => {
  const tm = testMode();
  return !!(tm.enabled && tm.runFullTest && tm.date && tm.time && tm.savedAtMs);
};

function tzOffsetMinutes(epochMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (wall - epochMs) / 60000;
}

// Masa dinding (tarikh+jam) dalam zon waktu paparan -> milisaat sebenar.
function zonedMs(dateKey: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  const i0 = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffsetMinutes(i0, timeZone);
  return i0 - off * 60000;
}

// "Sekarang" — masa sebenar atau simulasi (mod ujian).
// Simulasi biasa: masa beku pada (date, time) untuk pratonton statik.
// Ujian penuh: masa simulasi BERJALAN dari titik anchor (masa azan − 1 fasa)
// supaya seluruh aliran azan→iqamah→jemaah berkembang secara langsung.
function nowMs(): number {
  const tm = testMode();
  if (tm.enabled && tm.date && tm.time) {
    const anchor = zonedMs(tm.date, tm.time, tz());
    if (fullTestActive()) {
      const delay = (Number(tm.startDelaySec) || 0) * 1000;
      // JANGAN jepit elapsed kepada 0: savedAtMs datang daripada jam pelayar
      // admin — jika jam peranti paparan ketinggalan (kotak TV tanpa NTP),
      // elapsed kekal negatif & diklip kepada 0, membekukan countdown
      // selama-lamanya. Biarkan nilai negatif: simulasi bermula lebih awal
      // sedikit (fasa "normal") dan countdown hidup sebaik jam mengejar.
      const elapsed = Date.now() - tm.savedAtMs - delay;
      return anchor + elapsed;
    }
    return anchor;
  }
  return Date.now();
}

// -------------------------------------------------------------------- audio

function audioFor(url: string): HTMLAudioElement | null {
  if (!url) return null;
  let a = state.audioCache.get(url);
  if (!a) {
    a = new Audio(url);
    a.preload = 'auto';
    state.audioCache.set(url, a);
  }
  return a;
}

// Muat turun audio lebih awal supaya azan/iqamah mula tepat pada masa
// (box lemah mengambil masa untuk buffer fail MP3 dari cloud).
function preloadAudio(url: string): void {
  if (!url) return;
  const a = audioFor(url);
  if (a.readyState >= 2 || (!a.paused && !a.ended)) return; // sudah sedia / sedang main
  try { a.load(); } catch { /* abaikan */ }
}

function playOnce(key: string, url: string, targetMs: number): void {
  if (!url) return;
  if (state.playedAdhan.has(key) || state.playedIqamah.has(key)) return;
  const now = nowMs(); // masa simulasi — konsisten dengan sasaran fasa
  const diff = targetMs - now;
  // Terlalu awal — bukan masa lagi. Terlalu lewat (>10 min) — lupakan.
  if (diff > 1500 || diff < -600000) return;
  const target = key.startsWith('iq:') ? state.playedIqamah : state.playedAdhan;
  // Android TV dengan APK baharu: main melalui pemain NATIF (media_kit/
  // ExoPlayer) — autoplay audio WebView kerap disekat pada kotak TV walaupun
  // setMediaPlaybackRequiresUserGesture(false); jambatan native dijamin
  // berbunyi. APK lama (nativeAudioCapable=false) kekal fallback WebView.
  if (isAndroid && nativeAudioCapable) {
    try {
      AndroidBridgeRef().playAudio(url, key);
      target.add(key);
      if (state.pendingAudio?.key === key) state.pendingAudio = null;
      return;
    } catch { /* jatuh kembali ke HTMLAudioElement */ }
  }
  const audio = audioFor(url);
  if (!audio) return;
  if (!audio.paused && !audio.ended) return; // sudah dimainkan - jangan ulang semula
  // Ujian penuh: fasa dipendekkan — hentikan audio lain yang masih berbunyi
  // supaya azan & iqamah tidak bertindih dalam masa yang dimampatkan.
  if (fullTestActive()) {
    for (const other of state.audioCache.values()) {
      if (other !== audio && !other.paused && !other.ended) {
        try { other.pause(); } catch { /* abaikan */ }
      }
    }
  }
  audio.currentTime = 0;
  // Tandakan "sudah dimainkan" hanya apabila audio benar-benar mula berbunyi
  // (bukan semasa fallback mute). Autoplay pelayar web mungkin disekat -
  // simpan pending untuk cubaan semula setiap detik & bila tab aktif semula.
  // Satu pendengar sahaja per elemen — elak timbunan closure semasa autoplay
  // diblok (tickAudio mencuba semula setiap detik).
  if (audio.dataset.pendingKey !== key) {
    audio.dataset.pendingKey = key;
    audio.addEventListener('playing', function onPlaying(this: HTMLAudioElement) {
      if (this.muted) return; // masih senyap - tunggu nyah-senyap berjaya
      this.removeEventListener('playing', onPlaying);
      delete this.dataset.pendingKey;
      target.add(key);
      if (state.pendingAudio?.key === key) state.pendingAudio = null;
    });
  }
  state.pendingAudio = { key, url, targetMs };
  playAudioWithUnlock(audio);
}

function playAudioWithUnlock(audio: HTMLAudioElement): void {
  audio.play().catch(() => {
    // Autoplay diblok oleh pelayar. Fallback: mula main secara senyap
    // (dibenarkan oleh Chrome/Edge), kemudian buka semula bunyi serta-merta.
    audio.muted = true;
    audio.play().then(() => {
      setTimeout(() => {
        audio.muted = false;
        audio.play().catch(() => { /* masih diblok - tunggu interaksi pertama */ });
      }, 50);
    }).catch(() => { /* tiada interaksi - pendengar unlockAudio akan cuba lagi */ });
  });
}

function tickAudio(): void {
  // Simulasi statik (bukan ujian penuh) — tiada audio.
  if (testMode().enabled && !fullTestActive()) return;
  const audio = state.settings?.audio;
  if (!audio?.enabled) return;
  const now = nowMs();
  const ev = getActivePrayerEvent(now);
  if (!ev || ev.tomorrow) return;
  // Kunci unik per kitaran: semasa ujian penuh ikut ID simulasi supaya
  // setiap "Run" boleh berbunyi semula; biasa ikut tarikh sebenar.
  const tm = testMode();
  const dateKey = fullTestActive() ? `t${tm.savedAtMs}` : state.today.today;
  // Preload audio awal semasa countdown azan supaya tiada kelewatan mula.
  if (now >= ev.azan - ev.lead && now < ev.azan) preloadAudio(audio.adhanUrl);
  if (now < ev.iqamah) preloadAudio(audio.iqamahUrl);
  // Azan — main pada waktu azan.
  playOnce(`adhan:${ev.key}:${dateKey}`, audio.adhanUrl, ev.azan);
  // Iqamah — bunyi bermula 30 saat sebelum waktu iqamah (atau 1/3 fasa
  // semasa ujian penuh, agar muat dalam fasa yang dipendekkan).
  const iqLead = fullTestActive() ? Math.min(IQAMAH_LEAD_MS, (Number(tm.phaseMs) || 60000) / 3) : IQAMAH_LEAD_MS;
  playOnce(`iq:${ev.key}:${dateKey}`, audio.iqamahUrl, ev.iqamah - iqLead);
}

function unlockAudio(): void {
  // Sebarang interaksi pengguna membuka kunci autoplay audio.
  const silent = new Audio();
  silent.volume = 0;
  silent.play().catch(() => {});
  // Main segera azan/iqamah yang tertunda kerana autoplay diblok pelayar.
  const pending = state.pendingAudio;
  if (pending) {
    state.pendingAudio = null;
    playOnce(pending.key, pending.url, nowMs());
  }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });

// Cuba semula audio tertunda apabila tab kembali fokus/aktif.
function retryPendingAudio(): void {
  const pending = state.pendingAudio;
  if (!pending) return;
  if (state.playedAdhan.has(pending.key) || state.playedIqamah.has(pending.key)) return;
  playOnce(pending.key, pending.url, nowMs());
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) retryPendingAudio(); });
window.addEventListener('focus', retryPendingAudio);

// ------------------------------------------------------------------ slides

function renderSlides(data: SlideData): void {
  const banner = state.settings?.display?.staticBanner;
  if (banner && banner.enabled) {
    renderStaticBanner();
    return;
  }
  document.body.classList.remove('banner-mode');

  const streamSlides: Slide[] = ((state.settings?.streams || []) as Stream[])
    .filter((s) => s.enabled)
    .map((s) => ({ kind: 'stream', stream: s as unknown as PublicStream }));

  const annSlides: Slide[] = (data.announcements || []).map((a) => ({
    kind: a.category === 'quran' ? ('quran' as const) : (a.video ? ('video' as const) : (a.category === 'tabung' ? ('tabung' as const) : ('announcement' as const))),
    category: a.category,
    title: a.title,
    message: a.message,
    arabic: a.arabic || null,
    ref: a.ref || null,
    translation: lang() === 'ms' ? (a.translationMs || '') : (a.translationEn || ''),
    image: a.image,
    video: a.video
  }));

  const builtin: Slide[] = (streamSlides.length || annSlides.length)
    ? []
    : data.builtin.map((b) => ({
        kind: b.type,
        category: b.type,
        title: lang() === 'ms' ? b.text_ms : b.text_en,
        arabic: b.arabic || null,
        ref: b.ref
      }));

  // Pengumuman dulu (ikut susunan yang ditetapkan admin); livestream sentiasa
  // di hujung sekali kerana kedudukannya tidak boleh diubah-ubah.
  state.slides = [...annSlides, ...streamSlides, ...builtin];
  state.slideIndex = 0;
  buildSlideDots();

  if (!state.slides.length) {
    // Tiada slaid — hentikan pemasa/HLS lapuk supaya tick lama tidak
    // menghancurkan (slides.length=0 → %0 → NaN → slideHtml(undefined)).
    clearTimeout(state.slideTimer);
    state.slideTimer = null;
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    if (isAndroid) {
      try { AndroidBridgeRef().stopStream(''); } catch {}
    }
    $('slide').innerHTML = `<p class="slide-msg">${t('welcome')}</p>`;
    $('slide').classList.add('visible');
    $('slideDots').innerHTML = '';
    return;
  }

  showSlide(0, true);
}

function renderStaticBanner(): void {
  clearTimeout(state.slideTimer);
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  // Permukaan native Android (RTSP/RTMP) melapisi WebView — hentikan ia,
  // jika tidak banner disembunyi di bawah stream yang masih berjalan.
  if (isAndroid) {
    try { AndroidBridgeRef().stopStream(''); } catch {}
  }
  const sb: StaticBannerSettings = state.settings!.display!.staticBanner || ({} as StaticBannerSettings);
  const el = $('slide');
  el.innerHTML = `
    <div class="static-banner${sb.image ? ' has-img' : ''}">
      ${sb.image ? `<div class="banner-bg" style="background-image:url('${escapeHtml(sb.image)}')"></div>` : ''}
      <div class="banner-content">
        ${sb.title ? `<div class="banner-title">${escapeHtml(sb.title)}</div>` : ''}
        ${sb.message ? `<div class="banner-msg">${escapeHtml(sb.message)}</div>` : ''}
      </div>
    </div>`;
  el.classList.add('visible');
  $('slideDots').innerHTML = '';
  document.body.classList.add('banner-mode');
}

function buildSlideDots() {
  $('slideDots').innerHTML = state.slides.map((_, i) => `<span class="dot${i === 0 ? ' on' : ''}" data-i="${i}"></span>`).join('');
}

function slideDuration(slide: Slide): number {
  const base = (Number(state.settings!.display.slideshowInterval) || 12) * 1000;
  if (slide.kind === 'stream') return (Number(slide.stream.duration) || 30) * 1000;
  return base;
}

function scheduleNextSlide(slide: Slide): void {
  clearTimeout(state.slideTimer);
  // Slaid video bertukar hanya selepas video tamat (peristiwa 'ended').
  if (slide.kind === 'video') return;
  state.slideTimer = setTimeout(() => {
    const nextIndex = (state.slideIndex + 1) % state.slides.length;
    showSlide(nextIndex, false);
  }, slideDuration(slide));
}

// Jaring keselamatan untuk slaid video: jika acara 'ended' tidak tercetus
// (video tersekat/rangkaian putus), tukar slaid selepas tempoh munasabah —
// paparan tidak boleh tersekat pada satu slaid selama-lamanya.
function scheduleVideoGuard(slide: Slide): void {
  clearTimeout(state.videoGuardTimer);
  state.videoGuardTimer = setTimeout(() => {
    const nextIndex = (state.slideIndex + 1) % state.slides.length;
    showSlide(nextIndex, false);
  }, Math.max(slideDuration(slide) * 3, 60000));
}

function showSlide(index: number, _instant: boolean): void {
  const slide = state.slides[index];
  // Indeks tidak sah (senarai berubah di antara tick) — jangan crash.
  if (!slide) return;
  if (isAndroid) {
    try { AndroidBridgeRef().stopStream(''); } catch {}
  }
  state.slideIndex = index;
  const el = $('slide');

  // Bersihkan pemain HLS lama
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }

  el.innerHTML = slideHtml(slide);
  el.classList.remove('visible', 'stream-wrap', 'tabung-card', 'media-slide');
  if (slide.kind === 'stream') el.classList.add('stream-wrap');
  if (slide.kind === 'tabung') el.classList.add('tabung-card');
  if (slide.kind === 'quran') el.classList.add('quran-slide');
  if (slide.kind === 'video' || (slide.kind === 'announcement' && slide.image) || (slide.kind === 'tabung' && slide.image)) {
    el.classList.add('media-slide');
  }
  void el.offsetWidth;
  el.classList.add('visible');

  document.querySelectorAll('#slideDots .dot').forEach((dot, i) => {
    dot.classList.toggle('on', i === index);
  });

  initSlideMedia(slide);
  scheduleNextSlide(slide);
  scheduleVideoGuard(slide);
  syncNativeStream(slide);
}

function slideHtml(slide: Slide): string {
  if (slide.kind === 'stream') return streamHtml(slide.stream);
  if (slide.kind === 'video') {
    return mediaHtml(slide.video, 'video', slide);
  }
  if (slide.kind === 'tabung') {
    if (slide.image) return mediaHtml(slide.image, 'image', slide);
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ''}
      ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ''}`;
  }
  if (slide.kind === 'quran') {
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ''}
      ${slide.arabic ? `<div class="slide-arabic">${escapeHtml(slide.arabic)}</div>` : ''}
      ${slide.translation ? `<p class="slide-msg">${escapeHtml(slide.translation)}</p>` : ''}
      ${slide.ref ? `<div class="slide-ref">${escapeHtml(slide.ref)}</div>` : ''}`;
  }
  if (slide.kind === 'announcement') {
    if (slide.image) return mediaHtml(slide.image, 'image', slide);
    return `
      ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ''}
      ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ''}`;
  }
  // quran / hadith
  return `
    ${slide.arabic ? `<div class="slide-arabic">${escapeHtml(slide.arabic)}</div>` : ''}
    ${slide.title ? `<div class="slide-title">${escapeHtml(slide.title)}</div>` : ''}
    ${slide.ref ? `<div class="slide-ref">${escapeHtml(slide.ref)}</div>` : ''}`;
}

function mediaHtml(src: string, kind: 'video' | 'image', slide: Slide): string {
  return `
    <div class="media-fill">
      ${kind === 'video'
        ? `<video class="slide-video" src="${escapeHtml(src)}" autoplay muted playsinline></video>`
        : `<img class="slide-img" src="${escapeHtml(src)}" alt="">`}
      <div class="media-overlay">
        ${slide.message ? `<p class="slide-msg">${escapeHtml(slide.message)}</p>` : ''}
      </div>
    </div>`;
}

function streamHtml(stream: PublicStream): string {
  if (stream.kind === 'youtube' && stream.youtubeId) {
    const embedOrigin = encodeURIComponent(location.origin || 'https://masjidtv.vercel.app');
    // youtubeId datang daripada rekod stream — hadkan aksara ID YouTube
    // sahaja (elak pecah keluar atribut src melalui " atau <).
    const ytId = escapeHtml(String(stream.youtubeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11));
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t('live'))} • ${escapeHtml(stream.name)}</span>
      <iframe src="https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&modestbranding=1&origin=${embedOrigin}"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (stream.kind === 'embed') {
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t('live'))} • ${escapeHtml(stream.name)}</span>
      <iframe src="${escapeHtml(stream.url)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  // relay / hls
  if (isAndroid && ['rtsp', 'rtmp', 'onvif', 'relay'].includes(stream.kind)) {
    return `
      <span class="stream-badge"><span class="dot"></span>${escapeHtml(t('live'))} • ${escapeHtml(stream.name)}</span>
      <div class="native-stream-slot" data-stream="${escapeHtml(stream.id || '')}"></div>`;
  }
  return `
    <span class="stream-badge"><span class="dot"></span>${escapeHtml(t('live'))} • ${escapeHtml(stream.name)}</span>
    <video id="slideVideo" autoplay muted playsinline></video>`;
}

function initSlideMedia(slide: Slide): void {
  if (slide.kind === 'video') {
    initSlideVideo();
    return;
  }
  if (slide.kind !== 'stream') return;
  const video = document.getElementById('slideVideo') as HTMLVideoElement | null;
  if (!video) return;
  const url = slide.stream.kind === 'relay' ? slide.stream.hlsUrl : slide.stream.url;
  if (!url) {
    video.outerHTML = `<p class="slide-error">${escapeHtml(t('streamOffline'))}</p>`;
    return;
  }
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    // LIVE low-latency (anti-stuck): rapat dengan edge, latensi maksimum
    // dikuatkuasakan, stall sentinel melompat semula ke edge live.
    const hls = new Hls({
      liveSyncDurationCount: 1,
      maxBufferLength: 6,
      maxMaxBufferLength: 12,
      liveMaxLatencyDurationCount: 4,
      liveDurationInfinity: true,
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 10
    });
    state.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (evt: unknown, data: { fatal?: boolean; details?: string }) => {
      if (data.fatal) {
        switch (data.details) {
          case 'bufferStalledError':
          case 'bufferNudgeOnStall':
          case 'bufferSeekOverHole':
            hls.startLoad(-1);
            return;
          default:
            video.outerHTML = `<p class="slide-error">${escapeHtml(t('streamOffline'))}</p>`;
        }
      }
    });
    const stallGuard = setInterval(() => {
      if (!state.hls || video.readyState < 2) return;
      const g = stallGuard as unknown as { lastT: number };
      if (typeof g.lastT === 'number' && video.currentTime - g.lastT < 0.01) {
        try {
          const target = video.seekable.length ? video.seekable.end(video.seekable.length - 1) - 0.5 : 0;
          video.currentTime = target;
        } catch { /* seekable belum sedia */ }
      }
      g.lastT = video.currentTime;
    }, 4000);
    new MutationObserver((_m, obs) => {
      if (!document.getElementById('slideVideo')) {
        clearInterval(stallGuard);
        obs.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
  } else {
    video.outerHTML = `<p class="slide-error">${escapeHtml(t('streamOffline'))}</p>`;
  }
}

function syncNativeStream(slide: Slide | undefined): void {
  if (!isAndroid) return;
  if (!slide || slide.kind !== 'stream' || !['rtsp', 'rtmp', 'onvif', 'relay'].includes(slide.stream.kind)) {
    try { AndroidBridgeRef().stopStream(''); } catch {}
    return;
  }
  const slot = document.querySelector('#slide .native-stream-slot');
  if (!slot) return;
  const r = slot.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  try {
    AndroidBridgeRef().setStreamSlot(
      Math.round(r.left * dpr), Math.round(r.top * dpr),
      Math.round(r.width * dpr), Math.round(r.height * dpr)
    );
    AndroidBridgeRef().playStream(slide.stream.url || '', slide.stream.name || '', slide.stream.id || '');
  } catch {}
}

if (isAndroid) {
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer!);
    resizeTimer = setTimeout(() => syncNativeStream(state.slides[state.slideIndex]), 200);
  });
}

function initSlideVideo(): void {
  const video = document.querySelector('#slide .slide-video') as HTMLVideoElement | null;
  if (!video) return;
  const advance = () => {
    clearTimeout(state.slideTimer);
    const nextIndex = (state.slideIndex + 1) % state.slides.length;
    showSlide(nextIndex, false);
  };
  video.addEventListener('ended', advance, { once: true });
  // Lalukan pemasa kemajuan melalui state.slideTimer supaya showSlide()
  // boleh membatalkannya jika slaid bertukar lebih awal.
  video.addEventListener('error', () => {
    clearTimeout(state.slideTimer);
    state.slideTimer = setTimeout(advance, 2500);
  }, { once: true });
  video.play().catch(() => {
    // Autoplay disekat atau video tidak boleh dimainkan — lepas selang asas.
    state.slideTimer = setTimeout(advance, (Number(state.settings.display.slideshowInterval) || 12) * 1000);
  });
}

$('slideDots').addEventListener('click', (e) => {
  const dot = (e.target as HTMLElement).closest('.dot');
  if (dot) showSlide(Number((dot as HTMLElement).dataset.i), false);
});

// ------------------------------------------------------- panel kanan (side)

function renderSideCards(data: SlideData): void {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz(), weekday: 'long' }).format(now).toLowerCase();
  const duty = (state.settings?.roster || {})[day as keyof typeof state.settings.roster];
  const dutyPanel = $('dutyPanel');
  if (duty && (duty.imam || duty.bilal)) {
    dutyPanel.hidden = false;
    $('dutyTitle').textContent = t('dutyTitle');
    const parts: string[] = [];
    if (duty.imam) parts.push(`<span class="role">${t('imam')}</span><span class="big">${escapeHtml(duty.imam)}</span>`);
    if (duty.bilal) parts.push(`<span class="role">${t('bilal')}</span><span class="big">${escapeHtml(duty.bilal)}</span>`);
    $('dutyBody').innerHTML = parts.join('');
  } else {
    dutyPanel.hidden = true;
  }

  const tabung = (data.announcements || []).find((a) => a.category === 'tabung');
  const kutipanPanel = $('kutipanPanel');
  if (tabung) {
    kutipanPanel.hidden = false;
    $('kutipanTitle').textContent = t('kutipanTitle');
    $('kutipanBody').innerHTML =
      `<span class="big">${escapeHtml(tabung.title)}</span>` +
      (tabung.message ? `<span class="small">${escapeHtml(tabung.message)}</span>` : '');
  } else {
    kutipanPanel.hidden = true;
  }

  const events = (state.settings?.events || []) as (EventPayload & { nameEn?: string })[];
  const eventPanel = $('eventPanel');
  if (events.length) {
    eventPanel.hidden = false;
    $('eventTitle').textContent = t('eventTitle');
    const e = events[0];
    const name = lang() === 'ms' ? e.name : (e.nameEn || e.name);
    const label = e.today ? `${t('today')}!` : t('daysLeft').replace('{n}', String(e.daysLeft));
    let html = `<span class="big">${escapeHtml(name)}</span><span class="med days">${label}</span>`;
    if (events[1]) {
      const e2 = events[1];
      const name2 = lang() === 'ms' ? e2.name : (e2.nameEn || e2.name);
      html += `<span class="small">${escapeHtml(name2)} — ${e2.daysLeft}d</span>`;
    }
    $('eventBody').innerHTML = html;
  } else {
    eventPanel.hidden = true;
  }
}

// ------------------------------------------------------------------- ticker

let lastTickerKey = '';

function renderTicker(data: SlideData): void {
  const enabled = state.settings!.display.showTicker;
  $('tickerBar').hidden = !enabled;
  if (!enabled) return;

  const custom = String(state.settings!.display.tickerCustom || '').trim();
  let items: string[];
  if (custom) {
    // Teks tersuai pengguna — ganti sepenuhnya maklumat sistem.
    items = custom.split(/\r?\n/).filter((l) => l.trim()).map((l) =>
      `<span class="ticker-item">${escapeHtml(l.trim())}</span>`
    );
  } else {
    items = data.announcements.map((a) =>
      `<span class="ticker-item"><span class="tick-title">${escapeHtml(a.title)}</span>${a.message ? '— ' + escapeHtml(a.message) : ''}</span>`
    );
  }
  if (!items.length) {
    items.push(`<span class="ticker-item">${escapeHtml(t('welcome'))}</span>`);
  }
  const content = items.join('');
  const speed = (state.settings!.display.tickerSpeed || 'normal') as TickerSpeed;
  const key = `${enabled}|${speed}|${content}`;
  if (key === lastTickerKey) return; // kandungan sama — jangan reset animasi
  lastTickerKey = key;

  const track = $('tickerTrack');
  track.style.animation = 'none';
  track.innerHTML = content;
  void track.offsetWidth;
  const baseW = Math.max(1, track.scrollWidth);
  // Ulang kandungan supaya trek >= 2x lebar skrin (marquee penuh & berterusan).
  const needed = Math.max(2, Math.ceil((2 * window.innerWidth) / baseW));
  const copies = needed % 2 === 0 ? needed : needed + 1;
  track.innerHTML = content.repeat(copies);
  void track.offsetWidth;
  const pxPerSec = ({ slow: 35, normal: 60, fast: 110 } as Record<string, number>)[speed] || 60;
  const duration = Math.max(15, track.scrollWidth / pxPerSec);
  track.style.animation = `ticker-scroll ${duration}s linear infinite`;
}

// ------------------------------------------------------------------ weather

async function loadWeather(): Promise<void> {
  const chip = $('weatherChip');
  if (!chip) return;
  chip.hidden = true;
  const loc = state.settings?.location;
  if (!state.settings?.weather?.enabled || !state.settings?.display?.showWeather || !loc) return;
  const { latitude, longitude } = loc;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&forecast_days=1`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('weather');
    const data: WeatherResponse = await res.json();
    const code = data.current?.weather_code;
    const temp = Math.round(data.current?.temperature_2m);
    const unit = state.settings?.weather?.unit === 'f' ? '°F' : '°C';
    chip.innerHTML = `${WEATHER_ICONS[code] || '🌡️'} ${temp}${unit} <span class="weather-desc">${I18N[lang()].weather[code] || ''}</span>`;
    chip.hidden = false;
  } catch {
    chip.hidden = true;
  }
}

// ------------------------------------------------------------------- boot

// ------------------------------------------------- sync 10 saat (admin<->paparan)

const SYNC_INTERVAL_MS = 10000;
let dataCache = { settings: '', today: '', slides: '' };

// /api/today menyertakan `now` (timestamp) yang berubah setiap panggilan.
// Abaikan medan ini semasa mengesan perubahan supaya sync 10 saat tidak
// menganggap data berubah (yang menyebabkan ticker/slaid di-reset semula).
const stableToday = (today: TodayPayload): TodayPayload => {
  if (!today || typeof today !== 'object') return today;
  const copy = { ...today };
  delete copy.now;
  return copy;
};

function renderEverything(): void {
  applyColors();
  renderHeader();
  renderPrayerStrip();
  renderSource();
  renderSlides(state.slidesData || ([] as unknown as SlideData));
  renderSideCards(state.slidesData || ([] as unknown as SlideData));
  renderTicker(state.slidesData || ([] as unknown as SlideData));
  tickClock();
  tickPrayerMode();
}

async function refresh(): Promise<void> {
  try {
    const [settings, today, slides] = await Promise.all([
      api('/api/settings'),
      api('/api/today'),
      api('/api/slides')
    ]);
    state.settings = settings;
    state.today = today;
    state.slidesData = slides;
    dataCache = {
      settings: JSON.stringify(settings),
      today: JSON.stringify(stableToday(today)),
      slides: JSON.stringify(slides)
    };
    renderEverything();
    loadWeather().catch(() => {});
  } catch (err) {
    console.error('[display] refresh failed:', err);
    const el = $('slide');
    if (String((err as Error).message).includes('401')) {
      if (recoverMissingKey()) return;
      el.innerHTML = '<p class="slide-msg">Sesi TV tidak sah — sila pautkan semula di admin.</p>';
      notifySessionInvalid();
    } else {
      el.innerHTML = '<p class="slide-msg">Menghubungi pelayan… / Connecting to server…</p>';
    }
    el.classList.add('visible');
  }
}

// Sync latar: kemas kini hanya bahagian yang benar-benar berubah.
async function sync(): Promise<void> {
  try {
    const [settings, today, slides] = await Promise.all([
      api('/api/settings'),
      api('/api/today'),
      api('/api/slides')
    ]);
    const settingsChanged = JSON.stringify(settings) !== dataCache.settings;
    const todayChanged = JSON.stringify(stableToday(today)) !== dataCache.today;
    const slidesChanged = JSON.stringify(slides) !== dataCache.slides;
    if (!settingsChanged && !todayChanged && !slidesChanged) return;

    state.settings = settings;
    state.today = today;
    state.slidesData = slides;
    dataCache = {
      settings: JSON.stringify(settings),
      today: JSON.stringify(stableToday(today)),
      slides: JSON.stringify(slides)
    };

    if (settingsChanged) {
      applyColors();
      renderHeader();
      renderPrayerStrip();
      renderSource();
      // renderSlides dijalankan di bawah jika slidesChanged; jika tetapan
      // sahaja berubah (strim/pengumuman melalui tetapan) tapi payload slaid
      // kekal sama, kemas kini slaid sekali di sini — elak render dua kali.
      if (!slidesChanged) renderSlides(slides);
    } else if (todayChanged) {
      renderPrayerStrip();
      renderSource();
    }
    if (slidesChanged) {
      renderSlides(slides);
    }
    renderSideCards(slides);
    renderTicker(slides);
    tickClock();
    tickPrayerMode();
  } catch (err) {
    console.error('[display] sync failed:', err);
    if (String((err as Error).message).includes('401')) {
      if (recoverMissingKey()) return;
      notifySessionInvalid();
    }
  }
}

window.addEventListener('error', (e) => {
  console.error('[display] uncaught:', e.message);
});

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

setInterval(tickClock, 1000);
setInterval(tickAudio, 1000);
setInterval(tickPrayerMode, 1000);
setInterval(tickDebug, 2000);
setInterval(sync, SYNC_INTERVAL_MS);
setInterval(loadWeather, 900000);

// SYNC SEGERA: SSE cloud /api/events — event 'sync' dari admin (melalui
// hub SSE cloud) memicu sync() serta-merta (<1sa). Fallback: poll 10sa.
try {
  const es = new EventSource('/api/events');
  es.addEventListener('sync', () => { sync().catch(() => {}); });
} catch {
  /* pelayar tanpa EventSource — poll sahaja */
}


const style = document.createElement('style');
style.textContent = `
  @keyframes ticker-scroll {
    from { transform: translateX(0); }
    to { transform: translateX(-50%); }
  }
`;
document.head.appendChild(style);

refresh();

