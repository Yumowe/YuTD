<script setup lang="ts">
// 组件与依赖
import Background from '../image/BackgroundLayout.vue'
import BackgroundSelect from '../image/BackgroundSelect.vue'
import ScheduleTableGrid from './ScheduleTableGrid.vue'
import type { BackgroundSelection } from '~/components/image/BackgroundSelect.vue'
import { gsap } from 'gsap'

const props = withDefaults(defineProps<{
  /** 当前阶段的课程及排课数据，未就绪时为 undefined。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 当前阶段的任务，用于显示计划时间线和截止时间线。 */
  tasks: ApiData<Api['api']['task']['get']> | undefined
  /** 课程数据是否正在读取，数据就绪后才进行首次定位。 */
  eventsPending: boolean
  /** 当前阶段，提供起始日期、阶段 ID 和总周数。 */
  phase: ApiData<Api['api']['phase']['get']>[number]
  /** 日期分组方式：full 每周一组，easy 每周保留有内容的星期，custom 按连续日期分组；默认 full。 */
  mode?: 'easy' | 'full' | 'custom'
  /** custom 首组的起始星期与列数，如 [1, 2] 从周一开始，每两天一组；省略时每七天一组。 */
  weekdays?: number[]
  /** 是否显示上一周期和下一周期按钮，默认 true。 */
  showPeriodNavigation?: boolean
  /** 背景绑定的标识前缀，实际保存时追加阶段 ID，默认 schedule。 */
  backgroundKey?: string
  /** 进入或返回组件时，是否居中到当前时间；超出时间范围时回到顶部，默认 false。 */
  autoCenter?: boolean
  /** 时间表上下边缘的留白像素，默认 20。 */
  edgePixels?: number
}>(), {
  showPeriodNavigation: true,
  autoCenter: false,
  edgePixels: 20
})

// 显示日期统一用一维日期组驱动内层；二维数组索引 0 保留为空。
const events = computed(() => props.events ?? [])
const tasks = computed(() => props.tasks ?? [])
const { now, timeZone } = useSystemTime()
const { preferences } = useAppPeferences()
const hourPixels = computed(() => preferences.value?.hourPixels ?? 72)
const phaseDay = computed(() => calendarDate(props.phase.startDate, 'UTC'))
const phaseEnd = computed(() => calendarDate(props.phase.endDate, 'UTC'))
const today = computed(() => now.value ? calendarDate(now.value, timeZone.value) : null)
const group = ref(1)

const visibleWeekdays = computed(() => {
  if (props.mode === 'custom') {
    const days = props.weekdays?.filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
    return days?.length ? [...new Set(days)] : [1, 2, 3, 4, 5, 6, 7]
  }
  if (props.mode !== 'easy') return [1, 2, 3, 4, 5, 6, 7]
  const days = new Set<number>()
  for (const event of events.value) {
    for (const schedule of event.schedules) {
      if (schedule.weekday && Array.isArray(schedule.weeks)
        && schedule.weeks.some(week => typeof week === 'number' && week >= 1 && week <= props.phase.weekCount)) days.add(schedule.weekday)
    }
  }
  for (const task of tasks.value) {
    for (const value of [task.plannedDate, task.dueDate]) {
      if (!value) continue
      const date = calendarDate(value, timeZone.value)
      if (date >= phaseDay.value && date <= phaseEnd.value) days.add(calendarWeekday(date))
    }
  }
  return [1, 2, 3, 4, 5, 6, 7].filter(day => days.has(day))
})

const dateGroups = computed<Date[][]>(() => {
  const start = phaseDay.value
  const end = phaseEnd.value
  const groups: Date[][] = [[]]
  const days = calendarDayNumber(end) - calendarDayNumber(start) + 1
  const dateAt = (offset: number) => parseZonedDateTime(addCalendarDays(start, offset), timeZone.value)
  if (props.mode === 'custom') {
    const size = visibleWeekdays.value.length
    for (let offset = (visibleWeekdays.value[0] ?? 1) - 1; offset < days; offset += size) {
      groups.push(Array.from({ length: Math.min(size, days - offset) }, (_, index) => dateAt(offset + index)))
    }
  } else {
    for (let week = 1; week <= props.phase.weekCount; week++) {
      groups[week] = visibleWeekdays.value
        .map(day => (week - 1) * 7 + day - 1)
        .filter(offset => offset < days)
        .map(dateAt)
    }
  }
  return groups
})

const groupIndices = computed(() => dateGroups.value.flatMap((dates, index) => index > 0 && dates.length ? [index] : []))
const groupPosition = computed(() => groupIndices.value.indexOf(group.value))
const canMovePrevious = computed(() => groupPosition.value > 0)
const canMoveNext = computed(() => groupPosition.value >= 0 && groupPosition.value < groupIndices.value.length - 1)

const pagesElement = ref<HTMLElement | null>(null)
const activeGrid = shallowRef<InstanceType<typeof ScheduleTableGrid> | null>(null)

// 时间范围和左轴由外层统一绘制，聚焦时跟随当前表格页的纵向缩放。
function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number) as [number, number]
  return hours * 60 + minutes
}

function dateToMinutes(date: Date) {
  const { hour, minute } = clockParts(date, timeZone.value)
  return hour * 60 + minute
}

function minutesToTime(minutes: number) {
  return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
}

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

const hourMarks = computed(() => Array.from(
  { length: (scheduleBounds.value.end - scheduleBounds.value.start) / 60 + 1 },
  (_, index) => scheduleBounds.value.start + index * 60
))
const boardHeight = computed(() => (scheduleBounds.value.end - scheduleBounds.value.start) * hourPixels.value / 60 + props.edgePixels * 2)
const axisLayout = computed(() => activeGrid.value?.axisLayout)
const axisHeaderHeight = computed(() => axisLayout.value?.headerHeight || 45)

function minutesToY(minutes: number) {
  return (minutes - scheduleBounds.value.start) * (axisLayout.value?.hourPixels ?? hourPixels.value) / 60
    + props.edgePixels + (axisLayout.value?.offsetY ?? 0)
}

const weekLabel = computed(() => [...new Set((dateGroups.value[group.value] ?? []).map(date =>
  Math.floor((calendarDayNumber(calendarDate(date, timeZone.value)) - calendarDayNumber(phaseDay.value)) / 7) + 1
))].filter(week => week >= 1 && week <= props.phase.weekCount).join(' / ') || '—')

const currentTimeY = computed(() => {
  if (!now.value || !(dateGroups.value[group.value] ?? []).some(date => calendarDate(date, timeZone.value) === today.value)) return null
  const minutes = dateToMinutes(now.value) + clockParts(now.value, timeZone.value).second / 60
  return minutes < scheduleBounds.value.start || minutes > scheduleBounds.value.end ? null : minutesToY(minutes)
})

const slide = { value: 0 }
const dragging = ref(false)
const settling = ref(false)
let slideTween: ReturnType<typeof gsap.to> | undefined
let settleDirection: -1 | 0 | 1 = 0
let swipe: { id: number, x: number, y: number, width: number, offset: number, horizontal: boolean } | null = null
let suppressClickUntil = 0

const periodPages = computed(() => [-1, 0, 1].map((offset) => {
  const index = groupIndices.value[groupPosition.value + offset]
  const dates = index === undefined ? undefined : dateGroups.value[index]
  return {
    dates,
    offset,
    key: dates ? `${index}:${dates.map(date => date.getTime()).join(',')}` : `empty:${offset}`
  }
}))

function setActiveGrid(component: unknown, offset: number) {
  if (!component) return
  const grid = component as InstanceType<typeof ScheduleTableGrid>
  if (offset === 0) {
    activeGrid.value = grid
    grid.activate()
  } else {
    grid.deactivate()
  }
  grid.setMoving(settling.value || dragging.value)
}

watch([dragging, settling], ([dragging, settling]) => {
  activeGrid.value?.setMoving(dragging || settling)
})

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

const { mode: systemMode } = useSystemStatus()

// 前后周期提前挂载，共用外层背景；切换时只移动表格。
function renderSlide() {
  pagesElement.value?.style.setProperty('--schedule-shift', `${slide.value * 100}%`)
}

function resetPeriodMotion() {
  slideTween?.kill()
  slideTween = undefined
  settleDirection = 0
  swipe = null
  slide.value = 0
  renderSlide()
  dragging.value = false
  settling.value = false
}

function settlePeriod(direction: -1 | 0 | 1) {
  slideTween?.kill()
  settleDirection = direction
  dragging.value = false
  settling.value = true
  const finish = () => {
    group.value = groupIndices.value[groupPosition.value + direction] ?? group.value
    slide.value = 0
    renderSlide()
    settling.value = false
    slideTween = undefined
    settleDirection = 0
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish()
    return
  }
  slideTween = gsap.to(slide, {
    value: -direction,
    duration: direction ? 0.3 : 0.2,
    ease: 'power3.out',
    onUpdate: renderSlide,
    onComplete: finish
  })
}

function movePeriod(direction: -1 | 1) {
  if (settling.value || (direction < 0 ? !canMovePrevious.value : !canMoveNext.value)) return
  settlePeriod(direction)
}

// 捕获 viewport 内的触摸，不让按钮或任务自己的事件拦掉横滑。
function startSwipe(event: TouchEvent) {
  suppressClickUntil = 0
  if (event.touches.length !== 1) {
    cancelSwipe()
    return
  }
  if (groupPosition.value < 0) return
  const touch = event.touches[0]!
  const width = pagesElement.value?.clientWidth
  if (!width) return
  swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, width, offset: 0, horizontal: false }
}

function moveSwipe(event: TouchEvent) {
  if (!swipe) return
  const touch = event.touches[0]
  if (event.touches.length !== 1 || touch?.identifier !== swipe.id) {
    cancelSwipe()
    return
  }
  const dx = touch.clientX - swipe.x
  const dy = touch.clientY - swipe.y
  if (!swipe.horizontal) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return
    if (Math.abs(dx) <= Math.abs(dy) * 1.5) {
      swipe = null
      return
    }
    swipe.horizontal = true
    dragging.value = true
    if (settling.value) {
      slideTween?.kill()
      slideTween = undefined
      group.value = groupIndices.value[groupPosition.value + settleDirection] ?? group.value
      slide.value += settleDirection
      settleDirection = 0
      settling.value = false
    }
    const allowed = slide.value > 0 ? canMovePrevious.value : canMoveNext.value
    swipe.offset = slide.value / (allowed ? 1 : 0.2)
  }
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  suppressClickUntil = performance.now() + 250
  const offset = swipe.offset + dx / swipe.width
  const allowed = offset > 0 ? canMovePrevious.value : canMoveNext.value
  slide.value = Math.max(-1, Math.min(1, offset)) * (allowed ? 1 : 0.2)
  renderSlide()
}

function endSwipe(event: TouchEvent) {
  const current = swipe
  swipe = null
  if (!current?.horizontal) return
  if (event.cancelable) event.preventDefault()
  event.stopPropagation()
  suppressClickUntil = performance.now() + 250
  const touch = Array.from(event.changedTouches).find(touch => touch.identifier === current.id)
  if (!touch || event.touches.length) {
    settlePeriod(0)
    return
  }
  const dx = touch.clientX - current.x
  const dy = touch.clientY - current.y
  const direction = dx < 0 ? 1 : -1
  const allowed = direction < 0 ? canMovePrevious.value : canMoveNext.value
  settlePeriod(allowed && Math.abs(dx) >= Math.min(72, current.width * 0.2)
    && Math.abs(dx) > Math.abs(dy) * 1.5
    ? direction
    : 0)
}

function cancelSwipe() {
  const horizontal = swipe?.horizontal
  swipe = null
  if (horizontal) settlePeriod(0)
}

function suppressSwipeClick(event: MouseEvent) {
  if (event.detail === 0 || performance.now() >= suppressClickUntil) return
  suppressClickUntil = 0
  event.preventDefault()
  event.stopImmediatePropagation()
}

// 配置变化时定位今天所在组；业务数据刷新时保留已有的有效组号。
watch([dateGroups, today, () => props.phase.id, () => props.mode, () => props.weekdays?.join(','), timeZone],
  ([groups, day], previous) => {
    const configurationChanged = !previous || day !== previous[1] || props.phase.id !== previous[2]
      || props.mode !== previous[3] || props.weekdays?.join(',') !== previous[4] || timeZone.value !== previous[5]
    if (!configurationChanged && previous?.[0]?.some(dates => dates.length) && groupIndices.value.includes(group.value)) return
    resetPeriodMotion()
    const week = day ? Math.floor((calendarDayNumber(day) - calendarDayNumber(phaseDay.value)) / 7) + 1 : -1
    const containing = props.mode !== 'custom' && groups[week]?.length
      ? week
      : day ? groups.findIndex(dates => dates.some(date => calendarDate(date, timeZone.value) === day)) : -1
    const upcoming = day ? groupIndices.value.find(index => calendarDate(groups[index]![0]!, timeZone.value) >= day) : undefined
    group.value = containing > 0 ? containing : (day ? upcoming ?? groupIndices.value.at(-1) : groupIndices.value[0]) ?? 1
  }, { immediate: true })

watch(group, () => {
  if (groupIndices.value.includes(group.value)) return
  resetPeriodMotion()
  group.value = groupIndices.value.find(index => index >= group.value) ?? groupIndices.value.at(-1) ?? 1
})
// 自动定位属于外层显示策略，避免预加载页影响滚动位置。
const initialPosition = ref(true)
function positionInitially() {
  if (!props.autoCenter || !initialPosition.value || props.eventsPending || props.events === undefined || props.tasks === undefined) return
  if (activeGrid.value?.centerCurrentTime()) initialPosition.value = false
}

watch([() => props.autoCenter, today, group, dateGroups], () => {
  initialPosition.value = true
  void nextTick(positionInitially)
})
watch([activeGrid, events, tasks, axisHeaderHeight, boardHeight, () => props.eventsPending], () => {
  void nextTick(positionInitially)
}, { flush: 'post' })
onActivated(() => {
  activeGrid.value?.activate()
  activeGrid.value?.setMoving(false)
  initialPosition.value = true
  void nextTick(positionInitially)
})

onDeactivated(resetPeriodMotion)
onBeforeUnmount(() => {
  resetPeriodMotion()
  backgroundObserver?.disconnect()
})

defineExpose({ dateGroups, group })
</script>

<template>
  <div
    class="schedule-viewport"
    @pointerdown.capture="suppressClickUntil = 0"
    @touchstart.capture.passive="startSwipe"
    @touchmove.capture="moveSwipe"
    @touchend.capture="endSwipe"
    @touchcancel.capture="cancelSwipe"
    @click.capture="suppressSwipeClick"
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
        @click="activeGrid?.createEvent()"
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
      <div
        v-if="groupIndices.length"
        class="schedule-frame"
        :class="{ 'schedule-frame--navigation': showPeriodNavigation }"
      >
        <div class="schedule-axis">
          <div
            class="schedule-header-time"
            :style="{ height: `${axisHeaderHeight}px` }"
            aria-live="polite"
          >
            {{ weekLabel }}
          </div>
          <div
            class="schedule-time-axis"
            :style="{ height: `${boardHeight}px` }"
          >
            <span
              v-for="minute in hourMarks"
              :key="minute"
              class="schedule-hour-label"
              :style="{ top: `${minutesToY(minute)}px` }"
            >
              <span class="hour-full">{{ minutesToTime(minute) }}</span>
              <span class="hour-short">{{ minutesToTime(minute).split(':')[0] }}</span>
            </span>
            <span
              v-if="currentTimeY !== null"
              class="schedule-current-time-arrow"
              :style="{ top: `${currentTimeY}px` }"
              aria-hidden="true"
            />
          </div>
        </div>
        <div
          ref="pagesElement"
          class="schedule-pages"
        >
          <div class="schedule-track">
            <div
              v-for="page in periodPages"
              :key="page.key"
              class="schedule-page"
              :inert="page.offset !== 0 || dragging || settling"
              :aria-hidden="page.offset !== 0"
            >
              <ScheduleTableGrid
                v-if="page.dates"
                :ref="component => setActiveGrid(component, page.offset)"
                :events="props.events"
                :tasks="props.tasks"
                :phase="phase"
                :dates="page.dates"
                :edge-pixels="edgePixels"
              />
            </div>
          </div>
          <div
            v-if="showPeriodNavigation"
            class="schedule-navigation"
            :style="{ height: `${axisHeaderHeight}px` }"
          >
            <button
              class="schedule-period-button schedule-period-button--previous"
              type="button"
              aria-label="上一周期"
              title="上一周期"
              :disabled="!canMovePrevious"
              @click.stop="movePeriod(-1)"
            />
            <button
              class="schedule-period-button schedule-period-button--next"
              type="button"
              aria-label="下一周期"
              title="下一周期"
              :disabled="!canMoveNext"
              @click.stop="movePeriod(1)"
            />
          </div>
        </div>
      </div>
    </Background>
  </div>
</template>

<style scoped>
.schedule-viewport {
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  container-name: schedule;
  overflow: visible;
  touch-action: pan-y pinch-zoom;
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

.schedule-frame {
  --time-axis-width: 64px;
  display: grid;
  grid-template-columns: var(--time-axis-width) minmax(0, 1fr);
  min-width: 0;
  border: 1px solid var(--border-color);
}

.schedule-axis {
  min-width: 0;
}

.schedule-header-time {
  position: sticky;
  top: 0;
  z-index: 21;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--background-primary);
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

.schedule-current-time-arrow {
  position: absolute;
  right: 0;
  width: 8px;
  height: 12px;
  transform: translateY(-50%);
  background: var(--accent-color);
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

.schedule-pages {
  display: grid;
  min-width: 0;
  overflow: clip;
}

.schedule-track {
  grid-area: 1 / 1;
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  align-self: start;
  transform: translate3d(calc(-100% + var(--schedule-shift, 0%)), 0, 0);
  will-change: transform;
}

.schedule-page {
  flex: 0 0 100%;
  min-width: 0;
}

@container schedule (max-width: 600px) {
  .schedule-frame { --time-axis-width: 16px; }
  .schedule-header-time { font-size: 10px; }
  .hour-full { display: none; }
  .hour-short { display: inline; font-size: 13px; }
}
.schedule-navigation {
  grid-area: 1 / 1;
  position: sticky;
  top: 0;
  z-index: 22;
  align-self: start;
  pointer-events: none;
}

.schedule-frame--navigation :deep(.schedule-header-weekday:first-child) { padding-left: 22px; }
.schedule-frame--navigation :deep(.schedule-header-weekday:last-child) { padding-right: 22px; }

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
  pointer-events: auto;
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
</style>
