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
├── apps/kiosk/           # Kiosk Electron mini PC: server terbenam + paparan
│                         #   fullscreen + pairing + relay ffmpeg + DSHOW/OBS
├── scripts/              # run-e2e (8 peringkat), pentest, dry-run, e2e-pairing,
│                         #   dry-run-kiosk, build-dist, deploy-cloud, turso-backup
├── tools/                # license-gen.mjs (alat lesen OFFLINE — kunci peribadi luar repo)
└── .github/workflows/    # CI (typecheck+lint+test+e2e), backup harian, smoke 6j, release tag
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
pnpm test                  # unit + integration (vitest, 123 ujian)
node scripts/dry-run.mjs   # E2E: API, JAKIM, keselamatan, CRUD, muat naik
node scripts/pentest.mjs   # pentest keselamatan penuh (cloud + server lokal)
node scripts/run-e2e.mjs   # SEMUA peringkat: build→typecheck→lint→test→
                           #   dry-run→pentest→e2e-pairing→dry-run-kiosk
```

`run-e2e.mjs` — satu arahan untuk keseluruhan saluran ujian (8 peringkat,
fail-fast, ringkasan hijau/merah). `--fast` melangkau dry-run-kiosk (perlu
Windows + Electron); `--only nama1,nama2` untuk peringkat terpilih.

**Pentest** (`scripts/pentest.mjs`) — ujian keselamatan automatik berorientasi
OWASP API Top 10 terhadap cloud lokal + server lokal: isolasi tenant (BOLA),
JWT falsifikasi (alg none / rahsia salah), SQL/NoSQL injection, XSS tersimpan,
path traversal, validasi upload (magic bytes), rate-limit brute-force,
kebocoran rahsia (kredensial kamera rtsp://user:pass, hash password),
header keselamatan (CSP/XFO/nosniff), CORS, enumerasi pengguna, pairing
brute-force + kod dipakai semula. Keluar 0 = tiada temuan kritikal.

**Nota keselamatan kiosk LAN**: endpoint `/api/devices-hw` dan
`/api/streams-status` dilayan tanpa auth dalam LAN (nama kamera/status
sahaja — tiada kredensial). Diterima untuk operasi kiosk; dilaporkan sebagai
INFO oleh pentest pada setiap larian.

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
   GitHub. Setiap larian mengesahkan SEMUA jadual cloud hadir (fail-loud)
   dan menjalankan drill restore round-trip. Pulih:
   `node scripts/turso-restore.mjs <backup.json> --yes`
   (destruktif — truncate + reinsert).
 6. **Smoke berkala** — workflow `Prod Smoke Test` (setiap 6 jam) memerlukan
    variable `MASJIDTV_PROD_URL` di GitHub (gagal awal dengan jelas jika
    tidak ditetapkan). Kegagalan smoke membuka/mengulas issue GitHub berlabel
    `ci-alert` (fallback lalai — tiada konfigurasi tambahan); Discord/Slack
    webhook (`DISCORD_WEBHOOK_URL`/`SLACK_WEBHOOK_URL` secret) sebagai
    saluran tambahan jika ditetapkan.
7. **Kiosk mini PC** — pasang `MasjidTV-Kiosk-Setup-x.y.z.exe` (lihat seksyen
   Kiosk di bawah); sahkan pairing, paparan, DSHOW/OBS, autostart, dan
   tahan-reboot pada peranti sebenar.
8. **Android TV** — sahkan ExoPlayer/UVC/auto-start pada TV sebenar sebelum
   bergantung padanya.

## Kiosk (Windows mini PC — Electron)

App kiosk Electron ialah cara pasang semasa ini (menggantikan Edge kiosk +
watchdog lama). Satu proses memiliki SEMUA: pelayan Fastify terbenam, tetingkap
kiosk fullscreen, relay ffmpeg, pairing cloud, autostart.

```powershell
# Bina installer (NSIS + portable) — perlu sekali:
node apps/kiosk/tools/download-ffmpeg.mjs   # bundel ffmpeg (sekali; saiz ikut upstream BtbN)
pnpm --filter @masjidtv/kiosk package       # -> apps/kiosk/dist-kiosk/<stamp>/

# Pasang: jalankan MasjidTV-Kiosk-Setup-x.y.z.exe (atau Portable).
# Jalankan dev: pnpm --filter @masjidtv/kiosk dev
```

Ciri utama kiosk:
- **Pairing**: skrin kod 6-digit automatik → tuntut di Web Admin Cloud
  (Peranti TV). Hot-activation — tiada restart.
- **Ctrl+Shift+M**: menu tersembunyi (status pairing, kamera PnP, peranti
  DSHOW/OBS, status stream, unpair).
- **OBS DSHOW**: peranti `video=OBS Virtual Camera` dikesan dan boleh
  dijadikan stream (relay ffmpeg lokal → HLS).
- **Offline-first**: cloud putus → paparan kekal dari cache; cloud kembali →
  catch-up automatik (jambatan SSE).
- **Autostart**: didaftarkan automatik kali pertama (shortcut Startup folder);
  `--no-autostart` untuk kedai demo.
- **Ketahanan**: renderer crash → reload; 401 transien semasa restart cloud
  tidak memutuskan pairing (probe pengesahan sebelum auto-reset unpair).

Rilis automatik: tag `v*` → workflow `release.yml` membina installer di
windows-latest dan memuat naik ke GitHub Release (dengan `.sha256`).

### Server lokal lama (alternatif tiada-Electron)

`node scripts/build-exe.mjs` masih tersedia (binari SEA tunggal ~92MB vs
installer Electron ~138MB) dan `install-kiosk.ps1` (Edge kiosk + watchdog)
untuk pemasangan lama — tetapi kiosk Electron ialah laluan utama.

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
