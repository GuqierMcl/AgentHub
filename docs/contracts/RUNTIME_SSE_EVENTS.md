# Agent Runtime SSE 事件契约

本文档记录 Agent Runtime `GET /runtime/runs/:runId/events` 的 SSE 事件契约。`AGENT_RUNTIME_API_CONTRACTS.md` 保留 Runtime Runs API 主契约；事件细节以后以本文档为准。

## 1. Wire Format

响应类型：`text/event-stream`

每条事件使用 RunEvent `type` 作为 SSE event name：

```text
event: message.delta
data: {"id":"evt_xxx","runId":"run_xxx","type":"message.delta","timestamp":"2026-05-26T00:00:00.000Z","agentId":"coder","messageId":"msg_run_xxx_execution_xxx_0","messageIndex":0,"data":{"delta":"hello"}}
```

订阅行为：

- 订阅时先按创建顺序 replay 已有事件。
- Run 未结束时继续推送新事件。
- 收到 `run.completed`、`run.failed` 或 `run.cancelled` 后关闭流。
- Run 不存在时返回 `RUN_NOT_FOUND`。

实现约束：

- SSE handler 必须避免 replay 快照与 live subscribe 之间的尾部事件竞态。推荐先注册 live subscription，再 replay 当前事件表，并用 event id 去重；如果 replay 后发现 Run 已是 terminal 状态，应再次 drain 当前事件表，确保 terminal 事件和其前面的 `message.*` / `agent.completed` 已进入本次响应后再关闭。
- SSE handler 在等待长时间外部执行或模型输出时必须发送 keepalive comment，例如 `: keepalive`，间隔应短于 server idle timeout。业务消费者必须忽略 comment，只处理带 `data:` 的事件。
- HubServer 消费 Runtime SSE 时，不能只因为本地 Run 状态已是 terminal 就停止补连；只有确认 Runtime terminal event 已经持久化，才能把流结束视为正常完成。

基础字段：

```ts
type RunEvent = {
  id: string
  runId: string
  type: string
  timestamp: string
  agentId?: string
  parentAgentId?: string
  parentTaskId?: string
  taskId?: string
  groupId?: string
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  data?: unknown
}
```

## 2. Diagnostics Defaults

`POST /runtime/runs` 可通过 `input.diagnostics` 控制模型流追踪：

```ts
type RunDiagnostics = {
  includeModelStream?: boolean
  includeReasoning?: boolean
  includeRawModelChunks?: boolean
}
```

默认值：

```json
{
  "includeModelStream": true,
  "includeReasoning": true,
  "includeRawModelChunks": false
}
```

规则：

- `includeModelStream=false`：不输出 `model.stream.part`。
- `includeReasoning=false`：不输出 `reasoning.*`，也不通过 `model.stream.part` 输出 AI SDK reasoning part。
- `includeRawModelChunks=true`：允许 `model.stream.part` 输出 AI SDK `raw` part；默认过滤。

## 3. Stable RunEvent Types

当前稳定事件类型：

```text
run.started
agent.entry.resolved
agent.started
orchestrator.plan.created
task.group.started
task.group.completed
task.started
task.completed
task.failed
tool.started
tool.completed
tool.failed
permission.requested
permission.approved
permission.denied
permission.cancelled
question.requested
question.answered
question.cancelled
model.stream.part
reasoning.started
reasoning.delta
reasoning.completed
message.delta
message.completed
agent.completed
system_agent.completed
run.completed
run.failed
run.cancelled
```

`message.*`、`tool.*`、`task.*`、`permission.*`、`question.*`、`agent.*` 和 `run.*` 是 Runtime 语义事件，优先供 HubServer 持久化与 UI 状态渲染使用。

`system_agent.completed` 是 Runtime 内部系统智能体的结果事件。首版只支持 `agentId = "system:title"`，用于把会话第一条用户输入生成的短标题作为同一条 Run SSE 流的一部分交给上游消费方。标题生成不包含第一轮智能体输出；如果首次自动标题错过而 `titleSource` 仍为 `default`，后续 Run 可以使用 `conversationState.titleSeedUserMessage` 重试。标题结果一旦 ready 且 Run 仍未结束，Runtime 会立即输出该事件；主智能体完成时仅保留一个很短的 flush 宽限时间作为兜底。若模型标题没有赶上或生成失败，Runtime 会在 `run.completed` 前输出一个基于首条用户消息的确定性 fallback 标题事件，然后取消后台标题任务；Run 被取消时仍静默跳过。该事件不表示 Runtime 已经更新业务状态，HubServer 后续接入时负责条件落库。

`run.completed`、`run.failed`、`run.cancelled` 是 Run terminal 事件。具备 workspace 的 Run 会在这些事件的 `data.workspaceDiff` 中 best-effort 携带通用 `WorkspaceDiffSummary`，用于 HubServer 投影 diff Artifact 和 Web 摘要卡片。该字段是平台级 workspace 变更摘要，不属于 OpenCode 私有 `agent.completed` payload；完整结构见 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`。

## 4. Message Identity

Runtime 使用 `messageId` 表示一次可聚合的智能体消息容器。`message.delta` 与 `message.completed` 仍以模型文本块作为文本边界；`reasoning.*`、`tool.*`、`permission.*` 与 `question.*` 在能归属到当前模型输出时也会携带同一个 `messageId`，供 UI 和后续 HubServer 持久化把同一智能体的思考、工具、审批、问答和文本聚合到同一条产品消息。

规则：

- AI SDK `text-start` 创建一个 Runtime message block。
- 同一 block 内的 `text-delta` 使用同一个 `messageId` 输出 `message.delta`。
- AI SDK `text-end` 输出同一个 `messageId` 的 `message.completed`。
- 若 provider 或旧路径缺少 `text-start/text-end`，Runtime 在第一条 `text-delta` 时创建 fallback block，并在 execution 暂停或结束时补 `message.completed`。
- `messageId` 是 run 内稳定 id，当前形态为 `msg_${runId}_${executionId}_${blockIndex}`。
- `reasoning-start` 可在 `text-start` 之前预留当前消息的 `messageId`；随后同一输出中的文本块复用该 `messageId`。
- 工具、权限或问答事件如果发生在当前模型输出上下文中，也复用当前 `messageId`；缺少明确当前消息时 Runtime 会为该工具/权限/问答上下文创建新的 `messageId`。
- 外部智能体的原生工具调用可以复用 `tool.started` / `tool.completed` / `tool.failed`，并与同一条外部 assistant 消息共享 `messageId/messageIndex`。这类事件不表示外部工具属于 AgentHub Runtime Tool Catalog；消费者应通过 `data.externalProvider` 和 provider 命名空间的 `toolCallId` 区分，例如 `toolCallId = "opencode:<providerToolCallId>"` 或 `"claude-code:<providerToolCallId>"`。
- `messageIndex` 由 RunManager 在首次看到新 `messageId` 时按实际 emit 顺序分配，是 run-local 递增序号；同一 `messageId` 下的 reasoning、tool、permission 和 message 事件共享同一个 `messageIndex`。
- `message.delta` / `message.completed` 可以在 `data.generation` 中携带本次 execution 的轻量模型元信息；`message.completed.data.content` 仍是最终文本事实。
- 外部智能体的 `message.completed` 可以在 `data.externalModel` 中携带本条回复实际使用的外部平台模型，例如 `{ provider: "opencode", providerId: "anthropic", modelId: "claude-sonnet-4", providerName: "Anthropic", modelName: "Claude Sonnet 4" }` 或 `{ provider: "claude-code", providerId: "anthropic", modelId: "claude-sonnet-4" }`。`providerName/modelName` 是只读展示增强，拿不到时可以省略；该字段不表示 AgentHub 接管外部平台的模型配置。
- `agent.completed` 仍表示一次 agent execution 完成；兼容字段 `usage`、`finishReason`、`resolvedModel` 继续保留在 `agent.completed.data`，同时 `agent.completed.data.generation` 提供面向 UI 和后续统计的轻量结构化入口。

示例：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "message.completed",
  "timestamp": "2026-05-26T00:00:00.000Z",
  "agentId": "orchestrator",
  "messageId": "msg_run_xxx_execution_xxx_1",
  "messageIndex": 1,
  "data": {
    "content": "我已经让 Coder 检查过，实现建议如下。",
    "generation": {
      "executionId": "execution_xxx",
      "model": {
        "providerId": "openai",
        "modelId": "gpt-5.1",
        "providerName": "OpenAI",
        "modelName": "GPT-5.1",
        "modelSourceAgentId": "coder"
      }
    }
  }
}
```

持久化兼容：

- HubServer 后续消费 Runtime SSE 时，应把 `RunEvent.messageId` 保存为 `event.messageId`。
- 同一 `messageId` 的 `reasoning.*`、`tool.*`、`permission.*`、`question.*`、`message.delta/completed` 投影到同一 assistant `Message`；文本进入 text `MessagePart`，reasoning/tool/permission/question 可进入对应 message parts 或 metadata。
- 外部 provider tool events 的 `data` 可携带 `externalProvider`、`providerSessionId`、`providerEventId`、`providerToolCallId`、`providerToolName`、`providerExecuted`、`providerMetadata` 以及脱敏后的 `input` / `output` / `error`。Web 可以按普通 timeline 工具卡渲染，但不应把它们用于 AgentHub 内部工具授权或 Tool Catalog 配置。
- `messageIndex` 可先落入 `Message.metadataJson.runtime.messageIndex`；若后续需要强排序字段，可以再做破坏性迁移。

## 5. Generation Metadata

AI SDK 和 Orchestrator 执行器会在现有 Runtime event `data` 内附加可选 `generation` 字段。该字段不替代完整 raw 事件和旧兼容字段，只作为 Web 展示模型名、tokens 与后续统计的轻量索引。

```ts
type RuntimeGeneration = {
  executionId?: string
  model?: {
    providerId: string
    modelId: string
    providerName: string
    modelName: string
    modelSourceAgentId?: string
  }
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    reasoningTokens?: number
    cachedInputTokens?: number
  }
  finishReason?: string
  durationMs?: number
}
```

事件规则：

- `message.delta` / `message.completed` 携带 `generation.executionId` 与 `generation.model`，便于 UI 在 replay 和 live 流中直接恢复消息使用的模型。
- `agent.started` 携带同样的 compact `generation`，用于 execution 级追踪。
- `agent.completed` 携带完整 `generation`，包含可用的 `usage`、`finishReason` 与 `durationMs`；旧字段 `resolvedModel`、`usage`、`finishReason` 保持不变。
- 没有可用模型或用量信息的 mock / external fallback 可以不写 `generation`。
- Tokens 语义是本次 agent execution 的生成用量；如果一次 execution 产生多条可见 assistant message，UI 可以把 usage 标到该 execution 的最后一条可见消息上。

外部智能体的实际回复模型使用独立的 `externalModel` 字段，不复用 `generation`，因为 AgentHub 不解析或管理外部平台的完整 provider/model catalog。

```ts
type RuntimeExternalModel = {
  provider: "opencode" | "claude-code" | string
  providerId: string
  modelId: string
  providerName?: string
  modelName?: string
}
```

事件规则：

- `message.completed.data.externalModel` 只在外部平台返回了可确认的 provider/model id 时出现。display name 字段只在 Runtime 能从外部平台只读 catalog 中解析时出现。
- HubServer 可将该值投影到 assistant `Message.metadataJson.runtime.externalModel`，并在产品 Run replay 中原样保留。
- Web 展示时优先使用 `modelName`；若缺失，可将 `modelId` 人类可读化作为 fallback。未出现 `externalModel` 时应保持未知或不展示，不能从 AgentHub 当前 agent 绑定推断。

## 6. AI SDK Part Passthrough

`model.stream.part` 是 AI SDK `streamText().fullStream` part 的薄封装。它用于调试、细粒度 UI 和未来事件投影，不替代现有高层 RunEvent。

Payload：

```ts
type ModelStreamPartEventData = {
  partType: string
  part: unknown
}
```

示例：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "model.stream.part",
  "timestamp": "2026-05-26T00:00:00.000Z",
  "agentId": "coder",
  "data": {
    "partType": "tool-call",
    "part": {
      "type": "tool-call",
      "toolCallId": "toolu_xxx",
      "toolName": "read_file",
      "input": {
        "path": "README.md"
      }
    }
  },
  "toolCallId": "toolu_xxx",
  "toolName": "read_file"
}
```

默认透传除 `raw` 外的大多数 AI SDK part，包括：

- `text-start`、`text-delta`、`text-end`
- `reasoning-start`、`reasoning-delta`、`reasoning-end`
- `tool-input-start`、`tool-input-delta`、`tool-input-end`
- `tool-call`、`tool-result`、`tool-error`、`tool-output-denied`、`tool-approval-request`
- `start-step`、`finish-step`
- `source`、`file`
- `start`、`finish`、`abort`、`error`

`raw` part 仅在 `includeRawModelChunks=true` 时输出。

## 7. Reasoning Events

`reasoning.*` 是从 AI SDK reasoning part 提升出的稳定 RunEvent。它只表示 provider 或 AI SDK 显式暴露的 reasoning/thinking 内容，不表示 Runtime 能访问隐藏链路。

事件：

```ts
type ReasoningStartedData = {
  reasoningId: string
}

type ReasoningDeltaData = {
  reasoningId: string
  delta: string
}

type ReasoningCompletedData = {
  reasoningId: string
  content: string
}
```

同一个 reasoning block 内，Runtime 会按 `reasoningId` 聚合 delta，并在 `reasoning.completed.data.content` 中返回聚合文本。`reasoning.*` 会尽量携带当前输出的 `messageId/messageIndex`，以便 UI 将 reasoning 折叠块嵌入对应智能体消息；老事件缺少 `messageId` 时，消费者可以退回按 `runId + agentId + reasoningId` 独立渲染。

对于同一个 AI SDK reasoning part，事件顺序为：

```text
model.stream.part
reasoning.started | reasoning.delta | reasoning.completed
```

## 8. Ordering And Compatibility

- 对于 `text-start/text-delta/text-end`，Runtime 先输出 `model.stream.part`，再按文本块输出 `message.delta` 或 `message.completed`。
- 对于 reasoning part，Runtime 先输出 `model.stream.part`，再输出对应 `reasoning.*`。
- 工具调用仍以 `tool.*`、`permission.*`、`question.*` 和 `task.*` 作为稳定语义事件；`model.stream.part` 中的 tool part 只作为模型流追踪。
- 后续如果需要把 `source`、`file`、`tool-input-*` 等提升为独立 RunEvent，应从 `model.stream.part` 增量投影，不改变现有高层事件语义。

## 9. Redaction And Serialization

Runtime 在输出 `model.stream.part.data.part` 前会做 JSON 化和脱敏：

- 不直接输出 `Uint8Array`、`ArrayBuffer` 等二进制对象；改为输出类型和字节长度。
- `Error` 转为 `{ name, message }`。
- `bigint` 转为字符串。
- 循环引用转为 `"[Circular]"`。
- 已知主 workspace root 和授权外部路径会被替换为 `[workspace-root]` 或 `[external-path]`。
- `path` / `file` / `root` 类字段中的未知绝对路径会被泛化为 `[absolute-path]/<basename>`。
- `web_fetch` 的审批事件不包含请求 headers 或 body；`data.data.url` 会移除用户名、密码、hash，并把 query 脱敏为 `?redacted`，同时保留 `host` 和 `method` 供用户判断。
- `bash` 的审批事件不包含 workspace root 或宿主机绝对路径；`data.data.cwd` 是 workspace-relative 逻辑路径。`bash` 工具结果中的 stdout/stderr 已按 `maxOutputBytes` 截断后进入 raw event，并会优先按 UTF-8 解码；Windows 本地代码页输出会按检测到的 ANSI code page 兜底解码。

`raw` part 可能包含 provider 原始内容，默认关闭。需要调试 provider 新特性时，调用方必须显式设置 `includeRawModelChunks=true`。

## 10. Network Permission Payload

`web_fetch` 在 `permissionPolicy.network = "limited"` 时产生标准 `permission.requested`。事件的 `data` 仍是 Runtime permission request 记录，其中 `data.data` 包含网络审批摘要：

```json
{
  "requestId": "permission_xxx",
  "toolName": "web_fetch",
  "status": "pending",
  "data": {
    "permissionType": "network_access",
    "approvalReason": "network_request",
    "method": "GET",
    "url": "https://example.com/search?redacted",
    "host": "example.com"
  }
}
```

批准后 Runtime 发送 `permission.approved`，并在同一 `runId + toolCallId` 上继续执行 `web_fetch`；拒绝后发送 `permission.denied` 和 `tool.failed(TOOL_EXECUTION_DENIED)`。

## 10. Command Permission Payload

`bash` 在命令规则命中 `ask` 时产生标准 `permission.requested`。事件的 `data` 仍是 Runtime permission request 记录，其中 `data.data` 包含命令审批摘要：

```json
{
  "requestId": "permission_xxx",
  "toolName": "bash",
  "status": "pending",
  "data": {
    "permissionType": "command_execute",
    "approvalReason": "bash_command",
    "command": "npm test",
    "cwd": ".",
    "matchedRule": "npm *",
    "ruleAction": "ask",
    "shell": "powershell.exe"
  }
}
```

批准后 Runtime 发送 `permission.approved`，并在同一 `runId + toolCallId` 上继续执行 `bash`；拒绝后发送 `permission.denied` 和 `tool.failed(TOOL_EXECUTION_DENIED)`。命令规则命中 `deny` 时不产生权限请求，也不产生 `tool.started`，直接输出 `tool.failed(BASH_COMMAND_DENIED)`。

## 11. Question Payload

`question` 是 interaction tool，不是 permission。内部 AI SDK 模型调用后 Runtime 发送 `tool.started`，随后发送 `question.requested`。外部 adapter 也可以通过 waitable external question bridge 复用同一事件组；例如 Claude Code `onUserDialog` / `AskUserQuestion` 会生成 `question.*`，而不是伪装成 `permission.*`。

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "question.requested",
  "agentId": "coder",
  "toolCallId": "toolu_xxx",
  "toolName": "question",
  "messageId": "msg_run_xxx_execution_xxx_0",
  "messageIndex": 0,
  "data": {
    "requestId": "question_xxx",
    "toolCallId": "toolu_xxx",
    "toolName": "question",
    "status": "pending",
    "questions": [
      {
        "id": "question_1",
        "title": "Choose an approach",
        "body": "Which implementation direction should I use?",
        "options": [
          { "id": "option_1", "label": "Minimal change" }
        ],
        "allowCustom": true,
        "required": true
      }
    ]
  }
}
```

用户提交答案后 Runtime 发送 `question.answered`，`data.answers` 包含 `{ questionId, optionId?, answer?, custom }`，并发送 `tool.completed(toolName="question")`。取消 Run 时 Runtime 发送 `question.cancelled` 和 `tool.failed`，错误码为 `QUESTION_CANCELLED`。当没有其他 active task 时，pending question 会使 Run 进入 `waiting_input`。

## 12. Task File Lock Payload

`task.started`、`task.completed`、`task.failed` 的 `data.task` 是 Orchestrator delegated task 的结构化快照，其中 `data.task.lockPaths` 表示本次 `run_task` 声明的 workspace-relative 文件锁路径。未声明锁时该字段为 `[]`。

当 `run_task.lockPaths` 非空且 Run 未绑定 workspace 时，Runtime 输出 `task.failed` 和对应的 `tool.failed(toolName="run_task")`，错误码为 `TASK_FILE_LOCK_WORKSPACE_NOT_BOUND`。当任一声明路径已被其他 active delegated task 锁定时，Runtime 输出 `TASK_FILE_LOCK_CONFLICT`，且 `task.failed.data.details` 至少包含：

```ts
{
  taskId: string
  targetAgentId: string
  sourceAgentId: string
  workspaceId?: string
  lockPaths: string[]
  conflicts?: Array<{
    path: string
    owner: {
      runId: string
      taskId: string
      targetAgentId: string
      sourceAgentId: string
      groupId?: string
    }
  }>
}
```

锁冲突发生在目标智能体执行前，因此同一 `taskId` 不应出现目标智能体的 `agent.started`。该锁是声明式 advisory lock，只覆盖显式传入 `run_task.lockPaths` 的委派任务。
