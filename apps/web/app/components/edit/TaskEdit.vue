<script setup lang="ts">
import TaskBlock, { type TaskBlockData } from '../preview/Task/TaskBlock.vue'
import WeekPicker from '../common/WeekPicker.vue'
import Background from '../image/BackgroundLayout.vue'
import BackgroundSelect, { type BackgroundSelection } from '../image/BackgroundSelect.vue'
import { CardStyleKey } from '../preview/card/cardMaterial'
import { calendarDate, clockParts, parseZonedDateTime } from '~/utils/date'

export type EditableTask = ApiData<Api['api']['task']['get']>[number]

const props = withDefaults(defineProps<{
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 重新读取课程数据。 */
  refreshEvents: () => Promise<unknown>
  /** 已有任务；为空时新建。 */
  task?: EditableTask | null
  /** 所属阶段 ID。 */
  phaseId: number
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

let revision = 0

function localDateTime(date: Date) {
  const parts = clockParts(date, timeZone.value)
  return `${calendarDate(date, timeZone.value)}T${[parts.hour, parts.minute, parts.second].map(value => String(value).padStart(2, '0')).join(':')}`
}

function loadTask(task: EditableTask | null) {
  revision++
  saving.value = false
  deleteCandidate.value = false
  activeTask.value = task
  newTips.value = []
  error.value = ''
  Object.assign(form, {
    title: task?.title ?? '', description: task?.description ?? '', priority: task?.priority ?? 3,
    dueDate: task ? task.dueDate ? localDateTime(task.dueDate) : '' : props.date ? `${props.date}T23:59:00` : '', eventId: task ? task.eventId : props.eventId ?? null,
    plannedDate: task?.plannedDate ? localDateTime(task.plannedDate) : '',
    status: task?.status ?? 'TODO', tags: task?.tags.map(tag => tag.name).join(', ') ?? '',
    reminderTimes: task?.reminders.map(reminder => localDateTime(reminder.time)) ?? []
  })
}

const events = computed(() => props.events)

const eventsPending = computed(() => props.eventsPending)

const eventsError = computed(() => (!props.eventsPending && props.events === undefined))

const selectedEvent = computed(() => events.value?.find(event => event.id === form.eventId) ?? (activeTask.value?.eventId === form.eventId ? activeTask.value?.event : null))

function previewDate(value: string) {
  if (!value) return null
  try {
    return parseZonedDateTime(value, timeZone.value)
  } catch {
    return null
  }
}

const preview = computed<TaskBlockData>(() => ({
  id: activeTask.value?.id ?? 0, phaseId: props.phaseId, title: form.title || '新建任务', description: form.description,
  priority: form.priority, status: form.status, completed: form.status === 'DONE', completedAt: activeTask.value?.completedAt ?? null,
  event: selectedEvent.value ?? null, dueDate: previewDate(form.dueDate),
  plannedDate: previewDate(form.plannedDate),
  tags: form.tags.split(/[,，\r\n]+/).map(name => name.trim()).filter(Boolean).map(name => ({ name })),
  tips: activeTask.value?.tips ?? []
}))

const planMaximum = computed(() => {
  const due = previewDate(form.dueDate)
  return due ? localDateTime(new Date(due.getTime() - 1000)) : undefined
})

function taskData() {
  const title = form.title.trim()
  if (!title) throw new Error('请输入任务名称')
  if (newTips.value.some(content => !content.trim())) throw new Error('请输入提示内容，或删除空白提示')
  if (!Number.isInteger(form.priority) || form.priority < 1 || form.priority > 5) throw new Error('优先级必须为 1 至 5 的整数')
  if (!form.dueDate) throw new Error('请选择截止时间')
  const due = parseZonedDateTime(form.dueDate, timeZone.value)
  const plannedDate = form.plannedDate ? parseZonedDateTime(form.plannedDate, timeZone.value) : null
  if (plannedDate && plannedDate >= due) throw new Error('计划时间必须早于截止时间')
  if (form.eventId !== null && !selectedEvent.value) throw new Error('请选择当前阶段的有效事件')
  return {
    title, description: form.description.trim(), priority: form.priority, status: form.status,
    dueDate: due.toISOString(), plannedDate: plannedDate?.toISOString() ?? null, eventId: form.eventId,
    tags: [...new Set(preview.value.tags.map(tag => tag.name))],
    reminderTimes: [...new Set(form.reminderTimes.map(value => parseZonedDateTime(value, timeZone.value).getTime()))]
      .map(time => new Date(time))
  }
}

const client = reactive(useApi({
  key: 'task:save',
  write: (api, data: ReturnType<typeof taskData>) => activeTask.value
    ? api.api.task({ id: activeTask.value.id }).patch(data)
    : api.api.task.post({ ...data, phaseId: props.phaseId, plannedDate: data.plannedDate ?? undefined, eventId: data.eventId ?? undefined })
}))

const tipClient = reactive(useApi({
  key: 'task:tips:save',
  write: (api, data: Parameters<Api['api']['tip']['post']>[0]) => api.api.tip.post(data)
}))

const deleteClient = reactive(useApi({
  key: 'task:delete',
  write: (api, id: EditableTask['id']) => api.api.task({ id }).delete()
}))

const theme = inject(CardStyleKey, undefined)

const fancy = computed(() => theme?.value.showMode === 1)

const backgroundSelection = shallowRef<BackgroundSelection | null>(null)

const backgroundPending = ref(true)

const saving = ref(false)

const deleteCandidate = ref(false)

const error = ref('')

const element = ref<HTMLElement | null>(null)

watch([fancy, () => props.phaseId], () => {
  backgroundSelection.value = null
  backgroundPending.value = true
})

watch([() => props.task, () => props.phaseId, () => props.eventId, () => props.date], ([task, phaseId, eventId, date], previous) => {
  if (previous && phaseId === previous[1] && eventId === previous[2] && date === previous[3] && task?.id === activeTask.value?.id) return
  loadTask(task ?? null)
}, { immediate: true })

const refreshEvents = () => props.refreshEvents()

async function removeTask() {
  if (!activeTask.value || saving.value) return
  if (!deleteCandidate.value) {
    deleteCandidate.value = true
    return
  }
  const id = activeTask.value.id
  const current = revision
  saving.value = true
  try {
    await deleteClient.write(id)
    if (current !== revision) return
    loadTask(null)
    emit('deleted', id)
  } catch {
    return
  } finally {
    if (current === revision) saving.value = false
  }
}

async function save() {
  if (saving.value) return
  const current = revision
  error.value = ''
  try {
    const data = taskData()
    saving.value = true
    let task = await client.write(data)
    if (current !== revision) return
    activeTask.value = task
    while (newTips.value.length) {
      const tip = await tipClient.write({ content: newTips.value[0]!.trim(), taskIds: [task.id] })
      if (current !== revision) return
      newTips.value.shift()
      task = { ...task, tips: [...task.tips, tip] }
      activeTask.value = task
    }
    loadTask(task)
    emit('saved', task)
  } catch (cause) {
    if (current === revision) error.value = cause instanceof Error ? cause.message : '保存任务失败，请重试。'
  } finally {
    if (current === revision) saving.value = false
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
    :class="{ 'edit-task--fancy': fancy }"
  >
    <header class="edit-task__heading">
      <h2 class="panel-title">
        {{ activeTask ? '编辑任务' : '新建任务' }}
      </h2>
      <div class="edit-task__heading-actions">
        <template v-if="activeTask">
          <button
            class="button edit-task__delete"
            type="button"
            :disabled="saving"
            @click="removeTask"
          >
            {{ deleteClient.write.saving.value ? '正在删除……' : deleteCandidate ? '确认删除任务' : '删除任务' }}
          </button>
          <button
            v-if="deleteCandidate"
            class="button"
            type="button"
            :disabled="saving"
            @click="deleteCandidate = false"
          >
            取消
          </button>
        </template>
        <button
          v-if="activeTask && allowNew"
          class="button"
          type="button"
          :disabled="saving"
          @click="startNew"
        >
          新建任务
        </button>
      </div>
    </header>
    <div
      v-if="fancy"
      hidden
    >
      <BackgroundSelect
        :key="phaseId"
        :background-key="`schedule:${phaseId}`"
        @change="backgroundSelection = $event"
        @loading-change="backgroundPending = $event"
      />
    </div>
    <Background
      class="edit-task__background"
      :pending="fancy && backgroundPending"
      :image="fancy ? backgroundSelection?.image ?? '' : ''"
      :position="fancy ? backgroundSelection?.position : undefined"
      :simplified-image="fancy ? backgroundSelection?.simplifiedImage : undefined"
      :analysis="fancy ? backgroundSelection?.analysis : undefined"
    >
      <TaskBlock
        :task="preview"
        :detail="3"
        :interactive="false"
        class="edit-task__block"
      >
        <template #default="{ textColor }">
          <form
            class="edit-task__form panel-stack"
            :style="{ color: textColor }"
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
                  aria-label="任务名称"
                  placeholder="例如：完成本周作业"
                  required
                >
              </label>
              <label class="form-field">
                <span>描述</span>
                <textarea
                  v-model="form.description"
                  class="form-control"
                  aria-label="任务描述"
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
                    :color="textColor"
                    aria-label="任务优先级"
                    @update:model-value="form.priority = $event[0] ?? 3"
                  />
                </div>
                <label class="form-field">
                  <span>状态</span>
                  <select
                    v-model="form.status"
                    class="form-control"
                    aria-label="任务状态"
                  >
                    <option value="TODO">待办</option><option value="DOING">进行中</option><option value="DONE">已完成</option><option value="CANCELLED">已取消</option>
                  </select>
                </label>
              </div>
              <label class="form-field">
                <span>关联事件</span>
                <select
                  v-model="form.eventId"
                  class="form-control"
                  aria-label="任务关联事件"
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
                <span>关联事件加载失败。</span><button
                  type="button"
                  class="button"
                  @click="refreshEvents()"
                >
                  重试
                </button>
              </div>
              <label class="form-field">
                <span>截止时间 · {{ timeZone }} · 必填</span>
                <input
                  v-model="form.dueDate"
                  class="form-control"
                  type="datetime-local"
                  step="1"
                  aria-label="任务截止时间"
                  required
                >
              </label>
              <label class="form-field">
                <span>计划时间 · {{ timeZone }} · 选填，需早于截止时间</span>
                <input
                  v-model="form.plannedDate"
                  class="form-control"
                  type="datetime-local"
                  step="1"
                  :max="planMaximum"
                  aria-label="任务计划时间"
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
                  aria-label="任务标签"
                  placeholder="选填，用逗号分隔"
                >
              </label>
              <details class="panel-stack">
                <summary>提示（选填）</summary>
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
                  class="panel-stack"
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
              class="button edit-task__submit"
              :disabled="saving"
            >
              {{ saving ? '正在保存……' : activeTask ? '保存任务' : '创建任务' }}
            </button>
          </form>
        </template>
      </TaskBlock>
    </Background>
  </section>
</template>

<style scoped>
.edit-task { min-width: 0; scroll-margin-top: 16px; }
.edit-task__heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.edit-task__heading h2 { margin: 0; }
.edit-task__heading-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.edit-task__delete { color: #dc3545; }
.edit-task > .edit-task__background { height: auto; overflow: clip; border-radius: 12px; margin-top: 16px; }
.edit-task__block { border-radius: 12px; }
.edit-task__form { min-width: 0; }
.edit-task__form .form-field { color: inherit; }
.edit-task__form .form-control { color: inherit; background: transparent; border-color: color-mix(in srgb, currentColor 35%, transparent); }
.edit-task__form .form-control::placeholder { color: inherit; opacity: .6; }
.edit-task__form select option { color: var(--text-primary); background: var(--background-secondary); }
.edit-task__form .button { color: inherit; border-color: color-mix(in srgb, currentColor 50%, transparent); background: transparent; }
.edit-task__form .button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent); }
.edit-task__event-error { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.edit-task__reminder { display: flex; align-items: center; gap: 8px; min-width: 0; }
.edit-task__reminder .form-control { flex: 1; min-width: 0; }
.edit-task__reminder .button { flex: none; }
.edit-task__error { margin: 0; font-size: 13px; }
.edit-task__submit { justify-self: end; }
</style>
