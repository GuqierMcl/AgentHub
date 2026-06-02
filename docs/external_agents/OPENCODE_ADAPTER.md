# OpenCode Adapter 设计

本文档定义 AgentHub 接入 OpenCode 的专属设计。公共外部智能体原则见 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`。

OpenCode 在 AgentHub 中被视为一个完整外部聊天对象。AgentHub 不拆解或管理 OpenCode 的模型供应商、OpenCode agents、Skill、MCP、plugin、command 或私有工具配置。

## 1. 接入目标

- 用户可以像与其他主智能体聊天一样与 OpenCode 聊天。
- 群聊中用户可以显式 `@OpenCode`。
- Orchestrator 可以委派任务给 OpenCode。
- OpenCode 的回复在群聊中作为普通可见发言出现。
- OpenCode 在当前 workspace 中工作，并由 AgentHub 展示其文本回复、权限请求、执行状态和文件变更。
- OpenCode 使用用户本机已有的 OpenCode 配置和认证。

## 2. 设计边界

AgentHub 不负责：

- 配置 OpenCode 使用哪个模型。
- 配置 OpenCode provider API key。
- 管理 OpenCode agents / skills。
- 管理 OpenCode MCP。
- 管理 OpenCode plugin、command、hook。
- 替换 OpenCode 原生工具系统。

AgentHub 负责：

- 将 OpenCode 作为 `opencode` 主智能体注册和展示。
- 启动或连接 OpenCode server。
- 为 OpenCode 调用选择 AgentHub 当前 workspace。
- 创建和查找与 AgentHub 会话对应的 OpenCode Session。
- 组装 direct 或 delegated task 上下文。
- 订阅 OpenCode 事件并映射为 AgentHub RunEvent。
- 将 OpenCode 权限请求桥接到 AgentHub UI。
- 在 Run 前后检测 workspace 文件变化并生成 Diff 投影。

## 3. Runtime 拓扑

OpenCode 接入位于 Agent Runtime 的外部 Adapter 层：

```text
web
  -> hub-server
    -> agent-runtime
      -> ExternalAdapterExecutor
        -> OpenCodeAdapter
          -> opencode serve / OpenCode SDK
```

浏览器不直接访问 OpenCode server。HubServer 仍是业务状态中心，Agent Runtime 仍是执行面，OpenCodeAdapter 只负责外部执行和事件转换。

### 3.1 SDK 对齐约束

OpenCode SDK 可以启动 server 并返回 client，也可以连接已有 server。OpenCode server 暴露 health、project/path、session、message、event、permission、diff 等 API。

实现时应注意：

- OpenCode Project 不应被设计成 AgentHub 显式创建的业务对象。Adapter 应通过以 workspace 为工作目录启动或选择 OpenCode server，并用 OpenCode 的 `project.current` / `path.get` 结果校验当前 Project 与 AgentHub workspace 一致。
- Phase 3 默认优先保留 SDK managed server 入口，但当前 `@opencode-ai/sdk@1.15.13` 的 `createOpencode()` ServerOptions 未暴露 cwd/workdir/projectPath 等进程局部 workspace 参数。因此 V1 实际启用 `opencode serve` CLI fallback：Runtime 以 AgentHub workspace root 作为子进程 `cwd` 启动本机 server，再用 `createOpencodeClient()` 连接。不得用 `process.chdir()` 包装 `createOpencode()`。
- SDK client 调用应显式传入 `query.directory = workspaceRoot`，并使用 `createOpencodeClient({ baseUrl, directory })` 作为 GET/HEAD 的辅助保护。
- OpenCode Session 可以由 Adapter 创建和更新标题；Session 映射事实来源仍在 HubServer。
- Adapter 向 OpenCode 发送用户消息时默认不传入 model/provider 覆盖项，避免 AgentHub 接管 OpenCode 模型配置。
- Phase 4A 将 AgentHub 公共上下文作为结构化 prompt 前缀发送给 `session.prompt()`，不探索 no-reply message/prompt 语义。后续如果 OpenCode SDK 提供稳定静默上下文写入能力，可以再替换前缀实现。

## 4. OpenCode Project 映射

OpenCode 的 Project 应与 workspace 目录对齐。

规则：

- 同一个 canonical workspace 目录对应同一个 OpenCode Project。
- Adapter 调用 OpenCode 时必须指定当前 AgentHub workspace 目录。
- 多个 AgentHub 会话如果绑定同一个 workspace，会落在同一个 OpenCode Project 下。
- 不同 AgentHub 会话仍使用不同 OpenCode Session，不能因为 Project 相同而共享对话上下文。
- 如果当前 Run 没有绑定 workspace，OpenCodeAdapter 不应回退到 Runtime 全局 workdir。

Project 是代码环境边界；Session 是会话语境边界。

## 5. OpenCode Session 映射

OpenCode Session 创建时需要与 AgentHub 会话语境对齐。

### 5.1 Conversation-visible Session

用途：

- 单聊 OpenCode。
- 群聊中用户直接 `@OpenCode`。

映射维度：

- AgentHub conversation id。
- OpenCode agent id。
- workspace Project。
- OpenCode config profile。
- scope = `conversation-visible`。

Session 标题应尽量使用 AgentHub 会话标题或可追踪前缀，便于用户在 OpenCode 侧识别。

该 Session 承载 OpenCode 在当前 AgentHub 会话中的用户可见对话上下文。它可以接收公共群聊历史摘要和 handoff summary，但不接收 Orchestrator 私有任务 prompt。

### 5.2 Delegated-task Session

用途：

- Orchestrator 通过 `run_task` 委派 OpenCode。

映射维度：

- AgentHub conversation id。
- AgentHub run id。
- task id。
- workspace Project。
- OpenCode config profile。
- scope = `delegated-task`。

每个 delegated task 默认使用独立 OpenCode Session。重试同一 task 时可以复用该 task session。并行任务不得共用同一 task session。

该 Session 的上下文只服务于当前任务。任务完成后，AgentHub 生成 handoff summary，并将 OpenCode 的可见回复作为普通群聊消息投影。

## 6. 群聊中的可见性

OpenCode 是可见主智能体，因此它在群聊中的行为应与其他预设主智能体保持一致。

当 Orchestrator 委派 OpenCode：

- Runtime 产生 `task.started`。
- OpenCode 执行期间产生 `agent.started`、`message.*`、`tool.*`、`permission.*` 等事件。
- OpenCode 的文本回复投影为普通 assistant message，`agentId = "opencode"`。
- 消息仍可携带 `taskId`、`parentAgentId`、`groupId` 等追踪字段。
- Runtime 产生 `task.completed` 或 `task.failed`。
- Orchestrator 最终回复可以引用结果，但不应完整复述 OpenCode 已经可见的普通发言。

这样用户在群聊中能看到 OpenCode 真正参与了讨论，而不是只看到 Orchestrator 的转述。

## 7. 上下文策略

### 7.1 用户直接 `@OpenCode`

Adapter 使用 conversation-visible session。

上下文来源：

- 当前用户消息。
- 群聊中用户可见的公共消息。
- 其他智能体的公开回复。
- OpenCode 之前的公开回复。
- delegated task 的 handoff summary。
- pinned messages。
- 相关 Artifact 和 Diff 摘要。
- 当前 workspace 摘要。

不注入：

- Orchestrator 私有系统提示。
- Orchestrator 原始 task wrapping prompt。
- 其他智能体隐藏上下文。
- Runtime 内部 continuation 消息。

Phase 4A 的 direct context bridge 由 HubServer 生成 `externalContext` packet，并由 OpenCodeAdapter 格式化为 `AgentHub visible context` prompt 前缀。该前缀不是当前用户请求；当前用户请求会在前缀之后以 `Current user request` 单独追加。

同步规则：

- 如果 `ExternalAgentSession.metadataJson.contextBridge.lastSyncedMessageId` 仍在最近可见消息窗口内，HubServer 只发送该消息之后的 delta。
- 如果没有 cursor、OpenCode provider session 被重建、或 cursor 已不在窗口内，HubServer 发送 bounded bootstrap。
- 首版窗口限制为最多 50 条可见消息、约 12k 字符，单条消息会先截断到约 4k 字符。
- OpenCodeAdapter 在 `agent.completed.data.externalContext` 回传本轮已应用 context 的摘要，不回传完整消息正文。
- HubServer 只在成功完成后推进 `metadataJson.contextBridge`；失败、取消或中途重启不会推进 cursor，下一轮可以重复发送 bounded context。

### 7.2 Orchestrator 委派 OpenCode

Adapter 使用 delegated-task session。

上下文来源：

- task title。
- task instruction。
- expected output。
- risk level。
- Orchestrator 选择的必要公共上下文。
- 当前用户目标摘要。
- 相关 Artifact / Diff。
- 当前 workspace 摘要。

OpenCode 的任务回复仍作为普通群聊消息展示，但该任务 session 的原始上下文不会成为用户后续 direct session 的原始历史。

### 7.3 Handoff 到 Direct Session

当 delegated task 完成后，Adapter 或 HubServer 应生成 handoff summary。后续用户直接 `@OpenCode` 时，conversation-visible session 应能获得该 summary。

推荐同步内容：

- 任务标题。
- OpenCode 完成情况。
- OpenCode 可见回复摘要。
- 修改文件列表。
- Diff 或 Artifact 引用。
- 失败或权限拒绝状态。

推荐不同步：

- 原始 delegated prompt。
- Orchestrator 私有计划。
- OpenCode task session 的完整内部消息。

Phase 4A 中，OpenCodeAdapter 在 delegated task 的 `agent.completed` 上生成简短 handoff summary，并写入 `agent.completed.data.handoffSummary` 与 `agent.completed.data.externalSession.handoffSummary`。HubServer 投影后保存到对应 delegated-task `ExternalAgentSession.handoffSummary`。后续 direct `@OpenCode` 会把相关 handoff summary 放入 direct context bridge，但不会复用 delegated-task provider session，也不会注入原始 task instruction。

## 8. OpenCode 配置策略

OpenCode 使用用户本机已有配置。

AgentHub 不写入或覆盖：

- provider。
- model。
- API key。
- agents。
- skills。
- MCP。
- plugin。
- command。
- hook。

Adapter 可以读取必要的 OpenCode 运行状态和版本信息，用于健康检查和错误提示，但不应把 OpenCode 变成 AgentHub 托管配置对象。

如果 OpenCode 配置导致某些操作被直接允许，AgentHub 只能观察结果和 Diff；只有 OpenCode 发出 permission request 时，AgentHub 才能桥接审批。

### 8.1 模型状态展示可行性

AgentHub 不配置 OpenCode model/provider，但可以展示 OpenCode 实际运行状态。需要区分三种“当前模型”含义：

- 配置默认模型：OpenCode `config.providers()` / `provider.list()` 暴露 provider、model 列表和 default 映射，Runtime 可以在已启动 server 后读取，用于展示“OpenCode 默认模型”。这不是 AgentHub 的配置来源，只是只读状态。
- 本次回复实际使用模型：`session.prompt()` 返回的 assistant message `info` 中包含 `providerID` 与 `modelID`。这是最权威、最适合展示在消息或 Run 详情上的值，尤其当 OpenCode 内部 agent、command 或配置覆盖默认模型时。
- OpenCode TUI 当前选择：这属于 OpenCode 原生 UI 的运行时状态，当前不应作为 AgentHub V1 的事实来源。AgentHub 不复刻 TUI，也不依赖浏览器直接连接 OpenCode server。

UI 分阶段：

- V1.1 已采用“每条 OpenCode 回复实际使用的模型”作为首个展示事实：Runtime 从 `session.prompt()` response 的 assistant message `info.providerID/modelID` 读取模型，并尽量通过只读 `provider.list({ directory })` 解析 `providerName/modelName`，写入 `message.completed.data.externalModel = { provider: "opencode", providerId, modelId, providerName?, modelName? }`。HubServer 在产品 Run replay 中原样保留该字段，并可投影到 assistant `Message.metadataJson.runtime.externalModel`；Web 在消息 action 行优先展示 OpenCode 实际回复模型名，拿不到名称时再降级展示可读化 model id。
- 若尚未产生回复，可以显示“使用 OpenCode 默认配置”或只展示 OpenCode 连接状态，避免把未知值伪装成确定模型。
- 后续如果需要会话头部展示默认模型，应由 Runtime 读取 OpenCode server 的只读 provider/config 状态，再经 HubServer API 转发；浏览器仍不直连 OpenCode server。
- AgentHub 不提供 OpenCode 模型切换控件，除非后续明确把“只读展示”升级为“外部平台配置管理”，该升级需要新的产品决策。

## 9. 权限桥接

OpenCode 的权限请求应桥接到 AgentHub 权限 UI。

流程：

1. OpenCode 产生 permission request。
2. OpenCodeAdapter 将其转换为 AgentHub `permission.requested`。
3. HubServer 持久化并转发到 Web。
4. 用户在 AgentHub UI 中批准或拒绝。
5. OpenCodeAdapter 将决定回写给 OpenCode。
6. OpenCode 继续或停止对应操作。
7. Runtime 输出 `permission.approved`、`permission.denied` 或 `permission.cancelled`。

首版映射：

- AgentHub 批准 -> OpenCode 一次性允许。
- AgentHub 拒绝 -> OpenCode 拒绝。
- Run 取消 -> OpenCode permission 取消或拒绝，并 abort active session。

后续如果 AgentHub UI 支持审批作用域，可以再支持“始终允许”。

## 10. 事件映射

OpenCodeAdapter 应订阅 OpenCode event stream，并按 session / task 过滤。

建议映射：

| OpenCode 事件类别 | AgentHub 投影 |
| --- | --- |
| assistant text part | `message.delta` / `message.completed` |
| reasoning part | `reasoning.*`，仅当 OpenCode 显式暴露 |
| tool part pending/running | `tool.started` |
| tool part completed | `tool.completed` |
| tool part error | `tool.failed` |
| permission updated | `permission.requested` |
| permission replied | `permission.approved` / `permission.denied` |
| session busy/idle | agent/run 状态判断 |
| session error | `agent.completed` error 或 `run.failed` |
| file edited/session diff | Diff / Artifact 投影，首版可先保留 trace |
| todo updated | 可作为 trace，暂不等同于 AgentHub `write_plan` |

OpenCode 的 todo 与 AgentHub Orchestrator 的 `write_plan` 语义不同，首版不应混为同一事实来源。

## 11. 文件变化与 Diff

OpenCode 可以直接修改 workspace。AgentHub 应在 Run 前后检测变化。

规则：

- Run 开始前记录 workspace 变更基线。
- Run 结束、失败或取消后尽量计算本次变更。
- Diff 归因到 `agentId = "opencode"`。
- 如果变更发生在 delegated task 中，同时记录 `taskId`。
- OpenCode 的文本回复与 Diff 都应可见。
- 如果用户或其他智能体并发修改同一 workspace，AgentHub 应标记潜在冲突。

首版可以先输出 Diff 摘要和文件列表；完整 Diff Artifact、回滚和一键应用后续扩展。

## 12. 进程与生命周期

OpenCodeAdapter 负责启动或连接 OpenCode server。

要求：

- 只监听本机地址。
- 检测 OpenCode CLI 是否可用。
- 检测 OpenCode server 是否健康。
- 支持按 workspace Project 调用。
- 支持 Runtime 取消 Run 时 abort 对应 OpenCode Session。
- Runtime 退出时清理由 Runtime 启动的 OpenCode server。
- 不默认删除 OpenCode Sessions；Session 是用户可继续使用的外部上下文。

如果用户已经手动运行 OpenCode server，后续可以支持连接已有 server；MVP 可先由 Runtime 托管启动。

当前 V1 连接模式保留两种内部枚举：`managed-by-runtime` 与 `existing-local-server`。已启用的是 `managed-by-runtime`；`existing-local-server` 需要后续基于 `createOpencodeClient({ baseUrl })` 增加 localhost 限制、health check 和 workspace 校验后再产品化。

当前 Phase 3 已实现 `session.prompt()` 的基础文本投影：Adapter 从 assistant message `parts` 中提取非 ignored text part，输出 AgentHub `message.delta` 与 `message.completed`；当 OpenCode response 暴露 `providerID/modelID` 时，`message.completed` 同步携带 `externalModel` 供 UI 只读展示，并在可用时附带 OpenCode provider catalog 中的显示名。OpenCode `event.subscribe()`、权限桥接、工具事件和 Diff 投影仍属于 Phase 4。

### 12.1 Runtime 可观测性

OpenCode 相关日志必须明确带有 `externalProvider = "opencode"`，并使用 `opencode-server`、`opencode-client`、`opencode-adapter` 等模块名，方便从 Agent Runtime 日志中过滤。

应记录的生命周期信息：

- workspace connection：canonical workspace、启动模式、server URL、复用、pending startup、关闭。
- server 启动：SDK managed 或 CLI managed、hostname、port、CLI process exit/error、启动超时。
- workspace 校验：`project.current` / `path.get` 的关键结果，以及 mismatch 详情。
- session：scope、conversationId、taskId、hint lookup、hint reuse、hint 丢失后的 replacement session、新 session 标题和 providerSessionId。
- prompt：prompt dispatch、abort request、prompt completed、assistant message id、输出长度、OpenCode 返回的 `providerID/modelID`，以及可解析到的 `providerName/modelName`。

日志不应输出 OpenCode API key、认证 token、完整底层堆栈或完整用户 prompt 内容；prompt 只记录长度和追踪 id。

## 13. 直接调用与委派调用示例

### 13.1 直接 `@OpenCode`

流程：

1. 用户在群聊发送 `@OpenCode 修复这个问题`。
2. EntryResolver 将入口解析为 `opencode`。
3. OpenCodeAdapter 查找或创建 conversation-visible session。
4. Adapter 同步公共群聊上下文和 handoff summary。
5. Adapter 向 OpenCode session 发送当前用户消息。
6. Adapter 将 OpenCode 输出映射成普通 `opencode` 聊天消息。
7. Run 完成后计算 Diff。

### 13.2 Orchestrator 委派 OpenCode

流程：

1. 用户在群聊发送复杂任务。
2. Orchestrator 写入计划并调用 `run_task`，目标为 `opencode`。
3. OpenCodeAdapter 创建 delegated-task session。
4. Adapter 发送 task-specific prompt。
5. OpenCode 输出作为普通 `opencode` 消息进入群聊，并带 task 追踪字段。
6. task 完成后生成 handoff summary。
7. Orchestrator 最终回复引用或衔接 OpenCode 结果。

### 13.3 委派后再直接 `@OpenCode`

流程：

1. 先前 delegated task 已完成并生成 handoff summary。
2. 用户直接 `@OpenCode 继续刚才你的改动`。
3. Adapter 使用 conversation-visible session，而不是原始 delegated-task session。
4. Adapter 将 handoff summary、公共历史和当前 workspace Diff 摘要注入 direct context。
5. OpenCode 以聊天对象身份继续回应。

如果用户明确要求继续某个具体 task session，后续可以支持从 task session fork 或恢复，但默认 direct 调用不切换到 task session。

## 14. 错误处理

OpenCodeAdapter 应将错误转换为稳定 Runtime 错误。

常见错误：

- OpenCode CLI 不存在。
- OpenCode server 启动失败。
- OpenCode Project/workspace 无效。
- OpenCode Session 不存在。
- OpenCode permission 回写失败。
- OpenCode provider auth 失败。
- OpenCode event stream 中断。
- OpenCode session abort 失败。

Runtime 稳定错误码包括：`ADAPTER_SERVER_START_FAILED`、`ADAPTER_SERVER_UNHEALTHY`、`ADAPTER_WORKSPACE_MISMATCH`、`ADAPTER_SESSION_FAILED`、`ADAPTER_PROMPT_FAILED`、`ADAPTER_ABORT_FAILED`。

错误对用户展示时应说明当前 OpenCode 无法执行的原因，同时避免泄漏本机敏感路径、API key 或完整底层堆栈。

## 15. 非目标

OpenCode V1 不做：

- AgentHub 内配置 OpenCode 模型或 provider。
- AgentHub 内管理 OpenCode MCP。
- AgentHub 内管理 OpenCode skill / agent 文件。
- 把 OpenCode 原生工具重写成 AgentHub Runtime Tools。
- 强制 OpenCode 使用 AgentHub ProviderService。
- 在 AgentHub 中复刻 OpenCode 的完整 TUI。
- 自动合并多个并行 OpenCode session 的文件修改。

## 16. 后续扩展

可在 V1 稳定后考虑：

- 连接用户手动启动的 OpenCode server。
- OpenCode session 浏览和重置 UI。
- 从 delegated-task session fork 到 direct conversation。
- 更完整的 Diff Artifact、回滚和冲突处理。
- OpenCode 版本兼容矩阵。
- 外部 permission 的“始终允许”作用域。
- workspace sandbox/overlay 模式。
- 多个外部智能体共同编辑同一 workspace 的冲突协调。
