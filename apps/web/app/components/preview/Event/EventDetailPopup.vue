<script setup lang="ts">
import AppPopup from '~/components/common/AppPopup.vue'
import TaskBlock from '../Task/TaskBlock.vue'
import EventBlock from './EventBlock.vue'
import { dateToWeekday, minutesToTime, timeToMinutes, weekdays } from '~/utils/date'
import { formatWeeksRange } from '~/utils/schedule'

type Course = ApiData<Api['api']['event']['get']>[number]

const props = defineProps<{
  event: Course
  tasks: ApiData<Api['api']['task']['get']> | undefined
}>()

const emit = defineEmits<{ close: [], edit: [eventId: number] }>()
const { mode } = useSystemStatus()
const { now, timeZone } = useSystemTime()

const todayWeekday = computed(() => now.value ? dateToWeekday(now.value, timeZone.value) : null)
const tasksForEvent = computed(() => props.tasks?.filter(task => task.eventId === props.event.id))
const locations = computed(() => [...new Set([props.event.location, ...props.event.schedules.map(schedule => schedule.location)].filter(Boolean))])
const organizers = computed(() => [...new Set([props.event.organizer, ...props.event.schedules.map(schedule => schedule.organizer)].filter(Boolean))])

const pixelsPerMinute = 72 / 60
const edgePixels = 10
const maxGapMinutes = 60

function blockHeight(start: number, end: number) {
  return Math.min(120, Math.max(70, (end - start) * pixelsPerMinute))
}

const timetable = computed(() => {
  const entries = props.event.schedules.map(schedule => ({
    schedule,
    start: timeToMinutes(schedule.startTime),
    end: timeToMinutes(schedule.endTime)
  })).sort((a, b) => a.start - b.start)

  const clusters: { start: number, end: number, height: number, top: number }[] = []
  for (const { start, end } of entries) {
    const last = clusters.at(-1)
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end)
      last.height = Math.max(last.height, (start - last.start) * pixelsPerMinute + blockHeight(start, end))
    } else {
      clusters.push({ start, end, height: blockHeight(start, end), top: 0 })
    }
  }

  const hours: { minute: number, top: number }[] = []
  let bottom = edgePixels
  for (const [index, cluster] of clusters.entries()) {
    cluster.top = bottom
    const visibleEnd = Math.min(cluster.end, cluster.start + cluster.height / pixelsPerMinute)
    for (let minute = Math.ceil(cluster.start / 60) * 60; minute <= visibleEnd; minute += 60) {
      hours.push({ minute, top: cluster.top + (minute - cluster.start) * pixelsPerMinute })
    }
    const next = clusters[index + 1]
    bottom += cluster.height + (next ? Math.min(next.start - cluster.end, maxGapMinutes) * pixelsPerMinute : 0)
  }

  const days = weekdays.flatMap((label, index) => {
    const weekday = index + 1
    const lanes: number[] = []
    const blocks = entries.filter(entry => entry.schedule.weekday === weekday).map(({ schedule, start, end }) => {
      const cluster = clusters.find(value => start >= value.start && start <= value.end)
      const top = cluster ? cluster.top + (start - cluster.start) * pixelsPerMinute : edgePixels
      const height = blockHeight(start, end)
      const freeLane = lanes.findIndex(laneEnd => laneEnd <= top)
      const lane = freeLane === -1 ? lanes.length : freeLane
      lanes[lane] = top + height
      return { schedule, top, height, lane, weeks: Array.isArray(schedule.weeks) ? formatWeeksRange(schedule.weeks) : '每周' }
    })
    return blocks.length ? [{ weekday, label, blocks, lanes: lanes.length }] : []
  })

  const columns = ['46px', ...days.map(day => `minmax(${day.lanes * 106}px, 1fr)`)].join(' ')
  return { days, hours, columns, height: bottom + edgePixels }
})
</script>

<template>
  <AppPopup
    :open="true"
    :title="event.name"
    class="event-detail-popup"
    @update:open="!$event && emit('close')"
  >
    <template
      v-if="mode === 'edit'"
      #header-actions
    >
      <button
        class="button event-detail-popup__edit"
        type="button"
        title="编辑课程"
        aria-label="编辑课程"
        @click="emit('edit', event.id)"
      >
        <Icon
          name="lucide:pen-line"
          aria-hidden="true"
        />
      </button>
    </template>

    <div class="event-detail">
      <dl class="event-detail__meta">
        <div>
          <dt>地点</dt>
          <dd>{{ locations.join('、') || '未设置' }}</dd>
        </div>
        <div>
          <dt>老师</dt>
          <dd>{{ organizers.join('、') || '未设置' }}</dd>
        </div>
      </dl>

      <section class="event-detail__schedule">
        <h3>排课（{{ event.schedules.length }}）</h3>
        <div
          v-if="timetable.days.length"
          class="event-detail__scroll"
        >
          <div
            class="event-detail__grid"
            :style="{ gridTemplateColumns: timetable.columns, '--board-height': `${timetable.height}px` }"
          >
            <div class="event-detail__day">时间</div>
            <div
              v-for="day in timetable.days"
              :key="day.weekday"
              class="event-detail__day"
              :class="{ 'event-detail__day--today': day.weekday === todayWeekday }"
            >
              {{ day.label }}
            </div>
            <div class="event-detail__axis">
              <span
                v-for="hour in timetable.hours"
                :key="hour.minute"
                :style="{ top: `${hour.top}px` }"
              >{{ minutesToTime(hour.minute) }}</span>
            </div>
            <div
              v-for="day in timetable.days"
              :key="day.weekday"
              class="event-detail__column"
            >
              <div
                v-for="block in day.blocks"
                :key="block.schedule.id"
                class="event-detail__lane"
                :style="{ left: `${block.lane * 100 / day.lanes}%`, width: `${100 / day.lanes}%` }"
              >
                <EventBlock
                  v-slot="{ textColor }"
                  :top="block.top"
                  :height="block.height"
                  :color="event.color"
                  :event-id="event.id"
                  :event-name="block.weeks"
                  :start-time="block.schedule.startTime"
                  :end-time="block.schedule.endTime"
                  :editable="false"
                >
                  <div
                    class="event-detail__slot"
                    :style="{ color: textColor ?? undefined }"
                  >
                    <strong>{{ block.schedule.startTime }}–{{ block.schedule.endTime }}</strong>
                    <span>{{ block.weeks }}</span>
                    <span v-if="block.schedule.location">{{ block.schedule.location }}</span>
                    <span v-if="block.schedule.organizer">{{ block.schedule.organizer }}</span>
                  </div>
                </EventBlock>
              </div>
            </div>
          </div>
        </div>
        <p v-else>暂无时间安排。</p>
      </section>

      <details open>
        <summary>提示（{{ event.tips.length }}）</summary>
        <ul v-if="event.tips.length">
          <li
            v-for="tip in event.tips"
            :key="tip.id"
          >{{ tip.content }}</li>
        </ul>
        <p v-else>暂无提示。</p>
      </details>

      <details open>
        <summary>任务（{{ tasksForEvent?.length ?? event._count.tasks }}）</summary>
        <div
          v-if="tasksForEvent?.length"
          class="event-detail__tasks"
        >
          <TaskBlock
            v-for="task in tasksForEvent"
            :key="task.id"
            :task="task"
            :detail="1"
            variant="row"
          />
        </div>
        <p v-else>{{ tasksForEvent ? '暂无任务。' : '任务尚未载入。' }}</p>
      </details>
    </div>
  </AppPopup>
</template>

<style scoped>
.event-detail-popup { --popup-width: 760px; overflow-wrap: anywhere; }
.event-detail-popup__edit { padding-inline: 8px; }
.event-detail { display: grid; gap: 12px; }
.event-detail__meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; }
.event-detail__meta > div { display: flex; gap: 8px; min-width: 0; }
.event-detail__meta dt { flex: none; color: var(--text-secondary); }
.event-detail__meta dd { margin: 0; }
.event-detail h3 { margin: 0 0 8px; font-size: 1rem; }
.event-detail p { margin: 8px 0 0; color: var(--text-secondary); }
.event-detail details { border-top: 1px solid var(--border-color); padding-top: 8px; }
.event-detail summary { cursor: pointer; font-weight: 600; }
.event-detail ul { margin: 8px 0 0; padding-inline-start: 24px; white-space: pre-wrap; }
.event-detail__tasks { display: grid; gap: 6px; margin-top: 8px; }
.event-detail__tasks > * { height: 72px; }
.event-detail__scroll { overflow-x: auto; overscroll-behavior-inline: contain; }
.event-detail__grid { display: grid; border: 1px solid var(--border-color); }
.event-detail__day {
  padding: 6px;
  border-bottom: 1px solid var(--border-color);
  border-left: 1px solid var(--border-color);
  background: var(--background-primary);
  text-align: center;
  white-space: nowrap;
}
.event-detail__day--today { font-weight: 700; }
.event-detail__axis, .event-detail__column { position: relative; height: var(--board-height); }
.event-detail__column { border-left: 1px solid var(--border-color); }
.event-detail__axis span { position: absolute; inset-inline: 0; translate: 0 -50%; text-align: center; font-size: 11px; }
.event-detail__lane { position: absolute; top: 0; }
.event-detail__slot { display: grid; padding: 5px; text-align: center; font-size: 11px; line-height: 1.25; }
.event-detail__slot span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
