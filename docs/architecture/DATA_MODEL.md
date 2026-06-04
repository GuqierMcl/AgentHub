# 领域数据模型

AgentHub 的消息与上下文数据模型，建议直接采用 AI SDK 的最佳实践：以 `UIMessage` 作为应用侧消息状态的事实来源，以 `CoreMessage` / 模型消息作为投喂给模型的推导结果。

## 设计原则

- `UIMessage` 是应用状态的事实来源，不是模型输入的直接格式。
- `CoreMessage` 是模型上下文格式，由 `UIMessage` 经过转换和裁剪得到。
- 消息中的结构化内容应优先放在 `parts` 中，而不是拆成大量临时字段。
- 消息级信息应放在 `metadata` 中，而不是混入消息正文。
- 需要动态变化、并且属于消息内容本身的结构化信息，应作为 data parts 处理。
- 业务级持久化实体与消息内容要分层：对话、消息、Run、Artifact、权限记录等可以是独立领域对象，但消息本体建议采用 `UIMessage` 思路建模。

## 推荐模型

### 1. UIMessage 作为消息事实来源

每条消息建议使用 `UIMessage<METADATA, DATA_PARTS, TOOLS>` 进行建模，其中：

- `METADATA` 记录消息级元数据，例如创建时间、模型、token 用量、结束原因、Run ID、Agent ID。
- `DATA_PARTS` 记录消息中的结构化内容，例如网页预览卡片、Diff 卡片、部署状态、产物引用、流式状态片段。
- `TOOLS` 记录与类型安全工具交互相关的信息。

AI SDK 文档把 `UIMessage` 定义为应用状态的事实来源，适合承载完整消息历史、元数据、结构化内容和前端渲染所需信息。

### 2. Metadata 只放消息级信息

适合放入 `metadata` 的内容包括：

- `messageId`
- `conversationId`
- `runId`
- `agentId`
- `createdAt`
- `model`
- `totalTokens`
- `finishReason`
- `status`
- `latency`

这些信息描述的是消息本身，而不是消息正文的一部分。

### 3. Data Parts 只放会出现在消息内容里的结构化信息

适合放入 data parts 的内容包括：

- 网页预览卡片
- Diff 片段
- 文件附件引用
- 部署状态片段
- 进度状态
- 权限请求卡片
- 产物引用

这类内容应作为消息内容的一部分进行流式传输和渲染，而不是单独拆成碎片化表结构再临时拼装。

### 4. 模型输入由 UIMessage 派生

发送给模型时，不直接使用 UIMessage 原样入模，而是通过 AI SDK 的转换能力生成模型消息：

- `UIMessage` 负责前端和应用状态。
- `convertToModelMessages` 负责把 `UIMessage` 转成模型可接受的上下文。
- 对于用户上传的结构化内容，可以通过 `convertDataPart` 进行定向转换。
- 对于不应进入上下文的中间过程内容，应在转换前裁剪。

这能保证：

- 前端状态和模型上下文分离。
- 结构化内容可控进入上下文。
- 工具调用、附件、代码文件等内容可以按需转成文本或文件输入。

### 5. 校验与类型安全

建议在消息进入存储层、渲染层或模型层之前，进行类型校验：

- 使用 `validateUIMessages` 校验消息数组。
- 使用类型化的 `UIMessage` 定义统一消息结构。
- 工具定义、消息 metadata 和 data parts 都应有明确类型。

## 领域划分建议

在这个建模方式下，业务实体可以这样拆：

- `Conversation`：会话容器与排序信息。
- `UIMessage`：会话内消息事实来源。
- `Run`：一次执行过程。
- `RunEvent`：Run 的事件流记录。
- `Artifact`：代码、网页、文件、Diff 等产物。
- `PermissionRequest`：权限申请记录。
- `ExternalAgentSession`：AgentHub 会话语境与外部平台 Session 的映射记录。

其中，`Conversation` 与 `Run` 负责业务流程，`UIMessage` 负责消息事实本身。

`Conversation.metadataJson` 可记录由系统智能体派生的轻量状态。首版标题生成使用 `titleSource` 标记标题来源：`default` 或缺省表示前端/系统初始标题，`auto` 表示 Runtime `title` 系统智能体生成后由 HubServer 写入，`manual` 表示用户手动改名。HubServer 消费 `system_agent.completed(systemAgentId="title")` 时，只在标题来源不是 `manual` 的情况下更新 `Conversation.title`；手动重命名必须同步写入 `titleSource = "manual"`，避免后续自动标题覆盖用户选择。若模型标题没有赶上或生成失败，Runtime 会在 terminal event 前输出基于首条用户消息的 fallback 标题事件；若整个标题事件仍因 Run 取消等原因缺失且标题来源仍为 `default`，HubServer 可在后续 Run 中用会话第一条用户消息作为 `titleSeedUserMessage` 触发重试。

阶段 2 的持久化聊天链路已经开始使用这些实体：

- `Message` 保存 user/assistant/system 消息记录；assistant message 额外记录 `runtimeMessageId`、`runtimeRunId`、`messageIndex`、`surface`、`taskId`、`groupId`、`firstEventSequence` 和 `lastEventSequence`。
- `MessagePart(type="text")` 保存当前阶段可恢复的聊天文本；每个 part 额外记录 `partKey`、`entityType`、`entityId`、`runtimeEventId`、`firstEventSequence` 和 `lastEventSequence`。
- `Run` 保存 HubServer 本地执行记录，`runtimeId` 关联 Agent Runtime run id，`planJson` 保存最近一次 `write_plan` 结果，`lastEventSequence` 作为本 run 的最新 raw event 消费序号，`lastProjectedSequence` 记录结构化投影已追平到的序号。
- `RunEvent` 保存 Runtime 原始事件，`id` 等于 Runtime event id，`payloadJson` 永久保留 raw SSE 事实，`sequence` 是本地 Run 内递增序号，也是 raw replay 的 run 内顺序真相。
- `ExternalAgentSession` 保存外部智能体 Session link，字段包括 `provider`、`agentId`、`conversationId`、`workspaceIdentity`、`scope`、`providerSessionId`、可选 `taskId`/`runId`、`handoffSummary` 和 `lastSyncedRunEventId`。HubServer 投影 `agent.started.data.externalSession` 时 upsert；direct OpenCode run 会查询 matching `conversation-visible` 记录并作为 Runtime `externalSessionHints` 注入。
- `Artifact(type="diff")` 保存 Runtime 通用 Workspace Diff Summary 的产品卡片。HubServer 从 `run.completed` / `run.failed` / `run.cancelled` 的 `data.workspaceDiff` 投影 Artifact，并用 `metadataJson.source = "runtime.workspaceDiff"`、`runtimeEventId`、`baselineDirty`、`status`、`changedFileCount` 等字段保证幂等和可恢复展示；`ArtifactVersion.content` 保存 bounded patch 或摘要文本，`ArtifactVersion.diffJson` 保存完整 `WorkspaceDiffSummary`。
- `WorkspaceChangeSet` 保存一次 terminal `workspaceDiff` 投影出的工作区变更集合，通过 `conversationId`、`runId`、`artifactId`、`sourceEventId` 关联会话、Run、Diff Artifact 与 terminal RunEvent。`sourceEventId` 唯一，保证 RunEvent replay / projection catch-up 不重复创建；`status`、`baselineDirty`、`runOnlyReliable`、`summary`、`statsJson`、`limitationsJson` 保留 Runtime diff summary 的保守语义；`attributionKind` / `attributionConfidence` 统一表达 `tool`、`task`、`agent`、`run` 与 `inferred`、`aggregate`、`ambiguous`、`unknown`。
- `WorkspaceChangeSetFile` 保存每个 changed file 的 path、oldPath、statusBefore/statusAfter、origin、additions/deletions、binary、truncated，以及同样的 attribution 字段和 metadata。内部 `write_file` / `edit_file` 在路径唯一匹配时可归因到具体 `toolCallId`；同一文件多个候选工具时保存候选 ids 并标记 `run + ambiguous`；OpenCode 等外部智能体 V0 不解析 provider 私有工具 payload，只保守归因到 agent/task aggregate。
- Diff Artifact Detail 通过 `GET /api/conversations/:conversationId/artifacts/:artifactId` 读取。HubServer 从当前 `ArtifactVersion.diffJson` 派生 `changedFiles`、`baselineDirty`、`runOnlyReliable`、`limitations` 等详情字段，并从 `ArtifactVersion.content` 或 `diffJson.patch.text` 提供 bounded patch 文本；若 artifact 已有关联 `WorkspaceChangeSet`，响应额外返回 `diff.changeSet` 和 `changedFiles[].attribution`。旧 Diff Artifact 没有关联 ChangeSet 时继续返回原有详情，Web 显示“归因未记录”。Web 只把这些数据用于只读 Diff Viewer；apply、revert、hunk accept/reject 需要后续 proposed patch / revert 语义支持。
- `Message` 与 Artifact 通过 `Artifact.messageId` 关联。Diff artifact 优先挂到同一 Run 最新可见 assistant chat message；没有 assistant message 时挂到触发 user message。`GET /api/conversations/:id/messages` 返回 `messages[].artifacts`，Web 可在重启或恢复历史时重建 diff 摘要卡片。
- 聊天主 UI 恢复时，Web 使用 `timelineRuns` 先插入触发 run 的用户 `Message`，再按 `RunEvent.sequence` 重放产品 event envelopes，避免 assistant 排到用户消息前面；随后合并 `messages` 中 `surface="chat"` 的 user/assistant 记录作为持久化兜底，并按 `runId + runtimeMessageId` 去重。完整 raw Runtime event 仍保留在 `RunEvent.payloadJson`。
- 任何投影表都不得重写 `firstEventSequence`；它负责结构化查询、统计、调试和非聊天 UI 的稳定排序，而不是聊天流 hydrate 的唯一来源。
- 高频 delta 可以批量投影；结构化表允许短暂落后于 raw `RunEvent`，但读取历史消息和组装 Runtime history 前必须通过 `lastProjectedSequence` 从 raw events 补齐。
- assistant message 的 `metadataJson.runtime` 仍保留 Runtime `messageId`、`messageIndex` 和 `runtimeRunId`，用于兼容性、history 投影和调试；外部智能体回复可额外保存 `externalModel`，记录本条消息实际使用的外部平台 provider/model id，以及可选 provider/model display name。

完整恢复规则见 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`。

## 和 AgentHub 的关系

- `hub-server` 负责保存和转发 `UIMessage` 相关状态。
- `agent-runtime` 负责产生消息流、metadata 和 data parts。
- 前端负责渲染 `UIMessage.parts` 和 `UIMessage.metadata`。
- 具体的消息存储结构可以按数据库实现拆分，但对应用层应保持 `UIMessage` 语义一致。

## 参考 API

- `UIMessage`
- `CoreMessage`
- `convertToModelMessages`
- `createUIMessageStream`
- `createUIMessageStreamResponse`
- `pipeUIMessageStreamToResponse`
- `validateUIMessages`
