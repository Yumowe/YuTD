<script setup lang="ts">
// 导入
import type AppSidebar from '~/components/common/AppSidebar.vue'
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'
import TaskAttentionBar from '~/components/preview/Task/TaskAttentionBar.vue'

// 页面配置与类型
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()

// 系统变量读取
const { now, timeZone } = useSystemTime()
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
const dailyTipsClient = reactive(useApi({
  key: () => `dailytips:v2:${preferences.value?.defaultPhaseId ?? 'all'}:${now.value ? calendarDate(now.value, timeZone.value) : 'pending'}:${timeZone.value}`,
  read: async (api) => {
    const phase = preferences.value?.defaultPhaseId
    const date = now.value ? calendarDate(now.value, timeZone.value) : ''
    return phase == null || !date ? null : api.api.dailytips.get({ query: { phase, date } })
  },
  watch: true
}))

// 页面变量：普通变量
let activated = false

// 页面变量：响应式数据
const state = reactive({ pageActive: true })

// 计算属性
const tipTasks = computed(() => dailyTipsClient.data?.tasks.map(task => tasksClient.data?.find(value => value.id === task.id) ?? task))
const phases = computed(() => phasesClient.data)
const phase = computed(() => phaseClient.data)
const selectedPhaseId = computed(() => preferences.value?.defaultPhaseId ?? null)
const loading = computed(() => preferencesLoading.value || phaseClient.read.loading.value)
const displayedDay = computed(() => now.value ? calendarDate(now.value, timeZone.value) : null)
const displayedWeekdays = computed(() => displayedDay.value
  ? [calendarWeekday(displayedDay.value), calendarWeekday(addCalendarDays(displayedDay.value, 1))]
  : [])

// 方法
async function refreshContent() {
  await Promise.all([
    phasesClient.read(),
    eventsClient.read(),
    tasksClient.read(),
    phaseClient.read(),
    dailyTipsClient.read()
  ])
}

async function changeTask(...args: Parameters<ChangeTask>) {
  const task = await tasksClient.write(args)
  await refreshContent()
  return task
}

// 监听
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
  <main class="home-page">
    <PageCard
      v-if="!phase || phase.id !== selectedPhaseId"
      class="home-page__state"
      width="100%"
      height="100%"
    >
      <p
        v-if="loading"
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
      <div
        v-else
        class="page-state"
      >
        <p>阶段尚未载入。</p>
      </div>
    </PageCard>
    <div
      v-else-if="phase && phase.id === selectedPhaseId"
      class="home-page__layout"
    >
      <PageCard
        class="home-page__schedule"
        width="100%"
        height="100%"
        aria-label="课程表"
      >
        <ScheduleTable
          v-if="displayedWeekdays.length"
          :key="phase.id"
          :events="eventsClient.data"
          :tasks="tasksClient.data"
          :events-pending="eventsClient.read.loading.value"
          :refresh-events="eventsClient.read"
          :refresh-content="refreshContent"
          :change-task="changeTask"
          :phase="phase"
          mode="custom"
          background-key="home:schedule"
          :weekdays="displayedWeekdays"
          auto-center
        />
        <p
          v-else
          class="page-state"
          role="status"
        >
          正在确认日期……
        </p>
      </PageCard>
      <PageCard
        class="home-page__tasks"
        width="100%"
        height="100%"
        aria-label="任务"
      >
        <TaskAttentionBar
          :key="phase.id"
          :phase-id="phase.id"
          :events="eventsClient.data"
          :tasks="tasksClient.data ?? []"
          :events-pending="eventsClient.read.loading.value"
          :refresh-events="eventsClient.read"
          :change-task="changeTask"
          :end-date="phase.endDate"
          @saved="refreshContent"
          @deleted="refreshContent"
        />
      </PageCard>
      <PageCard
        class="home-page__sentence"
        width="100%"
        height="100%"
        aria-label="每日一句"
      />
      <PageCard
        class="home-page__tips"
        width="100%"
        height="100%"
        aria-label="每日提示"
      >
        <DailyTips
          :tips="dailyTipsClient.data?.tips"
          :occurrences="dailyTipsClient.data?.occurrences"
          :snapshot-date="dailyTipsClient.data?.date"
          :pending="dailyTipsClient.read.loading.value"
          :tasks="tipTasks"
          :phase-id="phase.id"
          @refresh="dailyTipsClient.read()"
        />
      </PageCard>
    </div>
  </main>
</template>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  height: var(--app-content-height);
  min-width: 0;
  padding: 7px;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 8% 8%, color-mix(in srgb, var(--text-secondary) 12%, transparent), transparent 55%),
    radial-gradient(ellipse at 95% 85%, color-mix(in srgb, var(--background-secondary) 65%, transparent), transparent 50%),
    var(--background-primary);
}

.home-page__layout {
  display: grid;
  width: 100%;
  flex: 1;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(0, 7fr) minmax(0, 13fr);
  grid-template-rows: minmax(0, 7fr) minmax(0, 1fr) minmax(0, 2fr);
  grid-template-areas:
    'schedule tasks'
    'schedule sentence'
    'schedule tips';
  gap: 7px;
}
.home-page__state { flex: 1; }

.home-page__schedule {
  grid-area: schedule;
}

.home-page__tasks {
  grid-area: tasks;
}

.home-page__sentence {
  grid-area: sentence;
}

.home-page__tips {
  grid-area: tips;
}

@media (width < 480px) {
  .home-page {
    gap: 0;
    padding: 0;
  }

  .home-page__layout {
    grid-template-columns: minmax(0, 4fr) minmax(0, 6fr);
    gap: 0;
  }

  .home-page__schedule {
    padding: 0;
  }
}
</style>
