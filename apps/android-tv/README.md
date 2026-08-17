# MasjidTV TV — Android TV app (Flutter)

App kiosk Android TV untuk paparan MasjidTV. Hibrid:
- **WebView** — paparan utama (waktu solat, slaid, countdown azan/iqamah, YouTube/HLS)
- **ExoPlayer** (via media_kit) — stream RTSP/ONVIF/RTMP dimainkan native
- **UVC (kamera USB)** — "Papar Terus" sebagai tile PiP (API kamera luaran Android)
- **Pairing TV** — kod di skrin TV → disahkan di admin → peranti dipaut
- **Offline** — Service Worker cache data API; paparan terus berjalan bila internet putus

## Bina APK

Prasyarat: Flutter SDK + Android SDK + JDK 17/21.

```bash
cd apps/android-tv
flutter build apk --debug     # APK ujian
flutter build apk --release   # APK produksi (perlu tandatangan)
```

## Architektur (Flutter, port daripada Kotlin rujukan)

- `lib/main.dart` — titik masuk; pilih pairing vs display berdasarkan token.
- `lib/src/display_screen.dart` — WebView yang memuatkan `/display?token=...`.
- `lib/src/bridge.dart` — `AndroidBridge` JS interface (setStreamSlot/playStream/
  stopStream/setStreamMuted/onSessionExpired) untuk stream native.
- `lib/src/pairing_screen.dart` — kod 6 aksara + poll status + simpan token.
- `lib/src/prefs.dart` — SharedPreferences untuk cloud URL/tenant key/token.

## Nota peranti

- **Mi Box S** (Android 9, ada USB): sokong kamera UVC.
- **Mi TV Stick** (tiada USB): tiada sokongan UVC — hanya paparan + stream.

## Auto-start

Auto-start selepas boot memerlukan `BOOT_COMPLETED` receiver (sepadan rujukan
`BootReceiver.kt`). Untuk Android 10+, tetapkan MasjidTV sebagai Home app.

### Direct boot (bekalan kuasa sejuk / cold power)

TV yang dihidupkan sejuk dengan kunci skrin (credential) menerima
`LOCKED_BOOT_COMPLETED` **sebelum** stor credential-encrypted (CE) dibuka —
Flutter/WebView/shared_preferences belum boleh berjalan pada ketika itu.
Aliran direct boot:

1. `BootReceiver` (`android:directBootAware="true"`) terima
   `LOCKED_BOOT_COMPLETED`.
2. Jika pengguna masih berkunci → lancar `LockedWaitActivity` (native, hanya
   device-encrypted safe — tiada Flutter/CE access) memaparkan
   "waiting for unlock".
3. Selepas buka kunci (`ACTION_USER_UNLOCKED` atau resume), ia beralih
   automatik ke `MainActivity` (paparan Flutter penuh).

Tanpa kunci skrin, `BOOT_COMPLETED` terus melancarkan paparan seperti biasa.

> Nota MIUI/TV: sesetengah TV (cth. MiTV) menyekat auto-start aplikasi pihak
> ketiga — aktifkan "Autostart" untuk MasjidTV dalam Tetapan TV → Apps.

> Status: scaffolding Flutter lengkap dengan kontrak bridge/API yang sepadan
> rujukan. Integrasi ExoPlayer (media_kit) telah disahkan pada peranti
> sebenar (MiTV Android 14, armeabi-v7a): WebView papar, bridge JS live,
> libmpv dimuat. UVC PiP + direct boot sejuk penuh belum diuji pada
> peranti berkunci.
