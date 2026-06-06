# Hub Global Events SSE

本文档记录 HubServer 面向 Web 的全局产品状态事件流。

## 定位

全局事件流用于 HubServer 向 Web 推送低频产品状态通知，例如会话标题变化、最近消息变化、Run 状态变化和系统服务状态变化。

它不承载 Runtime raw event、`message.delta`、工具输出或聊天 timeline 恢复数据。聊天主 UI 的恢复仍通过 `GET /api/conversations/:conversationId/messages` 返回的 `timelineRuns` raw replay，以及 `GET /api/runs/:runId/events?afterSequence=` 完成。

## 端点

```text
GET /api/events
```

响应类型：`text/event-stream`

SSE 格式：

```text
event: hub.event
data: {"id":"evt_xxx","type":"run.status.changed","timestamp":"2026-05-29T00:00:00.000Z","data":{"conversationId":"conv_xxx","runId":"run_xxx","status":"running"}}
```

服务端每 25 秒发送一次 SSE comment heartbeat：

```text
: heartbeat 2026-05-29T00:00:00.000Z
```

## 语义

- v1 是 best-effort 通知，不保证送达。
- 事件只保存在 HubServer 进程内，不写数据库。
- 不支持 `Last-Event-ID` replay。
- 不支持 `afterSequence` 或 cursor。
- Web 断线期间错过的事件不会补发。
- 浏览器 `EventSource` 原生自动重连，重连后只接收未来事件。

## 事件类型

```ts
type HubGlobalEventType =
  | "conversation.updated"
  | "conversation.title.updated"
  | "conversation.last_message.updated"
  | "run.status.changed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "service.status.changed"

type HubGlobalEventEnvelope = {
  id: string
  type: HubGlobalEventType
  timestamp: string
  data: Record<string, unknown>
}
```

Run 事件 payload 至少包含：

```ts
{
  conversationId: string
  runId: string
  runtimeRunId?: string | null
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled"
}
```

Conversation 事件 payload 至少包含：

```ts
{
  conversationId: string
  title?: string
  lastMessageId?: string
  lastMessageAt?: string
  lastMessageContent?: string
}
```

Service status 事件 payload 至少包含：

```ts
{
  previousStatus: "running" | "starting" | "idle" | "error" | "not_integrated"
  service: {
    id: "agent-runtime" | "opencode" | "codex" | "claude-code"
    label: string
    kind: "runtime" | "external-agent"
    status: "running" | "starting" | "idle" | "error" | "not_integrated"
    implemented: boolean
    checkedAt: string
  }
}
```

## Web 消费规则

- 全局 EventSource 在 `App` 根部挂载一次，生命周期独立于 chat Activity。
- conversation 相关事件只触发 TanStack Query invalidate。
- run 状态事件只更新 Zustand 中已经存在的 conversation runtime state；未打开过的 conversation 不创建本地运行态。
- terminal Run 事件可让已打开 conversation 的列表卡片停止 spinner/progress，并 invalidate 对应 messages cache。
- service status 事件只更新 Web 的服务状态 store。左侧系统服务状态面板和聊天输入框下方的当前会话外部智能体状态栏消费该 store；该事件不得写入聊天 timeline、不得落库、不得参与 Runtime event projection 或 replay。
