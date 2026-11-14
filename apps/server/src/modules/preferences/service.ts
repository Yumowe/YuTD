import { BadRequestException, NotFoundException } from 'elysia-http-exception'
import { prisma } from '#backend/lib/prisma'
import { inferTimeZone, normalizeTimeZone } from '#shared/time'
import { bumpDataVersion } from '#backend/lib/version'
import { StyleService } from '../style/service'
import type { PreferencesModelType } from './model'
import { reminderDefaults, reminderTokens } from '#shared/reminders'

function toPreferences(record: Awaited<ReturnType<typeof prisma.preferences.findUniqueOrThrow>>) {
  const { defaultLocale, defaultPhaseId, activeStyleId, sidebarWidth, maxFocusScale, focusColumnScale, hourPixels, edgePixels } = record
  return { defaultLocale, defaultPhaseId, activeStyleId, sidebarWidth: Math.min(135, Math.max(64, sidebarWidth)), maxFocusScale, focusColumnScale, hourPixels, edgePixels,
    timeZone: record.timeZone ?? 'UTC', timeZoneAutomatic: record.timeZoneAutomatic,
    enableReminder: record.enableReminder, enableEventReminder: record.enableEventReminder,
    eventReminderMinutes: record.eventReminderMinutes, eventReminderTitle: record.eventReminderTitle, eventReminderBody: record.eventReminderBody,
    enableTaskReminder: record.enableTaskReminder, taskReminderMinutes: record.taskReminderMinutes,
    taskReminderTitle: record.taskReminderTitle, taskReminderBody: record.taskReminderBody }
}
export abstract class PreferencesService {
  static async ensurePreferences() {
    const style = await StyleService.ensureStyle()
    const current = await prisma.preferences.findUnique({ where: { id: 1 } })
      ?? await prisma.preferences.upsert({
        where: { id: 1 }, create: { id: 1, activeStyleId: style.id }, update: {},
      })
    if (current.activeStyleId !== null && current.timeZone !== null)
      return current
    const updated = await prisma.preferences.update({ where: { id: 1 }, data: {
      activeStyleId: current.activeStyleId ?? style.id,
      timeZone: current.timeZone ?? inferTimeZone(current.defaultLocale),
    } })
    await bumpDataVersion()
    return updated
  }
  static async get() {
    return toPreferences(await this.ensurePreferences())
  }
  static async getTimeZone() {
    return (await this.get()).timeZone
  }
  static async replace(data: PreferencesModelType['replace']) {
    await this.ensurePreferences()
    await this.validateReferences(data)
    return toPreferences(await prisma.preferences.update({ where: { id: 1 }, data: this.normalize(data) }))
  }
  static async update(data: PreferencesModelType['update']) {
    await this.ensurePreferences()
    await this.validateReferences(data)
    return toPreferences(await prisma.preferences.update({ where: { id: 1 }, data: this.normalize(data) }))
  }
  static async reset() {
    const style = await StyleService.ensureStyle()
    return this.replace({
      defaultLocale: 'zh-CN',
      defaultPhaseId: null, activeStyleId: style.id, sidebarWidth: 64,
      maxFocusScale: 2, focusColumnScale: 3, hourPixels: 72, edgePixels: 20,
      timeZone: inferTimeZone('zh-CN'), timeZoneAutomatic: true,
      ...reminderDefaults,
    })
  }
  private static normalize(data: PreferencesModelType['update']) {
    const value = { ...data }
    for (const key of ['eventReminderTitle', 'eventReminderBody', 'taskReminderTitle', 'taskReminderBody'] as const) {
      if (value[key] === undefined) continue
      if (!value[key].trim()) throw new BadRequestException('提醒模板不能为空')
      value[key] = value[key].trim()
      for (const match of value[key].matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        if (!(reminderTokens[key.startsWith('event') ? 'event' : 'task'] as readonly string[]).includes(match[1]!)) throw new BadRequestException(`不支持的提醒占位符：${match[1]}`)
      }
    }
    if (value.defaultLocale !== undefined) {
      value.defaultLocale = value.defaultLocale.trim()
      if (!value.defaultLocale)
        throw new BadRequestException('语言不能为空')
    }
    if (value.timeZone !== undefined) {
      try {
        value.timeZone = normalizeTimeZone(value.timeZone.trim())
      } catch {
        throw new BadRequestException('时区必须是有效的 IANA 时区，例如 Asia/Shanghai')
      }
    }
    return value
  }
  private static async validateReferences(data: PreferencesModelType['update']) {
    if (data.defaultPhaseId != null && !await prisma.phase.findUnique({ where: { id: data.defaultPhaseId } }))
      throw new NotFoundException('默认阶段不存在')
    if (data.activeStyleId != null && !await prisma.style.findUnique({ where: { id: data.activeStyleId } }))
      throw new NotFoundException('启用样式不存在')
  }
}
