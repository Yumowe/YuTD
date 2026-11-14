import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import type { NativeBridge } from '~/api/native'
import { addCalendarDays, calendarDate, calendarWeekday, parseZonedDateTime, taskDateRange } from '#shared/time'

type ReminderData = Awaited<ReturnType<NativeBridge['getReminderData']>>

export function reminderText(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, token: string) => values[token] ?? '')
    .split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}

export function planReminders(data: ReminderData, now = new Date(), exact = false): LocalNotificationSchema[] {
  const { preferences: p, tasks, events, phases, tips } = data
  if (!p.enableReminder) return []
  const timeZone = p.timeZone
  const open = tasks.filter(task => !task.completed && task.status !== 'DONE' && task.status !== 'CANCELLED')
  const candidates = new Map<string, { at: Date, title: string, body: string, kind: string, targetId: number }>()
  const formatTime = (date: Date) => new Intl.DateTimeFormat(p.defaultLocale, {
    timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date)
  function relatedTips(phaseId: number, date: Date, eventId?: number | null, taskId?: number) {
    const day = calendarDate(date, timeZone)
    const week = taskDateRange(day, timeZone, true).startDate
    const matchDate = (item: { date: string, phaseId?: number | null }, selected: string) => item.date === selected && (item.phaseId == null || item.phaseId === phaseId)
    return tips.filter(tip => tip.phases.some(phase => phase.id === phaseId)
      || tip.events.some(event => event.id === eventId) || tip.tasks.some(task => task.id === taskId)
      || tip.dates.some(value => matchDate(value, day)) || tip.weeks.some(value => matchDate(value, week)))
      .map(tip => tip.content).join('\n')
  }
  function add(key: string, at: Date, date: Date, kind: 'event' | 'task', targetId: number, values: Record<string, string>) {
    if (!Number.isFinite(at.getTime()) || at <= now) return
    const title = reminderText(kind === 'event' ? p.eventReminderTitle : p.taskReminderTitle, values) || values.title!
    const body = reminderText(kind === 'event' ? p.eventReminderBody : p.taskReminderBody, values) || formatTime(date)
    candidates.set(key, { at, title, body, kind, targetId })
  }
  if (p.enableTaskReminder) {
    for (const task of open) {
      const due = task.dueDate ? new Date(task.dueDate) : null
      const event = events.find(event => event.id === task.eventId)
      const times = task.reminders.map(reminder => new Date(reminder.time))
      if (due) times.push(new Date(due.getTime() - p.taskReminderMinutes * 60000))
      for (const at of times) {
        const date = due ?? at
        add(`task:${task.id}:${at.getTime()}`, at, date, 'task', task.id, {
          title: task.title, time: formatTime(date), description: task.description ?? '', task: task.title,
          event: event?.name ?? '', tips: relatedTips(task.phaseId, date, task.eventId, task.id)
        })
      }
    }
  }
  if (p.enableEventReminder) {
    for (const event of events) {
      const phase = phases.find(phase => phase.id === event.phaseId)
      if (!phase) continue
      const first = phase.startDate.slice(0, 10)
      const end = phase.endDate.slice(0, 10)
      for (const schedule of event.schedules) {
        if (!Array.isArray(schedule.weeks)) continue
        for (const week of schedule.weeks) {
          if (typeof week !== 'number' || !Number.isInteger(week) || week < 1) continue
          const weekStart = addCalendarDays(first, (week - 1) * 7)
          const day = addCalendarDays(weekStart, (schedule.weekday - calendarWeekday(weekStart) + 7) % 7)
          if (day > end) continue
          const date = parseZonedDateTime(`${day}T${schedule.startTime}`, timeZone, 'compatible')
          if (calendarDate(date, timeZone) !== day) continue
          const endDay = schedule.endTime <= schedule.startTime ? addCalendarDays(day, 1) : day
          const finish = parseZonedDateTime(`${endDay}T${schedule.endTime}`, timeZone, 'compatible')
          add(`event:${schedule.id}:${date.getTime()}`, new Date(date.getTime() - p.eventReminderMinutes * 60000), date, 'event', event.id, {
            title: event.name, time: `${formatTime(date)} — ${formatTime(finish)}`,
            location: schedule.location || event.location || '', event: event.name,
            task: open.filter(task => task.eventId === event.id).map(task => task.title).join('、'),
            tips: relatedTips(event.phaseId, date, event.id)
          })
        }
      }
    }
  }
  const ids = new Set<number>()
  return [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
    let hash = 0
    for (const char of key) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0
    let id = (hash & 0x7fffffff) || 1
    while (ids.has(id)) id = id === 0x7fffffff ? 1 : id + 1
    ids.add(id)
    const signature = JSON.stringify([key, item.title, item.body, exact])
    return { id, title: item.title, body: item.body, schedule: { at: item.at, allowWhileIdle: true },
      channelId: 'yutd-reminders', smallIcon: 'ic_stat_reminder', isExactNotification: exact,
      extra: { owner: 'yutd-reminders', signature, kind: item.kind, targetId: item.targetId } }
  })
}
