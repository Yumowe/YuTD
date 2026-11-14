package com.yutd.app.local.preferences

import com.getcapacitor.JSObject
import org.json.JSONObject
import androidx.room.*
import com.yutd.app.local.style.*

@Entity(
    tableName = "preferences",
    foreignKeys = [ForeignKey(
        entity = StyleRecord::class,
        parentColumns = ["id"],
        childColumns = ["activeStyleId"],
        onDelete = ForeignKey.SET_NULL,
    )],
    indices = [Index("activeStyleId")],
)
data class PreferencesRecord(
    @PrimaryKey val id: Int = 1,
    val defaultLocale: String = "zh-CN",
    val defaultPhaseId: Long? = null,
    val activeStyleId: Long? = null,
    val sidebarWidth: Int = 64,
    val maxFocusScale: Double = 2.0,
    val focusColumnScale: Double = 3.0,
    val hourPixels: Int = 72,
    val edgePixels: Int = 20,
    val timeZone: String = "Asia/Shanghai",
    val timeZoneAutomatic: Boolean = true,
    @ColumnInfo(defaultValue = "0") val enableReminder: Boolean = false,
    @ColumnInfo(defaultValue = "1") val enableEventReminder: Boolean = true,
    @ColumnInfo(defaultValue = "10") val eventReminderMinutes: Int = 10,
    @ColumnInfo(defaultValue = "'{{title}}'") val eventReminderTitle: String = "{{title}}",
    @ColumnInfo(defaultValue = "'{{time}} · {{location}}\n{{task}}\n{{tips}}'")
    val eventReminderBody: String = "{{time}} · {{location}}\n{{task}}\n{{tips}}",
    @ColumnInfo(defaultValue = "1") val enableTaskReminder: Boolean = true,
    @ColumnInfo(defaultValue = "30") val taskReminderMinutes: Int = 30,
    @ColumnInfo(defaultValue = "'{{title}}'") val taskReminderTitle: String = "{{title}}",
    // 保持版本 1 的 SQL 默认值，新的通知默认模板由构造参数提供。
    @ColumnInfo(defaultValue = "'截止：{{time}}\n{{event}}\n{{tips}}'")
    val taskReminderBody: String = "截止：{{time}}\n{{description}}",
)

@Dao
interface PreferencesDao {
    @Query("SELECT * FROM preferences WHERE id = 1")
    suspend fun preferences(): PreferencesRecord?
    @Upsert
    suspend fun savePreferences(value: PreferencesRecord)
}

internal fun PreferencesRecord.toJS() = JSObject().apply {
    put("defaultLocale", defaultLocale)
    put("defaultPhaseId", defaultPhaseId ?: JSONObject.NULL)
    put("activeStyleId", activeStyleId ?: JSONObject.NULL)
    put("sidebarWidth", sidebarWidth)
    put("maxFocusScale", maxFocusScale)
    put("focusColumnScale", focusColumnScale)
    put("hourPixels", hourPixels)
    put("edgePixels", edgePixels)
    put("timeZone", timeZone)
    put("timeZoneAutomatic", timeZoneAutomatic)
    put("enableReminder", enableReminder)
    put("enableEventReminder", enableEventReminder)
    put("eventReminderMinutes", eventReminderMinutes)
    put("eventReminderTitle", eventReminderTitle)
    put("eventReminderBody", eventReminderBody)
    put("enableTaskReminder", enableTaskReminder)
    put("taskReminderMinutes", taskReminderMinutes)
    put("taskReminderTitle", taskReminderTitle)
    put("taskReminderBody", taskReminderBody)
}

internal val preferenceFields = setOf(
    "defaultLocale", "defaultPhaseId", "activeStyleId", "sidebarWidth", "maxFocusScale",
    "focusColumnScale", "hourPixels", "edgePixels", "timeZone", "timeZoneAutomatic",
    "enableReminder", "enableEventReminder", "eventReminderMinutes", "eventReminderTitle", "eventReminderBody",
    "enableTaskReminder", "taskReminderMinutes", "taskReminderTitle", "taskReminderBody",
)
