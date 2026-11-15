<script setup lang="ts">
import AppPopup from '../common/AppPopup.vue'
import EventEdit, { type EditableEvent } from './EventEdit.vue'
import TaskEditPopup from './TaskEditPopup.vue'
import type { EditableTask } from './TaskEdit.vue'
import { calendarDate, calendarDayNumber } from '~/utils/date'

const props = defineProps<{
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 手动重试读取课程数据。 */
  refreshEvents?: () => Promise<unknown>
  /** 已有事件 ID；为空时新建。 */
  eventId?: number
  /** 所属阶段 ID。 */
  phaseId?: number
  /** 阶段总周数。 */
  weekCount?: number
  /** 是否打开弹窗。 */
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': [event: EditableEvent]
  'task-saved': [task: EditableTask]
  'deleted': [eventId: EditableEvent['id']]
  'task-deleted': [taskId: EditableTask['id']]
}>()

const { mode } = useSystemStatus()

const fetchedEvent = computed(() => props.events?.find(value => value.id === props.eventId) ?? null)

const pending = computed(() => props.eventsPending)

const error = computed(() => (!props.eventsPending && props.events === undefined))

const event = shallowRef<EditableEvent | null>(fetchedEvent.value ?? null)

const editorPhaseId = computed(() => event.value?.phaseId ?? props.phaseId ?? 0)

const weekCount = computed(() => {
  const phase = event.value?.phase
  if (!phase) return props.weekCount ?? 0
  return Math.floor((calendarDayNumber(calendarDate(phase.endDate, 'UTC'))
    - calendarDayNumber(calendarDate(phase.startDate, 'UTC'))) / 7) + 1
})

const editorRef = ref<InstanceType<typeof EventEdit> | null>(null)

const taskPopup = ref<InstanceType<typeof TaskEditPopup> | null>(null)

const taskEvent = shallowRef<EditableEvent | null>(null)

watch(() => props.eventId, () => {
  taskEvent.value = null
})

watch([() => props.open, () => props.eventId], ([open, id], previous) => {
  if (open && id === undefined && (!previous || !previous[0] || previous[1] !== id)) {
    event.value = null
    taskEvent.value = null
  }
}, { immediate: true })

// 刷新失败时保留已打开的编辑器及其中尚未保存的草稿。
watch([() => props.eventId, fetchedEvent], ([id, value]) => {
  if (id === undefined) return
  if (event.value?.id !== id) event.value = null
  if (value?.id === id) event.value = value
}, { immediate: true })

watch(mode, (value) => {
  if (value !== 'edit') emit('update:open', false)
})

function saved(value: EditableEvent) {
  event.value = value
  emit('saved', value)
}

function deleted(id: EditableEvent['id']) {
  event.value = null
  taskEvent.value = null
  emit('deleted', id)
  emit('update:open', false)
}
</script>

<template>
  <AppPopup
    :open="open"
    :title="event || eventId ? '编辑课程' : '新建课程'"
    mode="dialog"
    class="event-edit-popup"
    :class="{ 'event-edit-popup--paired': Boolean(taskEvent) }"
    :close-on-outside="false"
    :dismissible="!editorRef?.saving && !taskPopup?.saving"
    @update:open="emit('update:open', $event)"
  >
    <p
      v-if="eventId !== undefined && pending && !event"
      role="status"
    >
      正在加载课程……
    </p>
    <div
      v-else-if="eventId !== undefined && !event"
      class="panel-stack"
      role="alert"
    >
      <p>课程加载失败，请重试。</p>
      <button
        v-if="refreshEvents"
        type="button"
        class="button"
        :disabled="pending"
        @click="refreshEvents()"
      >
        重新加载
      </button>
    </div>
    <p
      v-if="event && error"
      role="alert"
    >
      刷新课程失败，已保留当前编辑内容。
    </p>
    <EventEdit
      v-if="editorPhaseId > 0 && (event || eventId === undefined)"
      ref="editorRef"
      :event="event"
      :phase-id="editorPhaseId"
      :week-count="weekCount"
      :allow-new="false"
      @saved="saved"
      @deleted="deleted"
      @add-task="taskEvent = $event"
    />
    <template
      v-if="taskEvent"
      #companion
    >
      <TaskEditPopup
        ref="taskPopup"
        :key="taskEvent.id"
        :events="props.events"
        :events-pending="props.eventsPending"
        :refresh-events="props.refreshEvents"
        :open="true"
        mode="panel"
        :editing="true"
        :phase-id="taskEvent.phaseId"
        :event-id="taskEvent.id"
        @update:open="!$event && (taskEvent = null)"
        @saved="emit('task-saved', $event)"
        @deleted="emit('task-deleted', $event)"
      />
    </template>
  </AppPopup>
</template>

<style scoped>
.event-edit-popup { --popup-width: 980px; }
.event-edit-popup--paired { --popup-width: 1540px; }
.event-edit-popup :deep(.edit-event) { padding: 0; border: 0; background: transparent; }
</style>
