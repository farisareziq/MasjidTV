'use strict';

// Jenis & keadaan dikongsi oleh teras admin (core.ts) dan modul ciri varian
// (cloud.ts/local.ts). Tiada kod kesan-sampingan di aras modul — selamat
// diimport oleh mana-mana varian.

// ------------------------------------------------------------- jenis domain
// Nota: jenis diimport daripada teras domain @masjidtv/shared (jenis sahaja,
// dipadam semasa kompil — kelakuan runtime kekal serupa dengan baseline JS).
import type { Settings, Announcement, TodayPayload, EventsSyncSettings } from '@masjidtv/shared';

export type AdminStatus = {
  version: string; uptime: number; screenUrl: string; adminUrl: string;
  counts: { announcements: number; activeAnnouncements: number };
  mosque: string; language: string; prayerMethod: string; prayerSource: string; prayerZone: string;
  eventsSync: EventsSyncSettings; audioEnabled: boolean; streamCount: number; activeStreamCount: number;
  nextEvent: { name: string; next: string; daysLeft: number; today: boolean } | null;
  adminPasswordFile: boolean;
};
export type StreamRow = { id: string; name: string; type: string; url: string; duration: number; enabled: boolean; mirrorUrl?: string; status?: string };
export type UploadResult = { url: string; kind: string };
export type LicenseInfo = { status: string; trialUntil?: number; apiKey?: string };
export type TenantInfo = { id: string; name: string; status: string; apiKey: string; license?: { status: string; trialUntil?: number } };
export type TvDevice = {
  id: string; device_id: string; name?: string; last_seen?: number | string;
  // Nota: awan menyimpan hw.dshow sebagai string[] (lihat routes/device.ts —
  // nama peranti dipetakan kepada string); kiosk lokal pula menulis
  // { name }[] ke devices.json. Medan dikecualikan kepada unknown[] supaya
  // kedua-dua bentuk boleh dilalukan oleh pembantu penukar.
  hw?: { cameras?: { id?: string; name?: string; status?: string }[]; dshow?: unknown[]; at?: number } | null;
};

// Satu pilihan dalam datalist pemilih peranti DSHOW (medan URL stream).
// value = nilai medan sebenar ("video=<nama>"), label = teks bantuan
// (nama peranti + nama kamera) yang dipapar pelayar sebagai label pilihan.
export type DshowOption = { value: string; label: string };

export interface AdminState {
  token: string;
  role: string;
  editingId: string | null;
  announcements: Array<Announcement & { status?: string }>;
  methods: Record<string, { label: string }>;
  status: AdminStatus | null;
  today: TodayPayload | null;
  streamsStatus: StreamRow[];
  zones: Record<string, Array<{ zone: string; label: string }>>;
  ffmpegOk: boolean | null;
  toastTimer: ReturnType<typeof setTimeout> | null;
  settings?: Settings;
  license?: LicenseInfo;
  superTenants?: TenantInfo[];
}

// AndroidBridge & TVM_IDLE_MS dinyatakan dalam globals.d.ts (dikongsi).

// Elemen DOM longgar (padan gaya baseline JS): HTMLElement + medan borang lazim.
export type Elem = HTMLElement & Record<string, any>;
export const $ = (id: string): Elem => document.getElementById(id) as Elem;

export const state: AdminState = {
  token: localStorage.getItem('tvm_token') || '',
  role: localStorage.getItem('tvm_role') || '',
  editingId: null,
  announcements: [],
  methods: {},
  status: null,
  today: null,
  streamsStatus: [],
  zones: {},
  ffmpegOk: null,
  toastTimer: null
};

export const WEEKDAYS: Array<[string, string]> = [
  ['sunday', 'Sunday'], ['monday', 'Monday'], ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'], ['thursday', 'Thursday'], ['friday', 'Friday'],
  ['saturday', 'Saturday']
];

export const STREAM_TYPES: string[] = ['rtsp', 'rtmp', 'onvif', 'hls', 'youtube', 'webrtc', 'dshow'];

export interface ColorPreset { bgTop: string; bgBottom: string; text: string; muted: string; gold: string; teal: string; font?: string }

export const COLOR_PRESETS: Record<string, ColorPreset> = {
  navy: { bgTop: '#06101f', bgBottom: '#0a1a2f', text: '#f3f6fb', muted: '#8fa4bd', gold: '#e0bc6a', teal: '#62d9c6' },
  emerald: { bgTop: '#03130f', bgBottom: '#08271c', text: '#f0faf5', muted: '#8fb5a4', gold: '#e6c976', teal: '#5ee6b0' },
  royal: { bgTop: '#0a0f2e', bgBottom: '#151d52', text: '#f2f3ff', muted: '#9aa3d8', gold: '#d9b45c', teal: '#6fb7ff' },
  maroon: { bgTop: '#220711', bgBottom: '#421127', text: '#fdf1f4', muted: '#c99aa8', gold: '#e8c37a', teal: '#ff9d76' },
  cream: { bgTop: '#000000', bgBottom: '#161310', text: '#f2e2bd', muted: '#b3a67f', gold: '#e8d29a', teal: '#cbb783', font: 'serif' },
  light: { bgTop: '#eef2f7', bgBottom: '#ffffff', text: '#12233d', muted: '#5d7189', gold: '#a97c1f', teal: '#0d8f7c' }
};

// Konfigurasi varian admin. Setiap ciri lalai false/'password' — varian awan
// menghidupkan hanya apa yang berbeza daripada pelaksanaan teras (admin.ts
// asal, varian lokal).
export interface AdminVariantConfig {
  features: {
    // 'password': borang log masuk kata laluan sahaja → POST /api/admin/login.
    // 'username': username+kata laluan → /api/auth/login atau
    // /api/auth/superuser/login (admin), simpan role, aliran tukar PIN.
    login?: 'password' | 'username';
    // Awan: kad lesen pada overview (trial/licensed/locked) + borang daftar.
    licenseCard?: boolean;
    // Awan: butang susun semula ▲▼ pada pengumuman (POST .../reorder).
    annReorder?: boolean;
    // Awan: medan Quran harian dalam borang pengumuman (kategori 'quran').
    annQuran?: boolean;
    // Awan: mampatan imej + muat naik Blob berpresign untuk fail besar.
    blobUpload?: boolean;
    // Awan: medan font tajuk (stHeadingFont) + preset membawa font.
    headingFont?: boolean;
    // Awan: medan had khutbah Jumaat (stFridayUntil / fridayKhutbahUntil).
    fridayKhutbah?: boolean;
    // Awan: tukar kata laluan mengembalikan token baharu — simpan semula.
    tokenRotate?: boolean;
  };
}

// Diisi oleh bootAdmin() sebelum sebarang pemasa/acara berjalan; dibaca pada
// masa panggilan (bukan masa import) supaya tiada isu susunan modul.
export let cfg: AdminVariantConfig = { features: {} };
export function setCfg(c: AdminVariantConfig): void { cfg = c; }

// Pengakses ciri — dibaca pada masa panggilan daripada cfg (sumber kebenaran
// yang diisi wrapper melalui bootAdmin). Wrapper lokal melulus features:{}
// (semua false/'password'), jadi blok ciri awan tidak pernah berjalan dalam
// bundle lokal; esbuild turut membuang modul ciri awan (cloud.ts) sepenuhnya
// daripada graf bundle lokal kerana ia tidak diimport oleh wrapper lokal.
export const F = {
  login: (): boolean => cfg.features.login === 'username',
  licenseCard: (): boolean => !!cfg.features.licenseCard,
  annReorder: (): boolean => !!cfg.features.annReorder,
  annQuran: (): boolean => !!cfg.features.annQuran,
  blobUpload: (): boolean => !!cfg.features.blobUpload,
  headingFont: (): boolean => !!cfg.features.headingFont,
  fridayKhutbah: (): boolean => !!cfg.features.fridayKhutbah,
  tokenRotate: (): boolean => !!cfg.features.tokenRotate
};

// Cangkuk ciri varian — didaftarkan oleh modul ciri (cloud.ts) sebelum
// bootAdmin() dipanggil. Teras memanggilnya jika hadir; lokal meninggalkannya
// kosong (tiada panggilan berlaku, gelagat = baseline lokal).
export interface AdminFeatureHooks {
  // Awan: lukis senarai peranti TV berpasangan (view 'tv').
  renderTv?: () => void;
  // Awan (superuser): muat + lukis senarai tenant masjid.
  refreshTenants?: () => Promise<void>;
  // Awan: blok lesen pada hujung renderOverview.
  renderOverviewExtra?: () => void;
  // Pemilih peranti DSHOW (datalist pada medan URL stream): pulangkan
  // senarai pilihan daripada peranti yang melapor, atau [] jika tiada
  // (medan kekal teks-bebas seperti biasa). Awan: kesatuan dshow[] peranti
  // terpaut; lokal: devices.json kiosk melalui /api/devices-hw.
  dshowOptions?: () => Promise<DshowOption[]>;
}

export const featureHooks: AdminFeatureHooks = {};

export function registerAdminFeatures(h: AdminFeatureHooks): void {
  Object.assign(featureHooks, h);
}
