import { useApi } from '../useApi'

type Style = ApiData<Api['api']['style']['get']>[number]

const appStyles = new WeakMap<ReturnType<typeof useNuxtApp>, ReturnType<typeof createAppStyle>>()

function createAppStyle() {
  const { preferences } = useAppPeferences()
  const records = useState<Record<number, { saved: Style, draft: Style }>>('app:styles', () => ({}))
  const styleId = computed(() => preferences.value?.activeStyleId ?? null)
  const client = useApi({
    key: 'styles:all',
    write: (api, value: Style) => {
      const { id, ...fields } = value
      if (!fields.name || !fields.fontFamily) throw new Error('预设名称和字体名称不能为空。')
      return api.api.style({ id }).patch(fields)
    }
  })
  const presetsClient = useApi({
    key: 'styles:all',
    read: api => api.api.style.get(),
    write: (api, value: Parameters<Api['api']['style']['post']>[0]) => {
      if (!value.name || !value.fontFamily) throw new Error('预设名称和字体名称不能为空。')
      return api.api.style.post(value)
    }
  })
  const style = computed(() => styleId.value === null ? null : records.value[styleId.value]?.draft ?? null)
  const dirty = computed(() => style.value !== null
    && JSON.stringify(style.value) !== JSON.stringify(records.value[style.value.id]?.saved))
  let initialized = false

  function remember(value: Style) {
    const record = records.value[value.id]
    if (record) {
      const unchanged = JSON.stringify(record.draft) === JSON.stringify(record.saved)
      record.saved = { ...value }
      if (unchanged) record.draft = { ...value }
    } else {
      records.value[value.id] = { saved: { ...value }, draft: { ...value } }
    }
  }

  watch(presetsClient.data, (values) => {
    values?.forEach(remember)
  }, { immediate: true })

  async function initialize() {
    if (initialized) return
    initialized = true
    await presetsClient.read()
  }

  function styleData(name = style.value?.name) {
    if (!style.value) throw new Error('样式尚未载入')
    const value = { ...style.value, name: name?.trim() ?? '', fontFamily: style.value.fontFamily.trim() }
    return value
  }

  async function save() {
    if (!style.value || client.write.saving.value || presetsClient.write.saving.value) return
    const snapshot = { ...style.value }
    const saved = await client.write(styleData())
    const record = records.value[snapshot.id]
    if (record) {
      // 请求期间的新修改继续留在草稿里。
      const changes = Object.fromEntries(Object.entries(record.draft)
        .filter(([key, value]) => value !== snapshot[key as keyof Style]))
      record.saved = { ...saved }
      record.draft = { ...saved, ...changes }
    }
    return saved
  }

  function undo() {
    if (!style.value || client.write.saving.value) return
    const record = records.value[style.value.id]
    if (record) record.draft = { ...record.saved }
  }

  async function create(name: string) {
    if (!style.value || client.write.saving.value || presetsClient.write.saving.value) return
    const { id: _id, ...fields } = styleData(name)
    const created = await presetsClient.write(fields)
    remember(created)
    if (preferences.value) preferences.value.activeStyleId = created.id
    return created
  }

  return {
    style,
    styles: presetsClient.data,
    dirty,
    loading: presetsClient.read.loading,
    saving: client.write.saving,
    creating: presetsClient.write.saving,
    initialize,
    save,
    undo,
    create,
    refresh: presetsClient.read.refresh
  }
}

export function useAppStyle() {
  const app = useNuxtApp()
  let style = appStyles.get(app)
  if (!style) {
    style = createAppStyle()
    appStyles.set(app, style)
  }
  return style
}
