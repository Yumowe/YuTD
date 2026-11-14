<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import AppPopup from '../common/AppPopup.vue'

const PhaseEditPopup = defineAsyncComponent(() => import('./PhaseEditPopup.vue'))

const EventEditPopup = defineAsyncComponent(() => import('./EventEditPopup.vue'))

const TaskEditPopup = defineAsyncComponent(() => import('./TaskEditPopup.vue'))

type Phase = ApiData<Api['api']['phase']['get']>[number]

const props = defineProps<{
  /** 课程及排课数据。 */
  events: ApiData<Api['api']['event']['get']> | undefined
  /** 课程数据是否正在读取。 */
  eventsPending: boolean
  /** 重新读取课程数据。 */
  refreshEvents: () => Promise<unknown>
  /** 重新读取页面相关数据。 */
  refreshContent: () => Promise<unknown>
  /** 可选择的阶段列表。 */
  phases: ApiData<Api['api']['phase']['get']> | undefined
  /** 弹层定位的锚点元素。 */
  anchor?: HTMLElement | null
  /** 指定操作的阶段；未传时使用当前阶段。 */
  phaseId?: number | null
}>()

const createMenuOpen = defineModel<boolean>('open', { default: false })

const { now, timeZone } = useSystemTime()

const { mode } = useSystemStatus()

const { preferences } = useAppPeferences()

const phases = computed(() => props.phases)

const selectedCreationPhase = computed(() => {
  const selectedPhaseId = props.phaseId === undefined ? preferences.value?.defaultPhaseId : props.phaseId
  return phases.value?.find(phase => phase.id === selectedPhaseId)
})

const creating = ref<'phase' | 'event' | 'task' | null>(null)

const editingPhase = ref(false)

const creationPhase = shallowRef<Phase | null>(null)

const creationDate = ref('')

watch(mode, (value) => {
  if (value === 'edit') return
  createMenuOpen.value = false
  creating.value = null
})

function create(type: 'phase' | 'event' | 'task') {
  if (type !== 'phase' && !selectedCreationPhase.value) return
  creationPhase.value = selectedCreationPhase.value ?? null
  editingPhase.value = false
  creationDate.value = calendarDate(now.value ?? new Date(), timeZone.value)
  createMenuOpen.value = false
  creating.value = type
}

function editPhase() {
  if (!selectedCreationPhase.value) return
  create('phase')
  editingPhase.value = true
}

async function phaseSaved(phase: ApiData<Api['api']['phase']['post']>) {
  if (preferences.value) preferences.value.defaultPhaseId = phase.id
  await props.refreshContent()
}

async function contentSaved() {
  await props.refreshContent()
}
</script>

<template>
  <AppPopup
    v-model:open="createMenuOpen"
    mode="popover"
    title="内容操作"
    class="phase-create-popup"
    :anchor="props.anchor"
  >
    <div class="panel-stack">
      <button
        v-if="selectedCreationPhase"
        class="button phase-create-option"
        type="button"
        @click="editPhase"
      >
        编辑当前阶段
      </button>
      <button
        class="button phase-create-option"
        type="button"
        @click="create('phase')"
      >
        <Icon name="lucide:calendar-range" />
        阶段 · Phase
      </button>
      <button
        v-if="selectedCreationPhase"
        class="button phase-create-option"
        type="button"
        @click="create('event')"
      >
        <Icon name="lucide:calendar-days" />
        课程 · Event
      </button>
      <button
        v-if="selectedCreationPhase"
        class="button phase-create-option"
        type="button"
        @click="create('task')"
      >
        <Icon name="lucide:list-todo" />
        任务 · Task
      </button>
    </div>
  </AppPopup>
  <PhaseEditPopup
    v-if="creating === 'phase'"
    :open="true"
    :phase="editingPhase ? creationPhase : null"
    @update:open="!$event && (creating = null)"
    @saved="phaseSaved"
    @deleted="contentSaved"
  />
  <EventEditPopup
    v-if="creating === 'event' && creationPhase"
    :events="props.events"
    :events-pending="props.eventsPending"
    :refresh-events="props.refreshEvents"
    :open="true"
    :phase-id="creationPhase.id"
    :week-count="creationPhase.weekCount"
    @update:open="!$event && (creating = null)"
    @saved="contentSaved"
    @task-saved="contentSaved"
    @deleted="contentSaved"
    @task-deleted="contentSaved"
  />
  <TaskEditPopup
    v-if="creating === 'task' && creationPhase"
    :events="props.events"
    :events-pending="props.eventsPending"
    :refresh-events="props.refreshEvents"
    :open="true"
    :phase-id="creationPhase.id"
    :date="creationDate"
    :editing="true"
    @update:open="!$event && (creating = null)"
    @saved="contentSaved"
    @deleted="contentSaved"
  />
</template>

<style scoped>
.phase-create-popup.app-popup { --popup-width: 300px; padding: 16px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--background-secondary); }
.phase-create-option { justify-content: flex-start; gap: 10px; width: 100%; }
</style>
