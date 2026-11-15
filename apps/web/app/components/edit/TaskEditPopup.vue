<script setup lang="ts">
import type { ChangeTask } from '~/components/preview/Task/TaskBlock.vue'
import AppPopup from '../common/AppPopup.vue'
import TaskEdit, { type EditableTask } from './TaskEdit.vue'
import TaskBlock from '../preview/Task/TaskBlock.vue'
import Background from '../image/BackgroundLayout.vue'
import type { BackgroundSelection } from '../image/BackgroundSelect.vue'

const props = withDefaults(defineProps<{
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 手动重试读取课程数据。 */
  refreshEvents?: () => Promise<unknown>
  /** 写入任务状态或延期变更。 */
  changeTask?: ChangeTask
  /** 是否打开弹窗。 */
  open: boolean
  /** 已有任务；为空时新建。 */
  task?: EditableTask | null
  /** 所属阶段 ID。 */
  phaseId: number
  /** 关联事件 ID。 */
  eventId?: number
  /** 新建任务默认使用的日期。 */
  date?: string
  /** 是否直接进入编辑状态。 */
  editing?: boolean
  /** 弹窗或内嵌面板形式。 */
  mode?: 'dialog' | 'panel'
  /** 任务详情使用的背景。 */
  background?: BackgroundSelection | null
}>(), { editing: false, mode: 'dialog' })

const emit = defineEmits<{ 'update:open': [open: boolean], 'saved': [task: EditableTask], 'change': [], 'deleted': [taskId: EditableTask['id']] }>()

const { mode: systemMode } = useSystemStatus()

const editorRef = ref<InstanceType<typeof TaskEdit> | null>(null)

const editing = ref(props.editing || !props.task)

watch([() => props.task?.id, () => props.editing], () => {
  editing.value = props.editing || !props.task
})

watch(systemMode, (value) => {
  if (value !== 'edit' && editing.value && props.task) emit('update:open', false)
})

function saved(task: EditableTask) {
  emit('saved', task)
  emit('update:open', false)
}

function deleted(id: EditableTask['id']) {
  emit('deleted', id)
  emit('update:open', false)
}

defineExpose({ saving: computed(() => Boolean(editorRef.value?.saving)) })
</script>

<template>
  <AppPopup
    :open="open"
    :mode="mode"
    class="task-popup"
    :title="editing ? task ? '编辑任务' : '新建任务' : '任务详情'"
    :dismissible="!editorRef?.saving"
    :close-on-outside="!editing"
    @update:open="emit('update:open', $event)"
  >
    <template
      v-if="!editing && systemMode === 'edit'"
      #header-actions
    >
      <button
        class="button"
        type="button"
        aria-label="编辑当前任务"
        @click="editing = true"
      >
        <Icon
          name="lucide:pen-line"
          aria-hidden="true"
        />
      </button>
    </template>
    <TaskEdit
      v-if="editing"
      ref="editorRef"
      :events="props.events"
      :events-pending="props.eventsPending"
      :refresh-events="props.refreshEvents"
      :task="task"
      :phase-id="phaseId"
      :event-id="eventId"
      :date="date"
      :allow-new="false"
      @saved="saved"
      @deleted="deleted"
    />
    <Background
      v-else-if="task"
      class="task-popup__background"
      :image="background?.image ?? ''"
      :position="background?.position"
      :analysis="background?.analysis"
      :simplified-image="background?.simplifiedImage"
    >
      <TaskBlock
        :change-task="props.changeTask"
        :task="task"
        :detail="3"
        @change="emit('change')"
      />
    </Background>
  </AppPopup>
</template>

<style scoped>
.task-popup { --popup-width: 640px; }
.task-popup :deep(.edit-task) { padding: 0; border: 0; background: transparent; }
.task-popup :deep(.task-block) { border-radius: 12px; }
.task-popup .task-popup__background { height: auto; overflow: clip; border-radius: 12px; }
</style>
