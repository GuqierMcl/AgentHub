# Skill 与 MCP 能力发现路线图

> 状态：进行中。

## 模块名称

Skill / MCP Capability Discovery

## 目标

在 Agent Runtime 内建立统一的只读能力发现目录，兼容全局和工作区 / 项目级的 AgentHub、Codex、Claude Code、OpenCode Skill 与 MCP 配置来源，并通过 Runtime API 提供给 HubServer 查询。

第一阶段只做只读发现和 API 暴露：不执行 Skill，不注入 Skill 内容，不启动 MCP stdio 进程，不调用 MCP tool，不修改任何外部平台配置。

## 完成标准

- Runtime 能扫描并返回全局与当前 workspace 相关的 Skill 元数据。
- Runtime 能扫描并返回全局与当前 workspace 相关的 MCP server 配置摘要。
- HubServer 能通过代理 API 获取 Runtime 的 Skill / MCP 发现结果。
- Runtime discovery 响应不泄露宿主机绝对路径、密钥、headers、完整 env 或 MCP command 参数中的敏感值；HubServer 面向 Web 的 workspace 分组响应可以返回 conversation metadata 中的 `rootPath` 作为本地工作区标识和展示路径，但浏览器请求体不得提交 rootPath。
- 现有外部智能体边界文档被修订为：AgentHub 可以做只读发现与状态展示，但不接管外部平台的私有配置执行语义。
- Runtime 与 HubServer 有覆盖成功扫描、缺失目录、非法 frontmatter、重复 Skill、敏感字段脱敏和 Runtime 不可用的轻量测试。

## 依赖文档

- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/AGENT_ARCHITECTURE.md`
- `docs/architecture/AGENT_TOOLS.md`
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`
- `docs/reference/HONO.md`
- OpenCode Agent Skills 文档：`https://dev.opencode.ai/docs/skills`
- OpenCode Config 文档：`https://dev.opencode.ai/docs/config`
- Claude Code Settings 文档：`https://code.claude.com/docs/en/settings`
- Claude Code MCP 文档：`https://code.claude.com/docs/en/mcp`
- OpenAI Docs MCP / Codex MCP 配置入口：`https://platform.openai.com/docs/docs-mcp`

## 范围

### 包含

- 全局 Skill 发现。
- 工作区 / 项目级 Skill 发现。
- 全局 MCP server 配置发现。
- 工作区 / 项目级 MCP server 配置发现。
- 只读 Runtime API。
- HubServer 代理 API。
- 发现结果脱敏、去重、冲突报告和错误报告。
- 为后续执行阶段预留稳定的数据模型，但第一阶段不执行能力。

### 不包含

- 第一阶段不运行 Skill 中的 shell 片段、脚本或引用文件。
- 第一阶段不把 Skill 注入任何 agent system prompt。
- 第一阶段不启动 MCP stdio server。
- 第一阶段不连接远程 MCP HTTP/SSE server 做 tool/resource/prompt 枚举。
- 第一阶段不把 MCP tool 注册进 `RuntimeToolRegistry`。
- 第一阶段不修改 Codex、Claude Code、OpenCode 或用户全局配置文件。
- 第一阶段不在 Web 前端实现完整配置管理 UI；HubServer API 先作为后端能力面。

## 兼容发现来源

Skill 目录按 source family 保留来源信息，不做静默覆盖。重复 name 以 `conflicts` 返回，消费者可以按 scope、sourceFamily 和 trust 状态决定展示优先级。

| Source family | 全局路径 | 工作区 / 项目路径 | 说明 |
| --- | --- | --- | --- |
| `agents` | `%USERPROFILE%\.agents\skills\<name>\SKILL.md` | `<workspace>\.agents\skills\<name>\SKILL.md` | AgentHub 与多工具共享的兼容目录。 |
| `codex` | `%USERPROFILE%\.codex\skills\<name>\SKILL.md`、`%USERPROFILE%\.codex\skills\.system\<name>\SKILL.md`、Codex plugin cache 中的 `skills\<name>\SKILL.md` | `<workspace>\.codex\skills\<name>\SKILL.md` | Codex 全局、系统和插件 Skill 只读发现。Plugin cache 结果必须标记 `readonly: true`。 |
| `claude-code` | `%USERPROFILE%\.claude\skills\<name>\SKILL.md` | `<workspace>\.claude\skills\<name>\SKILL.md` | Claude Code / Claude-compatible Skill 目录。 |
| `opencode` | `%USERPROFILE%\.config\opencode\skills\<name>\SKILL.md` | `<workspace>\.opencode\skills\<name>\SKILL.md` | OpenCode 原生 Skill 目录。OpenCode 也兼容 `.claude/skills` 与 `.agents/skills`，Runtime 仍按真实 source family 分开上报。 |

MCP 配置发现第一阶段只读取配置摘要。对本地 command / args / env 做脱敏和风险标记，不启动进程。

| Source family | 全局配置 | 工作区 / 项目配置 | 第一阶段处理 |
| --- | --- | --- | --- |
| `agenthub` | Runtime `dataDir` 下的 AgentHub MCP 配置文件 | `<workspace>\.agenthub\mcp.json` | 作为 AgentHub 自有配置面，优先用于后续托管执行。 |
| `codex` | `%USERPROFILE%\.codex\config.toml` | `<workspace>\.codex\config.toml` | 只读解析 MCP server 定义并脱敏，不写回。 |
| `claude-code` | `%USERPROFILE%\.claude.json`、托管部署只读摘要 | `<workspace>\.mcp.json` | 只读解析 user/local/project scope；`~/.claude.json` 中 project-scoped 配置只匹配当前 workspace canonical path。 |
| `opencode` | `%USERPROFILE%\.config\opencode\opencode.json` / `opencode.jsonc` 及兼容配置目录 | `<workspace>\opencode.json` / `opencode.jsonc`，以及 `<workspace>\.opencode\` 兼容配置目录 | 第一阶段锁定官方 JSON / JSONC config 文件名并通过 fixtures 覆盖；只读解析 `mcp` / `mcpServers` 等 server 定义，兼容 OpenCode `mcp` 顶层 server map 与 local command array。 |

## API 草案

AgentHub 产品侧的 Skill / MCP 范围只有两个：全局和工作区/项目级。HubServer 面向浏览器的 API 只接受 `scope=global|workspace`；Runtime 内部 `all` scope 若保留，仅作为兼容实现细节，不作为 Web/API 产品范围暴露。

### Runtime 内部 API

```http
POST /runtime/capabilities/discover
POST /runtime/capabilities/refresh
GET /runtime/capabilities
GET /runtime/skills?scope=global
GET /runtime/mcp/servers?scope=global
```

`POST /runtime/capabilities/discover` 是第一阶段主入口。`scope = "workspace" | "all"` 时请求体必须携带 HubServer 解析出的显式 workspace snapshot：

```ts
{
  scope?: "all" | "global" | "workspace"
  workspace?: {
    workspaceId: string
    backendType: "local"
    rootPath: string
  }
  sources?: Array<"agents" | "codex" | "claude-code" | "opencode">
}
```

`POST /runtime/capabilities/refresh` 使用相同请求体，强制重建对应缓存项。`sources` 可限制本次发现 / 刷新的来源；不传则扫描全部来源。`GET /runtime/capabilities` 只返回 global-only discovery。workspace 发现不能只传 `workspaceId`，因为 Runtime 不持有 HubServer 的 workspace 业务状态。

### HubServer 代理 API

```http
GET /api/runtime/capabilities?scope=global|workspace&conversationId=<id>
POST /api/runtime/capabilities/refresh
```

`scope=global` 不需要 `conversationId`。`scope=workspace` 不传 `conversationId` 时，HubServer 遍历 active conversations，从会话 metadata 解析 local workspace snapshot，按 canonical `rootPath` 去重后逐个转发给 Runtime `POST /runtime/capabilities/discover` 或 `POST /runtime/capabilities/refresh`；传入 `conversationId` 时只解析该会话绑定的 workspace。解析失败或没有任何可解析 workspace root 时返回 `WORKSPACE_NOT_RESOLVED`。浏览器不得直接传入 workspace rootPath。HubServer 不接受浏览器传入 `scope=all`。

### 响应模型

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

HubServer 面向浏览器的 `scope=workspace` 响应不是 Runtime flat response，而是按 rootPath 聚合后的分组：

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

`path`、`configPath`、`cacheKey` 和 `fingerprint` 都是逻辑或哈希化引用，不得包含宿主机绝对路径、workspace root、token、headers、env 值或其他 secret。

## 阶段拆分

### 阶段 0：文档与边界校准

- 更新 `docs/architecture/AGENT_ARCHITECTURE.md`：补充只读发现与外部配置接管的区别。
- 更新 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`：保留外部平台执行边界，同时允许 Runtime 读取能力摘要。
- 更新 `docs/architecture/AGENT_RUNTIME.md`：新增 Capability Discovery 作为 Runtime 执行前配置可观测能力。
- 更新 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`：记录第一阶段 API 与脱敏规则。
- 明确第一阶段不改变 Run 执行、agent authoring、Tool Catalog 或外部 adapter 行为。

### 阶段 1：只读发现与 HubServer API

目标：实现本路线图当前优先级，只读发现 Skill / MCP 配置并暴露给 HubServer。

- 新增 Runtime capability discovery 模块，按 source family 拆分 resolver。
- Skill resolver 只读取 `SKILL.md` 的 YAML frontmatter 与基础文件元数据，不返回正文。
- Skill resolver 支持 `agents`、`codex`、`claude-code`、`opencode` 全局与 workspace 路径。
- MCP resolver 只读取配置文件并返回脱敏摘要，不启动 stdio、不发起 HTTP 连接。
- MCP resolver 支持 AgentHub 自有配置、Codex config、Claude Code `~/.claude.json` / `.mcp.json`、OpenCode config。
- Runtime 路由新增 `POST /runtime/capabilities/discover` 和 global-only `GET /runtime/capabilities`；`GET /runtime/skills`、`GET /runtime/mcp/servers` 第一阶段仅支持 `scope=global`。
- HubServer 新增 `GET /api/runtime/capabilities` 代理路由，沿用现有 `RuntimeClient.forward()` 模式；workspace scope 通过 conversation metadata 解析 workspace snapshot，未指定 conversation 时按 canonical rootPath 聚合 active conversations 后转发。
- 测试覆盖空目录、非法 frontmatter、重复 name、workspace 未绑定、Runtime 不可用、MCP 敏感字段脱敏和 Windows home path 归一化。

验收：

- 绑定当前仓库 workspace 时，API 能发现 `.agents/skills/*/SKILL.md`。
- 在 Windows 用户目录下，API 能发现 `%USERPROFILE%\.agents\skills`、`%USERPROFILE%\.codex\skills`、`%USERPROFILE%\.claude\skills`、`%USERPROFILE%\.config\opencode\skills` 中存在的 Skill。
- API 返回的 MCP server 不包含原始 token、headers、env 值或完整宿主机路径。

### 阶段 2：发现缓存、刷新和可观测状态

- 引入 Runtime 进程内缓存，默认 TTL 为 30 秒；缓存 key 包含 scope、sources、workspace identity 和 rootPath 哈希。
- Runtime 基于候选目录、`SKILL.md` 和 MCP 配置文件的 `mtimeMs + size` 生成 fingerprint；TTL 未过期且 fingerprint 未变化时返回 cache hit。
- `POST /runtime/capabilities/discover` 默认走缓存；缓存过期或 fingerprint 改变时自动刷新。
- `POST /runtime/capabilities/refresh` 强制刷新指定 `scope` / `sources`，并返回同一 flat discovery response，`cache.hit = false`、`cache.refreshed = true`。
- HubServer 新增 `POST /api/runtime/capabilities/refresh`，workspace scope 与 discovery 使用相同 rootPath 聚合规则；浏览器仍只传 `scope`、可选 `conversationId` 和 `sources`。
- Runtime `GET /runtime/services/status` 增加 `capability-discovery` 服务项；HubServer `/api/system/services/status` 合并该服务项，Runtime 不可用时返回 `capability-discovery.status = "error"`。
- 错误分级：单个来源失败只进入 `warnings`，不让整个 API 失败；Runtime 内部不可用才由 HubServer 返回 Runtime 错误。

### 阶段 3：Web / Agent Authoring 只读展示

- Web 在设置页或 agent authoring 页展示已发现 Skill / MCP server。
- 默认只展示元数据、来源、scope、风险和校验状态。
- 用户自定义 agent authoring options 可以读取发现结果，但不允许第一版配置执行权限。
- 为后续阶段预留 `allowedSkills`、`allowedMcpServers` 字段的 UI 位置，但不提交到 Runtime agent CRUD。
- 插件配置页 scope 控件保持两态：全局 / 工作区。工作区视图消费 HubServer 返回的 `workspaces[]` 分组，以纵向可折叠大卡片展示每个 rootPath 工作区，卡片内部复用现有 Skill / MCP 卡片；右侧会话下拉仅作为工作区过滤器。

### 阶段 4：受控 Skill 注入

- 扩展 `AgentDefinition`：新增 `allowedSkills?: string[]`，只允许引用发现目录中有效且受信任的 Skill。
- Runtime 在 Run 创建时基于 agent 配置、workspace trust 和 source scope 选择 Skill；workspace Skill 缺失 trust record 时默认 trusted，显式撤销记录才阻止注入。
- 默认 `orchestrator` 在 Run 绑定 workspace 时自动选择当前 workspace 中可发现、有效、未撤销的 workspace Skill 注入上下文，即使 preset `allowedSkills` 为空。
- Skill 正文只在 Run prompt assembly 阶段按需读取，且必须限制长度、解析相对引用、禁止执行内联 shell。
- Skill 注入事件可作为诊断或 raw RunEvent 输出，但不应暴露完整 Skill 正文给普通聊天消息。
- 用户自定义 agent 可以保存 `workspace:*` Skill ref；插件配置页的 trust 操作表示显式允许 / 撤销，自动发现的 workspace Skill 默认 trusted。
- Phase 4A 先实现 Runtime-only 的 global Skill 注入闭环。
- Phase 4B 增加 Runtime-only workspace Skill trust contract：允许配置 `workspace:*` refs，注入前按 workspace root hash 与 Skill ref 查询显式撤销记录；缺失记录默认 trusted。
- Phase 4B Hub/Web 对接：HubServer 通过 `conversationId` 解析 workspace snapshot 并代理 trust query / decision；Web 插件配置页展示 workspace Skill trust 状态与信任操作；用户自定义 agent authoring 可以保存 `allowedSkills` 逻辑 ref。
- Web / HubServer 产品侧 scope 收敛为 `global | workspace`；工作区/项目级通过会话绑定 workspace 聚合展示，不再暴露 `all` 视图入口。
- Runtime 诊断事件只返回 Skill 元数据，不返回正文。

### 阶段 5：MCP trust 与 tool 受控执行

Phase 5 的服务设计见 `docs/architecture/SKILL_MCP_SERVICES.md`。MCP 与 Skill 共享默认 trusted / 显式撤销的产品语义，但 MCP 是工具执行能力，不是 prompt 正文注入。

#### Phase 5A：MCP trust 与服务状态

- 新增 `McpTrustService`，记录 global 与 workspace MCP server 的显式允许 / 撤销决策。
- `mcpRef` 使用 Capability Discovery 返回的 MCP `id`；workspace 记录按 `{ workspaceId, workspace root hash, mcpRef }` 隔离。
- 缺失 trust record 默认 trusted；显式 `trusted = false` 会阻止后续启用、枚举和 tool 注入候选。
- 新增 Runtime 内部 `POST /runtime/mcp-trust/query` 与 `PUT /runtime/mcp-trust`，响应不返回 rootPath、env、headers、token、secret args 或 MCP 配置原文。
- `GET /runtime/services/status` 增加 `mcp-runtime` 服务项；Phase 5A 只返回 `idle` 或 `error`。
- Phase 5A 不启动 MCP stdio server，不连接 HTTP/SSE server，不枚举 MCP tools，不调用 MCP tool。

#### Phase 5B：显式启用、连接与 tool 枚举

- 新增 `McpRuntimeService`，独立维护 MCP clients、transports、tool schemas 和连接生命周期。
- MCP stdio server 启动需要显式启用和审批；HTTP/SSE server 连接需要网络权限和凭据脱敏。
- 只有 discovery 有效、trust 未撤销且用户显式启用的 MCP server 可以连接和枚举 tool。

#### Phase 5C：MCP tool 注入与执行

- MCP tool 以命名空间形式注入内部 AI SDK tool set，例如 `mcp_<serverId>_<toolName>`。
- MCP tool 执行统一输出 `tool.started`、`tool.completed`、`tool.failed`，并在 `data.externalProvider = "mcp"` 中保留来源边界。
- MCP tool 权限映射到 Runtime permission / approval 模型，不绕过 Tool Registry、permission continuation 或 workspace sandbox。
- MCP resources/prompts 先作为 application-driven context，不直接交给模型自由调用。

### 阶段 6：外部 Agent Adapter 能力摘要

- OpenCode、Claude Code、Codex adapter 可以把自身检测到的 native Skill / MCP 摘要并入 capability discovery 响应。
- 外部 native tool 仍不注册为 AgentHub Runtime Tool Catalog。
- 外部平台配置仍由平台自身负责；AgentHub 只展示、引用、诊断，不在第一版提供写配置 UI。
- 如果后续要为外部 agent 增加 per-run Skill/MCP 开关，必须单独更新对应 adapter 文档并加审批 / trust 设计。

### 阶段 7：策略治理和分发

- 支持组织级 allowlist / denylist：sourceFamily、scope、server name、skill name、transport 类型。
- 支持 workspace trust 记录：显式撤销的 workspace Skill 只展示，不参与 prompt 注入。
- 支持插件 Skill 与 AgentHub marketplace 的只读索引。
- 支持 capability discovery 的导出诊断包，方便用户排查“为什么某 Skill/MCP 没出现”。

## 当前进度

- 2026-06-07：完成可行性分析，确认第一阶段范围为只读发现并暴露 HubServer API。
- 2026-06-07：创建本路线图，锁定全局和 workspace Skill 来源兼容矩阵。
- 2026-06-07：Phase 2 进入实现收尾，目标是 Runtime 内存缓存、强制刷新 API 和 `capability-discovery` 服务状态。
- 2026-06-07：Phase 4A 进入执行，目标是 Runtime-only global Skill 注入；workspace Skill 注入等待 trust contract 和前端确认流。
- 2026-06-07：Phase 4A Runtime-only global Skill 注入完成；workspace Skill 注入等待 trust contract 和前端确认流。
- 2026-06-07：Phase 4B 进入计划阶段，目标是 Runtime-only workspace Skill trust contract；不包含 Web UI 或 HubServer 代理实现。
- 2026-06-08：Phase 4B 扩展到 Hub/Web 对接；新增 HubServer workspace Skill trust 代理、插件配置页 trust 操作，以及用户自定义 agent `allowedSkills` 保存入口。
- 2026-06-08：Web 插件配置页范围收敛为“全局 / 工作区”，移除产品侧 `all` 入口；HubServer 浏览器 API 同步拒绝 `scope=all`，并在 workspace scope 下按 canonical rootPath 聚合 active conversations 为 `workspaces[]` 分组。
- 2026-06-08：根据产品决策调整 workspace Skill 语义：自动发现默认 trusted；信任记录主要用于显式撤销；默认 `orchestrator` 在绑定 workspace 时自动注入当前 workspace 的有效、未撤销 Skill。
- 2026-06-08：Phase 5A 进入执行，目标是补齐 Skill/MCP 服务设计文档，并实现 Runtime MCP trust store、trust API 与 `mcp-runtime` 服务状态；不启动或调用 MCP。
- 2026-06-08：补齐 Runtime discovery 对 OpenCode 官方 MCP 配置的兼容：支持全局 `%USERPROFILE%\.config\opencode\opencode.jsonc`、workspace 根 `opencode.json` / `opencode.jsonc`、OpenCode `mcp` 顶层 server map 和 local `command` 数组。

## 已完成

- 已确认 Runtime 当前已有 Tool Catalog、Agent authoring options 和 HubServer 代理模式，可复用为 Capability Discovery API 的结构参考。
- 已确认 `agent-runtime` 已依赖 `@modelcontextprotocol/sdk`，后续 MCP 阶段无需从零引入 SDK。
- 已确认现有文档把外部 agent 的 Skill / MCP 视为外部平台私有配置，后续实现前必须先更新边界文档。
- Phase 1 已实现 flat `skills[] / mcps[]` discovery response、HubServer `GET /api/runtime/capabilities` 代理和 workspace snapshot 解析边界。
- Phase 4B 已实现 Runtime workspace Skill trust contract，并完成 HubServer 代理与 Web metadata-only 信任配置入口；浏览器不向 HubServer/Runtime 提交 workspace root 或 Skill body，workspace 分组展示的 rootPath 只来自 HubServer conversation metadata。
- Phase 4B 已实现默认 `orchestrator` workspace Skill 自动注入：Run 绑定 workspace 时，Runtime 自动发现 workspace Skill refs，经默认 trusted / 显式撤销过滤后复用现有 Skill 正文解析与 metadata-only 诊断事件。

## 交付后增强项

路线图完结后，未进入当前交付闭环但仍有价值的内容提取到 `docs/backlog/`。

- Skill package lint、签名和来源校验。
- Skill marketplace / plugin marketplace 的统一索引。
- MCP OAuth 完整授权流。
- MCP resource subscription 与变更通知。
- 跨 workspace 的全局能力健康报告。
- 基于用户意图的 Skill 推荐，但必须避免自动注入已显式撤销的 Skill。

## 风险与待确认点

- Codex、Claude Code、OpenCode 的配置文件格式可能随版本变化；resolver 必须用 fixtures 和版本标记隔离。
- Workspace Skill 属于仓库内容，可能包含 prompt injection；当前默认 `orchestrator` 会自动注入有效且未显式撤销的 workspace Skill，因此撤销入口、诊断事件和文档提示必须保持清晰。
- MCP stdio 配置可能执行任意本地命令；第一阶段不能自动启动，后续必须经过审批。
- MCP 配置中可能包含密钥、headers、env；API 和日志必须统一脱敏。
- Windows、WSL、POSIX home path 解析必须一致，避免重复或漏扫。
- 旧文档中的“AgentHub 不管理外部平台 Skill/MCP”需要精确修订，避免被误读为第一阶段要接管外部平台配置。

## 最近更新

- 2026-06-07：新增路线图，覆盖只读发现、API、缓存、展示、Skill 注入、MCP 执行、外部 adapter 摘要和治理阶段。
- 2026-06-07：Phase 1 API 调整为显式 workspace snapshot；避免 Runtime 通过 `workspaceId` 猜测或查询 HubServer 业务状态。
- 2026-06-07：Phase 2 文档改为当前 flat response；新增 `sources` filter、cache metadata、refresh API 和 `capability-discovery` status 契约。
- 2026-06-07：Phase 4 明确拆出 Phase 4A：仅实现 Runtime 侧 global Skill 注入、正文长度限制和 metadata-only 诊断事件。
