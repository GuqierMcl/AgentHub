# Codex Adapter 设计

本文档定义 AgentHub 接入 Codex 的专属设计。公共外部智能体原则见 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`。

Codex 在 AgentHub 中被视为完整外部聊天对象。AgentHub 不把 Codex 拆成普通 OpenAI Provider，也不在 AgentHub 中管理 Codex 的模型、账号、Skill、MCP、插件、hook 或全局配置。Runtime 只通过 Codex SDK / Codex app-server 驱动当前 workspace 中的一次 agent 执行，并把输出归一成 AgentHub RunEvent。

## 0. 官方资料与接入结论

截至 2026-06-06，官方 Codex 文档给出三类可用接入面：

- Codex SDK：面向程序化控制本地 Codex agent。TypeScript SDK 要求 server-side Node.js 18+，支持 `startThread()`、`resumeThread(threadId)` 和 `thread.run(...)`；Python SDK 控制本地 Codex app-server over JSON-RPC，并随 SDK build 包含 pinned Codex CLI runtime。官方说明 TypeScript SDK 比 non-interactive mode 更全面和灵活。见 [Codex SDK](https://developers.openai.com/codex/sdk)。
- Codex app-server：面向 rich client 深集成，覆盖 authentication、conversation history、approvals 和 streamed agent events。协议是 JSON-RPC 2.0，默认 `stdio` JSONL，也支持 WebSocket / Unix socket；CLI 可生成当前 Codex 版本匹配的 TypeScript schema 或 JSON Schema。见 [Codex App Server](https://developers.openai.com/codex/app-server)。
- `codex exec`：面向 scripts、CI、pipeline 和预设 sandbox / approval 的非交互执行。`--json` 会输出 JSONL 事件，包含 `thread.started`、`turn.*`、`item.*` 和 `error`。见 [Non-interactive mode](https://developers.openai.com/codex/noninteractive)。

设计结论：

- V1 采用 **SDK-first**：优先接 `@openai/codex-sdk`，保持与 Claude Code SDK 和 OpenCode SDK/server client 的接入路径一致。
- 当 TypeScript SDK 暴露的 streaming event、approval 或 question 能力不足时，下探到 **Codex app-server JSON-RPC**，而不是把产品主路径降级成 `codex exec`。
- `codex exec --json` 只作为诊断、真实 smoke、SDK/app-server 不可用时的受限 fallback，不能成为长期产品主路径。

## 1. 接入目标

- 用户可以像与其他主智能体聊天一样与 `codex` 单聊。
- 群聊中用户可以显式 `@Codex`。
- Orchestrator 可以把任务委派给 Codex。
- Codex 的文本、reasoning 摘要、命令、文件变更、工具调用、权限请求、用户问答和 workspace diff 进入 AgentHub 统一消息与 timeline 链路。
- Codex 使用用户机器上的 Codex 配置、认证、Skill、MCP、插件和 sandbox 策略；浏览器不保存 OpenAI / ChatGPT / Codex 凭据。
- Runtime 对外只暴露 AgentHub 稳定事件和错误码，不泄漏 SDK、app-server 或 CLI 私有协议。

## 2. Runtime 拓扑

```text
web
  -> hub-server
    -> agent-runtime
      -> ExternalAdapterExecutor
        -> CodexAdapter
          -> CodexClient
            -> @openai/codex-sdk
            -> codex app-server JSON-RPC fallback
            -> codex exec --json smoke/fallback
```

浏览器不直接访问 Codex SDK、app-server 或 WebSocket listener。HubServer 仍是业务状态中心，Agent Runtime 仍是执行面，`CodexAdapter` 只负责外部执行和事件转换。

`CodexAdapter` 不直接把 Codex SDK 类型散落到 Runtime 上层。实现时应先定义内部 `CodexClient` 接口，再由具体 client 适配官方 SDK / app-server / exec：

- `CodexSdkClient`：默认 client，封装 `Codex`、thread start/resume 和 run。
- `CodexAppServerClient`：当需要完整 streamed events、approval bridge、question bridge 或 schema-level 控制时启用。
- `CodexExecClient`：只用于 smoke、诊断和 fallback，功能受限。

这样可以在官方 SDK 继续演进时保持 Runtime、HubServer 和 Web 的协议稳定。

## 3. Agent 身份

Runtime 预设主智能体：

```ts
id: "codex"
name: "Codex"
origin: "external"
visibility: "visible"
executorType: "external-adapter"
external.provider: "codex"
external.workingDirectoryPolicy: "runtime-workspace"
external.configDirectoryPolicy: "user-global"
external.outputFormat: "event-stream"
```

`codex` 不配置 `allowedTools`，也不进入 Runtime Tool Catalog。Codex 原生命令、文件变更、MCP、Skill、web search 等能力只通过外部 tool timeline 事件呈现。

## 4. Workspace、Sandbox 与 Thread

Codex 必须绑定 workspace 才能执行。Adapter 不回退到 Runtime 进程级 workdir；未绑定 workspace 返回 `ADAPTER_WORKSPACE_REQUIRED`。

Workspace 规则：

- `cwd` 固定为当前 Run 绑定的 canonical workspace root。
- 默认 sandbox 使用 `workspaceWrite` / `Sandbox.workspace_write`，writable root 限制为当前 workspace。
- 只读规划或审查类能力后续可通过 per-run 策略切到 `readOnly` / `Sandbox.read_only`。
- `fullAccess` / `Sandbox.full_access` 绝不作为默认值，只能在明确产品策略和用户审批后开放。
- 网络能力按 Codex/app-server sandbox policy 表达；V1 默认与当前外部 agent policy 对齐，允许网络，但仍尊重 Codex 原生 approval / sandbox 配置。

Codex Thread 是外部 Session 的 provider session id。Session scope 复用公共外部智能体设计：

- `conversation-visible`：单聊 Codex，或群聊中用户直接 `@Codex`。
- `delegated-task`：Orchestrator 通过 `run_task` 委派 Codex。

HubServer 持久化 `ExternalAgentSession`，其中 `provider = "codex"`、`agentId = "codex"`、`workspaceIdentity = workspace.workspaceId`。Direct run 会注入 `externalSessionHints`，Runtime 在可恢复时调用 `resumeThread(threadId)` / `thread/resume`。新建或恢复后的真实 thread id 必须在 `agent.completed.data.externalSession` 中回传，供 HubServer upsert。

Delegated task 默认创建独立 Codex thread；重试同一 task 可以复用 task thread。并行任务不得共用同一 task thread。

## 5. Context Bridge

HubServer 已将 OpenCode-specific direct context bridge 泛化为 provider-aware external context bridge。Direct Codex run 应接收：

```ts
externalContext: [{
  provider: "codex",
  agentId: "codex",
  scope: "conversation-visible",
  mode: "delta" | "bootstrap",
  messages: [...],
  handoffSummaries: [...],
  cursorCandidate,
  omitted
}]
```

V1 推荐沿用 OpenCode / Claude Code 当前模式：`CodexAdapter` 把该 packet 格式化为 `AgentHub visible context` prompt 前缀，再追加 `Current user request`。该 context 只包含用户可见聊天事实和 delegated handoff summary，不包含 raw RunEvent、reasoning、内部工具续跑消息或 Orchestrator 私有计划。

当 app-server client 可用且稳定时，可以改用 `thread/inject_items` 将可见上下文作为预构造 Responses API items 注入 thread；但 V1 不依赖该能力，避免过早绑定 app-server 细节。

Delegated task 不使用 direct context packet。Adapter 使用 task title、instruction、expected output、risk level、当前用户目标摘要和相关公共上下文生成 task prompt。任务完成后生成 handoff summary，写入 `agent.completed.data.handoffSummary` 与 `externalSession.handoffSummary`。

HubServer 只在 `agent.completed.data.status = "completed"` 且 Codex 确认本轮 context 已应用后推进 `ExternalAgentSession.metadataJson.contextBridge`。失败、取消或中途重启不推进 cursor。

## 6. 执行流程

### 6.1 直接调用

1. 用户在单聊或群聊中发送 `@Codex` 请求。
2. EntryResolver 将入口解析为 `codex`。
3. HubServer 注入 workspace snapshot、provider-aware external session hint、external context packet 和 pinned messages。
4. `CodexAdapter` 查找或创建 conversation-visible Codex thread。
5. Adapter 以当前 workspace root 为 `cwd`，以 workspace-write sandbox 启动一轮 Codex run / turn。
6. Adapter 将 Codex streaming events 映射为 AgentHub `message.*`、`reasoning.*`、`tool.*`、`permission.*`、`question.*`。
7. Run 终态事件携带通用 `workspaceDiff`，HubServer 将有变化的摘要投影为 diff Artifact。

### 6.2 Orchestrator 委派

1. Orchestrator 通过 `run_task` 委派 `codex`。
2. Adapter 创建或恢复 delegated-task Codex thread。
3. Adapter 发送 task-specific prompt，不污染 conversation-visible thread。
4. Codex 输出作为普通 `codex` assistant message 进入群聊，并带 `taskId`、`parentAgentId`、`groupId`。
5. Adapter 生成 handoff summary，后续 direct `@Codex` 可通过 direct context bridge 感知该任务结果。

### 6.3 取消

Run cancel 必须尝试中止 Codex active turn：

- SDK 若提供 abort signal / cancellation API，优先使用 SDK。
- app-server 使用 `turn/interrupt`，终态映射为 AgentHub `run.cancelled`。
- exec fallback 使用子进程 signal 终止，并将未完成状态映射为 `ADAPTER_ABORT_FAILED` 或 `run.cancelled`。

取消时 pending external permission 和 question waiter 必须一起取消，输出 `permission.cancelled` / `question.cancelled`。

## 7. 事件映射

Codex SDK 若直接提供结构化 event stream，则按相同语义映射。若 SDK 只返回最终结果或事件粒度不足，则 `CodexAdapter` 应下探 app-server JSON-RPC。以下以 app-server 事件为完整目标映射：

| Codex 信号 | AgentHub RunEvent |
| --- | --- |
| `thread/start` / `thread/resume` 成功 | `agent.started.data.externalSession` 或内部 session update |
| `turn/start` 成功 | `agent.started` |
| `item/agentMessage/delta` | `message.delta` |
| `item.completed(item.type="agentMessage")` | `message.completed`，以 final item 为权威文本 |
| `item/reasoning/summaryTextDelta` | `reasoning.delta` |
| `item.completed(item.type="reasoning")` | `reasoning.completed` |
| `item/plan/delta` / `item.completed(item.type="plan")` | 外部 trace，可作为 `tool.*` 或 message metadata；不得混同为 Orchestrator `write_plan` |
| `item.started(item.type="commandExecution")` | `tool.started(toolName="codex.commandExecution")` |
| `item/commandExecution/outputDelta` | `tool.completed` 前的外部 tool progress metadata；Web 可后续增强 live output |
| `item.completed(item.type="commandExecution")` | `tool.completed` 或 `tool.failed` |
| `item.started/item.completed(item.type="fileChange")` | `tool.started` / `tool.completed(toolName="codex.fileChange")`，最终 Diff 仍以通用 Workspace Diff 为事实来源 |
| `item.started/item.completed(item.type="mcpToolCall")` | `tool.started` / `tool.completed` / `tool.failed`，保留 external provider 边界 |
| `item.started/item.completed(item.type="dynamicToolCall")` | `tool.*`；V1 不主动注册 AgentHub dynamic tools 给 Codex |
| `item.started/item.completed(item.type="webSearch")` | `tool.*`，`permissionType` 视 approval payload 决定 |
| `item/tool/requestUserInput` | `question.requested` / `question.answered` / `question.cancelled` |
| app-server `error` | `agent.completed` error 或 `run.failed` |
| `turn/completed` | `agent.completed`，随后 Runtime 正常输出 `run.completed` |
| `turn/interrupt` / interrupted status | `agent.completed(status="cancelled")` / `run.cancelled` |

外部 tool event 必须保留 provider 边界：

- `toolCallId = "codex:<providerItemId>"`。
- `data.externalProvider = "codex"`。
- `data.providerSessionId` 使用 Codex thread id。
- `data.providerTurnId` 使用 Codex turn id。
- `data.providerItemId`、`providerItemType`、`providerToolName`、`providerMetadata` 保留追踪信息。
- 脱敏后的 input/output/error 放入 `data.output`、`data.data` 或 `data.result`，以兼容 HubServer/Web 现有 Tool UI 提取顺序。

`fileChange` item 只作为 timeline trace 和用户理解辅助。真正的文件变更归因、diffstat、bounded patch 和回滚资格仍由 Runtime 通用 `WorkspaceDiffService` 在 Run 开始/结束时计算。

## 8. 权限桥接

Codex 原生工具不进入 AgentHub Runtime Tool Registry。Codex 权限请求通过 external permission waiter 桥接到 AgentHub UI。

app-server approval 流程：

- Command execution approval：`item/commandExecution/requestApproval` -> AgentHub `permission.requested`。
- File change approval：`item/fileChange/requestApproval` -> AgentHub `permission.requested`。
- App / MCP side-effect approval：`tool/requestUserInput` 如表达用户确认，优先映射为 `question.*`；若语义是安全审批，可映射为 `permission.*`，但必须保留 provider metadata。

权限类型映射：

| Codex approval | AgentHub `permissionType` |
| --- | --- |
| command execution | `command_execute` |
| command execution with `networkApprovalContext` | `network_access` |
| file change | `file_write` |
| read-only file access request | `file_read` |
| unknown approval | `command_execute`，risk level 至少 medium |

决策映射：

- AgentHub approve -> Codex `accept`。
- AgentHub deny -> Codex `decline`。
- Run cancel -> Codex `cancel`，并终止 active turn。
- Codex `acceptForSession` 和 `acceptWithExecpolicyAmendment` 不在 V1 UI 开放；只有 AgentHub 产品层支持明确作用域后再启用。

脱敏规则：

- app-server 的 `additionalPermissions` 可能包含 wire-level absolute paths。Adapter 输出给 HubServer/Web 前必须转换为 workspace-relative logical path 或省略真实绝对路径。
- `cwd` 对外只回显 `"."` 或 workspace-relative path，不返回 workspace root。
- 不记录 API key、ChatGPT token、完整 prompt、完整 command output 或完整 provider payload。

如果用户 Codex 配置本身允许某些操作且不会发起 approval，AgentHub 无法强制拦截；AgentHub 仍通过通用 Workspace Diff 观测最终文件变化。

## 9. 用户问答桥接

Codex app-server 的 `item/tool/requestUserInput` 可表示工具执行期间需要用户输入。Adapter 应把它桥接为 AgentHub `question.*`：

- 请求进入 `question.requested`，metadata 包含 `externalProvider = "codex"`、`providerSessionId`、`providerTurnId`、`providerQuestionId` 和脱敏 `providerMetadata`。
- 用户回答后，Runtime 输出 `question.answered` 与 `tool.completed(toolName="question")`，Adapter 将答案回传给 Codex pending request。
- Run cancel 时输出 `question.cancelled` 与对应 `tool.failed(QUESTION_CANCELLED)`，并清理 Codex pending request。

不得把用户问答伪装成权限审批卡片。

## 10. Codex 配置与认证策略

AgentHub 不负责：

- 写入 Codex 全局配置来配置 Codex 使用哪个模型。
- 管理 OpenAI API key 或 ChatGPT OAuth token。
- 管理 Codex Skill、MCP、plugin、hook、command 或 `config.toml`。
- 将 Codex 模型选择接入 AgentHub ProviderService。

Codex: AgentHub may pass only `model` into `ThreadOptions`. Other Codex SDK options stay fixed in this phase.

AgentHub 可以保存一份只作用于 AgentHub-originated runs 的 Codex SDK runtime override，并在创建或恢复 Codex thread 时把 `model` 传入 `ThreadOptions`。该 override 不写入 Codex `config.toml`、不管理 OpenAI / ChatGPT 凭据、不改变 Skill / MCP / plugin / hook / command，也不把 Codex 模型接入 AgentHub ProviderService。本阶段为了保持最小改动，只开放 `model`；`sandboxMode`、`approvalPolicy`、`modelReasoningEffort`、`webSearchMode`、`additionalDirectories`、app-server experimental API 和 auth/login 能力均保持既有固定策略或后续单独设计。

V1 默认使用用户本机已有 Codex 配置和认证。Runtime 可以做只读状态检查：

- SDK/app-server 是否可启动。
- `account/read` 是否显示需要登录。
- 当前 auth mode 是否为 `apikey`、`chatgpt`、`chatgptAuthTokens` 或未登录。
- 当前是否存在 active Codex Run。

后续如需在 AgentHub 中引导 Codex 登录，只允许通过 HubServer 代理 app-server 的 `account/login/start` / `account/login/completed` 状态；浏览器不保存 token，Runtime 不把 token 写入 HubServer 数据库。API key 登录也应只写入 Codex 自身受控存储，不进入 AgentHub ProviderService。

`CODEX_API_KEY` 只适用于 `codex exec` 单次调用的 automation 场景，不作为 AgentHub 产品主路径的默认认证方式。

## 11. 服务状态

`GET /runtime/services/status` 中 `codex` 目标语义：

- `implemented = true`。
- `status = "running"`：Runtime 内存中至少有一个非终态 Run 正在直接执行或委派执行 `codex`。
- `status = "idle"`：SDK/app-server 可用，且当前没有非终态 Codex Run。
- `status = "error"`：SDK package、Codex runtime、app-server 初始化或只读 auth/readiness 探测失败。
- `details.activeRunCount`：当前非终态 Codex Run 数。
- `details.clientMode`：`sdk`、`app-server` 或 `exec-fallback`。
- `details.authMode`：只读脱敏状态，可为 `apikey`、`chatgpt`、`chatgptAuthTokens`、`none` 或 `unknown`。
- `details.version`：可用时返回 Codex runtime / SDK version。

状态检查不得启动 prompt、创建 thread、写 workspace、打开浏览器登录流程或触发模型调用。

## 12. 生产打包与版本策略

Codex SDK / app-server 的版本边界必须被显式管理：

- TypeScript SDK 作为 Runtime dependency 时，应固定 semver range，并在 lockfile 中 pin 实际版本。
- 如果使用 app-server JSON-RPC，必须在实现阶段运行 `codex app-server generate-ts --out <schema-dir>` 或等价 schema 生成，生成物与当前 Codex runtime 版本匹配。
- App-server experimental API 只有在确有需要时通过 `initialize.params.capabilities.experimentalApi = true` 开启；默认留在非 experimental surface。
- 生产打包需要确认 SDK 是否依赖外部 `codex` binary 或 npm package 内置 runtime。若 binary 无法在 Bun compiled runtime 中解析，应采用与 Claude Code 类似的 explicit executable path / asset extraction 策略。

官方 Feature Maturity 定义中，Experimental 代表 OpenAI 可能移除或变更。任何依赖 experimental app-server method/field 的能力都必须被隔离在 `CodexAppServerClient` 内，并有测试覆盖和 fallback 策略。

## 13. 测试与 Smoke

默认自动化测试不得依赖用户本机 Codex 登录状态或真实 OpenAI 凭据：

- Runtime fake `CodexClient` 覆盖 direct/delegated stream、session hint、tool events、permission approve/deny/cancel、question answer/cancel、turn interruption。
- HubServer 测试覆盖 `codex` external session hint、direct context packet、contextBridge cursor 推进。
- Service status 测试覆盖 `codex.implemented = true` 后的 idle/running/error 映射。
- Workspace Diff 测试复用通用 Runtime diff service，不写 Codex 私有 diff 测试链路。

真实 smoke 通过环境变量显式开启：

- `AGENTHUB_CODEX_SMOKE=1`：验证 SDK/app-server 可启动，并能使用用户本机 Codex 账号完成最小 prompt。
- `AGENTHUB_CODEX_PROMPT_SMOKE=1`：在临时 workspace 中验证 direct prompt 产生非空 `message.completed`。
- `AGENTHUB_CODEX_WRITE_SMOKE=1`：在临时 git workspace 中验证 Codex 可写文件，并触发通用 Workspace Diff。
- `AGENTHUB_CODEX_EXEC_SMOKE=1`：验证 `codex exec --json` fallback 能解析 JSONL 事件。

真实 smoke 只能使用临时 workspace，不修改用户项目文件，不写入 Codex 全局配置，不把 API key 注入到会运行仓库代码的环境中。

## 14. 分阶段落地

### Phase 1：SDK-first 最小闭环

- 新增 `codex` preset agent 和 `CodexAdapter`。
- 新增 `CodexClient` interface 与 fake client。
- 使用 `@openai/codex-sdk` 完成 thread start/resume/run。
- 映射最终文本为 `message.completed`，回传 `externalSession`。
- `GET /runtime/services/status` 将 Codex 从 `not_integrated` 改为真实 idle/error。

### Phase 2：Streaming 与 Timeline

- 若 SDK 暴露 streaming events，直接映射；否则接入 `CodexAppServerClient`。
- 映射 `agentMessage`、`reasoning`、`commandExecution`、`fileChange`、`mcpToolCall`、`webSearch` 等 item。
- 保留 Codex item raw metadata 的脱敏调试摘要。

### Phase 3：权限与用户问答

- 桥接 command/file/network approval 到 AgentHub `permission.*`。
- 桥接 `tool/requestUserInput` 到 AgentHub `question.*`。
- 实现 cancel 对 pending approval/question 的清理。

### Phase 4：上下文与 Session 硬化

- HubServer 将 `codex` 加入 direct context bridge 支持列表。
- delegated task 生成 handoff summary。
- 支持 thread resume、thread 丢失恢复、bounded bootstrap 和 cursor 推进。

### Phase 5：生产硬化

- app-server schema generation 与版本 pin。
- 可选真实 smoke。
- Bun compiled binary/runtime resolution。
- 只读 auth/status UI。

## 15. 非目标

Codex V1 不做：

- AgentHub 内配置 Codex 模型或 OpenAI provider。
- AgentHub 内管理 Codex Skill / MCP / plugin / hook / command。
- 把 Codex 原生工具重写成 AgentHub Runtime Tools。
- 强制 Codex 使用 AgentHub ProviderService。
- 在 AgentHub 中复刻 Codex TUI、IDE extension 或完整 app-server client UI。
- 将 `codex exec` 作为主要聊天执行通道。
- 自动合并多个并行 Codex thread 的文件修改。
- 开放 `acceptForSession`、`acceptWithExecpolicyAmendment`、`fullAccess` 或 experimental dynamic tools 给普通用户。

## 16. 风险与待确认点

- TypeScript SDK 当前文档展示了 thread/run 基本能力，但未在公开 SDK 页面完整列出 streaming event、approval callback 和 cancellation API。实现时需要以 SDK repo/types 为准；若缺失，改走 app-server JSON-RPC。
- App-server 适合深集成，但部分 transport/API 是 experimental。实现必须把 experimental 依赖隔离在 client 层，并优先使用稳定方法。
- Codex 原生配置可能直接允许某些命令或文件变更，AgentHub 只能观察 tool timeline 与最终 Diff，不能强制拦截所有操作。
- Codex auth 可能处于 API key、ChatGPT managed 或 external tokens 模式。AgentHub V1 应只读展示状态，不接管凭据生命周期。
- Windows sandbox 和 Bun compiled distribution 需要真实 smoke 验证，尤其是 SDK/runtime binary resolution。
