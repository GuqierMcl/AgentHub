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
| `RUN_INVALID_WORKSPACE` | 400 | RunInput.workspace 无效，例如本地目录不存在或不是目录 |
| `RUN_NOT_FOUND` | 404 | 指定的 Run 不存在 |
| `RUN_ALREADY_ACTIVE` | 409 | 同一会话已有非终态 Run，当前阶段不允许并发发送 |
| `RUN_TIMEOUT` | 504 | Run 执行超时 |
| `ADAPTER_ERROR` | 502 | Agent Adapter 调用失败 |
| `AGENT_NOT_FOUND` | 404 | 指定的 Agent 不存在，或隐藏 Agent 未授权查看 |
| `AGENT_INVALID_FILTER` | 400 | Agent 查询参数无效 |
| `AGENT_INVALID_INPUT` | 400 | Agent 创建或更新请求参数无效 |
| `AGENT_ALREADY_EXISTS` | 409 | Agent ID 已存在，或与系统预设冲突 |
| `AGENT_NOT_EDITABLE` | 403 | 指定 Agent 不允许被当前 API 修改 |
| `AGENT_REGISTRY_UNAVAILABLE` | 503 | Agent 注册表不可用 |
| `AGENT_STORE_WRITE_FAILED` | 500 | Agent 本地配置写入失败 |
| `RUN_INVALID_PARTICIPANTS` | 400 | RunInput 中的会话智能体成员不合法 |
| `RUN_INVALID_ENTRY_AGENT` | 400 | RunInput 无法解析合法入口智能体 |
| `AGENT_MODEL_BINDING_INVALID` | 400 | 智能体模型绑定参数或 provider/model 不可用 |
| `AGENT_MODEL_BINDING_NOT_ALLOWED` | 403 | 当前智能体不允许绑定模型 |
| `PERMISSION_INVALID_INPUT` | 400 | 权限决定请求体无效 |
| `PERMISSION_NOT_FOUND` | 404 | 指定的权限请求不存在 |
| `PERMISSION_ALREADY_RESOLVED` | 409 | 权限请求已经决定或取消 |
| `PERMISSION_RUN_NOT_ACTIVE` | 409 | Run 已非等待审批状态，不能恢复 |
| `PERMISSION_GRANT_FAILED` | 409 | 无法为已批准请求创建受控访问授权 |
| `MODEL_BINDING_MISSING` | 400 | 智能体未配置模型绑定 |
| `MODEL_PROVIDER_NOT_FOUND` | 404 | 绑定的 provider 不存在 |
| `MODEL_NOT_FOUND` | 404 | 绑定的 model 不存在 |
| `MODEL_DISABLED` | 400 | 绑定的 provider 或 model 已禁用 |
| `MODEL_TOOLS_UNSUPPORTED` | 400 | 绑定的模型不支持工具调用 |
| `MODEL_UNSUPPORTED_PROVIDER` | 400 | provider 协议不受 Runtime 支持 |
| `TOOL_NOT_FOUND` | 404 | 请求的工具不存在 |
| `TOOL_NOT_ALLOWED` | 403 | 当前智能体不允许使用该工具 |
| `TOOL_INVALID_INPUT` | 400 | 工具输入未通过 schema 校验 |
| `TOOL_PERMISSION_DENIED` | 403 | 智能体 permissionPolicy 不满足工具 requiredPermissions |
| `TOOL_APPROVAL_REQUIRED` | 409 | 工具调用需要先完成权限审批 |
| `TOOL_EXECUTION_DENIED` | 403 | 用户拒绝了该工具审批请求 |
| `TOOL_EXECUTION_FAILED` | 502 | 工具执行失败 |
| `TOOL_EXECUTION_ABORTED` | 499 | 工具执行被取消或中止 |
| `NETWORK_INVALID_URL` | 400 | `web_fetch` URL 无效 |
| `NETWORK_UNSUPPORTED_PROTOCOL` | 400 | `web_fetch` URL 协议不是 `http:` 或 `https:` |
| `NETWORK_TIMEOUT` | 504 | `web_fetch` 请求超时 |
| `NETWORK_REQUEST_FAILED` | 502 | `web_fetch` 网络请求失败 |
| `NETWORK_RESPONSE_TOO_LARGE` | 413 | `web_fetch` 响应体超过 `maxResponseBytes` |
| `WORKSPACE_NOT_BOUND` | 400 | 当前 Run 未绑定 workspace，不能执行文件工具 |

## Runtime Agents API

Runtime Agents API 用于让 HubServer 查询 Agent Runtime 当前可执行的智能体注册表，并管理用户自定义主智能体。本 API 只面向 `hub-server`，不直接面向浏览器。

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
  "allowedTools": ["write_plan", "run_task", "web_fetch"],
  "permissionPolicy": {
    "filesystem": "none",
    "shell": "none",
    "network": "full",
    "deploy": "none"
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

用户自定义智能体详情会额外返回 `systemPrompt`，用于编辑表单回显；系统预设智能体和外部智能体不会通过详情接口返回内部提示词。

### 查询用户智能体创建选项

**端点**：`GET /runtime/agents/authoring-options`

本端点用于支持 HubServer 构建用户自定义智能体创建/编辑表单。浏览器仍应通过 HubServer 代理访问，不直接调用 Runtime。

成功响应：

```json
{
  "tools": [
    {
      "id": "ls",
      "name": "List files",
      "description": "List files and directories in the workspace.",
      "category": "workspace",
      "riskLevel": "low",
      "approvalPolicy": "contextual",
      "requiredPermissions": {
        "filesystem": "read"
      }
    },
    {
      "id": "read_file",
      "name": "Read file",
      "description": "Read a text file or image file from the workspace.",
      "category": "workspace",
      "riskLevel": "low",
      "approvalPolicy": "contextual",
      "requiredPermissions": {
        "filesystem": "read"
      }
    },
    {
      "id": "write_file",
      "name": "Write file",
      "description": "Create or overwrite a UTF-8 text file in the workspace.",
      "category": "workspace",
      "riskLevel": "medium",
      "approvalPolicy": "contextual",
      "requiredPermissions": {
        "filesystem": "write"
      }
    },
    {
      "id": "edit_file",
      "name": "Edit file",
      "description": "Apply a precise search/replace edit to a UTF-8 text file in the workspace.",
      "category": "workspace",
      "riskLevel": "medium",
      "approvalPolicy": "contextual",
      "requiredPermissions": {
        "filesystem": "write"
      }
    }
  ],
  "capabilityTags": ["Implementation", "Review", "Documentation", "Thinking"],
  "subagents": [
    {
      "id": "general",
      "name": "General",
      "description": "Handles lightweight reasoning, explanation, summarization, and rewriting tasks.",
      "capabilities": ["reasoning", "summary", "rewrite"]
    }
  ],
  "defaults": {
    "allowedTools": [],
    "allowedSubagents": [],
    "permissionPolicy": {
      "filesystem": "none",
      "shell": "none",
      "network": "none",
      "deploy": "none"
    }
  }
}
```

规则：

- `tools` 从注册工具的 Tool Catalog 投影，只返回 `configurableByUserAgent = true` 且非 internal 的工具；不在路由或 CRUD 中维护重复白名单。
- `write_plan`、`run_task` 不会出现在 `tools` 中。
- `approvalPolicy = "contextual"` 表示是否审批取决于运行上下文；读工具在敏感/沙箱外读取时触发审批，写工具在敏感/沙箱外写入时触发审批。
- `capabilityTags` 是推荐标签字符串数组，不是强枚举；创建和更新自定义智能体时 `capabilities` 仍允许自定义字符串数组，例如 `["Thinking"]`。
- `subagents` 只返回可配置到 `allowedSubagents` 的启用隐藏子智能体摘要，不改变隐藏子智能体不可直接调用的规则。

### 创建用户自定义智能体

**端点**：`POST /runtime/agents`

本端点只创建用户自定义、可见、主智能体、AI SDK 执行器。Runtime 会强制设置：

- `origin = "user"`
- `tier = "primary"`
- `visibility = "visible"`
- `entryPolicy = "callable"`
- `executorType = "ai-sdk"`
- `readonly = false`

请求体：

```json
{
  "id": "custom_writer",
  "name": "Custom Writer",
  "description": "Writes with a custom voice.",
  "systemPrompt": "You are a careful custom writing agent.",
  "capabilities": ["writing"],
  "allowedSubagents": ["general"],
  "allowedTools": ["ls", "read_file"],
  "permissionPolicy": {
    "filesystem": "read",
    "shell": "none",
    "network": "none",
    "deploy": "none"
  },
  "enabled": true
}
```

字段规则：

- `id` 可省略；省略时 Runtime 生成 `agent_<uuid>`。
- `id` 只能使用小写字母、数字、下划线和连字符，并且不能与系统预设或现有智能体冲突。
- `allowedSubagents` 只能包含已注册、启用、隐藏的子智能体。
- `allowedTools` 只允许 Tool Catalog 暴露为用户可配置的文件工具：`ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`。
- `write_plan`、`run_task`、`web_fetch` 和其他高风险工具不能授予用户自定义智能体。
- `permissionPolicy` 中 `shell` / `network` / `deploy` 必须为 `none`。
- 若选择了读取工具，`permissionPolicy.filesystem` 至少为 `read`；若选择了写入工具，必须显式为 `write`。Runtime 不自动升级智能体权限。
- 模型绑定不属于 CRUD 主体流程；创建后继续使用 `PUT /runtime/agents/:agentId/model` 配置模型。

成功响应：`201 Created`，返回 agent detail。用户自定义智能体详情包含 `systemPrompt`。

### 更新用户自定义智能体

**端点**：`PUT /runtime/agents/:agentId`

请求体可以包含以下一个或多个字段：

```json
{
  "name": "Custom Editor",
  "description": "Edits concise technical copy.",
  "systemPrompt": "You are a precise technical editor.",
  "capabilities": ["editing"],
  "allowedSubagents": ["general"],
  "allowedTools": [],
  "permissionPolicy": {
    "filesystem": "none",
    "shell": "none",
    "network": "none",
    "deploy": "none"
  },
  "enabled": true
}
```

规则：

- 只能更新 `origin = "user"`、`readonly = false`、`tier = "primary"`、`executorType = "ai-sdk"` 的自定义智能体。
- 不能通过本端点修改 `id`、`origin`、`tier`、`visibility`、`entryPolicy`、`executorType` 或 `readonly`。
- 系统预设智能体、外部智能体和隐藏子智能体返回 `AGENT_NOT_EDITABLE`。
- 成功响应返回更新后的 agent detail。

### 删除用户自定义智能体

**端点**：`DELETE /runtime/agents/:agentId`

规则：

- 只能删除用户自定义主智能体。
- 删除时同步清理该智能体的模型绑定覆盖。
- 不清理历史 Run 或消息；这些业务数据后续由 HubServer 负责。

成功响应：

```json
{
  "agentId": "custom_writer",
  "deleted": true
}
```

### 绑定智能体模型

**端点**：`PUT /runtime/agents/:agentId/model`

请求体：

```json
{
  "providerId": "openai",
  "modelId": "gpt-5.1"
}
```

规则：

- 仅允许可见、启用的内部主智能体绑定模型，当前也包括 `orchestrator`。
- 隐藏子智能体和外部智能体不允许绑定。
- provider 与 model 必须存在且启用。

成功响应：返回更新后的 agent detail，包含 `modelRef` 和 `resolvedModel`。

**端点**：`DELETE /runtime/agents/:agentId/model`

规则：

- 清除该智能体的模型绑定覆盖。
- 若智能体本身存在基础 `modelRef`，清除后会回退到基础配置。

成功响应：返回更新后的 agent detail。

## Conversations API

Conversations API 为 Web 聊天列表、会话详情和会话管理提供产品级数据。

### 查询会话列表

**端点**：`GET /api/conversations?status=active|archived`

成功响应：

```ts
type ConversationListItem = {
  id: string
  title: string
  mode: "single" | "group"
  status: "active" | "archived"
  orchestratorAgentId: string | null
  lastMessageId: string | null
  lastMessageAt: string | null
  lastMessageContent: string
  pinnedAt: string | null
  createdAt: string
  updatedAt: string
  agents: { agentId: string }[]
  metadata: Record<string, unknown> | null
}
```

规则：

- `lastMessageContent` 来自 `lastMessageId` 对应消息的 text parts，HubServer 返回前最多截取 50 个字符。
- 会话列表 API 不返回 Run 运行状态。Web 只对已经打开过、Zustand 中有本地 Run 状态的 conversation 显示卡片 spinner 和底部进度条。

## Hub Global Events API

Hub Global Events API 用于 HubServer 向 Web 推送低频产品状态通知。它不用于聊天内容流式输出，也不用于恢复 Runtime raw events。

### 订阅全局事件

**端点**：`GET /api/events`

响应类型：`text/event-stream`

事件格式：

```text
event: hub.event
data: {"id":"evt_xxx","type":"run.status.changed","timestamp":"2026-05-29T00:00:00.000Z","data":{"conversationId":"conv_xxx","runId":"run_xxx","status":"running"}}
```

契约：

```ts
type HubGlobalEventType =
  | "conversation.updated"
  | "conversation.title.updated"
  | "conversation.last_message.updated"
  | "run.status.changed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"

type HubGlobalEventEnvelope = {
  id: string
  type: HubGlobalEventType
  timestamp: string
  data: Record<string, unknown>
}
```

规则：

- v1 全局事件只保存在 HubServer 进程内，不持久化。
- 不支持 replay、`Last-Event-ID` 或 `afterSequence`；Web 断线期间错过的事件不会补发。
- 服务端使用 SSE comment heartbeat 保持连接活跃。
- Run payload 至少包含 `conversationId`、`runId`、`status`，可包含 `runtimeRunId`。
- Conversation payload 至少包含 `conversationId`，可包含 `title`、`lastMessageId`、`lastMessageAt`、`lastMessageContent`。

## Product Messages and Runs API

Product Messages and Runs API 是 Web 聊天主路径。Web 不再直接用 `/api/runtime/runs*` 创建聊天回复，而是通过 HubServer 持久化消息、Run 和 RunEvent 后再调用 Agent Runtime。完整机制见 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`。

### 发送会话消息

**端点**：`POST /api/conversations/:conversationId/messages/send`

请求体：

```json
{
  "content": "请帮我改一下这个组件。"
}
```

行为：

- HubServer 创建 user `Message` 和 text `MessagePart`，并使用 run-local `firstEventSequence = 0` 固定它排在该 run 的 Runtime 输出之前。
- HubServer 创建本地 `Run(status="queued")`，并将 `triggerMessageId` 指向 user message。
- HubServer 从持久化 messages 投影 Runtime `history`，组装 Runtime `RunInput` 后调用 `POST /runtime/runs`。
- Runtime 返回的 `runId` 写入本地 `Run.runtimeId`。
- HubServer 启动后台 Runtime SSE consumer，并返回最新消息快照与 `timelineRuns` 产品 event replay 数据。
- 同一 conversation 已存在非终态 Run 时返回 `RUN_ALREADY_ACTIVE`。

成功响应：

```ts
type ConversationMessagesResponse = {
  messages: PersistedMessage[]
  activeRun: ActiveRunSnapshot | null
  latestPlan: RunPlanSnapshot | null
  runItems: ConversationRunItemsSnapshot
  timelineRuns: ConversationTimelineRunSnapshot[]
}
```

### 查询会话消息快照

**端点**：`GET /api/conversations/:conversationId/messages?limit=&offset=`

成功响应同 `ConversationMessagesResponse`。

```ts
type PersistedMessage = {
  id: string
  conversationId: string
  runId: string | null
  runtimeMessageId: string | null
  runtimeRunId: string | null
  messageIndex: number | null
  surface: string
  role: "user" | "assistant" | "system"
  senderType: string
  senderId: string | null
  agentId: string | null
  taskId: string | null
  groupId: string | null
  status: "created" | "streaming" | "completed" | "failed" | "cancelled"
  finishReason: string | null
  firstEventSequence: number | null
  lastEventSequence: number | null
  metadataJson: Record<string, unknown>
  uiMessageJson: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  parts: PersistedMessagePart[]
}

type PersistedMessagePart = {
  id: string
  messageId: string
  conversationId: string
  runId: string | null
  runtimeEventId: string | null
  partKey: string
  partIndex: number
  entityType: string | null
  entityId: string | null
  type: string
  state: string
  text: string | null
  payloadJson: Record<string, unknown>
  firstEventSequence: number | null
  lastEventSequence: number | null
  createdAt: string
  updatedAt: string
}

type ActiveRunSnapshot = {
  id: string
  runtimeId: string | null
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled"
  lastEventSequence: number
  plan: Record<string, unknown> | null
}

type RunPlanSnapshot = {
  runId: string
  status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled"
  plan: Record<string, unknown>
  updatedAt: string
  completedAt: string | null
}

type ConversationRunItemsSnapshot = {
  toolCalls: Record<string, unknown>[]
  reasoningBlocks: Record<string, unknown>[]
  taskGroups: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  plans: Record<string, unknown>[]
  planTasks: Record<string, unknown>[]
  permissionRequests: Record<string, unknown>[]
}

type ConversationTimelineRunSnapshot = {
  run: {
    id: string
    runtimeId: string | null
    status: "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled"
    triggerMessageId: string
    createdAt: string
    lastEventSequence: number
  }
  triggerMessage: PersistedMessage | null
  events: HubRunEventEnvelope[]
}

type HubRunEventEnvelope = {
  sequence: number
  event: RuntimeRunEvent
}
```

`activeRun.id` 是 HubServer 本地 Run id。`activeRun.runtimeId` 只用于调试和跨进程关联，Web 产品路径不得用它订阅 Runtime。
`timelineRuns` 是聊天 UI 恢复的主数据源：Web 先渲染每个 run 的 `triggerMessage`，再按 `events.sequence` 重放产品 event envelope，并与 live SSE 共用同一套 projection reducer。大工具结果可能已被投影为 UI 摘要；完整 raw Runtime event 保存在 `RunEvent.payloadJson`。`messages` 与 `runItems` 保留为查询、history、统计和后续产品能力的数据源。

### 订阅产品 Run 事件

**端点**：`GET /api/runs/:runId/events?afterSequence=`

响应类型：`text/event-stream`

事件格式：

```text
event: run.event
data: {"sequence":12,"event":{"id":"evt_xxx","runId":"runtime_run_xxx","type":"message.delta","timestamp":"2026-05-29T00:00:00.000Z","messageId":"msg_runtime_run_xxx_exec_0","messageIndex":0,"data":{"delta":"hello"}}}
```

行为：

- `runId` 是 HubServer 本地 Run id。
- HubServer 先发送 `sequence > afterSequence` 的持久化 RunEvent，再推送 live events。
- `sequence` 是本地 Run 内递增序号。
- `event` 是面向产品 UI 的 Runtime RunEvent envelope；大工具结果可能已被摘要化。
- `RunEvent.payloadJson` 永久保留 raw 事实；未知 event type 也必须落库，后续只补 projection。
- 产品 Run SSE 和 `timelineRuns` 可对大工具结果做 UI 摘要投影以保护浏览器热路径；例如 `tool.completed(toolName="web_fetch")` 的 `event.data.data.body` 不会传给前端，摘要里包含 `bodyCharacters` 与 `bodyOmittedForUi: true`。完整 raw event 仍保存在 `RunEvent.payloadJson`。
- Run 到达终态后关闭流。

Web 恢复规则：

- 先加载 messages snapshot 中的 `timelineRuns` 并重放产品 event envelopes。
- 用 `activeRun.lastEventSequence` 作为 `afterSequence` 续订 active run。
- Web 按 Runtime `event.id` 去重；live SSE 和 replay 都进入同一套 projection reducer，避免重复拼接 `message.delta`。

### 取消产品 Run

**端点**：`POST /api/runs/:runId/cancel`

行为：

- HubServer 查找本地 Run。
- 若存在 `runtimeId`，转发到 Runtime `POST /runtime/runs/:runtimeId/cancel`。
- 若 Runtime id 尚未写入，则直接将本地 Run 标记为 `cancelled`。
- 返回更新后的 `ActiveRunSnapshot`。

### 决定产品 Run 权限请求

**端点**：`POST /api/runs/:runId/permissions/:requestId/decision`

请求体：

```json
{
  "approved": true,
  "reason": "User allowed this network request."
}
```

行为：

- `runId` 是 HubServer 本地 Run id。
- HubServer 查找本地 Run，读取 `runtimeId`，再转发到 Runtime `POST /runtime/runs/:runtimeId/permissions/:requestId/decision`。
- Web 产品链路必须调用本端点，不直接调用 `/api/runtime/runs/*` 调试代理。
- Runtime 的后续 `permission.approved` / `permission.denied` / `tool.*` 事件仍通过 `/api/runs/:runId/events` 持久化和回放。
- `runtimeId` 缺失时返回 `PERMISSION_RUN_NOT_ACTIVE`。

### 调试代理

`/api/runtime/runs*` 仍保留为调试和过渡代理接口，但不再是 Web 聊天主路径。产品级消息、恢复、持久化和 sequence 语义只由本节 API 承担。

## Runtime RunInput 会话入口规则

Runtime Run API 已实现；本节记录 `POST /runtime/runs` 及相关事件、审批续跑接口遵守的 IM 会话入口契约。

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
  conversationState?: {
    messageCountBeforeRun?: number
    titleSource?: "default" | "auto" | "manual"
    titleSeedUserMessage?: string
  }
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  diagnostics?: {
    includeModelStream?: boolean
    includeReasoning?: boolean
    includeRawModelChunks?: boolean
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `mode` | `single` 表示单聊，`group` 表示群聊 |
| `participantAgentIds` | 当前会话包含的主智能体成员，由 HubServer 提供 |
| `addressedAgentIds` | 当前用户消息显式 @ 的主智能体；为空表示未显式指定 |
| `conversationState` | HubServer 提供的会话状态快照；首版用于 Runtime 判断是否触发 `title` 系统智能体。`titleSeedUserMessage` 固定为会话第一条用户输入，供自动标题重试时使用 |
| `workspace` | 可选的本次 Run 主工作区 snapshot；首版只支持已存在本地目录 |
| `diagnostics` | 可选模型流追踪开关；默认输出 `model.stream.part` 与 `reasoning.*`，但不输出 AI SDK `raw` chunk |

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

Runtime Runs API 用于启动一次智能体执行。Run 与权限状态当前保持 in-memory，不写业务数据库；AI SDK 执行、Runtime Tools、Orchestrator 工具调用、SSE replay 和取消能力已在 Runtime 内部闭环。

当前阶段已经包含 `orchestrator` 的最小编排路径：`orchestrator` 可以通过内部 `write_plan` 写入 UI 可渲染计划，再通过内部 `run_task` 调度允许的主智能体或子智能体，并通过 `dependsOn` 表达依赖；无依赖任务可批次并行执行。

`run_task` 的目标边界：

- 如果目标是主智能体，目标必须属于当前 Run 的 `participantAgentIds`，且当前阶段仅 `orchestrator` 可以发起这种委派。
- 如果目标是子智能体，目标必须在发起智能体的 `allowedSubagents` 中。
- Runtime 不再读取 `agent-relations.json`，也不再使用 `AgentRelation` 作为委派依据。

workspace 规则：

- `workspace` 可省略；省略时 Run 可纯对话，但文件工具返回 `WORKSPACE_NOT_BOUND`。
- `backendType` 当前只能是 `local`。
- `rootPath` 必须是已存在目录；Runtime 不自动创建目录，且 Run 创建后不可切换 workspace。
- 普通 Run 响应、普通事件、工具成功结果和日志不得回显 `rootPath` 或授权目录真实绝对路径。

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
  "history": [],
  "workspace": {
    "workspaceId": "workspace_conv_123",
    "backendType": "local",
    "rootPath": "D:/Projects/example"
  },
  "diagnostics": {
    "includeModelStream": true,
    "includeReasoning": true,
    "includeRawModelChunks": false
  }
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
    "history": [],
    "workspace": {
      "workspaceId": "workspace_conv_123",
      "backendType": "local",
      "rootLabel": "example"
    }
  },
  "entryAgentIds": ["coder"],
  "entryReason": "single_participant",
  "createdAt": "2026-05-23T00:00:00.000Z",
  "updatedAt": "2026-05-23T00:00:00.000Z"
}
```

不存在时返回 `RUN_NOT_FOUND`。

`status` 可为 `queued`、`running`、`waiting_approval`、`completed`、`failed` 或 `cancelled`。`waiting_approval` 表示 Runtime 已收到 AI SDK tool approval request，正在等待权限决定并保留同一 Run 的 continuation state。若仍有其他并行任务分支在运行，Run 可以保持 `running`；当所有未完成分支都在等待审批时才转为 `waiting_approval`。

### 订阅 Run 事件

**端点**：`GET /runtime/runs/:runId/events`

响应类型：`text/event-stream`

完整 SSE 事件契约见 `docs/contracts/RUNTIME_SSE_EVENTS.md`。本节保留 Runtime Runs API 中最常用的事件格式和类型索引。

行为：

- 订阅时先按顺序 replay 已有事件。
- Run 未结束时继续推送新事件。
- Run 到达终态事件后关闭流。
- 不存在时返回 `RUN_NOT_FOUND`。

事件格式：

```text
event: message.delta
data: {"id":"evt_xxx","runId":"run_xxx","type":"message.delta","timestamp":"2026-05-23T00:00:00.000Z","agentId":"coder","messageId":"msg_run_xxx_execution_xxx_0","messageIndex":0,"data":{"delta":"Coder received the task."}}
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
system_agent.completed
run.completed
run.failed
run.cancelled
```

`orchestrator.plan.created` 目前保留为后续可视化和调试的扩展事件；当前 AI SDK orchestrator V1 主路径不强制发送该事件。

`system_agent.completed` 表示 Runtime 内部系统智能体在当前 Run 完成前产出了可消费结果。首版只定义 `title`；标题只基于会话第一条用户输入生成，不包含第一轮智能体输出。标题结果一旦 ready 且 Run 仍未结束，Runtime 会立即发送该事件；主智能体完成时只短暂等待标题任务 flush，如果标题任务仍未赶上，Runtime 会取消该任务且不发送此事件：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "system_agent.completed",
  "timestamp": "2026-05-27T00:00:00.000Z",
  "agentId": "system:title",
  "data": {
    "systemAgentId": "title",
    "conversationId": "conv_123",
    "target": "conversation.title",
    "trigger": "first_user_message",
    "inheritedModelFromAgentId": "coder",
    "result": {
      "title": "系统智能体层级设计"
    }
  }
}
```

HubServer 消费规则：

- 事件先作为 raw `RunEvent` 持久化，再尝试产品投影。
- 当 `data.systemAgentId = "title"` 且 `data.target = "conversation.title"` 时，HubServer 在 `Conversation.metadataJson.titleSource !== "manual"` 的前提下更新 `Conversation.title`。
- 成功更新后写入 `metadataJson.titleSource = "auto"`；用户手动重命名必须写入 `titleSource = "manual"`，防止自动标题覆盖。
- Web live 收到该事件后刷新 conversation list/detail；该事件不渲染为聊天消息。

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
  toolCallId?: string
  toolName?: string
  messageId?: string
  messageIndex?: number
  data?: unknown
}
```

消息事件身份规则：

- `message.delta` / `message.completed` 以 AI SDK 文本块为边界；一次 agent execution 可以输出多条 Runtime message。
- `messageId` 表示一次可聚合的智能体消息容器。同一文本块的 delta 和 completed 必须共享同一个 `messageId`；同一输出上下文内的 `reasoning.*`、`tool.*`、`permission.*` 也应复用该 `messageId`。
- `messageIndex` 是 RunManager 按首次 emit 顺序分配的 run-local 递增序号，用于并发任务和交替发言下的稳定排序；同一 `messageId` 下的 reasoning/tool/permission/message 事件共享同一个 `messageIndex`。
- `agent.completed` 仍表示 execution 完成；usage、finishReason、resolvedModel 以 `agent.completed.data` 为准。`message.completed.data` 只保证包含最终 `content`。
- HubServer 后续持久化时应将 `RunEvent.messageId = event.messageId`；同一 `messageId` 投影到同一 assistant `Message`，文本进入 text `MessagePart`，reasoning/tool/permission 进入对应 part 或 metadata。`messageIndex` 可先写入 message metadata，后续再迁移为排序字段。

工具事件的附加约束：

- `tool.started`、`tool.completed`、`tool.failed` 必须携带 `toolCallId` 与 `toolName`；当工具调用来自某个模型输出上下文时，还应携带对应 `messageId/messageIndex`。
- `tool.started` 不回显原始文件路径入参；workspace 类工具的普通事件和成功结果只使用 workspace-relative 路径或 `mounts/<mountId>/...` 逻辑路径。
- `tool.failed` 的 `data` 应尽量包含结构化错误码、错误消息和可调试细节。
- `permission.requested`、`permission.approved`、`permission.denied`、`permission.cancelled` 携带 `toolCallId`、`toolName`，其 `data` 为权限请求记录，包含 `requestId`、`riskLevel`、`status` 与可选 grant 信息；当权限请求来自某个模型输出上下文时，还应携带对应 `messageId/messageIndex`。
- 工具进入审批时先产生 `permission.requested` 而不产生 `tool.started`；批准后恢复工具并发送正常工具事件，拒绝后发送 `tool.failed`，错误码为 `TOOL_EXECUTION_DENIED`。
- `model.stream.part` 通过 `data.partType` 和 `data.part` 薄封装 AI SDK `fullStream` part；默认过滤 `raw`，除非 RunInput 设置 `diagnostics.includeRawModelChunks = true`。
- `reasoning.started`、`reasoning.delta`、`reasoning.completed` 仅表示 provider/AI SDK 显式暴露的 reasoning/thinking 内容；默认开启，可通过 `diagnostics.includeReasoning = false` 关闭；当 reasoning 属于当前智能体输出时，应携带同一条消息的 `messageId/messageIndex`。
- `write_plan` 的成功结果通过 `tool.completed.data.data.plan` 承载；HubServer/UI 应选择最后一个成功的 `tool.completed(toolName="write_plan")` 作为当前计划。
- `run_task` 的工具事件只用于追踪与持久化原始 RunEvent，不作为父智能体的模型上下文输入；产品 UI 不应把它渲染为普通工具卡片，应优先展示对应的 `task.*`、子智能体输出和 task summary。

`write_plan` 成功事件示例：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "tool.completed",
  "timestamp": "2026-05-24T00:00:00.000Z",
  "agentId": "orchestrator",
  "toolCallId": "toolu_xxx",
  "toolName": "write_plan",
  "data": {
    "status": "completed",
    "summary": "Plan updated with 1 task(s).",
    "data": {
      "taskCount": 1,
      "plan": {
        "intent": "Inspect the workspace and summarize findings.",
        "summaryInstruction": "Summarize the delegated result for the user.",
        "tasks": [
          {
            "taskId": "task_coder_scan",
            "title": "Inspect workspace",
            "targetAgentId": "coder",
            "instruction": "Inspect the workspace and report one concrete observation.",
            "expectedOutput": "One concise workspace observation.",
            "riskLevel": "low",
            "dependsOn": [],
            "status": "pending"
          }
        ]
      }
    }
  }
}
```

`write_file` 成功事件示例：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "tool.completed",
  "timestamp": "2026-05-25T00:00:00.000Z",
  "agentId": "coder",
  "toolCallId": "toolu_xxx",
  "toolName": "write_file",
  "data": {
    "status": "completed",
    "summary": "Created src/generated.txt",
    "data": {
      "path": "src/generated.txt",
      "size": 24,
      "bytesWritten": 24,
      "created": true,
      "overwritten": false
    }
  }
}
```

`edit_file` 成功事件示例：

```json
{
  "id": "evt_xxx",
  "runId": "run_xxx",
  "type": "tool.completed",
  "timestamp": "2026-05-25T00:00:00.000Z",
  "agentId": "writer",
  "toolCallId": "toolu_xxx",
  "toolName": "edit_file",
  "data": {
    "status": "completed",
    "summary": "Edited docs/intro.md with 1 replacement",
    "data": {
      "path": "docs/intro.md",
      "size": 1204,
      "replacements": 1,
      "changed": true
    }
  }
}
```

### 查询 Run 权限请求

**端点**：`GET /runtime/runs/:runId/permissions`

成功响应：

```json
{
  "permissions": [
    {
      "requestId": "permission_xxx",
      "runId": "run_xxx",
      "agentId": "coder",
      "toolCallId": "toolu_xxx",
      "toolName": "read_file",
      "riskLevel": "medium",
      "status": "pending",
      "reason": "Read an explicitly selected path outside the workspace.",
      "data": {
        "workspaceId": "workspace_conv_123",
        "accessMode": "read",
        "approvalReason": "external_read",
        "logicalPath": "external/selected.txt",
        "targetKind": "file"
      },
      "createdAt": "2026-05-25T00:00:00.000Z"
    }
  ]
}
```

不存在的 Run 返回 `RUN_NOT_FOUND`。

`data.approvalReason` 可为：

- `external_read`：沙箱外普通读取。
- `sensitive_read`：主 workspace 内敏感文件显式读取。
- `external_sensitive_read`：沙箱外敏感文件显式读取；该场景只产生一次 combined approval。
- `external_write`：沙箱外普通写入或编辑。
- `sensitive_write`：主 workspace 内敏感文件写入或编辑。
- `external_sensitive_write`：沙箱外敏感文件写入或编辑；该场景只产生一次 combined approval。
- `network_request`：`web_fetch` 网络请求审批；`data.permissionType = "network_access"`，并包含脱敏后的 `url`、`host` 与 `method`。

权限 API 响应不返回 workspace root 或授权目标的真实绝对路径。批准后的 read/write grant 若出现在响应中，也只返回 `grantId`、`mountId`、`scope`、`accessMode`、`allowSensitive`、`logicalPath` 等脱敏字段。
`web_fetch` 权限请求不返回请求 headers 或 body，URL query 会脱敏。

### `web_fetch` Runtime Tool

`web_fetch` 是 Runtime Tool Catalog 中的网络请求工具：

```ts
type WebFetchInput = {
  url: string
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxResponseBytes?: number
}
```

默认值：`method = "GET"`、`timeoutMs = 15000`、`maxResponseBytes = 1048576`。只允许 `http:` / `https:` 协议；第一版不做域名 allowlist、私网拦截、Cookie jar、multipart builder 或二进制响应解析。

成功输出：

```ts
type WebFetchResult = {
  url: string
  finalUrl: string
  method: string
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string
  truncated: boolean
  bytesRead: number
  durationMs: number
}
```

HTTP 4xx/5xx 仍是 `tool.completed`，由 `statusCode` 表达；网络异常、超时、取消、响应体超过 `maxResponseBytes` 才进入 `tool.failed`。响应 headers 会脱敏 `authorization`、`proxy-authorization`、`cookie`、`set-cookie`、`x-api-key`、`x-auth-token` 与 `api-key`。

### 决定 Run 权限请求

**端点**：`POST /runtime/runs/:runId/permissions/:requestId/decision`

请求体：

```json
{
  "approved": true,
  "reason": "User allowed read access to the selected external file."
}
```

成功响应返回更新后的 permission request。批准沙箱外访问、敏感读取或敏感/外部写入时响应中可包含受控 read/write grant；Runtime 随后在相同 `runId` 与原始 `toolCallId` 上恢复原执行分支。

AI SDK 续跑采用新的生成调用：Runtime 保存原始 response messages，追加 `tool-approval-response` 后再次运行原执行分支，而不是保持原始 HTTP/模型 stream 挂起。若同一 continuation frame 包含多个审批请求，全部决定后只恢复一次。

### 取消 Run

**端点**：`POST /runtime/runs/:runId/cancel`

行为：

- `queued` / `running` / `waiting_approval` Run 会转为 `cancelled` 并输出 `run.cancelled`。
- 等待审批的 Run 被取消时，pending 请求先输出 `permission.cancelled`，之后不再接受决定。
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
