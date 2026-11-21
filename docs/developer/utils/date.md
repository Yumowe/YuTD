# utils/date.ts

前端日期工具入口是 `~/utils/date`。其中时区、自然周和排期时段的通用实现来自 `shared/time.ts`，Web 后端直接从 `#shared/time` 导入。Android 原生服务使用 Kotlin 的 `java.time` 和 `local/utils/Dates.kt`。

## 日期和时间的约定

- **瞬时**是带偏移的 ISO 时间、JavaScript `Date` 或 Unix 毫秒。展示任务时间、按日筛选和计算提醒时，使用偏好中的 IANA 时区。
- **日历日期**是 `YYYY-MM-DD`。阶段起止、提示的日和周关联属于日历日期。Eden 可能将日期解析为 UTC 零点的 `Date`，可用 `calendarDateKey` 还原原日期。
- **排期时钟**是 `HH:mm`，日期和时区由调用方提供。任务编辑器的 `24:00` 通过 `endOfCalendarDay` 换算为所选日期的最后一毫秒。

## 前端工具

| 函数或常量 | 输入 | 输出 |
| --- | --- | --- |
| `weekdays` | 无 | 周一到周日的中文标签，数组下标从 0 开始。 |
| `timeToMinutes(time)` | `HH:mm`，可传 `24:00` | 从日初起算的分钟数，`24:00` 对应 `1440`。 |
| `minutesToTime(minutes)` | 非负整数分钟 | 补零的 `HH:mm`，`1440` 返回 `24:00`。 |
| `dateToMinutes(date, timeZone)` | 瞬时、IANA 时区 | 当地时钟的分钟数，秒计为小数分钟。 |
| `dateToWeekday(date, timeZone?)` | `Date`，时区默认 `UTC` | 当地星期，周一为 1、周日为 7。 |
| `formatClockTime(date, timeZone)` | 瞬时、IANA 时区 | `HH:mm`，保留到分钟。 |
| `formatLocalDateTime(date, timeZone, precision?)` | 瞬时、IANA 时区，精度默认 `second`，可传 `minute` | 可供 `datetime-local` 使用的日期时间字符串，带 `T` 分隔符。 |
| `formatMonthDay(date)` | 日历日期或代表该日期的 UTC `Date` | `MM/DD`，用于日期选择器和课表。 |
| `getWeekNumber(date, phase, timeZone)` | 日历日期或 `Date`、阶段起止日期、IANA 时区 | 阶段内从 1 起算的周次；日期或阶段为空、或日期超界时返回 `null`。 |
| `endOfCalendarDay(date, timeZone)` | 日历日期、IANA 时区 | 所选日期最后一毫秒对应的 `Date`。 |

## 前端和后端共享的工具

以下函数可从 `~/utils/date` 使用。共享的阶段周次校验 `getPhaseWeekNumber` 在前端由 `getWeekNumber` 调用。

| 函数 | 输入 | 输出 |
| --- | --- | --- |
| `calendarDate(value, timeZone)` | 瞬时、IANA 时区 | 当地日历日期。 |
| `calendarDateKey(value)` | 日历日期、包含该日期的 ISO 字符串或代表该日期的 UTC `Date` | 原日历日期键 `YYYY-MM-DD`。 |
| `clockParts(value, timeZone)` | 瞬时、IANA 时区 | 当地的 `{ hour, minute, second }`。 |
| `addCalendarDays(date, days)` | 日历日期、有符号整数天数 | 加减后的日历日期。 |
| `calendarDayNumber(date)` | 日历日期 | 与 `1970-01-01` 相差的自然日数。 |
| `calendarWeekday(date)` | 日历日期 | 星期编号，周一为 1、周日为 7。 |
| `weekStartDate(date)` | 日历日期 | 所在自然周的周一日期。 |
| `weekNumberFrom(date, startDate)` | 两个日历日期 | 相对起始日的周次，起始日所在的七天为第 1 周，起始日前可返回 0 或负数。 |
| `getPhaseWeekNumber(date, phase)` | 日历日期、含 `startDate` 和 `endDate` 的阶段 | 阶段内周次，超界返回 `null`。 |
| `getPhaseWeekCount(startDate, endDate)` | 阶段起止日期，可传表示日历日期的 UTC `Date` | 阶段覆盖的周数，含首尾日期。 |
| `parseZonedDateTime(value, timeZone, disambiguation?)` | 日历日期、本地日期时间或带偏移的 ISO 时间、IANA 时区。默认 `reject`，可传 `compatible` | 对应的 `Date`。日期取当地日初；带偏移时间保留原瞬时；对于没有偏移的日期时间，默认拒绝夏令时缺口或重复时刻。 |
| `taskDateRange(date, timeZone, weekly)` | 日历日期、IANA 时区，`weekly` 为 `true` 时取自然周 | `startDate`、`endDate` 为含首尾的日历日期；`start`、`end` 为半开区间 `[start, end)` 的 `Date`。 |
| `scheduleTimeRange(date, startTime, endTime, timeZone)` | 日历日期、两个 `HH:mm`、IANA 时区 | `{ start, end }` 两个 `Date`。结束时钟早于或等于开始时钟时跨到下一天；开始时间因时区跳变移出所选日期时返回 `null`。 |
| `normalizeTimeZone(value)` | 时区名称 | 当前运行时识别的规范时区名，非法值抛错。 |
| `inferTimeZone(locale)` | 语言地区标签 | 对应的默认 IANA 时区，未知或无效地区返回 `UTC`。 |

例如，`calendarDate('2026-11-20T17:00:00Z', 'Asia/Hong_Kong')` 返回 `2026-11-21`。只需要所选周的周一时调用 `weekStartDate(date)`；需要按时区查询整周时再调用 `taskDateRange(date, timeZone, true)`。

当地日初取该日第一个有效时刻。遇到夏令时切换时，`compatible` 对重复时刻采用较早的瞬时，对缺口采用向后调整的瞬时。[Temporal 日历日期](https://tc39.es/proposal-temporal/docs/plaindate.html) · [Temporal 时区消歧](https://tc39.es/proposal-temporal/docs/timezone.html)

## 复用检查

- 课程表和时间尺共用分钟转换，课程表和日期选择器共用短日期显示、阶段周次。任务录入、延期和详情提示共用本地时间格式。
- 任务跨日刷新、提示日期关联和提醒计划使用共享的日期换算。课程提醒与每日提示的跨午夜排期共用 `scheduleTimeRange`。
- `shared/attention.ts` 中的 `dailyTipGroups` 当前没有调用方。每日提示使用 `visibleDailyTips`，两者的筛选和排序规则有差异。提醒文案和提醒检查页保留各自的地区格式。
