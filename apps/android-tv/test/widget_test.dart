// Smoke acceptance test: build PairingScreen & DisplayScreen without crashing.
import 'package:flutter_test/flutter_test.dart';
import 'package:masjidtv_tv/src/pairing_screen.dart';
import 'package:masjidtv_tv/src/display_screen.dart';
import 'package:masjidtv_tv/src/prefs.dart';

void main() {
  testWidgets('PairingScreen renders', (tester) async {
    await tester.pumpWidget(
      const PairingScreen(),
    );
    await tester.pump();
    expect(find.text('Pautkan TV / Pair TV'), findsOneWidget);
  });

  testWidgets('DisplayScreen builds with token prefs', (tester) async {
    await tester.pumpWidget(
      DisplayScreen(prefs: const Prefs(
        cloudUrl: 'https://masjidtv.vercel.app',
        tenantKey: '', deviceToken: 'test', tenantName: 'T',
      )),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.byType(DisplayScreen), findsOneWidget);
  });
}
