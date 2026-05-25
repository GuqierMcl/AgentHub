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
| `AGENT_INVALID_INPUT` | 400 | Agent 创建或更新请求参数无效 |
| `AGENT_ALREADY_EXISTS` | 409 | Agent ID 已存在，或与系统预设冲突 |
| `AGENT_NOT_EDITABLE` | 403 | 指定 Agent 不允许被当前 API 修改 |
| `AGENT_REGISTRY_UNAVAILABLE` | 503 | Agent 注册表不可用 |
| `AGENT_STORE_WRITE_FAILED` | 500 | Agent 本地配置写入失败 |
| `RUN_INVALID_PARTICIPANTS` | 400 | RunInput 中的会话智能体成员不合法 |
| `RUN_INVALID_ENTRY_AGENT` | 400 | RunInput 无法解析合法入口智能体 |
| `AGENT_MODEL_BINDING_INVALID` | 400 | 智能体模型绑定参数或 provider/model 不可用 |
| `AGENT_MODEL_BINDING_NOT_ALLOWED` | 403 | 当前智能体不允许绑定模型 |
| `MODEL_BINDING_MISSING` | 400 | 智能体未配置模型绑定 |
| `MODEL_PROVIDER_NOT_FOUND` | 404 | 绑定的 provider 不存在 |
| `MODEL_NOT_FOUND` | 404 | 绑定的 model 不存在 |
| `MODEL_DISABLED` | 400 | 绑定的 provider 或 model 已禁用 |
| `MODEL_TOOLS_UNSUPPORTED` | 400 | 绑定的模型不支持工具调用 |
| `MODEL_UNSUPPORTED_PROVIDER` | 400 | provider 协议不受 Runtime 支持 |
| `TOOL_NOT_FOUND` | 404 | 请求的工具不存在 |
| `TOOL_NOT_ALLOWED` | 403 | 当前智能体不允许使用该工具 |
| `TOOL_INVALID_INPUT` | 400 | 工具输入未通过 schema 校验 |
| `TOOL_EXECUTION_FAILED` | 502 | 工具执行失败 |
| `TOOL_EXECUTION_ABORTED` | 499 | 工具执行被取消或中止 |

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
  "allowedTools": ["write_plan", "run_task"],
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
      "requiresApproval": false,
      "permissionEffect": {
        "filesystem": "read"
      }
    },
    {
      "id": "read_file",
      "name": "Read file",
      "description": "Read a text file or image file from the workspace.",
      "category": "workspace",
      "riskLevel": "low",
      "requiresApproval": false,
      "permissionEffect": {
        "filesystem": "read"
      }
    }
  ],
  "capabilityTags": [
    {
      "id": "implementation",
      "name": "Implementation",
      "category": "engineering"
    }
  ],
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
      "deploy": "none",
      "requiresApproval": false
    }
  }
}
```

规则：

- `tools` 只返回用户自定义智能体可配置的非 internal 安全工具集合，代码事实来源是 `USER_AGENT_ALLOWED_TOOLS`。
- `write_plan`、`run_task` 不会出现在 `tools` 中。
- `capabilityTags` 是推荐标签，不是强枚举；创建和更新自定义智能体时 `capabilities` 仍允许自定义字符串。
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
    "deploy": "none",
    "requiresApproval": false
  },
  "enabled": true
}
```

字段规则：

- `id` 可省略；省略时 Runtime 生成 `agent_<uuid>`。
- `id` 只能使用小写字母、数字、下划线和连字符，并且不能与系统预设或现有智能体冲突。
- `allowedSubagents` 只能包含已注册、启用、隐藏的子智能体。
- `allowedTools` 首版只允许 `USER_AGENT_ALLOWED_TOOLS` 中的只读文件工具：`ls`、`read_file`、`glob`、`grep`。
- `write_plan`、`run_task` 和高风险工具不能授予用户自定义智能体。
- `permissionPolicy` 首版限制为低风险：`filesystem` 只允许 `none` 或 `read`，`shell` / `network` / `deploy` 必须为 `none`。
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
    "deploy": "none",
    "requiresApproval": false
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

当前阶段已经包含 `orchestrator` 的最小编排路径：`orchestrator` 可以通过内部 `write_plan` 写入 UI 可渲染计划，再通过内部 `run_task` 调度允许的主智能体或子智能体，并通过 `dependsOn` 表达依赖；无依赖任务可批次并行执行。

`run_task` 的目标边界：

- 如果目标是主智能体，目标必须属于当前 Run 的 `participantAgentIds`，且当前阶段仅 `orchestrator` 可以发起这种委派。
- 如果目标是子智能体，目标必须在发起智能体的 `allowedSubagents` 中。
- Runtime 不再读取 `agent-relations.json`，也不再使用 `AgentRelation` 作为委派依据。

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
tool.started
tool.completed
tool.failed
permission.requested
message.delta
message.completed
agent.completed
run.completed
run.failed
run.cancelled
```

`orchestrator.plan.created` 目前保留为后续可视化和调试的扩展事件；当前 AI SDK orchestrator V1 主路径不强制发送该事件。

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
  data?: unknown
}
```

工具事件的附加约束：

- `tool.started`、`tool.completed`、`tool.failed` 必须携带 `toolCallId` 与 `toolName`。
- `tool.failed` 的 `data` 应尽量包含结构化错误码、错误消息和可调试细节。
- `permission.requested` 用于预留审批流程事件，后续可在高风险工具接入时扩展 `permissionId`、`riskLevel` 和审批结果。
- `write_plan` 的成功结果通过 `tool.completed.data.data.plan` 承载；HubServer/UI 应选择最后一个成功的 `tool.completed(toolName="write_plan")` 作为当前计划。
- `run_task` 的工具事件只用于 UI 与追踪，不作为父智能体的模型上下文输入。

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
