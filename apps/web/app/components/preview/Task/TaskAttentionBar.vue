<script setup lang="ts">
import TaskBlock, { type ChangeTask } from './TaskBlock.vue'
import { gsap } from 'gsap'

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
  /** 写入任务状态或延期变更。 */
  changeTask: ChangeTask
  /** 所属阶段 ID。 */
  phaseId: ApiData<Api['api']['phase']['get']>[number]['id']
  /** 时间轴的阶段结束日期。 */
  endDate: ApiData<Api['api']['phase']['get']>[number]['endDate']
  /** 每小时高度，未传时自动计算。 */
  hourPixels?: number
  /** 每根任务柱的宽度，未传时自动计算。 */
  barWidth?: number
  /** 开始线上方的留白高度。 */
  headSpace?: number
  /** 允许标题显示在柱内的最小高度。 */
  headerMinHeight?: number
}>(), { headSpace: 16, headerMinHeight: 112 })

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

const geometry = reactive({ height: 0, width: 0 })

const camera = reactive({ left: 0, top: 0, dragging: false, showReturn: false, positioned: false })

const focusedTaskId = ref<number | null>(null)

const selectedTaskId = ref<number | null>(null)

const creatingTask = ref(false)

const focusScales = reactive<Record<number, number>>({})

const grownTasks = new Set<number>()

const growthTweens = new Set<ReturnType<typeof gsap.fromTo>>()

let focusTween: ReturnType<typeof gsap.to> | undefined

let scrollTween: ReturnType<typeof gsap.to> | undefined

let scrollBeforeFocus = 0

let disposed = false

let userMoved = false

let suppressClickUntil = 0

let pan: { id: number, x: number, y: number, left: number, top: number, moved: boolean } | undefined

let observer: ResizeObserver | undefined

const headSpace = computed(() => Number.isFinite(props.headSpace) && props.headSpace >= 0 ? props.headSpace : 16)

const headerLimit = computed(() => Number.isFinite(props.headerMinHeight) && props.headerMinHeight >= 0 ? props.headerMinHeight : 112)

const scaleFit = computed(() => {
  const fallback = props.hourPixels !== undefined && Number.isFinite(props.hourPixels) && props.hourPixels > 0 ? props.hourPixels : 4
  if (props.hourPixels !== undefined && Number.isFinite(props.hourPixels) && props.hourPixels > 0) {
    return { scale: fallback, start: Math.ceil(currentHour.value * fallback) }
  }
  const remaining = taskTimes.value.filter(task => task.due > currentHour.value).sort((a, b) => a.due - b.due)
  const target = Math.max(1, geometry.height / 2 - headSpace.value)
  if (!geometry.height || !remaining.length) return { scale: fallback, start: Math.ceil(currentHour.value * fallback) }
  const middle = Math.floor(remaining.length / 2)
  const median = remaining.length % 2 ? remaining[middle]!.due : (remaining[middle - 1]!.due + remaining[middle]!.due) / 2
  const start = Math.ceil(currentHour.value * target / (median - currentHour.value))
  return { scale: (target + start) / median, start }
})

const hourScale = computed(() => scaleFit.value.scale)

const dayHeight = computed(() => 24 * hourScale.value)

const startPixel = computed(() => scaleFit.value.start)

const totalDays = computed(() => Math.max(0, calendarDayNumber(endDay.value) - calendarDayNumber(today.value) + 1))

const days = computed(() => Array.from({ length: renderedDays.value }, (_, index) => ({
  date: addCalendarDays(today.value, index),
  top: index === 0 ? headSpace.value / 2 : headSpace.value + index * dayHeight.value - startPixel.value
})))

const canvasHeight = computed(() => headSpace.value + Math.max(0, renderedDays.value * dayHeight.value - startPixel.value) + inset)

const barLayout = computed(() => {
  const count = Math.max(1, taskTimes.value.filter(task => task.due > currentHour.value).length || taskTimes.value.length)
  const available = Math.max(0, geometry.width - 24)
  const width = props.barWidth !== undefined && Number.isFinite(props.barWidth) && props.barWidth > 0 ? props.barWidth : available / count
  return { width }
})

const taskBars = computed(() => taskTimes.value.map(({ task, due, planned }) => {
  const distance = due * hourScale.value - startPixel.value
  const height = Math.max(0, distance)
  const blueHeight = planned === null ? 0 : Math.min(height, Math.max(0, planned * hourScale.value - startPixel.value))
  return { task, due, height, blueHeight, overdue: distance < 0, headerOutside: height < headerLimit.value }
}).sort((a, b) => a.due - b.due))

const firstIncomplete = computed(() => taskBars.value.find(({ task }) => !task.completed && task.status !== 'DONE' && task.status !== 'CANCELLED'))

const contentWidth = computed(() => {
  let width = 24
  let anchor = 0
  for (const bar of taskBars.value) {
    if (bar.task.id === firstIncomplete.value?.task.id) anchor = width - 24
    width += barLayout.value.width * (focusScales[bar.task.id] ?? 1)
  }
  return Math.max(geometry.width, width + 64, firstIncomplete.value ? anchor + geometry.width + 12 : 0)
})

const selectedTask = computed(() => props.tasks.find(task => task.id === selectedTaskId.value) ?? null)

const compactDates = computed(() => geometry.width > 0 && geometry.width * 3 / 17 < 40)

function measure() {
  geometry.height = viewport.value?.clientHeight ?? 0
  geometry.width = plot.value?.clientWidth ?? 0
  fillRange()
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
  return {
    scrollLeft: Math.max(0, plot.value.scrollLeft + element.getBoundingClientRect().left - area.left),
    scrollTop: plot.value.scrollTop + bounds.bottom - area.top <= plot.value.clientHeight
      ? 0
      : Math.max(0, plot.value.scrollTop + bounds.top - area.top - headSpace.value)
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

function keepFocusVisible() {
  const id = focusedTaskId.value
  if (id === null || !plot.value || userMoved || camera.dragging) return
  const element = plot.value?.querySelector<HTMLElement>(`.task-attention-bar__bar[data-task-id="${id}"]`)
  if (!element) return
  const area = plot.value.getBoundingClientRect()
  const bounds = element.getBoundingClientRect()
  if (bounds.width + 24 > plot.value.clientWidth || bounds.left < area.left + 12) {
    plot.value.scrollLeft += bounds.left - area.left - 12
  } else if (bounds.right > area.right - 12) {
    plot.value.scrollLeft += bounds.right - area.right + 12
  }
}

async function growBars() {
  await nextTick()
  if (disposed || !plot.value) return
  positionInitially()
  const elements = [...plot.value.querySelectorAll<HTMLElement>('[data-bar-growth]')].filter((element) => {
    const id = Number(element.dataset.barGrowth)
    if (grownTasks.has(id)) return false
    grownTasks.add(id)
    return true
  })
  if (!elements.length) return
  const tween = gsap.fromTo(elements, { scaleY: 0, transformOrigin: '50% 0%' }, {
    scaleY: 1, duration: 0.65, stagger: 0.08, ease: 'power2.out',
    onComplete: () => growthTweens.delete(tween)
  })
  growthTweens.add(tween)
}

function fillRange() {
  const element = plot.value
  if (!element) return
  const lastVisibleDay = Math.floor(Math.max(0, element.scrollTop + element.clientHeight - headSpace.value + startPixel.value) / dayHeight.value)
  renderedDays.value = Math.min(totalDays.value, Math.max(renderedDays.value, lastVisibleDay + 1 + bufferDays))
}

function resetRange() {
  renderedDays.value = 0
  camera.positioned = false
  if (plot.value) plot.value.scrollTop = 0
  fillRange()
  void nextTick(() => {
    positionInitially()
    syncScroll()
  })
}

watch([today, endDay, headSpace, () => props.phaseId, timeZone], resetRange, { flush: 'post' })

watch([hourScale, startPixel], ([scale, start], [previousScale, previousStart]) => {
  if (plot.value && plot.value.scrollTop > 0) {
    const hour = (plot.value.scrollTop - headSpace.value + previousStart) / previousScale
    plot.value.scrollTop = Math.max(0, headSpace.value + hour * scale - start)
  }
  syncScroll()
}, { flush: 'post' })

watch(taskBars, (bars) => {
  if (focusedTaskId.value !== null && !bars.some(bar => bar.task.id === focusedTaskId.value)) leaveFocus()
  void nextTick(() => {
    positionInitially()
    checkFirstVisible()
  })
})

watch(focusedTaskId, (id) => {
  focusTween?.kill()
  scrollTween?.kill()
  if (id !== null) focusScales[id] ??= 1
  const targets = Object.fromEntries(taskBars.value.filter(bar => focusScales[bar.task.id] !== undefined).map(bar => [bar.task.id, bar.task.id === id ? 3 : 1]))
  focusTween = gsap.to(focusScales, {
    ...targets, duration: 0.36, ease: 'power2.inOut',
    onUpdate: () => {
      void nextTick(() => {
        keepFocusVisible()
        syncScroll()
      })
    }
  })
  if (id === null && plot.value && !userMoved) {
    scrollTween = gsap.to(plot.value, { scrollLeft: scrollBeforeFocus, duration: 0.36, ease: 'power2.inOut', onUpdate: syncScroll })
  }
  if (id !== null) userMoved = false
})

watch([() => firstIncomplete.value?.task.id, () => geometry.width, () => geometry.height], () => {
  void nextTick(() => {
    positionInitially()
    checkFirstVisible()
  })
}, { flush: 'post' })

watch(() => taskBars.value.map(bar => bar.task.id).join(','), () => {
  const ids = new Set(taskBars.value.map(bar => bar.task.id))
  for (const id of grownTasks) if (!ids.has(id)) grownTasks.delete(id)
  for (const key of Object.keys(focusScales)) if (Number.isInteger(Number(key)) && !ids.has(Number(key))) Reflect.deleteProperty(focusScales, key)
  void growBars()
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
  disposed = true
  observer?.disconnect()
  focusTween?.kill()
  scrollTween?.kill()
  for (const tween of growthTweens) tween.kill()
})

function closeTaskEditor(open: boolean) {
  if (open) return
  selectedTaskId.value = null
  creatingTask.value = false
}

function returnToFirst() {
  const target = firstTaskTarget()
  if (!target || !plot.value) return
  userMoved = true
  scrollTween?.kill()
  scrollTween = gsap.to(plot.value, { ...target, duration: 0.5, ease: 'power2.inOut', onUpdate: syncScroll, onComplete: syncScroll })
}

function startPan(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || !plot.value) return
  if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return
  const area = plot.value.getBoundingClientRect()
  if (event.target === plot.value && (event.clientX >= area.left + plot.value.clientWidth || event.clientY >= area.top + plot.value.clientHeight)) return
  scrollTween?.kill()
  pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: plot.value.scrollLeft, top: plot.value.scrollTop, moved: false }
}

function movePan(event: PointerEvent) {
  if (!pan || pan.id !== event.pointerId || !plot.value) return
  const dx = event.clientX - pan.x
  const dy = event.clientY - pan.y
  if (!pan.moved && Math.hypot(dx, dy) < 5) return
  if (!pan.moved) {
    pan.moved = true
    userMoved = true
    camera.dragging = true
    viewport.value?.setPointerCapture(event.pointerId)
  }
  plot.value.scrollLeft = pan.left - dx
  plot.value.scrollTop = pan.top - dy
  event.preventDefault()
  syncScroll()
}

function endPan(event: PointerEvent) {
  if (!pan || pan.id !== event.pointerId) return
  if (pan.moved) suppressClickUntil = performance.now() + 250
  pan = undefined
  camera.dragging = false
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
}

function captureClick(event: MouseEvent) {
  if (performance.now() >= suppressClickUntil) return
  suppressClickUntil = 0
  event.preventDefault()
  event.stopPropagation()
}

function wheelPan(event: WheelEvent) {
  if (!plot.value || event.ctrlKey) return
  if (event.target instanceof Element && event.target.closest('input, select, textarea')) return
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plot.value.clientHeight : 1
  const left = plot.value.scrollLeft
  const top = plot.value.scrollTop
  userMoved = true
  scrollTween?.kill()
  plot.value.scrollLeft += (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit
  plot.value.scrollTop += (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit
  if (plot.value.scrollLeft !== left || plot.value.scrollTop !== top) event.preventDefault()
  syncScroll()
}

function leaveFocus(event?: Event) {
  if (event?.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return
  focusedTaskId.value = null
}

function focusTask(id: number, event: Event) {
  if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return
  if (focusedTaskId.value !== null) {
    leaveFocus()
    return
  }
  scrollBeforeFocus = plot.value?.scrollLeft ?? 0
  focusedTaskId.value = id
}

function replayGrowth() {
  for (const tween of growthTweens) tween.kill()
  growthTweens.clear()
  grownTasks.clear()
  void growBars()
}

defineExpose({ hourPixels: hourScale, barWidth: computed(() => barLayout.value.width), replayGrowth })
</script>

<template>
  <section
    v-bind="$attrs"
    ref="viewport"
    class="task-attention-bar"
    :class="{ 'task-attention-bar--dragging': camera.dragging }"
    tabindex="0"
    :aria-label="`任务时间线，${tasks.length} 项任务`"
    @click="leaveFocus"
    @click.capture="captureClick"
    @pointerdown="startPan"
    @pointermove="movePan"
    @pointerup="endPan"
    @pointercancel="endPan"
    @lostpointercapture="endPan"
    @wheel="wheelPan"
  >
    <template v-if="totalDays">
      <div class="task-attention-bar__timeline">
        <div
          class="task-attention-bar__dates"
          :style="{ height: `${canvasHeight}px`, transform: `translateY(${-camera.top}px)` }"
        >
          <time
            v-for="day in days"
            :key="day.date"
            class="task-attention-bar__date"
            :class="{ 'task-attention-bar__date--today': day.date === today }"
            :datetime="day.date"
            :title="day.date"
            :style="{ top: `${day.top}px` }"
          >{{ day.date.slice(compactDates ? 8 : 5) }}</time>
          <div
            class="task-attention-bar__start"
            :style="{ top: `${headSpace}px` }"
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
        <div
          class="task-attention-bar__content"
          :style="{ width: `${contentWidth}px`, height: `${canvasHeight}px` }"
        >
          <div
            class="task-attention-bar__bars"
            :style="{ top: `${headSpace}px` }"
          >
            <div
              v-for="bar in taskBars"
              :key="bar.task.id"
              class="task-attention-bar__bar"
              :class="{ 'task-attention-bar__bar--overdue': bar.overdue, 'task-attention-bar__bar--focused': focusedTaskId === bar.task.id }"
              :style="{ 'height': `${bar.height}px`, 'width': `${barLayout.width * (focusScales[bar.task.id] ?? 1)}px`, '--blue-height': `${bar.blueHeight}px`, '--task-color': bar.task.event?.color ?? 'var(--accent-color)' }"
              :aria-label="bar.task.title"
              :data-focused="focusedTaskId === bar.task.id"
              :data-task-id="bar.task.id"
              role="group"
              tabindex="0"
              @click.stop="focusTask(bar.task.id, $event)"
              @keydown.enter.prevent.stop="focusTask(bar.task.id, $event)"
              @keydown.space.prevent.stop="focusTask(bar.task.id, $event)"
            >
              <span
                v-if="bar.overdue && !bar.task.completed && bar.task.status !== 'DONE' && bar.task.status !== 'CANCELLED'"
                class="task-attention-bar__warning"
                :style="{ top: `${-headSpace}px`, height: `${headSpace}px` }"
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
              <div
                class="task-attention-bar__header"
                :class="{ 'task-attention-bar__header--external': bar.headerOutside }"
                :style="{ top: `${bar.headerOutside ? bar.height + 8 : 8}px` }"
              >
                <TaskBlock
                  class="task-attention-bar__controls"
                  :task="bar.task"
                  :change-task="changeTask"
                  :detail="focusedTaskId === bar.task.id ? 3 : 1"
                  variant="row"
                  :editable="mode === 'edit'"
                  @change="emit('change', $event)"
                  @edit="selectedTaskId = bar.task.id"
                >
                  <span class="task-attention-bar__title">{{ bar.task.title }}</span>
                </TaskBlock>
              </div>
            </div>
          </div>
          <div
            class="task-attention-bar__start"
            :style="{ top: `${headSpace}px` }"
            role="separator"
            aria-label="now"
          />
          <div
            class="task-attention-bar__clock"
            :style="{ height: `${headSpace}px` }"
          >
            <button
              class="task-attention-bar__add"
              type="button"
              aria-label="新建任务"
              title="新建任务"
              @click.stop="creatingTask = true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <time
              class="task-attention-bar__now"
              :datetime="currentTime.toISOString()"
            >{{ formattedTime }}</time>
          </div>
        </div>
      </div>
      <button
        v-if="camera.showReturn"
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
    </template>
    <p
      v-else
      class="task-attention-bar__empty"
      role="status"
    >
      阶段已结束。
    </p>
    <TaskEditPopup
      v-if="selectedTask || creatingTask"
      :open="true"
      :task="selectedTask"
      :phase-id="phaseId"
      :date="today"
      :events="events"
      :events-pending="eventsPending"
      :refresh-events="refreshEvents"
      :change-task="changeTask"
      editing
      @update:open="closeTaskEditor"
      @saved="emit('saved', $event)"
      @deleted="emit('deleted', $event)"
    />
  </section>
</template>

<style scoped>
.task-attention-bar {
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
.task-attention-bar__dates { position: relative; }
.task-attention-bar__date {
  position: absolute;
  right: 0;
  left: 0;
  transform: translateY(-50%);
  color: var(--text-secondary);
  font-size: clamp(10px, 3cqw, 12px);
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
.task-attention-bar__date--today { color: var(--text-primary); font-weight: 600; }
.task-attention-bar__plot { position: relative; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
.task-attention-bar__content { position: relative; min-height: 100%; }
.task-attention-bar__bars { position: absolute; right: 12px; left: 12px; display: flex; align-items: flex-start; }
.task-attention-bar__bar { position: relative; z-index: 2; flex: none; min-width: 0; cursor: pointer; }
.task-attention-bar__shape { position: absolute; inset: 0; border-radius: 0 0 4px 4px; background: linear-gradient(to bottom, #3b82f6 0 var(--blue-height), #ef4444 var(--blue-height) 100%); box-shadow: inset 0 0 0 1px var(--task-color); transform-origin: 50% 0%; }
.task-attention-bar__bar--focused { z-index: 3; outline: 2px solid var(--text-primary); outline-offset: 2px; }
.task-attention-bar__header { position: absolute; right: 4px; left: 4px; }
.task-attention-bar__title { display: block; max-height: 5.4em; overflow: hidden; color: var(--text-primary); font-size: 12px; line-height: 1.35; text-align: center; overflow-wrap: anywhere; white-space: normal; }
.task-attention-bar__warning { position: absolute; right: 0; left: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #ef4444; font-size: 14px; }
.task-attention-bar__overdue-placeholder { position: absolute; top: -.5px; right: 0; left: 0; height: 1px; background: #ef4444; box-shadow: 0 0 5px #ef4444, 0 0 12px #ef444480; }
.task-attention-bar__bar :deep(.task-block.task-attention-bar__controls) { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: auto; min-height: 0; overflow: visible; border-radius: 0; container-type: inline-size; }
.task-attention-bar__controls :deep(.task-block__material) { display: none; }
.task-attention-bar__controls :deep(.task-block-content) { display: block; flex: none; width: 100%; min-width: 0; height: auto; padding: 0; text-shadow: none; }
.task-attention-bar__controls :deep(.task-block-actions) { position: static; flex: none; justify-content: center; flex-wrap: wrap; max-width: 100%; overflow: visible; transform: none; }
.task-attention-bar__controls :deep(.task-block-action) { width: 24px; height: 24px; font-size: 14px; }
.task-attention-bar__start { position: absolute; z-index: 1; right: 0; left: 0; border-top: 1px solid var(--text-primary); pointer-events: none; }
.task-attention-bar__clock { position: absolute; top: 0; right: 8px; display: flex; align-items: center; gap: 4px; color: var(--text-secondary); }
.task-attention-bar__now { font-size: 10px; line-height: 1; pointer-events: none; }
.task-attention-bar__add { display: grid; place-items: center; width: 16px; height: 16px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
.task-attention-bar__add svg { width: 12px; height: 12px; }
.task-attention-bar__return { position: absolute; z-index: 5; bottom: 12px; left: 12px; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--border-color); border-radius: 50%; background: var(--background-secondary); color: var(--text-primary); box-shadow: 0 2px 8px #0002; cursor: pointer; }
.task-attention-bar__return svg { width: 20px; height: 20px; }
.task-attention-bar__empty { grid-column: 1 / -1; padding: 16px; color: var(--text-secondary); }
</style>
