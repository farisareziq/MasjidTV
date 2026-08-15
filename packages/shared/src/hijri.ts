// Kalendar Hijri fallback (tabular) — digunakan apabila API JAKIM tidak dapat
// dihubungi supaya tarikh hijri sentiasa dipaparkan (bukan bergantung pada
// Intl islamic-umalqura yang tidak disokong sesetengah WebView).
//
// Kalibrasi: dibandingkan dengan data JAKIM (zon JHR04, 1–17 Ogos 2026) —
// padan 17/17 hari. Perbezaan daripada kalendar rukyah JAKIM boleh diselaras
// oleh pentadbir melalui tetapan "hijriOffset" (shift hari Gregorian).

import type { HijriDate } from './types.js';

function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

// Tarikh Rata Die (integer) daripada tarikh Gregorian.
function gregorianToRd(y: number, m: number, d: number): number {
  const a = intDiv(14 - m, 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + intDiv(153 * mm + 2, 5) + 365 * yy
    + intDiv(yy, 4) - intDiv(yy, 100) + intDiv(yy, 400) - 32045 - 1721424;
}

// Epoch kalendar Islam tabular: 1 Muharram 1 AH = 19 Julai 622 (R.D. 227015).
const ISLAMIC_EPOCH_RD = 227015;

function islamicToRd(year: number, month: number, day: number): number {
  return day + Math.ceil(29.5 * (month - 1)) + (year - 1) * 354
    + intDiv(3 + 11 * year, 30) + ISLAMIC_EPOCH_RD - 1;
}

function rdToIslamic(rd: number): HijriDate {
  const year = intDiv(30 * (rd - ISLAMIC_EPOCH_RD) + 10646, 10631);
  const dayOfYear = rd - islamicToRd(year, 1, 1) + 1;
  const month = Math.min(12, Math.floor((dayOfYear - 1) / 29.5) + 1);
  const day = rd - islamicToRd(year, month, 1) + 1;
  return { year, month, day };
}

// Tukar tarikh Gregorian (YYYY-MM-DD) kepada Hijri tabular.
// offsetDays: pelarasan pentadbir (hijriOffset) — shift hari Gregorian dahulu.
export function hijriForDateKey(dateKey: string, offsetDays = 0): HijriDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const rd = gregorianToRd(y, m, d) + (Number(offsetDays) || 0);
  const h = rdToIslamic(rd);
  if (!h.year || h.month < 1 || h.month > 12 || h.day < 1 || h.day > 30) return null;
  return h;
}
