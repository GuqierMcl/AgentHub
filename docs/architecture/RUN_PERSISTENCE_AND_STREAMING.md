# Run Persistence And Streaming

HubServer 是聊天产品事实源。Web 通过产品 API 发送消息、订阅事件和恢复会话；HubServer 负责把 Runtime SSE 转成可持久化的产品状态。

## 流程

```mermaid
sequenceDiagram
  participant Web
  participant Hub as HubServer
  participant Run as Agent Runtime

  Web->>Hub: POST /api/conversations/:conversationId/messages/send
  Hub->>Hub: create user Message + Run
  Hub->>Run: POST /runtime/runs
  Run-->>Hub: runtime runId
  Hub->>Run: GET /runtime/runs/:runtimeId/events
  Run-->>Hub: raw SSE events
  Hub->>Hub: micro-batch persist RunEvent + coalesced projection rows
  Hub-->>Web: GET /api/runs/:runId/events?afterSequence=
  Web->>Hub: hydrate timelineRuns product event replay
  Web->>Hub: resume live replay from lastEventSequence
```

## 关键 API

- `POST /api/conversations/:conversationId/messages/send`
- `GET /api/conversations/:conversationId/messages`
- `GET /api/runs/:runId/events?afterSequence=`
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/permissions/:requestId/decision`

## 运行时持久化

- HubServer 创建 user `Message` 和 text `MessagePart`。
- HubServer 创建本地 `Run`，并写入 `Run.runtimeId`。
- HubServer 从已持久化消息投影 Runtime `history`，再调用 Runtime 创建 run。
- 后台 consumer 消费 Runtime SSE。
- 每条 Runtime event 先写 `RunEvent.payloadJson`，再尝试结构化投影。
- HubServer 对每个 run 使用 raw event micro-batch，默认最多约 50ms 或 50 条事件落库一次；terminal event 强制 flush。
- Runtime SSE 底层连接若发生 `ECONNRESET` 等可重试中断，HubServer 会先 flush 已读事件、确认本地是否已到达终态，再通过 Runtime events replay 重连补齐；只有重试后仍未获得 terminal event 的情况才将本地 Run 标记为 failed。
- HubServer 在 raw event 成功落库后才向 `/api/runs/:runId/events` 订阅者发布 envelope，因此 live SSE 可能有约 50ms 的可控延迟，但不会发布不可 replay 的事件。产品 Run SSE 与 `timelineRuns` 可对大工具结果做 UI 摘要投影（例如 `web_fetch` 不向前端传输 response body，只保留 URL、状态码、bytes、耗时等摘要字段），以保护浏览器热路径；数据库中的 `RunEvent.payloadJson` 仍保留完整 raw event。
- 高频 `message.delta` / `reasoning.delta` 的结构化投影合并写入，默认约 150ms flush 一次；`message.completed`、`reasoning.completed` 和 terminal event 会强制追平。
- `Run.lastProjectedSequence` 记录结构化投影进度。读取会话消息或组装 Runtime history 前，HubServer 会从 raw `RunEvent` 补齐落后的 projection。
- `system_agent.completed(systemAgentId="title")` 会在 `Conversation.metadataJson.titleSource !== "manual"` 时更新 `Conversation.title`，并写入 `titleSource = "auto"`。
- `GET /api/conversations/:conversationId/messages` 返回消息快照、active run 快照、latest plan、runItems 和 `timelineRuns`。
- `timelineRuns` 是聊天 UI 恢复的主数据：每个 run 带 trigger user message 和按 `RunEvent.sequence` 排序的产品 event envelopes；大工具结果可能已被投影为 UI 摘要，完整 raw event 留在 `RunEvent.payloadJson`。
- 权限请求先作为 raw Runtime event 落库，再投影到 `PermissionRequest`；投影优先使用事件 payload 中的 `permissionType`，例如 `web_fetch` 的 `network_access`。

## 恢复规则

- 切会话时只关闭前端 EventSource，不 cancel Runtime run。
- 切回时先强制重新加载 `timelineRuns`，Web 先插入每个 run 的 trigger user message，再用与 live SSE 相同的 projection reducer 重放产品 event envelopes。
- 若 active run 非终态，Web 用 fresh snapshot 中的 `activeRun.lastEventSequence` 续订 `/api/runs/:runId/events?afterSequence=`；HubServer 会 replay sequence 更大的已持久化事件并继续推送 live events。切换会话时 Web 必须关闭旧 EventSource，但不得 cancel Run。
- 如果 run 在切走期间完成，`timelineRuns` 已包含最终产品 event envelopes，前端不再保持连接。
- 结构化投影行的 `firstEventSequence` 仍用于查询和非聊天 UI 排序；聊天主 UI 恢复顺序以产品 event replay 为准。

## 兼容性

更完整的 raw event 保留与投影规则见 [`RUN_EVENT_SCHEMA_AND_PROJECTION.md`](./RUN_EVENT_SCHEMA_AND_PROJECTION.md)。

## 产品级权限决定

Web 对 pending permission 卡片的批准/拒绝操作调用 `POST /api/runs/:runId/permissions/:requestId/decision`。HubServer 使用本地 Run 记录找到 `runtimeId` 后转发 Runtime decision API，随后继续依赖 Runtime SSE 事件更新本地 `PermissionRequest`、消息 part 和时间线状态。浏览器不直接调用 Runtime 调试代理。
