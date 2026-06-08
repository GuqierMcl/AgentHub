# Hub Server 架构

`hub-server/` 目录包含基于 Node/Bun + Hono 的平台后端，也可以称为 API Server。

## 定位

Hub Server 是 AgentHub 的控制面，负责业务状态管理和前端 API。它不直接承担具体 Agent 执行过程，而是将执行请求交给 `agent-runtime`。

## 职责

- 向 `web` 提供平台 API。
- 管理用户鉴权。
- 管理会话、消息、Agent 配置和 Artifact 元数据。
- 管理 Artifact 版本。
- 持久化 Run 状态。
- 持久化 Runtime 事件。
- 向前端转发 SSE 或其他实时事件。
- 向前端发布全局 best-effort 产品状态事件。
- 在生产环境托管 Web 静态资源。
- 将 AI 执行请求转发给 `agent-runtime`。
- 将 Runtime 事件转化为消息、Artifact、Diff、部署记录和 Run 状态等业务数据。

## 生产分发与入口

生产分发、CLI/Desktop 入口、扁平发行包、Web 静态资源托管和 Runtime Sidecar 启动约束见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

首版生产形态采用以下规则：

- 发行包为扁平目录：`agenthub-cli(.exe)`、`hub-server(.exe)`、`agent-runtime(.exe)` 和 `public/` 位于同一级。
- `build:hub` 只编译 HubServer 并校验 `web/dist/` 存在，不复制 Web 资源；最终发行包由 package 阶段直接复制 `web/dist/` 到 `dist/public/`。
- CLI 只作为生产 supervisor，负责启动 HubServer、等待 `/health`、打印或打开 `http://127.0.0.1:<port>`；CLI 不直接启动 Agent Runtime。
- Desktop 主进程直接启动 HubServer，并让 WebView 打开 HubServer 托管的本地 URL；Desktop 不通过 CLI，也不使用 `views://` 或 `file://` 加载 Web。
- HubServer 是浏览器和 Desktop WebView 的唯一后端入口，并在生产环境托管 Web `public/`。
- 未提供 `--runtime-bin` 时，HubServer 保持开发模式行为，使用 `--runtime-url` 或默认 Runtime URL 连接已手动启动的 Agent Runtime。

HubServer 生产入口应支持：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `--runtime-bin` | string | Agent Runtime 二进制路径；提供时启用 Sidecar 自动启动。 |
| `--public-dir` | string | Web dist 目录；提供且未禁用 Web 时启用静态文件托管。 |
| `--no-web` | boolean | 禁用静态文件托管，作为未来扩展点；CLI/Desktop 首版不使用。 |
| `--runtime-url` | string | 开发或调试时连接已运行 Runtime；生产 Sidecar 启动成功后由实际 Runtime URL 覆盖。 |

生产入口必须显式调用 `Bun.serve()`，并在数据库初始化和 Runtime 就绪后再接收请求。

## Sidecar 管理

HubServer 负责管理 Agent Runtime 侧车进程的完整生命周期。这是 HubServer 的核心职责之一。

### 启动

- HubServer 启动时，通过 `Bun.spawn` 或等价方式拉起 Agent Runtime 子进程。
- 传入参数：`--port`、`--hostname`、`--hub-callback`、`--workdir`、`--log-level` 等。
- 监听地址默认固定为 `127.0.0.1`。
- HubServer 预分配 Runtime 端口并传给 Runtime；若遇到端口占用，应重新分配并重试一次。
- 启动后轮询 Agent Runtime 的 `/health` 端点，等待就绪信号。
- Agent Runtime `/health` 只有在 Runtime 初始化完成后才应返回 `status = "ok"`。
- 超时（默认 10 秒）未就绪则标记启动失败，上报错误。
- 生产环境应为 HubServer 到 Runtime 的内部调用生成每次启动唯一 token，并通过请求头 `x-agenthub-runtime-token` 调用 Runtime `/runtime/*` API。

### 监控

- HubServer 监听 Agent Runtime 子进程的 `exit` 事件。
- 若 Agent Runtime 异常退出，HubServer 应自动重启（指数退避策略）。
- 连续重启失败 3 次后，停止重试，标记为不可用。
- RuntimeClient 必须使用当前 Runtime URL；如果 Sidecar 重启后端口变化，RuntimeClient 需要更新 base URL。

### 优雅关闭

- HubServer 收到 SIGTERM/SIGINT 时，先向 Agent Runtime 发送 SIGTERM。
- 等待 Agent Runtime 完成当前任务并退出（默认 5 秒超时）。
- 超时后发送 SIGKILL 强制终止。

### 开发环境

- 开发环境下，Agent Runtime 可手动独立启动（`cd agent-runtime && bun dev`）。
- HubServer 应支持通过环境变量或配置跳过自动拉起 Sidecar 的逻辑，允许连接到已独立运行的 Agent Runtime。

## Web 静态资源托管

生产环境中，HubServer 托管构建后的 Web `public/`。静态资源托管属于 HubServer 启动装配层，不属于领域 router。

规则：

- API router 先注册，静态资源和 SPA fallback 后注册。
- SPA fallback 不得吞掉未知 `/api/*` 请求；未知 API 应返回结构化 404，而不是 `index.html`。
- `--no-web = false` 且 `--public-dir` 存在时启用托管。
- CLI/Desktop 首版都通过 HubServer 托管 Web，因此前端可以继续使用相对路径 `/api/*` 和 `/api/events`。
- 首版不要求把 Web assets 嵌入 HubServer 单 exe；`public/` 随发行包分发，并由 package 阶段从 `web/dist/` 复制到最终发行目录。

## 系统服务状态

HubServer 暴露 `GET /api/system/services/status` 作为 Web 的系统服务状态初始快照入口。浏览器不直接访问 Agent Runtime 或 OpenCode server。

该接口聚合 Agent Runtime 自身健康状态、Runtime 管理的外部智能体状态，以及 HubServer 侧的未接入占位项。响应服务顺序固定为 `agent-runtime`、`opencode`、`codex`、`claude-code`。当 Agent Runtime 不可达时，接口仍返回 200，`agent-runtime` 与已实现但依赖 Runtime 的外部服务（当前 `opencode`、`codex` 与 `claude-code`）标记为 `error`，未接入服务保持 `not_integrated`，这样 Web 可以稳定渲染系统状态栏。

HubServer 进程内还运行 `ServiceStatusMonitor`，默认每 7 秒复用同一套聚合逻辑观察服务状态。首次快照只建立基线；后续当某个服务的 `status` 变化时，通过全局事件总线发布 `service.status.changed`，由 Web 更新共享 service status store，并驱动左侧状态面板与聊天输入框下方的外部智能体状态栏刷新。HubServer 不决定聊天流提示，也不把服务状态事件写入会话消息或 Runtime replay。

## 规则

- `web` 必须把 `hub-server` 视为唯一后端入口。
- `hub-server` 不拥有 Provider 级 LLM 逻辑。
- 具体执行、适配器调用、工具调用、Workspace 和沙箱能力属于 `agent-runtime`。
- `hub-server` 负责 Agent Runtime 侧车进程的启动、监控、重启和关闭。
- HubServer 调用 Agent Runtime 的 API 变化必须同步更新 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`。HubServer 面向浏览器的 `/api/*` 产品 API 后续应独立建档。
- Hono 路由、Context、中间件、错误响应、流式输出和测试约定应遵循 `docs/reference/HONO.md`。

## Run 持久化与流式恢复

阶段 2 起，HubServer 是聊天产品事实源。Web 聊天主路径不再直接创建 Runtime Run，而是调用 HubServer 产品 API：

- `POST /api/conversations/:conversationId/messages/send`
- `POST /api/conversations/:conversationId/messages/:messageId/regenerate`
- `GET /api/conversations/:conversationId/messages`
- `GET /api/conversations/:conversationId/artifacts/:artifactId`
- `POST /api/conversations/:conversationId/artifacts/:artifactId/revert/preview`
- `POST /api/conversations/:conversationId/artifacts/:artifactId/revert`
- `GET /api/runs/:runId/events?afterSequence=`
- `POST /api/runs/:runId/cancel`

HubServer 的职责：

- 会话列表 API 返回最近一条消息的 `lastMessageContent`，内容来自 `lastMessageId` 对应消息 text parts，最多 50 个字符；列表 API 不承担 Run 运行状态初始化，卡片运行状态由 Web 已打开 conversation 的本地 Zustand 状态展示。
- 创建 user `Message` 和 text `MessagePart`。
- `POST /api/conversations/:conversationId/messages/send` 支持可选 `replyToMessageId`。HubServer 校验回复目标属于同一会话、是可见 chat user/assistant 消息，然后在新 user `Message` 上写入 `parentMessageId` 和 `metadataJson.replyTo` 快照；原始 text `MessagePart` 仍只保存用户正文。
- `POST /api/conversations/:conversationId/messages/:messageId/regenerate` 支持对已完成 assistant chat 消息重新生成。HubServer 校验目标消息后，从源 Run 的 trigger user message 复制原始文本创建新 user trigger，写入 `metadataJson.regenerate`，并创建新 Run；Runtime 协议不扩展，重新生成语义由 HubServer 格式化进当前 user content 和后续 replay context。
- 创建本地 `Run`，并将 Runtime 返回的 `runId` 写入 `Run.runtimeId`。
- 从持久化 messages 组装 Runtime `history` 和 `RunInput`，并在创建真实聊天 Run 时读取 HubServer “输出设置”快照，将 `includeModelStream`、`includeReasoning` 和 `includeRawModelChunks` 注入 Runtime `diagnostics`。
- 回复引用进入模型上下文时不扩展 Agent Runtime 协议。HubServer 使用统一 formatter 从持久化消息派生模型可见文本：当前触发消息、Runtime history、OpenCode external context bootstrap/delta、以及 pinned message context 都按同一规则把 `metadataJson.replyTo` 拼成引用块。这样内部智能体和外部智能体 replay 都能看到相同的回复语义，即使父消息不在当前 history/delta 窗口内。
- 重新生成语义同样进入该 formatter：`metadataJson.regenerate` 会被格式化成“基于同一用户请求生成替代回复”的模型可见块。新 assistant message 投影时，HubServer 从 stored `Run.inputJson.regenerate` 读取源 assistant id 并写入 `Message.regeneratedFromId`，旧消息和旧事件保持不可变。
- 创建 direct 外部智能体 Run 前，按 provider、agentId、conversation、workspace 与 `conversation-visible` scope 查询可复用外部 Session，并通过 Runtime `externalSessionHints` 注入。
- 后台消费 Runtime SSE，将 Runtime events 以 per-run micro-batch 持久化为 `RunEvent.id = event.id`、本地递增 `sequence`；raw payload 永久保留，未知事件也不丢。
- 持久化成功后才向 run-level SSE 订阅者发布 envelope；默认 batch 延迟约 50ms，terminal event 强制 flush。
- 将 `message.delta` / `reasoning.delta` 合并投影到 assistant `MessagePart` / `RunReasoningBlock`，减少 SQLite 写入；`message.completed`、`reasoning.completed` 和 terminal event 强制追平。
- `Run.lastProjectedSequence` 记录结构化投影进度，读取历史消息或组装 Runtime history 前会从 raw `RunEvent` 补投影。
- 将 `tool.completed(toolName="write_plan")` 投影到 `Run.planJson`。
- 将 `agent.started.data.externalSession` 投影到 `ExternalAgentSession`，持久化 provider session link，供后续 direct 外部智能体调用续接正确的 conversation-visible session。
- 消费 `system_agent.completed(systemAgentId="title")`，仅当 `Conversation.metadataJson.titleSource` 不是 `manual` 时更新 `Conversation.title`，并把 `titleSource` 标记为 `auto`。
- 在 `GET /api/conversations/:conversationId/messages` 中返回 `timelineRuns`，每个 run 带 trigger user message 和按 `RunEvent.sequence` 排序的产品 event envelopes，供 Web 聊天主 UI 恢复；完整 raw Runtime event 留在 `RunEvent.payloadJson`。
- Terminal `run.completed` / `run.failed` / `run.cancelled` 中存在 `data.workspaceDiff` 且有 changed files 时，继续投影 `Artifact(type="diff")`，并同时创建 `WorkspaceChangeSet` / `WorkspaceChangeSetFile`。ChangeSet 由 HubServer 基于已有 RunToolCall、RunTask、Message 和 Run input 推导归因；内部 `write_file` / `edit_file` 可在路径唯一匹配时归因到具体 toolCallId，外部智能体 V0 只保守归因到 agent aggregate。`WorkspaceChangeSet.sourceEventId` 唯一，terminal event replay 不重复创建。
- 通过 `GET /api/conversations/:conversationId/artifacts/:artifactId` 提供 conversation-scoped Artifact Detail；Diff artifact 返回 current version、`ArtifactVersion.diffJson` 派生的文件摘要、bounded patch 文本、dirty baseline、runOnlyReliable、truncated 和 limitations，供 Web 右侧只读 Diff Viewer 恢复。若存在 ChangeSet，`diff.changeSet` 返回顶部归因摘要，`diff.changedFiles[]` 返回文件级 attribution。跨会话或不存在的 artifact 返回稳定 `ARTIFACT_NOT_FOUND`。
- 通过 `POST /api/conversations/:conversationId/artifacts/:artifactId/revert/preview` 和 `/revert` 提供 conversation-scoped 完整 Run Diff 撤销。HubServer 校验 artifact 属于当前 conversation、类型为 `diff`、存在 current version、不是 `workspace.revert` 撤销记录且关联原 Run/workspace；workspace root 只从原 Run `inputJson.workspace` 读取，浏览器请求体不传本机路径。HubServer 将 source patch、changed files、baselineDirty/runOnlyReliable 等事实转发给 Agent Runtime `/runtime/workspace/revert/*`。成功撤销后，HubServer 创建系统 assistant 消息“已撤销本次工作区变更”，挂载新的 `source = "workspace.revert"` Diff Artifact、`source = "diff_apply"` ArtifactVersion，并创建新的 WorkspaceChangeSet/files，归因为 `run + aggregate`。同一 source artifact 已成功撤销时，再次 apply 返回 `already_applied` 与既有 artifact，不重复执行。
- 将持久化后的 RunEvent 发布到进程内 event bus，供 Web 产品 SSE 订阅。
- 通过 `GET /api/events` 发布非持久化、无 replay 的全局产品状态事件，用于会话标题、最近消息、Run 状态和 service status 等低频 UI 通知。

`GET /api/runs/:runId/events` 使用 HubServer 本地 Run id，并返回 `event: run.event`。data 形如 `{ sequence, event }`，其中 `event.runId` 是 HubServer 本地 Run id，`event.runtimeRunId` 保留 Agent Runtime run id；完整 Runtime 原始事件仍保存在 `RunEvent.payloadJson`。Web 切回会话时先加载 `timelineRuns` 并用 live SSE 相同 projection reducer 重放产品 event envelopes，再用 `activeRun.lastEventSequence` 作为 `afterSequence` 续订。

完整机制见 `docs/architecture/RUN_EVENT_SCHEMA_AND_PROJECTION.md` 与 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`。

全局状态通知机制见 `docs/architecture/HUB_GLOBAL_EVENTS.md`。

## Hono 使用约定

- 浏览器侧 API 统一由 `hub-server` 暴露，建议使用 `/api/*` 作为 API 路径前缀。
- 保留 `/health` 作为健康检查端点。
- 将会话、消息、Agent 配置、Artifact、Run 等领域路由拆分到独立模块，再由入口文件统一挂载。
- 请求鉴权、请求 ID、日志、CORS、错误处理等横切能力优先通过 Hono 中间件实现。
- 默认使用结构化 JSON 响应；错误响应应包含稳定 `code` 与可读 `message`。
- SSE 或其他实时转发能力由 `hub-server` 面向前端提供，但事件来源应来自 `agent-runtime`。
- 新增或修改 HubServer 调用 Agent Runtime 的 API 时，同步更新 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`；面向浏览器的 `/api/*` 产品 API 后续应进入独立 HubServer API 文档。
- **重要：实现任何 Hono 相关功能时，必须优先参考 Hono 官方 LLM 文档 `https://hono.dev/llms-small.txt`。**

## OpenAPI 与 Swagger UI

Hub Server 使用 `@hono/zod-openapi` 生成 OpenAPI 规范，使用 `@hono/swagger-ui` 提供 Swagger UI。

### @hono/zod-openapi

基于 Zod Schema 自动生成 OpenAPI 文档，同时复用 Zod Schema 完成请求校验。

使用约定：

- 路由定义应使用 `createRoute` + `app.openapi(route, handler)` 风格，替代普通 `app.get/post`。
- 每个路由必须声明 `request.body`、`request.params`、`request.query` 等的 Zod Schema，以及 `responses` 的 Zod Schema。
- Zod Schema 同时承担校验与文档生成双重职责，不需要额外维护独立的 OpenAPI 定义。
- 校验失败时由框架自动返回结构化错误，格式与现有错误约定保持一致（`code: 'VALIDATION_ERROR'`）。
- 非标准 REST 路由（如 SSE 端点）可以不纳入 OpenAPI，但应在文档中注明原因。

### @hono/swagger-ui

提供可交互的 API 文档界面。

使用约定：

- Swagger UI 挂载路径统一为 `/docs`，仅开发模式或通过配置开关启用。
- 生产环境默认关闭 Swagger UI，避免暴露 API 细节。
- OpenAPI JSON 端点挂载路径为 `/api/doc`，供前端或其他工具消费。
- Swagger UI 和 OpenAPI 端点的启停应通过环境变量或配置控制，不硬编码开关。

## 数据存储

### 数据库

Hub Server 使用 SQLite 作为持久化数据库，Prisma 作为 ORM，Zod 作为运行时校验层。

#### SQLite

选择理由：

- 单文件部署，零运维，适合桌面端和本地优先场景。
- 事务支持完整，满足会话、消息、Run 状态等业务一致性需求。
- 与 Bun 运行时原生兼容，无需额外数据库进程。

#### Prisma

Hub Server 使用 Prisma 管理 SQLite 的 Schema、迁移和数据访问。

使用约定：

- 数据模型定义在 `prisma/schema.prisma` 中，以 Prisma Schema 作为数据建模的唯一来源。
- Prisma ORM 7 使用 `generator client { provider = "prisma-client" output = "../src/generated/prisma" }`，由 `src/lib/db.ts` 动态加载生成的 client。
- `prisma.config.ts` 负责 Prisma CLI 配置，包含 `schema`、`migrations.path`、datasource URL 和本地 SQLite 文件初始化；CLI 默认 datasource 仍指向 `prisma/data-tmp/dev.db`，可通过 `DATABASE_URL` 显式覆盖。
- Prisma CLI 命令通过 `hub-server/package.json` scripts 运行，确保开发工作流入口集中管理。
- 当前阶段 `bun dev` 会先执行 `bun run dev:migrate`，由该 helper 按 Hub Server 数据目录注入 `DATABASE_URL` 后运行 `prisma:migrate:deploy`，再启动 Hub Server；应用运行时代码不得直接执行 `prisma migrate deploy`。
- SQLite 在 Bun 下通过 `@prisma/adapter-libsql` 适配到 Prisma Client。
- 初始化连接后启用 `journal_mode = WAL`、`synchronous = NORMAL` 和 `busy_timeout = 5000`，降低 Runtime SSE 高频持久化时的写锁阻塞。
- 启动时不得删除、截断或重建 `hub.db-wal` / `hub.db-shm`。WAL 文件可能包含已提交但尚未 checkpoint 到主库的消息、Run 和 RunEvent；SQLite 会在打开数据库时完成恢复。HubServer 正常关闭时会尝试执行 `PRAGMA wal_checkpoint(TRUNCATE)`，但异常退出后必须保留 WAL 供下次启动恢复。
- 通过 `prisma migrate` 管理迁移文件和开发环境部署；应用运行时代码不拼接或执行业务 DDL，也不直接 shell 执行迁移命令。
- 数据访问统一通过 Prisma Client 进行，不使用原生 SQL 拼接。
- Prisma 的 datasource URL 应动态指向数据目录下的 `hub.db`，不硬编码路径。
- 新增或修改数据模型时，必须同步更新 `docs/architecture/DATA_MODEL.md`。

#### Zod

Hub Server 使用 Zod 进行 API 边界的运行时类型校验。

使用约定：

- 所有 API 请求体（POST / PUT / PATCH）必须使用 Zod Schema 校验后再进入业务逻辑。
- 可在 Hono 中间件或路由入口完成校验，校验失败应返回结构化错误（`code: 'VALIDATION_ERROR'`，附带字段级错误信息）。
- 可与 Hono 的 `zValidator` 中间件配合使用。
- 环境变量、配置文件等外部输入同样应使用 Zod 校验。
- Zod Schema 可作为 HubServer 产品 API 契约的类型来源；后续建立 HubServer API 文档后应与其保持同步。调用 Agent Runtime 的 schema 则与 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md` 保持同步。
- 避免在业务逻辑中混用 Zod 校验和手动 if/else 断言，统一走 Schema。

### 启动初始化

Hub Server 在启动时必须完成数据库初始化：

1. **解析数据目录**：通过 `getAppDataDir()` 获取数据目录路径。
2. **确保目录和 SQLite 文件存在**：若数据目录不存在，使用 `fs.mkdir(path, { recursive: true })` 递归创建；若 `file:` URL 指向的 SQLite 文件不存在，先创建空文件。
3. **生成 Prisma Client**：若生成产物缺失或落后于 schema，运行 `bunx --bun prisma generate`，确保生成代码与应用版本一致。
4. **初始化 Prisma Client**：使用 `@prisma/adapter-libsql` 创建 Prisma Client 实例并验证连接。

初始化顺序约束：

- 数据库初始化必须在 Hono 路由注册之前完成。
- 若初始化失败，服务应终止启动并输出明确错误信息，不允许在无数据库状态下运行。
- Prisma 7 的 SQLite migrate/status 流程要求目标数据库文件已存在；开发迁移由 `dev:migrate` / `prisma.config.ts` 在 CLI 执行前确保文件存在，`initDatabase()` 仅在 Prisma Client 连接前确保文件存在。
- 当前阶段迁移由开发脚本在 Hub Server 进程启动前完成，`initDatabase()` 不承担迁移职责。
- Prisma 迁移应幂等，重复执行不应导致数据丢失或冲突。

### 生产二进制约束

生产构建后的 `hub-server(.exe)` 不得在运行时依赖 `bunx`、Prisma CLI 或源码生成步骤。

生产规则：

- Prisma Client 必须在构建期生成，并随 HubServer 构建产物可用。
- 生产环境下 `initDatabase()` 不得执行 `bunx --bun prisma generate`。
- 生产迁移策略必须在实现前明确；可以使用随包分发的 SQL migrations 和轻量 runner，但应用运行时代码不得拼接业务 DDL。
- Native/WASM 依赖（Prisma runtime、SQLite/libsql adapter、`node-pty`、`sharp` 等）必须纳入发行包 smoke test。

### 数据目录

数据文件存储在用户数据目录下，通过 Node.js API 动态获取，不硬编码路径：

```ts
import { getAppDataDir } from './path'

const dbPath = path.join(getAppDataDir(), 'hub.db')
```

其中 `getAppDataDir()` 应基于以下方式实现：

- 优先读取环境变量 `AGENTHUB_DATA_DIR`（支持自定义数据目录）。
- 若未设置，使用 `path.join(os.homedir(), 'AppData', 'Roaming', 'AgentHub')`（Windows）或对应平台的用户数据目录。

核心约束：

- 不得硬编码任何平台特定的绝对路径。
- 数据目录不存在时应自动创建。
- 数据库文件应位于数据目录根下，命名为 `hub.db`。
- 后续如需存储附件、产物文件等非数据库数据，统一放在数据目录下的子目录中（如 `artifacts/`、`uploads/`），子目录按需创建。

## 日志

Hub Server 使用 Pino 作为结构化日志库，禁止直接使用 `console.log/error/warn/info/debug`。

### 基本规则

- 所有日志输出必须通过 Pino logger 实例，禁止 `console.*`。
- 生产环境输出 JSON 格式，不使用 `pino-pretty` 美化。
- 每个 HTTP 请求绑定唯一 `reqId`，通过 `logger.child({ reqId })` 创建请求级子日志。
- 日志级别通过 `--log-level` CLI 参数或 `LOG_LEVEL` 环境变量配置，默认开发 `debug`、生产 `info`。

### 日志级别语义

| 级别 | 语义 | 典型场景 |
|---|---|---|
| `fatal` | 服务不可恢复错误 | 数据库初始化失败 |
| `error` | 请求级错误，服务继续运行 | 未捕获异常、Runtime 转发失败 |
| `warn` | 非预期但可恢复 | 配置使用了默认值 |
| `info` | 关键业务事件 | 服务启动/关闭、请求完成 |
| `debug` | 调试信息 | 路由匹配、转发详情 |
| `trace` | 极细粒度 | 函数进入/退出 |

### 日志禁止事项

- 不在校验通过的请求体上打日志（避免泄露 API key 等敏感数据）。
- 不在正常运行的热路径上打 `info` 以上级别日志。
- 不在循环内部打日志。

### 文件组织

- 日志创建与配置在 `src/lib/logger.ts`。
- 请求日志中间件也在 `src/lib/logger.ts` 中导出。
- 其他模块通过 `import { logger } from '../lib/logger'` 使用。

### 设计约束

- Pino logger 在 `src/lib/logger.ts` 中以单例方式创建和导出。
- 请求日志中间件在 `src/index.ts` 中注册为 Hono 全局中间件。
- `src/lib/errors.ts` 的 `errorHandler` 使用 `logger.error` 替代 `console.error`。
- `RuntimeClient` 转发失败时使用 `logger.error` 记录详情。

## 开发命令

```bash
cd hub-server && bun dev
```

`bun dev` 会先运行 `bun run dev:migrate`，再以 hot reload 方式启动 `src/index.ts`。`dev:migrate` 会按 `DATABASE_URL` 优先、`AGENTHUB_DATA_DIR` 次之、平台默认数据目录兜底的顺序解析目标 `hub.db`，再执行 `prisma:migrate:deploy`。这是开发阶段临时迁移策略；生产环境迁移 runner 暂不实现。

开发环境若要使用自定义数据目录，应优先设置 `AGENTHUB_DATA_DIR`，确保 Prisma CLI 前导迁移和 Hub Server 运行时解析到同一个 `hub.db`。当前临时脚本不会把 `bun dev -- --data-dir ...` 参数转译为 `DATABASE_URL`。
