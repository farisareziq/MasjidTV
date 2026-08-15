import { describe, it, expect } from 'vitest';
import { isSafeStreamUrl, applyPatch, DEFAULT_SETTINGS } from '../src/validate.js';

describe('validate', () => {
  describe('isSafeStreamUrl', () => {
    it('allows empty URL', () => {
      expect(isSafeStreamUrl('', 'rtsp')).toBe(true);
    });

    it('allows LAN rtsp camera', () => {
      expect(isSafeStreamUrl('rtsp://192.168.1.50:554/stream', 'rtsp')).toBe(true);
    });

    it('allows https hls', () => {
      expect(isSafeStreamUrl('https://example.com/stream.m3u8', 'hls')).toBe(true);
    });

    it('rejects wrong scheme for type', () => {
      expect(isSafeStreamUrl('http://example.com', 'rtsp')).toBe(false);
    });

    it('rejects SSRF targets', () => {
      expect(isSafeStreamUrl('http://localhost:3000/admin', 'hls')).toBe(false);
      expect(isSafeStreamUrl('http://169.254.169.254/latest/meta-data', 'hls')).toBe(false);
      expect(isSafeStreamUrl('http://100.100.100.200', 'hls')).toBe(false);
      expect(isSafeStreamUrl('http://metadata.google.internal', 'hls')).toBe(false);
    });

    it('rejects malformed URL', () => {
      expect(isSafeStreamUrl('not-a-url', 'hls')).toBe(false);
    });
  });

  describe('applyPatch', () => {
    it('clamps numeric values', () => {
      const next = applyPatch(DEFAULT_SETTINGS, {
        prayer: { iqamahOffsetMinutes: 9999, azanLeadMinutes: -5 },
        display: { safeMargin: 100 },
        hijriOffset: 99
      });
      expect(next.prayer.iqamahOffsetMinutes).toBe(60);
      expect(next.prayer.azanLeadMinutes).toBe(1);
      expect(next.display.safeMargin).toBe(8);
      expect(next.hijriOffset).toBe(2);
    });

    it('validates color hex', () => {
      const next = applyPatch(DEFAULT_SETTINGS, {
        display: { colors: { bgTop: 'not-a-color', gold: '#ffaa00' } }
      });
      expect(next.display.colors.bgTop).toBe(DEFAULT_SETTINGS.display.colors.bgTop);
      expect(next.display.colors.gold).toBe('#ffaa00');
    });

    it('filters invalid streams', () => {
      const next = applyPatch(DEFAULT_SETTINGS, {
        streams: [
          { name: 'OK', type: 'hls', url: 'https://x.com/a.m3u8' },
          { name: 'SSRF', type: 'hls', url: 'http://localhost/x' },
          { name: 'BadType', type: 'foo', url: 'https://x.com' }
        ]
      });
      expect(next.streams).toHaveLength(1);
      expect(next.streams[0].name).toBe('OK');
    });

    it('does not mutate the original', () => {
      const before = JSON.stringify(DEFAULT_SETTINGS);
      applyPatch(DEFAULT_SETTINGS, { mosque: { name: 'New Name' } });
      expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before);
    });
  });
});
