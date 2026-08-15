// SharedPreferences wrapper for cloud URL, tenant key, and device token.
// Mirrors the reference Prefs.kt.

import 'package:shared_preferences/shared_preferences.dart';

class Prefs {
  static const _cloudUrl = 'cloud_url';
  static const _tenantKey = 'tenant_key';
  static const _deviceToken = 'device_token';
  static const _tenantName = 'tenant_name';

  final String cloudUrl;
  final String tenantKey;
  final String deviceToken;
  final String tenantName;

  const Prefs({
    required this.cloudUrl,
    required this.tenantKey,
    required this.deviceToken,
    required this.tenantName,
  });

  bool get hasDeviceToken => deviceToken.isNotEmpty;

  static Future<Prefs> load() async {
    final sp = await SharedPreferences.getInstance();
    return Prefs(
      cloudUrl: sp.getString(_cloudUrl) ?? 'https://tvmasjid.vercel.app',
      tenantKey: sp.getString(_tenantKey) ?? '',
      deviceToken: sp.getString(_deviceToken) ?? '',
      tenantName: sp.getString(_tenantName) ?? '',
    );
  }

  Future<void> saveToken(String token, String tenantName) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_deviceToken, token);
    await sp.setString(_tenantName, tenantName);
  }

  Future<void> saveManual(String url, String key) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString(_cloudUrl, url);
    await sp.setString(_tenantKey, key);
  }

  String get displayUrl {
    if (deviceToken.isNotEmpty) {
      return '$cloudUrl/display?token=$deviceToken';
    }
    if (tenantKey.isNotEmpty) {
      return '$cloudUrl/display?key=$tenantKey';
    }
    return '$cloudUrl/display';
  }
}
