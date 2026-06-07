# AgentHub 可行实现计划

> 状态：已完结，交付归档。本文保留早期实施路径，当前事实来源以 `docs/README.md` 中的产品、架构、契约和外部 Agent 文档为准。

## 0. 总体架构决策

采用三进程架构：

```txt
web
  ↓
hub-server
  ↓
agent-runtime
```

职责边界：

```txt
hub-server
= 状态中心
= 会话、消息、Agent 配置、Run、Artifact 持久化
= 面向前端提供 API

agent-runtime
= 执行引擎
= Orchestrator、AgentAdapter、AI SDK、外部 Agent、工具调用
= 输出 RunEvent 流
```

前端不直接访问 `agent-runtime`。

```txt
Frontend → HubServer → AgentRuntime
```

通信方式：

```txt
Web ↔ HubServer：HTTP + SSE
HubServer ↔ AgentRuntime：HTTP + SSE
```

暂时不使用 WebSocket、任务队列、gRPC。

原因是当前最核心的是 IM 聊天、多 Agent 调度、统一适配器和产物内联体验，这些也正是课题要求的重点。

------

# 1. 第一阶段：先定义共享协议

目标：**先把 HubServer 和 AgentRuntime 的边界定死。**

这一阶段不要急着做 UI，也不要急着接 Claude Code / OpenCode。

先定义这几类共享类型：

```txt
AgentConfig
RunInput
RunEvent
Message
MessagePart
Artifact
ArtifactVersion
OrchestratorPlan
```

建议放在：

```txt
packages/shared
```

最重要的是 `RunEvent`。

Runtime 对外只输出统一事件，不直接写数据库。

MVP 事件类型建议先定这些：

```txt
run.started
agent.started
message.delta
message.completed
artifact.created
diff.proposed
agent.completed
run.completed
run.failed
```

后续再扩展：

```txt
orchestrator.plan.created
tool.called
tool.completed
deployment.updated
```

这一阶段的产出：

```txt
packages/shared
  ├── agent.ts
  ├── run.ts
  ├── message.ts
  ├── artifact.ts
  └── event.ts
```

完成标准：

```txt
HubServer 和 AgentRuntime 能共用同一套 RunInput / RunEvent 类型。
```

------

# 2. 第二阶段：HubServer 先做最小业务闭环

目标：**HubServer 成为状态中心。**

HubServer 先不要管复杂 Agent，只做业务数据管理。

## 2.1 数据库

使用 SQLite。

先建最小 7 张表：

```txt
conversations
conversation_agents
messages
message_parts
agents
runs
run_events
```

如果要做 Artifact，再加：

```txt
artifacts
artifact_versions
```

暂时不要加太多表。

不要一开始做：

```txt
用户系统
团队系统
权限系统
复杂部署记录
消息已读
多人协作
```

## 2.2 HubServer API

先实现这些接口：

```txt
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id/messages

GET    /api/agents
POST   /api/agents

POST   /api/conversations/:id/runs
GET    /api/runs/:id
POST   /api/runs/:id/cancel
```

其中最核心的是：

```txt
POST /api/conversations/:id/runs
```

它负责：

```txt
1. 保存用户消息
2. 创建 run
3. 查询会话历史
4. 查询 Agent 配置
5. 组装 RunInput
6. 调用 AgentRuntime
7. 订阅 Runtime 事件
8. 保存 run_events / messages / artifacts
9. 通过 SSE 转发给 Web
```

这一阶段不要求 AgentRuntime 真正调用模型，可以先对接 Mock Runtime。

完成标准：

```txt
前端发送消息后，HubServer 可以保存消息、创建 run，并返回一条 SSE 流。
```

------

# 3. 第三阶段：AgentRuntime 做最小执行服务

目标：**AgentRuntime 可以独立进程运行，并输出 RunEvent。**

AgentRuntime 先做三个接口：

```txt
POST /runtime/runs
GET  /runtime/runs/:runId/events
POST /runtime/runs/:runId/cancel
```

MVP 不需要 Runtime 访问数据库。

Runtime 内部先用内存维护：

```txt
runs
eventStreams
abortControllers
```

## 3.1 Runtime 内部模块

第一版建议这样拆：

```txt
agent-runtime/
  src/
    routes/
      run.routes.ts

    runtime/
      run-manager.ts
      agent-runtime.ts

    adapters/
      agent-adapter.ts
      mock-adapter.ts
      ai-sdk-adapter.ts

    providers/
      provider-service.ts

    events/
      event-bus.ts
```

## 3.2 先实现 MockAdapter

不要一上来就接 AI SDK。

先用 `MockAdapter` 输出固定事件：

```txt
run.started
agent.started
message.delta
message.delta
message.completed
run.completed
```

这样可以先验证：

```txt
HubServer → Runtime → HubServer → Web
```

的整条流式链路。

完成标准：

```txt
HubServer 调用 AgentRuntime 后，Web 能看到一段模拟 Agent 回复。
```

------

# 4. 第四阶段：Web 接入真实数据流

目标：**让已有聊天 UI 不再是静态界面。**

Web 端先做最小功能：

```txt
会话列表
消息列表
输入框
发送消息
流式展示 Agent 回复
```

前端只调用 HubServer：

```txt
GET  /api/conversations
GET  /api/conversations/:id/messages
POST /api/conversations/:id/runs
```

前端不需要知道 AgentRuntime 存在。

## 4.1 消息结构

前端消息尽量按 AI SDK 的 `UIMessage` 思路组织：

```txt
message
  ├── id
  ├── role
  ├── metadata
  └── parts
```

其中 `parts` 用来展示：

```txt
text
data-artifact
data-diff
data-preview
data-deployment
```

第一版只做：

```txt
text
```

完成标准：

```txt
用户可以在 Web 输入消息，看到 Agent 流式回复，并刷新后仍然能看到历史消息。
```

------

# 5. 第五阶段：接入 AI SDK LlmAdapter

目标：**让 AgentRuntime 真正调用模型。**

这时再实现：

```txt
AiSdkAdapter
```

它基于你已有的：

```txt
ProviderService
AI SDK 依赖
```

实现逻辑：

```txt
1. 根据 AgentConfig 选择 provider 和 model
2. 通过 ContextBuilder 组装模型上下文
3. 调用 AI SDK streamText
4. 将模型流式输出转换成 RunEvent
```

注意这里要避免一个坑：

```txt
不要把完整 UIMessage 原样丢给模型。
```

因为 UIMessage 里未来会有 Artifact 卡片、Diff 卡片、部署卡片等 UI-only part。

正确方式是：

```txt
UIMessage[]
  ↓
ContextBuilder 筛选
  ↓
ModelMessage[]
  ↓
AI SDK streamText
```

这一阶段先不做工具调用。

完成标准：

```txt
用户发送消息后，Runtime 使用真实模型流式返回文本。
```

------

# 6. 第六阶段：实现 Agent 配置与自建 Agent

目标：**让 Agent 不再写死。**

HubServer 中维护 Agent 配置。

Agent 配置建议包含：

```txt
id
name
description
avatar
adapterType
providerId
modelId
systemPrompt
capabilities
tools
status
```

第一版支持三种 Agent：

```txt
Mock Agent
LLM Agent
Orchestrator Agent
```

暂时不要急着做 Claude Code / OpenCode / Codex。

前端可以先做一个简单 Agent 列表：

```txt
Frontend Agent
Reviewer Agent
Writer Agent
Orchestrator
```

完成标准：

```txt
用户可以选择不同 Agent 发起单聊，不同 Agent 使用不同 system prompt 回复。
```

------

# 7. 第七阶段：实现简单 Orchestrator

目标：**跑通群聊多 Agent 协作。**

MVP Orchestrator 不要复杂化。

先实现：

```txt
用户消息
  ↓
Orchestrator 生成执行计划
  ↓
顺序调用 2~3 个 Agent
  ↓
汇总输出
```

计划结构只需要包含：

```txt
intent
tasks
summaryInstruction
```

每个 task 包含：

```txt
taskId
agentId
title
instruction
expectedOutput
```

第一版规则可以简单一点：

```txt
如果会话 mode = single：
  直接调用目标 Agent

如果会话 mode = group：
  调用 Orchestrator 生成 plan
  顺序执行 plan.tasks
```

事件流里加入：

```txt
orchestrator.plan.created
```

前端可以展示一个计划卡片。

完成标准：

```txt
用户在群聊中发起任务，Orchestrator 能生成计划，多个 Agent 依次回复。
```

------

# 8. 第八阶段：Artifact 和 Diff

目标：**让 AgentHub 从普通聊天产品变成“多 Agent 写作 / 产物协作平台”。**

课题强调 Agent 回复不仅是文本，还要能展示代码 Diff、网页预览卡片、文件附件等富媒体产物。

MVP 先做两类 Artifact：

```txt
document
code
```

后续再加：

```txt
webpage
diff
deployment
```

## 8.1 Artifact 事件

Runtime 输出：

```txt
artifact.created
diff.proposed
```

HubServer 负责保存：

```txt
artifacts
artifact_versions
```

Web 负责展示：

```txt
Artifact 卡片
点击打开预览面板
```

第一版可以让 AI SDK Agent 通过约定格式生成 Artifact。

比如：

```txt
如果用户要求“帮我写一篇文章”
→ 生成 document artifact

如果用户要求“帮我写组件”
→ 生成 code artifact
```

完成标准：

```txt
Agent 回复中可以出现 Artifact 卡片，点击后能看到文档或代码内容。
```

------

# 9. 第九阶段：外部 Agent Adapter

目标：**接入一个真实外部 Agent，体现统一适配器能力。**

外部 Agent 不要一开始全做。

建议顺序：

```txt
1. MockAdapter
2. AiSdkAdapter
3. OpenCodeAdapter
4. ClaudeCodeAdapter
5. CodexAdapter
```

MVP 最多接一个：

```txt
OpenCodeAdapter 或 ClaudeCodeAdapter
```

如果时间紧，可以只做 Adapter 占位和 Mock 实现。

也就是前端能看到：

```txt
Claude Code Agent
OpenCode Agent
Codex Agent
```

但真实执行先走 Mock 或 AI SDK。

完成标准：

```txt
AgentRuntime 有统一 AdapterRegistry，可以根据 adapterType 调用不同 Adapter。
```
