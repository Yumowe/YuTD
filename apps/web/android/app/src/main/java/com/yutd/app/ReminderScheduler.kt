package com.yutd.app

import android.app.AlarmManager
import android.app.NotificationManager
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
import org.json.JSONObject
import java.time.Instant

object ReminderScheduler {
    const val ACTION_FIRE = "com.yutd.app.REMINDER_DUE"
    private const val STORE = "yutd-reminder-queue"
    private const val OWNER = "yutd-reminders"
    private const val TAG = "YuTDReminders"
    private const val HISTORY_LIMIT = 200

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
    fun status(context: Context): JSObject {
        val reminders = load(context)
        val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val exact = store.getBoolean("armedExact", false)
        val alarms = context.getSystemService(AlarmManager::class.java)
        val next = reminders.firstOrNull()?.takeIf {
            it.at == store.getLong("armedAt", Long.MIN_VALUE)
                && pendingAlarm(context, PendingIntent.FLAG_NO_CREATE) != null
                && (!exact || Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms())
        }
        return JSObject()
            .put("pending", JSONArray(reminders.map(::describe)))
            .put("mounted", next?.let { describe(it).put("exact", exact) } ?: JSONObject.NULL)
            .put("sent", JSONArray(store.getString("sent", "[]")))
    }

    @Synchronized
    fun dispatch(context: Context) {
        val now = System.currentTimeMillis()
        val reminders = load(context)
        val due = reminders.filter { it.at <= now }
        val future = reminders.filter { it.at > now }
        val sent = mutableListOf<JSObject>()
        try {
            val storage = NotificationStorage(context)
            val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
            val system = context.getSystemService(NotificationManager::class.java)
            for (item in due) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        val channel = system.getNotificationChannel(item.data.optString("channelId"))
                        if (channel == null || channel.importance == NotificationManager.IMPORTANCE_NONE) continue
                    }
                    val notification = JSObject(item.data.toString())
                    notification.remove("schedule")
                    val result = manager.schedule(null, listOf(LocalNotification.buildNotificationFromJSObject(notification)))
                    if (result?.length() == 1) sent += describe(item).put("sentAt", System.currentTimeMillis())
                } catch (error: Exception) {
                    Log.e(TAG, "发布提醒失败：${item.data.optInt("id")}", error)
                }
            }
        } finally {
            save(context, future, sent)
            arm(context, future)
        }
    }

    private fun describe(reminder: Reminder) = JSObject()
        .put("id", reminder.data.getInt("id"))
        .put("title", reminder.data.optString("title"))
        .put("body", reminder.data.optString("body"))
        .put("kind", reminder.data.optJSONObject("extra")?.optString("kind").orEmpty())
        .put("at", reminder.at)

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

    private fun save(context: Context, reminders: List<Reminder>, sent: List<JSObject> = emptyList()) {
        val data = JSONArray()
        reminders.forEach { data.put(it.data) }
        val preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val value = data.toString()
        if (sent.isEmpty() && preferences.getString("queue", null) == value) return
        val editor = preferences.edit().putString("queue", value)
        if (sent.isNotEmpty()) {
            val previous = JSONArray(preferences.getString("sent", "[]"))
            val history = JSONArray(sent.asReversed().take(HISTORY_LIMIT))
            for (index in 0 until minOf(previous.length(), HISTORY_LIMIT - history.length())) {
                history.put(previous.getJSONObject(index))
            }
            editor.putString("sent", history.toString())
        }
        if (!editor.commit()) {
            throw LocalApiException("保存提醒队列失败", "REMINDER_STORAGE_ERROR")
        }
    }

    private fun pendingAlarm(context: Context, flags: Int): PendingIntent? {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ACTION_FIRE)
        return PendingIntent.getBroadcast(context, 0, intent, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun arm(context: Context, reminders: List<Reminder>) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        val store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val next = reminders.firstOrNull()
        store.edit().remove("armedAt").remove("armedExact").apply()
        if (next == null) {
            pendingAlarm(context, PendingIntent.FLAG_NO_CREATE)?.let {
                alarms.cancel(it)
                it.cancel()
            }
            return
        }
        val pending = checkNotNull(pendingAlarm(context, PendingIntent.FLAG_UPDATE_CURRENT))
        var exact = next.data.optBoolean("isExactNotification", false)
            && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms())
        try {
            if (exact) {
                try {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
                } catch (_: SecurityException) {
                    exact = false
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
                }
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, pending)
            }
        } catch (error: RuntimeException) {
            pending.cancel()
            throw LocalApiException("安排系统提醒失败：${error.message}", "REMINDER_SCHEDULE_ERROR")
        }
        store.edit().putLong("armedAt", next.at).putBoolean("armedExact", exact).apply()
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
