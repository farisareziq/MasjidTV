# MasjidTV — Pelan Kerja Akan Datang
> Dikemas kini: 2026-08-19 (selepas sprint refaktor + ciri — 7/7 peringkat hijau `--fast`; lihat "Sprint 2026-08-19 (petang)")

## Status semasa (ringkas)

| Komponen | Status |
|---|---|
| Cloud multi-tenant (Vercel+Turso) | ✅ Production, smoke setiap 6 jam, backup harian |
| Kiosk Electron mini PC | ✅ Stabil — pairing Android TV, SSE <2sa, OBS DSHOW, autostart, hidden menu |
| Server lokal (legacy zip/SEA) | ⚠️ Masih disokong tapi usang berbanding kiosk (alternatif tiada-Electron) |
| Android TV (Flutter) | ✅ Berjalan (tiada SSE/DSHOW — ExoPlayer native) |
| Ujian | ✅ 122/122 unit, E2E + pentest + dry-run 8 peringkat hijau (`node scripts/run-e2e.mjs`) |
| CI | ✅ Trigger master+main, typecheck semua pakej termasuk kiosk, e2e dalam CI |

**Sprint 2026-08-19 selesai:**
- [x] A1 CI trigger `master` (dahulu hanya `main` — CI tak pernah jalan pada push)
- [x] A2 typecheck `@masjidtv/kiosk` dalam CI + build server dist dahulu
- [x] A3 lint 100% bersih (0 warning)
- [x] A4 artifact usang dibuang (release/*.zip lama, stamp dist-kiosk lama)
- [x] A5 versi 1.1.0 serentak (root + 5 packages + kiosk + VERSION string + updater)
- [x] C1 `release.yml` — bina installer kiosk automatik pada tag `v*`
- [x] C2/D port dinamik + cleanup pokok proses robust (tiada lagi ffmpeg/electron yatim)
- [x] **PENTEST penuh** (`scripts/pentest.mjs`) — 40+ semakan OWASP: BOLA tenant-silang, JWT falsifikasi, SQLi/NoSQLi, XSS, path traversal, upload, rate-limit, kebocoran stream-key, header keselamatan, CORS, enumerasi. Hasil: **0 kritikal**.
- [x] **Runner e2e penuh** (`scripts/run-e2e.mjs`) — 8 peringkat berurutan fail-fast
- [x] **Fix ketahanan**: 401 transien semasa restart cloud tidak lagi memutuskan pairing (probe pengesahan sebelum auto-reset unpair)
- [x] **Fix env**: `ELECTRON_RUN_AS_NODE` dibuang semasa spawn kiosk dari e2e/dev (agent VS Code menetapkannya — kiosk boot sebagai Node biasa)

---

## A. Isu ditemui semasa audit (diselesaikan)

### A1. CI tak pernah berjalan pada push ✅ SELESAI
`ci.yml` kini trigger `branches: [master, main]`.

### A2. CI typecheck tak termasuk `@masjidtv/kiosk` ✅ SELESAI
Step Typecheck merangkumi kiosk; Build workspace deps membina server dist dahulu.

### A3. Lint warnings berbaki ✅ SELESAI
0 error 0 warning. `mainWindow` kiosk digunakan dalam before-quit (destroy bersih); `sseAlive` dipapar dalam chip debug (`?debug=1` → `sse:live/poll`).

### A4. Artifacts usang ✅ SELESAI (sebahagian)
- `release/*.zip` lama (1.0.0/1.0.1 Edge kiosk) — dibuang.
- Stamp dist-kiosk lama — dibuang (kekal stamp terkini sahaja).
- Kod SEA (`build-exe.mjs`, `main-exe.ts`, `public-assets.cjs`, `asset-zip.cjs`) — **DIKEKALKAN** sebagai alternatif tiada-Electron (~92MB vs 138MB). `package.mjs` kiosk merujuk resolver `.cjs` — buang kod SEA memerlukan refactor app.ts blok virtual dahulu.

### A5. Versi 1.0.0 kekal ✅ SELESAI
Semua pakej 1.1.0 (root, shared, db, server, cloud, frontend, kiosk) + VERSION string + banner + updater currentVersion.

---

## B. Ciri tertangguh / belum lengkap

### B1. Self-updater kiosk ✅ SELESAI (wiring Electron)
`apps/kiosk/main/updater.ts` (342 baris): baca `updater.json` (repo+binaryName, dihantar ke `resources/` oleh `package.mjs`, diekspot `extraResources`) → poll GitHub Releases 6 jam + semakan 60sa selepas mula → banding semver vs `app.getVersion()` → muat turun `MasjidTV-Kiosk-Setup-x.y.z.exe` + sahkan `.sha256` (fail-closed) → **installer NSIS: spawn `/S` senyap + `app.quit()`**; **portable: notis sahaja** (dikesan via `PORTABLE_EXECUTABLE_FILE` / heuristik %TEMP%). Semua panggilan rangkaian ber-timeout, try/catch penuh — tidak boleh crash kiosk. Env: `MASJIDTV_UPDATE_REPO` (uji), `MASJIDTV_DISABLE_UPDATER=1` (mati). Status dipapar dalam menu tersembunyi (Ctrl+Shift+M) melalui endpoint LAN tanpa-auth baharu `/api/update-status` (pola `devices.json` → `/api/devices-hw`; fail `update-status.json` dalam dataDir, throttled 2sa). **Ujian manual pada peranti sebenar masih diperlukan** (pelan ujian: `%TEMP%\kilo\updater-test-plan.md`).

### B2. ~~Mirror Facebook Live~~ — DIBUANG (2026-08-19)
Ciri mirror ke Facebook Live (paparan → FB) dan input FB Live (FB → paparan) dibuang sepenuhnya. Sebab: FB memerlukan log masuk untuk embed plugin (tidak sesuai kiosk 24/7); mirror FB tidak lagi diperlukan. Integrasi live sosial kini melalui **YouTube Live** sahaja (`youtube-nocookie.com` — embed tanpa log masuk).

### B3. Android TV — tiada SSE instant sync
App TV poll 10sa; kiosk & web sudah SSE <2sa.
- [ ] Flutter `SseClient` ke `/api/events`
- [ ] Fallback poll kekal
- Prioriti rendah (TV native ExoPlayer sudah rendah-latency RTSP)

### B4. Android TV — tiada laporan kamera/perkakasan
- [ ] `device_info` plugin → `/api/device/report` berkala
- Prioriti rendah

### B5. Endpoint tanpa-auth di kiosk LAN (risiko rendah, dinotakan)
`/api/devices-hw` + `/api/streams-status` — kini **dikesan oleh pentest.mjs sebagai INFO** (diterima, dilaporkan setiap larian supaya kekal disedari). Dokumentasikan dalam README keselamatan; jika perlu ketat: bind 127.0.0.1 bila mod kiosk.

### B6. DSHOW device-picker di web admin ✅ SELESAI
Medan URL stream jenis DSHOW kini ada `<datalist id="dshowDevices">` — kesatuan `dshow[]` yang dilaporkan semua peranti terpaut. Nilai = `video=<nama>` (skim tepat `streams.ts`), label = nama TV + nama peranti. **Kedua-dua varian**: cloud guna `/api/admin/devices`, lokal guna `/api/devices-hw` (LAN tanpa-auth). Progresif: tiada laporan → medan teks-bebas seperti biasa; tiada perubahan validasi. Pembantu `dshowDeviceName()` menormalkan bentuk `string` (cloud) vs `{name}` (kiosk) — turut membetulkan pra-keadaan `renderTv()` yang boleh papar `video=undefined`.

---

## C. Peningkatan operasi

### C1. Rilis binaan automatik (GitHub Actions) ✅ SELESAI
`release.yml`: tag `v*` → windows-latest → build workspace → download ffmpeg (cache Actions) → `package.mjs` → upload artifact + GitHub Release + `.sha256`.

### C2. Dry-run/E2E dalam CI ✅ SELESAI
- `dry-run.mjs` + `e2e-pairing.mjs` (fallback dev binary, tanpa Windows-only packaged exe) dijalankan dalam CI ubuntu.
- `dry-run-kiosk` (perlu Windows + OBS penuh) kekal manual di mini PC — runner utama melangkaui di luar Windows.
- Port dinamik (e2e-lib.mjs `freePort()`) — tiada berlanggar.

### C3. Code-signing installer
Smart App Control menyekat exe tidak ditandatangani (dilalui "Run anyway" semasa ujian).
- [ ] Sertifikat code-signing (OV ~RM400-800/thn / Azure Trusted Signing USD9.99/bln)
- **Pra-syarat edaran pelanggan meluas**

### C4. Pemantauan prod ✅ SELESAI (scaffold env-gated)
- [x] `packages/cloud/src/reporting.ts` (121 baris) — pelapor Sentry/GlitchTip **tanpa dependency**: hook `onError`, hanya 5xx, POST envelope fire-and-forget (5sa timeout). Aktif hanya bila env `SENTRY_DSN` ditetapkan (no-op selain itu).
- [x] Alert kegagalan smoke 6 jam — step `if: failure()` dalam `smoke.yml` memanggil `scripts/alert.mjs` → POST ke `DISCORD_WEBHOOK_URL` dan/atau `SLACK_WEBHOOK_URL` (secret GitHub). `continue-on-error: true` — alert tidak boleh menggagalkan workflow.
- [x] Kiosk `apps/kiosk/main/crash-report.ts` (179 baris) — `uncaughtException` + `render-process-gone` → log berputar `%APPDATA%\MasjidTV\logs\crash-YYYY-MM-DD.log` (simpan 7 hari, sentiasa aktif). Muat naik pilihan ke `/api/device/report` (medan `errors` baharu, pilihan & disahkan) bila `MASJIDTV_CRASH_UPLOAD=1` + paired; backlog offline dihantar semula (cursor dedup).

**Persediaan prod (manual):** tetapkan `SENTRY_DSN` di Vercel (→ deploy semula); tetapkan secret `DISCORD_WEBHOOK_URL`/`SLACK_WEBHOOK_URL` di GitHub. Tanpa env ini semuanya no-op selamat.

---

## D. Teknikal hutang kecil

- [x] ~~`e2e-pairing.mjs` + `dry-run-kiosk.mjs`: port dinamik + cleanup robust~~ ✅ (e2e-lib.mjs: taskkill /T /F + killOrphanFfmpeg + exit hooks)
- [x] ~~`packages/server/src/sqlite-types.d.ts` duplikasi~~ ✅ dibuang — hanya `packages/db` yang guna `node:sqlite`; salinan server tidak diperlukan
- [x] ~~`dist-kiosk/*` terkumpul tanpa had~~ ✅ `package.mjs` kini auto-cleanup — simpan stamp semasa + terkini sahaja
- [x] ~~`.gitignore` `cloud-data/` hanya padan root~~ ✅ kini `**/cloud-data/`
- [ ] `pnpm-workspace.yaml` `allowBuilds` termasuk electron-winstaller tapi tidak digunakan — buang jika tak perlu
- [ ] README utama: bahagian mini PC masih terangkan Edge kiosk lama — perlu seksyen kiosk Electron (pasang, pairing, Ctrl+Shift+M, DSHOW)
- [ ] Kod SEA legacy (build-exe.mjs/main-exe.ts/public-assets.cjs/asset-zip.cjs) — kekalkan ATAU refactor keluar blok virtual dari app.ts
- [ ] Test pair idempotent (`pairing.test.ts`) menggunakan fixtur masa sebenar — pertimbangkan fake timer

---

## Sprint 2026-08-19 (petang) — refaktor duplikasi + ciri B1/B6/C4

- [x] **Dedup paparan** — `display.ts` (1,448) + `display-cloud.ts` (1,468) kini wrapper 16/19 baris; logik dikongsi dalam `display-core.ts` (1,425 baris) dengan flag varian (`sseHello`, `unpaired503`, `metaKey`, `recoverMissingKey`, `videoGuard`). Dua penyatuan semantik disengajakan (guard double-render, bentuk stall-guard — kedua-duanya mengamalkan kelakuan cloud yang terbukti setara/lebih selamat).
- [x] **Dedup admin + pecahan modul** — `admin.ts` (1,783) + `admin-cloud.ts` (2,339) kini wrapper 15/28 baris; modul baharu `src/admin/`: `core.ts` (1,248), `i18n.ts` (702), `cloud.ts` (271), `api.ts` (181), `types.ts` (162), `util.ts` (50), `local.ts` (9). Kod cloud-only di-tree-shake daripada bundle lokal (0 rujukan `/api/super` dalam output lokal). Bundle menyusut: admin.js lokal 142KB→90KB, cloud 186KB→100KB (i18n tak lagi diduakan).
- [x] **Pecahan cloud app.ts** — 935→157 baris; 9 modul `packages/cloud/src/routes/` (pages, auth, public, admin, super, pairing, device, helpers, context). Tiada plugin encapsulated — pendaftaran route terus pada instance root, susunan hook/parser dikekalkan tepat.
- [x] **Pengetatan `any` frontend** — `api<T>()` generik, interface Hls bertaip minimum, `Elem = HTMLElement & Record<string, unknown>`, jenis respons eksplisit pada semua tapak panggilan (runtime tidak berubah — typecheck+smoke hijau).
- [x] **B1 updater kiosk** — lihat seksyen B1 di atas.
- [x] **B6 datalist DSHOW** — lihat seksyen B6 di atas.
- [x] **C4 pemantauan** — lihat seksyen C4 di atas.
- [x] **Peluasan coverage** — vitest kini meliputi `packages/{shared,server,cloud,db}/src` (dahulu shared sahaja).
- [x] **Pengesahan penuh** — `run-e2e.mjs --fast`: build ✓ typecheck ✓ lint ✓ test (122) ✓ dry-run ✓ pentest ✓ e2e-pairing ✓ = **7/7 hijau** (dry-run-kiosk dilangkau — perlu Windows + Electron).

---

## E. Cadangan susunan (next sprint)

| # | Item | Usaha | Nilai |
|---|---|---|---|
| 1 | ~~B2: uji FB mirror~~ — DIBUANG (FB disekat) | — | — |
| 2 | C3: code signing | bergantung dana | Tinggi pra-edaran |
| 3 | ~~Ujian updater~~ ✅ SELESAI automatik (`scripts/test-updater.mjs` 13/13) | — | — |
| 4 | Persediaan C4 prod: SENTRY_DSN + webhook secret (preflight warn ✅) | 30 min | Sederhana-Tinggi |
| 5 | README: seksyen kiosk Electron penuh | 1 jam | Sederhana |
| 6 | B3/B4: Android TV SSE + laporan perkakasan | 2-3 jam | Rendah-Sederhana |
| 7 | D: buang kod SEA legacy (refactor app.ts virtual block) | 2 jam | Rendah-Sederhana |

## Sprint 2026-08-19 (malam) — penambahbaikan release UX ✅ SELESAI

Commit `79fc0bd` — semua item release kecuali code signing. Fokus: kebolehgunaan
untuk admin masjid **bukan-teknikal** (permukaan pertama yang mereka sentuh).

- [x] **Halaman pairing** (pair.ts): URL admin penuh + langkah 1-2-3 dwibahasa
  (ms/en), countdown tamat tempoh kod, notis "kod baharu dijana", mesej ralat
  mesra (semak internet mini PC) dengan auto-retry 10sa.
- [x] **Admin first-run checklist** (core.ts + admin.html ×2): kad panduan
  "Lengkapkan langkah ini" — profil masjid → zon JAKIM → pengumuman → pair TV.
  Langkah selesai ditanda ✅ + coretan; kad tersembunyi bila semua siap.
- [x] **i18n**: kunci `noTenants` (en+ms — dahulu fallback salah ke
  "No Islamic events yet"); baiki ms bercampur (Username→Nama pengguna,
  Trial→Percubaan, Sync→Segerak); default bahasa admin `ms` (konsisten display).
- [x] **Menu kiosk tersembunyi** (Ctrl+Shift+M): bahasa mudah bukan-teknikal,
  confirm dialog sebelum Nyahpaut (elak unpair tak sengaja), ringkasan sokongan
  satu baris (status/tenant/deviceId/cloud) + capaian internet async,
  `/api/pair/config` pulangkan `deviceId`.
- [x] **Display recovery** (display-core.ts): 401 → panduan re-pair boleh-tindak
  dwibahasa (bukan ayat mati); offline → kad meyakinkan + nota auto-reconnect.
- [x] **Harness updater automatik** (`scripts/test-updater.mjs` — 13/13 lulus):
  pelayan GitHub Releases palsu + mock electron (CJS require cache). Sahkan
  checksum tepat → ready+installer, checksum salah → fail-closed, .sha256 tiada
  → fail-closed, asset tiada → langkau, portable → notis sahaja. Updater kini
  sokong `MASJIDTV_UPDATE_DRY_RUN=1`, `checkOnce()`, `writeStatus(force)`.
- [x] **better-sqlite3 ^11→^13** — prebuilt Node 24 (hilang fallback node:sqlite
  + warning NODE_MODULE_VERSION setiap test run).
- [x] **preflight env prod** (warn-only): SENTRY_DSN, MASJIDTV_PUBLIC_URL,
  webhook smoke (DISCORD/SLACK) — bukan blocker.
- [x] **Pengesahan**: `run-e2e.mjs --fast` 7/7 hijau (build/typecheck/lint/test
  124/dry-run/pentest/e2e-pairing) + smoke DOM + updater 13/13.

**Baki sebelum edaran meluas:** C3 code-signing (sahaja tertangguh — dana).

---

## F. Nota keputusan seni bina (rekod)

1. **Relay ffmpeg ialah kerja LOKAL** — walaupun tetapan dari cloud, kamera/OBS peranti fizikal mini PC; cloud tidak boleh menariknya. Streams penuh (dshow url) sampai ke kiosk melalui `/api/device/streams` (device-token), TIDAK melalui settings awam.
2. **`omit_endlist+independent_segments` wajib** untuk HLS live kiosk — tanpa itu hls.js sangka stream tamat dan beku.
3. **Autostart portable** mesti guna shortcut Startup folder — Run key tidak kekal kerana portable launcher exit selepas spawn anak.
4. **OBS Virtual Camera format native sahaja** — jangan paksa `-video_size/-framerate` (Could not set video options).
5. **SAC (Smart App Control)** menyekat exe baru tanpa reputasi — ujian pelanggan mungkin perlu "Run anyway" sekali; code signing menyelesaikan kekal.
6. **401 transien ≠ unpair** (ditambah 2026-08-19): auto-reset unpair kini memerlukan probe pengesahan kedua (401 berterusan) — restart cloud / cold-start serverless tidak memutuskan pairing kiosk.
7. **`ELECTRON_RUN_AS_NODE` mesti dibuang** semasa spawn Electron dari proses lain (agent VS Code/terminal menetapkannya) — jika tidak, Electron kiosk boot sebagai Node biasa (`require('electron')` = string path, `app` undefined).

---

## G. Ujian & pentest — cara jalan (baru)

```bash
node scripts/run-e2e.mjs            # SEMUA 8 peringkat (~2 minit, Windows)
node scripts/run-e2e.mjs --fast     # langkau dry-run-kiosk (CI/ubuntu)
node scripts/run-e2e.mjs --only pentest,test
node scripts/pentest.mjs            # pentest sahaja (cloud + server lokal)
```

Peringkat: `build → typecheck → lint → test (vitest) → dry-run → pentest → e2e-pairing → dry-run-kiosk`

Pentest meliputi (skrip `scripts/pentest.mjs`):
- **AUTHZ**: akses tanpa auth, isolasi tenant (BOLA) 2-tenant silang, device-token baca-sahaja, role escalation admin→superuser
- **AUTHN**: login salah, brute-force rate-limit (cloud 30x/IP, lokal 5x), user dilumpuhkan → token mati, tukar password → token lama mati, PIN lemah ditolak
- **JWT**: rahsia salah, alg none, token superuser dipalsukan
- **INJECT**: SQLi login (4 payload), NoSQLi, XSS tersimpan (data → escape klien), path traversal `/uploads` `/relay`
- **UPLOAD**: magic bytes palsu, content-type exe
- **DOS**: body 2MB pada laluan biasa (bodyLimit)
- **SEC-HDR**: CSP, X-Frame-Options, nosniff, frame-ancestors API
- **PAIR**: brute force kod (not_found + rate-limit), kod dipakai semula, claim tanpa auth
- **LEAK**: kredensial rtsp://user:pass, stack trace, PIN bootstrap, hash password
- **CORS & enumerasi**: ACAO terbuka, mesej "user tidak wujud"

Temuan semasa: **0 CRIT, 0 WARN, 1 INFO** (endpoint LAN tanpa auth — diterima, B5).
