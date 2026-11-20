import { onDeactivated, onScopeDispose, type Ref } from 'vue'
import { gsap } from 'gsap'

export function useTaskBarScroll(plot: Readonly<Ref<HTMLElement | null>>, syncScroll: () => void) {
  let scrollTween: ReturnType<typeof gsap.to> | undefined

  function stopTaskScroll() {
    scrollTween?.kill()
    scrollTween = undefined
  }

  function scrollToTask(target: { scrollLeft: number, scrollTop: number }) {
    if (!plot.value) return
    stopTaskScroll()
    scrollTween = gsap.to(plot.value, {
      ...target,
      duration: 0.5,
      ease: 'power2.inOut',
      onUpdate: syncScroll,
      onComplete() {
        syncScroll()
        scrollTween = undefined
      }
    })
  }

  function coastTaskScroll(velocity: { x: number, y: number }) {
    const element = plot.value
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    stopTaskScroll()
    const duration = 0.6
    const distance = (speed: number) => Math.max(-3, Math.min(3, speed)) * duration * 1000 / 4
    const scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + distance(velocity.x)))
    const scrollTop = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + distance(velocity.y)))
    if (Math.hypot(scrollLeft - element.scrollLeft, scrollTop - element.scrollTop) < 2) return
    scrollTween = gsap.to(element, {
      scrollLeft,
      scrollTop,
      duration,
      ease: 'power3.out',
      onUpdate: syncScroll,
      onComplete() {
        syncScroll()
        scrollTween = undefined
      }
    })
  }

  onDeactivated(stopTaskScroll)
  onScopeDispose(stopTaskScroll)
  return { scrollToTask, stopTaskScroll, coastTaskScroll }
}
