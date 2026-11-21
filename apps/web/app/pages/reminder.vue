<script setup lang="ts">
// 导入
import { Capacitor } from '@capacitor/core'
import type { NativeBridge } from '~/api/native'
import type AppSidebar from '~/components/common/AppSidebar.vue'
import { planReminders } from '~/utils/reminders'

// 页面配置与类型
type ReminderStatus = Awaited<ReturnType<NativeBridge['getReminderStatus']>>
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()
useSeoMeta({ title: '提醒检查 · YuTD' })

// 系统变量读取
const { $native, $nativeCapabilities } = useNuxtApp()
const { preferences, loading: preferencesLoading } = useAppPeferences()
const { reportError } = useAppErrors()
const { timeZone } = useSystemTime()
const authToken = useCookie<string | null>('yutd-auth-token')
const android = Capacitor.getPlatform() === 'android'
const canInspect = !!$native && $nativeCapabilities?.features.includes('reminderStatus')

// API 读取
const phasesClient = reactive(useApi({ key: 'phases:all', read: api => api.api.phase.get() }))
const eventsClient = reactive(useApi({
  key: () => android ? `events:${preferences.value?.defaultPhaseId ?? 'none'}` : 'events:all',
  read: async (api) => {
    const phaseId = preferences.value?.defaultPhaseId
    if (!android) return api.api.event.get({ query: {} })
    return phaseId == null ? [] : api.api.event.get({ query: { phaseId } })
  },
  watch: true
}))
const tasksClient = android ? undefined : reactive(useApi({ key: 'tasks:all', read: api => api.api.task.get({ query: {} }) }))
const tipsClient = android ? undefined : reactive(useApi({ key: 'tips:all', read: api => api.api.tip.get({ query: {} }) }))

// 页面变量：普通变量
const sections = [
  { key: 'pending', label: '准备发送', empty: '暂无待发提醒' },
  { key: 'mounted', label: '已挂载', empty: '当前没有登记系统闹钟' },
  { key: 'sent', label: '已经发送', empty: '暂无发送记录' }
] as const
let polling: ReturnType<typeof setInterval> | undefined
let statusDirty = false

// 页面变量：响应式数据
const active = ref(false)
const selected = ref<typeof sections[number]['key']>('pending')
const status = shallowRef<ReminderStatus>()
const statusLoading = ref(false)
const statusFailed = ref(false)
const planFailed = ref(false)
const checkedAt = ref(Date.now())
const permission = useState('reminders:permission', () => ({ display: '', exact: '' }))

// 计算属性
const sidebarEvents = computed(() => android
  ? eventsClient.data
  : eventsClient.data?.filter(event => event.phaseId === preferences.value?.defaultPhaseId))
const preview = computed(() => {
  const p = preferences.value
  const phases = phasesClient.data
  const events = eventsClient.data
  const tasks = tasksClient?.data
  const tips = tipsClient?.data
  if (!p || !phases || !events || !tasks || !tips) return undefined
  return planReminders({ preferences: p, phases, events, tasks, tips }, new Date(checkedAt.value))
    .map(({ id, title, body, extra, schedule }) => ({ id, title, body, kind: extra.kind, at: schedule.at.getTime() }))
    .sort((a, b) => a.at - b.at || a.id - b.id)
})
const pending = computed(() => android ? status.value?.pending : preview.value)
const lists = computed(() => ({
  pending: pending.value,
  mounted: status.value && (status.value.mounted ? [status.value.mounted] : []),
  sent: status.value?.sent
}))
const currentSection = computed(() => sections.find(section => section.key === selected.value)!)
const rows = computed(() => lists.value[selected.value])
const busy = computed(() => android
  ? statusLoading.value
  : preferencesLoading.value || [phasesClient, eventsClient, tasksClient, tipsClient].some(client => client?.read.loading.value))
const format = computed(() => new Intl.DateTimeFormat('zh-CN', {
  timeZone: timeZone.value,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}))

// 方法
async function readStatus(showError = false) {
  if (!canInspect || !$native || statusLoading.value) return
  const token = authToken.value
  statusLoading.value = true
  try {
    const result = await $native.getReminderStatus({ authToken: token })
    if (token === authToken.value) {
      status.value = result
      statusFailed.value = false
      checkedAt.value = Date.now()
    }
  } catch (error) {
    if (token === authToken.value) {
      statusFailed.value = true
      if (showError) reportError(error, '读取系统提醒状态失败')
    }
  } finally {
    statusLoading.value = false
    if (statusDirty && active.value) {
      statusDirty = false
      readVisibleStatus()
    }
  }
}

async function refresh() {
  if (android) {
    await readStatus(true)
    return
  }
  const results = await Promise.allSettled([
    phasesClient.read(), eventsClient.read(), tasksClient?.read(), tipsClient?.read()
  ])
  planFailed.value = results.some(result => result.status === 'rejected')
  checkedAt.value = Date.now()
}

function readVisibleStatus() {
  if (document.visibilityState !== 'visible') return
  if (statusLoading.value) statusDirty = true
  else void readStatus()
}

function checkDueStatus() {
  const mounted = status.value?.mounted
  if (statusFailed.value || (mounted && mounted.at <= Date.now())) readVisibleStatus()
}

// 监听
watchEffect(() => {
  if (active.value) emit('page-data', {
    phases: phasesClient.data,
    events: sidebarEvents.value,
    eventsPending: eventsClient.read.loading.value,
    refreshEvents: eventsClient.read
  })
})

// 生命周期
onActivated(() => {
  active.value = true
  void refresh()
  if (android) void phasesClient.read().catch(() => {})
  if (canInspect) {
    document.addEventListener('visibilitychange', readVisibleStatus)
    window.addEventListener('yutd:reminders-synced', readVisibleStatus)
    polling = setInterval(checkDueStatus, 5000)
  }
})
onDeactivated(() => {
  active.value = false
  statusDirty = false
  document.removeEventListener('visibilitychange', readVisibleStatus)
  window.removeEventListener('yutd:reminders-synced', readVisibleStatus)
  clearInterval(polling)
})
</script>

<template>
  <main class="page-shell">
    <div class="page-container">
      <header class="page-heading panel-row">
        <div>
          <h1>提醒检查</h1>
          <p class="page-meta">
            {{ android ? '此设备的提醒状态' : '网页端提醒计划预览' }} · {{ timeZone }}
          </p>
        </div>
        <button
          class="button"
          type="button"
          :disabled="busy || (android && !canInspect)"
          @click="refresh"
        >
          刷新
        </button>
      </header>

      <PageCard class="reminder-panel">
        <div
          class="content-heading panel-row panel-row--inline"
          aria-label="提醒状态"
          role="group"
        >
          <button
            v-for="section in sections"
            :key="section.key"
            class="button"
            :class="{ 'button--primary': selected === section.key }"
            :aria-pressed="selected === section.key"
            type="button"
            @click="selected = section.key"
          >
            {{ section.label }} · {{ lists[section.key]?.length ?? '—' }}
          </button>
        </div>

        <div class="panel-stack panel-stack--compact">
          <p
            v-if="selected === 'mounted' && canInspect"
            class="muted"
          >
            Android 每次登记一个闹钟，触发后再登记下一批。
          </p>
          <p
            v-if="selected === 'sent' && canInspect"
            class="muted"
          >
            保留本设备最近 200 条提交给系统的通知，记录从支持提醒检查的版本开始。
          </p>
          <p
            v-if="statusFailed || planFailed"
            class="muted"
            role="status"
          >
            {{ rows ? '刷新失败，当前显示上次读取的结果。' : '读取失败，请点击刷新重试。' }}
          </p>
          <p
            v-else-if="android && !canInspect"
            class="muted"
          >
            {{ $native ? '请更新 Android 安装包以查看设备提醒状态。' : 'Android 提醒服务不可用。' }}
          </p>
          <p
            v-else-if="!android && selected !== 'pending'"
            class="muted"
          >
            请在 Android 应用查看系统闹钟和发送记录。
          </p>
          <p
            v-else-if="!android && !preferences && !busy"
            class="muted"
          >
            提醒偏好尚未载入，可重新打开应用后查看。
          </p>
          <p
            v-else-if="!rows"
            class="muted"
            role="status"
          >
            正在读取提醒……
          </p>
          <p
            v-else-if="!rows.length"
            class="muted"
          >
            <template v-if="selected === 'pending' && preferences && !preferences.enableReminder">
              提醒已关闭，可在<NuxtLink to="/setting">设置</NuxtLink>中开启。
            </template>
            <template v-else-if="selected === 'pending' && android && permission.display && permission.display !== 'granted'">
              系统通知权限未开启，可在<NuxtLink to="/setting">设置</NuxtLink>中授权。
            </template>
            <template v-else>
              {{ currentSection.empty }}
            </template>
          </p>

          <ul
            v-if="rows?.length"
            class="panel-stack panel-stack--compact"
          >
            <li
              v-for="row in rows"
              :key="'sentAt' in row ? `${row.id}:${row.sentAt}` : row.id"
              class="item-card"
            >
              <div class="panel-row">
                <h2 class="item-title">
                  {{ row.title }}
                </h2>
                <div class="badge-list">
                  <span
                    v-if="row.kind === 'event' || row.kind === 'task'"
                    class="badge"
                  >{{ row.kind === 'event' ? '课程' : '任务' }}</span>
                  <span
                    v-if="'exact' in row"
                    class="badge"
                    data-tone="info"
                  >{{ row.exact ? '精确闹钟' : '非精确闹钟' }}</span>
                  <span
                    v-else-if="selected === 'pending' && status?.mounted?.id === row.id"
                    class="badge"
                    data-tone="info"
                  >已挂载</span>
                  <span
                    v-if="android && selected === 'pending' && row.at <= checkedAt"
                    class="badge"
                    data-tone="warning"
                  >已到期</span>
                </div>
              </div>
              <p class="item-description">
                {{ row.body }}
              </p>
              <div class="badge-list muted">
                <span>计划 {{ format.format(row.at) }}</span>
                <span v-if="'sentAt' in row">发送 {{ format.format(row.sentAt) }}</span>
              </div>
            </li>
          </ul>
        </div>
      </PageCard>
    </div>
  </main>
</template>

<style scoped>
.reminder-panel {
  padding: clamp(12px, 2vw, 20px);
}
</style>
