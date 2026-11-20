import { computed, type InjectionKey, type Ref } from 'vue'
import { calendarDate, calendarDayNumber, calendarWeekday, clockParts, timeToMinutes } from '~/utils/date'

type ScheduleEvent = ApiData<Api['api']['event']['get']>[number]
type ScheduleTask = ApiData<Api['api']['task']['get']>[number]

export interface IndexedSchedule {
  event: ScheduleEvent
  schedule: ScheduleEvent['schedules'][number]
  start: number
  end: number
}

interface IndexedTaskTime {
  key: string
  task: ScheduleTask
  kind: 'plan' | 'due'
  minutes: number
}

interface TaskMarker {
  covered: boolean
  offset: number
}

export interface IndexedTaskLine extends IndexedTaskTime {
  normal: TaskMarker
  focused: TaskMarker
}

function taskMarkers(entries: (IndexedTaskTime & { insideEvent: boolean })[], pixelsPerMinute: number) {
  const rows = entries.map(entry => ({
    key: entry.key,
    position: entry.minutes * pixelsPerMinute,
    insideEvent: entry.insideEvent
  }))
  if (pixelsPerMinute <= 0) rows.sort((a, b) => b.position - a.position || a.key.localeCompare(b.key))
  const markers = new Map<string, TaskMarker>()
  let previousMarker = Infinity
  let slot = 0
  for (const [index, row] of rows.entries()) {
    const previous = rows[index - 1]
    const next = rows[index + 1]
    const covered = row.insideEvent
      || (previous !== undefined && Math.abs(previous.position - row.position) < 40)
      || (next !== undefined && Math.abs(next.position - row.position) < 40)
    if (covered) {
      slot = previousMarker - row.position < 18 ? slot + 1 : 0
      previousMarker = row.position
    }
    markers.set(row.key, { covered, offset: covered ? slot * 18 : 0 })
  }
  return markers
}

// 索引由外层持有，三个日期视图只读取对应分组。
export function createScheduleData(
  events: Readonly<Ref<ScheduleEvent[]>>,
  tasks: Readonly<Ref<ScheduleTask[]>>,
  timeZone: Readonly<Ref<string>>,
  weekCount: Readonly<Ref<number>>,
  phaseDay: Readonly<Ref<string>>,
  hourPixels: Readonly<Ref<number>>,
  maxFocusScale: Readonly<Ref<number>>
) {
  const schedules = computed(() => {
    const byPeriod = new Map<string, IndexedSchedule[]>()
    let start = Infinity
    let end = -Infinity
    for (const event of events.value) {
      for (const schedule of event.schedules) {
        const entry = { event, schedule, start: timeToMinutes(schedule.startTime), end: timeToMinutes(schedule.endTime) }
        if (schedule.startTime && schedule.endTime) {
          start = Math.min(start, entry.start, entry.end)
          end = Math.max(end, entry.start, entry.end)
        }
        const weeks = Array.isArray(schedule.weeks)
          ? new Set(schedule.weeks)
          : Array.from({ length: weekCount.value }, (_, index) => index + 1)
        for (const week of weeks) {
          if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > weekCount.value) continue
          const key = `${week}:${schedule.weekday}`
          const entries = byPeriod.get(key) ?? []
          if (!byPeriod.has(key)) byPeriod.set(key, entries)
          entries.push(entry)
        }
      }
    }
    return { byPeriod, start, end }
  })

  const taskTimes = computed(() => {
    const byDate = new Map<string, IndexedTaskTime[]>()
    let start = Infinity
    let end = -Infinity
    for (const task of tasks.value) {
      for (const kind of ['plan', 'due'] as const) {
        const value = kind === 'plan' ? task.plannedDate : task.dueDate
        if (!value) continue
        const date = calendarDate(value, timeZone.value)
        const { hour, minute } = clockParts(value, timeZone.value)
        const minutes = hour * 60 + minute
        const entries = byDate.get(date) ?? []
        if (!byDate.has(date)) byDate.set(date, entries)
        entries.push({ key: `${task.id}-${kind}`, task, kind, minutes })
        start = Math.min(start, minutes)
        end = Math.max(end, minutes)
      }
    }
    for (const entries of byDate.values()) {
      entries.sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))
    }
    return { byDate, start, end }
  })

  const bounds = computed(() => {
    const start = Math.min(schedules.value.start, taskTimes.value.start)
    const end = Math.max(schedules.value.end, taskTimes.value.end)
    return {
      start: Math.floor((Number.isFinite(start) ? start : 8 * 60) / 60) * 60,
      end: Math.ceil((Number.isFinite(end) ? end : 22 * 60) / 60) * 60
    }
  })

  const taskLines = computed(() => {
    const byDate = new Map<string, IndexedTaskLine[]>()
    const phaseStart = calendarDayNumber(phaseDay.value)
    const normalScale = hourPixels.value / 60
    const focusedScale = normalScale * (1 + maxFocusScale.value)
    for (const [date, entries] of taskTimes.value.byDate) {
      const week = Math.floor((calendarDayNumber(date) - phaseStart) / 7) + 1
      const courses = schedules.value.byPeriod.get(`${week}:${calendarWeekday(date)}`) ?? []
      const rows = entries.map(entry => ({
        ...entry,
        insideEvent: courses.some(({ start, end }) => entry.minutes >= start && entry.minutes <= end)
      }))
      const normal = taskMarkers(rows, normalScale)
      const focused = focusedScale === normalScale ? normal : taskMarkers(rows, focusedScale)
      byDate.set(date, entries.map(entry => ({
        ...entry,
        normal: normal.get(entry.key)!,
        focused: focused.get(entry.key)!
      })))
    }
    return byDate
  })

  return { schedules, taskLines, bounds }
}

export const ScheduleDataKey: InjectionKey<ReturnType<typeof createScheduleData>> = Symbol('schedule-data')
