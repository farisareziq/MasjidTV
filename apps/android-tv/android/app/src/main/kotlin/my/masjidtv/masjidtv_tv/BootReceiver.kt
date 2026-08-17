package my.masjidtv.masjidtv_tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.UserManager

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_LOCKED_BOOT_COMPLETED -> {
                // Direct boot (TV powered from cold with a lock credential):
                // credential-encrypted storage is still locked, so Flutter
                // (WebView, shared_preferences) cannot run yet. Show the
                // native device-encrypted-safe waiting screen; it forwards to
                // the Flutter display as soon as the user unlocks.
                val um = context.getSystemService(UserManager::class.java)
                if (um == null || um.isUserUnlocked) {
                    startMain(context)
                } else {
                    context.startActivity(
                        Intent(context, LockedWaitActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
            }
            Intent.ACTION_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON" -> startMain(context)
        }
    }

    private fun startMain(context: Context) {
        context.startActivity(
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
