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

其中，`Conversation` 与 `Run` 负责业务流程，`UIMessage` 负责消息事实本身。

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
