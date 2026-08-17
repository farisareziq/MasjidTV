// WebView display screen with the AndroidBridge JS interface for native
// RTSP/ONVIF/RTMP stream playback (ExoPlayer via media_kit).

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:media_kit/media_kit.dart';
import 'package:webview_flutter/webview_flutter.dart';
// Pelaksana Android — untuk setMediaPlaybackRequiresUserGesture (autoplay
// audio azan/iqamah tanpa gerak isyarat) & debugging WebView jauh.
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'prefs.dart';
import 'bridge.dart';
import 'pairing_screen.dart';

class DisplayScreen extends StatefulWidget {
  final Prefs prefs;
  const DisplayScreen({super.key, required this.prefs});

  @override
  State<DisplayScreen> createState() => _DisplayScreenState();
}

class _DisplayScreenState extends State<DisplayScreen> {
  late final WebViewController _controller;
  final _bridge = MasjidBridge();
  bool _offline = false;
  bool _pageLoaded = false;
  Timer? _networkWaitTimer;
  StreamSubscription<BridgeState>? _bridgeSub;

  @override
  void initState() {
    super.initState();
    MediaKit.ensureInitialized();
    debugPrint('[display] initState url=${widget.prefs.displayUrl}');
    _bridgeSub = _bridge.states.listen((s) {
      if (s.sessionExpired) {
        debugPrint('[display] session expired — returning to pairing');
        _goPairing();
        return;
      }
    });
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF06101F))
      ..addJavaScriptChannel(
        'AndroidBridge',
        onMessageReceived: (msg) => _bridge.handle(msg.message),
      )
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (url) {
          debugPrint('[webview] page finished: $url');
          setState(() {
            _offline = false;
            _pageLoaded = true;
          });
        },
        onWebResourceError: (e) {
          // Abaikan ralat sub-sumber (favicon, gambar, fetch dibatalkan) —
          // halaman utama masih boleh berfungsi. Hanya kegagalan frame
          // utama yang bermakna sambungan terganggu.
          if (e.isForMainFrame != true) return;
          debugPrint('[webview] main-frame error: ${e.description} (${e.errorCode})');
          setState(() => _offline = true);
        },
      ))
      ..enableZoom(false)
      ..loadRequest(Uri.parse(widget.prefs.displayUrl));

    // Autoplay audio (azan/iqamah) tanpa gerak isyarat pengguna — kaedah
    // Android-spesifik, dipanggil pada pelaksana platform seperti contoh
    // rasmi webview_flutter. Tanpa ini WebView menyekat .play() automomatik
    // dan bunyi tidak keluar pada kiosk TV.
    if (_controller.platform is AndroidWebViewController) {
      AndroidWebViewController.enableDebugging(true);
      (_controller.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }

    // Network-wait fallback: retry only if the main page never finished
    // loading (e.g. Wi-Fi still connecting at boot). Never reload a page
    // that is already up — that would interrupt the running display.
    _networkWaitTimer = Timer(const Duration(seconds: 90), () {
      if (!_pageLoaded) {
        debugPrint('[display] page never loaded — retrying');
        _controller.loadRequest(Uri.parse(widget.prefs.displayUrl));
      }
    });
  }

  @override
  void dispose() {
    _networkWaitTimer?.cancel();
    _bridgeSub?.cancel();
    _bridge.dispose();
    super.dispose();
  }

  Future<void> _goPairing() async {
    // Token ditolak server — buang dan minta pautan semula.
    await widget.prefs.clearToken();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const PairingScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_offline)
            const Center(
              child: Text('Connecting to server… / Menghubungi pelayan…'),
            ),
          // Native stream surface (ExoPlayer) rendered above the WebView
          // via the bridge slot rectangle.
          _bridge.streamSurface(),
        ],
      ),
    );
  }
}
