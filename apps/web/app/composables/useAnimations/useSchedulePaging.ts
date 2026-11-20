import { computed, onDeactivated, onScopeDispose, ref, type Ref } from 'vue'
import { gsap } from 'gsap'

export function useSchedulePaging(groupIndices: Readonly<Ref<readonly number[]>>) {
  const group = ref(1)
  const groupPosition = computed(() => groupIndices.value.indexOf(group.value))
  const canMovePrevious = computed(() => groupPosition.value > 0)
  const canMoveNext = computed(() => groupPosition.value >= 0 && groupPosition.value < groupIndices.value.length - 1)
  const pagesElement = ref<HTMLElement | null>(null)
  const trackElement = ref<HTMLElement | null>(null)

  const slide = { value: 0 }
  const dragging = ref(false)
  const settling = ref(false)
  let slideTween: ReturnType<typeof gsap.to> | undefined
  let settleDirection: -1 | 0 | 1 = 0
  let swipe: { id: number, x: number, y: number, width: number, offset: number, horizontal: boolean } | null = null
  let suppressClickUntil = 0

  function renderSlide() {
    if (trackElement.value) {
      trackElement.value.style.transform = `translate3d(${(slide.value - 1) * 100}%, 0, 0)`
    }
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

  function resetSwipeClick() {
    suppressClickUntil = 0
  }

  // 捕获 viewport 内的触摸，不让按钮或任务自己的事件拦掉横滑。
  function startSwipe(event: TouchEvent) {
    resetSwipeClick()
    if (event.touches.length !== 1) {
      cancelSwipe()
      return
    }
    if (event.target instanceof Element && event.target.closest('.app-popup')) return
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
    settlePeriod(allowed && Math.abs(dx) >= Math.min(60, current.width * 0.14)
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

  onDeactivated(resetPeriodMotion)
  onScopeDispose(resetPeriodMotion)

  return {
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
  }
}
