import { requestApiData } from '../../utils/api.ts'
import type { Api, ApiValue } from '../../utils/api.ts'
import type { useAppErrors } from '../useApp/useAppErrors.ts'

export interface ApiReadCache {
  version: string
  data: unknown
}

const readRequests = new WeakMap<Api, Map<string, { version: string, revision: number, promise: Promise<unknown> }>>()

// 每个应用的 $api 各自共享正在进行的版本请求，避免服务端不同用户串用。
export const versionRequests = new WeakMap<Api, Promise<{ version: string }>>()

function getVersion(api: Api) {
  const pendingVersion = versionRequests.get(api)
  if (pendingVersion) {
    return pendingVersion
  }

  const request = requestApiData(api.api.version.get(), '获取数据版本失败').finally(() => {
    if (versionRequests.get(api) === request) versionRequests.delete(api)
  })
  versionRequests.set(api, request)
  return request
}

export async function readApi<Response>(
  api: Api,
  request: ((api: Api) => Promise<Response>) | undefined,
  reportError: ReturnType<typeof useAppErrors>['reportError'],
  key: Readonly<Ref<string>>,
  cache: Ref<Record<string, ApiReadCache>>,
  pending: Ref<number>,
  revisions: Readonly<Ref<Record<string, number>>>,
  force = false
): Promise<ApiValue<Response>> {
  try {
    pending.value++
    if (!request) throw new Error('未配置读取方法')
    const cacheKey = key.value
    const resource = cacheKey.split(':', 1)[0]!
    const revision = revisions.value[resource] ?? 0
    const { version } = await getVersion(api)
    if (key.value !== cacheKey || (revisions.value[resource] ?? 0) !== revision) {
      return await readApi(api, request, reportError, key, cache, pending, revisions, force)
    }
    const cached = cache.value[cacheKey]

    if (!force && cached && cached.version === version) {
      return cached.data as ApiValue<Response>
    }

    let requests = readRequests.get(api)
    if (!requests) {
      requests = new Map()
      readRequests.set(api, requests)
    }
    const existing = requests.get(cacheKey)
    if (existing?.revision === revision && existing.version === version) {
      try {
        return await existing.promise as ApiValue<Response>
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) throw error
        return await readApi(api, request, reportError, key, cache, pending, revisions, force)
      }
    }

    const entry: { version: string, revision: number, promise: Promise<ApiValue<Response>> } = {
      version,
      revision,
      promise: requestApiData(request(api), '读取失败').then((data) => {
        // 写入前发出的旧请求不能覆盖写入后的读取结果。
        if ((revisions.value[resource] ?? 0) === revision && readRequests.get(api)?.get(cacheKey) === entry) {
          cache.value = { ...cache.value, [cacheKey]: { version, data } }
        }
        return data
      })
    }
    requests.set(cacheKey, entry)
    try {
      return await entry.promise
    } finally {
      if (requests.get(cacheKey) === entry) requests.delete(cacheKey)
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) reportError(error, '读取失败')
    throw error
  } finally {
    pending.value--
  }
}
