import { nextTick, onScopeDispose, type Ref } from 'vue'
import { gsap } from 'gsap'

export function useTaskBarGrowth(plot: Readonly<Ref<HTMLElement | null>>, positionInitially: () => void) {
  const grownTasks = new Set<number>()
  const growthTweens = new Set<ReturnType<typeof gsap.fromTo>>()
  let disposed = false

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
    const tween = gsap.fromTo(elements, { '--task-growth': 0 }, {
      '--task-growth': 1, 'duration': 0.65, 'stagger': 0.08, 'ease': 'power2.out',
      'onComplete': () => growthTweens.delete(tween)
    })
    growthTweens.add(tween)
  }

  function syncGrowth(taskIds: number[]) {
    const ids = new Set(taskIds)
    for (const id of grownTasks) if (!ids.has(id)) grownTasks.delete(id)
    void growBars()
  }

  function replayGrowth() {
    for (const tween of growthTweens) tween.kill()
    growthTweens.clear()
    grownTasks.clear()
    void growBars()
  }

  onScopeDispose(() => {
    disposed = true
    for (const tween of growthTweens) tween.kill()
    growthTweens.clear()
  })

  return { growBars, syncGrowth, replayGrowth }
}
