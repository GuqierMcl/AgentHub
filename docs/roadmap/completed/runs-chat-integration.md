# Runs 聊天链路接入路线图

> 状态：已完结，交付归档。后续 Artifact 投影、权限 UI、MessagePart 恢复和生产化增强已提取到 `docs/backlog/AGENT_SIDE_CAPABILITY_BACKLOG.md`。

## 模块名称

Runs Chat Integration

## 目标

分阶段跑通 AgentHub 的真实聊天执行链路，并逐步从前端未持久化原型演进到 HubServer 产品级持久化入口：

```text
web -> hub-server -> agent-runtime
```

首要目标是尽快验证 Runtime Runs、SSE、模型绑定、会话成员和前端流式渲染是否能在真实 Web 聊天界面中工作；随后再把消息、Run、事件、权限和产物纳入 HubServer 业务状态。

## 完成标准

- Web 可以在已创建 conversation 中发送真实消息，并通过 HubServer 调用 Agent Runtime。
- 单聊文本消息可以从 user input 触发 Runtime Run，并在 Web 中流式展示 assistant 回复。
- 用户可以在智能体回答过程中切换会话；切换只断开当前前端 SSE 订阅，不取消 Runtime Run。切回执行中的会话后，Web 使用该会话保存的最近 active `runId` 重新订阅事件流，并恢复流式输出。
- 群聊可以在未显式 @ 时默认进入 `orchestrator`，显式 @ 单个主智能体的能力后续接入。
- HubServer 后续提供产品级发送入口，负责消息、Run、RunEvent、PermissionRequest 与 conversation 统计字段持久化。
- 前端会话状态从局部 `useState` 迁移到 Zustand + TanStack Query 的组合模型。
- 所有 Agent Runtime 契约变更同步更新 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`，状态管理和 UI 架构变更同步更新 `docs/architecture/WEB.md`。

## 依赖文档

- `docs/product/PRODUCT_SPEC.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/WEB.md`
- `docs/architecture/HUB_SERVER.md`
- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- `docs/contracts/RUNTIME_SSE_EVENTS.md`
- `docs/reference/HONO.md`

## 范围

### 包含

- Web 聊天模块接入真实 conversation detail、message draft、Runtime Run 和 SSE。
- Web 状态管理迁移到 Zustand + TanStack Query。
- HubServer 产品级消息发送入口。
- Runtime RunEvent 到 HubServer 业务状态的投影。
- 基础权限审批链路。
- Orchestrator 计划、任务、工具事件的 UI 投影。
- 后续 Artifact、Diff、文件、预览和部署状态事件投影。

### 不包含

- 浏览器直接调用 Agent Runtime 或 LLM Provider。
- 在 Runtime 中写 HubServer 业务数据库。
- 在第一阶段引入持久化消息写入。
- 在第一阶段完整实现权限审批、工具详情、产物卡片和任务面板。
- 未经文档更新就变更 Runtime RunInput、SSE 事件或 HubServer 产品 API。

## 阶段拆分

### 阶段 0：状态管理准备

目的：让后续聊天接入不继续堆在组件局部 `useState` 中。

任务：

- 引入 `@tanstack/react-query`，在 `App` 根部安装 `QueryClientProvider`。
- 保留 Zustand 负责 UI 与临时运行态：当前会话 id、草稿、未持久化消息、活动 Run、SSE 连接状态、右侧 workbench UI 状态。
- 使用 TanStack Query 负责服务端状态：conversation list、conversation detail、agents、providers、后续 messages/runs。
- 将当前 `ChatWorkspace` 中的 conversation list loading、active conversation id、rename state 拆分：
  - server cache：conversation list/detail。
  - global UI store：active conversation id、dialog 状态、草稿、临时 streaming messages。
- 为每个 conversation 在 Zustand 中记录运行态：
  - `activeRunId`
  - `activeRuntimeRunId`
  - `runStatus`
  - 已收到的 Runtime event id 集合或事件列表
  - 当前 SSE 连接状态
- 明确 Activity 生命周期规则：SSE 连接和活动 Run 状态不得放在会被 Activity hidden 清理的子组件 effect 中。
- 明确会话切换规则：切走会话时关闭该会话 EventSource；不得调用 cancel。切回时，如果该会话存在非终态 active run，则重新打开 SSE 并通过 replay 恢复状态。

出口标准：

- 会话列表和当前会话选择由 Query + Zustand 管理。
- 现有新建、重命名、pin/archive 流程保持可用。
- `bunx tsc --noEmit -p tsconfig.app.json` 通过。

### 阶段 1：Web 未持久化 Runs 聊天闭环

目的：最快验证真实执行链路，不新增 HubServer 产品写入逻辑。

链路：

```text
Web local message state
  -> POST /api/runtime/runs
  -> HubServer proxy
  -> POST /runtime/runs
  -> GET /api/runtime/runs/:runId/events
  -> Web local streaming state
```

任务：

- 在 Web 增加 Runtime Runs API client，复用现有 HubServer 转发接口：
  - `POST /api/runtime/runs`
  - `GET /api/runtime/runs/:runId/events`
  - `POST /api/runtime/runs/:runId/cancel`
- 发送消息时从当前 conversation detail 组装 Runtime `RunInput`：
  - `conversationId`
  - `mode`
  - `participantAgentIds`
  - `addressedAgentIds: []`
  - `userMessage`
  - `history`：由 Web 内存消息投影为 `{ role, agentId?, content }`
  - `conversationState.messageCountBeforeRun`
  - `conversationState.titleSource`
  - `workspace`：来自 `conversation.metadata.workspace`
- 本地 append user message；收到 `message.delta` 时创建或更新 assistant streaming message。
- 收到 `message.completed` 时完成 assistant message。
- 收到 `run.failed` / `run.cancelled` 时将本地 Run 标为失败或取消。
- 暂时忽略或轻量记录 `tool.*`、`task.*`、`permission.*`、`reasoning.*`、`system_agent.completed`。
- 会话切换时保留活动 Run 状态；关闭旧会话 EventSource 但不取消 Runtime Run。切回会话时使用该会话保存的 `activeRuntimeRunId` 重新请求 `/api/runtime/runs/:runId/events`。
- 重新订阅会 replay 已有事件；Web 必须按 Runtime `event.id` 去重，或由事件列表重新派生消息，避免 `message.delta` 重复拼接。
- 如果 Run 在用户切走期间完成，切回后 replay 到 `run.completed` 并自然关闭流。
- 页面刷新后丢失阶段 1 的本地 active run 映射是允许行为；阶段 2 后由 HubServer 持久化恢复。

出口标准：

- 单聊文本消息可以在 Web 中触发真实 Runtime Run 并流式显示结果。
- Runtime 缺少模型绑定时，Web 能显示结构化失败原因，而不是静默卡住。
- 群聊未 @ 时可以进入 orchestrator；如果 orchestrator 未绑定支持 tools 的模型，显示可读错误。
- 智能体回答期间切换到其他会话不会取消 Runtime Run；切回原会话可以 replay 并继续显示后续输出。
- 不写 HubServer `Message`、`Run`、`RunEvent` 表。

### 阶段 1.5：Workbench Timeline Projection + ai-elements Renderer

目的：在进入 HubServer 持久化前，把 Runtime 事件到 Web UI 的投影层明确化，避免把任务、工具、权限和子智能体输出继续塞进普通消息模型。

任务：

- 新增 `WorkbenchTimelineItem`，作为 Web 未持久化聊天流的唯一 UI source of truth。
- 将 Zustand conversation runtime state 从 `messages` 迁移为 `timelineItems`，继续保留原始 `events` 和 `receivedEventIds`。
- 抽出 `RuntimeRunEvent -> WorkbenchTimelineItem` projection reducer，确保 replay 时按稳定 item id 更新，不重复 append。
- Runtime `history` 只从 timeline 中的 `chat_message` 投影。
- 使用 ai-elements 渲染 timeline：`Message` 渲染聊天消息，`Task` 渲染任务和子智能体输出，`Tool` 渲染工具调用，`Confirmation` 渲染权限事件，`Reasoning` 渲染 reasoning；Plan 保留为 timeline item，并在右侧“会话状态”标签页使用 `Queue` 渲染。
- Timeline 渲染层使用真实 conversation agent profiles，不再依赖 workbench mock agent 数据。

出口标准：

- 子智能体 `message.*` 不创建普通聊天气泡，而进入任务卡片。
- tool/task/permission/reasoning/plan 事件有稳定 UI 落点。
- SSE replay 后 timeline 不重复追加 delta 或卡片。
- 单聊与群聊主智能体消息仍按 IM 聊天气泡显示。

### 阶段 1.6：Runtime Message Identity 与交替聊天气泡

目的：让一次 Runtime Run 中可以自然出现多条主聊天气泡，例如 `orchestrator -> coder/task -> orchestrator`，并为后续 HubServer 消息持久化提供稳定 message identity。

任务：

- Runtime `RunEvent` 增加可选顶层字段 `messageId` 与 `messageIndex`。
- Runtime 使用 AI SDK `text-start/text-delta/text-end` 作为 Runtime message block 边界；同一文本块的 delta/completed 共享同一个 `messageId`。
- 缺少 `text-start/text-end` 的 provider 或旧路径使用 fallback block：第一条 `text-delta` 创建 message，execution 暂停或结束时补 `message.completed`。
- `messageIndex` 由 RunManager 在首次看到新 `messageId` 时按实际 emit 顺序分配，支持并发任务下稳定排序。
- Web timeline projection 优先使用 `messageId` 作为 chat item identity；老事件缺少 `messageId` 时保留原 fallback。
- Web 不再把 `toolName = "run_task"` 的工具事件渲染为工具卡片；原始事件仍保留给 event log 和后续持久化。

出口标准：

- 同一个主智能体在同一次 Run 内多段发言可以渲染成多条聊天气泡。
- 子智能体输出仍进入 task 卡片。
- `run_task` 不再与 task/subagent 输出重复显示。
- 新 `messageId/messageIndex` 可以直接映射到后续 `Message`、`MessagePart` 和 `RunEvent.messageId`。

### 阶段 2：HubServer 产品级发送入口与持久化

目的：把消息发送从 Runtime 代理升级为 HubServer 产品 API。

建议入口：

```text
POST /api/conversations/:conversationId/messages/send
GET /api/conversations/:conversationId/messages
GET /api/runs/:runId/events
POST /api/runs/:runId/cancel
```

任务：

- 新增 HubServer message/run service：
  - 创建 user `Message`。
  - 创建本地 `Run`，保存本地 run id。
  - 调用 Runtime 后把 Runtime `runId` 写入 `Run.runtimeId`。
  - 从 conversation agents、metadata、历史 messages 组装 Runtime `RunInput`。
- HubServer 消费 Runtime SSE：
  - 按顺序写 `RunEvent`，并永久保留 raw `payloadJson`。
  - 投影 `message.delta` / `message.completed` 到 assistant `Message` 与 `MessagePart`。
  - 更新 `Run.status`、`startedAt`、`completedAt`、`errorJson`。
  - 更新 `Conversation.lastMessageId`、`lastMessageAt`。
- 聊天主 UI 恢复必须通过 raw `RunEvent` replay 完成：Web 先插入 trigger user message，再按 run 内 `sequence` 重放 Runtime events，并与 live SSE 共用同一套 projection reducer。
- `firstEventSequence` 继续保留在结构化投影表中，用于查询、统计、调试和非聊天 UI 排序，不作为聊天流 hydrate 的唯一来源。
- 持久化 active/recent Run 恢复信息：
  - 保存 Runtime `runId` 到 `Run.runtimeId`。
  - 通过 `conversationId + status` 查询最近非终态 Run，或在 conversation metadata 中记录最近 active run 指针。
  - Web 切回会话时优先查询 HubServer 的 active/recent Run，而不是依赖浏览器内存。
- Web 改为调用产品发送入口，不再直接调用 `/api/runtime/runs`。
- 补齐 HubServer 类型：
  - `RunStatus` 增加 `waiting_approval`。
  - `PermissionStatus` 对齐 Runtime 的 `pending`、`approved`、`denied`、`cancelled`、`expired`，或明确做映射。

出口标准：

- 刷新页面后能看到历史用户消息和 assistant 回复。
- 同一个 Runtime run 的事件可以从 HubServer replay。
- 切换会话、断开前端 SSE、再切回时，可以通过 HubServer `timelineRuns` raw replay + `activeRun.lastEventSequence` + `/api/runs/:runId/events?afterSequence=` 恢复正在运行或刚完成的 Run。
- 同一对话重开后，消息流、任务、工具、reasoning、权限和右侧计划面板的展示顺序必须与当时的流式渲染一致。
- Runtime 事件不直接暴露私有 workspace path。
- HubServer typecheck 通过。

阶段 2 机制文档：

- `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`

### 阶段 3：会话上下文与消息交互语义

目的：在复杂事件 UI 之前，完成真实聊天必须依赖的 conversation 行为。

任务：

- 使用持久化消息组装多轮 `history`，明确哪些 `MessagePart` 会进入 Runtime 上下文。
- 消费 `system_agent.completed(systemAgentId="title")`，仅在标题未被用户手动修改时更新 conversation title。（已在阶段 2 补齐）
- 接入 pinned message 的查询与上下文注入规则。
- 接入群聊显式 @ 单个主智能体，将其映射为 `addressedAgentIds`。
- 接入停止当前生成、失败重试和重新生成的产品语义，明确新 Run 与历史消息的关联。
- 在 Web 表达 queued、running、waiting approval、completed、failed、cancelled 等基础状态。

出口标准：

- 多轮聊天刷新后仍使用正确历史上下文。
- 自动标题不会覆盖手动标题。
- 单一 @ 路由符合 Runtime 当前约束。
- stop/retry/regenerate 不造成消息顺序或 Run 关联混乱。

### 阶段 4：权限审批产品链路

目的：把 Runtime 内部已闭环的 approval 机制接入产品 UI 和 HubServer 状态。

任务：

- HubServer 代理或产品化权限接口：
  - 查询 Run pending permissions。
  - 提交 approve/deny decision。
  - 持久化 PermissionRequest。
- Web 展示 `permission.requested`，允许用户批准或拒绝。
- 审批后继续订阅同一 Run 事件并更新消息状态。
- 对取消 Run 时的 pending permission 输出 `permission.cancelled`。

出口标准：

- 文件工具触发审批时，Web 能展示请求并恢复同一 Run。
- 拒绝审批后展示 `TOOL_EXECUTION_DENIED` 或等价结构化失败。

### 阶段 5：Orchestrator 计划、任务和工具事件 UI

目的：让群聊协作过程可见，而不是只显示最终文本。

任务：

- 从最后一个成功 `tool.completed(toolName="write_plan")` 投影当前计划。
- 展示 `task.started`、`task.completed`、`task.failed`。
- 展示 `tool.started`、`tool.completed`、`tool.failed` 的简洁状态。
- 区分主智能体、子智能体、orchestrator 和 system agent 事件。

出口标准：

- 群聊中 orchestrator 的计划和委派任务能在聊天流或右侧工作台中可读展示。
- `run_task` 工具事件仅作为 UI/追踪，不误作为父智能体模型上下文。

### 阶段 6：Artifact / 文件 / Diff 投影

目的：把文本聊天扩展到 AgentHub 产品要求的富媒体产物。

任务：

- 定义 Runtime 事件到 HubServer Artifact / ArtifactVersion 的投影规则。
- 从 `model.stream.part` 中可用的 `file`、`source` 或工具结果投影首批文件卡片。
- 接入代码、网页预览、Diff 和后续 apply 流程。
- 明确 Artifact 版本历史和消息内引用关系。

出口标准：

- Assistant 回复可以引用持久化 Artifact。
- 右侧 workbench 可以从消息或 Artifact 打开预览。

### 阶段 7：生产化与恢复能力

目的：让链路能承受刷新、断线、Runtime 重启和桌面生产启动。

任务：

- HubServer 管理 Agent Runtime Sidecar 生命周期：spawn、health check、restart、shutdown。
- SSE 断线恢复：HubServer replay 已持久化 RunEvent，再继续消费 Runtime 或标记失败。
- 定义 active run 查询入口，支持 Web 刷新后恢复正在运行的会话。
- 定义会话切换恢复策略：
  - 前端切换会话只影响订阅，不影响 Runtime 执行。
  - HubServer 需要能够在没有前端订阅时继续消费 Runtime 事件，或在前端重新订阅时从 Runtime replay 补齐后再落库。
  - Runtime 重启导致未持久化事件丢失时，HubServer 必须将受影响 Run 标为 failed 或 recoverable error。
- 补充轻量 smoke tests。

出口标准：

- 开发环境可连接独立 Runtime。
- 生产环境 HubServer 可自动拉起 Runtime。
- Web 刷新后能恢复未终态 Run 的已知状态或显示明确不可恢复状态。

### 阶段 8：外部 Agent 与产品验收

目的：补齐 P1 范围内的真实外部执行能力，并固化可演示、可回归的端到端路径。

任务：

- 将当前 `external-adapter` 占位替换为至少一个真实外部 Agent adapter，再扩展第二个 adapter。
- 将外部 adapter 输出规范化为既有 Runtime RunEvent，不为 Web/HubsServer 引入 provider 特例。
- 增加单聊、群聊、审批、文件产物和恢复场景的端到端 smoke 验证。
- 准备 Demo 数据与最小演示路径。

出口标准：

- 至少两个外部 Agent adapter 能通过统一聊天产品入口执行。
- Web 与 HubServer 无需知道底层 adapter 差异。
- P0 与目标 P1 链路具备可重复验证记录。

## 状态管理决策

采用 Zustand + TanStack Query：

- TanStack Query 管理服务端事实：
  - conversations list/detail
  - agents/providers
  - persisted messages/runs/permissions/artifacts
- Zustand 管理客户端运行态和 UI 状态：
- active conversation id
- composer drafts
- optimistic / non-persisted streaming messages
- active run ids and SSE connection status
- per-conversation latest active run pointer and received event ids
- workbench tabs and layout
- 第一阶段的未持久化 timeline items 属于 Zustand；第二阶段持久化后，messages/events 逐步迁移为 TanStack Query cache，Zustand 只保留 optimistic overlay 和 streaming overlay。

## 当前进度

- Runtime Runs API 已实现并有测试覆盖：创建 Run、SSE replay、权限续跑、workspace、tool、orchestrator smoke。
- HubServer 已有 `/api/runtime/runs*` 直通代理。
- HubServer Prisma schema 与 repository 已包含 `Message`、`MessagePart`、`Run`、`RunEvent`、`PermissionRequest`。
- Web conversation list、新建、重命名、pin/archive 已接 HubServer。
- Web 已引入 `@tanstack/react-query`，并在应用根部安装 `QueryClientProvider`。
- Web conversation list/detail、新建、重命名、pin/archive 已迁移为 TanStack Query 查询与 mutation。
- Web 已新增 Zustand workbench store，按 conversation 保存 draft、未持久化 timeline items、最近 active Runtime `runId`、Run 状态、SSE 连接状态、已接收 Runtime event ids 和轻量 event log。
- Web 已新增 Runtime Runs API client 和 EventSource connection manager，复用 HubServer `/api/runtime/runs*` 转发接口。
- Web 聊天消息流已从静态原型推进到第一阶段未持久化 Runtime Runs 聊天；刷新页面丢失本地消息与 active run 映射仍是当前阶段预期。
- Web 已新增 timeline projection 层，使用 `WorkbenchTimelineItem` 和 ai-elements renderer 表达 chat message、task、tool、permission、reasoning、plan 与 run status；其中 Plan 由右侧“会话状态”标签页展示。
- Runtime message 事件已增加 `messageId/messageIndex`；Web timeline projection 已按 `messageId` 拆分主聊天气泡，并隐藏 `run_task` 工具卡片以避免与 task/subagent 输出重复。
- Runtime reasoning/tool/permission 事件已开始复用当前输出上下文的 `messageId/messageIndex`；Web projection 会把同一 `messageId` 的 reasoning、普通工具和审批嵌入对应聊天消息，旧事件才退回独立 timeline item。
- Orchestrator prompt 已收紧为“协调而不复述”：可见主智能体已经在聊天流中展示的回复不再由 Orchestrator 以最终总结形式重复输出，除非用户明确要求总结或结果来自隐藏子智能体。
- Plan timeline item 已迁移到产物工作台“会话状态”单例标签页展示；聊天流不再渲染 Plan，当前会话收到 Plan 更新时会自动展开右侧工作台并激活该标签页。
- 阶段 2 已接入 HubServer 产品级 messages/runs API：Web 发送改为 `POST /api/conversations/:conversationId/messages/send`，HubServer 创建 user Message、本地 Run、调用 Runtime，并后台消费 Runtime SSE。
- 阶段 2 已实现 RunEvent 持久化与产品 SSE：`RunEvent.id = runtime event.id`，`sequence` 为本地 run 内递增序号，Web 通过 `/api/runs/:runId/events?afterSequence=` 续订。
- 阶段 2 已实现 raw event replay 恢复：Web 切换或刷新会先按 `timelineRuns` 重放 trigger user message 与 raw RunEvent，再对非终态 active run 续订后续事件。
- 阶段 2 已补齐自动标题契约：HubServer 消费 `system_agent.completed(systemAgentId="title")` 条件更新 `Conversation.title`，手动重命名写入 `titleSource=manual`，Web 通过全局 `conversation.title.updated` 事件刷新 conversation 查询。
- Web 与 HubServer 已新增全局 best-effort SSE 管线 `GET /api/events`，用于 conversation 标题、最近消息和 Run 状态等低频产品状态通知；该通道不持久化、不 replay，不替代 run-level raw SSE。
- HubServer Runtime SSE 持久化已改为 raw event micro-batch + 高频 projection coalescing；`Run.lastProjectedSequence` 用于结构化投影追平，SQLite 启用 WAL 降低写锁压力。

## 已完成

- 确认文档目标是 `web -> hub-server -> agent-runtime`。
- 确认 Runtime RunInput 与 SSE 契约可支撑未持久化聊天。
- 确认 HubServer 当前代理接口可用于阶段 1。
- 确认持久化阶段需要新增产品级发送入口，而不是继续扩大 Runtime 代理语义。
- 阶段 0：完成 TanStack Query Provider、conversation list/detail 查询、conversation create/rename/pin/archive mutation，以及 Zustand workbench store。
- 阶段 1：完成 Web 本地消息发送、Runtime Run 创建、SSE 流式输出、Runtime event id 去重、基础失败/取消显示，以及切会话关闭订阅但不取消 Run、切回后重新订阅 replay 的前端机制。
- 阶段 1.5：完成 Web timeline projection 和 ai-elements timeline renderer；子智能体输出、工具、任务、权限、reasoning、plan 与 run 状态不再混入普通消息模型。
- 阶段 1.6：完成 Runtime message identity 和 Web alternating chat bubbles；一次 Run 内多段主智能体发言不再被合并到同一个气泡，`run_task` 工具事件只保留追踪不渲染工具卡片。
- 阶段 1.6 补强：完成 message-scoped reasoning/tool/permission 聚合；同一智能体当前输出中的 reasoning、普通工具、审批和文本可以落到同一条消息容器，为后续 MessagePart 持久化预留路径。
- 阶段 1.6 补强：完成 Orchestrator prompt 去复述策略；委派给可见主智能体后只补充增量信息或简短确认，不再转述已经显示的主智能体输出。
- 阶段 1.6 补强：Plan timeline UI 改为使用 ai-elements `Queue`，并强化 Orchestrator / `write_plan` 提示，要求委派任务完成、失败或取消后用相同 `taskId` 更新计划状态。
- 阶段 1.6 补强：新增产物工作台“会话状态”单例标签页，使用 ai-elements `Queue` 展示当前 Plan；Plan 保留在本地 timeline 但不再出现在聊天消息流，Plan 更新会触发右侧工作台自动聚焦。
- 阶段 2：新增 HubServer `RunPersistenceService` 和产品级 messages/runs API，完成 user/assistant text messages、RunEvent、Run 状态、latest Plan 的基础持久化与恢复；Web 聊天主路径不再调用 `/api/runtime/runs*` 代理。
- 阶段 2：新增 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`，记录 HubServer consumer、RunEvent sequence、message projection 和切会话恢复规则。
- 阶段 2：新增 `timelineRuns` raw replay 响应；Web 聊天 hydrate 与 live SSE 共用 `RuntimeRunEvent -> WorkbenchTimelineItem` projection reducer，不再用 `messages + runItems` 拼聊天流。
- 阶段 2：完成 Runtime `title` 系统智能体事件的 HubServer 消费与 Web 刷新链路，自动标题不会覆盖手动重命名。
- 阶段 2：完成 HubServer -> Web 全局产品状态 SSE v1；Run terminal 后可通知已打开 conversation 停止列表卡片运行进度，conversation title/last message 更新改由全局事件刷新缓存。
- 阶段 2 性能补强：完成 HubServer raw RunEvent 批量落库、`message.delta` / `reasoning.delta` 合并投影、projection catch-up 与 SQLite WAL 配置，降低长回答时磁盘写放大。

## 交付后增强（已提取至 Backlog）

- 阶段 0/1：补充更多手动端到端验证记录，覆盖真实模型绑定、缺失模型绑定、群聊 orchestrator、切会话 replay 和 archive/pin/rename/create 回归。
- 阶段 2：补充自动化测试，覆盖 send API、RunEvent 幂等、assistant MessagePart 投影、write_plan 持久化、`timelineRuns` raw replay 和产品 SSE replay/live。
- 阶段 3：接入上下文、pin、@、停止与重试语义；自动标题主链路已提前在阶段 2 完成，后续只补更细的 UX 与测试。
- 阶段 4：接入权限审批。
- 阶段 5：接入计划、任务、工具事件 UI。
- 阶段 5：如果 Orchestrator 偶发漏调 `write_plan` 更新状态，在 Web/HubServer projection 层按 `taskId` 将 `task.completed` / `task.failed` 自动回填到当前 Plan task status。
- 阶段 6：接入 Artifact 投影。
- 阶段 7：接入 Sidecar 和恢复能力。
- 阶段 8：接入真实外部 Agent adapter 和端到端验收。

## 历史风险与注意事项

- TanStack Query 尚未安装；进入阶段 0 时需要更新 `web/package.json` 与 lockfile。
- Runtime 真实模型调用依赖 provider/model binding；未绑定时会结构化失败为 `MODEL_BINDING_MISSING`。
- Orchestrator 必须绑定支持 tool calling 的模型，否则群聊默认入口会失败。
- 阶段 1 的消息刷新丢失是预期行为；不要为它临时写入数据库。
- 阶段 1 切会话恢复依赖 Agent Runtime 的 in-memory Run 和 event replay；Runtime 进程重启后不能恢复，这是阶段 2/7 的持久化与恢复能力要解决的问题。
- Runtime SSE replay 会重放已有 `message.delta`；Web 如果直接在已有文本上追加 replay delta，会产生重复内容，必须按 `event.id` 去重或从事件列表重新派生视图。聊天气泡身份优先使用 Runtime `messageId`，缺少该字段时才使用旧 fallback。
- Web 当前 timeline 仍是浏览器内存态；刷新后丢失 timeline 是阶段 1.5 的预期行为，阶段 2 后再迁移为 HubServer 持久化消息和事件投影。
- HubServer SSE 消费和前端 SSE 转发要避免同一 Runtime event 被重复持久化。
- HubServer 的本地 `Run.id` 和 Runtime `runId` 必须通过 `Run.runtimeId` 明确映射。
- conversation metadata 中 workspace snapshot 目前由 Web 创建；后续可能需要 HubServer 校验和规范化。

## 最近更新

- 2026-05-28：实施阶段 0+1。Web 使用 Zustand + TanStack Query 管理会话与运行态，并通过 HubServer `/api/runtime/runs*` 转发接口跑通未持久化 Runtime Runs 聊天、SSE 流式输出和切会话重新订阅恢复策略。
- 2026-05-28：实施阶段 1.5。Web 将未持久化聊天流迁移为 Timeline Projection，使用 ai-elements 渲染 chat message、task、tool、permission、reasoning、plan 和 run status。
- 2026-05-28：实施阶段 1.6。Runtime `message.*` 事件按 AI SDK 文本块生成 `messageId/messageIndex`；Web 按 `messageId` 渲染交替聊天气泡，并隐藏 `run_task` 工具卡片。
- 2026-05-28：补强阶段 1.6。Runtime 将当前输出上下文的 `messageId/messageIndex` 扩展到 reasoning、普通工具和权限事件；Web 将这些事件聚合进同一条消息或关联 task。
- 2026-05-28：补强阶段 1.6。优化 Orchestrator prompt，禁止复述可见主智能体已经在聊天流中展示的回复，仅在有增量价值时补充状态、下一步或风险。
- 2026-05-28：补强阶段 1.6。Plan timeline UI 改用 ai-elements `Queue`；强化 Orchestrator / `write_plan` 描述，要求任务批次完成后更新计划状态，并将 projection 自动回填列入后续计划。
- 2026-05-28：补强阶段 1.6。将 Plan 展示迁移到右侧产物工作台“会话状态”单例标签页，新增 store 管理的工作台折叠状态和 Plan focus request；聊天消息流不再渲染 Plan。
- 2026-05-29：加强 HubServer schema 和 projection 约束，`RunEvent` raw payload 永久保留，projection 项写入 `firstEventSequence` / `lastEventSequence`，重开会话时顺序必须与流式渲染一致。
- 2026-05-29：将 Web 聊天恢复切换为 `timelineRuns` raw event replay；replay 与 live SSE 共用同一套 timeline projection，结构化 messages/runItems 退回查询和上下文职责。
- 2026-05-29：跑通会话自动命名契约。HubServer 消费 Runtime `system_agent.completed(systemAgentId="title")` 后条件更新 conversation title，手动重命名标记 `titleSource=manual`，Web 通过全局 `conversation.title.updated` 事件刷新会话缓存。
- 2026-05-29：新增 HubServer 全局事件流 `GET /api/events`。该通道用于低频产品状态通知，采用内存事件总线、无持久化、无 replay，Web 在 App 根部建立唯一 EventSource 消费 conversation/run 状态事件。
- 2026-05-30：修复自动标题可靠性问题。Runtime 标题结果 ready 后会在 Run 未结束时立即发送 `system_agent.completed`，主智能体完成时仅保留短 flush 宽限兜底；HubServer 在 `titleSource=default` 时会把会话第一条用户输入作为 `titleSeedUserMessage` 传给 Runtime，允许错过首次事件的会话后续重试自动命名。
- 2026-05-27：创建路线图，确定先做 Web 未持久化 Runs 聊天闭环，再做 HubServer 持久化与产品级发送入口；记录 Zustand + TanStack Query 状态管理方向。
- 2026-05-30：优化 HubServer SSE 持久化写入。Runtime raw events 按 run 微批量落库，结构化 delta 投影合并写入，并用 `Run.lastProjectedSequence` 支持读取前 catch-up；SQLite 连接启用 WAL / NORMAL synchronous / busy timeout。
