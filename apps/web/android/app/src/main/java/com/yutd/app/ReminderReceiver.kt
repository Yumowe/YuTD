package com.yutd.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.UserManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!context.getSystemService(UserManager::class.java).isUserUnlocked) return
        val result = goAsync()
        val wakeLock = context.getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "YuTD:ReminderQueue")
        try {
            wakeLock.acquire(10_000L)
        } catch (error: Exception) {
            Log.e("YuTDReminders", "保持提醒处理唤醒失败", error)
            result.finish()
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (intent.action == ReminderScheduler.ACTION_FIRE) ReminderScheduler.dispatch(context)
                else ReminderScheduler.restore(context)
            } catch (error: Exception) {
                Log.e("YuTDReminders", "滚动安排提醒失败", error)
            } finally {
                try {
                    if (wakeLock.isHeld) wakeLock.release()
                } catch (error: RuntimeException) {
                    Log.w("YuTDReminders", "释放提醒唤醒锁失败", error)
                } finally {
                    result.finish()
                }
            }
        }
    }
}
