import { describe, it, expect } from 'vitest';
import { nextOccurrence, daysUntil, buildEventsPayload, dateKeyInZone } from '../src/events.js';
import type { IslamicEvent } from '../src/types.js';

describe('events', () => {
  const recurring: IslamicEvent = {
    id: 'e1', name: 'Awal Muharam', nameEn: 'Islamic New Year',
    date: '2026-06-06', recurring: true
  };

  const oneOff: IslamicEvent = {
    id: 'e2', name: 'Sekali sahaja', nameEn: 'One-off',
    date: '2026-10-01', recurring: false
  };

  it('computes next occurrence for recurring events this year', () => {
    expect(nextOccurrence(recurring, '2026-01-01')).toBe('2026-06-06');
  });

  it('rolls recurring events to next year when passed', () => {
    expect(nextOccurrence(recurring, '2026-06-07')).toBe('2027-06-06');
  });

  it('returns null for passed non-recurring events', () => {
    expect(nextOccurrence(oneOff, '2026-11-01')).toBeNull();
    expect(nextOccurrence(oneOff, '2026-01-01')).toBe('2026-10-01');
  });

  it('computes days until', () => {
    expect(daysUntil('2026-06-06', '2026-06-01')).toBe(5);
    expect(daysUntil('2026-06-01', '2026-06-01')).toBe(0);
  });

  it('builds payload sorted by daysLeft', () => {
    const payload = buildEventsPayload([recurring, oneOff], new Date('2026-01-01T00:00:00Z'));
    expect(payload[0].name).toBe('Awal Muharam');
    expect(payload[0].daysLeft).toBeGreaterThanOrEqual(0);
  });

  it('dateKeyInZone respects timezone', () => {
    // 2026-08-15 00:30 UTC = 2026-08-15 08:30 MYT
    const key = dateKeyInZone(new Date('2026-08-15T00:30:00Z'), 'Asia/Kuala_Lumpur');
    expect(key).toBe('2026-08-15');
  });
});
