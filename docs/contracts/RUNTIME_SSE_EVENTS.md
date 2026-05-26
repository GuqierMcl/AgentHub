# Agent Runtime SSE 事件契约

本文档记录 Agent Runtime `GET /runtime/runs/:runId/events` 的 SSE 事件契约。`API_CONTRACTS.md` 保留 Runtime Runs API 主契约；事件细节以后以本文档为准。

## 1. Wire Format

响应类型：`text/event-stream`

每条事件使用 RunEvent `type` 作为 SSE event name：

```text
event: message.delta
data: {"id":"evt_xxx","runId":"run_xxx","type":"message.delta","timestamp":"2026-05-26T00:00:00.000Z","agentId":"coder","data":{"delta":"hello"}}
```

订阅行为：

- 订阅时先按创建顺序 replay 已有事件。
- Run 未结束时继续推送新事件。
- 收到 `run.completed`、`run.failed` 或 `run.cancelled` 后关闭流。
- Run 不存在时返回 `RUN_NOT_FOUND`。

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
model.stream.part
reasoning.started
reasoning.delta
reasoning.completed
message.delta
message.completed
agent.completed
run.completed
run.failed
run.cancelled
```

`message.*`、`tool.*`、`task.*`、`permission.*`、`agent.*` 和 `run.*` 是 Runtime 语义事件，优先供 HubServer 持久化与 UI 状态渲染使用。

## 4. AI SDK Part Passthrough

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

## 5. Reasoning Events

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

同一个 reasoning block 内，Runtime 会按 `reasoningId` 聚合 delta，并在 `reasoning.completed.data.content` 中返回聚合文本。

对于同一个 AI SDK reasoning part，事件顺序为：

```text
model.stream.part
reasoning.started | reasoning.delta | reasoning.completed
```

## 6. Ordering And Compatibility

- 对于 `text-delta`，Runtime 先输出 `model.stream.part`，再输出现有 `message.delta`。
- 对于 reasoning part，Runtime 先输出 `model.stream.part`，再输出对应 `reasoning.*`。
- 工具调用仍以 `tool.*`、`permission.*` 和 `task.*` 作为稳定语义事件；`model.stream.part` 中的 tool part 只作为模型流追踪。
- 后续如果需要把 `source`、`file`、`tool-input-*` 等提升为独立 RunEvent，应从 `model.stream.part` 增量投影，不改变现有高层事件语义。

## 7. Redaction And Serialization

Runtime 在输出 `model.stream.part.data.part` 前会做 JSON 化和脱敏：

- 不直接输出 `Uint8Array`、`ArrayBuffer` 等二进制对象；改为输出类型和字节长度。
- `Error` 转为 `{ name, message }`。
- `bigint` 转为字符串。
- 循环引用转为 `"[Circular]"`。
- 已知主 workspace root 和授权外部路径会被替换为 `[workspace-root]` 或 `[external-path]`。
- `path` / `file` / `root` 类字段中的未知绝对路径会被泛化为 `[absolute-path]/<basename>`。

`raw` part 可能包含 provider 原始内容，默认关闭。需要调试 provider 新特性时，调用方必须显式设置 `includeRawModelChunks=true`。
