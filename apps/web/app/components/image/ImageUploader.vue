<script setup lang="ts">
import ImageCropper from './ImageCropper.vue'
import AppPopup from '../common/AppPopup.vue'
import ColorCountSelect from './ColorCountSelect.vue'
import { simplifyImage } from '~/utils/simplifyImage'

defineProps<{ aspectRatio?: number }>()
const emit = defineEmits<{ submitted: [], uploaded: [] }>()
const { reportError } = useAppErrors()
const colors = ref<number | 'auto'>('auto')
const client = useApi({
  key: 'image:upload',
  write: async (api, task: { file: File, colors: number | 'auto' }) => api.api.image.post({
    file: task.file,
    thumbnail: new File([await simplifyImage(task.file, 'png', { colors: task.colors })], 'thumbnail.png', { type: 'image/png' })
  })
})
const input = ref<HTMLInputElement | null>(null)
const source = ref('')
const name = ref('image.png')
const uploading = client.write.saving
let disposed = false
const cropOpen = computed({
  get: () => Boolean(source.value),
  set: (value: boolean) => {
    if (!value) clearSource()
  }
})

function clearSource() {
  if (source.value) URL.revokeObjectURL(source.value)
  source.value = ''
}

function selectFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  clearSource()
  source.value = URL.createObjectURL(file)
  name.value = `${file.name.replace(/\.[^.]+$/, '')}.png`
}

function upload(blob: Blob) {
  if (!source.value) return
  const task = { file: new File([blob], name.value, { type: blob.type }), colors: colors.value }
  clearSource()
  void client.write(task).then(() => {
    if (!disposed) emit('uploaded')
  }).catch(() => {})
  emit('submitted')
}

onBeforeUnmount(() => {
  disposed = true
  clearSource()
})

defineExpose({ uploading, source, open: () => input.value?.click() })
</script>

<template>
  <div
    class="image-uploader"
    :aria-busy="uploading"
  >
    <button
      class="button image-select-button"
      type="button"
      aria-label="上传图片"
      title="上传图片"
      @click="input?.click()"
    >
      <Icon
        name="lucide:image-plus"
        aria-hidden="true"
      />
      <span class="image-select-button__label">上传图片</span>
    </button>
    <input
      ref="input"
      type="file"
      accept="image/*"
      hidden
      aria-label="上传图片"
      @change="selectFile"
    >
    <AppPopup
      v-model:open="cropOpen"
      title="裁剪图片"
      class="image-uploader__crop-popup"
    >
      <ColorCountSelect
        v-model="colors"
      />
      <ImageCropper
        :src="source"
        :aspect-ratio="aspectRatio"
        @image="upload"
        @error="reportError($event, '裁剪图片')"
      />
    </AppPopup>
  </div>
</template>

<style scoped>
.image-uploader {
  display: grid;
  justify-items: start;
  gap: 12px;
  width: min(100%, 760px);
  min-width: 0;
  container-type: inline-size;
}

.image-uploader__crop-popup { --popup-width: 900px; }
</style>
