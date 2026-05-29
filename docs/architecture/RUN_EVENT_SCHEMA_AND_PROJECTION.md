# Run Event Schema & Projection

AgentHub 的 Runtime SSE 采用「raw 事件永久保留 + 结构化投影」的双层模型。

## 目标

- 原始 Runtime 事件永远保留，新增事件类型时不需要破坏性改表。
- 重新打开会话时，展示顺序必须与流式渲染时一致。
- Web 聊天主 UI 使用 raw event replay 恢复，并与 live SSE 共用同一套 projection reducer。
- 结构化投影服务于 Runtime history、查询、搜索、统计、权限、计划和后续产品数据，不作为聊天 UI 顺序的唯一来源。

## 顺序真相

1. `RunEvent.sequence` 是 run 内 raw event replay 的顺序真相。
2. 跨 run 顺序使用触发 run 的用户消息时间或 `Run.createdAt`。
3. 聊天 UI 恢复时先插入该 run 的 trigger user message，再按 `RunEvent.sequence asc` 重放 raw events。
4. 所有结构化投影项仍记录 `firstEventSequence` / `lastEventSequence`，用于查询、调试、统计和非聊天 UI 的稳定排序。
5. 后续更新只能推进投影项的 `lastEventSequence`，不能改写 `firstEventSequence`。

## Raw 保留规则

- 每条 Runtime SSE 先写入 `RunEvent.payloadJson`。
- `RunEvent.id` 直接等于 Runtime event id。
- 未识别的 event type 也必须落库。
- `Run.lastEventSequence` 记录当前 run 已消费到的最新序号。

## 结构化投影

以下投影表都要携带 `firstEventSequence` / `lastEventSequence`：

- `Message`
- `MessagePart`
- `RunToolCall`
- `RunReasoningBlock`
- `RunTaskGroup`
- `RunTask`
- `RunPlan`
- `RunPlanTask`
- `PermissionRequest`

## 投影约定

- `Message` 保留 Hub 本地 id，另存 `runtimeMessageId`、`runtimeRunId`、`messageIndex`、`surface`、`taskId`、`groupId`。
- `MessagePart` 记录 `partKey`、`entityType`、`entityId`、`runtimeEventId`，用于幂等更新和局部重放。
- `run_task` 相关工具事件只进入 raw event log 和任务投影，不渲染为普通工具卡片。
- 任何新 event type 若暂时没有 UI，也要先写 `RunEvent`，后续只补 Web projection 即可。

## 恢复规则

- `GET /api/conversations/:conversationId/messages` 返回 `timelineRuns`，每个 run 包含 trigger user message 和按 `sequence asc` 排序的 raw event envelopes。
- Web hydrate 时使用 `timelineRuns` 重建聊天 timeline；`messages` / `runItems` 仅保留为兼容与查询数据，不直接拼聊天流。
- Live SSE 与 replay 都进入同一套 `RuntimeRunEvent -> WorkbenchTimelineItem` projection reducer。
- 重开同一对话时，live 渲染和 raw replay 渲染必须得到同一顺序。
