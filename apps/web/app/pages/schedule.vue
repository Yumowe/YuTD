<script setup lang="ts">
// 导入
import type AppSidebar from '~/components/common/AppSidebar.vue'
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'
import EditPopup from '~/components/edit/EditPopup.vue'
import type { EditField, EditValues } from '~/utils/editFields'

// 页面配置与类型
type ScheduleSettings = Pick<ApiData<Api['api']['preferences']['get']>, 'maxFocusScale' | 'focusColumnScale' | 'hourPixels' | 'edgePixels'>
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()

// 系统变量读取
const { mode } = useSystemStatus()
const { preferences, loading: preferencesLoading } = useAppPeferences()

// API 读取
const phaseClient = reactive(useApi({
  key: () => `phase:${preferences.value?.defaultPhaseId ?? 'none'}`,
  read: async (api) => {
    const id = preferences.value?.defaultPhaseId
    return id == null ? null : api.api.phase({ id }).get()
  },
  watch: true
}))
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
const tasksClient = reactive(useApi({
  key: () => `tasks:${preferences.value?.defaultPhaseId ?? 'none'}:all`,
  read: async (api) => {
    const phaseId = preferences.value?.defaultPhaseId
    return phaseId == null ? [] : api.api.task.get({ query: { phaseId } })
  },
  write: (api, [id, change]: Parameters<ChangeTask>) => 'plannedDate' in change
    ? api.api.task({ id }).postpone.patch(change)
    : api.api.task({ id }).patch(change),
  watch: true
}))

// 页面变量：普通变量
let activated = false
const editFields: EditField[] = [
  { key: 'maxFocusScale', label: '垂直聚焦增量', type: 'number', defaultValue: 2, min: 0, max: 5, step: 0.1, description: '实际聚焦倍数为 1 + 此值' },
  { key: 'focusColumnScale', label: '水平聚焦倍数', type: 'number', defaultValue: 3, min: 1, max: 6, step: 0.1, description: '实际倍数受显示列数限制' },
  { key: 'hourPixels', label: '每小时高度（px）', type: 'integer', defaultValue: 72, min: 24, max: 200, step: 1 },
  { key: 'edgePixels', label: '上下留白（px）', type: 'integer', defaultValue: 20, min: 0, max: 100, step: 1 }
]

// 页面变量：响应式数据
const state = reactive({ pageActive: true, editOpen: false, preview: null as EditValues | null })
const editAnchor = ref<HTMLElement | null>(null)

// 计算属性
const phases = computed(() => phasesClient.data)
const phase = computed(() => phaseClient.data)
const selectedPhaseId = computed(() => preferences.value?.defaultPhaseId ?? null)
const loading = computed(() => preferencesLoading.value || phaseClient.read.loading.value)
const savedSettings = computed<ScheduleSettings>(() => ({
  maxFocusScale: preferences.value?.maxFocusScale ?? 2,
  focusColumnScale: preferences.value?.focusColumnScale ?? 3,
  hourPixels: preferences.value?.hourPixels ?? 72,
  edgePixels: preferences.value?.edgePixels ?? 20
}))
const tableSettings = computed(() => toSettings(state.preview ?? savedSettings.value))

// 方法
function toSettings(values: EditValues): ScheduleSettings {
  return {
    maxFocusScale: Number(values.maxFocusScale),
    focusColumnScale: Number(values.focusColumnScale),
    hourPixels: Number(values.hourPixels),
    edgePixels: Number(values.edgePixels)
  }
}
function saveSettings(values: EditValues) {
  if (preferences.value) Object.assign(preferences.value, toSettings(values))
}
async function refreshContent() {
  await Promise.all([
    phasesClient.read(),
    eventsClient.read(),
    tasksClient.read(),
    phaseClient.read()
  ])
}

async function changeTask(...args: Parameters<ChangeTask>) {
  const task = await tasksClient.write(args)
  await refreshContent()
  return task
}

// 监听
watch(mode, (value) => {
  if (value !== 'edit') state.editOpen = false
}, { flush: 'sync' })
watch(() => state.editOpen, (open) => {
  if (!open) state.preview = null
}, { flush: 'sync' })
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
</script>

<template>
  <main class="schedule-page">
    <p
      v-if="loading && !phase"
      class="page-state"
      role="status"
    >
      正在加载阶段……
    </p>
    <p
      v-else-if="phases?.length === 0"
      class="page-state"
    >
      <span>
        还没有阶段。点击侧边栏的
        <Icon
          class="phase-create-hint-icon"
          name="lucide:pen-line"
          role="img"
          aria-label="铅笔"
        />
        开启编辑模式，再点
        <Icon
          class="phase-create-hint-icon"
          name="lucide:plus"
          role="img"
          aria-label="加号"
        />
        选择「阶段」，创建你的首个 Phase。
      </span>
    </p>
    <p
      v-else-if="selectedPhaseId === null"
      class="page-state"
    >
      请先在边栏选择一个 Phase 喵。
    </p>
    <ScheduleTable
      v-else-if="phase && phase.id === selectedPhaseId"
      :key="phase.id"
      :events="eventsClient.data"
      :tasks="tasksClient.data"
      :events-pending="eventsClient.read.loading.value"
      :refresh-events="eventsClient.read"
      :refresh-content="refreshContent"
      :change-task="changeTask"
      :phase="phase"
      v-bind="tableSettings"
      mode="full"
    />
    <div
      v-else
      class="page-state"
    >
      <p>阶段尚未载入。</p>
      <button
        class="button"
        type="button"
        @click="phaseClient.read()"
      >
        重新加载
      </button>
    </div>
    <button
      v-if="mode === 'edit' && phase && phase.id === selectedPhaseId"
      ref="editAnchor"
      class="button schedule-edit-trigger"
      type="button"
      :aria-expanded="state.editOpen"
      @click="state.editOpen = !state.editOpen"
    >
      <Icon
        name="lucide:sliders-horizontal"
        aria-hidden="true"
      />
      调整课程表
    </button>
    <EditPopup
      v-if="mode === 'edit' && preferences"
      v-model:open="state.editOpen"
      title="课程表参数"
      :anchor="editAnchor"
      :fields="editFields"
      :values="savedSettings"
      :save="saveSettings"
      @change="state.preview = state.editOpen ? $event : null"
    />
  </main>
</template>

<style scoped>
.schedule-page {
  width: 100%;
  min-height: var(--app-content-height);
  min-width: 0;
}

.schedule-page :deep(.event-schedule__background) {
  min-height: var(--app-content-height);
}

.schedule-edit-trigger {
  position: fixed;
  z-index: 40;
  right: calc(16px + var(--app-safe-right));
  bottom: calc(var(--app-bottom-bar-height, 0px) + 16px);
  gap: 8px;
  box-shadow: 0 4px 16px #0002;
}
</style>
