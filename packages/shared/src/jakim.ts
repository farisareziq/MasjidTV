// Pelanggan API rasmi JAKIM (e-Solat).
// Sumber: https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat

import { getZone } from './zones.js';
import type { HijriDate, Settings, IslamicEvent } from './types.js';

export const BASE_URL = 'https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat';

export const HIJRI_MONTHS = [
  'Muharram', 'Safar', 'Rabiulawal', 'Rabiulakhir', 'Jamadilawal', 'Jamadilakhir',
  'Rejab', 'Syaaban', 'Ramadan', 'Syawal', 'Zulkaedah', 'Zulhijjah'
];

const GREG_MONTHS: Record<string, number> = {
  // Nama bulan Melayu (format lama e-Solat).
  januari: 1, februari: 2, mac: 3, april: 4, mei: 5, jun: 6,
  julai: 7, ogos: 8, september: 9, oktober: 10, november: 11, disember: 12,
  // Singkatan Inggeris (format BAHARU e-Solat sejak ~Sep 2026, cth
  // "01-Sep-2026") — tanpa ini SEMUA entri gagal dihurai dan paparan
  // menyahuruf secara senyap kepada pengiraan tempatan.
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Nama penuh Inggeris (defensif — jika e-Solat kembali memanjangkan).
  january: 1, february: 2, march: 3, june: 6, july: 7, august: 8, december: 12
};

export interface JakimEntry {
  dateKey: string;
  hijri: HijriDate | null;
  day: string;
  times: {
    imsak: string | null;
    fajr: string | null;
    syuruk: string | null;
    dhuha: string | null;
    dhuhr: string | null;
    asr: string | null;
    maghrib: string | null;
    isha: string | null;
  };
}

export interface JakimResponse {
  status: string;
  prayerTime: unknown[];
}

const WEEK_CACHE = new Map<string, { dateKey: string; entries: JakimEntry[] }>();
// Coalescing: simpan Promise semasa fetch berjalan supaya panggilan serentak
// (serverless cold start, rollover harian) berkongsi SATU permintaan ke
// e-solat.gov.my, bukan satu setiap panggilan.
const WEEK_INFLIGHT = new Map<string, Promise<JakimEntry[]>>();
let syncRunning = false;

// ---------------------------------------------------------------------------
// Cache luar talia (DB) — cermin data JAKIM dalam SQLite/Turso.
//
// Adapter disuntik oleh hos (server lokal / cloud) melalui setJakimCacheAdapter.
// Susunan carian getEntryForDate: DB (L1) → cache mingguan memori (L2) →
// rangkaian (L3, hasil disimpan balik ke DB). DB diletakkan PERTAMA supaya
// suntingan/tulisanan segar sentiasa menang dan proses berjalan sepenuhnya
// LUAR TALIAN bila e-solat.gov.my tidak dapat dihubungi.
// ---------------------------------------------------------------------------

export interface JakimCacheAdapter {
  /** Baca satu hari untuk satu zon. Pulangkan null jika tiada baris cache. */
  get(zone: string, dateKey: string): Promise<JakimEntry | null> | JakimEntry | null;
  /** Upsert sekumpulan hari untuk satu zon (ON CONFLICT overwrite). */
  put(zone: string, entries: JakimEntry[]): Promise<void> | void;
}

let cacheAdapter: JakimCacheAdapter | null = null;

/** Suntik adapter cache DB (dipanggil sekali oleh hos semasa boot). */
export function setJakimCacheAdapter(adapter: JakimCacheAdapter | null): void {
  cacheAdapter = adapter;
}

/** Adapter semasa (ujian/diagnostik). */
export function getJakimCacheAdapter(): JakimCacheAdapter | null {
  return cacheAdapter;
}

async function cachePut(zone: string, entries: JakimEntry[]): Promise<void> {
  if (!cacheAdapter || !entries.length) return;
  try {
    await cacheAdapter.put(zone, entries);
  } catch {
    /* kegagalan tulis cache tidak boleh menggagalkan paparan */
  }
}

// ---------------------------------------------------------------------------
// Penukaran baris DB (jakim_times) ↔ JakimEntry — dikongsi oleh store lokal
// (better-sqlite3) dan cloud (libsql). Baris ialah objek biasa snake_case.
// ---------------------------------------------------------------------------

export interface JakimTimeRow {
  zone: string;
  date_key: string;
  hijri: string;
  imsak: string | null;
  fajr: string | null;
  syuruk: string | null;
  dhuha: string | null;
  dhuhr: string | null;
  asr: string | null;
  maghrib: string | null;
  isha: string | null;
}

const HHMM5 = (s: unknown): string | null =>
  (typeof s === 'string' && /^\d{2}:\d{2}$/.test(s)) ? s : null;

/** Baris jakim_times → JakimEntry (null jika date_key tidak sah). */
export function jakimRowToEntry(row: JakimTimeRow): JakimEntry | null {
  const dateKey = String(row.date_key || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  let hijri: HijriDate | null = null;
  try {
    const h = JSON.parse(row.hijri || 'null') as HijriDate | null;
    if (h && typeof h.year === 'number' && typeof h.month === 'number' && typeof h.day === 'number') hijri = h;
  } catch {
    /* hijri rosak → null (fallback tabular di prayers.ts) */
  }
  return {
    dateKey,
    hijri,
    day: '',
    times: {
      imsak: HHMM5(row.imsak),
      fajr: HHMM5(row.fajr),
      syuruk: HHMM5(row.syuruk),
      dhuha: HHMM5(row.dhuha),
      dhuhr: HHMM5(row.dhuhr),
      asr: HHMM5(row.asr),
      maghrib: HHMM5(row.maghrib),
      isha: HHMM5(row.isha)
    }
  };
}

/** JakimEntry → parameter baris untuk upsert jakim_times. */
export function jakimEntryToRow(zone: string, entry: JakimEntry): JakimTimeRow {
  return {
    zone,
    date_key: entry.dateKey,
    hijri: entry.hijri ? JSON.stringify(entry.hijri) : '',
    imsak: entry.times.imsak,
    fajr: entry.times.fajr,
    syuruk: entry.times.syuruk,
    dhuha: entry.times.dhuha,
    dhuhr: entry.times.dhuhr,
    asr: entry.times.asr,
    maghrib: entry.times.maghrib,
    isha: entry.times.isha
  };
}

/**
 * Rancangan sync tahunan satu zon: julat tarikh yang perlu ditarik bagi tahun
// semasa (JAKIM hanya menerbitkan data tahun semasa). Digunakan oleh servis
 * sync lokal (semua zon) dan laluan admin cloud (zon tenant).
 */
export interface JakimZoneSyncPlan {
  from: string;
  to: string;
  /** true = zon sudah lengkap hingga 31 Dis — tiada yang perlu ditarik. */
  complete: boolean;
}

export function planZoneYearSync(maxDate: string | null, force: boolean, todayKey: string): JakimZoneSyncPlan {
  const year = Number(todayKey.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  let from = yearStart;
  if (!force && maxDate && maxDate >= yearStart) from = addDays(maxDate, 1);
  if (from > yearEnd) return { from: yearEnd, to: yearEnd, complete: true };
  return { from, to: yearEnd, complete: false };
}

async function apiFetch(
  zone: string,
  period: string,
  { start, end }: { start?: string; end?: string } = {},
  attempt = 1
): Promise<JakimResponse> {
  const url = `${BASE_URL}&period=${period}&zone=${zone}`;
  const isDuration = period === 'duration';
  const init: RequestInit = {
    method: isDuration ? 'POST' : 'GET',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(20000)
  };
  if (isDuration) {
    init.body = new URLSearchParams({ datestart: start ?? '', dateend: end ?? '' }).toString();
  }
  try {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as JakimResponse;
    if (!json || json.status !== 'OK!' || !Array.isArray(json.prayerTime)) {
      throw new Error('Format respon JAKIM tidak dijangka');
    }
    return json;
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500));
      return apiFetch(zone, period, { start, end }, attempt + 1);
    }
    throw err;
  }
}

function parseDate(str: string): string | null {
  const [d, mon, y] = String(str || '').trim().split('-');
  const m = GREG_MONTHS[String(mon || '').toLowerCase()];
  if (!m || !/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(d)) return null;
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function parseHijri(str: string): HijriDate | null {
  const [year, month, day] = String(str || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

export function parseEntry(raw: Record<string, unknown>): JakimEntry | null {
  const dateKey = parseDate(String(raw.date ?? ''));
  if (!dateKey) return null;
  const hijri = parseHijri(String(raw.hijri ?? ''));
  const hhmm = (s: unknown) => (typeof s === 'string' && s.length >= 5 ? s.slice(0, 5) : null);
  return {
    dateKey,
    hijri,
    day: String(raw.day ?? ''),
    times: {
      imsak: hhmm(raw.imsak),
      fajr: hhmm(raw.fajr),
      syuruk: hhmm(raw.syuruk),
      dhuha: hhmm(raw.dhuha),
      dhuhr: hhmm(raw.dhuhr),
      asr: hhmm(raw.asr),
      maghrib: hhmm(raw.maghrib),
      isha: hhmm(raw.isha)
    }
  };
}

async function getWeekEntries(zone: string): Promise<JakimEntry[]> {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const cached = WEEK_CACHE.get(zone);
  if (cached && cached.dateKey === parts) return cached.entries;

  const inflight = WEEK_INFLIGHT.get(zone);
  if (inflight) return inflight;

  const fetchPromise = apiFetch(zone, 'week')
    .then((json) => {
      const entries = (json.prayerTime || []).map((e) => parseEntry(e as Record<string, unknown>)).filter((e): e is JakimEntry => e !== null);
      WEEK_CACHE.set(zone, { dateKey: parts, entries });
      // Simpan minggu penuh ke cache DB — selepas ini hari-hari dalam minggu
      // berkhidmat sepenuhnya luar talian (L1 kena sebelum rangkaian).
      void cachePut(zone, entries);
      return entries;
    })
    .finally(() => {
      WEEK_INFLIGHT.delete(zone);
    });
  WEEK_INFLIGHT.set(zone, fetchPromise);
  return fetchPromise;
}

export async function getEntryForDate(zone: string, dateKey: string): Promise<JakimEntry | null> {
  // L1: cache DB (luar talia) — baris sedia ada dipulangkan tanpa rangkaian.
  if (cacheAdapter) {
    try {
      const hit = await cacheAdapter.get(zone, dateKey);
      if (hit) return hit;
    } catch {
      /* kegagalan baca cache → jatuh ke L2/L3 */
    }
  }
  // L2: cache mingguan memori.
  const entries = await getWeekEntries(zone);
  const found = entries.find((e) => e.dateKey === dateKey) ?? null;
  if (found) return found;
  // L3: period=week hanya memulangkan minggu semasa (Ahad–Sabtu). Pada Sabtu,
  // "esok" (Ahad) tiada dalam cache — dapatkan hari tunggal melalui permintaan
  // duration supaya fallback tidak merosot kepada pengiraan tempatan secara
  // senyap (mismatch minit vs JAKIM).
  try {
    const json = await apiFetch(zone, 'duration', { start: dateKey, end: dateKey });
    const day = (json.prayerTime || []).map((e) => parseEntry(e as Record<string, unknown>)).find((e): e is JakimEntry => e !== null && e.dateKey === dateKey) || null;
    if (day) void cachePut(zone, [day]);
    return day;
  } catch {
    return null;
  }
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Tarik julat tarikh dari JAKIM (chunk 140 hari setiap permintaan) dan simpan
 * setiap chunk ke cache DB. Digunakan oleh sync acara Islam, sync tahunan
 * pelayan lokal (semua zon), dan butang "Sync" admin.
 */
export async function fetchJakimRange(zone: string, startKey: string, endKey: string): Promise<JakimEntry[]> {
  const all: JakimEntry[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    const chunkEnd = addDays(cursor, 139);
    const end = chunkEnd < endKey ? chunkEnd : endKey;
    const json = await apiFetch(zone, 'duration', { start: cursor, end });
    const chunk = (json.prayerTime || []).map((e) => parseEntry(e as Record<string, unknown>)).filter((e): e is JakimEntry => e !== null);
    all.push(...chunk);
    await cachePut(zone, chunk);
    if (end === endKey) break;
    cursor = addDays(end, 1);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Hari kebesaran Islam — auto-sync dari takwim JAKIM
// ---------------------------------------------------------------------------

interface TargetEvent {
  name: string;
  nameEn: string;
  month: number;
  day: number;
}

const TARGET_EVENTS: TargetEvent[] = [
  { name: 'Awal Muharam', nameEn: 'Islamic New Year', month: 1, day: 1 },
  { name: 'Maulidur Rasul', nameEn: 'Mawlid al-Nabi', month: 3, day: 12 },
  { name: 'Isra Mikraj', nameEn: "Isra and Mi'raj", month: 7, day: 27 },
  { name: 'Nisfu Syaaban', nameEn: "Mid-Sha'ban", month: 8, day: 15 },
  { name: 'Awal Ramadan', nameEn: 'Start of Ramadan', month: 9, day: 1 },
  { name: 'Nuzul Al-Quran', nameEn: 'Revelation of the Quran', month: 9, day: 17 },
  { name: 'Hari Raya Aidilfitri', nameEn: 'Eid al-Fitr', month: 10, day: 1 },
  { name: 'Hari Arafah', nameEn: 'Day of Arafah', month: 12, day: 9 },
  { name: 'Hari Raya Aidiladha', nameEn: 'Eid al-Adha', month: 12, day: 10 }
];

export interface SyncResult {
  ok: boolean;
  synced?: number;
  approximated?: number;
  lastSynced?: string;
  message?: string;
}

// Anggaran tarikh seterusnya (hari/bulan hijrah) melalui kalendar Umm al-Qura.
function approximateNextOccurrence(month: number, day: number, now: Date): string | null {
  // Kunci padanan hijri DAN tarikh keluaran mesti konsisten dalam timezone
  // yang sama (Asia/Kuala_Lumpur) — elak ralat ±1 hari bila server bukan MYT.
  const gregFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const hijriFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'numeric', day: 'numeric'
  });
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  for (let i = 0; i < 430; i++) {
    const p: Record<string, number> = {};
    for (const part of hijriFmt.formatToParts(start)) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    if (p.month === month && p.day === day) {
      return gregFmt.format(start);
    }
    start.setDate(start.getDate() + 1);
  }
  return null;
}

export interface EventsPatch {
  events?: IslamicEvent[];
  eventsSync?: Partial<Settings['eventsSync']>;
}

export async function syncEventsFor(
  settings: Settings,
  saveFn: (patch: EventsPatch) => void | Promise<void>,
  force = false
): Promise<SyncResult> {
  if (syncRunning) return { ok: false, message: 'Sync sedang berjalan' };
  if (!settings.eventsSync?.enabled && !force) return { ok: false, message: 'Auto-sync dimatikan' };
  syncRunning = true;
  try {
    const zone = settings.prayer.zone;
    if (!getZone(zone)) throw new Error(`Zon tidak sah: ${zone}`);

    const now = new Date();
    const localParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(now);
    const startKey = addDays(localParts, -15);
    // JAKIM hanya menerbitkan data sehingga akhir tahun semasa.
    const endKey = `${localParts.slice(0, 4)}-12-31`;
    const entries = await fetchJakimRange(zone, startKey, endKey);

    const byHijri = new Map<string, string>();
    for (const e of entries) {
      if (e.hijri) byHijri.set(`${e.hijri.month}-${e.hijri.day}`, e.dateKey);
    }

    const synced: IslamicEvent[] = [];
    const approximated: IslamicEvent[] = [];
    for (const t of TARGET_EVENTS) {
      const date = byHijri.get(`${t.month}-${t.day}`);
      if (date) {
        synced.push({ id: `jakim-${t.month}-${t.day}`, name: t.name, nameEn: t.nameEn, date, recurring: true, source: 'jakim' });
      } else {
        const approx = approximateNextOccurrence(t.month, t.day, now);
        if (approx) {
          approximated.push({ id: `approx-${t.month}-${t.day}`, name: t.name, nameEn: t.nameEn, date: approx, recurring: true, source: 'anggaran' });
        }
      }
    }

    if (!synced.length && !approximated.length) throw new Error('Tiada tarikh diperoleh dari JAKIM');

    const current = settings.events || [];
    const kept = current.filter((e) => e.custom === true);
    const nowIso = new Date().toISOString();
    const events = [
      ...kept,
      ...synced.map((e) => ({ ...e, syncedAt: nowIso })),
      ...approximated.map((e) => ({ ...e, syncedAt: nowIso }))
    ];

    await saveFn({
      events,
      eventsSync: {
        enabled: settings.eventsSync.enabled !== false,
        lastSynced: nowIso,
        status: 'ok',
        message: `${synced.length} dari JAKIM, ${approximated.length} anggaran`
      }
    });

    return { ok: true, synced: synced.length, approximated: approximated.length, lastSynced: nowIso };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveFn({
      eventsSync: {
        enabled: settings.eventsSync.enabled !== false,
        lastSynced: settings.eventsSync.lastSynced,
        status: 'error',
        message
      }
    });
    return { ok: false, message };
  } finally {
    syncRunning = false;
  }
}

export function hijriText(hijri: HijriDate | null | undefined): string | null {
  if (!hijri) return null;
  const month = HIJRI_MONTHS[hijri.month - 1];
  if (!month) return null;
  return `${hijri.day} ${month} ${hijri.year}H`;
}
