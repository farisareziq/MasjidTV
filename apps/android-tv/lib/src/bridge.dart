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

/// State stream emitted to any listening player widget (ExoPlayer/media_kit).
class BridgeState {
  final String? url;
  final Rect? slot;
  final bool muted;
  const BridgeState({this.url, this.slot, this.muted = false});
}

class MasjidBridge {
  String? _currentUrl;
  Rect? _slot;
  bool _muted = false;
  final _controller = StreamController<BridgeState>.broadcast();

  /// Subscribe to play/stop/slot/mute changes (drive media_kit player from here).
  Stream<BridgeState> get states => _controller.stream;
  BridgeState get current => BridgeState(url: _currentUrl, slot: _slot, muted: _muted);

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
            _emit();
          }
          break;
        case 'playStream':
          if (args.isNotEmpty) {
            _currentUrl = args[0];
            _emit();
          }
          break;
        case 'stopStream':
          _currentUrl = null;
          _emit();
          break;
        case 'setStreamMuted':
          if (args.isNotEmpty) {
            _muted = args[0] == 'true';
            _emit();
          }
          break;
        case 'onSessionExpired':
          _currentUrl = null;
          _emit();
          break;
      }
    } catch (_) {
      // Ignore malformed bridge messages.
    }
  }

  void _emit() => _controller.add(current);

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
    _controller.close();
  }
}
