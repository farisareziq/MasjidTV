# MasjidTV — Pelan Kerja Akan Datang
> Dikemas kini: 2026-08-19 (selepas sprint e2e+pentest — 8/8 peringkat hijau, CI dibaiki, versi 1.1.0)

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

### B1. Self-updater kiosk (direka, tidak diaktifkan)
`updater.ts` (server) sedia: GitHub Releases + checksum + atomic swap. Kiosk Electron **tiada wiring**.
**Pelan:**
- [ ] Kiosk baca `updater.json` (`{repo, binaryName}`) di sebelah exe → poll 6 jam
- [ ] Rilis GitHub dengan asset `MasjidTV-Kiosk-Setup-x.y.z.exe` + `.sha256` — **workflow `release.yml` sedia (C1 selesai); yang tinggal wiring kiosk**
- [ ] Alternatif: `electron-updater` (NSIS feed) — lebih standard tapi perlu hosting
- Nota: portable exe menggantikan diri sendiri semasa berjalan = GAGAL di Windows; installer NSIS + `app.relaunch` lebih selamat

### B2. Mirror Facebook Live — belum diuji hujung-ke-hujung
Tee muxer diimplement tapi tiada stream key sebenar pernah diuji.
- [ ] Uji dengan FB Live producer sebenar (stream key dari masjid)
- [ ] Sahkan tee `flush_data=1` latensi FB <10sa
- [ ] Jika tee bermasalah → fallback: dua proses ffmpeg berasingan

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

### B6. DSHOW device-picker di web admin
- [ ] Admin-cloud: bila peranti terpaut lapor `dshow[]`, medan URL DSHOW jadi `<datalist>` pilihan
- Nice-to-have

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

### C4. Pemantauan prod
- [ ] Sentry/GlitchTip untuk ralat cloud (kini senyap)
- [ ] Uptime alert luar (UptimeRobot) untuk /api/health — smoke 6 jam sedia ada tapi tiada notifikasi bila gagal? Semak `smoke.yml` action pengumuman
- [ ] Kiosk: log tempatan berputar (`%APPDATA%\MasjidTV\logs`) + muat naik pilihan ke cloud

---

## D. Teknikal hutang kecil

- [x] ~~`e2e-pairing.mjs` + `dry-run-kiosk.mjs`: port dinamik + cleanup robust~~ ✅ (e2e-lib.mjs: taskkill /T /F + killOrphanFfmpeg + exit hooks)
- [ ] `packages/server/src/sqlite-types.d.ts` duplikasi (db + server) — pindah ke satu tempat
- [ ] `pnpm-workspace.yaml` `allowBuilds` termasuk electron-winstaller tapi tidak digunakan — buang jika tak perlu
- [ ] README utama: bahagian mini PC masih terangkan Edge kiosk lama — perlu seksyen kiosk Electron (pasang, pairing, Ctrl+Shift+M, DSHOW/FB mirror)
- [ ] `electron-builder.json` `directories.output` stamp masa — folder `dist-kiosk/*` terkumpul tanpa had; cleanup >7 hari dalam package.mjs (kini manual)
- [ ] Kod SEA legacy (build-exe.mjs/main-exe.ts/public-assets.cjs/asset-zip.cjs) — kekalkan ATAU refactor keluar blok virtual dari app.ts
- [ ] Test pair idempotent (`pairing.test.ts`) menggunakan fixtur masa sebenar — pertimbangkan fake timer

---

## E. Cadangan susunan (next sprint)

| # | Item | Usaha | Nilai |
|---|---|---|---|
| 1 | B1: updater kiosk (NSIS + updater.json; release.yml sedia) | 3-4 jam | Tinggi — kemas kini pelanggan jarak jauh |
| 2 | B2: uji FB mirror sebenar | 1-2 jam | Tinggi — ciri dijual |
| 3 | C3: code signing | bergantung dana | Tinggi pra-edaran |
| 4 | C4: Sentry + uptime alert | 2 jam | Sederhana-Tinggi |
| 5 | B6: datalist DSHOW | 1 jam | Sederhana |
| 6 | README: seksyen kiosk Electron penuh | 1 jam | Sederhana |
| 7 | D: buang kod SEA legacy (refactor app.ts virtual block) | 2 jam | Rendah-Sederhana |

---

## F. Nota keputusan seni bina (rekod)

1. **Relay ffmpeg ialah kerja LOKAL** — walaupun tetapan dari cloud, kamera/OBS peranti fizikal mini PC; cloud tidak boleh menariknya. Streams penuh (dshow url + mirrorUrl) sampai ke kiosk melalui `/api/device/streams` (device-token), TIDAK melalui settings awam (mirrorUrl = stream key rahsia).
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
- **LEAK**: mirrorUrl/stream-key, kredensial rtsp://user:pass, stack trace, PIN bootstrap, hash password
- **CORS & enumerasi**: ACAO terbuka, mesej "user tidak wujud"

Temuan semasa: **0 CRIT, 0 WARN, 1 INFO** (endpoint LAN tanpa auth — diterima, B5).
