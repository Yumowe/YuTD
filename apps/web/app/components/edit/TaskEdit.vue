<script setup lang="ts">
import DatePicker from '../common/DatePicker.vue'
import TimePicker from '../common/TimePicker.vue'
import WeekPicker from '../common/WeekPicker.vue'
import { calendarDateKey, endOfCalendarDay, formatLocalDateTime, parseZonedDateTime } from '~/utils/date'

export type EditableTask = ApiData<Api['api']['task']['get']>[number]

const props = withDefaults(defineProps<{
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 手动重试读取课程数据。 */
  refreshEvents?: () => Promise<unknown>
  /** 已有任务；为空时新建。 */
  task?: EditableTask | null
  /** 所属阶段 ID。 */
  phaseId: number
  /** 阶段日期范围，用于显示阶段内周次。 */
  phase?: Pick<ApiData<Api['api']['phase']['get']>[number], 'startDate' | 'endDate'>
  /** 关联事件 ID。 */
  eventId?: number
  /** 新建任务默认使用的日期。 */
  date?: string
  /** 是否显示继续新建的入口。 */
  allowNew?: boolean
}>(), { allowNew: true })

const emit = defineEmits<{ saved: [task: EditableTask], new: [], deleted: [taskId: EditableTask['id']] }>()

const { timeZone } = useSystemTime()

const activeTask = shallowRef<EditableTask | null>(null)

const form = reactive({ title: '', description: '', priority: 3, dueDate: '', plannedDate: '', eventId: null as number | null,
  status: 'TODO' as EditableTask['status'], tags: '', reminderTimes: [] as string[] })

const newTips = ref<string[]>([])

const revision = ref(0)
const detailsOpen = ref(false)
const unselectedTime = ref('24:00')
const dueTime = computed({
  get: () => form.dueDate.slice(11, 16) || unselectedTime.value,
  set: (time: string) => {
    if (form.dueDate) form.dueDate = `${calendarDateKey(form.dueDate)}T${time}`
    else unselectedTime.value = time
  }
})

function localDueDate(date: Date) {
  const value = formatLocalDateTime(date, timeZone.value)
  if (date.getMilliseconds() !== 999) return value
  const day = calendarDateKey(value)
  return date.getTime() === endOfCalendarDay(day, timeZone.value).getTime() ? `${day}T24:00` : value
}

const originalDueDate = computed(() => activeTask.value?.dueDate ? localDueDate(activeTask.value.dueDate) : '')

function dueInstant() {
  const current = activeTask.value?.dueDate
  if (current && form.dueDate === originalDueDate.value) return current
  if (form.dueDate.endsWith('T24:00')) {
    const day = calendarDateKey(form.dueDate)
    // 日终仍属于所选日期，任务按日查询使用半开区间。
    return endOfCalendarDay(day, timeZone.value)
  }
  return parseZonedDateTime(form.dueDate, timeZone.value)
}

function loadTask(task: EditableTask | null) {
  revision.value++
  saving.value = false
  deleteCandidate.value = false
  detailsOpen.value = false
  unselectedTime.value = '24:00'
  activeTask.value = task
  newTips.value = []
  error.value = ''
  Object.assign(form, {
    title: task?.title ?? '', description: task?.description ?? '', priority: task?.priority ?? 3,
    dueDate: task ? originalDueDate.value : props.date ? `${props.date}T24:00` : '',
    eventId: task ? task.eventId : props.eventId ?? null,
    plannedDate: task?.plannedDate ? formatLocalDateTime(task.plannedDate, timeZone.value) : '',
    status: task?.status ?? 'TODO', tags: task?.tags.map(tag => tag.name).join(', ') ?? '',
    reminderTimes: task?.reminders.map(reminder => formatLocalDateTime(reminder.time, timeZone.value)) ?? []
  })
}

const events = computed(() => props.events)

const eventsPending = computed(() => props.eventsPending)

const eventsError = computed(() => (!props.eventsPending && props.events === undefined))

const selectedEvent = computed(() => events.value?.find(event => event.id === form.eventId) ?? (activeTask.value?.eventId === form.eventId ? activeTask.value?.event : null))

const planMaximum = computed(() => {
  if (!form.dueDate) return undefined
  try {
    return formatLocalDateTime(Math.ceil(dueInstant().getTime() / 1000) * 1000 - 1000, timeZone.value)
  } catch {
    return undefined
  }
})

function taskData() {
  const title = form.title.trim()
  if (!title) throw new Error('请输入任务名称')
  if (newTips.value.some(content => !content.trim())) throw new Error('请输入提示内容，或删除空白提示')
  if (!Number.isInteger(form.priority) || form.priority < 1 || form.priority > 5) throw new Error('优先级必须为 1 至 5 的整数')
  if (!form.dueDate) throw new Error('请选择截止时间')
  const due = dueInstant()
  const plannedDate = form.plannedDate ? parseZonedDateTime(form.plannedDate, timeZone.value) : null
  if (plannedDate && plannedDate >= due) throw new Error('计划时间必须早于截止时间')
  if (form.eventId !== null && !selectedEvent.value) throw new Error('请选择当前阶段的有效事件')
  return {
    title, description: form.description.trim(), priority: form.priority, status: form.status,
    dueDate: due.toISOString(), plannedDate: plannedDate?.toISOString() ?? null, eventId: form.eventId,
    tags: [...new Set(form.tags.split(/[,，\r\n]+/).map(name => name.trim()).filter(Boolean))],
    reminderTimes: [...new Set(form.reminderTimes.map(value => parseZonedDateTime(value, timeZone.value).getTime()))]
      .map(time => new Date(time))
  }
}

const client = reactive(useApi({
  key: () => `tasks:${props.phaseId}`,
  write: (api, data: ReturnType<typeof taskData>) => activeTask.value
    ? api.api.task({ id: activeTask.value.id }).patch(data)
    : api.api.task.post({ ...data, phaseId: props.phaseId, plannedDate: data.plannedDate ?? undefined, eventId: data.eventId ?? undefined })
}))

const tipClient = reactive(useApi({
  key: () => `tips:tasks:${props.phaseId}`,
  write: (api, data: Parameters<Api['api']['tip']['post']>[0]) => api.api.tip.post(data)
}))

const deleteClient = reactive(useApi({
  key: () => `tasks:${props.phaseId}`,
  write: (api, id: EditableTask['id']) => api.api.task({ id }).delete()
}))

const saving = ref(false)

const deleteCandidate = ref(false)

const error = ref('')

const element = ref<HTMLElement | null>(null)

watch([() => props.task, () => props.phaseId, () => props.eventId, () => props.date], ([task, phaseId, eventId, date], previous) => {
  if (previous && phaseId === previous[1] && eventId === previous[2] && date === previous[3] && task?.id === activeTask.value?.id) return
  loadTask(task ?? null)
}, { immediate: true })

const refreshEvents = () => props.refreshEvents?.()

function showInvalidDetails(event: Event) {
  const panel = event.currentTarget as HTMLDetailsElement
  panel.open = true
  detailsOpen.value = true
}

async function removeTask() {
  if (!activeTask.value || saving.value) return
  if (!deleteCandidate.value) {
    deleteCandidate.value = true
    return
  }
  const id = activeTask.value.id
  const current = revision.value
  saving.value = true
  try {
    await deleteClient.write(id)
    if (current !== revision.value) return
    loadTask(null)
    emit('deleted', id)
  } catch {
    return
  } finally {
    if (current === revision.value) saving.value = false
  }
}

async function save() {
  if (saving.value) return
  const current = revision.value
  error.value = ''
  try {
    const data = taskData()
    saving.value = true
    let task = await client.write(data)
    if (current !== revision.value) return
    activeTask.value = task
    while (newTips.value.length) {
      const tip = await tipClient.write({ content: newTips.value[0]!.trim(), taskIds: [task.id] })
      if (current !== revision.value) return
      newTips.value.shift()
      task = { ...task, tips: [...task.tips, tip] }
      activeTask.value = task
    }
    loadTask(task)
    emit('saved', task)
  } catch (cause) {
    if (current === revision.value) error.value = cause instanceof Error ? cause.message : '保存任务失败，请重试。'
  } finally {
    if (current === revision.value) saving.value = false
  }
}

function startNew() {
  loadTask(null)
  emit('new')
}

defineExpose({ saving, focus: () => element.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }) })
</script>

<template>
  <section
    ref="element"
    class="edit-task item-card"
    :data-details-open="detailsOpen"
  >
    <form
      class="panel-stack"
      @submit.prevent="save"
    >
      <fieldset
        class="panel-stack"
        :disabled="saving"
      >
        <label class="form-field">
          <span>任务名称</span>
          <input
            v-model="form.title"
            class="form-control"
            placeholder="例如：完成本周作业"
            required
          >
        </label>
        <DatePicker
          :key="revision"
          v-model="form.dueDate"
          :initial-date="originalDueDate"
          :phase="phase"
          :default-time="dueTime"
          :disabled="saving"
        />
        <TimePicker
          v-model="dueTime"
          class="edit-task__time"
          aria-label="截止时间"
          :drag-area="detailsOpen ? null : element"
          :disabled="saving"
        />

        <details
          class="edit-task__details"
          :open="detailsOpen"
          @invalid.capture="showInvalidDetails"
        >
          <summary @click.prevent="detailsOpen = !detailsOpen">
            详情
          </summary>
          <div class="panel-stack">
            <label class="form-field">
              <span>描述</span>
              <textarea
                v-model="form.description"
                class="form-control"
                rows="3"
                placeholder="选填"
              />
            </label>
            <div class="form-grid">
              <div class="form-field">
                <span>优先级 · {{ form.priority }}</span>
                <WeekPicker
                  :count="5"
                  :model-value="[form.priority]"
                  selectable
                  exclusive
                  aria-label="任务优先级"
                  @update:model-value="form.priority = $event[0] ?? 3"
                />
              </div>
              <label class="form-field">
                <span>状态</span>
                <select
                  v-model="form.status"
                  class="form-control"
                >
                  <option value="TODO">待办</option>
                  <option value="DOING">进行中</option>
                  <option value="DONE">已完成</option>
                  <option value="CANCELLED">已取消</option>
                </select>
              </label>
            </div>
            <label class="form-field">
              <span>关联事件</span>
              <select
                v-model="form.eventId"
                class="form-control"
                :disabled="eventsPending && !events"
              >
                <option :value="null">不关联事件</option>
                <option
                  v-for="event in events"
                  :key="event.id"
                  :value="event.id"
                >{{ event.name }}</option>
                <option
                  v-if="form.eventId && selectedEvent && !events?.some(event => event.id === form.eventId)"
                  :value="form.eventId"
                >{{ selectedEvent.name }}</option>
              </select>
            </label>
            <div
              v-if="eventsError"
              class="edit-task__event-error"
              role="alert"
            >
              <span>关联事件加载失败。</span>
              <button
                v-if="props.refreshEvents"
                type="button"
                class="button"
                @click="refreshEvents()"
              >
                重试
              </button>
            </div>
            <label class="form-field">
              <span>计划时间 · {{ timeZone }} · 选填，需早于截止时间</span>
              <input
                v-model="form.plannedDate"
                class="form-control"
                type="datetime-local"
                step="1"
                :max="planMaximum"
              >
            </label>
            <div class="form-field">
              <span>提醒时间 · {{ timeZone }}</span>
              <div
                v-for="(_, index) in form.reminderTimes"
                :key="index"
                class="edit-task__reminder"
              >
                <input
                  v-model="form.reminderTimes[index]"
                  class="form-control"
                  type="datetime-local"
                  step="1"
                  :aria-label="`任务提醒时间 ${index + 1}`"
                  required
                >
                <button
                  class="button"
                  type="button"
                  :aria-label="`删除提醒时间 ${index + 1}`"
                  @click="form.reminderTimes.splice(index, 1)"
                >
                  删除
                </button>
              </div>
              <button
                class="button"
                type="button"
                @click="form.reminderTimes.push('')"
              >
                添加提醒时间
              </button>
            </div>
            <label class="form-field">
              <span>标签</span>
              <input
                v-model="form.tags"
                class="form-control"
                placeholder="选填，用逗号分隔"
              >
            </label>
            <div class="form-field">
              <span>提示（选填）</span>
              <ul v-if="activeTask?.tips.length">
                <li
                  v-for="tip in activeTask.tips"
                  :key="tip.id"
                >
                  {{ tip.content }}
                </li>
              </ul>
              <div
                v-for="(_, index) in newTips"
                :key="index"
                class="panel-stack panel-stack--compact"
              >
                <textarea
                  v-model="newTips[index]"
                  class="form-control"
                  :aria-label="`任务提示 ${index + 1}`"
                  rows="2"
                  placeholder="输入提示内容"
                  required
                />
                <button
                  class="button"
                  type="button"
                  @click="newTips.splice(index, 1)"
                >
                  删除这条提示
                </button>
              </div>
              <button
                class="button"
                type="button"
                @click="newTips.push('')"
              >
                添加提示
              </button>
            </div>
            <div
              v-if="activeTask"
              class="panel-row panel-row--inline"
            >
              <button
                class="button button--danger"
                type="button"
                @click="removeTask"
              >
                {{ deleteClient.write.saving.value ? '正在删除……' : deleteCandidate ? '确认删除任务' : '删除任务' }}
              </button>
              <button
                v-if="deleteCandidate"
                class="button"
                type="button"
                @click="deleteCandidate = false"
              >
                取消
              </button>
              <button
                v-if="allowNew"
                class="button"
                type="button"
                @click="startNew"
              >
                新建任务
              </button>
            </div>
          </div>
        </details>
      </fieldset>
      <p
        v-if="error"
        role="alert"
        class="edit-task__error"
      >
        {{ error }}
      </p>
      <button
        type="submit"
        class="button button--primary edit-task__submit"
        :disabled="saving"
      >
        {{ saving ? '正在保存……' : activeTask ? '保存任务' : '创建任务' }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.edit-task {
  --task-time-gutter: clamp(2rem, 8vw, 2.625rem);
  position: relative;
  min-width: 0;
  overflow: clip;
  padding-inline-start: var(--task-time-gutter);
  scroll-margin-top: 16px;
}

.edit-task[data-details-open='false'] {
  touch-action: none;
}

.edit-task__time {
  margin-inline-start: calc(-1 * var(--task-time-gutter));
  margin-inline-end: calc(-1 * var(--task-editor-end-gap, 16px));
}

.edit-task__details > summary {
  width: fit-content;
  color: var(--text-primary);
  cursor: pointer;
}

.edit-task__details[open] > summary {
  margin-bottom: 12px;
}

.edit-task__event-error {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.edit-task__reminder {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.edit-task__reminder .form-control {
  flex: 1;
  min-width: 0;
}

.edit-task__reminder .button {
  flex: none;
}

.edit-task__error {
  margin: 0;
  font-size: 13px;
}

.edit-task__submit {
  justify-self: end;
}
</style>
