import { computed, onScopeDispose, reactive, readonly, ref, shallowRef, type Ref } from 'vue'
import { gsap } from 'gsap'

type Input<T> = Readonly<Ref<T>>
type FocusColumn = { key: string, date: string }

interface ScheduleFocusOptions {
  visibleColumns: Input<readonly FocusColumn[]>
  viewport: Input<HTMLElement | null>
  active: Input<boolean>
  moving: Input<boolean>
  hourPixels: Input<number>
  edgePixels: Input<number>
  scheduleStartMinutes: Input<number>
  boardHeight: Input<number>
  maxFocusScale: Input<number>
  preferredColumnScale: Input<number>
}

export function useScheduleFocus({
  visibleColumns,
  viewport,
  active,
  moving,
  hourPixels,
  edgePixels,
  scheduleStartMinutes,
  boardHeight,
  maxFocusScale,
  preferredColumnScale
}: ScheduleFocusOptions) {
  const focusColumnScale = computed(() => visibleColumns.value.length <= 2
    ? 1
    : Math.min(preferredColumnScale.value, visibleColumns.value.length))

  const focus = reactive({
    progress: 0,
    offsetY: 0
  })

  const columnWidths = ref(
    visibleColumns.value.map(() => ({ weight: 1 }))
  )

  const selectedSchedule = shallowRef<{ date: string, id: number } | null>(null)

  const focusMoving = ref(false)
  const focusedMarkers = ref(false)

  let removeFocusClickListener: (() => void) | undefined
  let focusTween: ReturnType<typeof gsap.to> | undefined
  let columnTween: ReturnType<typeof gsap.to> | undefined

  function syncFocusClickListener() {
    removeFocusClickListener?.()
    removeFocusClickListener = undefined
    if (!active.value || moving.value || selectedSchedule.value === null) return
    document.addEventListener('click', FocusClickListener, true)
    removeFocusClickListener = () => document.removeEventListener('click', FocusClickListener, true)
  }

  const gridColumns = computed(() => (
    columnWidths.value.map(column => `minmax(0, ${column.weight}fr)`).join(' ')
  ))

  const displayHourPixels = computed(() => {
    return hourPixels.value
      * (1 + maxFocusScale.value * focus.progress)
  })

  const columnLayout = computed(() => ({
    startMinute: scheduleStartMinutes.value,
    pixelsPerMinute: displayHourPixels.value / 60,
    edgePixels: edgePixels.value,
    offsetY: focus.offsetY
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
        if (columnKey === null) return 1
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
    selectedSchedule.value = null
    focusMoving.value = false
    focusedMarkers.value = false
    focus.progress = 0
    focus.offsetY = 0
    columnWidths.value = visibleColumns.value.map(() => ({ weight: 1 }))
  }

  function minutesToY(minutes: number) {
    return (minutes - scheduleStartMinutes.value)
      * (displayHourPixels.value / 60)
      + edgePixels.value
      + focus.offsetY
  }

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

  function openFocus(column: FocusColumn, scheduleId: number, { start, end }: { start: number, end: number }) {
    focusTween?.kill()

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

    selectedSchedule.value = { date: column.date, id: scheduleId }
    syncFocusClickListener()
    focusMoving.value = true
    animateColumns(column.key)

    focusTween = gsap.to(focus, {
      progress: 1,
      offsetY: targetOffsetY,
      duration: 0.45,
      ease: 'power3.out',
      onComplete() {
        focusMoving.value = false
        focusedMarkers.value = true
      }
    })
  }

  function closeFocus() {
    if (selectedSchedule.value === null)
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
        focusedMarkers.value = false
        selectedSchedule.value = null
      }
    })
  }

  onScopeDispose(() => {
    removeFocusClickListener?.()
    focusTween?.kill()
    columnTween?.kill()
  })

  return {
    selectedSchedule: readonly(selectedSchedule),
    focusMoving: readonly(focusMoving),
    focusedMarkers: readonly(focusedMarkers),
    progress: computed(() => focus.progress),
    offsetY: computed(() => focus.offsetY),
    gridColumns,
    displayHourPixels,
    columnLayout,
    minutesToY,
    openFocus,
    resetFocus,
    syncFocusClickListener
  }
}
