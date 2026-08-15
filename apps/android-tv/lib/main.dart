// MasjidTV Android TV app.
//
// Architecture (mirrors the reference Kotlin app, ported to Flutter):
// - WebView renders the cloud `/display?token=...` page (prayer times, slides,
//   azan/iqamah countdown, YouTube/HLS streams).
// - Native ExoPlayer (media_kit) plays RTSP/ONVIF/RTMP streams that WebView
//   cannot play reliably on low-spec boxes, driven by the AndroidBridge JS
//   interface exposed to same-origin MasjidTV pages.
// - UVC camera PiP (optional, Android 9+ with USB).
// - Pairing flow: 6-char code + QR shown on screen, confirmed in admin.
// - Offline: Service Worker caches /api/today|settings|slides.
// - Auto-start on boot (BOOT_COMPLETED) with network-wait fallback.

import 'package:flutter/material.dart';
import 'src/display_screen.dart';
import 'src/pairing_screen.dart';
import 'src/prefs.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await Prefs.load();
  runApp(MasjidTvApp(prefs: prefs));
}

class MasjidTvApp extends StatelessWidget {
  final Prefs prefs;
  const MasjidTvApp({super.key, required this.prefs});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MasjidTV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(),
      home: prefs.hasDeviceToken
          ? DisplayScreen(prefs: prefs)
          : PairingScreen(prefs: prefs),
    );
  }
}
