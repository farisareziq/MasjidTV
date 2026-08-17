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
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';

/// State stream emitted to any listening player widget (ExoPlayer/media_kit).
class BridgeState {
  final String? url;
  final Rect? slot;
  final bool muted;
  final bool sessionExpired;
  const BridgeState({this.url, this.slot, this.muted = false, this.sessionExpired = false});
}

class MasjidBridge {
  String? _currentUrl;
  Rect? _slot;
  bool _muted = false;
  bool _sessionExpired = false;
  final _controller = StreamController<BridgeState>.broadcast();

  Player? _player;
  VideoController? _videoController;

  // Pemain audio azan/iqamah berasingan daripada pemain strim — ExoPlayer
  // langsung (bukan autoplay WebView yang kerap disekat pada kotak TV).
  // _audioKey ialah kunci dedup daripada display.js (cth "adhan:maghrib:t123")
  // supaya panggilan semula setiap detik tidak memulakan semula audio.
  Player? _audioPlayer;
  String? _audioKey;

  /// Subscribe to play/stop/slot/mute changes (drive media_kit player from here).
  Stream<BridgeState> get states => _controller.stream;
  BridgeState get current => BridgeState(url: _currentUrl, slot: _slot, muted: _muted, sessionExpired: _sessionExpired);

  /// Lazily create the native player (call MediaKit.ensureInitialized first).
  VideoController ensurePlayer() {
    _player ??= Player();
    _videoController ??= VideoController(_player!);
    return _videoController!;
  }

  Future<void> handle(String message) async {
    // Message is JSON like {"method":"playStream","args":["url","name","id"]}
    debugPrint('[bridge] msg: ${message.length > 120 ? message.substring(0, 120) : message}');
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
            // Pemain dimulakan secara malas: elak kos permulaan libmpv
            // pada TV spesifikasi rendah sehingga strim benar-benar perlu.
            ensurePlayer();
            await _player?.open(Media(_currentUrl!));
            if (_player != null) {
              await _player!.setVolume(_muted ? 0 : 100);
            }
            _emit();
          }
          break;
        case 'stopStream':
          await _player?.stop();
          _currentUrl = null;
          _emit();
          break;
        case 'setStreamMuted':
          if (args.isNotEmpty) {
            _muted = args[0] == 'true';
            // Hanya pemain STRIM disenyapkan — flag ini ditetapkan semasa
            // fasa azan/iqamah supaya kamera senyap. Pemain audio azan
            // mesti KEKAL BERBUNYI (jika tidak, azan dimainkan pada volum 0).
            await _player?.setVolume(_muted ? 0 : 100);
            _emit();
          }
          break;
        case 'playAudio':
          // args: [url, dedupKey]. Dedup ikut KUNCI (bukan URL) — fail audio
          // sama untuk azan & iqamah mesti boleh dimainkan dua kali. Kunci
          // sama diabaikan; kunci baharu menghentikan audio sedia ada.
          if (args.isNotEmpty && args[0].isNotEmpty) {
            final k = args.length > 1 ? args[1] : args[0];
            if (k != _audioKey) {
              _audioKey = k;
              _audioPlayer ??= Player();
              await _audioPlayer!.open(Media(args[0]));
              // Sentiasa volum penuh — azan/iqamah tidak tertakluk kepada
              // mute strim (rujuk setStreamMuted di atas).
              await _audioPlayer!.setVolume(100);
              debugPrint('[bridge] playAudio: ${args[0]} (key=$k)');
            }
          }
          break;
        case 'stopAudio':
          await _audioPlayer?.stop();
          _audioKey = null;
          break;
        case 'onSessionExpired':
          debugPrint('[bridge] onSessionExpired — session invalid');
          await _player?.stop();
          _currentUrl = null;
          _sessionExpired = true;
          _emit();
          break;
      }
    } catch (_) {
      // Ignore malformed bridge messages.
    }
  }

  void _emit() => _controller.add(current);

  /// Native video surface positioned at the slot rect reported by display.js.
  Widget streamSurface() {
    if (_currentUrl == null || _slot == null) return const SizedBox.shrink();
    final vc = _videoController;
    if (vc == null) return const SizedBox.shrink();
    return Positioned(
      left: _slot!.left,
      top: _slot!.top,
      width: _slot!.width,
      height: _slot!.height,
      child: Video(controller: vc),
    );
  }

  void dispose() {
    _player?.dispose();
    _player = null;
    _videoController = null;
    _audioPlayer?.dispose();
    _audioPlayer = null;
    _audioKey = null;
    _currentUrl = null;
    _controller.close();
  }
}
