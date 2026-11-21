<script setup lang="ts">
// 组件与依赖
import ScheduleDayColumn from './ScheduleDayColumn.vue'
import { useScheduleFocus } from '~/composables/useAnimations/useScheduleFocus'
import { calendarDateKey, dateToMinutes, formatMonthDay, weekdays as weekdayLabels, weekNumberFrom } from '~/utils/date'
import { createScheduleData, ScheduleDataKey } from './scheduleData'

const EventEditPopup = defineAsyncComponent(() => import('~/components/edit/EventEditPopup.vue'))
const EventDetailPopup = defineAsyncComponent(() => import('../Event/EventDetailPopup.vue'))

// 类型与组件参数
interface ScheduleColumn {
  key: string
  date: string
  weekday: number
  week: number
}

const props = defineProps<{
  events: ApiData<Api['api']['event']['get']> | undefined
  tasks: ApiData<Api['api']['task']['get']> | undefined
  phase: ApiData<Api['api']['phase']['get']>[number]
  /** 当前显示组的日期。 */
  dates: Date[]
  edgePixels: number
  focusEnabled: boolean
}>()

// ==================== 数据处理 ====================

// 数据来源与时间换算
const events = computed(() => props.events ?? [])

const tasks = computed(() => props.tasks ?? [])

const { now, timeZone } = useSystemTime()
const { preferences } = useAppPeferences()

const maxWeek = computed(() => props.phase.weekCount)
const phaseDay = computed(() => calendarDateKey(props.phase.startDate))
const hourPixels = computed(() => preferences.value?.hourPixels ?? 72)
const maxFocusScale = computed(() => props.focusEnabled ? (preferences.value?.maxFocusScale ?? 2) : 0)
const scheduleData = inject(ScheduleDataKey, null)
  ?? createScheduleData(events, tasks, timeZone, maxWeek, phaseDay, hourPixels, maxFocusScale)
const { schedules, taskLines, bounds: scheduleBounds } = scheduleData

// 周期由外层统一管理，前后页只渲染表格，不再各自加载背景。
const visibleColumns = computed<ScheduleColumn[]>(() => props.dates.map((value) => {
  const date = calendarDate(value, timeZone.value)
  return { key: date, date, weekday: calendarWeekday(date), week: weekNumberFrom(date, phaseDay.value) }
}))
// 当前日期与时间范围
function getSchedulePosition(date: Date) {
  const day = calendarDate(date, timeZone.value)
  const weekNumber = weekNumberFrom(day, phaseDay.value)

  return {
    week: weekNumber,
    weekday: calendarWeekday(day),
    minutes: dateToMinutes(date, timeZone.value),
    inPhase: weekNumber >= 1 && weekNumber <= maxWeek.value
  }
}

const currentPosition = computed(() => {
  return now.value
    ? getSchedulePosition(now.value)
    : null
})

const today = computed(() => now.value ? calendarDate(now.value, timeZone.value) : null)

const hasTodayColumn = computed(() => today.value !== null
  && visibleColumns.value.some(column => column.date === today.value))

const scheduleStartMinutes = computed(() => scheduleBounds.value.start)

const scheduleEndMinutes = computed(() => scheduleBounds.value.end)

// ==================== 界面参数 ====================

// 容器、时间轴与表格尺寸
const viewport = ref<HTMLElement | null>(null)

const scheduleHeader = ref<HTMLElement | null>(null)
const headerHeight = ref(0)
const observeHeader = ref(true)

watch([scheduleHeader, observeHeader], ([element, observing], _, onCleanup) => {
  if (!element || !observing) return
  let frame: number | undefined
  const resize = () => {
    frame = undefined
    headerHeight.value = element.offsetHeight
  }
  resize()

  const observer = new ResizeObserver(() => {
    if (frame === undefined) frame = requestAnimationFrame(resize)
  })
  observer.observe(element)

  onCleanup(() => {
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
  })
}, { flush: 'post' })

const scheduleBody = ref<HTMLElement | null>(null)

const edgePixels = computed(() => props.edgePixels)

const boardHeight = computed(() => {
  const duration = scheduleEndMinutes.value - scheduleStartMinutes.value

  return duration * (hourPixels.value / 60)
    + edgePixels.value * 2
})

const hourMarks = computed(() => Array.from(
  {
    length:
      (scheduleEndMinutes.value - scheduleStartMinutes.value) / 60 + 1
  },
  (_, index: number) => scheduleStartMinutes.value + index * 60
))

// ==================== 聚焦动画与触发 ====================
const active = ref(false)
const moving = ref(false)

const {
  selectedSchedule,
  focusMoving,
  focusedMarkers,
  progress: focusProgress,
  offsetY: focusOffsetY,
  gridColumns,
  displayHourPixels,
  columnLayout,
  minutesToY,
  openFocus,
  resetFocus,
  syncFocusClickListener
} = useScheduleFocus({
  visibleColumns,
  viewport,
  active,
  moving,
  hourPixels,
  edgePixels,
  scheduleStartMinutes,
  boardHeight,
  maxFocusScale,
  preferredColumnScale: computed(() => preferences.value?.focusColumnScale ?? 3)
})

const axisLayout = computed(() => ({
  hourPixels: displayHourPixels.value,
  offsetY: focusOffsetY.value,
  headerHeight: headerHeight.value
}))

let displayedColumns = visibleColumns.value
let displayedFocusEnabled = props.focusEnabled
onBeforeUpdate(() => {
  const columns = visibleColumns.value
  if (displayedColumns === columns && displayedFocusEnabled === props.focusEnabled) return
  displayedColumns = columns
  displayedFocusEnabled = props.focusEnabled
  resetFocus()
  detailEventId.value = null
})

function selectSchedule(column: ScheduleColumn, scheduleId: number) {
  if (!active.value || moving.value) return
  const block = schedules.value.byPeriod.get(`${column.week}:${column.weekday}`)
    ?.find(({ schedule }) => schedule.id === scheduleId)

  if (!block)
    return

  if (props.focusEnabled) openFocus(column, scheduleId, block)
  else openEventDetail(block.event.id)
}

// 预加载页的激活与移动由外层通过组件方法协调，不再作为输入参数。
function activate() {
  if (active.value) return
  active.value = true
  syncFocusClickListener()
}

function deactivate() {
  if (!active.value) return
  active.value = false
  syncFocusClickListener()
  detailEventId.value = null
  closeEventEditor(false)
}

function setMoving(value: boolean) {
  if (moving.value === value) return
  moving.value = value
  syncFocusClickListener()
}

onActivated(() => {
  observeHeader.value = true
})
onDeactivated(() => {
  observeHeader.value = false
  deactivate()
})

// 时间标记与初始定位
const currentTimeY = computed(() => {
  const minutes = currentPosition.value?.minutes
  return minutes === undefined || minutes < scheduleStartMinutes.value || minutes > scheduleEndMinutes.value
    ? null
    : minutesToY(minutes)
})

// 首次进入与缓存返回时的视窗定位
function centerCurrentTime() {
  if (!active.value || !hasTodayColumn.value || currentPosition.value === null
    || !viewport.value || !scheduleBody.value) return

  // 首页滚动的是 PageCard；独立课程表则可能由整个页面滚动。
  let container = viewport.value.parentElement
  while (container && !/(auto|scroll|overlay)/.test(getComputedStyle(container).overflowY)) {
    container = container.parentElement
  }
  const scroller = container ?? document.scrollingElement
  if (!scroller) return

  if (currentTimeY.value === null) {
    scroller.scrollTop = 0
    return true
  }

  const isDocument = scroller === document.scrollingElement
  const viewportTop = isDocument ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop
  const viewportHeight = isDocument ? window.innerHeight : scroller.clientHeight
  if (!viewportHeight || !scheduleBody.value.clientHeight) return
  const headerHeight = scheduleHeader.value?.offsetHeight ?? 0
  const top = scroller.scrollTop + scheduleBody.value.getBoundingClientRect().top
    - viewportTop + currentTimeY.value - (viewportHeight + headerHeight) / 2
  scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - viewportHeight))
  return true
}

// 课程详情与编辑状态
const detailEventId = ref<number | null>(null)
const detailEvent = computed(() => detailEventId.value === null
  ? null
  : events.value.find(event => event.id === detailEventId.value) ?? null)
const editingEventId = ref<number | null>(null)
const creatingEvent = ref(false)

function openEventDetail(eventId: number) {
  detailEventId.value = eventId
}

function editEvent(eventId: number) {
  detailEventId.value = null
  editingEventId.value = eventId
}

function createEvent() {
  if (active.value) creatingEvent.value = true
}

function closeEventEditor(open: boolean) {
  if (open) return
  editingEventId.value = null
  creatingEvent.value = false
}

defineExpose({ resetFocus, createEvent, centerCurrentTime, activate, deactivate, setMoving, axisLayout })
</script>

<template>
  <section
    ref="viewport"
    class="schedule"
    :style="{ '--schedule-columns': gridColumns }"
  >
    <div
      ref="scheduleHeader"
      class="schedule-header"
    >
      <div
        v-for="(column, index) in visibleColumns"
        :key="index"
        class="schedule-header-weekday"
        :class="{
          'schedule-header-weekday--today': column.date === today
        }"
      >
        <span
          class="schedule-header-label"
          :title="weekdayLabels[column.weekday - 1]"
        >
          <span class="schedule-header-prefix">周</span>{{ weekdayLabels[column.weekday - 1]?.slice(1) }}
        </span>
        <span class="schedule-header-date">
          {{ formatMonthDay(column.date) }}
        </span>
      </div>
    </div>

    <div
      ref="scheduleBody"
      class="schedule-body"
      :style="{ height: `${boardHeight}px` }"
    >
      <ScheduleDayColumn
        v-for="(column, index) in visibleColumns"
        :key="index"
        :schedules="schedules.byPeriod.get(`${column.week}:${column.weekday}`)"
        :task-lines="taskLines.get(column.date)"
        :layout="columnLayout"
        :selected-schedule-id="selectedSchedule?.date === column.date ? selectedSchedule.id : null"
        :focus-progress="focusProgress"
        :focused-markers="focusedMarkers"
        :moving="focusMoving || moving"
        :interactive="active && !moving"
        @select="selectSchedule(column, $event)"
        @edit="editEvent"
      />
      <div
        v-for="minute in hourMarks"
        :key="minute"
        class="schedule-hour-line"
        :style="{ translate: `0 ${minutesToY(minute)}px` }"
      />
      <div
        v-if="hasTodayColumn && currentTimeY !== null"
        class="schedule-current-time"
        :style="{ translate: `0 ${currentTimeY}px` }"
        aria-hidden="true"
      >
        <span
          v-for="(column, index) in visibleColumns"
          :key="column.key"
          class="schedule-current-time__line"
          :class="{ 'schedule-current-time__line--today': column.date === today }"
          :style="{ gridColumn: index + 1 }"
        />
      </div>
    </div>
    <EventDetailPopup
      v-if="active && !focusEnabled && detailEvent"
      :event="detailEvent"
      :tasks="props.tasks"
      @close="detailEventId = null"
      @edit="editEvent"
    />
    <EventEditPopup
      v-if="active && (editingEventId !== null || creatingEvent)"
      :events="props.events"
      :events-pending="props.events === undefined"
      :event-id="editingEventId ?? undefined"
      :phase-id="phase.id"
      :week-count="maxWeek"
      :open="true"
      @update:open="closeEventEditor"
      @saved="resetFocus"
      @deleted="resetFocus"
      @task-saved="resetFocus"
      @task-deleted="resetFocus"
    />
  </section>
</template>

<style scoped>
.schedule {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.schedule-header {
  display: grid;
  grid-template-columns: var(--schedule-columns);
  position: sticky;
  top: 0;
  z-index: 20;
  color: var(--text-primary);
  background-color: var(--background-secondary);
  border-bottom: 1px solid var(--border-color);
}

.schedule-header-weekday {
  min-width: 0;
  container-type: inline-size;
  container-name: schedule-weekday;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border-left: 1px solid var(--border-color);
  position: relative;
  min-height: 44px;
  box-sizing: border-box;
  padding: 4px 4px 17px;
}

.schedule-header-weekday--today {
  color: var(--text-primary);
  background-color: color-mix(in srgb, var(--text-secondary) 16%, var(--background-secondary));
  box-shadow: inset 0 -2px 0 var(--text-secondary);
  font-weight: 700;
}

.schedule-header-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.schedule-header-date {
  position: absolute;
  left: 4px;
  bottom: 3px;
  font-size: 10px;
  line-height: 1;
  font-weight: 400;
  color: var(--text-secondary);
}

.schedule-body {
  display: grid;
  grid-template-columns: var(--schedule-columns);
  position: relative;
  overflow: clip;
}

.schedule-hour-line {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  border-top: 1px solid color-mix(in srgb, var(--text-secondary) 24%, transparent);
  pointer-events: none;
}

.schedule-current-time {
  position: absolute;
  top: 0;
  display: grid;
  grid-template-columns: var(--schedule-columns);
  left: 0;
  right: 0;
  height: 0;
  z-index: 12;
  color: var(--accent-color);
  pointer-events: none;
}

.schedule-current-time__line {
  grid-row: 1;
  height: 0;
  border-top: 2px dashed currentColor;
  transform: translateY(-1px);
  opacity: .25;
}

.schedule-current-time__line--today {
  opacity: 1;
}

@container schedule-weekday (width < 2.25em) {
  .schedule-header-prefix {
    display: none;
  }
}
</style>
