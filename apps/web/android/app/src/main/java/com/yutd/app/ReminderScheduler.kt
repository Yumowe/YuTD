package com.yutd.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.capacitorjs.plugins.localnotifications.LocalNotification
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager
import com.capacitorjs.plugins.localnotifications.NotificationStorage
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher
import com.getcapacitor.CapConfig
import com.getcapacitor.JSObject
import com.yutd.app.local.utils.LocalApiException
import org.json.JSONArray
import java.time.Instant

object ReminderScheduler {
    const val ACTION_FIRE = "com.yutd.app.REMINDER_DUE"
    private const val STORE = "yutd-reminder-queue"
    private const val OWNER = "yutd-reminders"
    private const val TAG = "YuTDReminders"

    private data class Reminder(val data: JSObject, val at: Long)

    @Synchronized
    fun replace(context: Context, notifications: JSONArray): JSObject {
        val now = System.currentTimeMillis()
        val parsed = parse(notifications)
        val reminders = parsed.filter { it.at > now }
        cancelLegacy(context, parsed.map { it.data.getInt("id") })
        save(context, reminders)
        arm(context, reminders)
        return JSObject().put("queued", reminders.size).put("scheduled", if (reminders.isEmpty()) 0 else 1)
    }

    @Synchronized
    fun restore(context: Context) {
        cancelLegacy(context)
        val reminders = load(context).filter { it.at > System.currentTimeMillis() }
        save(context, reminders)
        arm(context, reminders)
    }

    @Synchronized
    fun dispatch(context: Context) {
        val now = System.currentTimeMillis()
        val reminders = load(context)
        val due = reminders.filter { it.at <= now }
        val future = reminders.filter { it.at > now }
        try {
            val storage = NotificationStorage(context)
            val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
            for (item in due) {
                try {
                    val notification = JSObject(item.data.toString())
                    notification.remove("schedule")
                    manager.schedule(null, listOf(LocalNotification.buildNotificationFromJSObject(notification)))
                } catch (error: Exception) {
                    Log.e(TAG, "发布提醒失败：${item.data.optInt("id")}", error)
                }
            }
        } finally {
            save(context, future)
            arm(context, future)
        }
    }

    private fun parse(notifications: JSONArray): List<Reminder> {
        val ids = HashSet<Int>()
        return (0 until notifications.length()).map { index ->
            val data = JSObject(notifications.getJSONObject(index).toString())
            val id = data.getInt("id")
            if (id <= 0 || !ids.add(id) || data.optJSONObject("extra")?.optString("owner") != OWNER) {
                throw LocalApiException("提醒标识无效或重复")
            }
            val at = Instant.parse(data.getJSONObject("schedule").getString("at")).toEpochMilli()
            Reminder(data, at)
        }.sortedWith(compareBy<Reminder> { it.at }.thenBy { it.data.getInt("id") })
    }

    private fun load(context: Context): List<Reminder> = parse(JSONArray(
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString("queue", "[]")
    ))

    private fun save(context: Context, reminders: List<Reminder>) {
        val data = JSONArray()
        reminders.forEach { data.put(it.data) }
        val preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val value = data.toString()
        if (preferences.getString("queue", null) == value) return
        if (!preferences.edit().putString("queue", value).commit()) {
            throw LocalApiException("保存提醒队列失败", "REMINDER_STORAGE_ERROR")
        }
    }

    private fun arm(context: Context, reminders: List<Reminder>) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_FIRE)
        val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val next = reminders.firstOrNull()
        if (next == null) {
            alarms.cancel(pending)
            pending.cancel()
            return
        }
        val exact = next.data.optBoolean("isExactNotification", false)
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms())
        try {
            if (exact) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
                } catch (_: SecurityException) {
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
                }
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
            }
        } catch (error: RuntimeException) {
            throw LocalApiException("安排系统提醒失败：${error.message}", "REMINDER_SCHEDULE_ERROR")
        }
    }

    private fun cancelLegacy(context: Context, knownIds: List<Int> = emptyList()) {
        val storage = NotificationStorage(context)
        val alarms = context.getSystemService(AlarmManager::class.java)
        val preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        if (preferences.getBoolean("legacyCleared", false)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // 旧插件可能在保存记录前就超限，需要连没有记录的系统闹钟一起迁移。
            alarms.cancelAll()
        }
        val ids = knownIds.toMutableSet()
        for (key in storage.getSavedNotificationIds()) {
            val data = storage.getSavedNotificationAsJSObject(key) ?: continue
            if (data.optJSONObject("extra")?.optString("owner") != OWNER || data.isNull("schedule")) continue
            key.toIntOrNull()?.let { ids.add(it) }
            storage.deleteNotification(key)
        }
        for (id in ids) {
            val intent = Intent(context, TimedNotificationPublisher::class.java)
            val flags = PendingIntent.FLAG_NO_CREATE or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            PendingIntent.getBroadcast(context, id, intent, flags)?.let {
                alarms.cancel(it)
                it.cancel()
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE || knownIds.isNotEmpty()) {
            if (!preferences.edit().putBoolean("legacyCleared", true).commit()) {
                throw LocalApiException("保存提醒迁移状态失败", "REMINDER_STORAGE_ERROR")
            }
        }
    }
}
