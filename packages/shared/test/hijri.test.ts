import { describe, it, expect } from 'vitest';
import { hijriForDateKey } from '../src/hijri.js';

describe('hijri tabular calendar', () => {
  it('converts a known Gregorian date to Hijri (matches reference)', () => {
    // Verified against the reference implementation: the tabular calendar is
    // offset by 1 from the classic epoch (its gregorianToRd uses an R.D. epoch).
    expect(hijriForDateKey('2026-08-01')).toEqual({ year: 1448, month: 2, day: 17 });
    expect(hijriForDateKey('2026-08-15')).toEqual({ year: 1448, month: 3, day: 2 });
  });

  it('returns null for malformed dates', () => {
    expect(hijriForDateKey('not-a-date')).toBeNull();
    expect(hijriForDateKey('2026-8-15')).toBeNull();
  });

  it('applies admin offset (hijriOffset)', () => {
    const base = hijriForDateKey('2026-08-15', 0);
    const shifted = hijriForDateKey('2026-08-15', 1);
    expect(base).not.toBeNull();
    expect(shifted).not.toBeNull();
    expect(shifted!.day).not.toBe(base!.day);
  });

  it('produces valid month/day ranges', () => {
    for (const d of ['2026-01-01', '2026-06-15', '2026-12-31']) {
      const h = hijriForDateKey(d);
      expect(h).not.toBeNull();
      expect(h!.month).toBeGreaterThanOrEqual(1);
      expect(h!.month).toBeLessThanOrEqual(12);
      expect(h!.day).toBeGreaterThanOrEqual(1);
      expect(h!.day).toBeLessThanOrEqual(30);
    }
  });

  it('is deterministic', () => {
    expect(hijriForDateKey('2026-08-15')).toEqual(hijriForDateKey('2026-08-15'));
  });
});
