<script setup lang="ts">
// 组件与依赖
import EventBlock from '~/components/preview/Event/EventBlock.vue'
import TaskLine from '~/components/preview/Task/TaskLine.vue'
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'
import { gsap } from 'gsap'
import { weekdays as weekdayLabels } from '~/utils/date'

const EventEditPopup = defineAsyncComponent(() => import('../edit/EventEditPopup.vue'))

// 类型与组件参数
interface ScheduleColumn {
  key: string
  date: string
  weekday: number
  week: number
}

interface TaskLineState {
  key: string
  task: ApiData<Api['api']['task']['get']>[number]
  kind: 'plan' | 'due'
  minutes: number
  insideEvent: boolean
  top: Ref<number>
  covered: Ref<boolean>
  markerOffset: Ref<number>
}

const props = defineProps<{
  events: ApiData<Api['api']['event']['get']> | undefined
  tasks: ApiData<Api['api']['task']['get']> | undefined
  phase: ApiData<Api['api']['phase']['get']>[number]
  /** 当前显示组的日期。 */
  dates: Date[]
  edgePixels: number
}>()

// ==================== 数据处理 ====================

// 数据来源与时间换算
const events = computed(() => props.events ?? [])

const tasks = computed(() => props.tasks ?? [])

const { now, timeZone } = useSystemTime()
const { preferences } = useAppPeferences()
const active = ref(false)
const moving = ref(false)

const maxWeek = computed(() => props.phase.weekCount)

const phaseDay = computed(() => calendarDate(props.phase.startDate, 'UTC'))

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

function dateToMinutes(date: Date) {
  const { hour, minute } = clockParts(date, timeZone.value)
  return hour * 60 + minute
}

function dateToWeekday(date: Date) {
  return calendarWeekday(calendarDate(date, timeZone.value))
}

function weekOf(date: string) {
  return Math.floor((calendarDayNumber(date) - calendarDayNumber(phaseDay.value)) / 7) + 1
}

// 周期由外层统一管理，前后页只渲染表格，不再各自加载背景。
const visibleColumns = computed<ScheduleColumn[]>(() => props.dates.map((value) => {
  const date = calendarDate(value, timeZone.value)
  return { key: date, date, weekday: calendarWeekday(date), week: weekOf(date) }
}))
// 当前日期与时间范围
function getSchedulePosition(date: Date) {
  const weekNumber = weekOf(calendarDate(date, timeZone.value))

  return {
    week: weekNumber,
    weekday: dateToWeekday(date),
    minutes: dateToMinutes(date) + clockParts(date, timeZone.value).second / 60,
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

// 与外层左轴使用相同的数据范围，内层自行确定分钟到像素的映射。
const scheduleBounds = computed(() => {
  const minutes: number[] = []
  for (const schedule of events.value.flatMap(event => event.schedules)) {
    if (schedule.startTime && schedule.endTime) minutes.push(timeToMinutes(schedule.startTime), timeToMinutes(schedule.endTime))
  }
  for (const task of tasks.value) {
    if (task.plannedDate) minutes.push(dateToMinutes(task.plannedDate))
    if (task.dueDate) minutes.push(dateToMinutes(task.dueDate))
  }
  return {
    start: Math.floor((minutes.length ? Math.min(...minutes) : 8 * 60) / 60) * 60,
    end: Math.ceil((minutes.length ? Math.max(...minutes) : 22 * 60) / 60) * 60
  }
})

const scheduleStartMinutes = computed(() => scheduleBounds.value.start)

const scheduleEndMinutes = computed(() => scheduleBounds.value.end)

// 课程数据筛选
const eventEntries = computed(() =>
  visibleColumns.value.flatMap(column => events.value.flatMap(event =>
    event.schedules.flatMap((schedule) => {
      if (schedule.weekday !== column.weekday || column.week < 1 || column.week > maxWeek.value) return []
      const currentWeek = column.week
      if (Array.isArray(schedule.weeks)) {
        if (!schedule.weeks.includes(currentWeek)) {
          return []
        }
      }
      return {
        key: `${column.key}-${event.id}-${schedule.id}`,
        columnKey: column.key,
        weekday: schedule.weekday,
        color: event.color,
        eventId: event.id,
        eventName: event.name,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        location: schedule.location || event.location,
        organizer: schedule.organizer || event.organizer || null,
        tips: event.tips
      }
    })
  ))
)

// 任务日期分组与课程覆盖关系
const taskLineEntries = computed(() => {
  const columnsByDate = new Map(visibleColumns.value.map(column => [column.date, column]))
  const groups = new Map<string, Omit<TaskLineState, 'top' | 'covered' | 'markerOffset'>[]>()
  const eventRanges = new Map<string, { start: number, end: number }[]>()
  for (const column of visibleColumns.value) {
    groups.set(column.key, [])
    eventRanges.set(column.key, events.value.flatMap(event => event.schedules.flatMap((schedule) => {
      if (column.week < 1 || column.week > maxWeek.value || schedule.weekday !== column.weekday
        || (Array.isArray(schedule.weeks) && !schedule.weeks.includes(column.week))) return []
      return { start: timeToMinutes(schedule.startTime), end: timeToMinutes(schedule.endTime) }
    })))
  }

  for (const task of tasks.value) {
    for (const kind of ['plan', 'due'] as const) {
      const date = kind === 'plan' ? task.plannedDate : task.dueDate
      if (!date) continue
      const column = columnsByDate.get(calendarDate(date, timeZone.value))
      if (!column) continue
      const minutes = dateToMinutes(date)
      const insideEvent = eventRanges.get(column.key)!.some(range => minutes >= range.start && minutes <= range.end)
      groups.get(column.key)!.push({
        key: `${task.id}-${kind}`,
        task,
        kind,
        minutes,
        insideEvent
      })
    }
  }
  for (const lines of groups.values()) {
    lines.sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key))
  }
  return groups
})

// ==================== 界面参数 ====================

// 容器、时间轴与表格尺寸
const viewport = ref<HTMLElement | null>(null)

const scheduleHeader = ref<HTMLElement | null>(null)
const headerHeight = ref(0)
let headerObserver: ResizeObserver | undefined

watch(scheduleHeader, (element) => {
  headerObserver?.disconnect()
  if (!element) return
  const resize = () => {
    headerHeight.value = element.offsetHeight
  }
  resize()
  headerObserver = new ResizeObserver(resize)
  headerObserver.observe(element)
}, { flush: 'post' })

const scheduleBody = ref<HTMLElement | null>(null)

const hourPixels = computed(() => preferences.value?.hourPixels ?? 72)

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

// 聚焦缩放与列宽
const maxFocusScale = computed(() => preferences.value?.maxFocusScale ?? 2)

const focusColumnScale = computed(() => visibleColumns.value.length <= 2
  ? 1
  : Math.min(preferences.value?.focusColumnScale ?? 3, visibleColumns.value.length))

const animatedFocusScale = reactive({
  value: maxFocusScale.value
})

const focus = reactive({
  progress: 0,
  offsetY: 0
})

const columnWidths = ref(
  visibleColumns.value.map(() => ({ weight: 1 }))
)

const selectedBlockKey = ref<string | null>(null)

const focusMoving = ref(false)

let removeFocusClickListener: (() => void) | undefined

let focusTween: ReturnType<typeof gsap.to> | undefined

let columnTween: ReturnType<typeof gsap.to> | undefined

function syncFocusClickListener() {
  removeFocusClickListener?.()
  removeFocusClickListener = undefined
  if (!active.value || moving.value || selectedBlockKey.value === null) return
  document.addEventListener('click', FocusClickListener, true)
  removeFocusClickListener = () => document.removeEventListener('click', FocusClickListener, true)
}

watch([active, moving], syncFocusClickListener, { flush: 'sync' })

const gridColumns = computed(() => {
  const columns = columnWidths.value.map((column) => {
    return `minmax(0, ${column.weight}fr)`
  })

  return columns.join(' ')
})

const displayHourPixels = computed(() => {
  return hourPixels.value
    * (1 + animatedFocusScale.value * focus.progress)
})

const axisLayout = computed(() => ({
  hourPixels: displayHourPixels.value,
  offsetY: focus.offsetY,
  headerHeight: headerHeight.value
}))

function animateColumns(columnKey: string | null) {
  columnTween?.kill()

  const count = visibleColumns.value.length

  if (count <= 1) {
    columnWidths.value.forEach((column) => {
      column.weight = columnKey === null ? 1 : focusColumnScale.value
    })
    return
  }

  const otherWeight = (count - focusColumnScale.value) / (count - 1)

  columnTween = gsap.to(columnWidths.value, {
    weight: (index: number) => {
      if (columnKey === null)
        return 1

      return visibleColumns.value[index]?.key === columnKey
        ? focusColumnScale.value
        : otherWeight
    },
    duration: 0.45,
    ease: 'power3.out'
  })
}

function resetFocus() {
  focusTween?.kill()
  columnTween?.kill()
  removeFocusClickListener?.()
  removeFocusClickListener = undefined
  selectedBlockKey.value = null
  focusMoving.value = false
  focus.progress = 0
  focus.offsetY = 0
  columnWidths.value.forEach((column) => {
    column.weight = 1
  })
}

watch(maxFocusScale, (value) => {
  gsap.to(animatedFocusScale, {
    value,
    duration: 0.45,
    ease: 'power4.out',
    overwrite: true
  })
})

watch(
  visibleColumns,
  (days) => {
    resetFocus()
    columnWidths.value = days.map(() => ({ weight: 1 }))
  }
)

watch(
  [maxFocusScale, focusColumnScale, hourPixels, edgePixels],
  () => {
    if (selectedBlockKey.value) openFocus(selectedBlockKey.value)
  },
  { flush: 'post' }
)

// 课程与任务的像素定位
function minutesToY(minutes: number) {
  return (minutes - scheduleStartMinutes.value)
    * (displayHourPixels.value / 60)
    + edgePixels.value
    + focus.offsetY
}

const eventBlocks = computed(() => eventEntries.value.map(block => ({
  ...block,
  top: minutesToY(timeToMinutes(block.startTime)),
  height: (timeToMinutes(block.endTime) - timeToMinutes(block.startTime)) * (displayHourPixels.value / 60)
})))

const taskLines = shallowRef(new Map<string, TaskLineState[]>())

function rebuildTaskLines() {
  taskLines.value = new Map<string, TaskLineState[]>([...taskLineEntries.value].map(([key, lines]) => [
    key,
    lines.map(line => ({
      ...line,
      top: ref(minutesToY(line.minutes)),
      covered: ref(line.insideEvent),
      markerOffset: ref(0)
    }))
  ]))
  updateTaskLineCrowding()
}

function updateTaskLinePositions() {
  const scale = displayHourPixels.value / 60
  const origin = edgePixels.value + focus.offsetY - scheduleStartMinutes.value * scale
  for (const lines of taskLines.value.values()) {
    for (const line of lines) line.top.value = origin + line.minutes * scale
  }
  updateTaskLineCrowding()
}

function updateTaskLineCrowding() {
  for (const lines of taskLines.value.values()) {
    const current = displayHourPixels.value > 0
      ? lines
      : [...lines].sort((a, b) => b.top.value - a.top.value || a.key.localeCompare(b.key))
    let markerTop = Infinity
    let markerSlot = 0
    for (const [index, line] of current.entries()) {
      const previous = current[index - 1]
      const next = current[index + 1]
      const top = line.top.value
      const crowded = (previous !== undefined && Math.abs(previous.top.value - top) < 40)
        || (next !== undefined && Math.abs(next.top.value - top) < 40)
      const covered = line.insideEvent || crowded
      if (line.covered.value !== covered) line.covered.value = covered
      if (covered) {
        markerSlot = markerTop - top < 18 ? markerSlot + 1 : 0
        markerTop = top
      }
      const offset = covered ? markerSlot * 18 : 0
      if (line.markerOffset.value !== offset) line.markerOffset.value = offset
    }
  }
}

const currentTimeY = computed(() => {
  const minutes = currentPosition.value?.minutes
  return minutes === undefined || minutes < scheduleStartMinutes.value || minutes > scheduleEndMinutes.value
    ? null
    : minutesToY(minutes)
})

watch([tasks, events, visibleColumns, timeZone], rebuildTaskLines, { immediate: true, deep: true })

watch([displayHourPixels, scheduleStartMinutes, edgePixels, () => focus.offsetY], updateTaskLinePositions)

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

// 编辑状态和任务写入留在内层；编辑后的数据同步交给后续全局通报。
const editingEventId = ref<number | null>(null)
const creatingEvent = ref(false)

function createEvent() {
  if (active.value) creatingEvent.value = true
}

function closeEventEditor(open: boolean) {
  if (open) return
  editingEventId.value = null
  creatingEvent.value = false
}

const taskClient = useApi({
  key: () => `tasks:${props.phase.id}`,
  write: (api, [id, change]: Parameters<ChangeTask>) => 'plannedDate' in change
    ? api.api.task({ id }).postpone.patch(change)
    : api.api.task({ id }).patch(change)
})
const changeTask: ChangeTask = (id, change) => taskClient.write([id, change])

// ==================== 生命周期 ====================

onDeactivated(deactivate)

onBeforeUnmount(() => {
  headerObserver?.disconnect()
  removeFocusClickListener?.()
  removeFocusClickListener = undefined
  focusTween?.kill()
  columnTween?.kill()
  gsap.killTweensOf(animatedFocusScale)
})

// ==================== 点击与交互操作 ====================

// 聚焦、取消聚焦与外部点击
function FocusClickListener(event: MouseEvent) {
  if (!active.value || moving.value) return
  const target = event.target
  if (!(target instanceof Element)) return
  const table = target.closest('.schedule')
  if (table && table !== viewport.value) return

  if (target.closest('.event-block, .edit-popup, .event-edit-popup, .schedule-edit-trigger, .schedule-period-button'))
    return

  closeFocus()
}

function openFocus(key: string) {
  const block = eventBlocks.value.find(block => block.key === key)

  if (!block)
    return

  focusTween?.kill()

  const start = timeToMinutes(block.startTime)
  const end = timeToMinutes(block.endTime)
  const centerMinutes = (start + end) / 2

  const currentCenterY = minutesToY(centerMinutes)

  const targetHourPixels = hourPixels.value * (1 + maxFocusScale.value)
  const targetHeight = (end - start) * (targetHourPixels / 60)

  const targetCenterY = (centerMinutes - scheduleStartMinutes.value)
    * (targetHourPixels / 60)
    + edgePixels.value

  // 先算出保持原中心所需的偏移。
  let targetOffsetY = currentCenterY - targetCenterY

  const desiredTop = currentCenterY - targetHeight / 2
  const desiredBottom = currentCenterY + targetHeight / 2

  const minTop = edgePixels.value
  const maxBottom = boardHeight.value - edgePixels.value

  // 越过上边界就往下挪，越过下边界就往上挪。
  if (desiredTop < minTop) {
    targetOffsetY += minTop - desiredTop
  } else if (desiredBottom > maxBottom) {
    targetOffsetY -= desiredBottom - maxBottom
  }

  selectedBlockKey.value = key
  syncFocusClickListener()
  focusMoving.value = true
  animateColumns(block.columnKey)

  focusTween = gsap.to(focus, {
    progress: 1,
    offsetY: targetOffsetY,
    duration: 0.45,
    ease: 'power3.out',
    onComplete() {
      focusMoving.value = false
    }
  })
}

function closeFocus() {
  if (selectedBlockKey.value === null)
    return

  focusTween?.kill()
  removeFocusClickListener?.()
  removeFocusClickListener = undefined
  focusMoving.value = true
  animateColumns(null)

  focusTween = gsap.to(focus, {
    progress: 0,
    offsetY: 0,
    duration: 0.45,
    ease: 'power3.out',
    onComplete() {
      focusMoving.value = false
      selectedBlockKey.value = null
    }
  })
}

// 预加载页的激活与移动由外层通过组件方法协调，不再作为输入参数。
function activate() {
  if (active.value) return
  active.value = true
}

function deactivate() {
  if (!active.value) return
  active.value = false
  closeEventEditor(false)
}

function setMoving(value: boolean) {
  moving.value = value
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
        v-for="column in visibleColumns"
        :key="column.key"
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
          {{ column.date.slice(5).replace('-', '/') }}
        </span>
      </div>
    </div>

    <div
      ref="scheduleBody"
      class="schedule-body"
      :style="{ height: `${boardHeight}px` }"
    >
      <div
        v-for="column in visibleColumns"
        :key="column.key"
        class="schedule-day-column"
      >
        <EventBlock
          v-for="block in eventBlocks.filter(
            block => block.columnKey === column.key
          )"
          :key="block.key"
          :top="block.top"
          :height="block.height"
          :color="block.color"
          :event-id="block.eventId"
          :event-name="block.eventName"
          :start-time="block.startTime"
          :end-time="block.endTime"
          :location="block.location"
          :organizer="block.organizer"
          :focused="selectedBlockKey === block.key"
          :focus-progress="focus.progress"
          :tips="block.tips"
          :moving="focusMoving || moving"
          @select="openFocus(block.key)"
          @edit="editingEventId = $event"
        />
        <TaskLine
          v-for="line in taskLines.get(column.key)"
          :key="line.key"
          :change-task="changeTask"
          :top="line.top.value"
          :covered="line.covered.value"
          :marker-offset="line.markerOffset.value"
          :kind="line.kind"
          :task-id="line.task.id"
          :task="line.task"
          :interactive="active && !moving"
          :task-name="line.task.title"
          :planned-date="line.kind === 'plan' ? line.task.plannedDate ?? undefined : undefined"
          :due-date="line.kind === 'due' ? line.task.dueDate ?? undefined : undefined"
        />
      </div>
      <div
        v-for="minute in hourMarks"
        :key="minute"
        class="schedule-hour-line"
        :style="{ top: `${minutesToY(minute)}px` }"
      />
      <div
        v-if="hasTodayColumn && currentTimeY !== null"
        class="schedule-current-time"
        :style="{ top: `${currentTimeY}px` }"
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

.schedule-day-column {
  position: relative;
  min-width: 0;
  border-left: 1px solid var(--border-color);
  container-type: inline-size;
  container-name: schedule-day;
}

.schedule-hour-line {
  position: absolute;
  right: 0;
  left: 0;
  border-top: 1px solid color-mix(in srgb, var(--text-secondary) 24%, transparent);
  pointer-events: none;
}

.schedule-current-time {
  position: absolute;
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
