<script setup lang="ts">
import AppPopup from '~/components/common/AppPopup.vue'
import BackgroundLayout from '~/components/image/BackgroundLayout.vue'
import BackgroundSelect, { type BackgroundSelection } from '~/components/image/BackgroundSelect.vue'
import Card from '../card/Card.vue'
import TaskBlock from './TaskBlock.vue'
import TaskActions from '~/components/edit/TaskActions.vue'
import { useTaskBarGrowth } from '~/composables/useAnimations/useTaskBarGrowth'
import { useTaskBarScroll } from '~/composables/useAnimations/useTaskBarScroll'
import { isTaskClosed } from '#shared/attention'

const TaskEditPopup = defineAsyncComponent(() => import('../../edit/TaskEditPopup.vue'))

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  /** 当前阶段的任务列表。 */
  tasks: ApiData<Api['api']['task']['get']>
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 重新读取课程数据。 */
  refreshEvents: () => Promise<unknown>
  /** 所属阶段 ID。 */
  phaseId: ApiData<Api['api']['phase']['get']>[number]['id']
  /** 时间轴的阶段结束日期。 */
  endDate: ApiData<Api['api']['phase']['get']>[number]['endDate']
  /** 时间轴方向，默认横向。 */
  orientation?: 'horizontal' | 'vertical'
  /** 时间轴每小时的像素数，未传时自动计算。 */
  hourPixels?: number
  /** 开始线上方的留白高度。 */
  headSpace?: number
  /** 允许标题显示在柱内的最小高度。 */
  headerMinHeight?: number
}>(), { orientation: 'horizontal', headSpace: 16, headerMinHeight: 112 })

const emit = defineEmits<{ change: [taskId: number], saved: [task: ApiData<Api['api']['task']['get']>[number]], deleted: [taskId: number] }>()

const { now, timeZone } = useSystemTime()

const currentTime = computed(() => now.value ?? new Date())

const today = computed(() => calendarDate(currentTime.value, timeZone.value))

const endDay = computed(() => props.endDate.toISOString().slice(0, 10))

function timeHour(date: Date) {
  const day = calendarDayNumber(calendarDate(date, timeZone.value)) - calendarDayNumber(today.value)
  const { hour, minute, second } = clockParts(date, timeZone.value)
  return day * 24 + hour + minute / 60 + (second + date.getMilliseconds() / 1000) / 3600
}

const currentHour = computed(() => timeHour(currentTime.value))

const taskTimes = computed(() => props.tasks.flatMap((task) => {
  if (!task.dueDate) return []
  return [{ task, due: timeHour(new Date(task.dueDate)), planned: task.plannedDate ? timeHour(new Date(task.plannedDate)) : null }]
}))

const formattedTime = computed(() => {
  if (now.value === null) {
    return '--:--'
  }

  return now.value.toLocaleTimeString('zh-CN', {
    timeZone: timeZone.value,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
})

const { mode } = useSystemStatus()

const inset = 16

const bufferDays = 7

const viewport = ref<HTMLElement | null>(null)

const plot = ref<HTMLElement | null>(null)

const renderedDays = ref(0)

const geometry = reactive({ height: 0, width: 0, viewportWidth: 0 })

const backgroundSelection = shallowRef<BackgroundSelection | null>(null)
const backgroundPending = ref(true)
const backgroundRatio = computed(() => geometry.viewportWidth && geometry.height ? geometry.viewportWidth / geometry.height : undefined)

const horizontal = computed(() => props.orientation === 'horizontal')

const timeScroll = computed(() => horizontal.value ? 'scrollLeft' : 'scrollTop')

const camera = reactive({ left: 0, top: 0, dragging: false, showReturn: false, positioned: false })

const detailId = useId()
const detailTaskId = ref<number | null>(null)
const detailAnchor = shallowRef<HTMLElement | null>(null)

const selectedTaskId = ref<number | null>(null)

const creatingTask = ref(false)

let observer: ResizeObserver | undefined

const headSpace = computed(() => Number.isFinite(props.headSpace) && props.headSpace >= 0 ? props.headSpace : 16)

const headerLimit = computed(() => Number.isFinite(props.headerMinHeight) && props.headerMinHeight >= 0 ? props.headerMinHeight : 112)

const scaleFit = computed(() => {
  const fallback = props.hourPixels !== undefined && Number.isFinite(props.hourPixels) && props.hourPixels > 0 ? props.hourPixels : 4
  if (props.hourPixels !== undefined && Number.isFinite(props.hourPixels) && props.hourPixels > 0) {
    return { scale: fallback, start: Math.ceil(currentHour.value * fallback) }
  }
  const remaining = taskTimes.value
    .filter(({ task, due }) => due > currentHour.value && !isTaskClosed(task))
    .sort((a, b) => a.due - b.due || a.task.id - b.task.id)
    .slice(0, 7)
  const length = horizontal.value ? geometry.width : geometry.height
  const target = Math.max(1, length / 2 - headSpace.value)
  if (!length || !remaining.length) return { scale: fallback, start: Math.ceil(currentHour.value * fallback) }
  const middle = Math.floor(remaining.length / 2)
  const median = remaining.length % 2 ? remaining[middle]!.due : (remaining[middle - 1]!.due + remaining[middle]!.due) / 2
  const start = Math.ceil(currentHour.value * target / (median - currentHour.value))
  return { scale: (target + start) / median, start }
})

const hourScale = computed(() => scaleFit.value.scale)

const dayPixels = computed(() => 24 * hourScale.value)

const startPixel = computed(() => scaleFit.value.start)

const totalDays = computed(() => Math.max(0, calendarDayNumber(endDay.value) - calendarDayNumber(today.value) + 1))

const compactDates = computed(() => horizontal.value ? dayPixels.value < 40 : geometry.width > 0 && geometry.width * 3 / 17 < 40)

const days = computed(() => {
  const labels: { date: string, position: number }[] = []
  const spacing = compactDates.value ? 20 : 40
  for (let index = 0; index < renderedDays.value; index++) {
    const position = index === 0 ? headSpace.value / 2 : headSpace.value + index * dayPixels.value - startPixel.value
    const previous = labels.at(-1)
    if (horizontal.value && previous && position - previous.position < spacing) continue
    labels.push({ date: addCalendarDays(today.value, index), position })
  }
  return labels
})

const canvasLength = computed(() => headSpace.value + Math.max(0, renderedDays.value * dayPixels.value - startPixel.value) + inset)

const titleColors = shallowReactive(new Map<number, string | null>())

const taskBars = computed(() => taskTimes.value.map(({ task, due, planned }) => {
  const distance = due * hourScale.value - startPixel.value
  const length = Math.max(0, distance)
  const plannedLength = planned === null ? 0 : Math.min(length, Math.max(0, planned * hourScale.value - startPixel.value))
  return { task, due, length, plannedLength, overdue: distance < 0, closed: isTaskClosed(task), headerOutside: length < headerLimit.value }
}).sort((a, b) => a.due - b.due))

const plotLength = computed(() => horizontal.value
  ? Math.max(canvasLength.value, headSpace.value + (taskBars.value.at(-1)?.length ?? 0) + inset)
  : canvasLength.value)

const firstIncomplete = computed(() => taskBars.value.find(bar => !bar.closed))

const detailTask = computed(() => {
  if (!totalDays.value || detailTaskId.value === null) return null
  return props.tasks.find(task => task.id === detailTaskId.value && task.dueDate) ?? null
})

const selectedTask = computed(() => props.tasks.find(task => task.id === selectedTaskId.value) ?? null)

function measure() {
  geometry.height = viewport.value?.clientHeight ?? 0
  const width = viewport.value?.getBoundingClientRect().width
  if (width) geometry.viewportWidth = width
  geometry.width = plot.value?.clientWidth ?? 0
  syncScroll()
}

function firstTaskElement() {
  const id = firstIncomplete.value?.task.id
  return id === undefined ? null : plot.value?.querySelector<HTMLElement>(`.task-attention-bar__bar[data-task-id="${id}"]`) ?? null
}

function checkFirstVisible() {
  const element = firstTaskElement()?.querySelector<HTMLElement>('.task-attention-bar__header')
  if (!element || !plot.value) {
    camera.showReturn = false
    return
  }
  const area = plot.value.getBoundingClientRect()
  const bounds = element.getBoundingClientRect()
  camera.showReturn = bounds.right <= area.left || bounds.left >= area.left + plot.value.clientWidth
    || bounds.bottom <= area.top || bounds.top >= area.top + plot.value.clientHeight
}

function syncScroll() {
  camera.left = plot.value?.scrollLeft ?? 0
  camera.top = plot.value?.scrollTop ?? 0
  fillRange()
  checkFirstVisible()
}

function firstTaskTarget() {
  const element = firstTaskElement()
  const header = element?.querySelector<HTMLElement>('.task-attention-bar__header')
  if (!element || !header || !plot.value) return null
  const area = plot.value.getBoundingClientRect()
  const bounds = header.getBoundingClientRect()
  const bar = element.getBoundingClientRect()
  if (horizontal.value) {
    return {
      scrollLeft: 0,
      scrollTop: Math.max(0, plot.value.scrollTop + bar.top - area.top)
    }
  }
  const titleTop = headSpace.value + (firstIncomplete.value?.headerOutside ? firstIncomplete.value.length + 8 : 8)
  return {
    scrollLeft: Math.max(0, plot.value.scrollLeft + bar.left - area.left),
    scrollTop: titleTop + bounds.height <= plot.value.clientHeight
      ? 0
      : Math.max(0, titleTop - headSpace.value)
  }
}

function positionInitially() {
  if (camera.positioned || now.value === null || !geometry.width || !geometry.height) return
  const target = firstTaskTarget()
  if (!target || !plot.value) return
  camera.positioned = true
  plot.value.scrollLeft = target.scrollLeft
  plot.value.scrollTop = target.scrollTop
  syncScroll()
}

function fillRange() {
  const element = plot.value
  if (!element) return
  const visibleLength = horizontal.value ? element.clientWidth : element.clientHeight
  const lastVisibleDay = Math.floor(Math.max(0, element[timeScroll.value] + visibleLength - headSpace.value + startPixel.value) / dayPixels.value)
  renderedDays.value = Math.min(totalDays.value, Math.max(renderedDays.value, lastVisibleDay + 1 + bufferDays))
}

function resetRange() {
  stopTaskScroll()
  renderedDays.value = 0
  camera.positioned = false
  if (plot.value) plot.value[timeScroll.value] = 0
  fillRange()
  void nextTick(() => {
    positionInitially()
    syncScroll()
  })
}

watch([today, endDay, headSpace, () => props.phaseId, timeZone], resetRange, { flush: 'post' })

watch([hourScale, startPixel, horizontal], ([scale, start, across], [previousScale, previousStart, previousAcross]) => {
  if (across !== previousAcross) {
    stopTaskScroll()
    if (plot.value) {
      plot.value.scrollLeft = 0
      plot.value.scrollTop = 0
    }
    resetRange()
    return
  }
  if (plot.value && plot.value[timeScroll.value] > 0) {
    const hour = (plot.value[timeScroll.value] - headSpace.value + previousStart) / previousScale
    plot.value[timeScroll.value] = Math.max(0, headSpace.value + hour * scale - start)
  }
  syncScroll()
}, { flush: 'post' })

watch(taskBars, () => {
  void nextTick(() => {
    positionInitially()
    checkFirstVisible()
  })
})

watch(detailTask, (task) => {
  if (!task) closeTaskDetail()
})

watch([() => firstIncomplete.value?.task.id, () => geometry.width, () => geometry.height], () => {
  void nextTick(() => {
    positionInitially()
    checkFirstVisible()
  })
}, { flush: 'post' })

function closeTaskEditor(open: boolean) {
  if (open) return
  selectedTaskId.value = null
  creatingTask.value = false
}

function closeTaskDetail() {
  detailTaskId.value = null
  detailAnchor.value = null
}

function toggleTaskDetail(id: number, event: MouseEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return
  const anchor = event.currentTarget.querySelector<HTMLElement>('.task-attention-bar__header')
  if (!anchor) return
  const control = event.target instanceof Element ? event.target.closest('button, a, input, select, textarea, [role="button"]') : null
  if (control && control !== anchor) return
  if (detailTaskId.value === id) {
    closeTaskDetail()
    return
  }
  detailAnchor.value = anchor
  detailTaskId.value = id
}

function editTask(id: number) {
  closeTaskDetail()
  selectedTaskId.value = id
}

onDeactivated(closeTaskDetail)

// ==================== 动画与滚动交互 ====================
const { growBars, syncGrowth, replayGrowth } = useTaskBarGrowth(plot, positionInitially)
const { scrollToTask, stopTaskScroll, coastTaskScroll } = useTaskBarScroll(plot, syncScroll)

let suppressClickUntil = 0

let pan: { id: number, x: number, y: number, left: number, top: number, moved: boolean, lastTime: number, velocityX: number, velocityY: number } | undefined

function returnToFirst() {
  const target = firstTaskTarget()
  if (target) scrollToTask(target)
}

function startPan(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || !plot.value) return
  suppressClickUntil = 0
  if (event.target instanceof Element && event.target.closest('.app-popup')) return
  const control = event.target instanceof Element ? event.target.closest('button, a, input, select, textarea, [role="button"]') : null
  if (control && !control.classList.contains('task-attention-bar__header')) return
  const area = plot.value.getBoundingClientRect()
  if (event.target === plot.value && (event.clientX >= area.left + plot.value.clientWidth || event.clientY >= area.top + plot.value.clientHeight)) return
  stopTaskScroll()
  pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: plot.value.scrollLeft, top: plot.value.scrollTop, moved: false, lastTime: event.timeStamp, velocityX: 0, velocityY: 0 }
}

function movePan(event: PointerEvent) {
  if (!pan || pan.id !== event.pointerId || !plot.value) return
  const dx = event.clientX - pan.x
  const dy = event.clientY - pan.y
  if (!pan.moved && Math.hypot(dx, dy) < 5) return
  if (!pan.moved) {
    pan.moved = true
    closeTaskDetail()
    camera.dragging = true
    viewport.value?.setPointerCapture(event.pointerId)
  }
  const left = plot.value.scrollLeft
  const top = plot.value.scrollTop
  plot.value.scrollLeft = pan.left - dx
  plot.value.scrollTop = pan.top - dy
  const elapsed = Math.max(1, event.timeStamp - pan.lastTime)
  const weight = 1 - Math.exp(-elapsed / 30)
  pan.velocityX += ((plot.value.scrollLeft - left) / elapsed - pan.velocityX) * weight
  pan.velocityY += ((plot.value.scrollTop - top) / elapsed - pan.velocityY) * weight
  pan.lastTime = event.timeStamp
  event.preventDefault()
  syncScroll()
}

function endPan(event: PointerEvent) {
  if (!pan || pan.id !== event.pointerId) return
  const current = pan
  if (current.moved) suppressClickUntil = performance.now() + 250
  pan = undefined
  camera.dragging = false
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  if (current.moved && event.type === 'pointerup' && event.pointerType === 'mouse' && event.timeStamp - current.lastTime < 80) {
    coastTaskScroll({ x: current.velocityX, y: current.velocityY })
  }
}

function captureClick(event: MouseEvent) {
  if (event.detail === 0 || performance.now() >= suppressClickUntil) return
  suppressClickUntil = 0
  event.preventDefault()
  event.stopPropagation()
}

function wheelPan(event: WheelEvent) {
  if (!plot.value || event.ctrlKey) return
  if (event.target instanceof Element && event.target.closest('.app-popup, input, select, textarea')) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plot.value.clientHeight : 1
  const left = plot.value.scrollLeft
  const top = plot.value.scrollTop
  stopTaskScroll()
  plot.value.scrollLeft += (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit
  plot.value.scrollTop += (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit
  if (plot.value.scrollLeft !== left || plot.value.scrollTop !== top) event.preventDefault()
  syncScroll()
}

watch(() => taskBars.value.map(bar => bar.task.id).join(','), () => {
  const taskIds = taskBars.value.map(bar => bar.task.id)
  const currentIds = new Set(taskIds)
  for (const id of titleColors.keys()) {
    if (!currentIds.has(id)) titleColors.delete(id)
  }
  syncGrowth(taskIds)
}, { flush: 'post' })

watch(plot, (element, previous) => {
  if (previous) observer?.unobserve(previous)
  if (element) observer?.observe(element)
  measure()
  void growBars()
}, { flush: 'post' })

onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
  if (plot.value) observer.observe(plot.value)
  void growBars()
})

onActivated(() => {
  camera.positioned = false
  void nextTick(() => {
    measure()
    void nextTick(positionInitially)
  })
})

onBeforeUnmount(() => {
  observer?.disconnect()
})

defineExpose({ hourPixels: hourScale, replayGrowth })
</script>

<template>
  <BackgroundLayout
    :image="backgroundSelection?.image ?? ''"
    :position="backgroundSelection?.position"
    :simplified-image="backgroundSelection?.simplifiedImage"
    :analysis="backgroundSelection?.analysis"
    :pending="backgroundPending"
  >
    <section
      v-bind="$attrs"
      ref="viewport"
      class="task-attention-bar"
      :class="{ 'task-attention-bar--dragging': camera.dragging, 'task-attention-bar--horizontal': horizontal }"
      :style="{ '--canvas-length': `${plotLength}px`, '--head-space': `${headSpace}px`, '--plot-width': `${geometry.width}px`, '--task-scroll-top': `${camera.top}px` }"
      tabindex="0"
      :aria-label="`任务时间线，${tasks.length} 项任务`"
      @click.capture="captureClick"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
      @lostpointercapture.self="endPan"
      @wheel="wheelPan"
    >
      <template v-if="totalDays">
        <div class="task-attention-bar__timeline">
          <div
            class="task-attention-bar__dates"
            :style="{ transform: horizontal ? `translateX(${-camera.left}px)` : `translateY(${-camera.top}px)` }"
          >
            <time
              v-for="day in days"
              :key="day.date"
              class="task-attention-bar__date"
              :class="{ 'task-attention-bar__date--today': day.date === today }"
              :datetime="day.date"
              :title="day.date"
              :style="{ '--date-position': `${day.position}px` }"
            >{{ day.date.slice(compactDates || (horizontal && day.date === today) ? 8 : 5) }}</time>
            <div
              class="task-attention-bar__start"
              aria-hidden="true"
            />
          </div>
        </div>
        <div
          ref="plot"
          class="task-attention-bar__plot"
          tabindex="0"
          @scroll.passive="syncScroll"
        >
          <div class="task-attention-bar__content">
            <div class="task-attention-bar__bars">
              <div
                v-for="bar in taskBars"
                :key="bar.task.id"
                class="task-attention-bar__bar"
                :style="{
                  '--task-length': `${bar.length}px`,
                  '--planned-length': `${bar.plannedLength}px`,
                  '--title-position': `${bar.headerOutside ? bar.length + 8 : 8}px`,
                  '--task-color': bar.task.event?.color || undefined
                }"
                :data-task-id="bar.task.id"
                @click.stop="toggleTaskDetail(bar.task.id, $event)"
              >
                <Card
                  class="task-attention-bar__title-card"
                  :width="horizontal ? 'var(--task-label-width)' : 'auto'"
                  :radius="14"
                  :color="bar.task.event?.color || undefined"
                  :tint="Boolean(bar.task.event?.color)"
                  :edge-tint="false"
                  :outer-glow="false"
                  :blur="2"
                  :moving="camera.dragging"
                  passthrough
                  aria-hidden="true"
                  inert
                  @color-change="titleColors.set(bar.task.id, $event?.textColor ?? null)"
                />
                <span
                  v-if="bar.overdue && !bar.closed"
                  class="task-attention-bar__warning"
                  role="img"
                  title="截止逾期"
                  aria-label="截止逾期"
                >
                  <Icon
                    name="lucide:triangle-alert"
                    aria-hidden="true"
                  />
                </span>
                <div
                  v-if="bar.overdue"
                  class="task-attention-bar__overdue-placeholder"
                  :data-bar-growth="bar.task.id"
                >
                  <slot
                    name="overdue"
                    :task="bar.task"
                  />
                </div>
                <div
                  v-else
                  class="task-attention-bar__shape"
                  :data-bar-growth="bar.task.id"
                />
                <div class="task-attention-bar__row-controls">
                  <button
                    type="button"
                    class="task-attention-bar__header"
                    aria-haspopup="dialog"
                    :aria-expanded="detailTaskId === bar.task.id"
                    :aria-controls="detailTaskId === bar.task.id ? detailId : undefined"
                  >
                    <span
                      class="task-attention-bar__title"
                      :style="{ color: titleColors.get(bar.task.id) ?? undefined }"
                    >{{ bar.task.title }}</span>
                  </button>
                  <TaskActions
                    class="task-attention-bar__actions"
                    :task="bar.task"
                    :extended="false"
                    @change="emit('change', $event)"
                  />
                </div>
              </div>
            </div>
            <div
              class="task-attention-bar__start"
              role="separator"
              aria-label="now"
            />
          </div>
        </div>
      </template>
      <p
        v-else
        class="task-attention-bar__empty"
        role="status"
      >
        阶段已结束。
      </p>
      <div class="task-attention-bar__tools">
        <div
          v-if="totalDays"
          class="task-attention-bar__clock"
        >
          <button
            class="task-attention-bar__add"
            type="button"
            aria-label="新建任务"
            title="新建任务"
            @click.stop="creatingTask = true"
          >
            <Icon
              name="lucide:plus"
              aria-hidden="true"
            />
          </button>
          <time
            class="task-attention-bar__now"
            :datetime="currentTime.toISOString()"
          >{{ formattedTime }}</time>
        </div>
        <BackgroundSelect
          class="task-attention-bar__background-control"
          :background-key="`task-attention:${phaseId}`"
          :aspect-ratio="backgroundRatio"
          hide-selection
          @change="backgroundSelection = $event"
          @loading-change="backgroundPending = $event"
        />
      </div>
      <button
        v-if="totalDays && camera.showReturn"
        class="task-attention-bar__return"
        type="button"
        aria-label="返回第一个未完成任务"
        title="返回第一个未完成任务"
        @click.stop="returnToFirst"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 14-5-5 5-5M4 9h10a6 6 0 0 1 6 6v5" />
        </svg>
      </button>
      <AppPopup
        v-if="detailTask"
        :id="detailId"
        :open="true"
        mode="popover"
        :anchor="detailAnchor"
        :aria-label="detailTask.title"
        class="task-attention-bar__popover"
        prefer-side
        tabindex="-1"
        autofocus
        @update:open="!$event && closeTaskDetail()"
        @pointerdown.stop
        @wheel.stop
      >
        <TaskBlock
          :key="detailTask.id"
          :task="detailTask"
          :detail="3"
          :editable="mode === 'edit'"
          @change="emit('change', $event)"
          @edit="editTask"
        />
      </AppPopup>
      <TaskEditPopup
        v-if="selectedTask || creatingTask"
        :open="true"
        :task="selectedTask"
        :phase-id="phaseId"
        :date="today"
        :events="events"
        :events-pending="eventsPending"
        :refresh-events="refreshEvents"
        editing
        @update:open="closeTaskEditor"
        @saved="emit('saved', $event)"
        @deleted="emit('deleted', $event)"
      />
    </section>
  </BackgroundLayout>
</template>

<style scoped>
.task-attention-bar {
  -webkit-tap-highlight-color: transparent;
  --task-bar-width: clamp(64px, 12cqw, 112px);
  --task-fill-direction: to bottom;
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 17fr);
  grid-template-rows: minmax(0, 1fr);
  container-type: inline-size;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
}
.task-attention-bar--dragging, .task-attention-bar--dragging :deep(*) { cursor: grabbing; }
.task-attention-bar__timeline {
  position: relative;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border-color);
  background: color-mix(in srgb, var(--text-secondary) 4%, transparent);
}
.task-attention-bar__dates { position: relative; height: var(--canvas-length); }
.task-attention-bar__date {
  position: absolute;
  top: var(--date-position);
  right: 0;
  left: 0;
  transform: translateY(-50%);
  color: var(--text-secondary);
  font-size: clamp(12px, 3.5cqw, 14px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}
.task-attention-bar__date::after {
  position: absolute;
  top: 50%;
  right: -2px;
  width: 3px;
  border-top: 1px solid var(--text-secondary);
  content: '';
}
.task-attention-bar__date--today { color: var(--text-primary); font-weight: 700; }
.task-attention-bar__plot { position: relative; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.task-attention-bar__content { position: relative; box-sizing: border-box; width: max-content; height: var(--canvas-length); min-width: 100%; min-height: 100%; padding: 0 12px; }
.task-attention-bar__bars { position: relative; top: var(--head-space); display: flex; align-items: flex-start; padding-right: 85cqw; }
.task-attention-bar__bar {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: max-content;
  flex: none;
  width: var(--task-bar-width);
  height: var(--task-length);
  min-width: 0;
  cursor: pointer;
}
.task-attention-bar__title-card {
  position: relative;
  z-index: 0;
  grid-area: 1 / 1;
  margin: var(--title-position) 4px 0;
  pointer-events: none;
}
.task-attention-bar__row-controls { position: relative; z-index: 2; display: grid; grid-area: 1 / 1; grid-template-columns: minmax(0, 1fr); justify-items: center; align-content: start; gap: 4px; margin: var(--title-position) 4px 0; padding-bottom: 4px; }
.task-attention-bar__title-card,
.task-attention-bar__row-controls { top: max(0px, calc(var(--task-scroll-top) + 8px - var(--head-space) - var(--title-position))); }
.task-attention-bar__shape { position: absolute; z-index: 1; inset: 0; border-radius: 0 0 4px 4px; background: linear-gradient(var(--task-fill-direction), #3b82f6 0 var(--planned-length), #ef4444 var(--planned-length) 100%); box-shadow: inset 0 0 0 1px var(--task-color, var(--accent-color)); }
.task-attention-bar__header { position: relative; z-index: 2; box-sizing: border-box; width: 100%; min-width: 0; padding: 4px; border: 0; background: transparent; font: inherit; cursor: pointer; }
.task-attention-bar__title { display: block; max-height: 5.4em; overflow: hidden; color: var(--text-primary); font-size: 12px; line-height: 1.35; text-align: center; overflow-wrap: anywhere; white-space: normal; }
.task-attention-bar__warning { position: absolute; top: calc(-1 * var(--head-space)); right: 0; left: 0; height: var(--head-space); display: flex; align-items: center; justify-content: center; overflow: hidden; color: #ef4444; font-size: 14px; }
.task-attention-bar__overdue-placeholder { position: absolute; z-index: 1; top: -.5px; right: 0; left: 0; height: 1px; background: #ef4444; box-shadow: 0 0 5px #ef4444, 0 0 12px #ef444480; }
.task-attention-bar__shape, .task-attention-bar__overdue-placeholder { transform: scaleY(var(--task-growth, 1)); transform-origin: 50% 0%; }
.task-attention-bar__popover { background: var(--background-secondary); touch-action: auto; user-select: text; cursor: auto; }
.task-attention-bar__start { position: absolute; z-index: 1; top: var(--head-space); right: 0; left: 0; border-top: 1px solid var(--text-primary); pointer-events: none; }
.task-attention-bar__tools { display: contents; }
.task-attention-bar__clock { position: absolute; z-index: 3; top: 0; right: 8px; height: var(--head-space); display: flex; align-items: center; gap: 4px; color: var(--text-secondary); }
.task-attention-bar__background-control { position: absolute; z-index: 5; top: calc(var(--head-space) + 4px); right: 8px; }
.task-attention-bar__background-control :deep(.background-select__trigger) { display: grid; place-items: center; width: 24px; height: 24px; min-height: 0; padding: 0; }
.task-attention-bar__background-control :deep(.background-select__label) { display: none; }
.task-attention-bar__now { font-size: 10px; line-height: 1; pointer-events: none; }
.task-attention-bar__add { display: grid; place-items: center; width: 16px; height: 16px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.task-attention-bar__add > * { width: 14px; height: 14px; }
.task-attention-bar__return { position: absolute; z-index: 5; bottom: 12px; left: 12px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--border-color); border-radius: 50%; background: var(--background-secondary); color: var(--text-primary); box-shadow: 0 2px 8px #0002; cursor: pointer; }
.task-attention-bar__return svg { width: 20px; height: 20px; }
.task-attention-bar__empty { grid-column: 1 / -1; padding: 16px; color: var(--text-secondary); }

.task-attention-bar--horizontal {
  --task-fill-direction: to right;
  --task-label-width: max(0px, calc(var(--plot-width) - var(--head-space) - 8px));
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: 30px minmax(0, 1fr);
}
.task-attention-bar--horizontal .task-attention-bar__timeline { grid-area: 1 / 1; border-right: 0; border-bottom: 1px solid var(--border-color); }
.task-attention-bar--horizontal .task-attention-bar__dates { width: var(--canvas-length); height: 100%; }
.task-attention-bar--horizontal .task-attention-bar__date { top: 8px; right: auto; left: var(--date-position); transform: translateX(-50%); }
.task-attention-bar--horizontal .task-attention-bar__date::after { top: calc(100% + 4px); right: auto; left: 50%; width: 0; height: 4px; border-top: 0; border-left: 1px solid var(--text-secondary); }
.task-attention-bar--horizontal .task-attention-bar__plot, .task-attention-bar--horizontal .task-attention-bar__empty { grid-area: 2 / 1 / auto / -1; }
.task-attention-bar--horizontal .task-attention-bar__content { width: var(--canvas-length); height: max-content; padding: 0; }
.task-attention-bar--horizontal .task-attention-bar__bars { top: 0; flex-direction: column; padding: 0 0 12px; }
.task-attention-bar--horizontal .task-attention-bar__bar { width: 100%; height: auto; }
.task-attention-bar--horizontal .task-attention-bar__title-card { position: sticky; left: calc(var(--head-space) + 4px); margin: 2px 0 2px calc(var(--head-space) + 4px); }
.task-attention-bar--horizontal .task-attention-bar__title-card,
.task-attention-bar--horizontal .task-attention-bar__row-controls { top: auto; }
.task-attention-bar--horizontal .task-attention-bar__shape { right: auto; left: var(--head-space); width: var(--task-length); border-radius: 0 4px 4px 0; }
.task-attention-bar--horizontal .task-attention-bar__shape,
.task-attention-bar--horizontal .task-attention-bar__overdue-placeholder { transform: scaleX(var(--task-growth, 1)); transform-origin: 0% 50%; }
.task-attention-bar--horizontal .task-attention-bar__row-controls {
  position: sticky;
  z-index: 2;
  left: 0;
  box-sizing: border-box;
  display: grid;
  grid-area: 1 / 1;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 6px;
  width: var(--plot-width);
  min-height: 44px;
  margin: 0;
  padding: 4px 4px 4px calc(var(--head-space) + 6px);
  pointer-events: none;
}
.task-attention-bar--horizontal .task-attention-bar__header { position: static; grid-area: auto; min-width: 0; margin: 0; pointer-events: auto; }
.task-attention-bar--horizontal .task-attention-bar__title { display: -webkit-box; -webkit-box-orient: vertical; max-height: 2.5em; font-size: clamp(13px, 7cqw, 17px); line-height: 1.25; text-align: left; writing-mode: horizontal-tb; }
.task-attention-bar__actions { --task-action-size: clamp(14px, 3cqw, 24px); }
.task-attention-bar--horizontal .task-attention-bar__actions { --task-action-size: clamp(20px, 8cqw, 28px); }
.task-attention-bar--horizontal .task-attention-bar__warning { top: 0; right: auto; bottom: 0; left: 0; width: var(--head-space); height: auto; }
.task-attention-bar--horizontal .task-attention-bar__overdue-placeholder { top: 0; right: auto; bottom: 0; left: calc(var(--head-space) - .5px); width: 1px; height: auto; }
.task-attention-bar--horizontal .task-attention-bar__start { top: 0; right: auto; bottom: 0; left: var(--head-space); border-top: 0; border-left: 1px solid var(--text-primary); }
.task-attention-bar--horizontal .task-attention-bar__tools { position: relative; grid-area: 1 / 2; display: flex; align-items: center; gap: 4px; padding-inline: 4px; border-bottom: 1px solid var(--border-color); background: color-mix(in srgb, var(--text-secondary) 4%, transparent); }
.task-attention-bar--horizontal .task-attention-bar__clock { position: static; height: auto; }
.task-attention-bar--horizontal .task-attention-bar__background-control { position: static; }
</style>
