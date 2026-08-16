// Pairing flow: request a 6-char code from the cloud, show it + QR, poll for
// admin confirmation, then store the device token and start the display.

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'prefs.dart';
import 'display_screen.dart';

class PairingScreen extends StatefulWidget {
  final Prefs? prefs;
  const PairingScreen({super.key, this.prefs});

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  String _code = '';
  String _status = 'Starting…';
  Timer? _poll;
  late String _cloudUrl = '';
  // deviceId stabil & berterusan (disimpan pada first run) supaya unpair+pair
  // semula menggunakan baris peranti yang sama, bukan mencipta peranti baru.
  late String _deviceId = '';

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    // Prefs boleh null bila dilalui dari skrin paparan (token ditolak).
    final p = widget.prefs ?? await Prefs.load();
    if (!mounted) return;
    final sp = await SharedPreferences.getInstance();
    var devId = sp.getString('device_id') ?? '';
    if (devId.isEmpty) {
      devId = 'flutter-${DateTime.now().millisecondsSinceEpoch}';
      await sp.setString('device_id', devId);
    }
    if (!mounted) return;
    setState(() {
      _cloudUrl = p.cloudUrl;
      _deviceId = devId;
    });
    _start();
  }

  Future<void> _start() async {
    try {
      final res = await http.post(
        Uri.parse('$_cloudUrl/api/pair/start'),
        headers: {'content-type': 'application/json'},
        body: jsonEncode({'deviceId': _deviceId}),
      );
      if (res.statusCode == 429) {
        setState(() => _status = 'Server busy — retrying…');
        Timer(const Duration(seconds: 30), _start);
        return;
      }
      final data = jsonDecode(res.body);
      setState(() {
        _code = data['code'] as String;
        _status = 'Waiting for admin confirmation…';
      });
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _check());
    } catch (_) {
      setState(() => _status = 'Cannot reach server — retrying…');
      // Retry: TV Wi-Fi may still be connecting at boot.
      Timer(const Duration(seconds: 10), _start);
    }
  }

  Future<void> _check() async {
    try {
      final res = await http.get(
        Uri.parse('$_cloudUrl/api/pair/status?code=$_code&device=$_deviceId'),
      );
      if (res.statusCode == 429) {
        // Dikunci kadar server — jangan rebut, tunggu dan cuba lagi.
        return;
      }
      if (res.statusCode != 200) {
        debugPrint('[pair] status HTTP ${res.statusCode} — keep waiting');
        return;
      }
      final data = jsonDecode(res.body);
      if (data['status'] == 'paired') {
        debugPrint('[pair] status=paired, acquiring...');
        _poll?.cancel();
        final token = data['token'] as String? ?? '';
        if (token.isEmpty) {
          debugPrint('[pair] empty token from server — keep polling');
          return;
        }
        // Sentiasa simpan token terus ke SharedPreferences (bukan melalui
        // widget.prefs yang mungkin null bila datang dari _goPairing).
        final sp = await SharedPreferences.getInstance();
        await sp.setString('device_token', token);
        await sp.setString('tenant_name', data['tenantName'] ?? '');
        debugPrint('[pair] token saved: $token');
        if (!mounted) {
          debugPrint('[pair] NOT MOUNTED after save — aborting nav');
          return;
        }
        // Reload prefs so deviceToken is populated in memory — otherwise
        // displayUrl would omit the token and the page would 401.
        final fresh = await Prefs.load();
        debugPrint('[pair] fresh prefs: token=${fresh.deviceToken} url=${fresh.displayUrl}');
        if (!mounted) {
          debugPrint('[pair] NOT MOUNTED after load — aborting nav');
          return;
        }
        debugPrint('[pair] navigating to display...');
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => DisplayScreen(prefs: fresh)),
        );
        debugPrint('[pair] navigation pushed');
      }
    } catch (e, st) {
      debugPrint('[pair] _check ERROR: $e\n$st');
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Pautkan TV / Pair TV', style: TextStyle(fontSize: 32)),
            const SizedBox(height: 32),
            Text(
              _code.isEmpty ? '······' : _code,
              style: const TextStyle(fontSize: 96, letterSpacing: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 24),
            Text(_status, style: const TextStyle(fontSize: 22)),
            const SizedBox(height: 48),
            const Text(
              'Enter this code in the admin dashboard (TV & Displays).',
              style: TextStyle(fontSize: 18),
            ),
          ],
        ),
      ),
    );
  }
}
