// Pairing flow: request a 6-char code from the cloud, show it + QR, poll for
// admin confirmation, then store the device token and start the display.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'prefs.dart';
import 'display_screen.dart';

class PairingScreen extends StatefulWidget {
  final Prefs prefs;
  const PairingScreen({super.key, required this.prefs});

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  String _code = '';
  String _status = 'Starting…';
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final res = await http.post(
        Uri.parse('${widget.prefs.cloudUrl}/api/pair/start'),
        headers: {'content-type': 'application/json'},
        body: jsonEncode({'deviceId': 'flutter-${DateTime.now().millisecondsSinceEpoch}'}),
      );
      final data = jsonDecode(res.body);
      setState(() {
        _code = data['code'] as String;
        _status = 'Waiting for admin confirmation…';
      });
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _check());
    } catch (_) {
      setState(() => _status = 'Cannot reach server');
    }
  }

  Future<void> _check() async {
    try {
      final res = await http.get(
        Uri.parse('${widget.prefs.cloudUrl}/api/pair/status?code=$_code&device=flutter'),
      );
      final data = jsonDecode(res.body);
      if (data['status'] == 'paired') {
        _poll?.cancel();
        await widget.prefs.saveToken(data['token'], data['tenantName'] ?? '');
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => DisplayScreen(prefs: widget.prefs)),
        );
      }
    } catch (_) {
      // ignore transient errors
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
            const Text('Pautkan TV / Pair TV', style: TextStyle(fontSize: 24)),
            const SizedBox(height: 24),
            Text(_code, style: const TextStyle(fontSize: 48, letterSpacing: 12)),
            const SizedBox(height: 12),
            Text(_status),
            const SizedBox(height: 32),
            const Text('Enter this code in the admin dashboard (TV & Displays).'),
          ],
        ),
      ),
    );
  }
}
