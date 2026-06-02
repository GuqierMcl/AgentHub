# OpenCode Adapter V1 路线图

## 模块名称

OpenCode Adapter V1

## 目标

将 OpenCode 作为 AgentHub 中的外部可见主智能体接入，让用户可以在单聊或群聊中直接与 OpenCode 对话，也让 Orchestrator 可以委派任务给 OpenCode。OpenCode 作为完整聊天对象运行，AgentHub 不管理 OpenCode 的模型供应商、Skill、MCP、plugin、command 或私有工具配置。

## 完成标准

- `opencode` 不再回退 `MockExecutor`，而是通过外部 Adapter 执行。
- Direct conversation 与 Orchestrator delegated task 都能产生普通可见 `opencode` 消息。
- OpenCode Session 按 `conversation-visible` 与 `delegated-task` 分 scope。
- HubServer 持久化外部 Session 映射，并在 direct run 中向 Runtime 提供可复用 session hint。
- Runtime 能启动或连接 OpenCode server，并校验 Project 与 AgentHub workspace 一致。
- OpenCode 权限请求映射为 AgentHub `permission.*` 事件。
- OpenCode 修改 workspace 后，AgentHub 至少能展示基础 Diff 摘要和变更文件列表。

## 依赖文档

- `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`
- `docs/external_agents/OPENCODE_ADAPTER.md`
- `docs/architecture/AGENT_ARCHITECTURE.md`
- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/HUB_SERVER.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- `docs/contracts/RUNTIME_SSE_EVENTS.md`
- `docs/reference/HONO.md`

## 范围

### 包含

- Agent Runtime 外部 Adapter 执行骨架。
- OpenCode fake client 与垂直测试。
- 外部 Session hint 与 HubServer 持久化。
- Runtime 托管启动 OpenCode server 的进程生命周期。
- OpenCode event stream 到 AgentHub RunEvent 的映射。
- OpenCode 权限桥接。
- 基础 workspace Diff 摘要和 handoff summary。

### 不包含

- AgentHub 内配置 OpenCode provider、model、Skill、MCP、plugin、command。
- 浏览器直接访问 OpenCode server。
- OpenCode TUI 复刻。
- 多 OpenCode session 并发编辑的自动冲突合并。
- 完整 Diff Artifact、回滚和版本历史 UI。
- 连接用户手动启动的 OpenCode server；V1 先由 Runtime 托管启动。

## 阶段拆分

### 阶段 1：Runtime Adapter 骨架与 fake-client 垂直测试

目标：

- 新增 `ExternalAdapterExecutor`、`ExternalAgentAdapter`、`ExternalAdapterRegistry`。
- 新增 `OpenCodeAdapter` 与 `OpenCodeClient` 抽象。
- `RunManager.resolveExecutor()` 将 `external-adapter` 路由到 `ExternalAdapterExecutor`。
- `context.task` 存在时使用 `delegated-task` scope，否则使用 `conversation-visible` scope。
- fake OpenCode client 输出 `agent.started`、`message.delta`、`message.completed`、`agent.completed`。

验收：

- Direct `opencode` run 能产生普通 `opencode` assistant message。
- Orchestrator delegated `opencode` task 能产生带 `taskId`、`parentAgentId`、`groupId` 的普通可见 message。
- 未绑定 workspace 时返回结构化 adapter error。
- `external-adapter` 不再回退 `MockExecutor`。

### 阶段 2：外部 Session 持久化契约

目标：

- Runtime `RunInput` 增加 `externalSessionHints?: ExternalSessionHint[]`。
- HubServer 新增 `ExternalAgentSession` 持久化模型、repository 和 service。
- Runtime 在 `agent.started.data.externalSession` 中携带外部 session link。
- HubServer 投影 `agent.started` 时 upsert session link。
- HubServer 创建 direct OpenCode run 时注入 matching conversation-visible session hint。

验收：

- 同一 conversation + workspace 的 direct OpenCode run 能复用 OpenCode provider session id。
- Delegated task session 可被持久化，但不会污染 direct session 原始上下文。
- Runtime contract 和数据模型文档同步更新。

### 阶段 3：真实 OpenCode server / SDK 接入

目标：

- 添加 `@opencode-ai/sdk` 依赖。
- 优先使用 OpenCode SDK managed server；当前 SDK `createOpencode()` 未暴露 workspace cwd 参数时，使用 CLI fallback 以 workspace root 为 `cwd` 启动 `opencode serve --hostname 127.0.0.1 --port <allocated>`。
- 使用 OpenCode SDK client 连接本地 server。
- 启动后校验 OpenCode `project.current` / `path.get` 与 AgentHub workspace 一致。
- Adapter 向 OpenCode 发送 prompt 时默认不传 model/provider 覆盖项。

验收：

- 本机已安装并配置 OpenCode 时，direct run 可以驱动真实 OpenCode session。
- Runtime 取消 Run 时 abort active prompt。
- Runtime 退出时清理由 Runtime 托管的 OpenCode server。
- OpenCode CLI/server 缺失、启动失败、workspace 不一致时返回稳定错误。

### 阶段 4A：Context Bridge 与 Delegated Handoff

目标：

- HubServer 为 direct OpenCode run 生成 `externalContext` packet。
- Direct `conversation-visible` prompt 前缀注入 AgentHub 可见公共历史与 delegated handoff summary。
- `ExternalAgentSession.metadataJson.contextBridge` 保存上下文同步状态，不新增 Prisma 字段。
- 成功完成后推进 context cursor；失败、取消或中途重启不推进。
- Delegated task 完成后生成 handoff summary，并持久化到 delegated-task session。

验收：

- 群聊中用户直接 `@OpenCode` 时，OpenCode 能看到上一次同步之后的用户和其他智能体公开消息。
- provider session 丢失或 cursor 不可用时，HubServer 使用 bounded bootstrap。
- delegated task 的 handoff summary 可进入后续 direct context，但原始 task prompt 不进入 direct session。
- `RunInput.externalContext`、`agent.completed.data.externalContext` 和 `ExternalAgentSession.metadataJson.contextBridge` 契约同步到文档。

### 阶段 4B：权限桥接与 Diff

目标：

- `RuntimePermissionService` 支持 waitable external permission request。
- OpenCode permission request 映射为 AgentHub `permission.requested`。
- AgentHub 批准映射为 OpenCode 一次性允许；拒绝或取消映射为 OpenCode 拒绝并中止相关操作。
- Run 前后记录 workspace baseline，V1 使用 git-based changed files / diff summary。
- `agent.completed.data.workspaceDiff` 携带基础 Diff 摘要。

验收：

- Web 现有 permission UI 可以处理 OpenCode 权限请求。
- OpenCode 修改文件后，Run terminal data 中有变更文件列表和摘要。

### 阶段 5：集成硬化

目标：

- 增加真实 OpenCode 可用时的 smoke test，默认跳过本机缺失 OpenCode 的环境。
- 补齐错误码、日志、redaction 和 contract 文档。
- 验证 HubServer projection 不因 external metadata 破坏现有聊天恢复。

验收：

- `cd agent-runtime && bun test` 通过。
- `cd hub-server && bun test` 通过。
- 涉及 Prisma model 时 `cd hub-server && bunx --bun prisma generate` 通过。

## 当前进度

- 已完成公共外部智能体设计与 OpenCode Adapter 专属设计。
- `opencode` 预设已存在，`executorType = "external-adapter"`。
- `opencode` 使用 `configDirectoryPolicy = "user-global"`。
- 阶段 1 已落地：Runtime 将 `external-adapter` 路由到 `ExternalAdapterExecutor`，OpenCode fake client 可以覆盖 direct 与 delegated task 两条路径。
- 阶段 2 基础契约已落地：Runtime 接收 `externalSessionHints`，HubServer 可从 `agent.started.data.externalSession` upsert `ExternalAgentSession`，并在 direct OpenCode run 中注入 conversation-visible session hint。
- 阶段 3 基础接入已落地：`@opencode-ai/sdk` 已加入 Runtime；默认 OpenCodeAdapter 使用真实 client；`ManagedOpenCodeServer` 会在 SDK 暴露安全 workspace 选项时走 `createOpencode()`，当前 SDK 版本未暴露该选项时走 CLI fallback，并校验 `project.current` / `path.get`；`RealOpenCodeClient` 支持 session hint 复用、缺失重建、`session.prompt()` 文本投影和 Run cancel 时 `session.abort()`。
- OpenCode 模型只读展示 V1.1 已落地：Runtime 从 `session.prompt()` response 的 `providerID/modelID` 生成 `message.completed.data.externalModel`，并通过只读 provider catalog 尽量补齐 `providerName/modelName`；HubServer 保留并投影该消息级 metadata，Web 在聊天消息 action 行优先展示 OpenCode 实际回复模型名。
- 阶段 4A 已落地：HubServer 生成 OpenCode direct `externalContext` packet，Runtime OpenCodeAdapter 将其作为结构化 prompt 前缀发送；delegated task 完成后生成 handoff summary；HubServer 用 `ExternalAgentSession.metadataJson.contextBridge` 保存成功同步状态。
- 尚无 OpenCode event stream 权限桥接和 Diff 投影。

## 已完成

- 外部智能体作为聊天对象的设计决策。
- OpenCode Project 与 workspace 对齐的设计决策。
- OpenCode Session scope 分为 `conversation-visible` 和 `delegated-task`。
- OpenCode 使用用户本机配置，不由 AgentHub 管理模型、Skill、MCP。
- 阶段 1：Runtime Adapter 骨架与 fake-client 垂直测试。
- 阶段 2：外部 Session 持久化基础契约、Prisma model、repository、Runtime input hint 注入和 Runtime contract 文档。
- 阶段 3：真实 OpenCode SDK client、workspace-correct managed server fallback、session/prompt/abort 基础链路和 mock unit tests。
- V1.1：OpenCode 每条回复实际模型的 Runtime event、HubServer message metadata 投影和 Web action 行模型名展示。
- 阶段 4A：Context Bridge、metadata cursor 与 delegated handoff summary。

## 待办

- 阶段 4B：权限桥接与 Diff。
- 阶段 5：集成硬化。
- OpenCode 会话头部默认模型只读状态：后续再考虑读取 OpenCode provider/config 默认值；AgentHub 仍不接管 OpenCode 模型配置。

## 风险与待确认点

- 当前 `@opencode-ai/sdk@1.15.13` 的 `createOpencode()` ServerOptions 未暴露 cwd/workdir/projectPath；V1 不使用 `process.chdir()`，因此默认通过 `opencode serve` 子进程 cwd 绑定 workspace。若后续 SDK 增加进程局部 workspace 参数，可切回 SDK managed path。
- OpenCode 权限回写 API 的精确 payload 需要在 Phase 4B 权限桥接阶段验证。
- 多个 OpenCode session 并发编辑同一 workspace 可能产生冲突；V1 只检测并标记，不自动合并。
- 非 git workspace 的 Diff 能力需要 fallback 设计；V1 先以 unavailable summary 降级。

## 最近更新

- 2026-06-01：创建路线图，记录 OpenCode V1 分阶段执行计划。
- 2026-06-01：完成 Phase 1 fake-client adapter seam 与 Phase 2 外部 Session 基础持久化契约；真实 OpenCode SDK/server、权限、Diff 和 handoff 进入后续阶段。
- 2026-06-01：完成 Phase 3 基础实现：默认真实 OpenCode client、SDK workspace 选项检测、CLI workspace-correct fallback、session/prompt/abort 单测；权限、Diff、handoff 留在 Phase 4。
- 2026-06-01：前置补充 OpenCode Runtime 可观测性：server lifecycle、workspace validation、session hint/reuse/creation、prompt/abort 日志；模型 UI 记录为只读展示方向，暂不实现前端。
- 2026-06-02：落地 OpenCode 模型只读展示 V1.1：`message.completed.data.externalModel`、HubServer metadata 投影和 Web 消息 action 行展示实际回复模型；随后补齐 `providerName/modelName` 展示增强，旧消息无 display name 时前端降级为可读化 model id。
- 2026-06-02：修复 OpenCode 输出链路暴露出的通用 Runtime SSE 尾部事件竞态：Runtime SSE 先订阅再 replay 并 terminal-drain；HubServer consumer 只在 Runtime terminal event 已持久化后停止补连。
- 2026-06-02：修复真实 OpenCode 长 prompt 暴露出的 Runtime SSE idle timeout：Runtime 与 HubServer run SSE 增加 keepalive comment，Agent Runtime Bun server idle timeout 调整为 60 秒，并澄清连接 `cancel()` 日志不是用户取消 Run。
- 2026-06-02：完成 Phase 4A Context Bridge：HubServer 组装 `externalContext` packet，OpenCodeAdapter 使用结构化 prompt 前缀，delegated task 生成 handoff summary，并用 `ExternalAgentSession.metadataJson.contextBridge` 推进成功同步 cursor；权限桥接和 Diff 移入 Phase 4B。
