<script setup lang="ts">
// 导入
import type AppSidebar from '~/components/common/AppSidebar.vue'
import RandomImageSettings from '~/components/image/RandomImageSettings.vue'
import { LocalNotifications } from '@capacitor/local-notifications'
import { reminderTokens } from '#shared/reminders'

// 页面配置与类型
const emit = defineEmits<{ 'page-data': [data: InstanceType<typeof AppSidebar>['$props']] }>()

// 系统变量读取
const { reportError } = useAppErrors()
const { $native } = useNuxtApp()
const { preferences, loading: preferencesLoading, saving: savingPreferences } = useAppPeferences()
const { style: draft, styles, dirty: styleDirty, loading, saving: savingStyle, creating, save: saveStyleDraft, undo: undoStyle, create: createStyle, refresh: refreshStyle } = useAppStyle()

// API 读取
const phasesClient = reactive(useApi({
  key: 'phases:all',
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

// 页面变量：普通变量
let activated = false
const colors = [
  { key: 'backgroundPrimary', label: '主背景' },
  { key: 'backgroundSecondary', label: '次背景' },
  { key: 'textPrimary', label: '主文字' },
  { key: 'textSecondary', label: '次文字' }
] as const
const timeZones = ['UTC', ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])]
const reminderSections = [
  { label: '课程', enabled: 'enableEventReminder', minutes: 'eventReminderMinutes', title: 'eventReminderTitle', body: 'eventReminderBody', before: '课程开始前', tokens: reminderTokens.event },
  { label: '任务', enabled: 'enableTaskReminder', minutes: 'taskReminderMinutes', title: 'taskReminderTitle', body: 'taskReminderBody', before: '任务截止前', tokens: reminderTokens.task }
] as const

// 页面变量：响应式数据
const state = reactive({ pageActive: true, presetName: '', readingFonts: false, fontSearch: '', timeZoneDraft: '', openingAutoStart: false })
const localFonts = useState<string[]>('app:local-fonts', () => [])
const reminderPermission = useState('reminders:permission', () => ({ display: '', exact: '' }))
const fontPicker = ref<HTMLDetailsElement | null>(null)
const fontSearchInput = ref<HTMLInputElement | null>(null)

// 计算属性
const phases = computed(() => phasesClient.data)
const phasesLoading = computed(() => phasesClient.read.loading.value)
const phaseSelectValue = computed({
  get: () => preferences.value?.defaultPhaseId == null ? '' : String(preferences.value.defaultPhaseId),
  set: (value: string) => {
    if (preferences.value) preferences.value.defaultPhaseId = value === '' ? null : Number(value)
  }
})
const activeStyleId = computed({
  get: () => preferences.value?.activeStyleId ?? '',
  set: (value: string | number) => {
    if (preferences.value && value !== '')
      preferences.value.activeStyleId = Number(value)
  }
})
const fontOptions = computed(() => {
  const options = new Map(appFontOptions.map(font => [font.value.toLocaleLowerCase(), font]))
  for (const family of [...localFonts.value, draft.value?.fontFamily ?? '']) {
    const value = family.trim()
    if (value && !options.has(value.toLocaleLowerCase()))
      options.set(value.toLocaleLowerCase(), { value, label: value })
  }
  return [...options.values()]
})
const filteredFontOptions = computed(() => {
  const query = state.fontSearch.trim().toLocaleLowerCase()
  return fontOptions.value.filter(font => !query || `${font.label} ${font.value}`.toLocaleLowerCase().includes(query))
})
const selectedFontLabel = computed(() => fontOptions.value.find(font => font.value === draft.value?.fontFamily)?.label ?? draft.value?.fontFamily)
const customFontName = computed(() => state.fontSearch.trim())
const customFontAvailable = computed(() => customFontName.value && !fontOptions.value.some(font => font.value.toLocaleLowerCase() === customFontName.value.toLocaleLowerCase()))

// 方法
function reminderTokenNames(tokens: readonly string[]) {
  return tokens.map(token => `{{${token}}}`).join('、')
}
async function authorizeReminders() {
  if (!$native || !preferences.value?.enableReminder) return
  try {
    const permission = await LocalNotifications.requestPermissions()
    const exact = await LocalNotifications.checkExactNotificationSetting()
    reminderPermission.value = { display: permission.display, exact: exact.exact_alarm }
    window.dispatchEvent(new Event('yutd:reminders-changed'))
  } catch (error) {
    reportError(error, '授权系统提醒失败')
  }
}
async function openAutoStartSettings() {
  if (!$native || state.openingAutoStart) return
  state.openingAutoStart = true
  try {
    await $native.openAutoStartSettings()
  } catch (error) {
    reportError(error, '打开后台自启动设置失败')
  } finally {
    state.openingAutoStart = false
  }
}
async function authorizeExactReminders() {
  try {
    const result = await LocalNotifications.changeExactNotificationSetting()
    reminderPermission.value.exact = result.exact_alarm
    window.dispatchEvent(new Event('yutd:reminders-changed'))
  } catch (error) {
    reportError(error, '设置准时提醒失败')
  }
}
function normalizeReminderMinutes(key: 'eventReminderMinutes' | 'taskReminderMinutes') {
  if (!preferences.value) return
  const value = Number(preferences.value[key])
  preferences.value[key] = Number.isFinite(value) ? Math.min(10080, Math.max(0, Math.round(value))) : 0
}

function closeFontPicker() {
  if (fontPicker.value)
    fontPicker.value.open = false
  state.fontSearch = ''
}

async function fontPickerToggled() {
  state.fontSearch = ''
  if (fontPicker.value?.open) {
    await nextTick()
    fontSearchInput.value?.focus({ preventScroll: true })
  }
}

function selectFont(family: string) {
  if (!draft.value || savingStyle.value || creating.value)
    return
  draft.value.fontFamily = family
  closeFontPicker()
  fontPicker.value?.querySelector('summary')?.focus()
}

function moveFontFocus(event: KeyboardEvent, step: number) {
  const options = [...(fontPicker.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
  const index = options.indexOf(event.target as HTMLButtonElement)
  options[(index + step + options.length) % options.length]?.focus()
}

function dismissFontPicker(event: PointerEvent) {
  if (fontPicker.value?.open && event.target instanceof Node && !fontPicker.value.contains(event.target))
    closeFontPicker()
}

function saveTimeZone() {
  if (!preferences.value)
    return
  try {
    const timeZone = normalizeTimeZone(state.timeZoneDraft.trim())
    Object.assign(preferences.value, { timeZone, timeZoneAutomatic: false })
  } catch {
    reportError('请输入有效的 IANA 时区，例如 Asia/Shanghai。', '保存时区失败')
  }
}

async function loadFonts() {
  if (state.readingFonts)
    return
  state.readingFonts = true
  try {
    localFonts.value = await readLocalFontFamilies()
  } catch (error) {
    reportError(error instanceof DOMException && error.name === 'NotAllowedError'
      ? '尚未获得本机字体访问权限，仍可直接输入字体名称。'
      : error, '读取本机字体失败')
  } finally {
    state.readingFonts = false
  }
}

function saveSidebarWidth() {
  if (!preferences.value)
    return
  const width = Math.round(Number(preferences.value.sidebarWidth))
  preferences.value.sidebarWidth = Math.min(135, Math.max(64, Number.isFinite(width) ? width : 64))
}
function saveStyle() {
  void saveStyleDraft().catch(() => {})
}

async function saveAsPreset() {
  if (savingStyle.value || creating.value || !state.presetName.trim()) return
  const value = await createStyle(state.presetName).catch(() => undefined)
  if (value) state.presetName = ''
}

async function refreshContent() {
  await Promise.all([
    phasesClient.read(),
    eventsClient.read()
  ])
}

// 监听
watch(() => preferences.value?.activeStyleId, closeFontPicker)
watch(() => preferences.value?.timeZone, (value) => {
  state.timeZoneDraft = value ?? ''
}, { immediate: true })
watchEffect(() => {
  if (state.pageActive) emit('page-data', { phases: phasesClient.data, events: eventsClient.data, eventsPending: eventsClient.read.loading.value, refreshEvents: eventsClient.read })
})

// 生命周期
onMounted(() => window.addEventListener('pointerdown', dismissFontPicker))
onActivated(() => {
  state.pageActive = true
  if (activated) void refreshContent().catch(() => {})
  activated = true
})
onDeactivated(() => {
  state.pageActive = false
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', dismissFontPicker))
</script>

<template>
  <main class="page-shell">
    <div class="page-container">
      <div class="page-grid settings-grid">
        <div class="panel-stack">
          <PageCard class="settings-phase">
            <label class="form-field">
              <span>当前阶段 · Phase</span>
              <select
                v-model="phaseSelectValue"
                class="form-control"
                :disabled="preferencesLoading || phasesLoading || !preferences || !phases?.length"
              >
                <option value="">
                  {{ phasesLoading ? '正在加载阶段……' : phases?.length ? '未选择阶段' : '暂无阶段' }}
                </option>
                <option
                  v-for="phase in phases ?? []"
                  :key="phase.id"
                  :value="String(phase.id)"
                >
                  {{ phase.name }}
                </option>
              </select>
              <small class="field-help">选择后自动保存为默认阶段，首页与课程表同步切换。</small>
            </label>
          </PageCard>
          <PageCard class="settings-reminders">
            <header class="content-heading">
              <h2 class="panel-title">
                提醒
              </h2>
            </header>
            <div class="panel-stack">
              <template v-if="preferences">
                <label class="form-field">
                  <span><input
                    v-model="preferences.enableReminder"
                    type="checkbox"
                    @change="authorizeReminders"
                  > 开启提醒</span>
                  <small class="field-help">Android 使用系统本地通知；网页端保存相同偏好。任务单独设置的提醒时间与截止前提醒同时生效。</small>
                </label>
                <div class="panel-stack">
                  <small class="field-help">部分手机可能需要开启自启动，才能在 App 未运行时收到通知。</small>
                  <button
                    v-if="$native"
                    class="button"
                    type="button"
                    :disabled="state.openingAutoStart"
                    @click="openAutoStartSettings"
                  >
                    自启动权限设置
                  </button>
                </div>
                <div
                  v-if="$native && preferences.enableReminder"
                  class="panel-stack"
                >
                  <button
                    v-if="reminderPermission.display !== 'granted'"
                    class="button"
                    type="button"
                    @click="authorizeReminders"
                  >
                    允许系统通知
                  </button>
                  <button
                    v-if="reminderPermission.exact !== 'granted'"
                    class="button"
                    type="button"
                    @click="authorizeExactReminders"
                  >
                    允许准时提醒
                  </button>
                  <small
                    v-if="reminderPermission.exact !== 'granted'"
                    class="field-help"
                  >未允许准时提醒时使用普通系统通知，送达时间可能推迟。</small>
                </div>
                <div
                  v-for="section in reminderSections"
                  :key="section.enabled"
                  class="panel-stack settings-reminder"
                >
                  <label class="form-field">
                    <span><input
                      v-model="preferences[section.enabled]"
                      type="checkbox"
                      :disabled="!preferences.enableReminder"
                    > 开启{{ section.label }}提醒</span>
                  </label>
                  <fieldset
                    class="panel-stack"
                    :disabled="!preferences.enableReminder || !preferences[section.enabled]"
                  >
                    <label class="form-field">
                      <span>{{ section.before }}多少分钟提醒</span>
                      <input
                        v-model.number="preferences[section.minutes]"
                        class="form-control"
                        type="number"
                        min="0"
                        max="10080"
                        step="1"
                        @change="normalizeReminderMinutes(section.minutes)"
                      >
                    </label>
                    <label class="form-field">
                      <span>{{ section.label }}通知标题（title）</span>
                      <input
                        v-model.lazy="preferences[section.title]"
                        class="form-control"
                        maxlength="200"
                        required
                      >
                    </label>
                    <label class="form-field">
                      <span>{{ section.label }}通知正文（body）</span>
                      <textarea
                        v-model.lazy="preferences[section.body]"
                        class="form-control"
                        rows="3"
                        maxlength="2000"
                        required
                      />
                    </label>
                  </fieldset>
                  <small class="field-help">可用内容：{{ reminderTokenNames(section.tokens) }}。time 为课程起止时间或任务截止时间；task、event、tips 只显示关联任务名称、课程名称和提示正文。<template v-if="section.enabled === 'enableTaskReminder'">description 为任务描述。</template></small>
                </div>
              </template>
              <p
                v-else
                class="page-state"
                role="status"
              >
                提醒设置尚未载入。
              </p>
            </div>
          </PageCard>
          <PageCard>
            <header class="content-heading">
              <h2 class="panel-title">
                使用偏好
              </h2>
            </header>
            <div class="panel-stack">
              <template v-if="preferences">
                <label class="form-field">
                  <span><input
                    v-model="preferences.timeZoneAutomatic"
                    type="checkbox"
                  > 自动识别时区</span>
                  <small class="field-help">优先采用浏览器时区，语言地区用于兜底；各端统一使用后端保存的时区。</small>
                </label>
                <label class="form-field">
                  <span>统一时区 · {{ preferences.timeZone }}</span>
                  <input
                    v-model="state.timeZoneDraft"
                    class="form-control"
                    list="time-zones"
                    :disabled="preferences.timeZoneAutomatic"
                    @change="saveTimeZone"
                  >
                  <datalist id="time-zones"><option
                    v-for="zone in timeZones"
                    :key="zone"
                    :value="zone"
                  /></datalist>
                </label>
                <label class="form-field">
                  <span>侧栏宽度 · {{ preferences.sidebarWidth }} px</span>
                  <input
                    v-model.number="preferences.sidebarWidth"
                    type="range"
                    min="64"
                    max="135"
                    step="1"
                    @change="saveSidebarWidth"
                  >
                  <input
                    v-model.number="preferences.sidebarWidth"
                    class="form-control"
                    aria-label="侧栏宽度"
                    type="number"
                    min="64"
                    max="135"
                    @change="saveSidebarWidth"
                  >
                </label>
                <p class="field-help">
                  选择的阶段会自动保存为默认阶段；切换到编辑模式后，可在课程表页点击「调整课程表」设置缩放与间距。
                </p>
              </template>
              <p
                v-else
                class="page-state"
                role="status"
              >
                偏好设置尚未载入。
              </p>
            </div>
          </PageCard>
        </div>
        <div class="panel-stack">
          <PageCard>
            <header class="content-heading">
              <h2 class="panel-title">
                样式预设
              </h2>
              <p class="page-meta">
                修改会在整个应用中预览，点击保存才提交；未保存时可撤销。
              </p>
            </header>
            <div class="panel-stack">
              <label class="form-field">
                <span>当前预设</span>
                <select
                  v-model="activeStyleId"
                  class="form-control"
                  :disabled="!preferences || savingStyle || creating"
                >
                  <option
                    v-if="!styles?.length"
                    value=""
                    disabled
                  >正在加载预设……</option>
                  <option
                    v-for="preset in styles ?? []"
                    :key="preset.id"
                    :value="preset.id"
                  >
                    {{ preset.id === draft?.id ? draft.name : preset.name }}
                  </option>
                </select>
              </label>
              <template v-if="draft">
                <label class="form-field">
                  <span>显示模式</span>
                  <select
                    v-model.number="draft.showMode"
                    class="form-control"
                    :disabled="savingStyle || creating"
                  >
                    <option :value="0">简洁</option>
                    <option :value="1">华丽</option>
                  </select>
                </label>
                <label class="form-field">
                  <span>预设名称</span>
                  <input
                    v-model="draft.name"
                    class="form-control"
                    maxlength="80"
                    required
                    :disabled="savingStyle || creating"
                  >
                </label>
                <div class="settings-colors">
                  <label
                    v-for="color in colors"
                    :key="color.key"
                    class="settings-color"
                  >
                    <input
                      v-model="draft[color.key]"
                      type="color"
                      :aria-label="color.label"
                      :disabled="savingStyle || creating"
                    >
                    <span>{{ color.label }}<small>{{ draft[color.key] }}</small></span>
                  </label>
                </div>
                <label class="form-field">
                  <span>另存为新预设</span>
                  <input
                    v-model="state.presetName"
                    :disabled="savingStyle || creating"
                    class="form-control"
                    placeholder="例如：夜间阅读"
                    maxlength="80"
                    @keydown.enter.prevent="saveAsPreset"
                  >
                </label>
                <button
                  class="button"
                  type="button"
                  :disabled="creating || savingStyle || !state.presetName.trim()"
                  @click="saveAsPreset"
                >
                  {{ creating ? '正在创建……' : '保存为新预设并切换' }}
                </button>
              </template>
              <p
                v-else
                class="page-state"
                role="status"
              >
                {{ loading ? '正在加载样式……' : '样式尚未载入。' }}
                <button
                  v-if="!loading"
                  class="button"
                  type="button"
                  @click="refreshStyle()"
                >
                  重新加载
                </button>
              </p>
              <button
                class="button button--primary"
                type="button"
                :disabled="!draft || !styleDirty || savingStyle || creating"
                @click="saveStyle"
              >
                {{ savingStyle ? '正在保存样式……' : '保存样式' }}
              </button>
              <p
                v-if="savingStyle || savingPreferences"
                class="field-help"
                role="status"
              >
                正在保存……
              </p>
              <button
                class="button"
                type="button"
                :disabled="!styleDirty || savingStyle || creating"
                @click="undoStyle"
              >
                撤销未保存修改
              </button>
            </div>
          </PageCard>
          <PageCard
            v-if="!$native"
            class="settings-fonts"
          >
            <header class="content-heading">
              <h2 class="panel-title">
                字体
              </h2>
            </header>
            <div
              v-if="draft"
              class="panel-stack"
            >
              <div class="form-field">
                <span>界面字体</span>
                <details
                  ref="fontPicker"
                  class="settings-font-picker"
                  @toggle="fontPickerToggled"
                  @keydown.esc.prevent.stop="closeFontPicker"
                >
                  <summary
                    class="form-control"
                    aria-label="选择界面字体"
                    @click="state.fontSearch = ''"
                  >
                    <span>{{ selectedFontLabel }}</span>
                    <Icon
                      name="lucide:chevron-down"
                      aria-hidden="true"
                    />
                  </summary>
                  <div class="settings-font-menu">
                    <input
                      ref="fontSearchInput"
                      v-model="state.fontSearch"
                      type="search"
                      class="form-control"
                      aria-label="搜索字体"
                      placeholder="输入名称查找；留空显示全部字体"
                      maxlength="200"
                      autocomplete="off"
                      @keydown.down.prevent="moveFontFocus($event, 1)"
                      @keydown.enter.prevent="selectFont(filteredFontOptions[0]?.value ?? customFontName)"
                    >
                    <div
                      class="settings-font-list"
                      role="listbox"
                      aria-label="可选字体"
                      @keydown.down.prevent="moveFontFocus($event, 1)"
                      @keydown.up.prevent="moveFontFocus($event, -1)"
                    >
                      <button
                        v-for="font in filteredFontOptions"
                        :key="font.value"
                        class="settings-font-option"
                        type="button"
                        role="option"
                        :aria-selected="draft.fontFamily === font.value"
                        :disabled="savingStyle || creating"
                        @click="selectFont(font.value)"
                      >
                        <span>{{ font.label }}</span>
                        <small v-if="font.label !== font.value">{{ font.value }}</small>
                      </button>
                    </div>
                    <button
                      v-if="customFontAvailable"
                      class="button"
                      type="button"
                      :disabled="savingStyle || creating"
                      @click="selectFont(customFontName)"
                    >
                      使用输入的字体名称：{{ customFontName }}
                    </button>
                    <p
                      v-if="!filteredFontOptions.length"
                      class="field-help"
                      role="status"
                    >
                      没有匹配项；可使用输入的名称，或清空搜索查看全部。
                    </p>
                  </div>
                </details>
                <small class="field-help">打开即显示完整列表，输入后才筛选。未安装的字体或不支持的字形会使用备用字体。</small>
              </div>
              <button
                class="button"
                type="button"
                :disabled="state.readingFonts"
                @click="loadFonts"
              >
                {{ state.readingFonts ? '正在读取……' : '读取本机字体' }}
              </button>
              <p
                v-if="localFonts.length"
                class="field-help"
              >
                已加入 {{ localFonts.length }} 种本机字体，打开字体列表即可选择或搜索。
              </p>
              <p
                class="settings-font-preview"
                :style="{ fontFamily: getAppFontStack(draft.fontFamily) }"
              >
                猫猫？<br>YuTD · Cat?. 0123456789
              </p>
            </div>
            <p
              v-else
              class="page-state"
            >
              选择样式后即可设置字体。
            </p>
          </PageCard>
          <RandomImageSettings />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.settings-grid { align-items: start; }
.settings-reminder { padding-top: 12px; border-top: 1px solid var(--border-color); }
.settings-colors { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.settings-color { display: flex; gap: 12px; align-items: center; font-size: 14px; }
.settings-color input { width: 44px; height: 44px; padding: 3px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--background-secondary); cursor: pointer; }
.settings-color small { display: block; margin-top: 4px; color: var(--text-secondary); font-size: 11px; }
.settings-font-preview { margin: 0; padding: 20px; border: 1px solid var(--border-color); border-radius: 12px; line-height: 1.8; background: var(--background-primary); }
.settings-font-picker summary { display: flex; justify-content: space-between; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
.settings-font-picker summary::-webkit-details-marker { display: none; }
.settings-font-picker summary span { min-width: 0; overflow-wrap: anywhere; }
.settings-font-picker[open] summary { border-color: var(--text-secondary); }
.settings-font-menu { display: grid; gap: 8px; margin-top: 8px; padding: 8px; border: 1px solid var(--border-color); border-radius: 9px; background: var(--background-secondary); }
.settings-font-list { max-height: 260px; overflow: auto; overscroll-behavior: contain; }
.settings-font-option { display: flex; flex-direction: column; align-items: flex-start; width: 100%; gap: 2px; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-primary); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.settings-font-option small { color: var(--text-secondary); }
.settings-font-option:hover, .settings-font-option:focus-visible, .settings-font-option[aria-selected='true'] { background: color-mix(in srgb, var(--text-secondary) 15%, var(--background-secondary)); }
.settings-font-option:disabled { cursor: wait; opacity: .5; }
input[type='range'] { width: 100%; accent-color: var(--text-primary); }
@media (max-width: 500px) { .settings-colors { grid-template-columns: 1fr; } }
@media (width < 480px) { .settings-fonts { display: none; } }
</style>
