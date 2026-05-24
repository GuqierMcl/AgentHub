# API 契约

本文档记录 `web`、`hub-server` 与 `agent-runtime` 之间的跨进程契约。

## 进程流向

```text
web -> hub-server -> agent-runtime (Sidecar)
```

生产环境中，`agent-runtime` 是 `hub-server` 的 Sidecar 子进程，由 `hub-server` 在启动时自动拉起。详见 `docs/adr/ADR-001-sidecar-architecture.md`。

## 契约规则

- 浏览器侧 API 由 `hub-server` 提供。
- Runtime 执行 API 由 `agent-runtime` 提供。
- `hub-server` 的前端 API 建议使用 `/api/*` 前缀。
- `agent-runtime` 的内部执行 API 建议使用 `/runtime/*` 前缀。
- 两个 Hono 服务都应保留 `/health` 健康检查端点。
- 契约载荷应使用明确的 TypeScript 类型。
- 流式事件名称、事件载荷与终止状态必须在实现前或实现时同步记录。
- 错误应尽量使用稳定错误码。
- `agent-runtime` 只输出结构化事件，不直接写业务数据库。
- `hub-server` 负责消费 Runtime 事件，并持久化为消息、Artifact、Diff、部署记录和 Run 状态。
- Hono 相关通用约定见 `docs/reference/HONO.md`。

## Sidecar 通信契约

### 启动参数

HubServer 启动 Agent Runtime 时，传入以下命令行参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--port` | number | 否 | Agent Runtime 监听端口，默认 `3001` |
| `--host` | string | 否 | 监听地址，默认 `127.0.0.1` |
| `--hub-callback` | string | 否 | HubServer 回调地址 |
| `--workdir` | string | 否 | 工作目录根路径 |
| `--log-level` | string | 否 | 日志级别，默认 `info` |

### 健康检查

**端点**：`GET /health`

**成功响应** (200 OK)：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345
}
```

HubServer 通过轮询此端点判断 Agent Runtime 是否就绪。超时（默认 10 秒）未返回 `200` 则视为启动失败。

### 内部调用鉴权

HubServer 调用 Agent Runtime 的 `/runtime/*` 端点时，应携带内部服务凭证。MVP 阶段可使用共享密钥（通过环境变量或启动参数传递），后续可升级为更安全的鉴权机制。

### 错误码约定

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `RUNTIME_NOT_READY` | 503 | Agent Runtime 尚未就绪 |
| `RUN_INVALID_INPUT` | 400 | 请求参数校验失败 |
| `RUN_NOT_FOUND` | 404 | 指定的 Run 不存在 |
| `RUN_TIMEOUT` | 504 | Run 执行超时 |
| `ADAPTER_ERROR` | 502 | Agent Adapter 调用失败 |
| `AGENT_NOT_FOUND` | 404 | 指定的 Agent 不存在，或隐藏 Agent 未授权查看 |
| `AGENT_INVALID_FILTER` | 400 | Agent 查询参数无效 |
| `AGENT_REGISTRY_UNAVAILABLE` | 503 | Agent 注册表不可用 |
| `RUN_INVALID_PARTICIPANTS` | 400 | RunInput 中的会话智能体成员不合法 |
| `RUN_INVALID_ENTRY_AGENT` | 400 | RunInput 无法解析合法入口智能体 |

## Runtime Agents API

Runtime Agents API 用于让 HubServer 查询 Agent Runtime 当前可执行的智能体注册表。本 API 只面向 `hub-server`，不直接面向浏览器。

### 查询智能体列表

**端点**：`GET /runtime/agents`

默认只返回：

- `tier = "primary"`
- `visibility = "visible"`
- `enabled = true`

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `includeHidden` | `true` / `false` | 否 | `false` | 是否包含隐藏子智能体 |
| `enabledOnly` | `true` / `false` | 否 | `true` | 是否只返回启用的智能体 |
| `tier` | `primary` / `subagent` | 否 | 默认 `primary` | 按主智能体或子智能体过滤 |
| `origin` | `system` / `user` / `external` | 否 | 无 | 按来源过滤 |

成功响应：

```json
{
  "agents": [
    {
      "id": "orchestrator",
      "name": "Orchestrator",
      "description": "Default entry agent that understands the task, chooses the right agents, and summarizes the final answer.",
      "tier": "primary",
      "origin": "system",
      "visibility": "visible",
      "entryPolicy": "default",
      "delegationPolicy": "can-delegate",
      "executorType": "orchestrator",
      "capabilities": ["routing", "planning", "delegation", "aggregation"],
      "enabled": true,
      "readonly": true
    }
  ]
}
```

失败响应：

```json
{
  "error": {
    "code": "AGENT_INVALID_FILTER",
    "message": "Invalid agent filter query",
    "details": []
  }
}
```

### 查询智能体详情

**端点**：`GET /runtime/agents/:agentId`

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `includeHidden` | `true` / `false` | 否 | `false` | 是否允许查询隐藏子智能体 |

行为规则：

- 可见主智能体可直接查询。
- 隐藏子智能体默认返回 `AGENT_NOT_FOUND`。
- 查询隐藏子智能体时必须显式传入 `includeHidden=true`。

成功响应：

```json
{
  "id": "orchestrator",
  "name": "Orchestrator",
  "description": "Default entry agent that understands the task, chooses the right agents, and summarizes the final answer.",
  "tier": "primary",
  "origin": "system",
  "visibility": "visible",
  "entryPolicy": "default",
  "delegationPolicy": "can-delegate",
  "executorType": "orchestrator",
  "capabilities": ["routing", "planning", "delegation", "aggregation"],
  "enabled": true,
  "readonly": true,
  "modelRef": {
    "providerId": "openai",
    "modelId": "gpt-5.1"
  },
  "resolvedModel": {
    "providerId": "openai",
    "modelId": "gpt-5.1",
    "providerProtocol": "openai",
    "providerName": "OpenAI",
    "modelName": "GPT-5.1",
    "upstreamModelId": "gpt-5.1",
    "contextLength": 128000,
    "outputLength": 4096,
    "capabilities": {
      "supports_tools": true,
      "supports_vision": true,
      "supports_reasoning": true,
      "temperature": true
    },
    "enabled": true
  },
  "allowedSubagents": ["explore", "general", "file", "deploy"],
  "allowedTools": [],
  "permissionPolicy": {
    "filesystem": "none",
    "shell": "none",
    "network": "none",
    "deploy": "none",
    "requiresApproval": false
  }
}
```

外部智能体详情会返回脱敏后的 `external` 配置，不返回底层命令参数：

```json
{
  "external": {
    "provider": "opencode",
    "outputFormat": "event-stream",
    "workingDirectoryPolicy": "runtime-workspace",
    "configDirectoryPolicy": "runtime-managed"
  }
}
```

如果智能体配置了 `modelRef`，列表和详情都可以透出该绑定；`resolvedModel` 仅在 provider 与 model 都可解析时返回，否则为空。

## Runtime RunInput 会话入口规则

Runtime Run API 尚未实现；本节先记录后续 `POST /runtime/runs` 必须遵守的 IM 会话入口契约。

RunInput 必须携带会话模式和当前会话智能体成员：

```ts
type RuntimeConversationMode = "single" | "group"

type RunInput = {
  conversationId: string
  mode: RuntimeConversationMode
  participantAgentIds: string[]
  addressedAgentIds?: string[]
  userMessage: unknown
  history: unknown[]
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `mode` | `single` 表示单聊，`group` 表示群聊 |
| `participantAgentIds` | 当前会话包含的主智能体成员，由 HubServer 提供 |
| `addressedAgentIds` | 当前用户消息显式 @ 的主智能体；为空表示未显式指定 |

入口解析规则：

| 场景 | 入口智能体 |
| --- | --- |
| 单聊 | `participantAgentIds[0]` |
| 群聊且 `addressedAgentIds` 非空 | `addressedAgentIds` |
| 群聊且 `addressedAgentIds` 为空 | `orchestrator` |

校验规则：

- 单聊必须且只能包含一个可见、启用、可调用的主智能体。
- 单聊入口不能是 `orchestrator`。
- 群聊必须包含 `orchestrator`。
- 群聊成员只能是可见、启用的主智能体。
- `addressedAgentIds` 必须是 `participantAgentIds` 的子集。
- 子智能体不能作为会话成员，也不能被用户显式 @。
- 当前阶段 `addressedAgentIds` 最多只能包含 1 个主智能体；多个 @ 的并行执行留待后续版本。
- 成员校验失败返回 `RUN_INVALID_PARTICIPANTS`。
- 入口解析失败返回 `RUN_INVALID_ENTRY_AGENT`。

## Runtime Runs API

Runtime Runs API 用于启动一次智能体执行。本阶段只实现 in-memory Run、MockExecutor 和最小 SSE 事件流，不持久化数据库，不调用真实模型，不执行工具。

当前阶段已经包含 `orchestrator` 的最小编排路径：`orchestrator` 可以通过内部 `run_task` 调度允许的主智能体或子智能体，并通过 `dependsOn` 表达 DAG 依赖；无依赖任务可批次并行执行。

### 创建 Run

**端点**：`POST /runtime/runs`

请求体：

```json
{
  "conversationId": "conv_123",
  "mode": "single",
  "participantAgentIds": ["coder"],
  "addressedAgentIds": [],
  "userMessage": {
    "role": "user",
    "content": "请帮我看一下这个组件。"
  },
  "history": []
}
```

成功响应 (201 Created)：

```json
{
  "runId": "run_xxx",
  "status": "queued",
  "entryAgentIds": ["coder"],
  "entryReason": "single_participant",
  "eventsUrl": "/runtime/runs/run_xxx/events"
}
```

入口原因：

| `entryReason` | 说明 |
| --- | --- |
| `single_participant` | 单聊入口为该单聊绑定的主智能体 |
| `group_default_orchestrator` | 群聊未显式 @，入口为 `orchestrator` |
| `group_addressed_agent` | 群聊显式 @ 单个主智能体，入口为被 @ 的智能体 |

失败响应：

```json
{
  "error": {
    "code": "RUN_INVALID_PARTICIPANTS",
    "message": "Group chat must include orchestrator"
  }
}
```

### 查询 Run

**端点**：`GET /runtime/runs/:runId`

成功响应：

```json
{
  "id": "run_xxx",
  "status": "completed",
  "input": {
    "conversationId": "conv_123",
    "mode": "single",
    "participantAgentIds": ["coder"],
    "addressedAgentIds": [],
    "userMessage": {
      "role": "user",
      "content": "请帮我看一下这个组件。"
    },
    "history": []
  },
  "entryAgentIds": ["coder"],
  "entryReason": "single_participant",
  "createdAt": "2026-05-23T00:00:00.000Z",
  "updatedAt": "2026-05-23T00:00:00.000Z"
}
```

不存在时返回 `RUN_NOT_FOUND`。

### 订阅 Run 事件

**端点**：`GET /runtime/runs/:runId/events`

响应类型：`text/event-stream`

行为：

- 订阅时先按顺序 replay 已有事件。
- Run 未结束时继续推送新事件。
- Run 到达终态事件后关闭流。
- 不存在时返回 `RUN_NOT_FOUND`。

事件格式：

```text
event: message.delta
data: {"id":"evt_xxx","runId":"run_xxx","type":"message.delta","timestamp":"2026-05-23T00:00:00.000Z","agentId":"coder","data":{"delta":"Coder received the task."}}
```

本阶段事件类型：

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
message.delta
message.completed
agent.completed
run.completed
run.failed
run.cancelled
```

事件字段：

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
  data?: unknown
}
```

### 取消 Run

**端点**：`POST /runtime/runs/:runId/cancel`

行为：

- `queued` / `running` Run 会转为 `cancelled` 并输出 `run.cancelled`。
- 已经是 `completed`、`failed`、`cancelled` 的 Run 保持原状态。
- 不存在时返回 `RUN_NOT_FOUND`。

## 初始契约范围

- 会话。
- 消息。
- Agent 注册表。
- Runtime 调用。
- Runtime 流式事件。
- Artifact 元数据。
- 权限请求与审批。

具体端点、事件名称和载荷结构应随着 API 实现逐步补充。
