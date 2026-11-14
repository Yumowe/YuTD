<script setup lang="ts">
// 导入
import type AppSidebar from '~/components/common/AppSidebar.vue'
import TaskAttentionBar from '~/components/preview/Task/TaskAttentionBar.vue'
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'

// 页面配置与类型
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()

// 系统变量读取
const { now, timeZone } = useSystemTime()
const { preferences } = useAppPeferences()

// API 读取
const phasesClient = reactive(useApi({
  key: 'phases',
  read: api => api.api.phase.get(),
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
const eventsClient = reactive(useApi({
  key: () => `events:${preferences.value?.defaultPhaseId ?? 'none'}`,
  read: async (api) => {
    const phaseId = preferences.value?.defaultPhaseId
    return phaseId == null ? [] : api.api.event.get({ query: { phaseId } })
  },
  watch: true
}))

// 页面变量：响应式数据
const state = reactive({ headSpace: 16, barWidth: '' as number | '', hourPixels: '' as number | '', headerMinHeight: 112, endDate: '', pageActive: true })
const chart = ref<InstanceType<typeof TaskAttentionBar> | null>(null)

// 计算属性
const phase = computed(() => phasesClient.data?.find(value => value.id === preferences.value?.defaultPhaseId))
const today = computed(() => calendarDate(now.value ?? new Date(), timeZone.value))
const endDay = computed(() => state.endDate || phase.value?.endDate.toISOString().slice(0, 10) || addCalendarDays(today.value, 90))
const endDate = computed(() => new Date(`${endDay.value}T00:00:00.000Z`))
const hourPixels = computed(() => chart.value?.hourPixels ?? 4)
const barWidth = computed(() => chart.value?.barWidth ?? 0)

// 方法
async function readTasks() {
  await Promise.all([phasesClient.read(), tasksClient.read(), eventsClient.read()])
}
async function changeTask(...args: Parameters<ChangeTask>) {
  const task = await tasksClient.write(args)
  await readTasks()
  return task
}

// 监听
watchEffect(() => {
  if (state.pageActive) emit('page-data', { phases: phasesClient.data })
})

// 生命周期
onActivated(() => {
  state.pageActive = true
})
onDeactivated(() => {
  state.pageActive = false
})
</script>

<template>
  <main class="task-attention-test">
    <header class="task-attention-test__header">
      <div>
        <h1>TaskAttention 柱状图测试</h1>
        <p>{{ phase?.name ?? '未选择阶段' }} · {{ tasksClient.data?.length ?? 0 }} 项任务 · 左侧时间线 10%，右侧绘图区 90%</p>
      </div>
      <div class="task-attention-test__controls">
        <label>
          首空白 px
          <input
            v-model.number="state.headSpace"
            type="number"
            min="0"
            max="300"
            step="1"
          >
        </label>
        <label>
          柱条宽度 px
          <input
            v-model.number="state.barWidth"
            type="number"
            min="1"
            step="1"
            placeholder="自动"
          >
        </label>
        <label>
          每小时 px
          <input
            v-model.number="state.hourPixels"
            type="number"
            min="0.1"
            step="0.1"
            placeholder="自动"
          >
        </label>
        <label>
          标题内置阈值 px
          <input
            v-model.number="state.headerMinHeight"
            type="number"
            min="0"
            step="1"
          >
        </label>
        <label>
          阶段结束日期
          <input
            type="date"
            :value="endDay"
            @input="state.endDate = ($event.target as HTMLInputElement).value"
          >
        </label>
        <button
          class="button"
          type="button"
          :disabled="tasksClient.read.loading.value"
          @click="readTasks"
        >
          读取任务
        </button>
        <button
          class="button"
          type="button"
          @click="chart?.replayGrowth()"
        >
          重播生长
        </button>
        <span>当前比例 {{ hourPixels.toFixed(2) }} px/小时 · 柱宽 {{ barWidth.toFixed(1) }} px</span>
      </div>
    </header>
    <TaskAttentionBar
      v-if="phase"
      ref="chart"
      :phase-id="phase.id"
      class="task-attention-test__preview"
      :tasks="tasksClient.data ?? []"
      :end-date="endDate"
      :head-space="state.headSpace"
      :bar-width="typeof state.barWidth === 'number' ? state.barWidth : undefined"
      :hour-pixels="typeof state.hourPixels === 'number' ? state.hourPixels : undefined"
      :header-min-height="state.headerMinHeight"
      :events="eventsClient.data"
      :events-pending="eventsClient.read.loading.value"
      :refresh-events="eventsClient.read"
      :change-task="changeTask"
      @saved="readTasks"
      @deleted="readTasks"
    />
  </main>
</template>

<style scoped>
.task-attention-test {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 16px;
  height: var(--app-content-height, 100dvh);
  min-width: 0;
  padding: 20px;
}
.task-attention-test__header { display: grid; gap: 12px; }
.task-attention-test__header h1 { margin: 0; font-size: 20px; }
.task-attention-test__header p { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }
.task-attention-test__controls { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; }
.task-attention-test__controls label { display: grid; gap: 4px; font-size: 13px; }
.task-attention-test__controls input { width: 160px; padding: 6px 8px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--background-secondary); color: var(--text-primary); }
.task-attention-test__controls span { color: var(--text-secondary); font-size: 13px; }
.task-attention-test__preview { border: 1px solid var(--border-color); border-radius: 12px; background: var(--background-secondary); }
@media (max-width: 600px) {
  .task-attention-test { padding: 12px; }
  .task-attention-test__controls input { width: 136px; }
}
</style>
