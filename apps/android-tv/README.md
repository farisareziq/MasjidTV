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
`BootReceiver.kt`) — ditambah pada binaan Android selepas sambungan Flutter-ke-
native penuh. Untuk Android 10+, tetapkan MasjidTV sebagai Home app.

> Status: scaffolding Flutter lengkap dengan kontrak bridge/API yang sepadan
> rujukan. Integrasi ExoPlayer (media_kit), UVC PiP, dan auto-start masih perlu
> disahkan pada peranti sebenar (lihat Open Questions dalam pelan).
