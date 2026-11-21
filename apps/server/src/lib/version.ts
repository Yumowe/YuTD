import { prisma } from './prisma'
import { calendarDate } from '#shared/time'

export async function readDataVersion() {
  const info = await prisma.serverInfo.findUnique({ where: { id: 1 }, select: { version: true, updatedAt: true } })
    ?? await prisma.serverInfo.upsert({
      where: { id: 1 }, create: { id: 1 }, update: {}, select: { version: true, updatedAt: true }
    })
  const preferences = await prisma.preferences.findUnique({ where: { id: 1 }, select: { timeZone: true } })
  const timeZone = preferences?.timeZone ?? 'UTC'
  const now = new Date()
  if (calendarDate(info.updatedAt, timeZone) !== calendarDate(now, timeZone)) {
    // 用数据库条件保证跨日时的并发读取只递增一次，重启后也能判断。
    await prisma.serverInfo.updateMany({
      where: { id: 1, version: info.version, updatedAt: info.updatedAt },
      data: { version: { increment: 1n }, updatedAt: now }
    })
    const current = await prisma.serverInfo.findUniqueOrThrow({ where: { id: 1 }, select: { version: true } })
    return { version: current.version.toString() }
  }
  return { version: info.version.toString() }
}

export async function bumpDataVersion() {
  await prisma.serverInfo.upsert({
    where: { id: 1 },
    create: { id: 1, version: 1n },
    update: { version: { increment: 1n } }
  })
}
