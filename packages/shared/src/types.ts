// Shared domain types — single source of truth for the local server, cloud
// server, Android client, and tests.

export type PrayerKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export const PRAYER_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export const PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

export type PrayerMethodKey =
  | 'JAKIM' | 'KEMENAG' | 'MUIS' | 'MWL' | 'EGYPT' | 'KARACHI' | 'UMM_AL_QURA'
  | 'DUBAI' | 'QATAR' | 'KUWAIT' | 'MOON' | 'TURKEY' | 'NORTH_AMERICA';

export interface PrayerMethodDef {
  label: string;
  fajrAngle: number;
  ishaAngle: number;
  ishaInterval?: number;
}

export type PrayerSource = 'jakim' | 'local';

export interface PrayerAdjustments {
  fajr: number;
  sunrise: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
}

export interface PrayerSettings {
  method: PrayerMethodKey;
  source: PrayerSource;
  zone: string;
  timezone: string;
  adjustments: PrayerAdjustments;
  showImsak: boolean;
  imsakOffset: number;
  showSunrise: boolean;
  azanLeadMinutes: number;
  iqamahOffsetMinutes: number;
  jemaahDurationMinutes: number;
  afterIqamah: 'jemaah' | 'black';
  iqamah: Record<PrayerKey, string>;
}

export type Language = 'ms' | 'en';
export type Theme = 'dark' | 'light';
export type HeadingFont = 'sans' | 'serif' | 'classic';
export type ClockFormat = '24h' | '12h';
export type TickerSpeed = 'slow' | 'normal' | 'fast';
export type MediaFit = 'stretch' | 'fit' | 'crop';

export interface DisplayColors {
  bgTop: string;
  bgBottom: string;
  text: string;
  muted: string;
  gold: string;
  teal: string;
}

export interface TestModeSettings {
  enabled: boolean;
  date: string;
  time: string;
  /** Ujian penuh: fasa dipendekkan & audio dimainkan semasa simulasi. */
  runFullTest: boolean;
  /** Saat sedang berjalan sebelum permulaan simulasi (lalai 10s). */
  startDelaySec: number;
  /** Templat nama solat yang diuji (lalai: maghrib). "jumaah" = aliran khutbah Jumaat (guna waktu Zohor). */
  prayerKey: string;
  /** Masa sebenar (epoch ms) mod ujian diaktifkan — digunakan untuk mengekang jam simulasi. */
  savedAtMs: number;
  /** Kitaran setiap fasa semasa ujian penuh (lalai 60_000 = 1 minit). */
  phaseMs: number;
}

export interface StaticBannerSettings {
  enabled: boolean;
  title: string;
  message: string;
  image: string;
}

export interface DisplaySettings {
  language: Language;
  theme: Theme;
  headingFont: HeadingFont;
  slideshowInterval: number;
  showTicker: boolean;
  showWeather: boolean;
  clockFormat: ClockFormat;
  showSeconds: boolean;
  tickerSpeed: TickerSpeed;
  safeMargin: number;
  mediaFit: MediaFit;
  tickerCustom: string;
  colors: DisplayColors;
  backgroundImage: string;
  backgroundOpacity: number;
  testMode: TestModeSettings;
  staticBanner: StaticBannerSettings;
  fridayKhutbahUntil: string;
}

export interface MosqueSettings {
  name: string;
  tagline: string;
  address: string;
  logo: string;
}

export interface LocationSettings {
  latitude: number;
  longitude: number;
  name: string;
}

export interface WeatherSettings {
  enabled: boolean;
  unit: 'c' | 'f';
}

export interface AudioSettings {
  enabled: boolean;
  adhanUrl: string;
  iqamahUrl: string;
}

export interface MediaSettings {
  ffmpegPath: string;
}

export interface EventsSyncSettings {
  enabled: boolean;
  lastSynced: string | null;
  status: string;
  message: string;
}

export type StreamType = 'rtsp' | 'rtmp' | 'onvif' | 'hls' | 'youtube' | 'webrtc' | 'dshow';

export interface Stream {
  id: string;
  name: string;
  type: StreamType;
  url: string;
  duration: number;
  enabled: boolean;
  /**
   * MIRROR KE LIVE (cth. Facebook Live RTMPS): bila ditetapkan, ffmpeg
   * menyalin output relay ke URL ini secara serentak (tee muxer). Kosong =
   * tiada mirror. Hanya disokong untuk jenis relay (rtsp/rtmp/onvif/dshow).
   */
  mirrorUrl?: string;
}

export interface IslamicEvent {
  id: string;
  name: string;
  nameEn: string;
  date: string; // YYYY-MM-DD
  recurring: boolean;
  custom?: boolean;
  source?: string;
  syncedAt?: string;
}

export type Weekday = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

export interface RosterEntry {
  imam: string;
  bilal: string;
}

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

export interface Settings {
  version: number;
  mosque: MosqueSettings;
  location: LocationSettings;
  prayer: PrayerSettings;
  display: DisplaySettings;
  weather: WeatherSettings;
  audio: AudioSettings;
  media: MediaSettings;
  eventsSync: EventsSyncSettings;
  events: IslamicEvent[];
  roster: Record<Weekday, RosterEntry>;
  streams: Stream[];
  hijriOffset: number;
  security?: { displayKey: string };
  auth?: { passwordHash: string; passwordSalt: string };
  createdAt: string | null;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  category: AnnouncementCategory;
  image: string | null;
  video: string | null;
  quranDaily: boolean;
  arabic: string;
  translationMs: string;
  translationEn: string;
  ref: string;
  sortOrder: number;
  start: string | null;
  end: string | null;
  active: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export type AnnouncementCategory = 'general' | 'event' | 'announcement' | 'welcome' | 'tabung' | 'quran';

export interface PrayerTimePayload {
  time: string;
  iso: string;
  ms: number;
}

export interface PrayerDay {
  dateKey: string;
  timeZone: string;
  source: PrayerSource;
  hijri: HijriDate | null;
  zone: { code: string; negeri: string; label: string } | null;
  times: Partial<Record<'imsak' | (typeof PRAYER_KEYS)[number], PrayerTimePayload>>;
}

export interface NextPrayer {
  key: PrayerKey;
  tomorrow: boolean;
  time: PrayerTimePayload;
  iqamah: PrayerTimePayload | null;
}
