---
change: regenerate-message
role: technical-design
status: implemented
---

# 重新生成助手回复 — 技术设计文档

## 概述

“重新生成”允许用户对一条已完成的 assistant chat 消息请求替代回复。V1 不覆盖旧消息、不删除旧 Run；HubServer 创建一个新的 user trigger message 和一个新的 Run，新 assistant 消息通过 `Message.regeneratedFromId` 指向被重新生成的源 assistant 消息。Web 使用轻量分支展示：源 assistant 和可见的 regenerated assistant 折叠为同一气泡的 `MessageBranch` 版本分页并默认显示最新候选；复制出的 user trigger 不作为普通新提问气泡显示，而是折叠到原始 user 消息下方。V1 暂不提供“设为首选答案”或隐藏旧回复。

## 产品语义

- 重新生成目标必须是同一 conversation 内可见的 `surface="chat"`、`role="assistant"`、`status="completed"` 消息。
- HubServer 从源 assistant 所属 Run 找到原 `Run.triggerMessageId`，复制该 user message 的原始 text part 作为新 Run 的触发消息。
- 新 user trigger message 的 `metadataJson.regenerate` 保存稳定快照：source assistant message id、source run id、source trigger message id、source assistant agent id、createdAt 和 excerpt。
- 新 assistant message 落库时写入 `regeneratedFromId = sourceAssistantMessageId`；旧 assistant message、旧 RunEvent、旧 Artifact 都保持不变。
- V1 不自动撤销旧回复产生的工作区变更；Diff Artifact 仍通过现有撤销能力独立处理。

## API 与数据流

新增 HubServer 产品 API：

```http
POST /api/conversations/:conversationId/messages/:messageId/regenerate
```

流程：

```text
Web assistant message action
  -> HubServer regenerate API
  -> RunPersistenceService.regenerateAssistantMessage()
  -> 复制源 Run trigger user message
  -> 创建新 user Message + MessagePart
  -> 创建新本地 Run
  -> buildRuntimeRunInput()
  -> POST /runtime/runs
  -> Runtime SSE 投影新 assistant Message(regeneratedFromId)
  -> Web hydrate/merge 渲染 user 折叠标记和 assistant 分支候选
```

## Replay 约定

- 不扩展 Agent Runtime 协议；发送给 Runtime 的 `RuntimeRunInput` wire shape 保持不变。
- HubServer 在当前 user content 中注入轻量 regenerate 说明，要求模型基于同一用户请求生成替代回复，而不是把复制的用户消息理解成新的追问。
- `metadataJson.regenerate` 是 replay 的稳定语义来源。`formatMessageContentForModel()` 会把 regenerate 快照格式化进模型可见文本，因此 Runtime history、OpenCode external context bootstrap/delta、pinned context 都能复现同一语义。
- HubServer 的 stored `Run.inputJson` 可额外保存 `regenerate` 元数据，供后续 Runtime event projection 给新 assistant message 写入 `regeneratedFromId`；该字段不发送给 Agent Runtime。

## Web 交互

- Assistant 消息操作区显示“重新生成”图标按钮。
- 点击后 Web 调用 regenerate API，并进入和普通发送相同的 submitted/running/SSE 续订流程。
- 新 user trigger 消息在 hydrate/merge 后从 `metadataJson.regenerate` 恢复 regenerate snapshot；如果原始 user 消息在当前 timeline 窗口内，Web 不单独渲染该 trigger，而是在原始 user 消息底部显示“已请求重新生成 N 次”，避免看起来像普通重复提问；如果原始 user 消息不在窗口内，trigger 继续以紧凑“重新生成请求”标记独立显示，避免分页场景下上下文消失。
- 新 assistant 消息在 hydrate/merge 或 live SSE projection 后保留 `regeneratedFromId`，气泡顶部显示紧凑“重新生成回复”标记。
- 如果源 assistant 在当前 timeline 窗口内，Web 将源消息和 regenerated 消息折叠为同一个 `MessageBranch`，默认打开最新候选，用户可用分支分页切换原回复和替代回复；如果源消息不在当前窗口，regenerated 消息独立显示并保留标记，避免分页场景下消息消失。
- 原始 assistant 回复和每个 regenerated 候选都在消息操作/元信息栏显示“已重新生成”，与模型、token、复制、回复、重新生成、置顶等消息级操作并列。
- V1 不做设为首选答案、自动隐藏旧回复或线程视图。

## 测试覆盖

- HubServer router 转发 regenerate API 到 `RunPersistenceService`。
- Service 复制源 trigger user message，写入 `metadataJson.regenerate`，并向 Runtime user content 注入 regenerate 说明。
- Runtime event projection 将新 assistant message 的 `regeneratedFromId` 写回源 assistant id。
- OpenCode external context delta 包含 regenerate 格式化块。
- Web hydrate 恢复 `metadataJson.regenerate` 和 `regeneratedFromId`，live SSE 根据 regenerate trigger 给 assistant 气泡补 lineage，MessageList 将可见 regenerate trigger 折叠到源 user 消息并将可见 regenerated assistant 折叠为分支版本，MessageItem 渲染“已请求重新生成 / 重新生成回复 / 已重新生成”标记。
