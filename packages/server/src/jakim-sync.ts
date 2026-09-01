// Sync tahunan SEMUA zon JAKIM ke dalam cache DB lokal (jakim_times).
//
// Mengapa: waktu solat ialah isu sensitif — paparan tidak boleh bergantung
// pada e-solat.gov.my yang kadangkala perlahan/tidak dapat dihubungi. Cache
// penuh setahun × 60 zon membolehkan kiosk berkhidmat sepenuhnya luar talia
// walaupun internet terputus berminggu-minggu, termasuk pertukaran zon tanpa
// rangkaian.
//
// Kelakuan:
// - Boot: tertunda 20sa (jangan melengahkan permulaan), kemudian kitaran.
// - Harian: isi julat HILANG sahaja (incremental — kitaran lengkap pantas).
// - Force: tarik semula tahun penuh (butang admin) — upsert menimpa nilai
//   lama; suntingan manual TIDAK terjejas (ia disimpan dalam settings,
//   bukan jadual ini).
// - Dipintaskan sepenuhnya bila kiosk dipautkan cloud (data paparan datang
//   dari cloud; admin lokal dilumpuhkan).

import { ZONES, fetchJakimRange, dateKeyInZone, planZoneYearSync } from '@masjidtv/shared';
import type { Store } from './store.js';

export interface JakimSyncStatus {
  running: boolean;
  lastRun: string | null;
  zonesTotal: number;
  zonesDone: number;
  currentZone: string | null;
  errors: string[];
}

const MAX_ERRORS = 20;
const ZONE_DELAY_MS = 400; // jeda antara zon — sopan kepada e-solat.gov.my

export class JakimSyncService {
  private status: JakimSyncStatus = {
    running: false,
    lastRun: null,
    zonesTotal: ZONES.length,
    zonesDone: 0,
    currentZone: null,
    errors: []
  };

  constructor(
    private store: Store,
    private opts: { isCloudPaired?: () => boolean } = {}
  ) {}

  getStatus(): JakimSyncStatus {
    return { ...this.status, errors: [...this.status.errors] };
  }

  /** Jadualkan kitaran: tertunda selepas boot + setiap 24 jam. */
  start(): void {
    // Ujian/CI: matikan latar belakang sepenuhnya (elak panggilan rangkaian
    // sebenar bila stub fetch telah dipulihkan).
    if (process.env.MASJIDTV_DISABLE_JAKIM_SYNC === '1') return;
    const boot = setTimeout(() => { void this.runAll(); }, 20_000);
    boot.unref?.();
    const daily = setInterval(() => { void this.runAll(); }, 24 * 60 * 60 * 1000);
    daily.unref?.();
  }

  /**
   * Satu kitaran sync. `onlyZone` hadkan kepada satu zon (butang admin /
   * pertukaran zon). `force=true` tarik semula tahun penuh walaupun lengkap.
   * Pulangkan status akhir.
   */
  async runAll(force = false, onlyZone?: string): Promise<JakimSyncStatus> {
    if (this.status.running) return this.getStatus();
    if (this.opts.isCloudPaired?.()) {
      // Dipaut cloud — data paparan dihidangkan dari cloud; jangan buang
      // kuota/kuasa CPU pada sync lokal yang tidak akan digunakan.
      return this.getStatus();
    }
    this.status = { ...this.status, running: true, zonesDone: 0, currentZone: null, errors: [] };
    try {
      const zones = onlyZone
        ? ZONES.filter((z) => z.zone === onlyZone)
        : ZONES;
      if (!zones.length) return this.getStatus();
      for (const z of zones) {
        this.status.currentZone = z.zone;
        try {
          await this.syncZone(z.zone, force);
        } catch (err) {
          const msg = `${z.zone}: ${err instanceof Error ? err.message : String(err)}`;
          this.status.errors = [...this.status.errors.slice(-(MAX_ERRORS - 1)), msg];
        }
        this.status.zonesDone++;
        await new Promise((r) => setTimeout(r, ZONE_DELAY_MS));
      }
      this.status.lastRun = new Date().toISOString();
      return this.getStatus();
    } finally {
      this.status.currentZone = null;
      this.status.running = false;
    }
  }

  private async syncZone(zone: string, force: boolean): Promise<void> {
    // Tahun takwim mengikut zon waktu Malaysia (bukan TZ hos).
    const todayKey = dateKeyInZone(new Date(), 'Asia/Kuala_Lumpur');
    const plan = planZoneYearSync(this.store.getJakimMaxDate(zone), force, todayKey);
    if (plan.complete) return;
    await fetchJakimRange(zone, plan.from, plan.to);
  }
}
