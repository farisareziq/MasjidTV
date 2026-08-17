package my.masjidtv.masjidtv_tv

import android.app.Activity
import android.content.Intent
import android.content.IntentFilter
import android.content.BroadcastReceiver
import android.content.Context
import android.os.Bundle
import android.os.UserManager
import android.view.Gravity
import android.view.View
import android.widget.TextView

/**
 * Direct-boot waiting screen (device-encrypted safe): shown after
 * LOCKED_BOOT_COMPLETED while credential-encrypted storage is still locked.
 * Uses no Flutter, WebView, or SharedPreferences — those require unlocked CE
 * storage. Forwards to the Flutter display automatically when the user
 * unlocks (ACTION_USER_UNLOCKED) or if this activity resumes already
 * unlocked.
 */
class LockedWaitActivity : Activity() {

    private fun launchMainIfUnlocked(): Boolean {
        val um = getSystemService(UserManager::class.java) ?: return false
        if (!um.isUserUnlocked) return false
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        )
        finish()
        return true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(
            TextView(this).apply {
                text = getString(R.string.locked_wait)
                textSize = 22f
                gravity = Gravity.CENTER
                setTextColor(0xFFF3E5C0.toInt())
                setBackgroundColor(0xFF06101F.toInt())
                textAlignment = View.TEXT_ALIGNMENT_CENTER
            }
        )
    }

    override fun onResume() {
        super.onResume()
        launchMainIfUnlocked()
    }

    private val unlockReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_USER_UNLOCKED) launchMainIfUnlocked()
        }
    }

    override fun onStart() {
        super.onStart()
        registerReceiver(unlockReceiver, IntentFilter(Intent.ACTION_USER_UNLOCKED))
    }

    override fun onStop() {
        try {
            unregisterReceiver(unlockReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }
}
