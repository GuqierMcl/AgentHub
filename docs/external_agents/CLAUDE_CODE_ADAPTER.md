# Claude Code Adapter 设计

本文档定义 AgentHub 接入 Claude Code 的专属设计。公共外部智能体原则见 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`。

Claude Code 在 AgentHub 中被视为完整外部聊天对象。AgentHub 不把 Claude Code 拆成普通模型 Provider，也不在 AgentHub 中管理 Claude Code 的模型、账号、MCP、Skill、hook 或全局配置。Runtime 只通过 Claude Agent SDK 驱动当前 workspace 中的一次 agent 执行，并把输出归一成 AgentHub RunEvent。

## 1. 接入目标

- 用户可以像与其他主智能体聊天一样与 `claude-code` 单聊。
- 群聊中用户可以显式 `@Claude Code`。
- Orchestrator 可以把任务委派给 Claude Code。
- Claude Code 的文本、工具、权限、用户问答和 workspace diff 进入 AgentHub 统一消息与 timeline 链路。
- Claude Code 使用用户机器上的 Claude Code 登录、账号、计费和全局配置；浏览器不保存 Claude 凭据。

## 2. Runtime 拓扑

```text
web
  -> hub-server
    -> agent-runtime
      -> ExternalAdapterExecutor
        -> ClaudeCodeAdapter
          -> @anthropic-ai/claude-agent-sdk query()
            -> Claude Code executable
```

浏览器不直接访问 Claude Code。HubServer 仍是业务状态中心，Agent Runtime 仍是执行面，`ClaudeCodeAdapter` 只负责外部执行和事件转换。

当前实现依赖 `@anthropic-ai/claude-agent-sdk`。Runtime 使用 SDK 的 `query()` async generator，而不是直接把 Anthropic 模型接入 ProviderService。`RealClaudeCodeClient` 设置的关键 option：

- `cwd`：固定为当前 Run 绑定的 workspace root。
- `resume`：仅当 HubServer 提供可恢复 provider session id，且 id 不是 `pending_*` / `fake_*` 时传入。
- `includePartialMessages: true`：允许接收底层 stream event。
- `permissionMode: "default"`：保留 Claude Code 默认危险操作判断。
- `canUseTool`：桥接 Claude Code 工具权限到 AgentHub permission lifecycle；当 `toolName` 是 `AskUserQuestion` / `ask_user_question` 时不进入权限审批，而是先走 AgentHub question lifecycle，用户回答后通过 SDK `{ behavior: "allow", updatedInput }` 回填答案。
- `onUserDialog`：桥接 Claude Code `AskUserQuestion` 类 dialog 到 AgentHub question lifecycle，用作 SDK dialog control request 路径。
- `pathToClaudeCodeExecutable`：可由 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 覆盖。

SDK 还支持 `model`、`permissionMode`、`allowedTools` / `disallowedTools`。AgentHub 可以保存一份只作用于 AgentHub-originated runs 的 Claude Code SDK runtime override，并在调用 `query({ options })` 时传入 `model` 和安全范围内的 `permissionMode`。该 override 不写入 Claude Code 全局配置、账号、MCP、Skill、hook 或工具配置。

Claude Code: AgentHub may pass `model` and safe `permissionMode` values to `query({ options })`. `bypassPermissions` is out of scope for this phase.

本阶段允许的 `permissionMode` 为 `default`、`acceptEdits`、`plan`、`dontAsk` 和 `auto`。`bypassPermissions` 需要 `allowDangerouslySkipPermissions` 并会绕过权限检查，当前不在 AgentHub UI、Runtime API 或持久化设置中开放。AgentHub MVP 暂不主动覆盖 `allowedTools` / `disallowedTools`，默认让 Claude Code 使用用户本机配置和 SDK 默认工具集；如后续产品需要 per-run 只读/可写工具列表，应在本文档新增明确策略后再启用。

## 3. Agent 身份

Runtime 预设主智能体：

```ts
id: "claude-code"
origin: "external"
visibility: "visible"
executorType: "external-adapter"
external.provider: "claude-code"
external.workingDirectoryPolicy: "runtime-workspace"
external.configDirectoryPolicy: "user-global"
external.outputFormat: "event-stream"
```

`claude-code` 不配置 `allowedTools`，也不进入 Runtime Tool Catalog。它的原生工具只通过外部 tool timeline 事件呈现。

## 4. Workspace 与 Session

Claude Code 必须绑定 workspace 才能执行。Adapter 不回退到 Runtime 进程级 workdir；未绑定 workspace 返回 `ADAPTER_WORKSPACE_REQUIRED`。

Session scope 复用公共外部智能体设计：

- `conversation-visible`：单聊或群聊中用户直接调用 `claude-code`。
- `delegated-task`：Orchestrator 通过 `run_task` 委派 Claude Code。

HubServer 持久化 `ExternalAgentSession`，其中 `provider = "claude-code"`，`agentId = "claude-code"`，`workspaceIdentity = workspace.workspaceId`。Direct run 会注入 `externalSessionHints`，Runtime 在可恢复时把 hint 传给 SDK `resume`。SDK 返回真实 `session_id` 后，Runtime 用 `session.updated` 内部事件更新当前 provider session，并在 `agent.completed.data.externalSession` 中回传最终 session link，供 HubServer upsert。

## 5. Context Bridge

HubServer 已将 OpenCode-specific direct context bridge 泛化为 provider-aware external context bridge。Direct Claude Code run 可以收到：

```ts
externalContext: [{
  provider: "claude-code",
  agentId: "claude-code",
  scope: "conversation-visible",
  mode: "delta" | "bootstrap",
  messages: [...],
  handoffSummaries: [...],
  cursorCandidate,
  omitted
}]
```

`ClaudeCodeAdapter` 把该 packet 格式化为 `AgentHub visible context` prompt 前缀，再追加 `Current user request`。该 context 只包含用户可见聊天事实和 delegated handoff summary，不包含 raw RunEvent、reasoning、内部工具续跑消息或 Orchestrator 私有计划。

Delegated task 不使用 direct context packet。Adapter 使用 task title、instruction、expected output、risk level 和当前用户请求生成 task prompt。任务完成后生成 handoff summary，写入 `agent.completed.data.handoffSummary` 与 `externalSession.handoffSummary`。

HubServer 只在 `agent.completed.data.status = "completed"` 且 provider 支持时推进 `ExternalAgentSession.metadataJson.contextBridge`。当前支持 `opencode` 与 `claude-code`。

## 6. 事件映射

| Claude Agent SDK / Claude Code 信号 | AgentHub RunEvent |
| --- | --- |
| `stream_event.content_block_delta` 的 text delta | `message.delta` |
| `assistant` message 或成功 `result.result` | `message.completed` |
| `system init` / `result.session_id` | 更新 provider session id |
| `content_block_start(tool_use)` | `tool.started` |
| `SDKUserMessage.message.content[]` 中的 `tool_result.tool_use_id` | `tool.completed` |
| `system permission_denied` | `tool.failed` |
| `canUseTool` permission callback（普通工具） | `permission.requested`，随后 `permission.approved` / `permission.denied` / `permission.cancelled` |
| `canUseTool` 中的 `AskUserQuestion` / `ask_user_question` | `question.requested`，随后 `question.answered` / `question.cancelled`，再以 SDK `updatedInput.answers` 回传 |
| `onUserDialog` 的 `AskUserQuestion` 类 dialog | `question.requested`，随后 `question.answered` / `question.cancelled` |
| SDK `result` error | `ADAPTER_PROMPT_FAILED` |

外部原生 tool 事件必须保留 provider 边界：

- `toolCallId = "claude-code:<providerToolCallId>"`。
- `data.externalProvider = "claude-code"`。
- `data.providerSessionId`、`providerToolCallId`、`providerToolName`、`providerMetadata` 保留追踪信息。
- `messageId` 复用当前 Claude Code assistant message id，使文本和工具 timeline 聚合到同一条消息。

`parent_tool_use_id` 只作为子智能体或旧 top-level `tool_use_result` 形态的兜底匹配字段；普通主会话工具结果必须以 `tool_result.tool_use_id` 作为完成事件的 provider tool call id。

## 7. 权限桥接

Claude Code 的普通 `canUseTool` 回调由 Adapter 接到 `RuntimePermissionService.stageExternalApproval()`。这不是 AgentHub Runtime Tool 审批，也不会进入 AI SDK approval continuation。`AskUserQuestion` 是明确例外：SDK 可能先通过 `canUseTool("AskUserQuestion", input, { toolUseID })` 触发它，Runtime 必须把它路由到 question bridge，不得产生 `permission.*`。

映射规则：

- `Edit` / `Write` / `NotebookEdit` -> `permissionType = "file_write"`，默认高风险。
- `Read` / `Ls` / `Glob` / `Grep` -> `permissionType = "file_read"`，默认低风险。
- `WebFetch` / `WebSearch` -> `permissionType = "network_access"`。
- `Bash` 和未知工具 -> `permissionType = "command_execute"`。

AgentHub approve 返回 SDK `{ behavior: "allow" }`；deny 返回 `{ behavior: "deny" }`。Run cancel 会取消 pending external permission waiter，并让 Adapter 停止 active prompt。

首版不支持 Claude Code 的“始终允许”配置写回，也不修改 Claude Code 用户配置。SDK `canUseTool` 提供的 permission suggestions 只保留为未来扩展输入，不在 MVP 中落库为长期授权。

## 8. AskUserQuestion Bridge

Claude Code 执行中可能通过 SDK `onUserDialog` 请求用户输入，也可能在 `canUseTool` 中以 `toolName = "AskUserQuestion"` / `ask_user_question` 出现。`ClaudeCodeAdapter` 将这两类信号都转成 AgentHub `question.*` 事件，而不是伪装成权限请求。

`canUseTool` 路径下，Adapter 会把 SDK `input.questions[]` 转成 AgentHub `QuestionItem[]`。用户回答后，Runtime 返回 SDK `PermissionResult`：

```ts
{
  behavior: "allow",
  updatedInput: {
    ...input,
    answers: {
      [questionText]: answerText
    }
  },
  toolUseID
}
```

这让 Claude Code 的 `AskUserQuestion` 原生工具继续执行，但前端看到的是 AgentHub question 卡片和 `tool.completed(toolName="question")`，不会出现权限审批卡片。

事件 metadata 包含：

- `externalProvider = "claude-code"`。
- `providerSessionId`。
- `providerQuestionId`。
- `providerToolCallId`。
- 脱敏后的 `providerMetadata`。

用户回答后，Runtime 输出 `question.answered` 和 `tool.completed(toolName="question")`，Adapter 将归一化答案回传 SDK dialog result。Run cancel 时输出 `question.cancelled` 与对应 `tool.failed`，并返回取消语义给 SDK。

## 9. 服务状态

`GET /runtime/services/status` 中 `claude-code` 已实现：

- `implemented = true`。
- `status = "running"`：SDK 可用，且 Runtime 内存中至少有一个非终态 Run 正在直接执行或委派执行 `claude-code`。
- `status = "idle"`：SDK 可用，且当前没有非终态 Claude Code Run。
- `status = "error"`：后续如果加入 executable 探测且失败时使用。
- `details.executableSource = "sdk-bundled" | "env"`。
- `details.activeRunCount`：当前非终态 Claude Code Run 数。
- `details.executablePath` 仅在 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 设置时返回。

该状态检查不得启动 prompt、创建 session、写 workspace 或触发 Claude 登录流程。

## 10. 生产打包与 Binary Resolution

Claude Agent SDK 默认依赖随包安装的平台原生 Claude Code binary。官方 README 对 `bun build --compile` 有特殊提醒：单文件可执行中的 `$bunfs` 虚拟文件系统会让 SDK 无法在运行时通过 `require.resolve` 找到 native CLI binary。

AgentHub 生产发行必须显式处理：

- 开发和生产 bundle Runtime：默认使用 SDK bundled binary，前提是 package 阶段保留 SDK 需要的真实文件路径。
- 用户或打包脚本覆盖：设置 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 指向真实文件路径，并传给 `pathToClaudeCodeExecutable`。
- 服务进程不再默认使用 Bun compiled 单 exe。若未来重新尝试 compiled Runtime，必须先证明 SDK bundled binary 能从真实路径解析，或在启动时抽取到真实路径后再设置 `pathToClaudeCodeExecutable`。Windows 目标需使用 `claude.exe` 子路径。

在该打包策略未闭环前，生产 smoke 必须覆盖 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 路径。

## 11. 测试与 Smoke

默认测试不依赖用户本机 Claude 登录状态或真实 API 凭据：

- Runtime fake client 覆盖 direct/delegated stream、session hint、tool events、permission approve/deny/cancel、AskUserQuestion；真实 client 单测覆盖 `canUseTool("AskUserQuestion")` 不调用 permission bridge。
- HubServer 测试覆盖 `claude-code` external session hint、direct context packet、contextBridge cursor 推进。
- Service status 测试覆盖 `claude-code.implemented = true`。

真实 smoke 已接入，但需要显式环境变量开启：

- `AGENTHUB_CLAUDE_CODE_SMOKE=1`：验证 SDK/executable 可启动，并能使用用户本机 Claude Code 账号完成最小 prompt。
- `AGENTHUB_CLAUDE_CODE_WRITE_SMOKE=1`：在临时 git workspace 中验证 Claude Code 可写文件，并触发通用 Workspace Diff。

真实 smoke 只能使用临时 workspace，不修改用户项目文件，不写入 Claude Code 全局配置。

## 12. 风险与待确认点

- SDK message 类型较丰富，当前 event mapping 覆盖 MVP 需要的文本、tool、permission denied、result 和 user dialog；更多状态事件应按实测增量补充。
- `AskUserQuestion` 的 payload shape 可能随 Claude Code 版本演进，并可能出现在 `onUserDialog` 或 `canUseTool` 两条路径；当前实现做了宽松字段读取，仍需要真实 smoke 验证复杂问题表单。
- Claude Code 原生配置可能直接允许某些工具执行，AgentHub 只能观察工具事件和最终 Diff，不能强制拦截所有操作。
- 多个外部智能体或内部智能体并发编辑同一 workspace 时，仍依赖通用 Workspace Diff 的 aggregate 归因和后续冲突处理。
- 生产 bundle distribution 必须在发行包 smoke 中验证 Claude Code SDK bundled binary 或 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 覆盖路径可用。
