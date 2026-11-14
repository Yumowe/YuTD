package com.yutd.app.local.preferences

import com.yutd.app.local.LocalDatabase
import com.yutd.app.local.utils.*
import org.json.JSONObject
import java.time.*
import com.yutd.app.local.phase.*
import com.yutd.app.local.style.*

class PreferencesService internal constructor(private val database: LocalDatabase) {
    private val dao = database.preferencesDao()

    internal suspend fun initialize() {
        if (dao.preferences() == null) dao.savePreferences(PreferencesRecord(activeStyleId = database.styles.initialize().id))
    }
    internal suspend fun require(): PreferencesRecord { initialize(); return requireNotNull(dao.preferences()) }
    internal suspend fun saveRecord(value: PreferencesRecord) = dao.savePreferences(value)

    suspend fun get(): PreferencesRecord = database.read { requireNotNull(dao.preferences()) }

    suspend fun update(data: JSONObject, replace: Boolean = false): PreferencesRecord = database.write {
        data.checked(preferenceFields, if (replace) preferenceFields else emptySet())
        val current = requireNotNull(dao.preferences())
        val phaseId = data.nullableId("defaultPhaseId", current.defaultPhaseId)
        if (phaseId != null && database.phases.find(phaseId) == null) {
            throw LocalApiException("默认阶段不存在", "NOT_FOUND")
        }
        val styleId = data.nullableId("activeStyleId", current.activeStyleId)
        if (styleId != null && database.styles.find(styleId) == null) {
            throw LocalApiException("启用样式不存在", "NOT_FOUND")
        }
        val timeZone = data.boundedText("timeZone", current.timeZone, 100)
        try { ZoneId.of(timeZone) } catch (_: Exception) {
            throw LocalApiException("时区必须是有效的 IANA 时区，例如 Asia/Shanghai")
        }
        val result = current.copy(
            enableReminder = data.flag("enableReminder", current.enableReminder),
            enableEventReminder = data.flag("enableEventReminder", current.enableEventReminder),
            eventReminderMinutes = data.decimal("eventReminderMinutes", current.eventReminderMinutes.toDouble(), 0.0, 10080.0, true).toInt(),
            eventReminderTitle = reminderTemplate(data.boundedText("eventReminderTitle", current.eventReminderTitle, 200), true),
            eventReminderBody = reminderTemplate(data.boundedText("eventReminderBody", current.eventReminderBody, 2000), true),
            enableTaskReminder = data.flag("enableTaskReminder", current.enableTaskReminder),
            taskReminderMinutes = data.decimal("taskReminderMinutes", current.taskReminderMinutes.toDouble(), 0.0, 10080.0, true).toInt(),
            taskReminderTitle = reminderTemplate(data.boundedText("taskReminderTitle", current.taskReminderTitle, 200)),
            taskReminderBody = reminderTemplate(data.boundedText("taskReminderBody", current.taskReminderBody, 2000)),
            defaultLocale = data.boundedText("defaultLocale", current.defaultLocale, 40),
            defaultPhaseId = phaseId,
            activeStyleId = styleId,
            sidebarWidth = data.decimal("sidebarWidth", current.sidebarWidth.toDouble(), 64.0, 135.0, true).toInt(),
            maxFocusScale = data.decimal("maxFocusScale", current.maxFocusScale, 0.0, 5.0),
            focusColumnScale = data.decimal("focusColumnScale", current.focusColumnScale, 1.0, 6.0),
            hourPixels = data.decimal("hourPixels", current.hourPixels.toDouble(), 24.0, 200.0, true).toInt(),
            edgePixels = data.decimal("edgePixels", current.edgePixels.toDouble(), 0.0, 100.0, true).toInt(),
            timeZone = timeZone,
            timeZoneAutomatic = data.flag("timeZoneAutomatic", current.timeZoneAutomatic),
        )
        dao.savePreferences(result)
        result
    }

    suspend fun reset(): PreferencesRecord = database.write {
        val result = PreferencesRecord(activeStyleId = database.styles.initialize().id)
        dao.savePreferences(result)
        result
    }

    private fun reminderTemplate(value: String, event: Boolean = false): String {
        val tokens = setOf("title", "time", "task", "event", "tips") + if (event) setOf("location") else setOf("description")
        for (match in Regex("\\{\\{\\s*([^{}]+?)\\s*\\}\\}").findAll(value)) {
            if (match.groupValues[1] !in tokens) throw LocalApiException("不支持的提醒占位符：${match.groupValues[1]}")
        }
        return value
    }
}
