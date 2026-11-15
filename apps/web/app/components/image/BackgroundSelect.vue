<script setup lang="ts">
import ImageCropper from './ImageCropper.vue'
import AppPopup from '../common/AppPopup.vue'
import ImageUploader from './ImageUploader.vue'
import StoredImagePreview from './StoredImagePreview.vue'
import { simplifyImage } from '~/utils/simplifyImage'
import { loadBackgroundImage } from './background'
import type { ImageCropInfo } from './ImageCropper.vue'
import type { SimplifiedImageData } from '~/utils/simplifyImage'
import type { StoredImage } from '#shared/images'

export interface BackgroundSelection {
  id: string
  backgroundKey?: string
  image: string
  simplifiedImage: string
  analysis: SimplifiedImageData
  position?: ImageCropInfo
}

const props = withDefaults(defineProps<{ aspectRatio?: number, backgroundKey?: string, random?: boolean, hideSelection?: boolean, responsive?: boolean }>(), { responsive: true })
const { mode } = useSystemStatus()
const emit = defineEmits<{ 'change': [selection: BackgroundSelection | null], 'loading-change': [loading: boolean] }>()
const opened = ref(false)
const uploader = ref<InstanceType<typeof ImageUploader> | null>(null)
const images = ref<StoredImage[]>([])
const loading = ref(false)
const draft = shallowRef<Omit<BackgroundSelection, 'position'> | null>(null)
const selected = shallowRef<BackgroundSelection | null>(null)
const app = useNuxtApp()
const { reportError } = useAppErrors()
const controller = new AbortController()
let restoreVersion = 0

const client = useApi({
  key: 'images:all',
  read: async (api) => {
    const items: StoredImage[] = []
    while (true) {
      const page = await requestApiData(api.api.image.get({ query: { offset: items.length, limit: 100 } }))
      items.push(...page.items)
      if (!page.items.length || items.length >= page.total) return items
    }
  }
})
const backgroundClient = useApi({
  key: () => `backgrounds:${props.backgroundKey ?? 'none'}`,
  read: async api => props.backgroundKey ? api.api.image.background.get({ query: { backgroundKey: props.backgroundKey } }) : null,
  write: (api, value: { key: string, imageId: string | null, position?: ImageCropInfo }) => api.api.image.background.patch({
    backgroundKey: value.key, imageId: value.imageId, position: value.position
  })
})
const randomClient = useApi({
  key: 'image-rotations:draw',
  write: (api, value: { random: number, backgroundKey?: string }) => api.api.image.random({ random: String(value.random) }).get({ query: { backgroundKey: value.backgroundKey } })
})

async function refresh() {
  loading.value = true
  try {
    images.value = await client.read()
  } catch {
    // useApi 已统一上报。
  } finally {
    loading.value = false
  }
}

async function open() {
  if (loading.value) return
  opened.value = true
  await refresh()
}

watch(client.data, (value) => {
  if (value) images.value = value
}, { immediate: true })

function release(value: Omit<BackgroundSelection, 'position'> | null) {
  if (!value) return
  URL.revokeObjectURL(value.image)
  URL.revokeObjectURL(value.simplifiedImage)
}

function clearDraft() {
  release(draft.value)
  draft.value = null
}

async function choose(image: StoredImage) {
  const version = ++restoreVersion
  loading.value = true
  try {
    const value = await loadImage(image.id)
    if (!value) return
    if (!opened.value || version !== restoreVersion || controller.signal.aborted) {
      release(value)
      return
    }
    clearDraft()
    draft.value = value
  } catch (error) {
    if (!controller.signal.aborted) reportError(error, '选择背景')
  } finally {
    loading.value = false
    if (!controller.signal.aborted && version === restoreVersion) emit('loading-change', false)
  }
}

async function loadImage(id: string) {
  const read = (variant: 'file' | 'thumbnail') => app.runWithContext(() => {
    const scope = effectScope()
    const request = scope.run(() => useApi({
      key: `image-files:${id}:${variant}`,
      read: async (api) => {
        const response = await api.api.image({ id })[variant].get({ fetch: { signal: controller.signal } })
        controller.signal.throwIfAborted()
        const blob = await requestApiData(Promise.resolve(response))
        if (!(blob instanceof Blob)) throw new Error('图片响应不是有效文件')
        return blob
      }
    }).read())!
    return request.finally(() => scope.stop())
  })
  const files = await Promise.all([read('file'), read('thumbnail')]).catch(() => undefined)
  if (!files) return
  const [original, simplified] = files
  controller.signal.throwIfAborted()
  const image = URL.createObjectURL(original)
  const simplifiedImage = URL.createObjectURL(simplified)
  try {
    const [analysis] = await Promise.all([
      simplifyImage(simplified, 'json', { colors: 256, mergeRange: 0, contourSteps: 0 }),
      loadBackgroundImage(image), loadBackgroundImage(simplifiedImage)
    ])
    controller.signal.throwIfAborted()
    return { id, image, simplifiedImage, analysis }
  } catch (error) {
    URL.revokeObjectURL(image)
    URL.revokeObjectURL(simplifiedImage)
    throw error
  }
}

async function applySelection(value: BackgroundSelection | null) {
  const previous = selected.value
  selected.value = value
  emit('change', value)
  emit('loading-change', false)
  await nextTick()
  release(previous)
}

function randomNumber() {
  return crypto.getRandomValues(new Uint32Array(1))[0]!
}

async function clearBackground() {
  if (loading.value) return
  const key = props.backgroundKey
  const version = ++restoreVersion
  loading.value = true
  try {
    if (key && !await backgroundClient.write({ key, imageId: null }).catch(() => undefined)) return
    if (controller.signal.aborted || version !== restoreVersion) return
    clearDraft()
    opened.value = false
    await applySelection(null)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  watch(() => [props.backgroundKey, props.random] as const, async ([key, random]) => {
    const version = ++restoreVersion
    if (controller.signal.aborted) return
    if (!key) return
    emit('loading-change', true)
    try {
      let record = await backgroundClient.read().catch(() => undefined)
      if (record === undefined) return
      if (controller.signal.aborted || version !== restoreVersion) return
      if (!record?.id && random) {
        const drawn = await randomClient.write({ random: randomNumber(), backgroundKey: key }).catch(() => undefined)
        record = drawn ? { ...drawn, backgroundKey: drawn.backgroundKey ?? key } : undefined
      }
      if (record === undefined) return
      if (controller.signal.aborted || version !== restoreVersion) return
      if (!record?.id) {
        await applySelection(null)
        return
      }
      const value = await loadImage(record.id)
      if (!value) return
      if (controller.signal.aborted || version !== restoreVersion) {
        release(value)
        return
      }
      await applySelection({ ...value, backgroundKey: record.backgroundKey ?? key, position: record.position ?? undefined })
    } catch (error) {
      if (!controller.signal.aborted && version === restoreVersion) reportError(error, '恢复背景')
    } finally {
      if (!controller.signal.aborted && version === restoreVersion) emit('loading-change', false)
    }
  }, { immediate: true })
})

async function confirm(position: ImageCropInfo) {
  if (!draft.value || loading.value) return
  const value = { ...draft.value, backgroundKey: props.backgroundKey, position }
  const key = props.backgroundKey
  const version = ++restoreVersion
  loading.value = true
  draft.value = null
  opened.value = false
  let pending: BackgroundSelection | null = value
  try {
    if (key && !await backgroundClient.write({ key, imageId: value.id, position }).catch(() => undefined)) return
    if (controller.signal.aborted || version !== restoreVersion) return
    pending = null
    await applySelection(value)
  } catch (error) {
    if (!controller.signal.aborted) reportError(error, '保存背景')
  } finally {
    release(pending)
    loading.value = false
  }
}

async function chooseRandom() {
  if (loading.value) return
  const key = props.backgroundKey
  const version = ++restoreVersion
  loading.value = true
  let value: Awaited<ReturnType<typeof loadImage>> | undefined
  try {
    const record = await randomClient.write({ random: randomNumber() }).catch(() => undefined)
    if (!record) return
    if (!record.id) throw new Error('轮播中没有可选图片')
    if (controller.signal.aborted || version !== restoreVersion) return
    value = await loadImage(record.id)
    if (!value) return
    if (controller.signal.aborted || version !== restoreVersion) {
      release(value)
      value = undefined
      return
    }
    if (key && !await backgroundClient.write({ key, imageId: value.id }).catch(() => undefined)) return
    if (controller.signal.aborted || version !== restoreVersion) return
    clearDraft()
    opened.value = false
    await applySelection({ ...value, backgroundKey: record.backgroundKey ?? undefined })
    value = undefined
  } catch (error) {
    if (!controller.signal.aborted && version === restoreVersion) reportError(error, '随机背景')
  } finally {
    release(value ?? null)
    loading.value = false
    if (!controller.signal.aborted && version === restoreVersion) emit('loading-change', false)
  }
}

onBeforeUnmount(() => {
  controller.abort()
  clearDraft()
  release(selected.value)
})
</script>

<template>
  <div
    v-if="mode === 'edit' || !hideSelection"
    class="background-select"
    :class="{ 'background-select--responsive': responsive }"
  >
    <button
      class="button background-select__trigger"
      :class="{ 'image-select-button': responsive }"
      type="button"
      aria-label="选择背景"
      title="选择背景"
      @click="open"
    >
      <Icon
        v-if="responsive"
        name="lucide:image"
        aria-hidden="true"
      />
      <span class="background-select__label image-select-button__label">选择背景</span>
    </button>
    <AppPopup
      v-model:open="opened"
      class="background-select__dialog"
      aria-label="选择背景"
      :dismissible="!loading"
      @close="clearDraft"
    >
      <header class="background-select__header">
        <button
          v-if="draft"
          class="button"
          type="button"
          @click="clearDraft"
        >
          返回图库
        </button>
        <strong v-else>选择图片</strong>
        <div class="background-select__actions">
          <button
            class="button image-select-button"
            type="button"
            :disabled="loading"
            aria-label="随机选图"
            title="随机选图"
            @click="chooseRandom"
          >
            <Icon
              name="lucide:shuffle"
              aria-hidden="true"
            />
            <span class="image-select-button__label">随机选图</span>
          </button>
          <button
            v-if="!draft"
            class="button image-select-button"
            type="button"
            :disabled="loading || uploader?.uploading"
            aria-label="上传图片"
            title="上传图片"
            @click="uploader?.open()"
          >
            <Icon
              name="lucide:image-plus"
              aria-hidden="true"
            />
            <span class="image-select-button__label">上传图片</span>
          </button>
          <button
            class="button"
            type="button"
            aria-label="关闭"
            :disabled="loading"
            @click="opened = false"
          >
            ×
          </button>
        </div>
      </header>
      <ImageCropper
        v-if="draft"
        :src="draft.image"
        output="info"
        :aspect-ratio="aspectRatio"
        :inert="loading"
        @info="confirm"
        @error="reportError($event, '选择背景位置')"
      />
      <template v-if="!draft">
        <p
          v-if="loading"
          role="status"
        >
          正在读取图片……
        </p>
        <div
          v-else
          class="background-select__gallery"
        >
          <button
            class="background-select__none"
            type="button"
            aria-label="不使用背景图"
            title="不使用背景图"
            @click="clearBackground"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
              />
              <path d="m4.93 4.93 14.14 14.14" />
            </svg>
          </button>
          <div
            v-if="uploader?.uploading"
            class="background-select__pending"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <Icon
              name="lucide:image"
              size="28"
              aria-hidden="true"
            />
            <span class="background-select__pending-status">
              <span
                class="background-select__spinner"
                aria-hidden="true"
              />
              图片处理中……
            </span>
          </div>
          <button
            v-for="image in images"
            :key="image.id"
            type="button"
            :aria-label="`选择 ${image.name}`"
            @click="choose(image)"
          >
            <StoredImagePreview
              :image="image"
              fit="contain"
            />
          </button>
        </div>
        <p v-if="!loading && !images.length && !uploader?.uploading">
          暂无图片，点击右上角上传。
        </p>
      </template>
    </AppPopup>
    <div class="background-select__upload">
      <ImageUploader
        ref="uploader"
      />
    </div>
  </div>
</template>

<style scoped>
.background-select { display: grid; grid-template-columns: max-content; grid-template-rows: auto; align-items: center; min-width: 0; }
.background-select__trigger { display: inline-grid; grid-auto-flow: column; grid-auto-columns: max-content; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.background-select__dialog {
  --popup-width: 900px;
  container-type: inline-size;
}

.background-select__header,
.background-select__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.background-select__header {
  justify-content: space-between;
  margin-bottom: 16px;
}

.background-select__upload { display: contents; }
.background-select__upload :deep(.image-uploader) { display: contents; }
.background-select__upload :deep(.image-uploader > button) {
  display: none;
}

.background-select__gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.background-select__gallery > button,
.background-select__pending {
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: transparent;
}
.background-select__gallery > button { cursor: pointer; }
.background-select__gallery > .background-select__none { display: grid; place-items: center; min-height: 120px; color: var(--text-secondary); background: var(--background-primary); }
.background-select__pending { display: grid; place-content: center; justify-items: center; gap: 12px; min-height: 120px; color: var(--text-secondary); background: var(--background-primary); font-size: 12px; }
.background-select__pending-status { display: flex; align-items: center; gap: 6px; }
.background-select__spinner { width: 12px; height: 12px; border: 2px solid var(--border-color); border-top-color: currentColor; border-radius: 50%; animation: image-upload-spin 0.8s linear infinite; }
@keyframes image-upload-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .background-select__spinner { animation: none; }
}
</style>
