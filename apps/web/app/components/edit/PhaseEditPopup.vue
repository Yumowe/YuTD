<script setup lang="ts">
import AppPopup from '../common/AppPopup.vue'

type Phase = ApiData<Api['api']['phase']['post']>

const props = defineProps<{ /** 是否打开弹窗。 */ open: boolean, /** 已有阶段；为空时新建。 */ phase?: Phase | null }>()

const emit = defineEmits<{ 'update:open': [open: boolean], 'saved': [phase: Phase], 'deleted': [phaseId: Phase['id']] }>()

const { preferences } = useAppPeferences()

const { now, timeZone } = useSystemTime()

const form = reactive({ name: '', startDate: '', endDate: '' })

const client = reactive(useApi({
  key: 'phase:save',
  write: (api, data: Parameters<Api['api']['phase']['post']>[0]) => props.phase
    ? api.api.phase({ id: props.phase.id }).patch(data)
    : api.api.phase.post(data)
}))

const deleteClient = reactive(useApi({
  key: 'phase:delete',
  write: (api, id: Phase['id']) => api.api.phase({ id }).delete()
}))

const formId = useId()

const saving = ref(false)

const deleteCandidate = ref(false)

const error = ref('')

watch([() => props.open, () => props.phase], ([open, phase]) => {
  if (!open) return
  deleteCandidate.value = false
  const day = calendarDate(now.value ?? new Date(), timeZone.value)
  const monday = addCalendarDays(day, 1 - calendarWeekday(day))
  Object.assign(form, {
    name: phase?.name ?? '',
    startDate: phase ? new Date(phase.startDate).toISOString().slice(0, 10) : monday,
    endDate: phase ? new Date(phase.endDate).toISOString().slice(0, 10) : addCalendarDays(monday, 6)
  })
  error.value = ''
}, { immediate: true })

async function removePhase() {
  if (!props.phase || saving.value) return
  if (!deleteCandidate.value) {
    deleteCandidate.value = true
    return
  }
  const id = props.phase.id
  saving.value = true
  try {
    await deleteClient.write(id)
    if (preferences.value?.defaultPhaseId === id) preferences.value.defaultPhaseId = null
    emit('deleted', id)
    emit('update:open', false)
  } catch {
    return
  } finally {
    saving.value = false
  }
}

async function save() {
  if (saving.value) return
  error.value = ''
  if (!form.name.trim() || !form.startDate || !form.endDate) {
    error.value = '请填写阶段名称、开始日期和结束日期。'
    return
  }
  if (form.endDate < form.startDate) {
    error.value = '结束日期不能早于开始日期。'
    return
  }
  try {
    if (calendarWeekday(form.startDate) !== 1 || calendarWeekday(form.endDate) !== 7) {
      error.value = '阶段需要从周一开始，到周日结束。'
      return
    }
    saving.value = true
    const phase = await client.write({ ...form, name: form.name.trim() })
    emit('saved', phase)
    emit('update:open', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存阶段失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppPopup
    :open="open"
    :title="phase ? '编辑阶段' : '新建阶段'"
    class="phase-edit-popup"
    :dismissible="!saving"
    :close-on-outside="false"
    @update:open="emit('update:open', $event)"
  >
    <template
      v-if="phase"
      #header-actions
    >
      <button
        class="button phase-edit-popup__delete"
        type="button"
        :disabled="saving"
        @click="removePhase"
      >
        {{ deleteClient.write.saving.value ? '正在删除……' : deleteCandidate ? '确认删除阶段' : '删除阶段' }}
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
    <form
      class="panel-stack"
      :aria-busy="saving"
      @submit.prevent="save"
    >
      <label
        class="form-field"
        :for="`${formId}-name`"
      >
        阶段名称
        <input
          :id="`${formId}-name`"
          v-model="form.name"
          class="form-control"
          placeholder="例如：2026 秋季学期"
          autofocus
          required
          :disabled="saving"
        >
      </label>
      <label
        class="form-field"
        :for="`${formId}-start`"
      >
        开始日期
        <input
          :id="`${formId}-start`"
          v-model="form.startDate"
          class="form-control"
          type="date"
          :max="form.endDate || undefined"
          required
          :disabled="saving"
        >
      </label>
      <label
        class="form-field"
        :for="`${formId}-end`"
      >
        结束日期
        <input
          :id="`${formId}-end`"
          v-model="form.endDate"
          class="form-control"
          type="date"
          :min="form.startDate || undefined"
          required
          :disabled="saving"
        >
      </label>
      <p class="muted">
        按完整自然周排课，从周一开始，到周日结束。
      </p>
      <p
        v-if="error"
        class="phase-edit-popup__error"
        role="alert"
      >
        {{ error }}
      </p>
      <button
        class="button button--primary"
        type="submit"
        :disabled="saving"
      >
        {{ saving ? '正在保存……' : phase ? '保存阶段' : '创建阶段' }}
      </button>
    </form>
  </AppPopup>
</template>

<style scoped>
.phase-edit-popup { --popup-width: 440px; }
.phase-edit-popup p { margin: 0; font-size: 12px; }
.phase-edit-popup__error { color: #b42336; }
.phase-edit-popup__delete { color: #dc3545; }
</style>
