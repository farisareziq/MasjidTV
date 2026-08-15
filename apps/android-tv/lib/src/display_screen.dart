// WebView display screen with the AndroidBridge JS interface for native
// RTSP/ONVIF/RTMP stream playback (ExoPlayer via media_kit).

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'prefs.dart';
import 'bridge.dart';

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
  Timer? _networkWaitTimer;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF06101F))
      ..addJavaScriptChannel(
        'AndroidBridge',
        onMessageReceived: (msg) => _bridge.handle(msg.message),
      )
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) => setState(() => _offline = false),
        onWebResourceError: (_) => setState(() => _offline = true),
      ))
      ..enableZoom(false)
      ..loadRequest(Uri.parse(widget.prefs.displayUrl));

    // Network-wait fallback: retry load after 90s if not yet loaded.
    _networkWaitTimer = Timer(const Duration(seconds: 90), () {
      if (_offline) {
        _controller.loadRequest(Uri.parse(widget.prefs.displayUrl));
      }
    });
  }

  @override
  void dispose() {
    _networkWaitTimer?.cancel();
    _bridge.dispose();
    super.dispose();
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
          // Native stream surface (ExoPlayer) rendered behind/above WebView
          // via the bridge slot rectangle.
          _bridge.streamSurface(),
        ],
      ),
    );
  }
}
