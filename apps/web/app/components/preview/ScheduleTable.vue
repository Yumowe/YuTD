<script setup lang="ts">
// 组件与依赖
import EventBlock from '~/components/preview/Event/EventBlock.vue'
import Background from '../image/BackgroundLayout.vue'
import BackgroundSelect from '../image/BackgroundSelect.vue'
import TaskLine from '~/components/preview/Task/TaskLine.vue'
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'
import type { BackgroundSelection } from '~/components/image/BackgroundSelect.vue'
import { gsap } from 'gsap'
import { weekdays as weekdayLabels } from '~/utils/date'

const EventEditPopup = defineAsyncComponent(() => import('../edit/EventEditPopup.vue'))

// 类型与组件参数
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

const props = withDefaults(defineProps<{
  /** 当前阶段的课程及排课数据，未就绪时为 undefined。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 当前阶段的任务，用于显示计划时间线和截止时间线。 */
  tasks: ApiData<Api['api']['task']['get']> | undefined
  /** 课程数据是否正在读取，数据就绪后才进行首次定位。 */
  eventsPending: boolean
  /** 重新读取课程数据，交给课程编辑弹窗调用。 */
  refreshEvents: () => Promise<unknown>
  /** 编辑课程或任务后统一重新读取页面数据。 */
  refreshContent: () => Promise<unknown>
  /** 写入任务完成、取消或延期等变更。 */
  changeTask?: ChangeTask
  /** 当前阶段，提供起始日期、阶段 ID 和总周数。 */
  phase: ApiData<Api['api']['phase']['get']>[number]
  /** 显示日期的方式：easy 仅显示有内容的周几，full 显示整周，custom 按 weekdays 显示；默认 full。 */
  mode?: 'easy' | 'full' | 'custom'
  /** custom 模式显示的周几，1～7 对应周一至周日，按传入顺序排列。 */
  weekdays?: number[]
  /** 是否显示上一周期和下一周期按钮，默认 true。 */
  showPeriodNavigation?: boolean
  /** 背景绑定的标识前缀，实际保存时追加阶段 ID，默认 schedule。 */
  backgroundKey?: string
  /** 进入或返回组件时，是否居中到当前时间；超出时间范围时回到顶部，默认 false。 */
  autoCenter?: boolean
  /** 聚焦时额外增加的纵向倍率，默认 2，即最大为原高度的 3 倍。 */
  maxFocusScale?: number
  /** 聚焦列的横向倍率，默认 3，不超过当前列数；custom 模式仅有 1～2 列时不放大。 */
  focusColumnScale?: number
  /** 未聚焦时每小时的像素高度，默认 72。 */
  hourPixels?: number
  /** 时间表上下边缘的留白像素，默认 20。 */
  edgePixels?: number
}>(), {
  showPeriodNavigation: true,
  autoCenter: false,
  maxFocusScale: 2,
  focusColumnScale: 3,
  hourPixels: 72,
  edgePixels: 20
})

const emit = defineEmits<{
  /** 鼠标移入课程时传出课程 ID，移出时传出 null。 */
  'event-hover': [eventId: number | null]
  /** 鼠标移入任务时间线时传出任务 ID，移出时传出 null。 */
  'task-hover': [taskId: number | null]
}>()

// ==================== 数据处理 ====================

// 数据来源与时间换算
const events = computed(() => props.events ?? [])

const tasks = computed(() => props.tasks ?? [])

const { now, timeZone } = useSystemTime()

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

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours.toString().padStart(2, '0')}:${mins
    .toString()
    .padStart(2, '0')}`
}

function dateToWeekday(date: Date) {
  return calendarWeekday(calendarDate(date, timeZone.value))
}

function weekOf(date: string) {
  return Math.floor((calendarDayNumber(date) - calendarDayNumber(phaseDay.value)) / 7) + 1
}

// 显示日期与周期范围
const week = ref(1)

const dayOffset = ref(0)

const visibleWeekdays = computed(() => {
  const mode = props.mode ?? 'full'

  // full：始终显示全部
  if (mode === 'full') {
    return weekdayLabels.map((_, index) => index + 1)
  }

  // custom：有参数就按参数，没有就全部
  if (mode === 'custom') {
    const selected = props.weekdays
      ?.filter(day => Number.isInteger(day) && day >= 1 && day <= 7)

    return selected?.length
      ? [...new Set(selected)]
      : weekdayLabels.map((_, index) => index + 1)
  }

  // easy：整个周期内，只显示至少有一节课的周几
  const hasClass = new Set<number>()

  for (const event of events.value) {
    for (const schedule of event.schedules) {
      const weekday = schedule.weekday

      if (!weekday || weekday < 1 || weekday > 7) {
        continue
      }

      if (!Array.isArray(schedule.weeks)) {
        continue
      }

      // 只要这个课程在 phase 的任意一周出现，就保留这个周几
      if (schedule.weeks.some(week => week != null && Number(week) >= 1 && Number(week) <= maxWeek.value)) {
        hasClass.add(weekday)
      }
    }
  }

  for (const task of tasks.value) {
    for (const date of [task.plannedDate, task.dueDate]) {
      if (date) {
        hasClass.add(dateToWeekday(date))
      }
    }
  }

  return weekdayLabels.map((_, index) => index + 1).filter(day => hasClass.has(day))
})

const visibleColumns = computed(() => {
  let nextWeekOffset = 0
  return visibleWeekdays.value.map((day, index, days) => {
    if (index > 0 && day < days[index - 1]!) nextWeekOffset += 7
    const date = addCalendarDays(phaseDay.value, (week.value - 1) * 7 + day - 1 + nextWeekOffset + dayOffset.value)
    return { key: date, date, weekday: calendarWeekday(date), week: weekOf(date) }
  })
})

const weekLabel = computed(() => [...new Set(visibleColumns.value.map(column => column.week))]
  .filter(week => week >= 1 && week <= maxWeek.value)
  .join(' / ') || '—')

const canMovePrevious = computed(() => props.mode === 'custom' || week.value > 1)

const canMoveNext = computed(() => props.mode === 'custom' || week.value < maxWeek.value)

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

const scheduleBounds = computed(() => {
  const minutes: number[] = []
  for (const schedule of events.value.flatMap(event => event.schedules)) {
    if (schedule.startTime && schedule.endTime) {
      minutes.push(timeToMinutes(schedule.startTime), timeToMinutes(schedule.endTime))
    }
  }
  for (const task of tasks.value) {
    if (task.plannedDate) minutes.push(dateToMinutes(task.plannedDate))
    if (task.dueDate) minutes.push(dateToMinutes(task.dueDate))
  }
  return {
    start: minutes.length ? Math.min(...minutes) : 8 * 60,
    end: minutes.length ? Math.max(...minutes) : 22 * 60
  }
})

const scheduleStartMinutes = computed(() => Math.floor(scheduleBounds.value.start / 60) * 60)

const scheduleEndMinutes = computed(() => Math.ceil(scheduleBounds.value.end / 60) * 60)

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

// 跟随当前阶段、时区和显示方式确定初始周期
watch(
  [() => currentPosition.value?.week, () => props.mode, () => props.weekdays?.join(','), timeZone],
  ([currentWeek]) => {
    if (currentWeek === undefined) return

    week.value = props.mode === 'custom' ? currentWeek : Math.min(maxWeek.value, Math.max(1, currentWeek))
    dayOffset.value = 0
  },
  { immediate: true }
)

// ==================== 界面参数 ====================

// 容器、时间轴与表格尺寸
const viewport = ref<HTMLElement | null>(null)

const scheduleHeader = ref<HTMLElement | null>(null)

const scheduleBody = ref<HTMLElement | null>(null)

const hourPixels = computed(() => props.hourPixels)

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
const maxFocusScale = computed(() => props.maxFocusScale)

const focusColumnScale = computed(() => props.mode === 'custom' && props.weekdays?.length && props.weekdays.length <= 2
  ? 1
  : Math.min(props.focusColumnScale, Math.max(1, visibleColumns.value.length)))

const animatedFocusScale = reactive({
  value: props.maxFocusScale
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

const gridColumns = computed(() => {
  const columns = columnWidths.value.map((column) => {
    return `minmax(0, ${column.weight}fr)`
  })

  return `var(--time-axis-width) ${columns.join(' ')}`
})

const displayHourPixels = computed(() => {
  return hourPixels.value
    * (1 + animatedFocusScale.value * focus.progress)
})

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
const initialPosition = reactive({ pending: true })

function centerCurrentTime() {
  if (!props.autoCenter || !hasTodayColumn.value || currentPosition.value === null
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
    initialPosition.pending = false
    return
  }

  const isDocument = scroller === document.scrollingElement
  const viewportTop = isDocument ? 0 : scroller.getBoundingClientRect().top + scroller.clientTop
  const viewportHeight = isDocument ? window.innerHeight : scroller.clientHeight
  if (!viewportHeight || !scheduleBody.value.clientHeight) return
  const headerHeight = scheduleHeader.value?.offsetHeight ?? 0
  const top = scroller.scrollTop + scheduleBody.value.getBoundingClientRect().top
    - viewportTop + currentTimeY.value - (viewportHeight + headerHeight) / 2
  scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - viewportHeight))
  initialPosition.pending = false
}

function positionInitially() {
  if (initialPosition.pending && !props.eventsPending && props.events !== undefined && props.tasks !== undefined) centerCurrentTime()
}

watch(
  [() => props.autoCenter, today, timeZone, visibleColumns, viewport, scheduleBody],
  () => {
    initialPosition.pending = true
    void nextTick(positionInitially)
  },
  { flush: 'post' }
)

watch([events, tasks, boardHeight, () => props.eventsPending], () => {
  void nextTick(positionInitially)
}, { flush: 'post' })

// 背景选择与裁剪尺寸
const backgroundSelection = shallowRef<BackgroundSelection | null>(null)

const backgroundPending = ref(true)

const background = ref<InstanceType<typeof Background> | null>(null)

const backgroundRatio = ref<number>()

let backgroundObserver: ResizeObserver | undefined

watch(background, (component) => {
  backgroundObserver?.disconnect()
  const element = component?.$el as HTMLElement | undefined
  if (!element) return
  const resize = () => {
    if (element.clientWidth && element.clientHeight) backgroundRatio.value = element.clientWidth / element.clientHeight
  }
  resize()
  backgroundObserver = new ResizeObserver(resize)
  backgroundObserver.observe(element)
}, { flush: 'post' })

// 课程编辑弹窗状态
const { mode: systemMode } = useSystemStatus()

const editingEventId = ref<number | null>(null)

const creatingEvent = ref(false)

// ==================== 生命周期 ====================

onActivated(() => {
  initialPosition.pending = true
  void nextTick(positionInitially)
})

onBeforeUnmount(() => {
  removeFocusClickListener?.()
  removeFocusClickListener = undefined
  focusTween?.kill()
  columnTween?.kill()
  backgroundObserver?.disconnect()
})

// ==================== 点击与交互操作 ====================

// 切换显示周期
function movePeriod(direction: -1 | 1) {
  if (direction < 0 ? !canMovePrevious.value : !canMoveNext.value) return
  if (props.mode === 'custom') {
    dayOffset.value += direction * visibleColumns.value.length
  } else {
    week.value += direction
  }
}

// 聚焦、取消聚焦与外部点击
function FocusClickListener(event: MouseEvent) {
  const target = event.target

  if (target instanceof Element && target.closest('.event-block, .edit-popup, .event-edit-popup, .schedule-edit-trigger'))
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

  if (!removeFocusClickListener) {
    document.addEventListener('click', FocusClickListener, true)
    removeFocusClickListener = () => {
      document.removeEventListener('click', FocusClickListener, true)
    }
  }

  selectedBlockKey.value = key
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

// 关闭编辑弹窗与保存后读取数据
function closeEventEditor(open: boolean) {
  if (open) return
  editingEventId.value = null
  creatingEvent.value = false
}

async function contentSaved() {
  resetFocus()
  await props.refreshContent()
}

const refreshTasks = () => props.refreshContent()
</script>

<template>
  <div
    ref="viewport"
    class="schedule-viewport"
  >
    <div
      class="schedule-tools"
      :class="{ 'schedule-tools--visible': systemMode === 'edit' }"
    >
      <BackgroundSelect
        :background-key="`${backgroundKey ?? 'schedule'}:${phase.id}`"
        :aspect-ratio="backgroundRatio"
        hide-selection
        @change="backgroundSelection = $event"
        @loading-change="backgroundPending = $event"
      />
      <button
        v-if="systemMode === 'edit'"
        type="button"
        class="button"
        title="新建课程"
        aria-label="新建空白课程"
        @click="creatingEvent = true"
      >
        <Icon
          name="lucide:plus"
          aria-hidden="true"
        />
      </button>
    </div>
    <Background
      ref="background"
      class="event-schedule__background"
      :pending="backgroundPending"
      :image="backgroundSelection?.image ?? ''"
      :position="backgroundSelection?.position"
      :simplified-image="backgroundSelection?.simplifiedImage"
      :analysis="backgroundSelection?.analysis"
    >
      <section
        class="schedule"
        :style="{ '--schedule-columns': gridColumns }"
      >
        <div
          ref="scheduleHeader"
          class="schedule-header"
        >
          <div class="schedule-header-time">
            {{ weekLabel }}
          </div>

          <div
            v-for="(column, index) in visibleColumns"
            :key="column.key"
            class="schedule-header-weekday"
            :class="{
              'schedule-header-weekday--today': column.date === today,
              'schedule-header-weekday--previous': showPeriodNavigation && index === 0,
              'schedule-header-weekday--next': showPeriodNavigation && index === visibleColumns.length - 1
            }"
          >
            <button
              v-if="showPeriodNavigation && index === 0"
              class="schedule-period-button schedule-period-button--previous"
              type="button"
              aria-label="上一周期"
              title="上一周期"
              :disabled="!canMovePrevious"
              @click.stop="movePeriod(-1)"
            />
            <span
              class="schedule-header-label"
              :title="weekdayLabels[column.weekday - 1]"
            >
              <span class="schedule-header-prefix">周</span>{{ weekdayLabels[column.weekday - 1]?.slice(1) }}
            </span>
            <button
              v-if="showPeriodNavigation && index === visibleColumns.length - 1"
              class="schedule-period-button schedule-period-button--next"
              type="button"
              aria-label="下一周期"
              title="下一周期"
              :disabled="!canMoveNext"
              @click.stop="movePeriod(1)"
            />
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
          <div class="schedule-time-axis">
            <span
              v-for="minute in hourMarks"
              :key="minute"
              class="schedule-hour-label"
              :style="{ top: `${minutesToY(minute)}px` }"
            >
              <span class="hour-full">
                {{ minutesToTime(minute) }}
              </span>
              <span class="hour-short">
                {{ minutesToTime(minute).split(':')[0] }}
              </span>
            </span>
          </div>
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
              :moving="focusMoving"
              @mouseenter="emit('event-hover', block.eventId)"
              @mouseleave="emit('event-hover', null)"
              @select="openFocus(block.key)"
              @edit="editingEventId = $event"
            />
            <TaskLine
              v-for="line in taskLines.get(column.key)"
              :key="line.key"
              :change-task="props.changeTask"
              :top="line.top.value"
              :covered="line.covered.value"
              :marker-offset="line.markerOffset.value"
              :kind="line.kind"
              :task-id="line.task.id"
              :task="line.task"
              :task-name="line.task.title"
              :planned-date="line.kind === 'plan' ? line.task.plannedDate ?? undefined : undefined"
              :due-date="line.kind === 'due' ? line.task.dueDate ?? undefined : undefined"
              @mouseenter="emit('task-hover', line.task.id)"
              @mouseleave="emit('task-hover', null)"
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
              :style="{ gridColumn: index + 2 }"
            />
          </div>
        </div>
      </section>
    </Background>
    <EventEditPopup
      v-if="editingEventId !== null || creatingEvent"
      :events="props.events"
      :events-pending="props.eventsPending"
      :refresh-events="props.refreshEvents"
      :event-id="editingEventId ?? undefined"
      :phase-id="phase.id"
      :week-count="maxWeek"
      :open="true"
      @update:open="closeEventEditor"
      @saved="contentSaved"
      @deleted="contentSaved"
      @task-saved="refreshTasks"
      @task-deleted="refreshTasks"
    />
  </div>
</template>

<style scoped>
.schedule-viewport {
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  container-name: schedule;
  overflow: visible;
}

.schedule-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.schedule-tools--visible {
  margin-bottom: 8px;
}

.schedule-viewport > .event-schedule__background {
  height: auto;
  overflow: clip;
}

.schedule {
  --time-axis-width: 64px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
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

.schedule-header-time {
  display: grid;
  place-items: center;
  background-color: var(--background-primary);
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

.schedule-header-weekday--previous {
  padding-left: 22px;
}

.schedule-header-weekday--next {
  padding-right: 22px;
}

.schedule-period-button {
  position: absolute;
  top: 4px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.schedule-period-button::before {
  width: 8px;
  height: 12px;
  background: currentColor;
  content: '';
}

.schedule-period-button--previous {
  left: 1px;
}

.schedule-period-button--next {
  right: 1px;
}

.schedule-period-button--previous::before {
  clip-path: polygon(100% 0, 0 50%, 100% 100%);
}

.schedule-period-button--next::before {
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

.schedule-period-button:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--background-primary);
}

.schedule-period-button:disabled {
  opacity: .3;
  cursor: default;
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

.schedule-time-axis {
  position: relative;
  overflow: hidden;
  color: var(--text-secondary);
  background-color: var(--background-secondary);
}

.schedule-hour-label {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  transform: translateY(-50%);
}

.hour-short {
  display: none;
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
  left: var(--time-axis-width);
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

.schedule-current-time::before {
  position: absolute;
  left: calc(var(--time-axis-width) - 8px);
  top: -6px;
  width: 8px;
  height: 12px;
  background: currentColor;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
  content: '';
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

@container schedule (max-width: 600px) {
  .schedule {
    --time-axis-width: 16px;
  }

  .schedule-header-time {
    font-size: 10px;
  }

  .schedule-time-axis {
    text-align: center;
  }

  .hour-full {
    display: none;
  }

  .hour-short {
    display: inline;
    font-size: 13px;
  }
}

@container schedule-weekday (width < 2.25em) {
  .schedule-header-prefix {
    display: none;
  }
}
</style>
