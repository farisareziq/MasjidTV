# MasjidTV

Sistem papan tanda digital masjid — reimplementation bersih daripada TVMasjid
dengan **pariti penuh ciri** dan seni bina monorepo berkongsi teras domain.

Monorepo TypeScript (pnpm workspaces): teras domain berkongsi (enjin solat,
JAKIM, zon, hijri, acara), lapisan data Drizzle (SQLite lokal / Turso cloud),
pelayan Fastify lokal offline-first, cloud multi-tenant (Vercel), frontend
vanilla, dan app Android TV (Flutter).

## Struktur

```
MasjidTV/global/
├── packages/
│   ├── shared/           # Teras domain: types, prayers, jakim, zones, hijri,
│   │                     #   events, quran, content, validate (dipakai server+cloud+uji)
│   ├── db/               # Skema Drizzle + client factory (better-sqlite3 lokal,
│   │                     #   @libsql/client cloud)
│   ├── server/           # Pelayan Fastify lokal (offline-first) — pariti penuh
│   │   ├── scripts/      # install/start/uninstall-kiosk.ps1 + watchdog
│   │   └── src/updater   # Self-updater (GitHub Releases, checksum, atomic swap)
│   ├── cloud/            # Cloud multi-tenant Fastify (Vercel + Turso + Blob)
│   └── frontend/         # Paparan + admin (vanilla, baseline daripada rujukan)
├── apps/android-tv/      # App Android TV (Flutter): WebView + ExoPlayer + pairing
├── scripts/              # dry-run E2E, build-dist, deploy-cloud, turso-backup
├── tools/                # license-gen.mjs (alat lesen OFFLINE — kunci peribadi luar repo)
└── .github/workflows/    # CI (typecheck + lint + test + build)
```

## Cipta permulaan (lokal)

```bash
pnpm install
pnpm build
pnpm --filter @masjidtv/server start   # http://localhost:3000
```

Kali pertama: kata laluan admin dijana dan disimpan dalam
`%APPDATA%\MasjidTV\ADMIN_PASSWORD.txt`. Kunci paparan (displayKey) juga dijana
automatik — paparan: `http://<lan-ip>:3000/display?key=<displayKey>`.

## Ujian

```bash
pnpm test               # unit + integration (vitest)
node scripts/dry-run.mjs  # E2E: API, JAKIM, keselamatan, CRUD, muat naik
```

## Kiosk (Windows mini PC)

```powershell
powershell -ExecutionPolicy Bypass -File .\packages\server\scripts\install-kiosk.ps1
```

Menjadualkan tugas (logon/statup), memulakan pelayan + Edge kiosk + watchdog
(10s). ffmpeg diperlukan untuk stream RTSP/RTMP/ONVIF (`winget install ffmpeg`,
laluan boleh diubah melalui `media.ffmpegPath`).

## Cloud (Vercel + Turso + Blob)

```bash
pnpm --filter @masjidtv/cloud build
node scripts/deploy-cloud.mjs
```

Env wajib: `TURSO_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`,
`LICENSE_PUBLIC_KEY`, `VERCEL_BLOB_READ_WRITE_TOKEN` (lihat
`packages/cloud/.env.example`). Superuser lalai: `admin / 00000000`
(wajib tukar PIN).

## Lesen

Kod lesen Ed25519 perpetual; alat penjana berjalan OFFLINE di mesin vendor —
kunci peribadi tidak masuk repo:

```bash
node tools/license-gen.mjs keygen                                   # sekali
node tools/license-gen.mjs issue <tenantId>                         # sahkan di admin
```

## Mod cloud-sync (mini PC)

`CLOUD_URL` + `TENANT_KEY` ditetapkan → pelayan lokal menjadi proksi-cache:
tetapan/slaid/hari ini dicach daripada cloud, URL `/uploads/` ditulis semula
ke hos cloud, admin lokal dilumpuhkan, kelegaan lesen 30 hari atas 403.

## Pariti rujukan

Semua ciri TVMasjid dikekalkan: 60 zon JAKIM + fallback astronomi (13 kaedah),
aliran azan/iqamah/jemaah penuh, audio azan, pengumuman (gambar/video, ticker,
kategori, susunan), banner statik, kutipan tabung, stream langsung (RTSP/RTMP/
ONVIF→HLS ffmpeg, HLS, YouTube, WebRTC), acara Islam auto-sync JAKIM (9),
roster imam/bilal, logo, kandungan putar Quran/hadith dwibahasa, tema/gelap/
terang, warna custom + preset, latar foto + kelegapan, cuaca Open-Meteo,
pelbagai skrin LAN, safe margin, mod ujian, kiosk + watchdog, cloud multi-
tenant + lesen + percubaan 14 hari + pairing TV, cache offline SW.

Nota: frontend guna baseline rujukan (HTML/CSS/JS) dipindahkan verbatim untuk
pariti gelagat penuh; terjemahan TypeScript penuh adalah kerja susulan.
App Android TV: scaffolding Flutter lengkap (kontrak bridge/API sepadan);
integrasi ExoPlayer/UVC/auto-start perlu disahkan pada peranti sebenar.

## Alatan dibina

- Node.js >= 20, pnpm (npm i -g pnpm)
- better-sqlite3 (lokal): perlu MSVC Build Tools + Python jika tiada prebuilt
- ffmpeg (stream relay) — luaran, tidak dibundel
- Flutter + Android SDK (app TV sahaja)

## Lesen projek

MIT.
