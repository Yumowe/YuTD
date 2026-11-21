import { calendarDate, calendarDateKey, calendarWeekday, clockParts, getPhaseWeekNumber, taskDateRange } from '#shared/time'

export {
  addCalendarDays, calendarDate, calendarDateKey, calendarDayNumber, calendarWeekday, clockParts,
  getPhaseWeekCount, inferTimeZone, normalizeTimeZone, parseZonedDateTime, scheduleTimeRange, taskDateRange,
  weekNumberFrom, weekStartDate
} from '#shared/time'

export const weekdays = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日'
]

export function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

export function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60

  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
}

export function dateToWeekday(date: Date, timeZone = 'UTC') {
  return calendarWeekday(calendarDate(date, timeZone))
}

export function dateToMinutes(date: Date | string | number, timeZone: string) {
  const { hour, minute, second } = clockParts(date, timeZone)
  return hour * 60 + minute + second / 60
}

export function formatClockTime(date: Date | string | number, timeZone: string) {
  return minutesToTime(Math.floor(dateToMinutes(date, timeZone)))
}

export function formatLocalDateTime(date: Date | string | number, timeZone: string, precision: 'minute' | 'second' = 'second') {
  const { hour, minute, second } = clockParts(date, timeZone)
  const time = minutesToTime(hour * 60 + minute)
  const seconds = precision === 'second' ? `:${String(second).padStart(2, '0')}` : ''
  return `${calendarDate(date, timeZone)}T${time}${seconds}`
}

export function formatMonthDay(date: Date | string) {
  return calendarDateKey(date).slice(5).replace('-', '/')
}

export function endOfCalendarDay(date: string, timeZone: string) {
  return new Date(taskDateRange(date, timeZone, false).end.getTime() - 1)
}

export function getWeekNumber(
  date: Date | string | null | undefined,
  phase: Parameters<typeof getPhaseWeekNumber>[1] | null | undefined,
  timeZone: string
): number | null {
  if (!date || !phase) return null

  const currentDate = typeof date === 'string' ? date : calendarDate(date, timeZone)
  return getPhaseWeekNumber(currentDate, phase)
}
