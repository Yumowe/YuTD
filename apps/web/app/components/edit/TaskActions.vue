<script setup lang="ts">
import AppPopup from '../common/AppPopup.vue'
import { isTaskClosed } from '#shared/attention'

type Task = ApiData<Api['api']['task']['get']>[number]
type TaskChange = Pick<NonNullable<Parameters<ReturnType<Api['api']['task']>['patch']>[0]>, 'status' | 'isDone'>
  | NonNullable<Parameters<ReturnType<Api['api']['task']>['postpone']['patch']>[0]>

const props = withDefaults(defineProps<{
  /** 外部读取的任务状态，写入后由调用方更新。 */
  task: Pick<Task, 'id' | 'phaseId' | 'title' | 'completed' | 'status' | 'completedAt' | 'dueDate'>
  /** 是否同时显示延期和取消，关闭时仅保留完成按钮。 */
  extended?: boolean
  /** 外部读取或交互受限时禁用操作。 */
  disabled?: boolean
}>(), { extended: true, disabled: false })

const emit = defineEmits<{ change: [taskId: number] }>()

const { now, timeZone } = useSystemTime()
const { reportError } = useAppErrors()
const pendingTasks = useState<Record<number, boolean>>('tasks:completion-pending', () => ({}))
const previousStatuses = useState<Record<number, 'TODO' | 'DOING'>>('tasks:previous-statuses', () => ({}))
const client = useApi({
  key: () => `tasks:${props.task.phaseId}`,
  write: (api, [id, change]: [number, TaskChange]) => 'plannedDate' in change
    ? api.api.task({ id }).postpone.patch(change)
    : api.api.task({ id }).patch(change)
})

const completed = computed(() => isTaskClosed(props.task))
const pending = computed(() => Boolean(pendingTasks.value[props.task.id]))
const unavailable = computed(() => props.disabled || pending.value)
const timestamp = (value: Task['dueDate']) => value ? new Date(value).getTime() : NaN
const canPostpone = computed(() => props.extended && !completed.value && !(timestamp(props.task.dueDate) <= (now.value?.getTime() ?? Date.now())))
const canCancel = computed(() => props.extended && !completed.value)
const count = computed(() => 1 + Number(canPostpone.value) + Number(canCancel.value))
const completionLabel = computed(() => `${completed.value ? '恢复未完成' : '标记完成'}：${props.task.title}`)
const completionTitle = computed(() => props.task.completedAt
  ? `${completionLabel.value}\n${props.task.status === 'CANCELLED' ? '取消' : '完成'}时间：${formatLocalDateTime(props.task.completedAt, timeZone.value).replace('T', ' ')}`
  : completionLabel.value)

async function saveChange(id: number, change: TaskChange) {
  if (props.disabled || pendingTasks.value[id]) return
  pendingTasks.value[id] = true
  try {
    const saved = await client.write([id, change]).catch(() => undefined)
    if (saved) emit('change', saved.id)
    return saved
  } finally {
    Reflect.deleteProperty(pendingTasks.value, id)
  }
}

function rememberStatus() {
  previousStatuses.value[props.task.id] = props.task.status === 'DOING' ? 'DOING' : 'TODO'
}

function toggleCompleted() {
  if (unavailable.value) return
  const next = !completed.value
  if (next) rememberStatus()
  void saveChange(props.task.id, { isDone: next, status: next ? 'DONE' : previousStatuses.value[props.task.id] ?? 'TODO' })
}

function cancelTask() {
  if (unavailable.value || !canCancel.value) return
  rememberStatus()
  void saveChange(props.task.id, { status: 'CANCELLED', isDone: false })
}

const deferOpen = ref(false)
const deferDate = ref('')
const deferError = ref('')
const deferMinimum = computed(() => formatLocalDateTime((now.value?.getTime() ?? Date.now()) + 1000, timeZone.value))
const deferMaximum = computed(() => props.task.dueDate ? formatLocalDateTime(timestamp(props.task.dueDate) - 1, timeZone.value) : undefined)

function canDefer(date: Date) {
  return Number.isFinite(date.getTime()) && date.getTime() > (now.value?.getTime() ?? Date.now())
    && (!props.task.dueDate || date.getTime() < timestamp(props.task.dueDate))
}

const deferPresets = computed(() => {
  const current = now.value ?? new Date()
  const local = formatLocalDateTime(current, timeZone.value)
  const day = calendarDateKey(local)
  const nextDay = (days: number) => parseZonedDateTime(`${addCalendarDays(day, days)}${local.slice(10)}`, timeZone.value, 'compatible')
  const presets = [
    { label: '一小时后', date: new Date(current.getTime() + 3600000) },
    { label: '延期一天', date: nextDay(1) },
    { label: '延期三天', date: nextDay(3) }
  ]
  if (props.task.dueDate)
    presets.push({ label: '截止前一小时', date: new Date(timestamp(props.task.dueDate) - 3600000) })
  return presets.map(preset => ({ ...preset, disabled: !canDefer(preset.date) }))
})

function openDefer() {
  if (!canPostpone.value || unavailable.value) return
  deferError.value = ''
  const first = deferPresets.value.find(preset => !preset.disabled)
  const due = timestamp(props.task.dueDate)
  deferDate.value = first ? formatLocalDateTime(first.date, timeZone.value) : Number.isFinite(due) ? formatLocalDateTime(due - 1, timeZone.value) : ''
  deferOpen.value = true
}

function closeDefer() {
  deferOpen.value = false
}

async function saveDefer() {
  if (!deferOpen.value || unavailable.value) return
  let date: Date
  try {
    if (!deferDate.value) throw new Error('请选择延期时间')
    date = parseZonedDateTime(deferDate.value, timeZone.value)
    if (!canPostpone.value || !canDefer(date)) throw new Error('延期时间必须晚于当前时间，并早于截止时间')
  } catch (error) {
    deferError.value = error instanceof Error ? error.message : '延期时间无效'
    reportError(deferError.value, '延期任务')
    return
  }
  const taskId = props.task.id
  const saved = await saveChange(taskId, { plannedDate: date.toISOString() })
  if (props.task.id !== taskId) return
  if (saved) closeDefer()
  else deferError.value = '延期未保存，请检查截止时间后重试'
}

watch([() => props.task.id, timeZone, completed, () => props.extended, () => props.disabled], closeDefer)
onDeactivated(closeDefer)

defineExpose({ pending, count })
</script>

<template>
  <div class="task-actions">
    <button
      class="task-actions__button"
      type="button"
      :disabled="unavailable"
      :aria-pressed="completed"
      :aria-label="completionLabel"
      :title="completionTitle"
      @click.stop="toggleCompleted"
    >
      <Icon
        :name="task.status === 'CANCELLED' ? 'lucide:x' : completed ? 'lucide:check' : 'lucide:circle'"
        aria-hidden="true"
      />
    </button>
    <button
      v-if="canPostpone"
      class="task-actions__button"
      type="button"
      :disabled="unavailable"
      :aria-label="`延期：${task.title}`"
      title="选择延期时间"
      @click.stop="openDefer"
    >
      <Icon
        name="lucide:calendar-clock"
        aria-hidden="true"
      />
    </button>
    <button
      v-if="canCancel"
      class="task-actions__button"
      type="button"
      :disabled="unavailable"
      :aria-label="`取消任务：${task.title}`"
      title="取消任务"
      @click.stop="cancelTask"
    >
      <Icon
        name="lucide:x"
        aria-hidden="true"
      />
    </button>
    <AppPopup
      v-if="extended"
      v-model:open="deferOpen"
      class="task-actions__dialog"
      :dismissible="!pending"
      :aria-label="`延期：${task.title}`"
      @click.stop
      @pointerdown.stop
      @wheel.stop
    >
      <form
        class="task-actions__defer-form"
        @submit.prevent="saveDefer"
      >
        <strong>延期：{{ task.title }}</strong>
        <p class="muted">
          {{ timeZone }} · {{ task.dueDate ? '请选择截止之前的时间' : '此任务未设置截止时间' }}
        </p>
        <div class="task-actions__presets">
          <button
            v-for="preset in deferPresets"
            :key="preset.label"
            class="button"
            type="button"
            :disabled="preset.disabled || unavailable"
            @click="deferDate = formatLocalDateTime(preset.date, timeZone); deferError = ''"
          >
            {{ preset.label }}
          </button>
        </div>
        <label class="task-actions__date-field">
          延期至
          <input
            v-model="deferDate"
            type="datetime-local"
            step="1"
            :min="deferMinimum"
            :max="deferMaximum"
            :disabled="unavailable"
            required
          >
        </label>
        <p
          v-if="deferError"
          role="alert"
          class="task-actions__defer-error"
        >
          {{ deferError }}
        </p>
        <div class="task-actions__dialog-actions">
          <button
            class="button"
            type="button"
            :disabled="unavailable"
            @click="closeDefer"
          >
            取消
          </button>
          <button
            class="button"
            type="submit"
            :disabled="unavailable"
          >
            {{ pending ? '保存中……' : '确定延期' }}
          </button>
        </div>
      </form>
    </AppPopup>
  </div>
</template>

<style scoped>
.task-actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--task-action-gap, 3px);
  pointer-events: auto;
}
.task-actions__button {
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
  display: grid;
  flex: none;
  place-items: center;
  width: var(--task-action-size, 24px);
  height: var(--task-action-size, 24px);
  padding: 0;
  border: 1px solid var(--task-action-border, var(--border-color));
  border-radius: 50%;
  color: var(--task-action-color, var(--text-secondary));
  background: var(--task-action-background, var(--background-secondary));
  font: inherit;
  font-size: var(--task-action-font-size, 14px);
  opacity: var(--task-action-opacity, 1);
  cursor: pointer;
}
.task-actions__button[aria-pressed='true'] {
  border-color: var(--task-action-active-background, var(--accent-color));
  color: var(--background-secondary);
  background: var(--task-action-active-background, var(--accent-color));
}
.task-actions__button:disabled { opacity: .5; cursor: wait; }
.task-actions__button:not(:disabled):hover,
.task-actions__button:focus-visible { opacity: 1; }
.task-actions__dialog { --popup-width: 460px; padding: 22px; }
.task-actions__defer-form { display: grid; gap: 14px; }
.task-actions__defer-form p { margin: 0; font-size: 13px; }
.task-actions__presets,
.task-actions__dialog-actions { display: flex; flex-wrap: wrap; gap: 7px; }
.task-actions__dialog-actions { justify-content: flex-end; }
.task-actions__date-field { display: grid; gap: 6px; }
.task-actions__date-field input { min-width: 0; padding: 9px; border: 1px solid var(--text-secondary); border-radius: 8px; background: var(--background-primary); color: var(--text-primary); }
.task-actions__defer-error { color: #ef4444; }
</style>
