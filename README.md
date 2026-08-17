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
│   └── frontend/         # Paparan + admin — sumber TypeScript (src/*.ts),
│                         #   dikompile esbuild ke public*/js (pariti penuh)
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

## Senarai semak go-live (deployment)

1. **Env cloud (Vercel)** — tetapkan `TURSO_URL`, `TURSO_AUTH_TOKEN`,
   `JWT_SECRET` (≥ 32 aksara rawak), `LICENSE_PUBLIC_KEY`,
   `VERCEL_BLOB_READ_WRITE_TOKEN`, dan (disyorkan) `MASJIDTV_PUBLIC_URL`.
2. **Deploy** — `node scripts/deploy-cloud.mjs` (preflight automatik selepas
   deploy jika `MASJIDTV_PUBLIC_URL` ditetapkan).
3. **Preflight** — `node scripts/preflight.mjs --url https://<app>.vercel.app
   --pem masjidtv-license-ed25519.pem` — sahkan env, kekuatan JWT, padanan
   kunci lesen, health, header keselamatan, auth 401.
4. **Tukar PIN superuser serta-merta** — PIN bootstrap dicetak dalam log
   deploy; tukar melalui `POST /api/auth/superuser/pin` atau konsol
   `https://<host>/super`.
5. **Sandaran berkala** — workflow `Cloud DB Backup` (harian 02:30 MYT,
   retensi 90 hari) memerlukan secrets `TURSO_URL` + `TURSO_AUTH_TOKEN` di
   GitHub. Pulih: `node scripts/turso-restore.mjs <backup.json> --yes`
   (destruktif — truncate + reinsert).
6. **Smoke berkala** — workflow `Prod Smoke Test` (setiap 6 jam) memerlukan
   variable `MASJIDTV_PROD_URL` di GitHub.
7. **Kiosk mini PC** — `install-kiosk.ps1` → sahkan Edge kiosk, display key,
   akses LAN, dan tahan-reboot pada peranti sebenar. `winget install ffmpeg`
   untuk stream RTSP/RTMP/ONVIF.
8. **Android TV** — sahkan ExoPlayer/UVC/auto-start pada TV sebenar sebelum
   bergantung padanya.

## Kiosk (Windows mini PC)

```powershell
powershell -ExecutionPolicy Bypass -File .\packages\server\scripts\install-kiosk.ps1
```

Menjadualkan tugas (logon/statup), memulakan pelayan + Edge kiosk + watchdog
(10s). ffmpeg diperlukan untuk stream RTSP/RTMP/ONVIF (`winget install ffmpeg`,
laluan boleh diubah melalui `media.ffmpegPath`).

## Cloud (Vercel + Turso + Blob)

Deploy dari akar repo (projek Vercel di-link ke `packages/cloud` sebagai
rootDirectory; CLI bina sendiri bundle fungsi melalui `vercel-build` —
esbuild CJS + perakitan Build Output API v3, tanpa tsc lintas-pakej):

```bash
node scripts/deploy-cloud.mjs   # vercel deploy --prod dari akar repo
```

Deploy baharu diperlukan selepas menukar env (`vercel env ...`).

Env wajib (Vercel → Settings → Environment Variables): `TURSO_URL`,
`TURSO_AUTH_TOKEN`, `JWT_SECRET`, `LICENSE_PUBLIC_KEY`,
`VERCEL_BLOB_READ_WRITE_TOKEN` (lihat `packages/cloud/.env.example`).

### Bootstrap superuser & tenant pertama

1. Boot pertama menjana PIN superuser `admin` rawak → log deploy (juga
   disimpan dalam `%TEMP%\MASJIDTV_SUPERUSER_PIN.txt`). **Tukar serta-merta**:
   `POST /api/auth/superuser/pin` (Bearer token, PIN ≥ 8 aksara) atau dari
   konsol superuser `https://<host>/super`.
2. Cipta tenant: `POST /api/super/tenants` `{name, username, password}` →
   balas `id` + `apiKey` (percubaan 14 hari).
3. Terbitkan lesen: `node tools/license-gen.mjs issue <tenantId>` (PEM di
   mesin vendor), kemudian aktifkan:
   `POST /api/super/tenants/<id>/license` `{code}` → status `licensed`.
4. Paparan/TV guna header `X-Tenant-Key: <apiKey>` pada `/api/settings`,
   `/api/today`, dsb. Admin tenant: `POST /api/auth/login` (username +
   kata laluan tenant).

## Lesen

Kod lesen Ed25519 perpetual; alat penjana berjalan OFFLINE di mesin vendor —
kunci peribadi tidak masuk repo (contoh lokasi luar repo:
`MasjidTV-Licence/masjidtv-license-ed25519.pem`):

```bash
node tools/license-gen.mjs keygen                                   # sekali
node tools/license-gen.mjs issue <tenantId> [path/to/pem]           # terbit
node tools/license-gen.mjs verify <code> <LICENSE_PUBLIC_KEY>       # semak
```

`LICENSE_PUBLIC_KEY` di cloud MESTI sepadan dengan kunci awam PEM yang
menandatangani kod — jika tidak, pengaktifan gagal dengan
`Kod lesen tidak sah`.

### Penjana lesen mudah alih (.exe)

Bina sekali pada mesin pembangunan (perlu Node + esbuild + postject):

```bash
node tools/license-gen-cli/build.mjs   # -> tools/license-gen-cli/masjidtv-license.exe
```

`masjidtv-license.exe` adalah fail tunggal (~90MB, SEA Node) — tiada Node
diperlukan pada mesin vendor. Arahan sama seperti alat repo:

```
masjidtv-license.exe keygen [pem]
masjidtv-license.exe issue <tenantId> [pem]
masjidtv-license.exe verify <code> <publicKeyBase64>
masjidtv-license.exe                  (menu interaktif)
```

PEM lalai disimpan di sebelah exe. Jangan sekali-kali hantar .pem atau
exe+blob sumber kepada pelanggan. Kod yang dijana serasi 100% dengan
verifier cloud (Ed25519, format TVM-).

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

Nota: sumber frontend kini TypeScript sepenuhnya (`packages/frontend/src/*.ts`)
dengan jenis daripada `@masjidtv/shared`; output dikompile esbuild ke
`public*/js` (kelakuan runtime serupa dengan baseline — disemak melalui audit
pariti token + smoke DOM `pnpm --filter @masjidtv/frontend run smoke`).
Deviasi disengajakan daripada baseline: (1) adapter AndroidBridge dua mod
(kaedah terus + postMessage Flutter), (2) pembetulan `data-users` superuser
(baseline menulis `t.id` → "undefined", toggle Users sentiasa ralat).
App Android TV: scaffolding Flutter lengkap (kontrak bridge/API sepadan);
integrasi ExoPlayer/UVC/auto-start perlu disahkan pada peranti sebenar.

## Alatan dibina

- Node.js >= 20, pnpm (npm i -g pnpm)
- better-sqlite3 (lokal): perlu MSVC Build Tools + Python jika tiada prebuilt
- ffmpeg (stream relay) — luaran, tidak dibundel
- Flutter + Android SDK (app TV sahaja)

## Lesen projek

MIT.
