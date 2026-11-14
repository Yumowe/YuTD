<script setup lang="ts">
// 导入
import type AppSidebar from '~/components/common/AppSidebar.vue'
import { formatImageBytes, type StoredImage } from '#shared/images'
import { RESOURCE_LABELS, RESOURCE_TYPES, type ResourceSelection, type ResourceSort } from '#shared/resources'
import ImageUploader from '~/components/image/ImageUploader.vue'
import StoredImagePreview from '~/components/image/StoredImagePreview.vue'
import PageCard from '~/components/preview/card/PageCard.vue'
import AppPopup from '~/components/common/AppPopup.vue'
import Card from '~/components/preview/card/Card.vue'

// 页面配置与类型
definePageMeta({ alias: ['/images'] })
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()

// 系统变量读取
const { preferences } = useAppPeferences()
const { reportError } = useAppErrors()

// 资源请求依赖筛选条件和分页大小。
const criteria = reactive({ type: 'all' as ResourceSelection, search: '', tag: '', sort: 'updatedAt' as ResourceSort, page: 1 })
const limit = 24

// API 读取
const phasesClient = reactive(useApi({
  key: 'phases',
  read: api => api.api.phase.get(),
  watch: true
}))
const eventsClient = reactive(useApi({
  key: () => `events:${preferences.value?.defaultPhaseId ?? 'none'}`,
  read: async (api) => {
    const phaseId = preferences.value?.defaultPhaseId
    return phaseId == null ? [] : api.api.event.get({ query: { phaseId } })
  },
  watch: true
}))
const resourcesClient = reactive(useApi({
  key: () => `resources:${JSON.stringify(criteria)}`,
  read: api => api.api.resource.get({ query: {
    type: criteria.type,
    search: criteria.search,
    tag: criteria.tag || undefined,
    sort: criteria.sort,
    limit,
    offset: (criteria.page - 1) * limit
  } }),
  watch: true
}))

// 页面变量：普通变量
let activated = false
let searchTimer: ReturnType<typeof setTimeout> | undefined

// 页面变量：响应式数据
const state = reactive({ pageActive: true, search: '', preview: null as StoredImage | null, previewOpen: false, deleteCandidate: false, copied: false })
const imagePreview = ref<InstanceType<typeof StoredImagePreview> | null>(null)

// 计算属性
const data = computed(() => resourcesClient.data)
const loading = computed(() => resourcesClient.read.loading.value)
const writing = computed(() => imagePreview.value?.saving ?? false)
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / limit)))
const items = computed(() => data.value?.items ?? [])

// 方法
function updateType(event: Event) {
  const type = (event.target as HTMLSelectElement).value as ResourceSelection
  Object.assign(criteria, { type, tag: '', page: 1 })
}

function updateSort(event: Event) {
  Object.assign(criteria, { sort: (event.target as HTMLSelectElement).value as ResourceSort, page: 1 })
}

function selectTag(tag: string) {
  Object.assign(criteria, { tag, page: 1 })
}

function changePage(page: number) {
  Object.assign(criteria, { page })
}

function openPreview(image: StoredImage) {
  state.preview = image
  state.deleteCandidate = false
  state.copied = false
  state.previewOpen = true
}

async function removeImage() {
  if (!imagePreview.value || writing.value) return
  await imagePreview.value.remove().catch(() => {})
}

async function imageDeleted() {
  state.deleteCandidate = false
  state.previewOpen = false
  await resourcesClient.read()
}

async function copyId() {
  if (!state.preview) return
  try {
    await navigator.clipboard.writeText(state.preview.id)
    state.copied = true
  } catch (error) {
    reportError(error, '复制图片 ID')
  }
}

async function refreshContent() {
  await Promise.all([
    phasesClient.read(),
    eventsClient.read(),
    resourcesClient.read()
  ])
}

// 监听
watch(() => state.search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    Object.assign(criteria, { search: value.trim(), page: 1 })
  }, 250)
})
watch(data, (value) => {
  if (value && criteria.page > Math.max(1, Math.ceil(value.total / limit)))
    changePage(Math.max(1, Math.ceil(value.total / limit)))
})
watchEffect(() => {
  if (state.pageActive) emit('page-data', { phases: phasesClient.data, events: eventsClient.data, eventsPending: eventsClient.read.loading.value, refreshEvents: eventsClient.read, refreshContent })
})

// 生命周期
onActivated(() => {
  state.pageActive = true
  if (activated) void refreshContent().catch(() => {})
  activated = true
})
onDeactivated(() => {
  state.pageActive = false
})
onBeforeUnmount(() => {
  clearTimeout(searchTimer)
})
</script>

<template>
  <main class="resources page-shell">
    <PageCard>
      <header class="resources__header">
        <div class="resources__title-row">
          <h1>资源管理</h1>
          <select
            :value="criteria.type"
            class="resources__select"
            aria-label="资源类型"
            @change="updateType"
          >
            <option value="all">
              全部资源
            </option>
            <option
              v-for="type in RESOURCE_TYPES"
              :key="type"
              :value="type"
            >
              {{ RESOURCE_LABELS[type] }}
            </option>
          </select>
        </div>
        <ImageUploader
          v-if="criteria.type === 'all' || criteria.type === 'image'"
          @uploaded="resourcesClient.read()"
        />
      </header>
    </PageCard>

    <PageCard>
      <div class="resources__classifier">
        <label class="resources__search">
          <Icon name="lucide:search" />
          <input
            v-model="state.search"
            type="search"
            maxlength="120"
            placeholder="搜索资源"
            aria-label="搜索资源"
          >
        </label>
        <div
          v-if="(criteria.type === 'all' || criteria.type === 'task') && (data?.tags.length || criteria.tag)"
          class="resources__tags"
          role="group"
          aria-label="标签分类"
        >
          <span class="resources__muted">标签</span>
          <button
            class="resources__tag"
            type="button"
            :aria-pressed="!criteria.tag"
            @click="selectTag('')"
          >
            全部
          </button>
          <button
            v-for="tag in data?.tags ?? []"
            :key="tag.name"
            class="resources__tag"
            type="button"
            :aria-pressed="criteria.tag === tag.name"
            @click="selectTag(criteria.tag === tag.name ? '' : tag.name)"
          >
            #{{ tag.name }} <span>{{ tag.count }}</span>
          </button>
          <button
            v-if="criteria.tag && !data?.tags.some(tag => tag.name === criteria.tag)"
            class="resources__tag"
            type="button"
            aria-pressed="true"
            @click="selectTag('')"
          >
            #{{ criteria.tag }} ×
          </button>
        </div>
      </div>
    </PageCard>

    <PageCard class="resources__results">
      <div class="resources__toolbar">
        <p class="resources__muted">
          {{ RESOURCE_LABELS[criteria.type] }} · {{ data?.total ?? 0 }} 项
        </p>
        <div class="resources__toolbar-actions">
          <select
            :value="criteria.sort"
            class="resources__select"
            aria-label="资源排列顺序"
            @change="updateSort"
          >
            <option value="updatedAt">
              更新时间 · 从新到旧
            </option>
            <option value="createdAt">
              创建时间 · 从新到旧
            </option>
          </select>
          <button
            class="button"
            type="button"
            :disabled="loading || writing"
            @click="resourcesClient.read()"
          >
            刷新
          </button>
        </div>
      </div>

      <p
        v-if="loading && !data"
        class="resources__empty"
        role="status"
      >
        正在读取资源……
      </p>
      <div
        v-else-if="!data"
        class="resources__empty"
      >
        <p>暂时无法读取资源。</p>
        <button
          class="button"
          type="button"
          @click="resourcesClient.read()"
        >
          重新读取
        </button>
      </div>
      <p
        v-else-if="!items.length"
        class="resources__empty"
      >
        {{ criteria.search || criteria.tag ? '没有找到匹配的资源。' : '暂无资源。' }}
      </p>
      <div
        v-else
        class="resources__board"
        :aria-busy="loading"
      >
        <Card
          v-for="item in items"
          :key="item.id"
          :height="240"
          color="var(--background-secondary)"
        >
          <article class="resources__card-content">
            <span class="resources__muted">{{ RESOURCE_LABELS[item.type] }}</span>
            <strong
              class="resources__card-title"
              :title="item.title"
            >{{ item.title }}</strong>
            <button
              v-if="item.type === 'image'"
              class="resources__thumbnail"
              type="button"
              :aria-label="`预览图片：${item.title}`"
              @click="openPreview(item.data)"
            >
              <StoredImagePreview
                :image="item.data"
                variant="thumbnail"
                fit="contain"
              />
            </button>
          </article>
        </Card>
      </div>

      <nav
        v-if="data && pages > 1"
        class="resources__pagination"
        aria-label="资源分页"
      >
        <button
          class="button"
          type="button"
          :disabled="criteria.page <= 1 || loading || writing"
          @click="changePage(criteria.page - 1)"
        >
          上一页
        </button>
        <span>{{ criteria.page }} / {{ pages }}</span>
        <button
          class="button"
          type="button"
          :disabled="criteria.page >= pages || loading || writing"
          @click="changePage(criteria.page + 1)"
        >
          下一页
        </button>
      </nav>
    </PageCard>

    <AppPopup
      v-model:open="state.previewOpen"
      class="resources__dialog"
      :title="state.preview?.name ?? '图片资源'"
      :dismissible="!writing"
      @close="state.preview = null"
    >
      <template v-if="state.preview">
        <div class="resources__full">
          <StoredImagePreview
            ref="imagePreview"
            :image="state.preview"
            variant="file"
            fit="contain"
            @deleted="imageDeleted"
          />
        </div>
        <div class="resources__image-info">
          <p>
            {{ state.preview.width }} × {{ state.preview.height }} · {{ formatImageBytes(state.preview.size) }}<template v-if="state.preview.size < state.preview.originalSize">
              · 原文件 {{ formatImageBytes(state.preview.originalSize) }}
            </template>
          </p>
          <code>{{ state.preview.id }}</code>
          <div class="resources__dialog-actions">
            <button
              class="button"
              type="button"
              @click="copyId"
            >
              {{ state.copied ? '已复制' : '复制 ID' }}
            </button>
            <template v-if="state.deleteCandidate">
              <span class="resources__muted">同时删除图片和缩略图？</span>
              <button
                class="button resources__delete"
                type="button"
                :disabled="writing"
                @click="removeImage"
              >
                {{ writing ? '删除中……' : '确认删除' }}
              </button>
              <button
                class="button"
                type="button"
                :disabled="writing"
                @click="state.deleteCandidate = false"
              >
                取消
              </button>
            </template>
            <button
              v-else
              class="button resources__delete"
              type="button"
              :disabled="writing"
              @click="state.deleteCandidate = true"
            >
              删除图片
            </button>
          </div>
        </div>
      </template>
    </AppPopup>
  </main>
</template>

<style scoped>
.resources { display: grid; align-content: start; gap: 18px; max-width: 1600px; margin-inline: auto; }
.resources__header { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 24px; padding: 8px; }
.resources__title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; }
.resources h1 { margin: 0; font-size: clamp(36px, 5vw, 60px); font-weight: 600; letter-spacing: -0.04em; line-height: 1.25; white-space: nowrap; }
.resources__select { min-width: 0; padding: 9px 12px; color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 10px; background: var(--background-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.resources__classifier { display: grid; gap: 14px; padding: 4px; }
.resources__search { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--background-primary); }
.resources__search input { flex: 1; width: 100%; min-width: 0; border: 0; outline: none; color: var(--text-primary); background: transparent; font: inherit; font-size: 14px; }
.resources__search:focus-within { outline: 2px solid var(--text-secondary); outline-offset: 2px; }
.resources__tags { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.resources__tag { display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px; border: 1px solid var(--border-color); border-radius: 999px; color: var(--text-secondary); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.resources__tag[aria-pressed='true'] { color: var(--background-secondary); background: var(--text-primary); border-color: var(--text-primary); }
.resources__tag span { opacity: .65; font-variant-numeric: tabular-nums; }
.resources__muted { margin: 0; color: var(--text-secondary); font-size: 12px; }
.resources__toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 2px 4px 18px; }
.resources__toolbar-actions { display: flex; align-items: center; gap: 10px; }
.resources__board { display: grid; grid-template-columns: repeat(auto-fill, min(240px, 100%)); gap: 14px; width: 100%; min-width: 0; }
.resources__card-content { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; height: 100%; padding: 12px; }
.resources__card-title { display: -webkit-box; flex: none; overflow: hidden; -webkit-box-orient: vertical; overflow-wrap: anywhere; line-height: 1.4; }
.resources__thumbnail { flex: 1; min-width: 0; min-height: 0; width: 100%; padding: 0; overflow: hidden; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.resources__thumbnail:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.resources__empty { margin: 0; padding: 60px 20px; color: var(--text-secondary); text-align: center; font-size: 14px; }
.resources__pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 20px; font-size: 13px; }
.resources__dialog { --popup-width: 1000px; }
.resources__full { height: min(65dvh, 680px); }
.resources__image-info { display: grid; gap: 10px; margin-top: 14px; }
.resources__image-info p { margin: 0; color: var(--text-secondary); font-size: 12px; }
.resources__image-info code { overflow-wrap: anywhere; color: var(--text-secondary); font-size: 11px; }
.resources__dialog-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.resources__delete { color: #dc3545; }
@media (width <= 600px) {
  .resources { padding: 16px; }
  .resources__title-row { gap: 14px; }
  .resources__toolbar-actions { width: 100%; }
  .resources__toolbar-actions select { flex: 1; }
}
</style>
