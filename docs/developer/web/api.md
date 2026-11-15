# API 请求、缓存与写入通知

页面和组件通过 `useApi()` 创建客户端，调用 `read()` 读取、调用 `write(value)` 写入。读取结果存入共享缓存，写入成功后通知相关资源重新执行普通 `read()`，由服务器版本决定是否获取业务数据。

## 代码入口与职责

| 文件 | 职责 |
| --- | --- |
| `apps/web/app/composables/useApi/index.ts` | 创建客户端、响应式数据、动态 key 监听和写入通知 |
| `apps/web/app/composables/useApi/read.ts` | 检查版本、复用缓存、合并并发读取和保护缓存更新顺序 |
| `apps/web/app/composables/useApi/write.ts` | 执行写入、解包结果、维护写入状态并上报错误 |
| `apps/web/app/utils/api.ts` | 创建 API 客户端，统一解包 Eden 响应、业务响应和错误 |
| `apps/web/app/plugins/api.client.ts` | 创建并注入当前应用的 `$api` |

`$api` 提供统一接口类型。Web 通过 Eden Treaty 发出 HTTP 请求；Android 可通过原生适配访问 Kotlin / Room。`useApi` 的缓存和通知逻辑位于传输层上方，两种实现沿用相同的调用方式。

`useApiMode()` 的 `local`、`remote`、`remote-local` 目前只是预留状态，尚未参与读取、写入的实现选择。实际传输由创建 `$api` 时的适配配置决定。

## 创建客户端

```ts
const phaseId = ref<number | null>(null)

const client = useApi({
  key: () => `tasks:${phaseId.value ?? 'none'}`,
  read: async (api) => {
    const id = phaseId.value
    return id === null ? [] : api.api.task.get({ query: { phaseId: id } })
  },
  write: (api, value: { id: number, title: string }) =>
    api.api.task({ id: value.id }).patch({ title: value.title }),
  watch: true
})
```

### 配置参数

| 参数 | 类型 | 含义 |
| --- | --- | --- |
| `key` | `string` 或 `() => string` | 完整查询标识；冒号前的资源大类也用于写入通知 |
| `read` | `(api) => Promise<Response>`，可省略 | 实际读取函数，可以返回 Eden 响应或普通数据 |
| `write` | `(api, data) => Promise<Response>`，可省略 | 实际写入函数 |
| `watch` | `boolean`，默认未开启 | 有 `read` 时，创建客户端即读取一次，并监听动态 key 的变化 |

客户端可以只配置读取、只配置写入，或同时配置两者。调用未配置的操作会抛错并统一上报；例如没有 `read` 时调用 `client.read()` 会报告“未配置读取方法”。

### 返回值

以下是直接使用 `useApi()` 返回对象时的访问方式：

| 返回值 | 用途 |
| --- | --- |
| `client.key.value` | 当前完整 key |
| `client.data.value` | 当前 key 的共享缓存数据；尚无缓存时为 `undefined` |
| `await client.read()` | 普通读取：先查版本，版本相同时复用缓存 |
| `await client.read.refresh()` | 显式强制读取：仍查版本，但跳过缓存命中判断 |
| `client.read.loading.value` | 当前实例是否仍有读取流程在进行 |
| `await client.write(value)` | 写入，成功后发出通知，返回解包后的写入结果 |
| `client.write.saving.value` | 当前实例是否仍有写入请求在进行 |

页面也可以使用 `reactive(useApi(...))`。此时 Vue 会解包对象属性中的 ref，例如通过 `client.data` 访问数据。项目中常见的 `client.read.loading.value`、`client.write.saving.value` 仍按函数属性中的 ref 访问。

`data` 是计算属性，读取的是当前 key 对应的缓存。不要将不同响应形状的查询放在同一个完整 key 下，也不要把 `data` 当成编辑草稿直接修改；需要编辑时先创建副本。

## key 的格式

统一使用：

```text
资源大类:查询范围或参数
```

| 例子 | 数据范围 |
| --- | --- |
| `phases:all` | 阶段列表 |
| `events:12` | 阶段 12 的课程与排课 |
| `tasks:12` | 阶段 12 的任务 |
| `tips:daily-tips:12:2026-11-15:Asia/Hong_Kong` | 指定阶段、日期和时区的每日提示 |
| `tips:events:12` | 阶段 12 的课程提示写入 |
| `tips:tasks:12` | 阶段 12 的任务提示写入 |
| `styles:all` | 样式预设列表 |
| `preferences:current` | 当前用户偏好 |
| `images:all` | 图片库列表及图片增删通知 |
| `image-files:<图片ID>:thumbnail` | 指定图片的缩略文件 |
| `backgrounds:<背景绑定标识>` | 指定位置的背景绑定 |
| `image-rotations:all` | 随机底图轮播配置 |
| `resources:<查询条件JSON>` | 资源聚合列表的筛选和分页结果 |

完整 key 区分缓存和业务读取的并发合并。例如 `tasks:12` 与 `tasks:13` 是两份缓存；两个客户端使用相同完整 key 时，约定它们读取相同范围、相同形状的数据。

第一个冒号前的内容是通知大类。例如 `tips:events:12` 和 `tips:daily-tips:12:...` 都属于 `tips`。通知按大类匹配，因此写入 `tasks:12` 时，其他 `tasks:*` 读取实例也会收到通知；并发请求仍按完整 key 分别处理。

日期、时区、阶段、筛选条件、分页等只要会改变查询结果，就应反映在完整 key 中。写入专用客户端可以使用对应读取的大类和范围，写入响应本身不会覆盖该 key 的读取缓存。

阶段页面从 `phases:all` 中选择当前阶段；当前样式从 `styles:all` 中取得对应记录。这样列表和当前选择共用同一数据来源，避免给列表和详情使用相同 key 却缓存不同形状的数据。

## `watch` 监听什么

`watch: true` 控制两件事：

1. 客户端创建时立即调用一次普通 `read()`。
2. 动态 key 的字符串值变化时，再调用普通 `read()`。

```ts
phaseId.value = 12 // key 变为 tasks:12，自动读取阶段 12
phaseId.value = 13 // key 变为 tasks:13，自动读取阶段 13
```

动态 key 必须使用函数：

```ts
key: () => `tasks:${phaseId.value ?? 'none'}`
```

直接传入模板字符串会在创建客户端时计算一次，之后它就是静态字符串：

```ts
key: `tasks:${phaseId.value ?? 'none'}`
```

`watch` 监听 key，不会扫描读取函数内部的全部响应式依赖，也不直接监听服务器数据库。某个查询参数变化但 key 字符串没有变化时，不会因此自动重新读取。

未设置 `watch` 或设为 `false` 时，不进行首次自动读取，也不因 key 改变而自动读取。`client.data` 仍会立即切换到新 key 的已有缓存；需要时可以手动调用 `read()`。

**写入通知订阅独立于 `watch`。** 只要配置了 `read`，客户端就会订阅当前资源大类的通知。即使 `watch` 未开启，收到通知后仍会执行普通 `read()`。只有写入函数的客户端不会创建读取订阅。

同一批更新中，如果 key 和通知版本同时变化，通知监听不会额外重复处理 key 的切换：开启 `watch` 时由 key 监听负责读取；未开启时仍保持“不因 key 变化自动读取”的规则。

## 普通读取的流程

```text
read()
  → 增加当前实例的读取计数
  → 记录当前完整 key、资源大类和通知序号
  → 查询 /api/version
  → 若等待期间 key 或通知序号改变，复用 readApi 流程重试
  → 有缓存且 version 相同：返回缓存
  → 无缓存或 version 改变：执行配置的 read 函数
  → 解包结果，保存 version 和 data
  → 减少读取计数，返回结果
```

缓存由当前 Nuxt 应用的 `useState('api:read-cache')` 共享，每个完整 key 保存：

```ts
{
  version: '服务器版本字符串',
  data: '解包后的读取数据'
}
```

`read()` 每次都会走版本查询。命中缓存时可以省去业务数据请求，但不意味着连 `/api/version` 也完全不调用。

### 两种并发合并

版本查询只复用尚未完成的 Promise。同一个 `$api` 的多个并发读取通常共享一次 `/api/version`；版本请求结束后移除该 Promise，后续读取会重新查询版本。

业务读取按 `$api`、完整 key、服务器 version 和通知序号合并。例如两个实例同时读取 `tasks:12`，各自维护 loading，但可以等待同一笔业务请求；`tasks:13` 则需要自己的业务请求。共享请求被其他调用方取消时，等待方会重新走读取流程。

同一完整 key 的数据写入共享缓存后，所有读取这份缓存的 `client.data` 都会响应式更新。对象已经被复制到其他本地 ref 时，应由业务层明确维护副本；缓存更新不会自动重新执行曾经调用过的任意 `.then()` 或初始化函数。

### 强制读取

`client.read.refresh()` 沿用同一个 `readApi` 实现，只使用已有的内部强制标记跳过缓存命中判断。它仍查询版本、维护 loading、参与并发请求合并，并在成功后保存本次版本和数据。

自动写入通知调用 `read()`，不调用 `read.refresh()`。显式强制读取适合用户要求重新获取数据的操作。

## 写入成功后的通知

```text
write(value)
  → 记录发起写入时的资源大类
  → 增加写入计数并执行配置的 write 函数
  → 检查并解包响应
  → 成功：清掉写入前正在复用的版本查询 Promise
  → 增加自身及关联资源的通知序号
  → 各读取实例收到通知，调用普通 read()
  → 返回写入结果；后台读取独立继续
```

写入失败会抛错并上报，不发通知。写入发起后即使当前动态 key 改变，通知仍归属于写入发起时记录的大类。

通知序号保存在 `useState('api:write-revisions')` 中。它用于触发读取监听、区分并发批次和阻止旧业务响应覆盖新缓存，**不用于判定缓存数据是否有效**。缓存能否复用由服务器 version 决定。

写入成功后会丢弃旧的版本请求复用记录，使通知发起的读取重新查询版本。旧版本请求即使稍后完成，也不会删掉后来建立的新请求记录。已经等待旧版本请求的读取，如果发现通知序号变化，会重新执行读取流程。

`await client.write(value)` 等待写入及通知发布，不等待所有通知接收方完成读取。随后读取失败，由读取流程上报；不会把已经成功的写入改成失败。

业务代码保存时直接使用：

```ts
await client.write({ id: 39, title: '新的任务名称' })
```

表单可以继续关闭弹窗、显示成功状态或保留写入返回的编辑结果。无需再为了同步列表传递刷新回调、在 `saved` 事件后调用读取，或紧接着手动执行 `read.refresh()`。

### 当前关联通知

关联关系集中在 `useApi/index.ts` 的 `relatedResources` 中。每次写入通知自身大类，并通知下表列出的关联大类：

| 写入大类 | 额外通知 |
| --- | --- |
| `phases` | `events`、`tasks`、`tips` |
| `events` | `tasks`、`tips` |
| `tasks` | `events`、`tips` |
| `tips` | `events`、`tasks` |
| `images` | `image-rotations` |

例如保存课程排课时，`events`、`tasks`、`tips` 的读取都会收到通知。收到通知只会调用读取，不会递归发布其他大类的写入通知，因此表中的相互关联不会形成通知循环。

`tips:xxx` 的写入会通知每日提示，因为每日提示的 key 属于 `tips:daily-tips:...`。课程、任务列表还嵌有其他资源的数据，相关读取一起重新检查版本。

`resources:*` 聚合查询目前没有加入其他大类的关联通知，图片或任务写入不会因此自动更新资源聚合页。已有的手动重试、查询条件变化以及返回页面时的读取仍可更新该页面。

## 服务器版本与通知序号

两者用途不同：

| 标记 | 来源 | 用途 |
| --- | --- | --- |
| `version` | `/api/version` 返回 | 与缓存版本比较，决定是否获取业务数据 |
| `revision` | 当前前端应用发布的写入通知 | 唤醒监听、区分请求批次和保护结果写回顺序 |

当前 Web 后端返回单一全局 `{ version: string }`，成功的 API `POST`、`PUT`、`PATCH`、`DELETE` 通过公共 HTTP 逻辑更新全局版本；版本读取还会处理按应用时区计算的跨日变化。Android 本地实现也维护自己的单一版本，并处理跨日变化。

因此，当前一次业务写入通常会让所有被通知的读取都发现全局版本变化，进而请求各自的业务数据。通知已经复用普通读取，但尚未按数据大类拆分服务器版本。

`write` 函数本身只定义前端操作；它也可以包装一个返回随机结果的 `GET`。是否产生新的数据版本由后端处理决定。版本未变且已有缓存时，收到通知的普通 `read()` 会命中缓存。

将来按资源拆版本，需要同时调整服务端/原生版本协议和读取端的版本选择。一个查询的有效版本应覆盖其返回内容的依赖，例如任务里嵌有课程名称时，版本策略也应反映该依赖。目前没有新增分版本配置参数，也没有实现分大类版本协议。

## 状态、错误与生命周期

读取和写入各自使用当前实例的 pending 计数，正常返回或抛错都会在 `finally` 中减少。并发时，相关计数归零后 loading / saving 才变为 `false`。

读取计数覆盖版本检查、缓存命中、等待共享请求和必要的重试，不等于实际网络请求数量。写入计数不包含通知后的后台读取时间。

读取失败保留原缓存，通过 `useAppErrors()` 上报并向调用方抛错；`AbortError` 不作为读取错误上报。写入错误也统一上报并抛出。自动读取的监听会捕获 Promise 拒绝，避免未处理的异步错误；界面错误信息仍由统一错误入口提供。

写入前发出的旧业务请求，即使晚于新请求完成，也只有在通知序号仍有效且自己仍是当前查询的最新请求时，才能写入缓存。这个保护针对共享缓存，不会撤销已经完成的服务器写入。

通常应在组件 setup 或组合式函数的作用域中创建客户端，让监听随所属作用域销毁。KeepAlive 中尚未卸载的页面仍保留订阅。临时创建的一次性客户端需要管理自己的 effect scope；图片读取已有 `effectScope()` 配合 `finally(() => scope.stop())` 的例子。

读取缓存是当前应用运行期间的内存状态，没有通过 `useApi` 写入浏览器持久数据库。直接调用 `$api` 而不经过 `useApi.write()`，不会发布这里的前端写入通知；外部客户端的写入也不会主动推送到当前应用，需要后续 `read()` 检查版本才能发现。

相关参考：[Vue watch](https://vuejs.org/api/reactivity-core.html#watch)、[Nuxt useState](https://nuxt.com/docs/4.x/api/composables/use-state)。
