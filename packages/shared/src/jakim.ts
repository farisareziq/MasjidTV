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
  januari: 1, februari: 2, mac: 3, april: 4, mei: 5, jun: 6,
  julai: 7, ogos: 8, september: 9, oktober: 10, november: 11, disember: 12
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

function parseEntry(raw: Record<string, unknown>): JakimEntry | null {
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
      return entries;
    })
    .finally(() => {
      WEEK_INFLIGHT.delete(zone);
    });
  WEEK_INFLIGHT.set(zone, fetchPromise);
  return fetchPromise;
}

export async function getEntryForDate(zone: string, dateKey: string): Promise<JakimEntry | null> {
  const entries = await getWeekEntries(zone);
  return entries.find((e) => e.dateKey === dateKey) ?? null;
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function fetchRange(zone: string, startKey: string, endKey: string): Promise<JakimEntry[]> {
  const all: JakimEntry[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    const chunkEnd = addDays(cursor, 139);
    const end = chunkEnd < endKey ? chunkEnd : endKey;
    const json = await apiFetch(zone, 'duration', { start: cursor, end });
    all.push(...(json.prayerTime || []).map((e) => parseEntry(e as Record<string, unknown>)).filter((e): e is JakimEntry => e !== null));
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
  const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: 'numeric', day: 'numeric'
  });
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  for (let i = 0; i < 430; i++) {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(start)) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    if (p.month === month && p.day === day) {
      const y = start.getFullYear();
      const m = String(start.getMonth() + 1).padStart(2, '0');
      const d = String(start.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
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
    const entries = await fetchRange(zone, startKey, endKey);

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
