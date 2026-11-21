<script setup lang="ts">
import WeekPicker from './WeekPicker.vue'
import { gsap } from 'gsap'
import { addCalendarDays, calendarDate, calendarDateKey, formatMonthDay, getWeekNumber, weekdays, weekStartDate } from '~/utils/date'

const props = withDefaults(defineProps<{
  /** 打开时定位的日历日期或本地日期时间。 */
  initialDate?: string
  /** 阶段日期范围，用于显示阶段内周次。 */
  phase?: Parameters<typeof getWeekNumber>[1]
  /** 选择新日期时采用的 HH:mm 时间。 */
  defaultTime?: string
  /** 是否禁止切换和选择。 */
  disabled?: boolean
}>(), { defaultTime: '24:00' })

const value = defineModel<string>({ default: '' })
const emit = defineEmits<{ select: [date: string] }>()

const { now, timeZone } = useSystemTime()
const viewedWeek = ref<string>()
const viewport = ref<HTMLElement | null>(null)
const offset = ref(0)
let swipe: { id: number, area: HTMLElement, x: number, y: number, active: boolean } | undefined
let slide: ReturnType<typeof gsap.to> | undefined
let suppressClick = false
const pointerListeners = new AbortController()

const today = computed(() => calendarDate(now.value ?? new Date(), timeZone.value))
const todayWeek = computed(() => weekStartDate(today.value))
const initialDay = computed(() => {
  if (!props.initialDate) return ''
  try {
    return addCalendarDays(calendarDateKey(props.initialDate), 0)
  } catch {
    return ''
  }
})
const initialWeek = computed(() => initialDay.value ? weekStartDate(initialDay.value) : todayWeek.value)
const weekStart = computed(() => viewedWeek.value ?? initialWeek.value)
const selectedDate = computed(() => value.value.split('T')[0] || initialDay.value)
const weekLabel = computed(() => {
  const week = getWeekNumber(weekStart.value,
    props.phase, timeZone.value)
  if (week !== null) return `第 ${week} 周`
  if (props.phase) return '阶段外'
  return weekStart.value === todayWeek.value ? '本周' : `${weekStart.value} 起`
})

const weeks = computed(() => [-1, 0, 1].map((direction) => {
  const start = addCalendarDays(weekStart.value, direction * 7)
  const active = direction === 0
  const days = weekdays.map((weekday, index) => {
    const weekDate = addCalendarDays(start, index)
    const nextWeek = active && !initialDay.value && viewedWeek.value === undefined && weekDate < today.value
    const date = nextWeek ? addCalendarDays(weekDate, 7) : weekDate
    const label = `${date} ${weekday}${nextWeek ? ' · 下周' : date === today.value ? ' · 今天' : ''}`
    return { date, label, nextWeek, shortDate: formatMonthDay(date) }
  })
  const selectedIndex = days.findIndex(day => day.date === selectedDate.value)
  return { start, active, days, labels: days.map(day => day.label), selection: selectedIndex < 0 ? [] : [selectedIndex + 1] }
}))

function stopSlide() {
  slide?.kill()
  slide = undefined
}

function moveWeek(direction: -1 | 0 | 1) {
  if (props.disabled) return
  const start = direction ? addCalendarDays(weekStart.value, direction * 7) : undefined
  const width = viewport.value?.clientWidth ?? 0
  function finish() {
    if (start) viewedWeek.value = start
    offset.value = 0
    slide = undefined
  }
  stopSlide()
  if (!width || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finish()
    return
  }
  const motion = { x: offset.value }
  slide = gsap.to(motion, {
    x: -direction * width,
    duration: 0.22,
    ease: 'power2.out',
    onUpdate: () => { offset.value = motion.x },
    onComplete: finish
  })
}

function startSwipe(event: PointerEvent) {
  if (props.disabled || slide || swipe?.active || !event.isPrimary || event.button !== 0) return
  suppressClick = false
  swipe = { id: event.pointerId, area: event.currentTarget as HTMLElement, x: event.clientX, y: event.clientY, active: false }
}

function moveSwipe(event: PointerEvent) {
  if (!swipe || swipe.id !== event.pointerId || !viewport.value) return
  const dx = event.clientX - swipe.x
  const dy = event.clientY - swipe.y
  if (!swipe.active) {
    if (Math.hypot(dx, dy) < 7) return
    if (Math.abs(dx) <= Math.abs(dy)) {
      swipe = undefined
      return
    }
    swipe.active = true
    swipe.area.setPointerCapture(event.pointerId)
  }
  const width = viewport.value.clientWidth
  offset.value = Math.max(-width, Math.min(width, dx))
}

function endSwipe(event: PointerEvent) {
  if (!swipe || swipe.id !== event.pointerId) return
  const active = swipe.active
  swipe = undefined
  if (!active) return
  suppressClick = true
  const threshold = Math.min(48, (viewport.value?.clientWidth ?? 0) * 0.2)
  const direction = Math.abs(offset.value) < threshold ? 0 : offset.value > 0 ? -1 : 1
  moveWeek(event.type === 'pointerup' ? direction : 0)
}

function blockSwipeClick(event: MouseEvent) {
  if (!suppressClick || event.detail === 0) return
  event.preventDefault()
  event.stopPropagation()
}

function selectDate(date: string | undefined) {
  if (!date) return
  if (date !== selectedDate.value || !value.value.includes('T')) value.value = `${date}T${props.defaultTime}`
  emit('select', date)
}

watch(initialDay, () => {
  swipe = undefined
  stopSlide()
  offset.value = 0
  viewedWeek.value = undefined
})
watch(() => props.disabled, (disabled) => {
  if (!disabled) return
  swipe = undefined
  stopSlide()
  offset.value = 0
})
onMounted(() => {
  const options = { signal: pointerListeners.signal, capture: true }
  window.addEventListener('pointermove', moveSwipe, options)
  window.addEventListener('pointerup', endSwipe, options)
  window.addEventListener('pointercancel', endSwipe, options)
})
onBeforeUnmount(() => {
  pointerListeners.abort()
  stopSlide()
})
</script>

<template>
  <div
    class="date-picker"
    role="group"
    aria-label="日期选择"
    :tabindex="disabled ? -1 : 0"
    @keydown.left.prevent="moveWeek(-1)"
    @keydown.right.prevent="moveWeek(1)"
    @pointerdown="startSwipe"
    @click.capture="blockSwipeClick"
  >
    <div
      class="date-picker__week"
      aria-live="polite"
    >
      {{ weekLabel }}
    </div>

    <div
      ref="viewport"
      class="date-picker__viewport"
    >
      <div
        class="date-picker__track"
        :style="{ transform: `translateX(calc(-100% + ${offset}px))` }"
      >
        <WeekPicker
          v-for="week in weeks"
          :key="week.start"
          class="date-picker__days"
          :count="week.days.length"
          :model-value="week.selection"
          :labels="week.labels"
          :paintable="false"
          :disabled="disabled || !week.active"
          :inert="!week.active"
          :aria-hidden="!week.active"
          selectable
          exclusive
          @update:model-value="selectDate(week.days[($event[0] ?? 0) - 1]?.date)"
        >
          <template #detail="{ week: day }">
            <time
              class="date-picker__date"
              :datetime="week.days[day - 1]!.date"
            >{{ week.days[day - 1]!.shortDate }}</time>
            <span
              v-if="week.days[day - 1]!.nextWeek"
              class="date-picker__next-week"
            >下周</span>
          </template>
        </WeekPicker>
      </div>
    </div>
  </div>
</template>

<style scoped>
.date-picker {
  display: grid;
  gap: 8px;
  min-width: 0;
  touch-action: pan-y;
  user-select: none;
}

.date-picker__week {
  text-align: center;
  color: var(--text-primary);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.date-picker__viewport {
  min-width: 0;
  overflow: clip;
}

.date-picker__track {
  display: flex;
}

.date-picker__days.week-picker {
  --week-ball-size: 2.5rem;
  display: grid;
  flex: 0 0 100%;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: clamp(2px, 1vw, 8px);
  box-sizing: border-box;
  padding: 2px 4px;
}

.date-picker__date {
  color: var(--text-primary);
  font-size: clamp(0.625rem, 2.5vw, 0.75rem);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.date-picker__next-week {
  color: var(--text-secondary);
  font-size: 0.625rem;
  white-space: nowrap;
}
</style>
