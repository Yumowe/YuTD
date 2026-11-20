import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { gsap } from 'gsap'
import { TextPlugin } from 'gsap/TextPlugin'

export function useEventTipTyping(
  visibleTips: Readonly<Ref<readonly { id: number, content: string }[]>>,
  focused: () => boolean | undefined,
  focusProgress: () => number | undefined
) {
  const progress = computed(() => focused() ? Math.max(0, Math.min(1, focusProgress() ?? 0)) : 0)

  const tipElements = ref<HTMLElement[]>([])

  const retracting = ref(false)

  let typing: ReturnType<typeof gsap.timeline> | undefined

  let typingTween: ReturnType<typeof gsap.to> | undefined

  function clearTyping() {
    typingTween?.kill()
    typingTween = undefined
    typing?.progress(0)
    typing?.kill()
    typing = undefined
    retracting.value = false
  }

  function buildTyping(value = progress.value) {
    clearTyping()
    typing = gsap.timeline({ paused: true })
    const escaped = document.createElement('span')
    for (const tip of visibleTips.value) {
      const element = tipElements.value.find(element => element.dataset.tipId === String(tip.id))
      if (!element) continue
      element.textContent = ''
      escaped.textContent = tip.content
      typing.to(element, {
        text: { value: escaped.innerHTML, preserveSpaces: true },
        duration: Array.from(tip.content).length,
        ease: 'none'
      })
    }
    typing.progress(value)
  }

  onMounted(() => {
    gsap.registerPlugin(TextPlugin)
    watch([visibleTips, progress], ([tips, value], previous) => {
      if (!tips.length) {
        clearTyping()
      } else if (value === 0) {
        if (typing && typing.progress() > 0 && (focusProgress() ?? 0) > 0) {
          typingTween?.kill()
          retracting.value = true
          typingTween = typing.tweenTo(0, { duration: 0.45, ease: 'power4.out', onComplete: clearTyping })
        } else {
          clearTyping()
        }
      } else if (!typing || tips !== previous?.[0]) {
        buildTyping(value === 1 ? 0 : value)
        if (value === 1) {
          typingTween = typing?.tweenTo(typing.duration(), { duration: 0.45, ease: 'power4.out' })
        }
      } else {
        typingTween?.kill()
        typingTween = undefined
        if (retracting.value && value === 1) {
          typingTween = typing.tweenTo(typing.duration(), { duration: 0.45, ease: 'power4.out' })
        } else {
          typing.progress(value < (previous?.[1] ?? value) ? Math.min(value, typing.progress()) : value)
        }
        retracting.value = false
      }
    }, { immediate: true, flush: 'post' })
  })

  onScopeDispose(clearTyping)

  return { progress, retracting, tipElements }
}
