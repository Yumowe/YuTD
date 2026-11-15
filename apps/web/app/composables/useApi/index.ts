import type { Api, ApiValue } from '../../utils/api.ts'
import { useAppErrors } from '../useApp/useAppErrors.ts'
import { readApi, versionRequests } from './read.ts'
import type { ApiReadCache } from './read.ts'
import { writeApi } from './write.ts'

export type ApiMode = 'local' | 'remote' | 'remote-local'

const relatedResources: Record<string, string[]> = {
  phases: ['events', 'tasks', 'tips'],
  events: ['tasks', 'tips'],
  tasks: ['events', 'tips'],
  tips: ['events', 'tasks'],
  images: ['image-rotations']
}

// 全局模式仅预留选项，目前仍使用 local 的读取方式。
export function useApiMode() {
  return useState<ApiMode>('api:mode', () => 'local')
}

export function useApi<ReadResponse, WriteData = void, WriteResponse = unknown>(options: {
  key: string | (() => string) // 资源名:查询范围；完整 key 区分缓存，资源名控制写入通知
  read?: (api: Api) => Promise<ReadResponse> // 读取函数
  write?: (api: Api, data: WriteData) => Promise<WriteResponse> // 写入函数
  watch?: boolean // 首次及 key 改变时自动读取
}) {
  const { $api } = useNuxtApp()
  const { reportError } = useAppErrors()
  const key = computed(() => typeof options.key === 'function' ? options.key() : options.key)
  const cache = useState<Record<string, ApiReadCache>>('api:read-cache', () => ({}))
  const revisions = useState<Record<string, number>>('api:write-revisions', () => ({}))
  const resource = computed(() => key.value.split(':', 1)[0]!)
  const revision = computed(() => revisions.value[resource.value] ?? 0)
  const data = computed(() => cache.value[key.value]?.data as ApiValue<ReadResponse> | undefined)

  const readPending = ref(0)
  const read = Object.assign(() => readApi($api, options.read, reportError, key, cache, readPending, revisions), {
    loading: computed(() => readPending.value > 0),
    refresh: () => readApi($api, options.read, reportError, key, cache, readPending, revisions, true)
  })
  if (options.watch && options.read) {
    watch(key, () => read().catch(() => {}), { immediate: true })
  }
  if (options.read) {
    watch([key, revision], ([currentKey, currentRevision], [previousKey, previousRevision]) => {
      if (currentKey === previousKey && currentRevision !== previousRevision) void read().catch(() => {})
    })
  }

  const writePending = ref(0)
  const write = Object.assign(async (data: WriteData) => {
    const writtenResource = resource.value
    const result = await writeApi($api, options.write, data, reportError, writePending)
    versionRequests.delete($api)
    for (const name of new Set([writtenResource, ...(relatedResources[writtenResource] ?? [])])) {
      revisions.value[name] = (revisions.value[name] ?? 0) + 1
    }
    return result
  }, {
    saving: computed(() => writePending.value > 0)
  })

  return {
    key,
    data,
    read,
    write
  }
}
