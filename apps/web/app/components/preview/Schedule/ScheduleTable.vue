<script setup lang="ts">
// 组件与依赖
import Background from '~/components/image/BackgroundLayout.vue'
import BackgroundSelect from '~/components/image/BackgroundSelect.vue'
import ScheduleTableGrid from './ScheduleTableGrid.vue'
import { createScheduleData, ScheduleDataKey } from './scheduleData'
import type { BackgroundSelection } from '~/components/image/BackgroundSelect.vue'
import { useSchedulePaging } from '~/composables/useAnimations/useSchedulePaging'
import { calendarDateKey, dateToMinutes, minutesToTime, weekNumberFrom } from '~/utils/date'

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
  /** 点击课程时启用聚焦动画，关闭时打开课程详情。 */
  focusEnabled?: boolean
  /** 背景绑定的标识前缀，实际保存时追加阶段 ID，默认 schedule。 */
  backgroundKey?: string
  /** 进入或返回组件时，是否居中到当前时间；超出时间范围时回到顶部，默认 false。 */
  autoCenter?: boolean
  /** 时间表上下边缘的留白像素，默认 20。 */
  edgePixels?: number
}>(), {
  showPeriodNavigation: true,
  focusEnabled: false,
  autoCenter: false,
  edgePixels: 20
})

// 显示日期统一用一维日期组驱动内层；二维数组索引 0 保留为空。
const events = computed(() => props.events ?? [])
const tasks = computed(() => props.tasks ?? [])
const { now, timeZone } = useSystemTime()
const { preferences } = useAppPeferences()
const hourPixels = computed(() => preferences.value?.hourPixels ?? 72)
const maxFocusScale = computed(() => props.focusEnabled ? (preferences.value?.maxFocusScale ?? 2) : 0)
const phaseDay = computed(() => calendarDateKey(props.phase.startDate))
const phaseEnd = computed(() => calendarDateKey(props.phase.endDate))
const today = computed(() => now.value ? calendarDate(now.value, timeZone.value) : null)
const scheduleData = createScheduleData(
  events, tasks, timeZone, computed(() => props.phase.weekCount), phaseDay, hourPixels, maxFocusScale
)
provide(ScheduleDataKey, scheduleData)

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

const activeGrid = shallowRef<InstanceType<typeof ScheduleTableGrid> | null>(null)

// 时间范围和左轴由外层统一绘制，聚焦时跟随当前表格页的纵向缩放。
const scheduleBounds = scheduleData.bounds

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

// 背景选择与裁剪尺寸
const backgroundSelection = shallowRef<BackgroundSelection | null>(null)

const backgroundPending = ref(true)

const background = ref<InstanceType<typeof Background> | null>(null)

const backgroundRatio = ref<number>()

let backgroundObserver: ResizeObserver | undefined

onMounted(() => {
  const element = background.value?.$el as HTMLElement | undefined
  if (!element) return
  const resize = () => {
    if (element.clientWidth && element.clientHeight) backgroundRatio.value = element.clientWidth / element.clientHeight
  }
  resize()
  backgroundObserver = new ResizeObserver(resize)
  backgroundObserver.observe(element)
})

const { mode: systemMode } = useSystemStatus()

onBeforeUnmount(() => {
  backgroundObserver?.disconnect()
})

// ==================== 翻页动画与触发 ====================
const groupIndices = computed(() => dateGroups.value.flatMap((dates, index) => index > 0 && dates.length ? [index] : []))
const {
  group,
  groupPosition,
  canMovePrevious,
  canMoveNext,
  pagesElement,
  trackElement,
  dragging,
  settling,
  resetPeriodMotion,
  movePeriod,
  resetSwipeClick,
  startSwipe,
  moveSwipe,
  endSwipe,
  cancelSwipe,
  suppressSwipeClick
} = useSchedulePaging(groupIndices)

const periodPages = computed(() => [-1, 0, 1].map((offset) => {
  const index = groupIndices.value[groupPosition.value + offset]
  const dates = index === undefined ? undefined : dateGroups.value[index]
  return {
    dates,
    offset,
    key: (groupPosition.value + offset + 3) % 3
  }
}))

function setActiveGrid(component: unknown, offset: number) {
  if (!component) return
  const grid = component as InstanceType<typeof ScheduleTableGrid>
  if (offset === 0) {
    grid.activate()
    if (activeGrid.value !== grid) {
      activeGrid.value = grid
      void nextTick(positionInitially)
    }
  } else {
    grid.deactivate()
  }
  grid.setMoving(settling.value || dragging.value)
}

// 自动定位属于外层显示策略，避免预加载页影响滚动位置。
const initialPosition = ref(true)
const dataReady = computed(() => !props.eventsPending && props.events !== undefined && props.tasks !== undefined)

function positionInitially() {
  if (!props.autoCenter || !initialPosition.value || !dataReady.value) return
  if (activeGrid.value?.centerCurrentTime()) initialPosition.value = false
}

const periodSettings = computed(() => JSON.stringify([
  today.value, props.phase.id, props.mode, props.weekdays?.join(','), timeZone.value
]))

function initialGroup(groups: Date[][]) {
  const day = today.value
  if (!day) return groupIndices.value[0] ?? 1
  const week = weekNumberFrom(day, phaseDay.value)
  const containing = props.mode !== 'custom' && groups[week]?.length
    ? week
    : groups.findIndex(dates => dates.some(date => calendarDate(date, timeZone.value) === day))
  if (containing > 0) return containing
  const upcoming = groupIndices.value.find(index => calendarDate(groups[index]![0]!, timeZone.value) >= day)
  return upcoming ?? groupIndices.value.at(-1) ?? 1
}

watch([group, dateGroups, periodSettings, () => props.autoCenter, dataReady],
  ([current, groups, settings, autoCenter], [previous, previousGroups, previousSettings, previousAutoCenter]) => {
    const settingsChanged = settings !== previousSettings
    const invalidGroup = !groupIndices.value.includes(current)
    if (settingsChanged || (groups !== previousGroups && invalidGroup)
      || (!previousGroups?.some(dates => dates.length) && groupIndices.value.length)) {
      resetPeriodMotion()
      group.value = initialGroup(groups)
    } else if (invalidGroup && groupIndices.value.length) {
      resetPeriodMotion()
      group.value = groupIndices.value.find(index => index >= current) ?? groupIndices.value.at(-1) ?? 1
    }
    if (current !== previous || groups !== previousGroups || settingsChanged || autoCenter !== previousAutoCenter) {
      initialPosition.value = true
    }
    if (props.autoCenter && initialPosition.value && dataReady.value) void nextTick(positionInitially)
  }, { immediate: true })

onActivated(() => {
  activeGrid.value?.activate()
  activeGrid.value?.setMoving(false)
  initialPosition.value = true
  void nextTick(positionInitially)
})

// 当前周与时间标记
const weekLabel = computed(() => [...new Set((dateGroups.value[group.value] ?? []).map(date =>
  weekNumberFrom(calendarDate(date, timeZone.value), phaseDay.value)
))].filter(week => week >= 1 && week <= props.phase.weekCount).join(' / ') || '—')

const currentTimeY = computed(() => {
  if (!now.value || !(dateGroups.value[group.value] ?? []).some(date => calendarDate(date, timeZone.value) === today.value)) return null
  const minutes = dateToMinutes(now.value, timeZone.value)
  return minutes < scheduleBounds.value.start || minutes > scheduleBounds.value.end ? null : minutesToY(minutes)
})

defineExpose({ dateGroups, group })
</script>

<template>
  <div
    class="schedule-viewport"
    @pointerdown.capture="resetSwipeClick"
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
              :style="{ translate: `0 ${minutesToY(minute)}px` }"
            >
              <span class="hour-full">{{ minutesToTime(minute) }}</span>
              <span class="hour-short">{{ minutesToTime(minute).split(':')[0] }}</span>
            </span>
            <span
              v-if="currentTimeY !== null"
              class="schedule-current-time-arrow"
              :style="{ translate: `0 ${currentTimeY}px` }"
              aria-hidden="true"
            />
          </div>
        </div>
        <div
          ref="pagesElement"
          class="schedule-pages"
        >
          <div
            ref="trackElement"
            class="schedule-track"
          >
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
                :focus-enabled="focusEnabled"
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
  top: 0;
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
  top: 0;
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
  transform: translate3d(-100%, 0, 0);
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
