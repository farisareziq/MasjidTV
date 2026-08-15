import { describe, it, expect } from 'vitest';
import { ZONES, getZone, getZonesGrouped } from '../src/zones.js';

describe('zones', () => {
  it('has 60 zones', () => {
    expect(ZONES).toHaveLength(60);
  });

  it('looks up a known zone', () => {
    const z = getZone('WLY01');
    expect(z).toEqual({ zone: 'WLY01', negeri: 'Wilayah Persekutuan', label: 'Kuala Lumpur, Putrajaya' });
  });

  it('returns null for unknown zone', () => {
    expect(getZone('ZZZ99')).toBeNull();
  });

  it('groups zones by negeri', () => {
    const groups = getZonesGrouped();
    expect(groups['Selangor']).toHaveLength(3);
    expect(groups['Johor']).toHaveLength(4);
    expect(groups['Sabah']).toHaveLength(9);
  });

  it('has unique zone codes', () => {
    const codes = ZONES.map((z) => z.zone);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
