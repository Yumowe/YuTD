# YuTD 开发约定

本文件适用于整个仓库。修改前按涉及的模块阅读对应文档；这里只保留常用规则，细节以关联文档和实际实现核对。

## 工作方式

- 如无必要，勿增实体。优先复用现有组件、工具和业务模块，不为小改动新增抽象层，也不顺带重构无关代码。
- 注释保持精简，说明必要的依赖、边界和业务原因；保留有用的已有注释，不给显然的代码逐句加说明。
- 遇到技术问题，优先检索相关技术的官方文档，按报错、API 名称或行为关键词查找。
- 文档之间或文档与代码存在出入时，先核对相关源码和接口定义，明确当前行为；修改功能时同步受影响的文档。

## 文档入口

| 涉及内容 | 优先阅读 |
| --- | --- |
| 项目定位、平台与目录 | [项目概览](docs/overview.md) |
| 实体、关联、日期与存储 | [数据结构](docs/developer/data-structure.md) |
| 前端结构、共享状态 | [Web 前端](docs/developer/web/frontend.md) |
| 页面、组件与代码排列 | [页面与组件规范](docs/developer/web/page-format.md) |
| 请求、缓存、写入通知 | [API 约定](docs/developer/web/api.md) |
| 路由、业务服务与 Prisma | [Web 后端](docs/developer/web/backend.md) |
| WebView、桥接与资源同步 | [Android 前端](docs/developer/android/frontend.md) |
| Kotlin、Room、鉴权与提醒 | [Android 本地后端](docs/developer/android/backend.md)、[Android README](apps/web/android/README.md) |

## 架构与目录边界

- 使用 Bun workspace，按根目录 `package.json` 和 `bun.lock` 管理依赖与命令。
- `apps/web/` 是 Vue / Nuxt 共用前端，当前 `ssr: false`，通过静态构建供浏览器和 Capacitor WebView 使用。
- Web 业务链路为 `useApi → $api / Eden → Elysia → Prisma / SQLite`；Android 为 `useApi → $api / Eden → 原生适配 → YuTDPlugin → Kotlin / Room`。
- Android 不启动 Elysia、不监听 HTTP，也不在原生能力缺失时回退到 Web 数据源。Web 和 Android 的数据库、认证令牌独立，不能直接互换 SQLite 文件。
- `shared/` 放共享 TypeScript 工具与定义，不能直接当成 Kotlin 模块；跨平台业务规则需要分别保持一致。
- `remote`、`remote-local` 目前是预留模式，不要把内存缓存或数据版本描述为已实现的持久缓存、远程同步。
- 修改源码后重新生成产物，不直接编辑 `.nuxt/`、`apps/server/generated/prisma/`、`apps/server/web/` 或 Android `assets/public/`。本地配置、数据库和上传文件不作为源码提交。

## 前端职责与代码风格

- Vue 单文件组件按 `<script setup lang="ts">`、`<template>`、`<style scoped>` 排列。使用两空格缩进、单引号、不加分号，并沿用 Nuxt 自动导入与现有 ESLint 规则。
- 页面负责业务读取、路由与全局状态组织。按 `phase`、`events`、`tasks`、`tips` 等实体分别通过 props 传入数据和读取状态，操作回调单独传递；不把整个 API 客户端或 `editor` 上下文打包传给子组件。
- 写入由 `components/edit/` 中对应组件内部通过 `useApi.write()` 完成。图片上传、裁剪、背景与轮播沿用 `components/image/` 的职责；展示组件复用这些组件，不另建重复写入逻辑。
- 接口类型优先使用 `ApiData`、`Parameters` 和自动推断，不复制服务端类型，也不从页面导出组件的数据类型。
- 页面 script 顺序为：导入 → 页面配置与类型 → 系统变量 → API 读取 → 普通变量 → 响应式变量 → 计算属性 → 方法 → 监听 → 生命周期 → 对外暴露。分区用简短中文注释，没有内容就省略。
- 组件按功能归组，相关状态、计算、方法和监听放在一起；props 紧邻简短用途说明。不要只为分区增加无意义的函数或状态。
- 初始化正确性优先于机械排序：动态 API key 依赖先声明，可能立即执行的监听放在依赖之后；`computed` 只做派生计算，副作用放在方法、监听或生命周期中。
- 生命周期在 setup 中同步注册；观察器、事件监听、计时器和动画要对应清理，使用 KeepAlive 时考虑激活与停用。
- CSS 基础规则按 DOM 顺序组织，响应式规则集中放后面；整理样式时每个属性单独一行，保留原有层叠关系。

## API、缓存与全局状态

- 通过 `useApi` 统一读写，保持 `client.read()`、`client.write(value)` 的调用方式；需要对象属性自动解包时使用 `reactive(useApi(...))`。
- key 使用 `资源大类:查询范围或参数`。改变查询结果的阶段、日期、时区、筛选和分页必须反映在 key 中；动态 key 传函数，同一完整 key 只能对应相同范围、相同形状的数据。
- `watch: true` 负责首次读取与 key 变化后的读取，无需在页面重复监听；配置了 `read` 的实例即使未开启 `watch`，仍会接收写入通知。
- 普通 `read()` 先检查 `/api/version`，版本一致时复用缓存。`revision` 仅用于通知和并发顺序保护，不能替代服务器版本判断缓存有效性。
- 成功写入由 `useApi` 自动通知自身和关联资源重新执行普通 `read()`；不要为了列表同步，再在保存事件后重复读取或强制刷新。事件可用于关闭弹窗、更新选择等界面行为。
- `read.refresh()` 只用于确实需要跳过缓存的显式操作。`await write()` 不会等待通知触发的后台读取全部结束；`resources:*` 聚合查询目前不在其他资源的自动关联通知中。
- 读写状态分别使用 `client.read.loading.value`、`client.write.saving.value`；错误沿用 `useAppErrors()`。客户端在 setup 或受管理的 effect scope 中创建。
- 缓存数据不是编辑草稿；编辑时创建副本。`useState` 是应用运行期内存状态，不会因打成 APK 自动持久化。
- 偏好统一使用现有命名 `useAppPeferences()`，只在 `app.vue` 初始化；初始化后直接修改共享偏好，由监听顺序保存，写入响应不回填覆盖新值。
- 样式统一使用 `useAppStyle()` 的共享草稿：实时预览，显式保存，撤销恢复快照；切换预设保留各自未保存的修改。

## 数据与后端规则

- Web 模块保持 `index.ts` 声明路由、`model.ts` 声明输入校验和类型、`service.ts` 实现业务规则；数据库结构集中在 `apps/server/prisma/schema.prisma`。
- 普通响应、错误和成功写入后的版本更新沿用公共 HTTP 逻辑，不在各模块重复包装响应或重复递增版本。
- `Phase` 从周一开始、周日结束，包含完整自然周；排期 `weekday` 使用 1～7，`weeks` 是阶段内周次，时间为 `HH:mm`。
- 任务必须归属阶段，可关联同阶段事件；计划时间存在时必须早于截止时间。`completed` 仅在 `DONE` 时为真；完成或取消记录 `completedAt`，恢复后清空；取消也属于关闭状态。
- 日历日期与瞬时时刻分开处理：阶段、日周关联保留日期语义，任务和提醒时刻结合偏好中的 IANA 时区，优先复用现有时间工具。避免用机器时区或随意截取 ISO 字符串替代业务日期。
- 正常 `$api` 经过 Eden 日期解析；直接 `$native` / `$localApi` 返回的桥接日期仍是字符串，不能混用调用层的假设。
- `prisma:generate` 只生成客户端和新库初始化 SQL，不是已有数据库的迁移命令；结构变更需核对已有数据的升级方式。原生结构变更另行核对 Room schema 与迁移，数据版本不等于结构版本。
- 默认样式复用 `shared/assets/style-presets.json`；提醒偏好属于 Preferences，不放回系统配置。

## Android 实现与交付

- `YuTDPlugin.kt` 负责桥接参数、协程与结果返回，业务规则留在 `local/` 各模块 Service；Model 放模块类型、默认值、Entity、DAO 与纯转换。
- Service 只使用所属 DAO；跨模块访问调用对应 Service。`local/utils/` 不查询业务表。
- 外部原生业务调用统一经过 `LocalDatabase.access()` 鉴权；写入与数据版本在事务中提交。新增原生能力同步检查 TypeScript 适配、插件入口与 Kotlin 实现。
- 提醒由前端生成完整计划，经 `syncReminders()` 提交原生持久队列；`ReminderScheduler` / `ReminderReceiver` 维护最近一个系统闹钟并滚动处理。保留 `reminderQueue` 能力检查，不退回逐条无限量登记或 JS 定时器投递通知。
- 保留 `viewport-fit=cover`、SystemBars 与 `--app-safe-*` 安全区处理；系统返回沿用关闭弹窗、退出编辑、页面返回、首页退到后台的既有顺序。
- 前端变化需要构建、同步资源、重新打包；新增 Kotlin 能力必须安装新 APK，仅替换前端资源不会增加原生方法。

## 常用命令与验证

除另行标注，命令在仓库根目录执行：

```sh
bun install
bun run dev
bun --filter @yutd/web typecheck
bun --filter @yutd/web lint
bun --filter @yutd/server typecheck
bun --filter @yutd/server prisma:generate
bun run build
bun run docs:build
```

`bun run dev` 同时启动两端；也可分别执行 `bun run web`、`bun run server`。前端开发端口为 `4017`，静态产物在 `apps/server/web/`；可执行文件构建使用 `bun run build:binary`。

Android 使用 JDK 21、Android SDK 36，最低支持 API 24。先在根目录执行 `bun run build`，然后：

```powershell
# 在 apps/web/ 执行
bunx cap sync android

# 在 apps/web/android/ 执行
.\gradlew.bat :app:assembleDebug
# 需要安装到在线设备时执行
.\gradlew.bat :app:installDebug
```

按改动范围运行相关类型检查、lint、构建或交互验证；涉及业务规则时检查关联、状态、时间边界与两端一致性。纯文档改动核对内容、命令和链接即可，不为此运行完整应用构建。交付时说明实际执行的验证及未验证部分。
