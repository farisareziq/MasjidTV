// AndroidBridge JS interface — exposed only to same-origin MasjidTV pages
// (the WebView is loaded with the cloud display URL). Methods mirror the
// reference Kotlin Bridge.kt contract that display.js calls:
//   AndroidBridge.setStreamSlot(x, y, w, h)
//   AndroidBridge.playStream(url, name, id)
//   AndroidBridge.stopStream(id)
//   AndroidBridge.setStreamMuted(muted)
//   AndroidBridge.onSessionExpired()

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';

class MasjidBridge {
  String? _currentUrl;
  Rect? _slot;
  bool _muted = false;

  Future<void> handle(String message) async {
    // Message is JSON like {"method":"playStream","args":["url","name","id"]}
    try {
      final decoded = jsonDecode(message);
      if (decoded is! Map<String, dynamic>) return;
      final method = decoded['method'] as String?;
      final args = (decoded['args'] as List?)?.map((e) => e.toString()).toList() ?? [];
      switch (method) {
        case 'setStreamSlot':
          if (args.length >= 4) {
            _slot = Rect.fromLTWH(
              double.parse(args[0]),
              double.parse(args[1]),
              double.parse(args[2]),
              double.parse(args[3]),
            );
          }
          break;
        case 'playStream':
          if (args.isNotEmpty) _currentUrl = args[0];
          break;
        case 'stopStream':
          _currentUrl = null;
          break;
        case 'setStreamMuted':
          if (args.isNotEmpty) _muted = args[0] == 'true';
          break;
        case 'onSessionExpired':
          _currentUrl = null;
          break;
      }
    } catch (_) {
      // Ignore malformed bridge messages.
    }
  }

  Widget streamSurface() {
    return Positioned(
      left: _slot?.left ?? 0,
      top: _slot?.top ?? 0,
      width: _slot?.width ?? 0,
      height: _slot?.height ?? 0,
      child: Container(color: Colors.black),
    );
  }

  void dispose() {
    _currentUrl = null;
  }
}
