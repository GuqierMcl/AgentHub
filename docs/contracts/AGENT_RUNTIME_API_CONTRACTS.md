# Agent Runtime API 契约

本文档记录 `hub-server` 调用 `agent-runtime` Sidecar 的 Runtime API、Sidecar 生命周期与相关 Run 事件载荷契约。

当前文档还临时包含若干已经接入 Runtime 的 HubServer 产品 API 与过渡代理 API（`/api/*`），用于说明 `web -> hub-server -> agent-runtime` 的端到端契约。新增或大幅扩展浏览器产品 API 时，优先拆到单独的 HubServer API 文档，避免和 Runtime 内部执行 API 继续混杂。

实现核对状态（2026-06-05）：

- Runtime 当前默认监听 `127.0.0.1:4096`，HubServer 通过 `AGENTHUB_RUNTIME_URL` / `--runtime-url` 指向一个已经运行的 Runtime；HubServer 自动拉起 sidecar、重启管理和内部 token 鉴权仍是架构目标，尚未在当前 `hub-server` 入口闭环。
- Runtime `GET /health` 当前返回 `{ status, timestamp, uptime }`，不返回 `version`，也不等待 ProviderService / AgentRegistry 初始化完成才置为 ready。
- Provider 配置 API 当前由 Runtime 以 `/providers`、`/custom-providers`、`/catalog/refresh` 暴露，尚未迁移到 `/runtime/*` 前缀；HubServer 通过 `/api/providers` 等路径代理。
- `GET /runtime/services/status`、`/runtime/settings/model`、Runtime Agents CRUD、Runtime Runs、权限、问题续跑和 workspace revert API 已与当前实现核对并在本文档中记录。

## 进程流向

```text
web -> hub-server -> agent-runtime (Sidecar)
```

架构目标中，生产环境的 `agent-runtime` 是 `hub-server` 的 Sidecar 子进程，由 `hub-server` 在启动时自动拉起。当前实现仍通过 HubServer 配置的 `runtimeUrl` 连接外部已运行 Runtime；sidecar 自动拉起与生命周期管理仍按 `docs/adr/ADR-001-sidecar-architecture.md` 推进。

## 契约规则

- 浏览器侧 API 由 `hub-server` 提供。
- Runtime 执行 API 由 `agent-runtime` 提供。
- `hub-server` 的前端 API 建议使用 `/api/*` 前缀。
- `agent-runtime` 的内部执行 API 建议使用 `/runtime/*` 前缀。
- 当前 Provider 配置 API 是历史例外，仍使用 `/providers`、`/custom-providers`、`/catalog/refresh`，迁移到 `/runtime/providers/*` 前需要同步更新 HubServer 代理和 Web 调用。
- 两个 Hono 服务都应保留 `/health` 健康检查端点。
- 契约载荷应使用明确的 TypeScript 类型。
- 流式事件名称、事件载荷与终止状态必须在实现前或实现时同步记录。
- 错误应尽量使用稳定错误码。
- `agent-runtime` 只输出结构化事件，不直接写业务数据库。
- `hub-server` 负责消费 Runtime 事件，并持久化为消息、Artifact、Diff、部署记录和 Run 状态。
- Hono 相关通用约定见 `docs/reference/HONO.md`。

Runtime 会在每个 Run 开始时捕获一份 `RuntimeEnvironmentSnapshot`，并注入 AI SDK 智能体的 system prompt。该能力是 Runtime 内部模型上下文增强，不改变 `POST /runtime/runs` 请求体、Run 查询响应、SSE RunEvent、HubServer 产品 API 或前端消息协议；快照内容不会作为独立事件发送给前端。

## Sidecar 通信契约

### 启动参数

当前 Runtime CLI 已实现以下命令行参数（配置优先级：命令行参数 > 环境变量 > 默认值）：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--port` / `-p` | number | 否 | Agent Runtime 监听端口，默认 `4096`；环境变量 `PORT` |
| `--hostname` / `-h` | string | 否 | 监听地址，默认 `127.0.0.1`；环境变量 `HOSTNAME` |
| `--cors` | string[] | 否 | 允许的 CORS origin，可多次传入；环境变量 `CORS` 使用逗号分隔 |
| `--data-dir` / `-d` | string | 否 | Runtime 配置数据目录，默认 `./data-tmp`；环境变量 `AGENT_RUNTIME_DATA_DIR` |
| `--workdir` | string | 否 | Runtime 进程级工作目录，默认系统临时目录下的 `agent-runtime-workspace`；环境变量 `AGENT_RUNTIME_WORKDIR` |

当前 Runtime CLI 尚未实现 `--host` 兼容别名、`--hub-callback` 和 `--log-level`。HubServer 当前不会自动构造这些参数启动 Runtime，而是通过 `--runtime-url` / `AGENTHUB_RUNTIME_URL` 指向 Runtime，默认 `http://127.0.0.1:4096`。

### 健康检查

**端点**：`GET /health`

**成功响应** (200 OK)：

```json
{
  "status": "ok",
  "timestamp": "2026-06-05T00:00:00.000Z",
  "uptime": 12345
}
```

HubServer 当前通过该端点判断 Runtime 进程是否可访问：`/api/system/services/status` 会把 `GET /health` 的 2xx 响应投影为 `agent-runtime` 服务 `running`。当前 Runtime 实现不返回 `version`，且 HTTP server 一旦开始监听就返回 `status = "ok"`；ProviderService、AgentRegistry、SystemModelSettingsService 的异步初始化尚未纳入 ready gate。

目标契约仍是：Runtime 只有在关键启动依赖初始化完成后，才应返回 `200` 且 `status = "ok"`；HTTP server 已监听但内部服务仍初始化时，应返回非 200 或 `status = "starting"`，HubServer 不得把该状态视为可接收执行请求。

### Runtime 服务状态快照

**端点**：`GET /runtime/services/status`

本端点只面向 HubServer，用于读取 Runtime 内部可观测服务状态。它不得触发 OpenCode server 启动、Claude Code prompt、外部 Session 创建、模型调用或任何 workspace 写入。

成功响应：

```ts
type RuntimeServiceStatus =
  | "running"
  | "starting"
  | "idle"
  | "error"
  | "not_integrated"
  | "refreshing"

type RuntimeExternalServiceStatusItem = {
  id: "opencode" | "codex" | "claude-code"
  label: string
  kind: "external-agent"
  status: RuntimeServiceStatus
  implemented: boolean
  checkedAt: string
  activeWorkspaceCount?: number
  pendingWorkspaceCount?: number
  details?: Record<string, unknown>
}

type CapabilityDiscoveryStatusItem = {
  id: "capability-discovery"
  label: "Capability Discovery"
  kind: "runtime-capability"
  status: "idle" | "refreshing" | "error"
  implemented: true
  checkedAt: string
  details?: {
    cacheEntryCount: number
    latestRefreshAt?: string
    latestError?: string
    lastRefreshDurationMs?: number
  }
}

type McpRuntimeStatusItem = {
  id: "mcp-runtime"
  label: "MCP Runtime"
  kind: "runtime-capability"
  status: "idle" | "running" | "error"
  implemented: true
  checkedAt: string
  details?: {
    trustedRecordCount: number
    clientCount: number
    connectedServerCount: number
    errorServerCount: number
    toolCount: number
    latestRefreshAt?: string
    latestError?: string
  }
}

type RuntimeServiceStatusItem =
  | RuntimeExternalServiceStatusItem
  | CapabilityDiscoveryStatusItem
  | McpRuntimeStatusItem

type RuntimeServicesStatusResponse = {
  checkedAt: string
  services: RuntimeServiceStatusItem[]
}
```

当前语义：

- `opencode` 已接入，状态来自 Runtime 默认 `ManagedOpenCodeServer` 的只读快照。
- `claude-code` 已接入，状态来自 Claude Agent SDK / executable 配置的只读 readiness 和 Runtime 内存中的非终态 Claude Code Run 摘要；不启动 prompt、不创建 session、不触发 Claude 登录流程。
- `codex` 已接入，状态来自 `@openai/codex-sdk` 只读 readiness 和 Runtime 内存中的非终态 Codex Run 摘要；不创建 thread、不调用 prompt、不触发登录流程。
- `capability-discovery` 已接入，状态来自 Runtime Capability Discovery 进程内缓存和最近一次刷新；`idle` 表示未在刷新，`refreshing` 表示正在重建缓存，`error` 表示最近一次刷新失败。该状态不得触发扫描以外的执行行为。
- `mcp-runtime` 已接入 workspace MCP runtime 快照；`running` 表示 Runtime 内存中已有 connected workspace MCP client / tool cache，`idle` 表示当前没有连接中的 workspace MCP 且没有最新 runtime 错误，`error` 表示最近一次连接、枚举或 trust store 操作出现脱敏错误。`details` 返回 trusted record 数、已缓存 client 数、connected/error server 数和 tool 数。该 `GET /runtime/services/status` 状态查询不得启动 MCP server、连接网络、枚举 tool 或调用 tool。
- OpenCode 的 `idle` 表示就绪且当前无活动 workspace server；`starting` 表示至少一个 workspace server 正在启动；`running` 表示至少一个 workspace server 已连接；`error` 表示最近一次启动或 workspace 校验失败。
- Codex 的 `running` 表示至少一个非终态 Run 正在直接执行或委派执行 `codex`；`idle` 表示 `@openai/codex-sdk` 可用且当前没有 active Codex Run；`error` 表示 SDK package 或只读 readiness 探测失败。`details.activeRunCount` 返回当前非终态 Codex Run 数，`details.clientMode = "sdk"`，`details.version` 在可读取 SDK package 版本时返回。
- Claude Code 的 `running` 表示至少一个非终态 Run 正在直接执行或委派执行 `claude-code`；`idle` 表示 SDK/executable 配置可用且当前没有 active Claude Code Run；`error` 表示后续只读 executable 探测发现阻塞。`details.activeRunCount` 返回当前非终态 Claude Code Run 数；`details.executableSource` 为 `"sdk-bundled"` 或 `"env"`；`AGENTHUB_CLAUDE_CODE_EXECUTABLE` 设置时可在 `details.executablePath` 返回该覆盖路径。
- 响应不得包含 workspace root 真实路径、OpenCode server token、用户 prompt、Claude 凭据、provider 凭据、MCP env/header/token 值或 capability discovery 中解析到的敏感配置值。

HubServer 面向 Web 的服务状态端点为 `GET /api/system/services/status`。它会先调用 Runtime `GET /health` 生成 `agent-runtime` 服务项，再调用 `GET /runtime/services/status` 合并 `opencode`、`codex`、`claude-code`、`capability-discovery` 和 `mcp-runtime`：

```ts
type SystemServiceStatusItem = {
  id: "agent-runtime" | "opencode" | "codex" | "claude-code" | "capability-discovery" | "mcp-runtime"
  label: string
  kind: "runtime" | "external-agent" | "runtime-capability"
  status: RuntimeServiceStatus
  implemented: boolean
  checkedAt: string
  activeWorkspaceCount?: number
  pendingWorkspaceCount?: number
  details?: Record<string, unknown>
}
```

若 Runtime 不可用，HubServer 返回 `agent-runtime.status = "error"`、已实现外部服务（当前 `opencode`、`codex` 与 `claude-code`）、`capability-discovery` 和 `mcp-runtime` 的 `status = "error"` 且 `details.reason = "runtime-unavailable"`；未接入服务保持 `not_integrated` 占位。

### Runtime Skill / MCP Capability Discovery

Capability Discovery 是 Runtime 面向 HubServer 的只读能力目录。第一阶段只扫描和解析本机配置摘要，不执行 Skill、不启动 MCP server、不连接远程 MCP server、不调用 MCP tool、不修改任何 AgentHub、Codex、Claude Code 或 OpenCode 配置。

OpenCode MCP 配置发现兼容官方 JSON / JSONC 入口：全局 `%USERPROFILE%\.config\opencode\opencode.json` / `opencode.jsonc`，workspace/project 根目录 `opencode.json` / `opencode.jsonc`，以及历史兼容的 `.opencode` 配置目录。Runtime 只读解析 OpenCode `mcp` 顶层 server map；local `command` 数组会归一化为 `command` 与脱敏 `args` metadata，不启动进程。

**端点**：`POST /runtime/capabilities/discover`

请求体：

```ts
type RuntimeCapabilityDiscoveryRequest = {
  scope?: "all" | "global" | "workspace"
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  sources?: Array<"agents" | "codex" | "claude-code" | "opencode">
}
```

`scope` 默认 `"all"`。当 `scope = "workspace" | "all"` 时，`workspace` 必填；Runtime 不根据 `workspaceId` 查询 HubServer 状态，也不回退到 `config.workdir`。`sources` 可限制本次发现来源；不传则扫描全部来源。

成功响应：

```ts
type RuntimeCapabilityDiscoveryResponse = {
  discoveredAt: string
  scope: "all" | "global" | "workspace"
  skills: Array<{
    id: string
    name: string
    source: "agents" | "codex" | "claude-code" | "opencode"
    level: "global" | "workspace"
    path: string
    description?: string
    valid: boolean
    warnings: string[]
  }>
  mcps: Array<{
    id: string
    name: string
    source: "agents" | "codex" | "claude-code" | "opencode"
    level: "global" | "workspace"
    configPath: string
    transport?: "stdio" | "sse" | "http" | "unknown"
    command?: string
    args?: string[]
    valid: boolean
    warnings: string[]
  }>
  warnings: string[]
  cache?: {
    hit: boolean
    refreshed: boolean
    cacheKey: string
    expiresAt: string
    fingerprint: string
  }
}
```

`path` 与 `configPath` 是逻辑引用，例如 `global:codex:config.toml` 或 `workspace:agents:my-skill`，不是宿主机绝对路径。MCP `command` 可返回命令名；`args` 会对 token、secret、password、api key、authorization 等敏感值脱敏。响应不返回 env、headers、credential 值、workspace root 或真实 config 绝对路径。`cacheKey` 与 `fingerprint` 必须是逻辑或哈希化标识，不得包含 rootPath、绝对路径或 secret。

缓存语义：

- Runtime 使用进程内缓存，默认 TTL 为 30 秒。
- Cache key 至少包含 `scope`、`sources`、workspace identity 和 workspace root hash。
- Fingerprint 基于候选目录、`SKILL.md` 和 MCP 配置文件的 `mtimeMs + size` 生成；TTL 未过期且 fingerprint 未变化时返回 `cache.hit = true`。
- 缓存 miss、TTL 过期或 fingerprint 变化时自动刷新并返回 `cache.refreshed = true`。

**端点**：`POST /runtime/capabilities/refresh`

请求体与 `POST /runtime/capabilities/discover` 相同。该端点强制重建对应缓存项，成功响应与 discovery response 相同，并满足 `cache.hit = false`、`cache.refreshed = true`。当 `scope = "workspace" | "all"` 且缺少显式 workspace snapshot 时返回 `CAPABILITY_WORKSPACE_REQUIRED`。

**端点**：`GET /runtime/capabilities`

返回 global-only discovery，等价于 `POST /runtime/capabilities/discover` 请求体 `{ "scope": "global" }`。

**HubServer 代理端点**：`GET /api/runtime/capabilities?scope=global|workspace&conversationId=...`

**HubServer 代理端点**：`POST /api/runtime/capabilities/refresh`

- `scope=global` 不需要 `conversationId`。
- `scope=workspace` 可不携带 `conversationId`；未携带时 HubServer 遍历 active conversations，从会话 metadata 中解析 local workspace snapshot，并按 canonical `rootPath` 去重后逐个转发给 Runtime。
- `scope=workspace&conversationId=<id>` 只解析该会话绑定的 workspace root，并返回一个 workspace 分组。
- 浏览器面向 HubServer 的 capability API 只接受 `global` 和 `workspace` 两个产品范围；`scope=all` 不作为 AgentHub Web/API 可见范围，HubServer 返回 `CAPABILITY_INVALID_INPUT`。
- Refresh 代理请求体仅接受 `scope`、`conversationId` 和 `sources`；浏览器不得直接传 `workspace.rootPath`。
- 若选定会话未绑定 workspace、workspace metadata 不完整，或 active conversations 中没有任何可解析 workspace root，HubServer 返回 `WORKSPACE_NOT_RESOLVED`，不让 Runtime 猜测路径。

`scope=global` 响应保持 Runtime flat discovery response。`scope=workspace` 响应由 HubServer 聚合为工作区分组：

```ts
type HubWorkspaceCapabilitiesResponse = {
  discoveredAt: string
  scope: "workspace"
  workspaces: Array<{
    workspaceKey: string
    workspaceId: string
    backendType: "local"
    rootPath: string
    conversationId: string
    conversationIds: string[]
    title: string
    discoveredAt: string
    skills: RuntimeCapabilityDiscoveryResponse["skills"]
    mcps: RuntimeCapabilityDiscoveryResponse["mcps"]
    warnings: string[]
    cache?: RuntimeCapabilityDiscoveryResponse["cache"]
  }>
  warnings: string[]
}
```

`workspaceKey` 是 HubServer 基于 canonical `rootPath` 生成的稳定哈希逻辑 key。`rootPath` 只来自 HubServer 已保存的 conversation workspace metadata，用于 Web 展示和分组；浏览器请求体仍不得提交 rootPath，Runtime discovery response 也不得回显宿主机绝对路径。

### Runtime Workspace Skill Trust

Workspace Skill Trust 是 Runtime 内部 API，用于记录 HubServer 从产品侧转发来的 workspace Skill 显式允许 / 撤销决策。自动发现的 workspace Skill 默认视为 `trusted`；只有保存了显式 `trusted = false` 的撤销记录时，Runtime 才会阻止该 Skill 进入当前 workspace 的内部 prompt assembly。浏览器不得直接调用这些端点，也不得直接传 workspace root 给 Runtime。

```ts
type WorkspaceSkillTrustWorkspace = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

type WorkspaceSkillTrustRecord = {
  workspaceId: string
  backendType: "local"
  workspaceRootHash: string
  skillRef: string // must start with workspace:
  source: "agents" | "codex" | "claude-code" | "opencode"
  trusted: boolean
  status: "trusted" | "untrusted"
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}
```

**端点**：`POST /runtime/workspace-skill-trust/query`

请求体：

```ts
{
  workspace: WorkspaceSkillTrustWorkspace
  skillRefs?: string[]
}
```

成功响应：

```ts
{
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: WorkspaceSkillTrustRecord[]
}
```

`skillRefs` 为空时返回该 workspace root hash 下已保存的 trust records；传入 `skillRefs` 时必须只包含 `workspace:*` Skill refs，未保存的 ref 以合成记录返回：`trusted = true` / `status = "trusted"`，且不伪造用户确认时间。显式撤销记录仍以 `trusted = false` / `status = "untrusted"` 返回并阻止注入。

**端点**：`PUT /runtime/workspace-skill-trust`

请求体：

```ts
{
  workspace: WorkspaceSkillTrustWorkspace
  skillRef: string
  trusted: boolean
  reason?: string
}
```

成功响应：

```ts
{
  record: WorkspaceSkillTrustRecord
}
```

错误码：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `WORKSPACE_SKILL_TRUST_INVALID_INPUT` | 400 | 请求体格式非法 |
| `WORKSPACE_SKILL_TRUST_REF_INVALID` | 400 | `skillRef` 不是合法 `workspace:*` Skill ref |

响应和错误不得返回 `rootPath`、Skill body、真实文件路径、headers、env 或 secret。

**HubServer 代理端点**：`POST /api/runtime/workspace-skill-trust/query`

浏览器请求体：

```ts
{
  conversationId: string
  skillRefs?: string[]
}
```

HubServer 必须从 `conversationId` 解析 local workspace snapshot，再转发 Runtime `POST /runtime/workspace-skill-trust/query`。浏览器请求体必须拒绝 `workspace` / `rootPath` 等本机路径字段。若会话没有绑定 workspace 或 metadata 不完整，返回 `WORKSPACE_NOT_RESOLVED`。

**HubServer 代理端点**：`PUT /api/runtime/workspace-skill-trust`

浏览器请求体：

```ts
{
  conversationId: string
  skillRef: string
  trusted: boolean
  reason?: string
}
```

HubServer 同样只接受 `conversationId`、`skillRef`、`trusted` 和可选 `reason`，并用会话 workspace metadata 组装 Runtime 请求体。响应沿用 Runtime 的 metadata-only shape，不返回 `rootPath`、Skill body 或真实文件路径。

### Runtime MCP Trust

MCP Trust 是 Runtime 内部 API，用于记录 global 与 workspace MCP server 的显式允许 / 撤销决策。自动发现的 MCP server 默认视为 `trusted`；只有保存了显式 `trusted = false` 的撤销记录时，Runtime 后续的 MCP 启用、server 连接、tool 枚举和 tool 注入候选才必须跳过该 MCP server。

Phase 5A 已实现 trust 与状态。当前 Phase 5B-lite / 5C-lite 增加 workspace MCP 最小运行闭环：trusted 且未显式撤销的 workspace MCP server 默认 enabled，并会在 workspace status 查询或内部主智能体 / Orchestrator Run 开始时尝试连接、枚举和动态 tool 注入。Runtime 不修改 AgentHub、Codex、Claude Code 或 OpenCode 配置，也不接管外部 adapter 的 native MCP。Skill / MCP 服务设计见 `docs/architecture/SKILL_MCP_SERVICES.md`。

```ts
type McpTrustScope = "global" | "workspace"

type McpTrustWorkspace = {
  workspaceId: string
  backendType: "local"
  rootPath: string
}

type McpTrustRecord = {
  scope: McpTrustScope
  level: "global" | "workspace"
  workspaceId?: string
  backendType?: "local"
  workspaceRootHash?: string
  mcpRef: string // Capability Discovery mcps[].id
  trusted: boolean
  status: "trusted" | "untrusted"
  trustedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}
```

**端点**：`POST /runtime/mcp-trust/query`

请求体：

```ts
{
  scope: "global" | "workspace"
  workspace?: McpTrustWorkspace
  mcpRefs?: string[]
}
```

成功响应：

```ts
{
  checkedAt: string
  scope: "global" | "workspace"
  workspace?: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  trusts: McpTrustRecord[]
}
```

`scope = "workspace"` 时 `workspace` 必填；Runtime 不通过 `workspaceId` 查询 HubServer，也不回退到 `config.workdir`。`mcpRefs` 为空时返回该 scope 下已保存的 trust records；传入 `mcpRefs` 时，未保存的 ref 以合成记录返回：`trusted = true` / `status = "trusted"`，且不伪造用户确认时间。显式撤销记录仍以 `trusted = false` / `status = "untrusted"` 返回。

**端点**：`PUT /runtime/mcp-trust`

请求体：

```ts
{
  scope: "global" | "workspace"
  workspace?: McpTrustWorkspace
  mcpRef: string
  trusted: boolean
  reason?: string
}
```

成功响应：

```ts
{
  record: McpTrustRecord
}
```

错误码：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `MCP_TRUST_INVALID_INPUT` | 400 | 请求体格式非法 |
| `MCP_TRUST_WORKSPACE_REQUIRED` | 400 | `scope = "workspace"` 但缺少显式 workspace snapshot |
| `MCP_TRUST_REF_INVALID` | 400 | `mcpRef` 不是合法 MCP discovery id |
| `MCP_TRUST_STORE_FAILED` | 500 | MCP trust store 读取或写入失败 |

响应、错误、status details 和持久化文件不得返回或保存 `rootPath`、MCP env、headers、token、secret args、credential 值或 MCP 配置原文。缺失 workspace trust record 默认 trusted，并在当前轻量实现中表示允许进入默认启用、连接、枚举和动态 tool 注入候选；显式 `trusted = false` 会阻止这些行为。

**HubServer 代理端点**：`POST /api/runtime/mcp-trust/query`

浏览器请求体：

```ts
type HubMcpTrustQueryRequest =
  | {
      scope: "global"
      mcpRefs?: string[]
    }
  | {
      scope: "workspace"
      conversationId: string
      mcpRefs?: string[]
    }
```

**HubServer 代理端点**：`PUT /api/runtime/mcp-trust`

浏览器请求体：

```ts
type HubMcpTrustDecisionRequest =
  | {
      scope: "global"
      mcpRef: string
      trusted: boolean
      reason?: string
    }
  | {
      scope: "workspace"
      conversationId: string
      mcpRef: string
      trusted: boolean
      reason?: string
    }
```

`scope = "workspace"` 时，HubServer 必须从 `conversationId` 解析 local workspace snapshot，再转发 Runtime MCP trust API。浏览器请求体必须拒绝 `workspace` / `rootPath` 等本机路径字段；workspace metadata 缺失或不完整时返回 `WORKSPACE_NOT_RESOLVED`。`scope = "global"` 不需要 conversation。当前 Web 插件配置页只为 workspace MCP 展示信任 / 撤销按钮，global MCP 继续只读展示。

### Runtime Workspace MCP Status 与动态工具

**Runtime 端点**：`POST /runtime/mcp/workspace/status`

请求体：

```ts
type RuntimeWorkspaceMcpStatusRequest = {
  workspace: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  connect?: boolean // default true
}
```

`connect = true` 会触发当前 workspace 中 trusted、未撤销 MCP server 的连接和 tool 枚举；`connect = false` 只返回当前内存快照和 discovery metadata，不主动连接。连接或枚举失败只让对应 server 进入 `error`，不会让整个请求失败。

成功响应：

```ts
type RuntimeWorkspaceMcpStatusResponse = {
  checkedAt: string
  workspace: {
    workspaceId: string
    backendType: "local"
    workspaceRootHash: string
  }
  summary: {
    serverCount: number
    enabledCount: number
    connectedCount: number
    errorCount: number
    toolCount: number
  }
  servers: Array<{
    id: string
    name: string
    source: "agents" | "codex" | "claude-code" | "opencode"
    sources: Array<"agents" | "codex" | "claude-code" | "opencode">
    duplicateCount: number
    transport?: "stdio" | "sse" | "http" | "unknown"
    status: "discovered" | "connecting" | "connected" | "disabled" | "error"
    enabled: boolean
    trusted: boolean
    toolCount: number
    latestError?: string
  }>
}
```

响应不返回 `rootPath`、env、headers、token、secret args、credential 值或 MCP 配置原文。`latestError` 必须脱敏并截断。

`servers[]` 是有效 MCP server 列表，而不是 discovery 的 source-specific 原始列表。Runtime 会按 `level + normalized server name` 对同名跨来源 MCP 去重，优先级为 `.agents > codex > claude-code > opencode`；`source` 是实际采用的来源，`sources` 是同一逻辑组内可发现的来源集合，`duplicateCount` 是该逻辑组包含的候选数量。优先来源连接或枚举失败时，Runtime 可以 fallback 到同组下一个 trusted 候选，最终只返回一个有效 server 状态。

错误码：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `MCP_RUNTIME_INVALID_INPUT` | 400 | 请求体格式非法 |
| `MCP_RUNTIME_WORKSPACE_REQUIRED` | 400 | 缺少显式 workspace snapshot |
| `MCP_RUNTIME_CONNECT_FAILED` | 400 / 500 | MCP server 配置不可连接或连接失败 |
| `MCP_RUNTIME_TOOL_CALL_FAILED` | 500 | MCP tool 调用失败 |

Run 执行期，Runtime 只把去重后的动态 MCP tools 注入内部 `executorType = "ai-sdk"` 的可见主智能体和 `orchestrator`。动态工具名使用 `mcp_<server>_<tool>`，冲突时追加短 hash。MCP tool 调用必须通过 Runtime Tool Registry 统一输出 `tool.started`、`tool.completed`、`tool.failed`，事件 `data.externalProvider = "mcp"`。当前轻量实现不做 per-call approval / permission gate，后续必须补 command/network/tool 级审批。

**HubServer 代理端点**：`GET /api/conversations/:conversationId/mcp/status`

HubServer 从 `conversationId` 解析 local workspace snapshot 后转发 Runtime `POST /runtime/mcp/workspace/status`，请求体固定包含 `connect: true`。浏览器不能提交 workspace/rootPath；会话未绑定 workspace 或 metadata 不完整时返回 `WORKSPACE_NOT_RESOLVED`。该端点用于 Web 在聊天输入框下方展示当前会话 workspace MCP server 状态。

### Runtime 系统默认模型设置

系统默认模型设置只由 Agent Runtime 保存，存储文件为 Runtime `--data-dir` 下的 `system-model-settings.json`。HubServer 通过本节端点代理给 Web 设置页，不写入 HubServer 自身 `setting.json`。

存储结构：

```json
{
  "version": 1,
  "systemDefaultModel": {
    "providerId": "openai",
    "modelId": "gpt-5.1"
  }
}
```

响应类型：

```ts
type SystemModelSettingsStatus = "configured" | "unset" | "invalid"

type AgentModelRef = {
  providerId: string
  modelId: string
}

type SystemModelSettingsResponse = {
  status: SystemModelSettingsStatus
  systemDefaultModel?: AgentModelRef
  resolvedModel?: AgentResolvedModelResponse
  invalidReason?: {
    code: string
    message: string
  }
}
```

**端点**：`GET /runtime/settings/model`

返回当前配置。未配置时返回 `{ "status": "unset" }`；已配置且可解析时返回 `status = "configured"`、`systemDefaultModel` 与 `resolvedModel`；配置文件存在但 provider/model 后续失效时返回 `status = "invalid"`、原始 `systemDefaultModel` 与 `invalidReason`。

`invalidReason.code` 来自模型解析校验，当前可能包括 `MODEL_PROVIDER_NOT_FOUND`、`MODEL_DISABLED`、`MODEL_PROVIDER_NOT_CALLABLE`、`MODEL_NOT_FOUND`、`MODEL_TOOLS_UNSUPPORTED`。

**端点**：`PUT /runtime/settings/model`

请求体：

```json
{
  "providerId": "openai",
  "modelId": "gpt-5.1"
}
```

成功响应为 `SystemModelSettingsResponse`。Runtime 必须校验 provider 存在、启用、已配置 API key，model 存在、启用且 `capabilities.supports_tools = true`；校验失败返回：

```json
{
  "error": {
    "code": "SYSTEM_DEFAULT_MODEL_INVALID",
    "message": "Model openai/gpt-x does not support tools",
    "details": {
      "providerId": "openai",
      "modelId": "gpt-x"
    }
  }
}
```

**端点**：`DELETE /runtime/settings/model`

清除系统默认模型，成功响应：

```json
{
  "status": "unset"
}
```

若 Runtime context 中未初始化 `SystemModelSettingsService`，三个端点返回 `SYSTEM_MODEL_SETTINGS_UNAVAILABLE`（503）。当前正常启动路径会注入该 service。

HubServer 面向 Web 的代理端点：

- `GET /api/settings/model` -> `GET /runtime/settings/model`
- `PUT /api/settings/model` -> `PUT /runtime/settings/model`
- `DELETE /api/settings/model` -> `DELETE /runtime/settings/model`

模型选择与降级规则：

- 系统预设主智能体没有模型绑定时使用系统默认模型；用户自定义主智能体没有绑定时仍返回 `MODEL_BINDING_MISSING`。
- 系统智能体与后续内部任务型 Instruct Agent 优先使用系统默认模型；当前 `title` 未配置系统默认模型时保留入口智能体模型继承兼容行为。
- 绑定模型解析失败、provider/model 不可用、`orchestrator` 绑定模型不支持 tools，或 AI SDK stream 在首个用户可见事件前失败时，可降级到系统默认模型一次。
- 首个用户可见事件定义为任意 `message.*`、`tool.*`、`reasoning.*`、`permission.*` 或 `question.*`。一旦发出这些事件，本次执行不再降级。
- 系统默认模型为空、无效或与失败模型相同时不降级；降级模型再次失败时不引入新错误码，沿用 `AgentModelResolutionError` 或普通 `RUN_FAILED` 映射。

### Runtime Provider API

Provider API 当前由 Agent Runtime 托管，但路径仍是历史前缀例外，未放在 `/runtime/*` 下。HubServer 面向浏览器的 `/api/providers*`、`/api/custom-providers*`、`/api/catalog/refresh` 会代理这些 Runtime 端点。

Provider 响应类型：

```ts
type ProviderProtocol = "openai" | "anthropic" | "openai_compatible"

type ModelResponse = {
  id: string
  upstream_id: string
  name: string
  context_length: number
  output_length: number
  capabilities: {
    supports_tools: boolean
    supports_vision: boolean
    supports_reasoning: boolean
    temperature: boolean
  }
  cost: { input: number; output: number }
  source: "preset" | "custom" | string
  enabled: boolean
}

type ProviderSummary = {
  id: string
  name: string
  api_base: string
  enabled: boolean
  source: "preset" | "custom" | string
  has_api_key: boolean
  model_count: number
  api_protocol: ProviderProtocol
}

type ProviderDetail = ProviderSummary & {
  api_key: string | null
  models: Record<string, ModelResponse>
}
```

端点：

| 端点 | 说明 |
| --- | --- |
| `GET /providers?enabled_only=true` | 返回 `{ providers: ProviderSummary[] }` |
| `GET /providers/:id` | 返回 `ProviderDetail` |
| `PUT /providers/:id/config` | 更新 `api_key`、`enabled`、`api_base`，返回 provider 配置摘要 |
| `PUT /providers/:id/models/:model_id/config` | 更新单个 model 的 `enabled`，返回 `ModelResponse` |
| `POST /custom-providers` | 创建自定义 provider，返回 `ProviderDetail`，成功状态 `201` |
| `PUT /custom-providers/:id` | 更新自定义 provider，返回 `ProviderDetail` |
| `DELETE /custom-providers/:id` | 删除自定义 provider，返回 `{ "deleted": true }` |
| `POST /catalog/refresh` | 刷新 models.dev 目录，返回 `{ "status": "refreshed", "provider_count": number }` |

请求体：

```ts
type ProviderConfigUpdateRequest = {
  api_key?: string
  enabled?: boolean
  api_base?: string
}

type ModelConfigUpdateRequest = {
  enabled: boolean
}

type CustomProviderCreateRequest = {
  id: string
  name: string
  api_base: string
  api_key?: string
  models?: Record<string, {
    name?: string
    upstream_id?: string
    context_length?: number
    supports_tools?: boolean
    supports_vision?: boolean
  }>
}

type CustomProviderUpdateRequest = Omit<Partial<CustomProviderCreateRequest>, "id">
```

当前 Provider API 错误响应仍是早期形态，例如 `{ "error": "Provider openai not found" }` 或 `{ "error": "Invalid request body", "details": [...] }`，尚未统一为 `{ error: { code, message, details } }`。迁移 Provider API 前，应先同步 Runtime router、HubServer `RuntimeClient` 错误映射和 Web provider API 调用。

### 内部调用鉴权

目标契约：HubServer 调用 Agent Runtime 的 `/runtime/*` 端点时，应携带内部服务凭证。MVP 阶段使用每次 HubServer 启动生成的随机共享密钥：

- HubServer 通过环境变量向 Runtime 传递 token，例如 `AGENTHUB_RUNTIME_TOKEN`。
- HubServer 调用 Runtime 时携带请求头 `x-agenthub-runtime-token`。
- Runtime 检测到 token 后必须校验该请求头；缺失或错误时返回 401/403。
- 开发环境未设置 token 时可跳过校验。
- `/health` 是否要求 token 可由实现决定，但不得泄露敏感信息。

当前实现尚未落地该鉴权链路：HubServer `RuntimeClient.forward()` 不注入 `x-agenthub-runtime-token`，Runtime 入口也没有读取 `AGENTHUB_RUNTIME_TOKEN` 或校验 `/runtime/*` 请求的中间件。部署时必须依赖本机监听地址、进程边界和外层网络隔离，不能假设 token 已生效。

后续可升级为更安全的鉴权机制，例如命名管道、Unix socket、mTLS 或本机进程认证。

### 错误码约定

| 错误码 | HTTP Status / 场景 | 说明 |
| --- | --- | --- |
| `RUNTIME_NOT_READY` | 503 | Agent Runtime 尚未就绪 |
| `CAPABILITY_INVALID_INPUT` | 400 | Capability discovery 请求参数无效 |
| `CAPABILITY_WORKSPACE_REQUIRED` | 400 | Runtime workspace/all discovery 缺少显式 workspace snapshot |
| `MCP_TRUST_INVALID_INPUT` | 400 | MCP trust 请求参数无效 |
| `MCP_TRUST_WORKSPACE_REQUIRED` | 400 | workspace MCP trust 缺少显式 workspace snapshot |
| `MCP_TRUST_REF_INVALID` | 400 | `mcpRef` 不是合法 MCP discovery id |
| `MCP_TRUST_STORE_FAILED` | 500 | MCP trust store 读取或写入失败 |
| `MCP_RUNTIME_INVALID_INPUT` | 400 | MCP runtime status 请求参数无效 |
| `MCP_RUNTIME_WORKSPACE_REQUIRED` | 400 | workspace MCP status 缺少显式 workspace snapshot |
| `MCP_RUNTIME_CONNECT_FAILED` | 400 / 500 | MCP server 配置不可连接或连接失败 |
| `MCP_RUNTIME_TOOL_CALL_FAILED` | 500 | MCP tool 调用失败 |
| `WORKSPACE_NOT_RESOLVED` | 400 | HubServer 无法从 conversation 解析 workspace snapshot |
| `RUN_INVALID_INPUT` | 400 | 请求参数校验失败 |
| `RUN_INVALID_WORKSPACE` | 400 | RunInput.workspace 无效，例如本地目录不存在或不是目录 |
| `RUN_NOT_FOUND` | 404 | 指定的 Run 不存在 |
| `RUN_ALREADY_ACTIVE` | 409 | 同一会话已有非终态 Run，当前阶段不允许并发发送 |
| `RUN_TIMEOUT` | 504 | Run 执行超时 |
| `ADAPTER_CONFIG_MISSING` | 500 | 外部智能体缺少 adapter 配置 |
| `ADAPTER_NOT_AVAILABLE` | 503 | 外部 adapter 未注册或不可用 |
| `ADAPTER_WORKSPACE_REQUIRED` | 400 | 外部 adapter 需要绑定 workspace |
| `ADAPTER_SERVER_START_FAILED` | 502 | 外部 agent server / CLI 启动失败 |
| `ADAPTER_SERVER_UNHEALTHY` | 502 | 外部 agent server 启动后健康检查失败或超时 |
| `ADAPTER_WORKSPACE_MISMATCH` | 409 | 外部 agent 当前 Project/path 与 AgentHub workspace 不一致 |
| `ADAPTER_SESSION_FAILED` | 502 | 外部 agent session 查找或创建失败 |
| `ADAPTER_PROMPT_FAILED` | 502 | 外部 agent prompt 执行失败 |
| `ADAPTER_ABORT_FAILED` | 502 | 外部 agent abort/cancel 回写失败 |
| `ADAPTER_PERMISSION_FAILED` | 502 | 外部 agent 权限桥接不可用或权限请求无法进入 AgentHub 审批链路 |
| `ADAPTER_PERMISSION_REPLY_FAILED` | 502 | 外部 agent 权限决定回写失败 |
| `ADAPTER_PERMISSION_CANCELLED` | 499 | 外部 agent pending 权限请求被 Run 取消 |
| `ADAPTER_EXECUTION_FAILED` | 502 | 外部 adapter 未分类执行失败 |
| `AGENT_NOT_FOUND` | 404 | 指定的 Agent 不存在，或隐藏 Agent 未授权查看 |
| `AGENT_INVALID_FILTER` | 400 | Agent 查询参数无效 |
| `AGENT_INVALID_INPUT` | 400 | Agent 创建或更新请求参数无效 |
| `AGENT_ALREADY_EXISTS` | 409 | Agent ID 已存在，或与系统预设冲突 |
| `AGENT_NOT_EDITABLE` | 403 | 指定 Agent 不允许被当前 API 修改 |
| `AGENT_REGISTRY_UNAVAILABLE` | 503 | Agent 注册表不可用 |
| `AGENT_STORE_WRITE_FAILED` | 500 | Agent 本地配置写入失败 |
| `RUN_INVALID_PARTICIPANTS` | 400 | RunInput 中的会话智能体成员不合法 |
| `RUN_INVALID_ENTRY_AGENT` | 400 | RunInput 无法解析合法入口智能体 |
| `TASK_SOURCE_CANNOT_DELEGATE` | RunEvent | 发起任务委派的智能体不具备委派能力 |
| `TASK_TARGET_NOT_FOUND` | RunEvent | `run_task` 目标智能体不存在 |
| `TASK_TARGET_DISABLED` | RunEvent | `run_task` 目标智能体已禁用 |
| `TASK_TARGET_NOT_ALLOWED` | RunEvent | `run_task` 目标不在当前 participants 或 allowedSubagents 范围内 |
| `TASK_DEPENDENCY_FAILED` | RunEvent | 任务依赖失败，当前任务不能继续 |
| `TASK_DEPENDENCY_CYCLE` | RunEvent | 任务依赖形成环 |
| `TASK_FILE_LOCK_WORKSPACE_NOT_BOUND` | RunEvent | `run_task.lockPaths` 非空，但当前 Run 未绑定 workspace |
| `TASK_FILE_LOCK_CONFLICT` | RunEvent | `run_task.lockPaths` 中至少一个文件已被其他 active delegated task 锁定 |
| `TASK_EXECUTION_ABORTED` | RunEvent | 任务执行被取消 |
| `TASK_EXECUTION_FAILED` | RunEvent | 任务执行发生未分类失败 |
| `AGENT_MODEL_BINDING_INVALID` | 400 | 智能体模型绑定参数或 provider/model 不可用 |
| `AGENT_MODEL_BINDING_NOT_ALLOWED` | 403 | 当前智能体不允许绑定模型 |
| `SYSTEM_DEFAULT_MODEL_INVALID` | 400 | 系统默认模型参数无效，或 provider/model 不可调用、未启用、不支持 tools |
| `SYSTEM_MODEL_SETTINGS_UNAVAILABLE` | 503 | Runtime 未初始化系统默认模型设置服务 |
| `PERMISSION_INVALID_INPUT` | 400 | 权限决定请求体无效 |
| `PERMISSION_NOT_FOUND` | 404 | 指定的权限请求不存在 |
| `PERMISSION_ALREADY_RESOLVED` | 409 | 权限请求已经决定或取消 |
| `PERMISSION_RUN_NOT_ACTIVE` | 409 | Run 已非等待审批状态，不能恢复 |
| `PERMISSION_GRANT_FAILED` | 409 | 无法为已批准请求创建受控访问授权 |
| `MODEL_BINDING_MISSING` | 400 | 智能体未配置模型绑定 |
| `MODEL_PROVIDER_NOT_FOUND` | 404 | 绑定的 provider 不存在 |
| `MODEL_PROVIDER_NOT_CALLABLE` | 400 | provider 缺少 API key，不能作为系统默认模型调用 |
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
| `WORKSPACE_EXTERNAL_ACCESS_PENDING_APPROVAL` | 工具结果 | 沙箱外或敏感 workspace 访问已进入审批等待 |
| `WORKSPACE_PATH_NOT_FOUND` | 工具结果 / 404 | workspace 路径不存在，或绑定 workspace root 已不可用 |
| `WORKSPACE_PATH_OUTSIDE_ROOT` | 工具结果 | 请求路径越过绑定 workspace 根目录 |
| `WORKSPACE_NOT_A_DIRECTORY` | 工具结果 | 请求的 workspace 路径不是目录 |
| `WORKSPACE_UNSUPPORTED_OPERATION` | 工具结果 | 当前 workspace backend 不支持请求的写入/编辑操作 |
| `BASH_COMMAND_DENIED` | 403 | `bash` 命令被命令级权限规则拒绝 |
| `BASH_INVALID_CWD` | 400 | `bash` 的 `cwd` 不是 workspace-relative 路径 |
| `BASH_TIMEOUT` | 504 | `bash` 命令超时 |
| `BASH_SPAWN_FAILED` | 502 | `bash` 底层 shell 进程启动失败 |
| `BASH_OUTPUT_TOO_LARGE` | 413 | `bash` 输出超过内部缓冲保护上限 |
| `BASH_EXECUTION_FAILED` | 502 | `bash` 执行层发生非预期失败 |
| `NETWORK_INVALID_URL` | 400 | `web_fetch` URL 无效 |
| `NETWORK_UNSUPPORTED_PROTOCOL` | 400 | `web_fetch` URL 协议不是 `http:` 或 `https:` |
| `NETWORK_TIMEOUT` | 504 | `web_fetch` 请求超时 |
| `NETWORK_REQUEST_FAILED` | 502 | `web_fetch` 网络请求失败 |
| `NETWORK_RESPONSE_TOO_LARGE` | 413 | `web_fetch` 响应体超过 `maxResponseBytes` |
| `QUESTION_INVALID_INPUT` | 400 | `question` 输入或答案未通过校验 |
| `QUESTION_NOT_FOUND` | 404 | 指定的 question request 或 Run 不存在 |
| `QUESTION_RUN_NOT_ACTIVE` | 409 | Run 当前没有可续跑的 question continuation |
| `QUESTION_ALREADY_ANSWERED` | 409 | 指定 question request 已经回答或取消 |
| `QUESTION_CANCELLED` | RunEvent | 等待用户回答的 question 因 Run cancel 被取消 |
| `QUESTION_DEFERRED_TOOL` | 工具结果 | `question` 是 deferred 工具，不能通过普通 execute 直接执行 |
| `WORKSPACE_NOT_BOUND` | 400 | 当前 Run 未绑定 workspace，不能执行文件工具 |
| `VALIDATION_ERROR` | 400 | HubServer 产品 API 请求体验证失败 |
| `WORKSPACE_INVALID_INPUT` | 400 | HubServer workspace 文件保存请求缺少必要字段或类型不正确 |
| `WORKSPACE_INVALID_PATH` | 400 | HubServer workspace 请求路径类型不符合端点要求 |
| `WORKSPACE_ACCESS_DENIED` | 403 | HubServer workspace 请求试图访问工作区外部路径 |
| `PIN_LIMIT_EXCEEDED` | 400 | 单会话置顶消息数量超过上限（10 条） |
| `PIN_ALREADY_EXISTS` | 409 | 该消息已置顶 |
| `PIN_NOT_FOUND` | 404 | 指定的置顶记录不存在 |
| `WORKSPACE_REVERT_INVALID_INPUT` | 400 | Runtime workspace revert 请求缺少本地 workspace 或 source patch 信息 |
| `WORKSPACE_REVERT_APPLY_FAILED` | 502 | Runtime 执行 `git apply --reverse` 失败 |
| `ARTIFACT_REVERT_NOT_FOUND` | 404 | HubServer conversation-scoped Diff Artifact 或关联 Run 不存在 |
| `ARTIFACT_REVERT_UNSUPPORTED` | 400 | Artifact 不是可撤销的 Diff、缺少版本、缺少 workspace 或是撤销记录本身 |
| `ARTIFACT_REVERT_NOT_RELIABLE` | 400 | Diff baseline dirty、runOnlyReliable=false 或 patch 不满足安全撤销条件 |
| `ARTIFACT_REVERT_ALREADY_APPLIED` | 409 | 同一 Diff Artifact 已经成功撤销 |
| `ARTIFACT_REVERT_BLOCKED` | 409 | 当前 workspace 状态无法通过反向 patch 校验，未执行撤销 |

## Runtime Run Input 契约

### `POST /runtime/runs` 请求体

HubServer 创建 Run 时，向 Agent Runtime 发送 `RunInput`。当前实现的请求体字段如下；Zod schema 中带 default 的字段可由调用方省略，由 Runtime 归一化后进入执行态。

```ts
type RuntimeMessage = {
  id?: string
  role: "user" | "assistant" | "system"
  agentId?: string
  content: string
}

type PinnedMessage = {
  id: string              // pin ID
  messageId: string       // 原始消息 ID
  content: string         // 消息文本内容（可能已截断，最长 2000 字符）
  note?: string | null    // 用户备注
  pinnedAt: string        // 置顶时间 ISO 8601
  sortOrder: number       // 排序权重
}

type RunInput = {
  conversationId: string
  mode: "single" | "group"
  participantAgentIds: string[]
  addressedAgentIds?: string[]
  userMessage: RuntimeMessage & { role: "user" }
  history?: RuntimeMessage[]
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  diagnostics?: {
    includeModelStream?: boolean
    includeReasoning?: boolean
    includeRawModelChunks?: boolean
    includeSkillDiagnostics?: boolean
  }
  conversationState?: {
    messageCountBeforeRun?: number
    titleSource?: "default" | "auto" | "manual"
    titleSeedUserMessage?: string
  }
  externalSessionHints?: ExternalSessionHint[]
  externalContext?: ExternalContextPacket[]
  pinnedMessages?: PinnedMessage[]
}
```

**行为规则**：
- `pinnedMessages` 为可选字段，不影响现有 Runtime 兼容性
- Agent Runtime 在内部 AI SDK 主智能体与 Orchestrator 的 system prompt 中注入 pinned 消息
- 注入格式使用 XML 标记 `<📌 置顶消息 (Pinned Messages)>` 包裹
- 单条内容超过 2000 字符时由 HubServer 截断
- `history` 省略时默认为空数组；Runtime 不从 HubServer 数据库自行读取历史。
- `workspace.rootPath` 只在请求体内由 HubServer 传给 Runtime 建立 workspace session；Run 查询响应只回显 `workspaceId`、`backendType` 与 `rootLabel`。
- 真实聊天主路径中，HubServer 从 `/api/settings/diagnostics` 保存的“输出设置”读取当前值，并在每次创建 Runtime Run 时写入 `diagnostics`。浏览器的 `/api/conversations/:conversationId/messages/send` 与 regenerate 请求不直接携带 `diagnostics`。
- `diagnostics.includeSkillDiagnostics = true` 时，Runtime 可以输出 metadata-only `agent.skill_context.resolved` 事件，说明本次执行解析到哪些 Skill。该事件不得包含 Skill 正文、真实文件路径、workspace root、env、headers 或 secret。
- `externalSessionHints` 由 HubServer 为已支持的外部 direct session 注入；当前支持 `provider = "opencode"`、`"claude-code"` 与 `"codex"`。Runtime adapter 可用该 hint 恢复 provider session，例如 Claude Code 通过 SDK `resume`、Codex 通过 SDK `resumeThread(threadId)` 传入可恢复的 provider session id。
- `externalContext` 由 HubServer 为外部 direct run 注入 provider-aware visible context packet；当前支持 OpenCode、Claude Code 与 Codex。packet 只包含用户可见消息和 delegated handoff summary，不包含 raw RunEvent、reasoning、内部工具续跑消息或 Orchestrator 私有计划。

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
  "allowedTools": ["write_plan", "run_task", "web_fetch", "bash", "question"],
  "allowedSkills": [],
  "permissionPolicy": {
    "filesystem": "none",
    "shell": "limited",
    "network": "full",
    "deploy": "none"
  },
  "toolPermissionRules": {
    "bash": {
      "*": "ask",
      "pwd": "allow",
      "pwd *": "allow",
      "rm *": "deny"
    }
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
    "configDirectoryPolicy": "user-global"
  }
}
```

`provider` 当前可为 `"opencode"` 或 `"claude-code"`。OpenCode V1 使用用户本机 OpenCode 配置；Claude Code V1 使用用户本机 Claude Code 登录、账号、计费和全局配置。AgentHub 不通过本 API 配置外部平台的模型供应商、Skill、MCP、plugin、hook 或命令。更完整的外部 Session、Project、上下文和权限桥接设计见 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`、`docs/external_agents/OPENCODE_ADAPTER.md` 与 `docs/external_agents/CLAUDE_CODE_ADAPTER.md`。

如果智能体配置了 `modelRef`，列表和详情都可以透出该绑定；`resolvedModel` 仅在 provider 与 model 都可解析时返回，否则为空。

用户自定义智能体详情会额外返回 `systemPrompt`，用于编辑表单回显；系统预设智能体和外部智能体不会通过详情接口返回内部提示词。

`allowedSkills` 是 Runtime Skill 注入配置，值为 Capability Discovery 返回的逻辑 Skill ref / id，例如 `global:agents:review`、`global:codex:.system:openai-docs` 或 `workspace:agents:local-review`。该字段不会返回 Skill 正文。`allowedSkills` 可以包含 `global:*` 和 `workspace:*` refs。Runtime 直接注入可解析的 `global:*` refs；`workspace:*` refs 只有在当前 Run 绑定 workspace 且 Workspace Skill Trust 未保存显式撤销记录时才注入。缺失 trust record 表示默认 trusted。默认 `orchestrator` 还会在绑定 workspace 时自动选择当前 workspace 中可发现、有效、未撤销的 workspace Skill，即使其 preset `allowedSkills` 为空。外部智能体不消费该字段。

### 当前默认工具与权限矩阵

`permissionPolicy` 与当前预设智能体实现是分层生效的，不是单独决定工具能否执行：

1. `allowedTools` 决定模型是否能看到并调用某个 Runtime Tool。
2. `permissionPolicy` 必须覆盖该工具的 `requiredPermissions`，否则 Runtime Tool Registry 返回 `TOOL_PERMISSION_DENIED`。
3. 工具自身的 `approvalPolicy` / `prepareExecution` / `prepareApproval` 再决定是否直接执行、请求审批或拒绝。

当前 `bash` 工具已经接入这三层权限链路：工具定义为 `requiredPermissions = { shell: "limited" }`、`approvalPolicy = "contextual"`、`configurableByUserAgent = false`；系统预设主智能体若在 `allowedTools` 中包含 `bash` 且 `permissionPolicy.shell = "limited"`，会继续按 `toolPermissionRules.bash` 的命令级规则执行 `allow | ask | deny`。`ask` 会产生 `permission.requested`，批准后用同一个 `runId + toolCallId` 继续执行；`deny` 在 `tool.started` 前返回 `BASH_COMMAND_DENIED`。

当前预设默认值：

| Agent | `allowedTools` 摘要 | `permissionPolicy` 摘要 | `bash` 状态 |
| --- | --- | --- | --- |
| `orchestrator` | `write_plan`、`run_task`、`web_fetch`、`bash`，并隐式注入 `question` | `filesystem=none`、`shell=limited`、`network=full`、`deploy=none` | 已开放，受 `toolPermissionRules.bash` 控制 |
| `coder` | workspace 读写工具、`web_fetch`、`bash`，并隐式注入 `question` | `filesystem=write`、`shell=limited`、`network=full`、`deploy=none` | 已开放，受 `toolPermissionRules.bash` 控制 |
| `reviewer` | workspace 只读工具、`web_fetch`、`bash`，并隐式注入 `question` | `filesystem=read`、`shell=limited`、`network=full`、`deploy=none` | 已开放，受 `toolPermissionRules.bash` 控制 |
| `writer` | workspace 读写工具、`web_fetch`、`bash`，并隐式注入 `question` | `filesystem=write`、`shell=limited`、`network=full`、`deploy=none` | 已开放，受 `toolPermissionRules.bash` 控制 |
| `planner` | workspace 只读工具、`web_fetch`、`bash`，并隐式注入 `question` | `filesystem=read`、`shell=limited`、`network=full`、`deploy=none` | 已开放，受 `toolPermissionRules.bash` 控制 |
| `opencode` | 无 Runtime Tool 注入 | `filesystem=write`、`shell=limited`、`network=full`、`deploy=none` | 不注入 Runtime `bash`；外部工具由 OpenCode adapter 映射 |
| `claude-code` | 无 Runtime Tool 注入 | `filesystem=write`、`shell=limited`、`network=full`、`deploy=none` | 不注入 Runtime `bash`；外部工具由 Claude Code adapter 映射，普通 `canUseTool` 权限请求桥接到 AgentHub `permission.*`，`AskUserQuestion` 走 `question.*` |
| `explore` 子智能体 | workspace 只读工具，并隐式注入 `question` | `filesystem=read`、`shell=none`、`network=none`、`deploy=none` | 未开放 |
| `general` 子智能体 | 仅隐式 `question` | `filesystem=none`、`shell=none`、`network=none`、`deploy=none` | 未开放 |
| `file` 子智能体 | workspace 读写工具，并隐式注入 `question` | `filesystem=write`、`shell=none`、`network=none`、`deploy=none` | 未开放 |
| `deploy` 子智能体 | 仅隐式 `question` | `filesystem=read`、`shell=limited`、`network=limited`、`deploy=publish` | 当前未把 `bash` 加入 `allowedTools`，所以仍不可调用 |

用户自定义智能体是另一条限制：当前 CRUD 只允许选择 Tool Catalog 中 `configurableByUserAgent = true` 的非 internal workspace 工具，并强制 `permissionPolicy.shell/network/deploy = "none"`；因此用户自定义智能体不能通过本版 CRUD 获得 `bash`、`web_fetch`、`write_plan` 或 `run_task`。这不表示 `bash` 权限未实现，而是当前产品 authoring 范围刻意不开放 shell。

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
      "id": "glob",
      "name": "Glob",
      "description": "通过 glob 模式查找工作区中的文件和目录。",
      "category": "workspace",
      "riskLevel": "low",
      "approvalPolicy": "contextual",
      "requiredPermissions": {
        "filesystem": "read"
      }
    },
    {
      "id": "grep",
      "name": "Grep",
      "description": "在工作区路径的文件和目录中搜索文本。",
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
  "capabilityTags": [
    "Implementation",
    "Review",
    "Documentation",
    "Planning",
    "Research",
    "Summarization",
    "Rewrite",
    "Codebase Scan",
    "Thinking"
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
      "deploy": "none"
    }
  }
}
```

规则：

- `tools` 从注册工具的 Tool Catalog 投影，只返回 `configurableByUserAgent = true` 且非 internal 的工具；不在路由或 CRUD 中维护重复白名单。
- 当前用户可配置工具为 `ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`。
- `write_plan`、`run_task`、`web_fetch`、`bash`、`question` 不会出现在 `tools` 中；其中 `question` 会对内部 AI SDK 智能体隐式可见，AgentRegistry 返回内部 AI SDK agent 时会自动注入到 `allowedTools`。
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
  "allowedSkills": ["global:agents:writing-style"],
  "permissionPolicy": {
    "filesystem": "read",
    "shell": "none",
    "network": "none",
    "deploy": "none"
  },
  "enabled": true,
  "toolPermissionRules": {}
}
```

字段规则：

- `id` 可省略；省略时 Runtime 生成 `agent_<uuid>`。显式传入时长度为 3-64，必须以小写字母开头，且只能使用小写字母、数字、下划线和连字符，并且不能与系统预设或现有智能体冲突。
- `name` 长度 1-120，`description` 长度 1-1000，`systemPrompt` 长度 1-20000，单个 `capabilities` 字符串最长 80。
- `allowedSubagents` 只能包含已注册、启用、隐藏的子智能体。
- `allowedTools` 只允许 Tool Catalog 暴露为用户可配置的文件工具：`ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`。如果客户端 round-trip 了 detail response 中的隐式 `question`，Runtime 会忽略该输入项并在响应中重新注入。
- `allowedSkills` 允许引用 Capability Discovery 可发现的 `global:*` 或 `workspace:*` Skill 逻辑 ref。Runtime 只在当前 Run 绑定 workspace 且 Workspace Skill Trust 没有针对精确 `{ workspaceId, rootPath hash, skillRef }` 的显式撤销记录时注入 `workspace:*` 正文；缺失记录默认 trusted。
- `write_plan`、`run_task`、`web_fetch`、`bash` 和其他高风险工具不能授予用户自定义智能体；`question` 是隐式 interaction tool，不通过 CRUD 授权。
- `toolPermissionRules.bash` 暂不允许用户自定义智能体配置；非空对象返回 `AGENT_INVALID_INPUT`。
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
  "allowedSkills": ["global:codex:.system:openai-docs"],
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
- `allowedSkills` 更新语义与 create 相同：去重、去空白，允许 `global:*` 与 `workspace:*` Skill ref；workspace Skill 注入仍由 Workspace Skill Trust 的默认 trusted / 显式撤销语义决定。
- 系统预设智能体、外部智能体和隐藏子智能体返回 `AGENT_NOT_EDITABLE`。
- 成功响应返回更新后的 agent detail。

### 删除用户自定义智能体

**端点**：`DELETE /runtime/agents/:agentId`

规则：

- 只能删除用户自定义主智能体。
- 删除时同步清理该智能体的模型绑定覆盖。
- 不清理历史 Run 或消息；这些业务数据后续由 HubServer 负责。
- HubServer 代理端点 `DELETE /api/runtime/agents/:agentId` 在转发 Runtime 删除前，会归档包含该 agent 的会话，避免会话继续引用已删除的用户智能体；Runtime 内部端点本身不处理 HubServer 业务数据。

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

### 外部智能体 SDK runtime settings

外部智能体 SDK runtime settings 是 AgentHub 自有的运行时覆盖层，只作用于 AgentHub-originated runs。它不是外部平台配置管理：Runtime 不得通过该 API 写入 OpenCode、Claude Code 或 Codex 的全局配置、凭据、Skill、MCP、plugin、hook、command 或 provider 文件。外部智能体仍不使用 `PUT /runtime/agents/:agentId/model` 的内部模型绑定；OpenCode 的模型候选来自 OpenCode SDK workspace model catalog，不来自 AgentHub ProviderService。

```ts
type RuntimeExternalAgentSettings =
  | {
      provider: "opencode"
      model?: { providerID: string; modelID: string }
      executionAgent?: "build" | "plan"
    }
  | {
      provider: "claude-code"
      model?: string
      permissionMode?: "default" | "acceptEdits" | "plan" | "dontAsk" | "auto"
    }
  | {
      provider: "codex"
      model?: string
    }

type RuntimeExternalAgentSettingsResponse = {
  agentId: "opencode" | "claude-code" | "codex"
  settings: RuntimeExternalAgentSettings
  updatedAt?: string
}

type HubOpenCodeExternalSettingsPutRequest =
  | {
      provider: "opencode"
      executionAgent?: "build" | "plan"
    }
  | {
      settings: {
        provider: "opencode"
        model?: { providerID: string; modelID: string }
        executionAgent?: "build" | "plan"
      }
      conversationId: string
    }

type RuntimeOpenCodeModelCatalogRequest = {
  workspace: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
}

type HubOpenCodeModelCatalogRequest = {
  conversationId: string
}

type RuntimeOpenCodeModelCatalogResponse = {
  provider: "opencode"
  models: Array<{
    providerID: string
    providerName?: string
    modelID: string
    modelName?: string
  }>
  warnings: string[]
}
```

**Runtime 端点**：

```text
GET /runtime/agents/:agentId/external-settings
PUT /runtime/agents/:agentId/external-settings
POST /runtime/agents/opencode/model-catalog
```

**HubServer 代理端点**：

```text
GET /api/runtime/agents/:agentId/external-settings
PUT /api/runtime/agents/:agentId/external-settings
POST /api/runtime/agents/opencode/model-catalog
```

规则：

- `:agentId` 只能是 `opencode`、`claude-code` 或 `codex`，且请求体 `provider` 必须与目标外部智能体一致。
- HubServer `PUT /api/runtime/agents/:agentId/external-settings` 对非 OpenCode 外部智能体保持普通代理语义：浏览器请求体就是 external settings 对象，HubServer 完成 JSON 解析后原样转发 Runtime。
- HubServer `PUT /api/runtime/agents/opencode/external-settings` 只允许浏览器提交不含 `model` 的直接 settings（用于 SDK 默认模型和 `executionAgent`），或在包含模型覆盖时提交 `{ settings, conversationId }`。HubServer 不得把 `conversationId` 转发给 Runtime。
- OpenCode settings PUT 中浏览器不得提交 `workspace`、`rootPath`、`workspaceRootPath`、`cwd` 等本机路径字段；HubServer 必须以稳定 400（当前 `AGENT_INVALID_INPUT`）拒绝，且不得转发 Runtime。
- OpenCode settings PUT 中如果 `settings.model` 存在，HubServer 必须要求非空 `conversationId`，从该会话解析 workspace snapshot，调用 Runtime `POST /runtime/agents/opencode/model-catalog` 读取 workspace catalog，并确认 `{ providerID, modelID }` 存在于 `catalog.models`。不存在时返回 400 `OPENCODE_MODEL_NOT_IN_CATALOG`，不得转发 settings update；存在时只转发 sanitized `RuntimeExternalAgentSettings` 到 `PUT /runtime/agents/opencode/external-settings`。
- `claude-code.permissionMode` 允许 `default`、`acceptEdits`、`plan`、`dontAsk` 和 `auto`，但该 allowlist 不表示所有模式风险相同；`acceptEdits` 和 `auto` 必须在 UI 和诊断元数据中以非默认自动化权限模式展示。`bypassPermissions` 不允许；该模式需要危险权限跳过开关，后续如需开放必须单独设计审批和风险提示。
- `codex` 本阶段只接受 `model`，不接受 sandbox、approval、reasoning、web search、auth 或 app-server experimental 配置。
- Runtime `POST /runtime/agents/opencode/model-catalog` 接受 `RuntimeOpenCodeModelCatalogRequest`；HubServer `POST /api/runtime/agents/opencode/model-catalog` 只接受 `HubOpenCodeModelCatalogRequest`，不得接受浏览器提交的 `workspace.rootPath`。HubServer 必须从会话 workspace metadata 解析 local workspace snapshot 后再转发 Runtime。
- Runtime 和 HubServer 响应不得包含 OpenCode / Claude Code / Codex 凭据、token、headers、env、外部平台配置正文或未脱敏的 workspace root，除非该端点明确是 HubServer 面向 Web 的已绑定 workspace 展示语义。

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
- 会话列表按置顶优先排序；置顶会话按 `pinnedAt desc`，未置顶会话按活跃时间 `lastMessageAt ?? createdAt desc` 排序，因此新建空会话会默认出现在置顶会话之后、其他未置顶会话之前。
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
  | "service.status.changed"

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
- Service status payload 至少包含 `previousStatus` 和 `service`。`service` 复用 `GET /api/system/services/status` 的单项结构；Web 使用该事件更新共享 service status store。左侧服务状态面板和聊天输入框下方的当前会话外部智能体状态栏读取该 store；服务状态事件不得投影为聊天 timeline item。

## Product Messages and Runs API

Product Messages and Runs API 是 Web 聊天主路径。Web 不再直接用 `/api/runtime/runs*` 创建聊天回复，而是通过 HubServer 持久化消息、Run 和 RunEvent 后再调用 Agent Runtime。完整机制见 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`。

### 发送会话消息

**端点**：`POST /api/conversations/:conversationId/messages/send`

请求体：

```json
{
  "content": "请帮我改一下这个组件。",
  "addressedAgentIds": ["coder"],
  "replyToMessageId": "msg_xxx"
}
```

行为：

- `addressedAgentIds` 可省略；省略或为空数组时保持当前会话默认入口规则。当前阶段最多只能包含一个智能体 ID，且必须来自当前 conversation 成员。纯文本中的 `@Agent` 不会被 HubServer 自动解析为路由目标。
- `replyToMessageId` 可省略；当前用于记录回复关系，Runtime RunInput 仍以 HubServer 组装的 history 和 user message 为准。
- HubServer 创建 user `Message` 和 text `MessagePart`，并使用 run-local `firstEventSequence = 0` 固定它排在该 run 的 Runtime 输出之前。
- HubServer 创建本地 `Run(status="queued")`，并将 `triggerMessageId` 指向 user message。
- HubServer 从持久化 messages 投影 Runtime `history`，组装包含 `addressedAgentIds` 的 Runtime `RunInput` 后调用 `POST /runtime/runs`。
- Runtime 返回的 `runId` 写入本地 `Run.runtimeId`。
- HubServer 启动后台 Runtime SSE consumer，并返回最新消息快照与 `timelineRuns` 产品 event replay 数据。
- 同一 conversation 已存在非终态 Run 时返回 `RUN_ALREADY_ACTIVE`。
- `addressedAgentIds` 非成员、重复或超过一个时返回 `RUN_INVALID_ENTRY_AGENT`，且不创建新 Run。

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
默认读取最近 50 条消息和最近 50 个 run，再按聊天展示顺序正序返回；带 `limit/offset` 时按最近窗口分页，`offset=0` 表示最新一页。

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
  artifacts?: PersistedArtifact[]
}

type PersistedArtifact = {
  id: string
  conversationId: string
  runId: string | null
  messageId: string | null
  createdByAgentId: string | null
  type: string
  title: string
  status: string
  currentVersionId: string | null
  metadataJson: Record<string, unknown>
  createdAt: string
  updatedAt: string
  currentVersion?: PersistedArtifactVersion | null
}

type PersistedArtifactVersion = {
  id: string
  artifactId: string
  version: number
  source: string
  language: string | null
  content: string
  summary: string | null
  diffJson: Record<string, unknown> | null
  createdByAgentId: string | null
  createdAt: string
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
  status: "queued" | "running" | "waiting_approval" | "waiting_input" | "completed" | "failed" | "cancelled"
  lastEventSequence: number
  plan: Record<string, unknown> | null
}

type RunPlanSnapshot = {
  runId: string
  status: "queued" | "running" | "waiting_approval" | "waiting_input" | "completed" | "failed" | "cancelled"
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
    status: "queued" | "running" | "waiting_approval" | "waiting_input" | "completed" | "failed" | "cancelled"
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
`timelineRuns` 是聊天 UI 恢复的主数据源：Web 先渲染每个 run 的 `triggerMessage`，再按 `events.sequence` 重放产品 event envelope，并与 live SSE 共用同一套 projection reducer。随后 Web 合并 `messages` 中 `surface="chat"` 的 user/assistant 消息作为持久化兜底，并按 `runId + runtimeMessageId` 去重，避免 raw event replay 窗口缺失时丢失已经投影落库的 OpenCode 等外部智能体回复。产品 event envelope 中 `event.runId` 是 HubServer 本地 Run id，`event.runtimeRunId` 保留 Agent Runtime run id；`message.*.data.generation`、`agent.*.data.generation` 与外部智能体的 `message.completed.data.externalModel` 会原样保留，供 Web 从事件 replay 恢复模型名、生成统计和外部平台实际回复模型；若 replay 不包含该消息，Web 可从 persisted assistant message 的 `metadataJson.runtime.externalModel` 恢复外部模型展示。`externalModel.providerName/modelName` 是可选展示增强，`providerId/modelId` 仍是必需标识；大工具结果可能已被投影为 UI 摘要；完整 raw Runtime event 保存在 `RunEvent.payloadJson`。`runItems` 保留为查询、history、统计和后续产品能力的数据源。

### 消息置顶 API

消息置顶是 HubServer 产品 API，用于把长期上下文在后续 `RunInput.pinnedMessages` 中传给 Runtime。

| 端点 | 请求体 / 响应 | 说明 |
| --- | --- | --- |
| `POST /api/conversations/:conversationId/pins` | `{ messageId, note?, sortOrder? }` -> pin record，`201` | 创建 pin；会校验 message 属于该 conversation |
| `GET /api/conversations/:conversationId/pins` | `{ pins: [...] }` | 返回带 `messageContent` 的 pin 列表 |
| `PATCH /api/pins/:pinId` | `{ note?: string \| null, sortOrder?: number }` -> updated pin | 更新备注或排序 |
| `DELETE /api/pins/:pinId` | `{ "deleted": true }` | 删除 pin |

错误码：`VALIDATION_ERROR`、`MESSAGE_NOT_FOUND`、`PIN_LIMIT_EXCEEDED`、`PIN_ALREADY_EXISTS`、`PIN_NOT_FOUND`。当前单会话 pin 上限为 10。

### 订阅产品 Run 事件

**端点**：`GET /api/runs/:runId/events?afterSequence=`

响应类型：`text/event-stream`

事件格式：

```text
event: run.event
data: {"sequence":12,"event":{"id":"evt_xxx","runId":"run_hub_xxx","runtimeRunId":"runtime_run_xxx","type":"message.delta","timestamp":"2026-05-29T00:00:00.000Z","messageId":"msg_runtime_run_xxx_exec_0","messageIndex":0,"data":{"delta":"hello","generation":{"executionId":"execution_xxx","model":{"providerId":"openai","modelId":"gpt-5.1","providerName":"OpenAI","modelName":"GPT-5.1"}}}}}
```

行为：

- `runId` 是 HubServer 本地 Run id。
- HubServer 先发送 `sequence > afterSequence` 的持久化 RunEvent，再推送 live events。
- `sequence` 是本地 Run 内递增序号。
- `event` 是面向产品 UI 的 Runtime RunEvent envelope；`event.runId` 是 HubServer 本地 Run id，`event.runtimeRunId` 是 Runtime run id，大工具结果可能已被摘要化。
- `RunEvent.payloadJson` 永久保留 raw 事实；未知 event type 也必须落库，后续只补 projection。
- 产品 Run SSE 和 `timelineRuns` 可对大工具结果做 UI 摘要投影以保护浏览器热路径；例如 `tool.completed(toolName="web_fetch")` 的 `event.data.data.body` 不会传给前端，摘要里包含 `bodyCharacters` 与 `bodyOmittedForUi: true`。完整 raw event 仍保存在 `RunEvent.payloadJson`。
- Run 到达终态后关闭流。

Web 恢复规则：

- 先加载 messages snapshot 中的最近窗口 `timelineRuns` 并重放产品 event envelopes，再合并 persisted chat messages 兜底。
- 用 `activeRun.lastEventSequence` 作为 `afterSequence` 续订 active run。
- Web 按 Runtime `event.id` 去重；live SSE 和 replay 都进入同一套 projection reducer，避免重复拼接 `message.delta`。

### 取消产品 Run

**端点**：`POST /api/runs/:runId/cancel`

行为：

- HubServer 查找本地 Run。
- 若存在 `runtimeId`，转发到 Runtime `POST /runtime/runs/:runtimeId/cancel`。
- 若 Runtime id 尚未写入，则直接将本地 Run 标记为 `cancelled`。
- 若 Runtime 因重启或不可用导致 cancel 返回 `RUN_NOT_FOUND` / `RUNTIME_NOT_READY`，HubServer 仍将本地 Run 标记为 `cancelled`，用于解除产品侧 active run 阻塞。
- 返回更新后的 `ActiveRunSnapshot`；HubServer 会在 Runtime cancel 成功后立即把本地 Run 投影到终态并发布 `run.status.changed`，后续 Runtime SSE 的 terminal event 按幂等方式继续处理。
- Web 的 Question `Skip/跳过` 与聊天输入区 `停止回答` 都复用本端点；Skip 不提交 question 答案，不会产生合成 `tool-result`，语义是放弃本轮 Run。若 Skip 的产品 cancel 请求本身失败，Web 仍可本地 dismiss 该 pending question，恢复普通输入框，让用户重新发起下一轮对话。

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

### 回答产品 Run 问题请求

**端点**：`POST /api/runs/:runId/questions/:requestId/answer`

请求体：

```json
{
  "answers": [
    {
      "questionId": "question_1",
      "optionId": "option_1",
      "answer": "Option label or custom text",
      "custom": false
    }
  ]
}
```

行为：

- `runId` 是 HubServer 本地 Run id。
- HubServer 查找本地 Run，读取 `runtimeId`，再转发到 Runtime `POST /runtime/runs/:runtimeId/questions/:requestId/answer`。
- 一次请求提交同一个 question request 内全部 required 问题的答案；可选问题可以省略。
- Runtime 的后续 `question.answered` / `tool.completed` / `message.*` 事件仍通过 `/api/runs/:runId/events` 持久化和回放。
- `runtimeId` 缺失时返回 `QUESTION_RUN_NOT_ACTIVE`。

### 调试代理

`/api/runtime/runs*` 仍保留为调试和过渡代理接口，但不再是 Web 聊天主路径。产品级消息、恢复、持久化和 sequence 语义只由本节 API 承担。

当前调试代理：

- `POST /api/runtime/runs` -> `POST /runtime/runs`
- `GET /api/runtime/runs/:runId` -> `GET /runtime/runs/:runId`
- `GET /api/runtime/runs/:runId/events` -> `GET /runtime/runs/:runId/events`
- `GET /api/runtime/runs/:runId/permissions` -> `GET /runtime/runs/:runId/permissions`
- `POST /api/runtime/runs/:runId/permissions/:requestId/decision` -> Runtime permission decision API
- `POST /api/runtime/runs/:runId/questions/:requestId/answer` -> Runtime question answer API
- `POST /api/runtime/runs/:runId/cancel` -> Runtime cancel API

同类过渡代理还包括 `/api/runtime/agents*`、`/api/settings/model`、`/api/runtime/health`、`/api/runtime/info` 和 Provider 代理。Web 产品主路径应优先使用产品级 API，调试代理不提供 HubServer 本地 Run sequence、消息持久化或 Artifact 投影语义。

## Runtime RunInput 会话入口规则

Runtime Run API 已实现；本节记录 `POST /runtime/runs` 及相关事件、审批续跑接口遵守的 IM 会话入口契约。

RunInput 必须携带会话模式和当前会话智能体成员：

```ts
type RuntimeConversationMode = "single" | "group"
type ExternalSessionScope = "conversation-visible" | "delegated-task"

type RuntimeMessage = {
  id?: string
  role: "user" | "assistant" | "system"
  agentId?: string
  content: string
}

type PinnedMessage = {
  id: string
  messageId: string
  content: string
  note?: string | null
  pinnedAt: string
  sortOrder: number
}

type ExternalSessionHint = {
  provider: "opencode" | "claude-code" | "codex"
  agentId: string
  scope: ExternalSessionScope
  providerSessionId: string
  conversationId?: string
  workspaceId?: string
  parentProviderSessionId?: string
  taskId?: string
  runId?: string
  handoffSummary?: string
}

type ExternalContextPacket = {
  provider: "opencode" | "claude-code" | "codex"
  agentId: string
  scope: ExternalSessionScope
  mode: "delta" | "bootstrap"
  messages: Array<{
    id: string
    role: "user" | "assistant"
    agentId?: string
    senderLabel?: string
    createdAt?: string
    content: string
  }>
  handoffSummaries: Array<{
    sessionId?: string
    providerSessionId: string
    taskId?: string
    runId?: string
    summary: string
  }>
  cursorCandidate?: {
    throughMessageId?: string
    throughMessageCreatedAt?: string
    includedMessageIds: string[]
    includedHandoffSessionIds: string[]
  }
  omitted?: {
    messageCount?: number
    characterCount?: number
    handoffSummaryCount?: number
  }
}

type RunInput = {
  conversationId: string
  mode: RuntimeConversationMode
  participantAgentIds: string[]
  addressedAgentIds?: string[]
  userMessage: RuntimeMessage & { role: "user" }
  history?: RuntimeMessage[]
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
    includeSkillDiagnostics?: boolean
  }
  externalSessionHints?: ExternalSessionHint[]
  externalContext?: ExternalContextPacket[]
  pinnedMessages?: PinnedMessage[]
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
| `diagnostics` | 可选模型流追踪开关；Runtime 默认输出 `model.stream.part` 与 `reasoning.*`，但不输出 AI SDK `raw` chunk；`includeSkillDiagnostics` 只输出已注入 Skill 的元数据，不输出正文；HubServer 真实聊天 Run 会使用“输出设置”写入当前值 |
| `externalSessionHints` | HubServer 提供的外部智能体 session 复用 hint；当前用于 OpenCode、Claude Code 与 Codex direct `conversation-visible` session 续接，缺失时 Runtime Adapter 可创建 provider session 并在 `agent.started.data.externalSession` 回传 link |
| `externalContext` | HubServer 为外部智能体组装的用户可见上下文包；当前用于 OpenCode、Claude Code 与 Codex direct `conversation-visible` prompt 前缀，包含公共 chat 消息、delegated handoff summary、同步 cursor candidate 和预算省略信息 |
| `pinnedMessages` | HubServer 注入的置顶消息快照；Runtime 只把它作为 prompt 上下文，不修改 pin 数据 |

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

`OrchestratorTask` / `run_task` 输入结构：

```ts
type OrchestratorTask = {
  taskId: string
  targetAgentId: string
  title: string
  instruction: string
  expectedOutput: string
  requiredCapabilities?: string[]
  riskLevel: "low" | "medium" | "high"
  dependsOn?: string[]
  lockPaths?: string[]
}

type RunTaskInput = Omit<OrchestratorTask, "requiredCapabilities"> & {
  requiredCapabilities?: string[]
  context?: unknown
  contextRef?: string
}
```

`lockPaths` 是声明式 advisory file lock。路径必须是 workspace-relative 精确文件路径，不能为空、不能是绝对路径、不能包含 `..` 越界段，Runtime 会统一规范化为 `/` 并去重。非空 `lockPaths` 会在目标智能体执行前申请 `{ workspaceId, path }` 内存锁；任一冲突则 `run_task` 返回失败，不启动目标智能体。

锁失败的 `task.failed.data.details` 至少包含 `taskId`、`targetAgentId`、`sourceAgentId`、`lockPaths`，锁冲突还包含 `workspaceId` 与 `conflicts[]`，其中每个 conflict 包含 `path` 和当前 owner 摘要 `{ runId, taskId, targetAgentId, sourceAgentId, groupId? }`。该机制只覆盖显式传入 `run_task.lockPaths` 的委派任务，不拦截普通文件写工具或外部 Agent 未声明写入。

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
    "includeRawModelChunks": false,
    "includeSkillDiagnostics": false
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

`status` 可为 `queued`、`running`、`waiting_approval`、`waiting_input`、`completed`、`failed` 或 `cancelled`。`waiting_approval` 表示 Runtime 已收到 AI SDK tool approval request，正在等待权限决定并保留同一 Run 的 continuation state。`waiting_input` 表示 Runtime 已收到 `question` request，正在等待用户回答。若仍有其他并行任务分支在运行，Run 可以保持 `running`；当所有未完成分支都在等待审批或用户输入时才转为等待状态。

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
agent.skill_context.resolved
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
question.requested
question.answered
question.cancelled
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

`agent.skill_context.resolved` 是 Skill 注入诊断事件，仅在 `RunInput.diagnostics.includeSkillDiagnostics = true` 且当前 agent 存在显式 `allowedSkills` 或默认 `orchestrator` 自动选择到 workspace Skill / warning 时输出。它描述 Runtime 为本次执行解析到的 Skill 元数据和 warning，不包含 Skill 正文、真实文件路径、workspace root、env、headers 或 secret。HubServer 应把该事件作为 raw 诊断事实持久化，不投影为普通聊天消息：

```ts
type AgentSkillContextResolvedEventData = {
  status: "resolved" | "partial" | "skipped"
  skills: Array<{
    id: string
    ref: string
    name: string
    source: "agents" | "codex" | "claude-code" | "opencode"
    level: "global" | "workspace"
    truncated: boolean
    contentChars: number
    relativeRefs: string[]
    warnings: string[]
  }>
  warnings: string[]
}
```

`system_agent.completed` 表示 Runtime 内部系统智能体在当前 Run 完成前产出了可消费结果。首版只定义 `title`；标题只基于会话第一条用户输入生成，不包含第一轮智能体输出。标题结果一旦 ready 且 Run 仍未结束，Runtime 会立即发送该事件；主智能体完成时只短暂等待标题任务 flush，如果模型标题仍未赶上或生成失败，Runtime 会在 `run.completed` 前发送一个基于首条用户消息的确定性 fallback 标题事件，然后取消后台标题任务：

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

type WorkspaceDiffSummary = {
  version: 1
  status: "available" | "degraded" | "unavailable"
  source: "git"
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootLabel: string
  }
  baseline: WorkspaceDiffSnapshot
  final: WorkspaceDiffSnapshot
  baselineDirty: boolean
  runOnlyReliable: boolean
  changedFiles: WorkspaceDiffFile[]
  stats: {
    filesChanged: number
    additions: number
    deletions: number
    modified: number
    added: number
    deleted: number
    renamed: number
    untracked: number
    conflicted: number
  }
  patch?: {
    text: string
    bytes: number
    maxBytes: number
    truncated: boolean
    omittedReason?: string
  }
  summary: string
  limitations: string[]
  error?: {
    code: string
    message: string
  }
}

type WorkspaceDiffSnapshot = {
  capturedAt: string
  repository: "available" | "not_repository" | "unknown"
  branch?: string
  head?: string
  dirty: boolean
  fileCount: number
  unavailableReason?: string
}

type WorkspaceDiffFile = {
  path: string
  statusBefore?: string
  statusAfter?: string
  origin:
    | "new-since-baseline"
    | "removed-since-baseline"
    | "status-changed"
    | "unchanged-baseline"
    | "unknown-dirty-baseline"
  additions?: number
  deletions?: number
  binary?: boolean
}
```

Workspace Diff V0 由 Runtime 在 Run 创建时捕获 baseline，并在终态事件上 best-effort 计算：

- `run.completed.data.workspaceDiff?: WorkspaceDiffSummary`
- `run.failed.data.workspaceDiff?: WorkspaceDiffSummary`
- `run.cancelled.data.workspaceDiff?: WorkspaceDiffSummary`

该能力是平台通用能力，不属于 OpenCode 私有事件。内部预设智能体、隐藏子智能体、用户自定义写入智能体和外部智能体共享同一套 git-based baseline / final status / changed files / diffstat / bounded patch 逻辑。`stats.additions/deletions` 优先来自 `git diff HEAD --numstat`；对未跟踪文本文件，Runtime 会 best-effort 按文件内容计算新增行数，因为 git numstat 不覆盖这类文件。对于尚未首次 commit、没有可用 `HEAD` 的 Git 仓库，Runtime 会跳过 HEAD numstat，并为未跟踪文本文件生成 fallback bounded patch；summary 仍以 `head_unavailable` 标记为 degraded。无法可靠统计增删行时，消费者应把行数视为未知，而不是把 `0` 展示为真实变更行数。非 git、未绑定 workspace、git 缺失、命令超时等情况必须降级为结构化 `status = "unavailable" | "degraded"`，不导致 Run 本身失败。若 `baselineDirty = true`，Runtime 会用 baseline/final 脏文件 fingerprint 尽量过滤掉本轮未变化的既有脏文件，并设置 `runOnlyReliable = false`；dirty baseline 下的 bounded patch 是 final-vs-HEAD 的保守结果，不声称是精确 run-only patch。

HubServer 消费终态事件后，对 `changedFiles.length > 0` 或 `stats.filesChanged > 0` 的 summary 投影为 `Artifact(type = "diff")` 与 `ArtifactVersion`：Artifact metadata 记录 `source = "runtime.workspaceDiff"`、`runtimeEventId`、`baselineDirty`、`status` 与 `changedFileCount`；版本的 `content` 保存 bounded patch 或摘要文本，`diffJson` 保存完整 `WorkspaceDiffSummary`。`GET /api/conversations/:conversationId/messages` 通过 `PersistedMessage.artifacts` 返回这些卡片所需数据。可靠 Diff Artifact 后续可由 HubServer 调用 Runtime workspace revert API 执行完整 Run 级撤销；撤销成功会生成新的 `source = "workspace.revert"` Diff Artifact 和 ChangeSet。

### Workspace Revert API

Workspace Revert API 是 Runtime 内部 API，只允许 HubServer 调用；浏览器不得直接传入本机路径或访问该端点。HubServer 必须从原 Run `inputJson.workspace` 读取 workspace root，再把 source Diff Artifact 的 bounded patch 和 changed files 传给 Runtime。

**端点**：`POST /runtime/workspace/revert/preview`

请求体：

```ts
type WorkspaceRevertRequest = {
  workspace: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  source: {
    artifactId: string
    changeSetId?: string
    runId: string
    patchText: string
    patchTruncated: boolean
    baselineDirty: boolean
    runOnlyReliable: boolean
    changedFiles: Array<{
      path: string
      oldPath?: string
      statusBefore?: string
      statusAfter?: string
      status?: string
      origin:
        | "new-since-baseline"
        | "removed-since-baseline"
        | "status-changed"
        | "unchanged-baseline"
        | "unknown-dirty-baseline"
      additions?: number
      deletions?: number
      binary?: boolean
      truncated?: boolean
    }>
  }
}
```

成功响应：

```ts
type WorkspaceRevertPreviewResponse = {
  status: "available" | "blocked"
  canApply: boolean
  files: Array<{
    path: string
    oldPath?: string
    status?: string
    action: "modify" | "delete-created" | "restore-deleted" | "revert-change"
    additions?: number
    deletions?: number
    binary?: boolean
  }>
  warnings: string[]
  blockedReason?: {
    code:
      | "ARTIFACT_REVERT_UNSUPPORTED"
      | "ARTIFACT_REVERT_NOT_RELIABLE"
      | "ARTIFACT_REVERT_BLOCKED"
      | "WORKSPACE_REVERT_INVALID_INPUT"
      | "WORKSPACE_REVERT_APPLY_FAILED"
    message: string
  }
  source: {
    artifactId: string
    changeSetId?: string
    runId: string
    patchDirection: "reverse-applied"
  }
}
```

**端点**：`POST /runtime/workspace/revert/apply`

行为：

- Runtime 先执行同一 preview 校验和 `git apply --reverse --check --whitespace=nowarn`。
- 只有 preview `canApply = true` 且 reverse check 通过时，才执行 `git apply --reverse --whitespace=nowarn`。
- patch 缺失、patch truncated、binary/truncated file、`baselineDirty = true`、`runOnlyReliable = false`、非 git workspace、缺少 workspace 或 reverse check 失败都返回 `blocked`，不修改文件。
- Runtime 响应不得泄露 workspace root 绝对路径。

响应：

```ts
type WorkspaceRevertApplyResponse =
  | {
      status: "applied"
      operationId: string
      preview: WorkspaceRevertPreviewResponse
      workspace: { workspaceId: string; backendType: "local" }
      appliedAt: string
    }
  | {
      status: "blocked"
      preview: WorkspaceRevertPreviewResponse
      blockedReason: WorkspaceRevertPreviewResponse["blockedReason"]
    }
  | {
      status: "failed"
      preview: WorkspaceRevertPreviewResponse
      error: WorkspaceRevertPreviewResponse["blockedReason"]
    }
```

消息事件身份规则：

- `message.delta` / `message.completed` 以 AI SDK 文本块为边界；一次 agent execution 可以输出多条 Runtime message。
- `messageId` 表示一次可聚合的智能体消息容器。同一文本块的 delta 和 completed 必须共享同一个 `messageId`；同一输出上下文内的 `reasoning.*`、`tool.*`、`permission.*` 也应复用该 `messageId`。
- `messageIndex` 是 RunManager 按首次 emit 顺序分配的 run-local 递增序号，用于并发任务和交替发言下的稳定排序；同一 `messageId` 下的 reasoning/tool/permission/message 事件共享同一个 `messageIndex`。
- `message.delta` / `message.completed` 可在 `data.generation` 携带 `executionId` 与 compact model 信息；`agent.started` / `agent.completed` 也可携带同结构的 `data.generation`，其中 `agent.completed.data.generation` 可额外包含 usage、finishReason 与 durationMs。
- 外部智能体可在 `message.completed.data.externalModel` 携带本条回复实际使用的外部平台模型，例如 `{ provider: "opencode", providerId: "anthropic", modelId: "claude-sonnet-4", providerName: "Anthropic", modelName: "Claude Sonnet 4" }` 或 `{ provider: "claude-code", providerId: "anthropic", modelId: "claude-sonnet-4" }`。`providerName/modelName` 可选，仅用于 UI 展示；`providerId/modelId` 仍是稳定标识。该字段属于消息级只读 metadata，不表示 AgentHub 管理或覆盖外部平台的 provider/model 配置。
- 外部智能体的 `agent.started.data.externalSession` 与 `agent.completed.data.externalSession` 可携带 `{ provider, agentId, scope, providerSessionId, conversationId, workspaceId, parentProviderSessionId?, taskId?, runId?, handoffSummary? }`，供 HubServer 持久化外部 Session 映射。该字段不表示 AgentHub 接管外部平台配置。
- OpenCode、Claude Code 与 Codex direct run 可在 `agent.completed.data.externalContext` 回传 `{ provider, agentId, scope, mode, messageCount, handoffSummaryCount, cursorCandidate?, omitted? }`，表示本轮已应用的 AgentHub 可见上下文摘要；HubServer 仅在成功终态后推进 `ExternalAgentSession.metadataJson.contextBridge`。该字段不携带完整消息正文。
- OpenCode、Claude Code 与 Codex delegated task 完成时可在 `agent.completed.data.handoffSummary` 与 `agent.completed.data.externalSession.handoffSummary` 携带 handoff summary。该 summary 用于后续 direct context bridge，不应包含原始 delegated prompt 或 Orchestrator 私有计划。
- `agent.completed` 仍表示 execution 完成；兼容字段 usage、finishReason、resolvedModel 继续保留在 `agent.completed.data`。Web 展示模型名、compact tokens 和 tooltip 详情时优先从 Runtime event replay/live SSE 的 `generation` 或 `externalModel` 字段恢复，而不是读取当前 agent 绑定状态。
- Workspace Diff V0 统一挂在 `run.completed` / `run.failed` / `run.cancelled` 的 `data.workspaceDiff`，不挂在外部智能体私有 `agent.completed` 字段上；Diff Viewer、ChangeSet 归因和完整 Run 级撤销属于 HubServer/Web 基于 Diff Artifact 的产品能力，不改变 terminal RunEvent wire shape。
- HubServer 后续持久化时应将 `RunEvent.messageId = event.messageId`；同一 `messageId` 投影到同一 assistant `Message`，文本进入 text `MessagePart`，reasoning/tool/permission 进入对应 part 或 metadata。`messageIndex` 可先写入 message metadata，后续再迁移为排序字段。工具事件可能早于 `message.delta` / `message.completed` 到达，HubServer 必须先持久化 `RunToolCall`，并在同一 `messageId` 的 assistant message 创建或更新后回填 tool `MessagePart`，避免外部工具 UI 只在 live 流里短暂闪现而无法恢复。

工具事件的附加约束：

- `tool.started`、`tool.completed`、`tool.failed` 必须携带 `toolCallId` 与 `toolName`；当工具调用来自某个模型输出上下文时，还应携带对应 `messageId/messageIndex`。
- 外部智能体的原生工具调用可以归一为同一组 `tool.*` 事件，但不表示这些工具属于 AgentHub Runtime Tool Catalog。外部工具事件的 `toolCallId` 必须使用 provider 命名空间，例如 `opencode:<providerToolCallId>` 或 `claude-code:<providerToolCallId>`；`data.externalProvider` 必须标记 provider，并可携带 `providerSessionId`、`providerEventId`、`providerToolCallId`、`providerToolName`、`providerExecuted`、`providerMetadata`、脱敏后的 `input` / `output` / `error`。
- `tool.completed` 的可展示输出优先从 `data.data`、`data.result`、`data.output` 中提取；外部 provider 若使用 `output` 包裹原生 ToolPart 输出，HubServer 和 Web 必须保留并渲染该对象，不能降级成仅展示 `summary`。
- OpenCode Phase 4C 中，Runtime 主路径把 OpenCode `message.part.delta(field="text")` 映射为 `message.delta` 或 `reasoning.delta`，把 `message.part.updated(part.type="tool")` 按 ToolPart state 映射为 `tool.started/completed/failed`，把 `message.part.updated(part.type="reasoning")` 的完成状态映射为 `reasoning.completed`。`session.next.*` 分支只作为未来 OpenCode v2 agent loop 的兼容路径保留。这些事件应复用当前 OpenCode assistant message 的 `messageId/messageIndex`，让 Web 按现有消息和 timeline 逻辑渲染。
- Claude Code Adapter 使用 Claude Agent SDK `query()` async generator：`stream_event.content_block_delta` text delta 映射为 `message.delta`，assistant/result 完成映射为 `message.completed`，`content_block_start(tool_use)` 映射为 `tool.started`，`SDKUserMessage.message.content[].tool_result.tool_use_id` 映射为 `tool.completed`，permission denied 映射为 `tool.failed`。这些事件应复用当前 Claude Code assistant message 的 `messageId/messageIndex`。
- `tool.started` 不回显原始文件路径入参；workspace 类工具的普通事件和成功结果只使用 workspace-relative 路径或 `mounts/<mountId>/...` 逻辑路径。
- `tool.failed` 的 `data` 应尽量包含结构化错误码、错误消息和可调试细节。
- `permission.requested`、`permission.approved`、`permission.denied`、`permission.cancelled` 携带 `toolCallId`、`toolName`，其 `data` 为权限请求记录，包含 `requestId`、`riskLevel`、`status` 与可选 grant 信息；当权限请求来自某个模型输出上下文时，还应携带对应 `messageId/messageIndex`。
- 内部 Runtime Tool 进入审批时先产生 `permission.requested` 而不产生 `tool.started`；批准后恢复工具并发送正常工具事件，拒绝后发送 `tool.failed`，错误码为 `TOOL_EXECUTION_DENIED`。
- 外部智能体原生权限请求也复用 `permission.*`，但不表示该操作是 AgentHub Runtime Tool Catalog 工具。其 `data.data` 必须带 `externalProvider`，并可携带 `providerSessionId`、`providerPermissionId`、`permissionKind`、`permissionType`、`patterns`、`providerToolCallId`、`providerMessageId`、`providerMetadata`。`RunManager.decidePermission()` 对这类请求只 resolve external waiter，不触发 AI SDK approval continuation，也不在拒绝时合成内部 `tool.failed(TOOL_EXECUTION_DENIED)`。
- OpenCode Phase 4D 中，当前官方 `permission.updated` 映射为 AgentHub `permission.requested`，旧 `permission.asked` 作为 provider 兼容输入继续支持；AgentHub approve 回写 OpenCode `reply: "once"`，deny 和 Run cancel 回写 `reply: "reject"`。OpenCode permission reply 失败使用 `ADAPTER_PERMISSION_REPLY_FAILED`，且不应被普通 event stream fallback 吞掉。
- Claude Code 普通 `canUseTool` callback 映射为外部 `permission.requested`；AgentHub approve 回 SDK `{ behavior: "allow" }`，deny 回 `{ behavior: "deny" }`，Run cancel 取消 pending external waiter 并停止 active prompt。`toolName = "AskUserQuestion"` / `ask_user_question` 是例外，必须走 `question.*` 而不是 `permission.*`。Claude Code permission reply 失败使用 `ADAPTER_PERMISSION_REPLY_FAILED` 或 `ADAPTER_PERMISSION_FAILED`。
- `question.requested`、`question.answered`、`question.cancelled` 携带 `requestId`、`toolCallId`、`toolName = "question"`、`questions` 或 `answers/status`，并在来自模型输出上下文时携带同一 `messageId/messageIndex`。外部 adapter 可复用该协议表达外部 waitable question；Claude Code `onUserDialog` / `AskUserQuestion` 走 external question waiter，不伪装成权限请求。若 Claude Code 通过 `canUseTool("AskUserQuestion")` 请求用户输入，Runtime 回 SDK `{ behavior: "allow", updatedInput: { ...input, answers } }`。
- `model.stream.part` 通过 `data.partType` 和 `data.part` 薄封装 AI SDK `fullStream` part；默认过滤 `raw`，除非 RunInput 设置 `diagnostics.includeRawModelChunks = true`。
- `reasoning.started`、`reasoning.delta`、`reasoning.completed` 仅表示 provider/AI SDK 显式暴露的 reasoning/thinking 内容；默认开启，可通过 `diagnostics.includeReasoning = false` 关闭；当 reasoning 属于当前智能体输出时，应携带同一条消息的 `messageId/messageIndex`。
- `write_plan` 的成功结果通过 `tool.completed.data.data.plan` 承载；HubServer/UI 应选择最后一个成功的 `tool.completed(toolName="write_plan")` 作为当前计划。
- `run_task` 的工具事件只用于追踪与持久化原始 RunEvent，不作为父智能体的模型上下文输入；产品 UI 不应把它渲染为普通工具卡片，应优先展示对应的 `task.*`、子智能体输出和 task summary。
- `task.started`、`task.completed`、`task.failed` 的 `data.task.lockPaths` 携带该 delegated task 声明的文件锁路径；未声明时为 `[]`。`TASK_FILE_LOCK_CONFLICT` 的 `task.failed.data.details.conflicts` 携带冲突路径和 owner 摘要。

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
    "summary": "Edited docs/README.md with 1 replacement",
    "data": {
      "path": "docs/README.md",
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
- `bash_command`：`bash` 命令执行审批；`data.permissionType = "command_execute"`，并包含 `command`、`cwd`、`matchedRule`、`ruleAction` 与 `shell`。

权限 API 响应不返回 workspace root 或授权目标的真实绝对路径。批准后的 read/write grant 若出现在响应中，也只返回 `grantId`、`mountId`、`scope`、`accessMode`、`allowSensitive`、`logicalPath` 等脱敏字段。
`web_fetch` 权限请求不返回请求 headers 或 body，URL query 会脱敏。
`bash` 权限请求不返回 workspace root 或宿主机绝对路径；`cwd` 是 workspace-relative 逻辑路径。

### `question` Runtime Tool

`question` 是 Runtime Tool Catalog 中的用户问答工具，`category = "interaction"`、`riskLevel = "low"`、`requiredPermissions = {}`、`approvalPolicy = "never"`、`deferred = true`。它对所有内部 AI SDK 智能体隐式可见，但不出现在用户 authoring options 中；外部 adapter 不以 Runtime Tool Catalog 方式注入，但可通过 waitable external question bridge 复用 `question.*` 事件，例如 Claude Code `AskUserQuestion`。

```ts
type QuestionInput = {
  questions: Array<{
    id?: string        // 1-120
    title: string      // 1-200
    body: string       // 1-4000
    options: Array<{
      id?: string          // 1-120
      label: string        // 1-500
      value?: string       // 1-1000
      description?: string // 1-1000
    }> // 1-12 options
    allowCustom?: boolean
    required?: boolean
  }> // 1-10 questions
}
```

Runtime 会补齐缺失的 question/option id，默认 `allowCustom = true`、`required = true`。模型调用后先产生 `question.requested`，等待用户答案；用户答案通过 answer API 回写后，模型看到的合成工具结果形如：

```ts
type QuestionToolResult = {
  requestId: string
  answers: Array<{
    questionId: string
    optionId?: string
    answer?: string
    custom: boolean
  }>
}
```

答案请求体最多包含 10 个 answer；`answer` 最长 4000 字符。若 question 不允许 custom，则自定义答案返回 `QUESTION_INVALID_INPUT`。Run 被取消时，pending question 产生 `question.cancelled` 和 `tool.failed`，错误码为 `QUESTION_CANCELLED`。

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

默认值：`method = "GET"`、`timeoutMs = 15000`、`maxResponseBytes = 1048576`。`timeoutMs` 最大 60000，`maxResponseBytes` 最大 5242880。只允许 `http:` / `https:` 协议；`GET` / `HEAD` 请求不能携带 `body`；第一版不做域名 allowlist、私网拦截、Cookie jar、multipart builder 或二进制响应解析。

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

### `bash` Runtime Tool

`bash` 是 Runtime Tool Catalog 中的非交互式命令执行工具。工具名固定为 `bash`，但底层 shell 由 Runtime 解析：Windows 默认 PowerShell，非 Windows 默认 `/bin/sh`；可通过 Runtime 环境变量覆盖。完整设计见 `docs/architecture/BASH_TOOL.md`。

```ts
type BashInput = {
  command: string
  cwd?: string
  timeoutMs?: number
  maxOutputBytes?: number
  description?: string
}
```

默认值：`cwd = "."`、`timeoutMs = 30000`、`maxOutputBytes = 131072`。`command` 最长 20000 字符，`cwd` 最长 1000 字符，`description` 最长 1000 字符；`timeoutMs` 最大 300000，`maxOutputBytes` 最大 1048576。`maxOutputBytes` 是 stdout + stderr 合计传输上限；`cwd` 必须是绑定 workspace 内的相对路径。

```ts
type BashResult = {
  command: string
  cwd: string
  shell: string
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
  durationMs: number
}
```

非零 `exitCode` 仍是 `tool.completed`；spawn 失败、超时、取消、缺少 workspace、非法 cwd、权限拒绝才进入 `tool.failed`。stdout/stderr 只包含截断后的文本。Runtime 优先按 UTF-8 解码命令输出；Windows 下若输出不是合法 UTF-8，会按本机 ANSI code page 兜底，例如 936 映射为 `gb18030`，也可通过 `AGENTHUB_BASH_OUTPUT_ENCODING` 显式覆盖。

`bash` 权限由两层组成：

- `permissionPolicy.shell = "none"`：注册表返回 `TOOL_PERMISSION_DENIED`。
- `toolPermissionRules.bash`：按规则决定单条命令 `allow | ask | deny`；最后匹配规则生效，支持 `*` / `?` wildcard。

`ask` 产生 `permission.requested`，其 `data.data` 至少包含：

```json
{
  "permissionType": "command_execute",
  "approvalReason": "bash_command",
  "command": "npm test",
  "cwd": ".",
  "matchedRule": "npm *",
  "ruleAction": "ask",
  "shell": "powershell.exe"
}
```

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

外部智能体权限请求不走 AI SDK 续跑。Runtime 将用户决定 resolve 给对应 Adapter，Adapter 再调用外部平台的 permission reply API。例如 OpenCode approve 固定回写 `reply: "once"`，deny 与 Run cancel 固定回写 `reply: "reject"`；Claude Code approve 回 SDK `{ behavior: "allow" }`，deny 回 `{ behavior: "deny" }`。

### 回答 Run 问题请求

**端点**：`POST /runtime/runs/:runId/questions/:requestId/answer`

请求体：

```json
{
  "answers": [
    {
      "questionId": "question_1",
      "optionId": "option_1",
      "answer": "Optional custom text",
      "custom": false
    }
  ]
}
```

成功响应返回更新后的 question request record。Runtime 随后产生 `question.answered` 与 `tool.completed(toolName="question")`，追加合成 `tool-result` message 后恢复原执行分支。若同一 continuation frame 包含多个 question request，全部回答后只恢复一次。

### 取消 Run

**端点**：`POST /runtime/runs/:runId/cancel`

行为：

- `queued` / `running` / `waiting_approval` / `waiting_input` Run 会转为 `cancelled` 并输出 `run.cancelled`。
- 等待审批的 Run 被取消时，pending 请求先输出 `permission.cancelled`，之后不再接受决定。
- 如果 pending 请求来自外部智能体，Runtime 还会 resolve external waiter；Adapter 应 best-effort 将取消回写到外部平台，例如 OpenCode `reply: "reject"` 或 Claude Code deny/cancel behavior，并 abort active prompt。
- 等待用户回答的 Run 被取消时，pending question 先输出 `question.cancelled` 与对应 `tool.failed(QUESTION_CANCELLED)`，之后不再接受答案。
- 已经是 `completed`、`failed`、`cancelled` 的 Run 保持原状态。
- 不存在时返回 `RUN_NOT_FOUND`。

## Workspace File Edit API

Workspace File Edit API 用于 Web 前端用户在文件预览模式下直接编辑并保存工作区文本文件。

### 获取可编辑文件内容

**端点**：`GET /api/conversations/:conversationId/workspace/file-edit?path=<relative-path>`

成功响应 (200 OK)：

```ts
type WorkspaceEditableFileResponse = {
  path: string
  name: string
  mimeType: string
  size: number
  content: string
  language?: string
  encoding: "utf-8"
  revision: string
  editable: true
}
```

错误响应：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `WORKSPACE_NOT_BOUND` | 400 | 当前会话未绑定 workspace |
| `WORKSPACE_PATH_NOT_FOUND` | 404 / 400 | 路径不存在，或绑定 workspace 目录不存在 |
| `WORKSPACE_ACCESS_DENIED` | 403 | 请求路径越过 workspace 根目录 |
| `WORKSPACE_INVALID_PATH` | 400 | 指定路径不是文件 |
| `WORKSPACE_FILE_NOT_EDITABLE` | 403 | 文件类型不在可编辑白名单中 |
| `WORKSPACE_FILE_TOO_LARGE` | 413 | 文件超过编辑上限（1MB） |

### 保存文件内容

**端点**：`PUT /api/conversations/:conversationId/workspace/file`

请求体：

```ts
type UpdateWorkspaceFileRequest = {
  path: string
  content: string
  revision: string
}
```

成功响应 (200 OK)：

```ts
type UpdateWorkspaceFileResponse = {
  path: string
  size: number
  revision: string
  savedAt: string
}
```

错误响应：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `WORKSPACE_INVALID_INPUT` | 400 | `path`、`content` 或 `revision` 缺失或类型不正确 |
| `WORKSPACE_NOT_BOUND` | 400 | 当前会话未绑定 workspace |
| `WORKSPACE_PATH_NOT_FOUND` | 404 / 400 | 路径不存在，或绑定 workspace 目录不存在 |
| `WORKSPACE_ACCESS_DENIED` | 403 | 请求路径越过 workspace 根目录 |
| `WORKSPACE_INVALID_PATH` | 400 | 指定路径不是文件 |
| `WORKSPACE_FILE_NOT_EDITABLE` | 403 | 文件类型不在可编辑白名单中 |
| `WORKSPACE_FILE_TOO_LARGE` | 413 | 文件超过编辑上限（1MB） |
| `WORKSPACE_FILE_CONFLICT` | 409 | revision 不一致，文件已被外部修改 |
| `WORKSPACE_FILE_WRITE_FAILED` | 500 | HubServer 写入 workspace 文件失败 |

规则：

- 只允许编辑白名单中的文本文件（代码文件、配置文件、普通文本）。
- 文件大小上限 1MB。
- `revision` 基于 `mtimeMs + size` 或内容 hash，用于并发冲突检测。
- 保存时不自动格式化，保持原始换行风格（LF/CRLF）。
- 当前实现按 UTF-8 读写文本，但没有单独返回 `WORKSPACE_FILE_ENCODING_UNSUPPORTED` 的 415 分支；后续若加入严格编码探测，应同步补回该错误码。

## Preview API

Preview API 用于 Web 浏览器面板的网页预览功能。它通过 hub-server 代理目标 URL 的内容，解决 X-Frame-Options 和 CSP 限制，并跟踪重定向以更新地址栏。

### 解析 URL（跟踪重定向）

**端点**：`POST /api/preview/resolve`

请求体：
```json
{
  "url": "https://baidu.com"
}
```

成功响应 (200 OK)：
```json
{
  "finalUrl": "https://www.baidu.com",
  "statusCode": 200,
  "redirected": true
}
```

错误响应：
| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `NETWORK_INVALID_URL` | 400 | URL 格式无效 |
| `NETWORK_UNSUPPORTED_PROTOCOL` | 400 | 只支持 http 和 https 协议 |
| `NETWORK_TIMEOUT` | 502 | 请求超时（10 秒）；当前 HubServer 通过 `badGateway` 返回 |
| `NETWORK_REQUEST_FAILED` | 502 | 网络请求失败 |

行为：
- 发送 GET 请求并跟随重定向，返回最终 URL 和状态码。
- 不读取响应体，仅在收到响应头后即关闭连接。
- 前端在用户按 Enter 后先调用本端点，获得最终 URL 后更新地址栏，再通过 proxy 端点加载内容。

### 代理页面内容

**端点**：`GET /api/preview/proxy?url=<encoded-url>`

成功响应：目标 URL 的完整响应（Content-Type 透传）。

错误响应：
| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `NETWORK_INVALID_URL` | 400 | URL 查询参数缺失或无效 |
| `NETWORK_UNSUPPORTED_PROTOCOL` | 400 | 只支持 http 和 https 协议 |
| `NETWORK_TIMEOUT` | 502 | 请求超时（30 秒）；当前 HubServer 通过 `badGateway` 返回 |
| `NETWORK_REQUEST_FAILED` | 502 | 网络请求失败 |

行为：
- 用 GET 请求目标 URL，跟随重定向。
- 响应头中剥离 `X-Frame-Options`、`Content-Security-Policy`、`Cross-Origin-Resource-Policy`，使页面可在 iframe 中正常嵌入。
- 删除 `transfer-encoding`、`connection`、`keep-alive`、`content-length`、`content-encoding` 等头。
- 对 `text/html` 响应，在 `<head>` 后注入 `<base href="...">` 标签，使页面中的相对路径资源（CSS、JS、图片）能正确解析到目标源站；同时注入轻量导航脚本，把 iframe 内链接点击和 `window.open` 转换为 `PREVIEW_NAVIGATE` postMessage，供 Web 更新预览地址栏。
- 非 HTML 内容（如图片、CSS、字体）以流式方式直接透传。

## Instruct Run API（对话式智能体创建）

### 创建 Instruct Run

**端点**：`POST /runtime/instruct-runs`

请求体 `InstructRunInput`：

```ts
{
  conversationId: string
  userMessage: {
    role: "user"
    content: string
  }
  history?: Array<{
    role: "user" | "assistant"
    content: string
  }>
  draft?: {
    id?: string
    name?: string
    description?: string
    systemPrompt?: string
    capabilities?: string[]
    allowedTools?: string[]
    allowedSubagents?: string[]
    permissionPolicy?: {
      filesystem?: "none" | "read" | "write"
      shell?: "none"
      network?: "none"
      deploy?: "none"
    }
  }
  diagnostics?: {
    includeModelStream?: boolean
    includeReasoning?: boolean
    includeRawModelChunks?: boolean
  }
}
```

成功响应（201）：

```ts
{
  runId: string
  status: "queued"
  agentId: "instruct-agent"
  eventsUrl: string // e.g. "/runtime/instruct-runs/{runId}/events"
}
```

错误响应：

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `INSTRUCT_RUN_INVALID_INPUT` | 400 | 输入参数非法 |

### 查询 Instruct Run

**端点**：`GET /runtime/instruct-runs/:runId`

返回 `InstructRunRecord`：

```ts
{
  runId: string
  conversationId: string
  status: "queued" | "running" | "waiting_input" | "completed" | "failed" | "cancelled"
  agentId: "instruct-agent"
  createdAt: string
  updatedAt: string
  input: InstructRunInput
  error?: {
    code: string
    message: string
  }
}
```

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `RUN_NOT_FOUND` | 404 | Run 不存在 |

### 订阅 Instruct Run 事件

**端点**：`GET /runtime/instruct-runs/:runId/events`

SSE 流，复用现有 `RunEvent` 编码规则。支持的事件类型：

- `run.started` / `run.completed` / `run.failed` / `run.cancelled`
- `agent.started` / `agent.completed`
- `model.stream.part`
- `reasoning.started` / `reasoning.delta` / `reasoning.completed`
- `message.delta` / `message.completed`
- `tool.started` / `tool.completed` / `tool.failed`
- `question.requested` / `question.answered` / `question.cancelled`

### 回答问题

**端点**：`POST /runtime/instruct-runs/:runId/questions/:requestId/answer`

请求体复用 `QuestionAnswerRequestSchema`。

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `QUESTION_INVALID_INPUT` | 400 | 答案格式非法 |
| `QUESTION_NOT_FOUND` | 404 | 问题请求不存在 |
| `QUESTION_RUN_NOT_ACTIVE` | 409 | Run 不在等待用户输入状态 |
| `QUESTION_ALREADY_ANSWERED` | 409 | 问题已被回答 |

### 取消 Instruct Run

**端点**：`POST /runtime/instruct-runs/:runId/cancel`

语义复用普通 Runtime：取消运行中的 stream；若有 pending question，发出 `question.cancelled` 和 `run.cancelled`。

| 错误码 | HTTP Status | 说明 |
| --- | --- | --- |
| `RUN_NOT_FOUND` | 404 | Run 不存在 |

### `save_agent` 工具

工具名称：`save_agent`，`category = "agent-authoring"`，`riskLevel = "medium"`，`approvalPolicy = "never"`，`configurableByUserAgent = false`，`internal = true`。

只注册到 instruct 专用 tool registry，不加入默认 RuntimeToolRegistry。

**输入** `SaveAgentInput`：

```ts
{
  id?: string
  name: string           // 1-120
  description: string    // 1-1000
  systemPrompt: string   // 1-20000
  capabilities?: string[]
  allowedTools?: string[]
  allowedSubagents?: string[]
  permissionPolicy?: {
    filesystem?: "none" | "read" | "write"
    shell?: "none"
    network?: "none"
    deploy?: "none"
  }
  toolPermissionRules?: {
    bash?: Record<string, "allow" | "ask" | "deny">
  }
}
```

**输出** `SaveAgentResult`：

```ts
{
  agent: {
    id: string
    name: string
    description: string
    capabilities: string[]
    allowedTools: string[]
    allowedSubagents: string[]
    permissionPolicy: { filesystem, shell, network, deploy }
    toolPermissionRules?: { bash?: Record<string, "allow" | "ask" | "deny"> }
    enabled: boolean
    readonly: false
    createdAt?: string
    updatedAt?: string
  }
}
```

成功时发出 `tool.completed`，summary 使用 `Created agent <id>`。

**错误码**：

| 错误码 | 说明 |
| --- | --- |
| `AGENT_INVALID_INPUT` | 输入校验失败，包括非法权限、不在白名单的工具 |
| `AGENT_ALREADY_EXISTS` | id 冲突或为系统预设保留 id |
| `AGENT_STORE_WRITE_FAILED` | AgentStore 持久化失败 |

## 初始契约范围

- 会话。
- 消息。
- Agent 注册表。
- Runtime 调用。
- Runtime 流式事件。
- Artifact 元数据。
- 权限请求与审批。
- 用户问答请求与续跑。
- Instruct Run（对话式智能体创建）。
- 工作区文件编辑。

具体端点、事件名称和载荷结构应随着 API 实现逐步补充。
