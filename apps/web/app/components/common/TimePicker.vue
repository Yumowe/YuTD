<script setup lang="ts">
import { gsap } from 'gsap'
import { minutesToTime, timeToMinutes } from '~/utils/date'

const props = defineProps<{
  /** 外部拖动区域，未传时使用显示刻度和时间的行。 */
  dragArea?: HTMLElement | null
  /** 保存期间禁用刻度尺。 */
  disabled?: boolean
}>()

const time = defineModel<string>({ default: '24:00' })
const endOfDay = 24 * 60
const tickMinutes = 5
const tickHeight = 7
const tickCount = endOfDay / tickMinutes + 1

const row = ref<HTMLElement | null>(null)
const preview = ref<number>()
const dragging = ref(false)
let drag: { id: number, area: HTMLElement, x: number, y: number, start: number, last: number, updatedAt: number, speed: number } | undefined
let slide: ReturnType<typeof gsap.to> | undefined
let suppressClick = false

const position = computed(() => preview.value ?? timeToMinutes(time.value))
const displayTime = computed(() => minutesToTime(Math.round(position.value)))

function limit(value: number) {
  return Math.max(0, Math.min(endOfDay, value))
}

function setPosition(value: number) {
  preview.value = limit(value)
  time.value = minutesToTime(Math.round(preview.value))
}

function stopSlide() {
  slide?.kill()
  slide = undefined
  preview.value = undefined
}

function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || dragging.value) return
  stopSlide()
  suppressClick = false
  drag = {
    id: event.pointerId, area: event.currentTarget as HTMLElement, x: event.clientX, y: event.clientY,
    start: position.value, last: position.value, updatedAt: event.timeStamp, speed: 0
  }
}

function moveDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const dx = event.clientX - drag.x
  const dy = drag.y - event.clientY
  if (!dragging.value) {
    if (Math.hypot(dx, dy) < 7) return
    if (Math.abs(dy) <= Math.abs(dx)) {
      drag = undefined
      return
    }
    dragging.value = true
    drag.area.setPointerCapture(event.pointerId)
    row.value?.focus({ preventScroll: true })
  }
  const next = limit(drag.start + dy * tickMinutes / tickHeight)
  const elapsed = Math.max(8, event.timeStamp - drag.updatedAt)
  const weight = 1 - Math.exp(-elapsed / 30)
  drag.speed += ((next - drag.last) / elapsed - drag.speed) * weight
  drag.updatedAt = event.timeStamp
  drag.last = next
  setPosition(next)
}

function endDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  const finished = dragging.value
  const { speed, updatedAt } = drag
  drag = undefined
  dragging.value = false
  suppressClick = finished
  if (!finished || event.type !== 'pointerup' || event.timeStamp - updatedAt > 100
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    preview.value = undefined
    return
  }
  const motion = { minute: position.value }
  const distance = Math.max(-100, Math.min(100, speed * 115))
  const projected = limit(motion.minute + distance)
  if (Math.abs(distance) < tickMinutes || Math.abs(projected - motion.minute) < 1) {
    preview.value = undefined
    return
  }
  slide = gsap.to(motion, {
    minute: Math.round(projected / tickMinutes) * tickMinutes,
    duration: 0.34,
    ease: 'power3.out',
    onUpdate: () => setPosition(motion.minute),
    onComplete: stopSlide
  })
}

function blockDragClick(event: MouseEvent) {
  if (!suppressClick || event.detail === 0) return
  event.preventDefault()
  event.stopPropagation()
}

function moveByKey(event: KeyboardEvent) {
  if (props.disabled) return
  const minute = Math.round(position.value)
  let next: number
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      next = minute + 1
      break
    case 'ArrowDown':
    case 'ArrowLeft':
      next = minute - 1
      break
    case 'PageUp':
      next = minute + 60
      break
    case 'PageDown':
      next = minute - 60
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = endOfDay
      break
    default: return
  }
  event.preventDefault()
  stopSlide()
  time.value = minutesToTime(limit(next))
}

watch([() => props.dragArea ?? row.value, () => props.disabled], ([area, disabled], _, onCleanup) => {
  if (!area || disabled) return
  const controller = new AbortController()
  const options = { signal: controller.signal }
  area.addEventListener('pointerdown', startDrag, options)
  const capture = { ...options, capture: true }
  area.addEventListener('click', blockDragClick, capture)
  window.addEventListener('pointermove', moveDrag, capture)
  window.addEventListener('pointerup', endDrag, capture)
  window.addEventListener('pointercancel', endDrag, capture)
  onCleanup(() => {
    controller.abort()
    if (drag && area.hasPointerCapture(drag.id)) area.releasePointerCapture(drag.id)
    drag = undefined
    dragging.value = false
    stopSlide()
  })
}, { flush: 'post' })
</script>

<template>
  <div
    ref="row"
    class="time-picker"
    role="slider"
    aria-label="时间刻度尺"
    aria-orientation="vertical"
    :aria-valuemin="0"
    :aria-valuemax="endOfDay"
    :aria-valuenow="Math.round(position)"
    :aria-valuetext="displayTime"
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    :data-dragging="dragging"
    @keydown="moveByKey"
  >
    <div
      class="time-picker__scale"
      :style="{ '--tick-height': `${tickHeight}px`, '--scale-offset': `${-position / tickMinutes * tickHeight}px` }"
      aria-hidden="true"
    >
      <div
        v-for="(_, tick) in tickCount"
        :key="tick"
        class="time-picker__tick"
        :class="{ 'time-picker__tick--hour': tick * tickMinutes % 60 === 0 }"
      />
    </div>
    <span
      class="time-picker__marker"
      aria-hidden="true"
    />
    <span class="time-picker__value">{{ displayTime }}</span>
  </div>
</template>

<style scoped>
.time-picker {
  --time-blue: #0ea5e9;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  cursor: ns-resize;
  touch-action: none;
  user-select: none;
}

.time-picker[data-dragging='true'] {
  cursor: grabbing;
}

.time-picker[aria-disabled='true'] {
  cursor: not-allowed;
}

.time-picker__scale {
  position: absolute;
  top: 50%;
  inset-inline-start: 0;
  width: 24px;
  color: var(--text-secondary);
  transform: translateY(var(--scale-offset));
  pointer-events: none;
}

.time-picker__tick {
  position: relative;
  height: var(--tick-height);
}

.time-picker__tick::before {
  position: absolute;
  inset-inline-start: 0;
  width: 10px;
  border-top: 1px solid currentColor;
  content: '';
}

.time-picker__tick--hour::before {
  width: 24px;
  border-width: 2px;
}

.time-picker__marker {
  position: absolute;
  top: 50%;
  inset-inline-start: 24px;
  border-block: 5px solid transparent;
  border-inline-start: 8px solid var(--time-blue);
  transform: translateY(-50%);
  pointer-events: none;
}

.time-picker__value {
  color: var(--text-primary);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}
</style>
