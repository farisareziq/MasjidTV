# MasjidTV — Pelan Kerja Akan Datang
> Dikemas kini: 2026-08-19 (selepas kiosk Electron stabil, OBS live berjalan di mini PC)

## Status semasa (ringkas)

| Komponen | Status |
|---|---|
| Cloud multi-tenant (Vercel+Turso) | ✅ Production, smoke setiap 6 jam, backup harian |
| Kiosk Electron mini PC | ✅ Stabil — pairing Android TV, SSE <2sa, OBS DSHOW, autostart, hidden menu |
| Server lokal (legacy zip) | ⚠️ Masih disokong tapi usang berbanding kiosk |
| Android TV (Flutter) | ✅ Berjalan (tiada SSE/DSHOW — ExoPlayer native) |
| Ujian | 122/122 unit, E2E + dry-run 8 peringkat hijau |

---

## A. Isu ditemui semasa audit (perlu tindakan)

### A1. CI tak pernah berjalan pada push ⚠️ PENTING
`ci.yml` trigger `branches: [main]` tetapi repo guna `master` — CI hanya jalan bila ada PR.
**Fix:** tukar trigger ke `master` (atau kedua-duanya). (Semak: `gh run list` — tiada run CI langsung.)

### A2. CI typecheck tak termasuk `@masjidtv/kiosk`
Pakej kiosk baharu tidak diperiksa di CI — regression kiosk tidak akan dikesan.
**Fix:** tambah `pnpm --filter @masjidtv/kiosk typecheck` pada step Typecheck.
Nota: kiosk perlu `@masjidtv/server` dist — pastikan Build workspace deps merangkuminya.

### A3. Lint warnings berbaki (2)
- `apps/kiosk/main/index.ts:28` — `mainWindow` assigned tak digunakan (crash-recovery reference; tambah `void mainWindow` atau gunakan semula)
- `packages/frontend/src/display.ts:1423` — `sseAlive` tak digunakan (buang atau jadikan indikator status debug)

### A4. Artifacts usang di Desktop & release/
- `masjidtv.exe` (SEA lama, 4:12PM) — digantikan kiosk Electron; buang atau tanda usang
- `masjidtv-1.0.1-win-x64.zip` + `.sha256` — pakej Windows lama (Edge kiosk); sama
- `scripts/build-exe.mjs` + `packages/server/src/main-exe.ts` + `public-assets.cjs` + `asset-zip.cjs` — kod SEA kini mati/redundan (kiosk Electron ganti). **Keputusan:** padam atau kekalkan sebagai alternatif tiada-Electron (~92MB vs 138MB)

### A5. Versi 1.0.0 kekal
Semua artifact bernama sama `1.0.0` — upgrade hadapi pertembungan nama fail & sukar bezakan build.
**Fix:** naikkan ke `1.1.0` (kiosk + server + cloud serentak) sebelum edaran pelanggan seterusnya.

---

## B. Ciri tertangguh / belum lengkap

### B1. Self-updater kiosk (direka, tidak diaktifkan)
`updater.ts` (server) sedia: GitHub Releases + checksum + atomic swap. Kiosk Electron **tiada wiring**.
**Pelan:**
- [ ] Kiosk baca `updater.json` (`{repo, binaryName}`) di sebelah exe → poll 6 jam
- [ ] Rilis GitHub dengan asset `MasjidTV-Kiosk-Setup-x.y.z.exe` + `.sha256`
- [ ] Alternatif: `electron-updater` (NSIS feed) — lebih standard tapi perlu hosting
- Nota: portable exe menggantikan diri sendiri semasa berjalan = GAGAL di Windows; installer NSIS + `app.relaunch` lebih selamat

### B2. Mirror Facebook Live — belum diuji hujung-ke-hujung
Tee muxer diimplement tapi tiada stream key sebenar pernah diuji.
- [ ] Uji dengan FB Live producer sebenar (stream key dari masjid)
- [ ] Sahkan tee `flush_data=1` latensi FB <10sa
- [ ] Jika tee bermasalah → fallback: dua proses ffmpeg berasingan (input dshow pakai `dshow_dup`?? — sebenarnya: 1 ffmpeg baca peranti, output pipe, ffmpeg kedua dua-cabang; atau `-f tee` kekal)

### B3. Android TV — tiada SSE instant sync
App TV poll 10sa; kiosk & web sudah SSE <2sa.
- [ ] Flutter `SseClient` (package `sse` atau manual `http` streaming) ke `/api/events`
- [ ] Fallback poll kekal
- Prioriti rendah (TV native ExoPlayer sudah rendah-latency RTSP)

### B4. Android TV — tiada laporan kamera/perkakasan
Kiosk lapor kamera+DSHOW ke web admin; Android TV tidak.
- [ ] `device_info` plugin → `/api/device/report` berkala
- Prioriti rendah

### B5. Endpoint tanpa-auth di kiosk LAN (risiko rendah, dinotakan)
- `/api/devices-hw` — nama kamera PnP + DSHOW (LAN sahaja, tiada kredensial)
- `/api/streams-status` — nama stream + status + lastError (LAN sahaja)
Diterima untuk operasi kiosk; **dokumentasikan** dalam README keselamatan. Jika perlu ketat: bind 127.0.0.1 untuk endpoint ini bila mod kiosk.

### B6. DSHOW device-picker di web admin
Nama peranti dipapar (copy-paste) tapi tiada dropdown langsung dalam borang stream.
- [ ] Admin-cloud: bila peranti terpaut lapor `dshow[]`, medan URL DSHOW jadi `<datalist>` pilihan
- Nice-to-have

---

## C. Peningkatan operasi

### C1. Rilis binaan automatik (GitHub Actions)
Bina kiosk installer setiap tag — masa ini manual (`node apps/kiosk/tools/package.mjs`).
- [ ] Workflow `release.yml`: tag `v*` → build kiosk (windows-latest, electron-builder) → upload artifact + GitHub Release
- [ ] ffmpeg download dalam CI (cache Actions)

### C2. Dry-run/E2E dalam CI
`e2e-pairing.mjs` + `dry-run-kiosk.mjs` hanya lokal (perlukan Windows + OBS). Minimum:
- [ ] `dry-run-kiosk` (tanpa OBS — peringkat lain semua) di windows-latest runner
- [ ] Port dinamik (elak berlanggar) — kini hardcode 3211/3299

### C3. Code-signing installer
Smart App Control menyekat exe tidak ditandatangani (dilalui "Run anyway" semasa ujian).
- [ ] Sertifikat code-signing (OV ~RM400-800/thn / Azure Trusted Signing USD9.99/bln)
- **Pra-syarat edaran pelanggan meluas**

### C4. Pemantauan prod
- [ ] Sentry/GlitchTip untuk ralat cloud (kini senyap)
- [ ] Uptime alert luar (UptimeRobot) untuk /api/health — smoke 6 jam sedia ada tapi tiada notifikasi bila gagal? Semak `smoke.yml` action pemgumuman
- [ ] Kiosk: log tempatan berputar (`%APPDATA%\MasjidTV\logs`) + muat naik pilihan ke cloud

---

## D. Teknikal hutang kecil

- [ ] `scripts/e2e-pairing.mjs` + `dry-run-kiosk.mjs`: port dinamik + cleanup proses robust (kini boleh tinggal ffmpeg yatim jika gagal di tengah jalan)
- [ ] `packages/server/src/sqlite-types.d.ts` duplikasi (db + server) — pindah ke satu tempat atau naik taraf `@types/node`
- [ ] `pnpm-workspace.yaml` `allowBuilds` termasuk electron-winstaller tapi tidak digunakan — buang jika tak perlu
- [ ] README utama belum dokumentasikan: kiosk Electron (pasang, pairing, Ctrl+Shift+M, DSHOW/FB mirror, updater.json) — **bahagian mini PC masih terangkan Edge kiosk lama**
- [ ] `electron-builder.json` `directories.output` stamp masa — folder `dist-kiosk/*` terkumpul tanpa had; cleanup >7 hari dalam package.mjs
- [ ] Test pair idempotent (`pairing.test.ts`) menggunakan fixtur masa sebenar — stabil tapi lambat jika database besar; pertimbangkan fake timer

---

## E. Cadangan susunan (next sprint)

| # | Item | Usaha | Nilai |
|---|---|---|---|
| 1 | A1+A2: CI trigger master + typecheck kiosk | 30 min | Tinggi — elak regression senyap |
| 2 | A5: versi 1.1.0 serentak | 30 min | Tinggi — edaran bersih |
| 3 | A4: buang artifact usang + README kiosk baharu | 1 jam | Sederhana |
| 4 | B1: updater kiosk (NSIS + updater.json) | 3-4 jam | Tinggi — kemas kini pelanggan jarak jauh |
| 5 | C1: rilis automatik via tag | 2-3 jam | Tinggi |
| 6 | B2: uji FB mirror sebenar | 1-2 jam | Tinggi — ciri dijual |
| 7 | C3: code signing | bergantung dana | Tinggi pra-edaran |
| 8 | B6: datalist DSHOW | 1 jam | Sederhana |
| 9 | A3: lint bersih | 15 min | Rendah |

---

## F. Nota keputusan seni bina (rekod)

1. **Relay ffmpeg ialah kerja LOKAL** — walaupun tetapan dari cloud, kamera/OBS peranti fizikal mini PC; cloud tidak boleh menariknya. Streams penuh (dshow url + mirrorUrl) sampai ke kiosk melalui `/api/device/streams` (device-token), TIDAK melalui settings awam (mirrorUrl = stream key rahsia).
2. **`omit_endlist+independent_segments` wajib** untuk HLS live kiosk — tanpa itu hls.js sangka stream tamat dan beku.
3. **Autostart portable** mesti guna shortcut Startup folder — Run key tidak kekal kerana portable launcher exit selepas spawn anak.
4. **OBS Virtual Camera format native sahaja** — jangan paksa `-video_size/-framerate` (Could not set video options).
5. **SAC (Smart App Control)** menyekat exe baru tanpa reputasi — ujian pelanggan mungkin perlu "Run anyway" sekali; code signing menyelesaikan kekal.
