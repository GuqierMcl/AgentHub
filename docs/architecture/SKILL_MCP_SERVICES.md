# Skill / MCP 服务设计

## 目标

Skill / MCP 服务是 Agent Runtime 面向 AgentHub 内部智能体的能力层。它们共享同一套发现、来源、scope 和 trust 语义，但运行边界不同：

- Skill 是上下文能力。Runtime 可以在内部 AI SDK / Orchestrator prompt assembly 阶段读取 Skill 正文，并以受控 system prompt 区块注入。
- MCP 是工具能力。当前 Phase 5B-lite / 5C-lite 为了让内部智能体先能感知并调用 workspace MCP，采用临时默认启用边界：发现且 trusted、未显式撤销的 workspace MCP server 会在 workspace status 查询或 Run 开始时尝试连接、枚举，并作为动态 Runtime Tool 注入内部主智能体与 Orchestrator。细粒度 permission / approval 后续补强。

AgentHub 产品侧只暴露两个范围：全局和工作区 / 项目级。全局来自用户本机全局配置目录；工作区能力来自 HubServer 解析出的 local workspace snapshot。Runtime 不根据 `workspaceId` 查询平台业务状态，也不让浏览器直接传 `rootPath`。

## Skill 服务链路

Skill 当前由三个 Runtime 服务组成：

| 服务 | 职责 |
| --- | --- |
| `CapabilityDiscoveryService` | 只读发现全局与 workspace Skill metadata，返回逻辑 ref、来源、level、校验状态和 warnings，不返回正文。 |
| `SkillContentService` | 在 Run 执行期按 `allowedSkills` 或 Orchestrator 自动选择结果读取有效 Skill 正文，做长度限制和 metadata-only 诊断。 |
| `WorkspaceSkillTrustService` | 记录 workspace Skill 显式允许 / 撤销决策。缺失记录默认 trusted，显式 `trusted = false` 阻止注入。 |

Skill 注入只作用于内部 AI SDK / Orchestrator executor。外部 Codex、Claude Code、OpenCode adapter 不消费 AgentHub Skill 注入，也不由 AgentHub 改写其原生 Skill 配置。

workspace Skill trust 记录按 `{ workspaceId, workspaceRootHash, skillRef }` 隔离。Runtime 持久化和 API 响应只保存 root hash，不保存、不返回真实 workspace root。默认 `orchestrator` 在 Run 绑定 workspace 时，会自动选择当前 workspace 中可发现、有效、未显式撤销的 workspace Skill 注入上下文；普通内部 agent 仍只消费自身 `allowedSkills`。

Discovery 保留 source 级明细；如果同一个逻辑 Skill 同时存在于 `.agents`、Codex、Claude Code、OpenCode 等来源，发现结果仍会返回多个条目，方便插件配置页展示真实安装状态。但 Run prompt assembly 前会按 `scope + normalized skill name` 形成有效能力组并去重，同组只注入一个 Skill。组内优先级固定为 `.agents > codex > claude-code > opencode`；如果较高优先级 Skill 被显式撤销，则继续尝试同组下一个 trusted Skill。诊断事件中的 expected count 使用去重后的逻辑 Skill 数，避免把重复安装误判为部分解析失败。

## MCP 服务链路

MCP 已从 Phase 5A trust 地基推进到 Phase 5B-lite / 5C-lite：Runtime 会对 workspace 级 trusted MCP 做最小连接、tool 枚举和 tool 调用闭环。该实现仍不写外部平台配置，不接管 Codex / Claude Code / OpenCode 的 native MCP 执行语义，也不对 global MCP 自动连接。

| 服务 | 阶段 | 职责 |
| --- | --- | --- |
| `CapabilityDiscoveryService` | 已实现 | 只读解析 MCP server 配置摘要，返回 server `id`、name、source、level、transport、command 和脱敏 args。 |
| `McpTrustService` | Phase 5A | 记录 global / workspace MCP 显式允许或撤销决策。缺失记录默认 trusted，显式 revoke 阻止后续启用、枚举和注入候选。 |
| `McpRuntimeService` | Phase 5B-lite / 5C-lite | 管理 workspace MCP client、transport、连接生命周期、tool schema 枚举、动态 tool 注入、tool 调用和状态快照。 |

MCP trust 的 `mcpRef` 使用 Capability Discovery 返回的 MCP `id`。workspace MCP trust 记录按 `{ workspaceId, workspaceRootHash, mcpRef }` 隔离；global MCP trust 记录按 `{ level = "global", mcpRef }` 隔离。缺失记录默认 trusted；显式 `trusted = false` 表示撤销，并会阻止后续连接、枚举和动态 tool 注入。

OpenCode MCP discovery 需要兼容官方 JSON / JSONC 配置入口：全局 `%USERPROFILE%\.config\opencode\opencode.json` / `opencode.jsonc`，以及工作区根目录 `opencode.json` / `opencode.jsonc`。Runtime 只读解析 `mcp` 顶层 server map；`type = "local"` 与 `command` 数组归一化为 `stdio` metadata，`type = "remote"` 或 HTTP URL 归一化为 `http` metadata。

HubServer 负责把浏览器侧 MCP trust 请求代理到 Runtime：global scope 可直接转发，workspace scope 必须由 `conversationId` 解析 local workspace snapshot，浏览器不得提交 rootPath。当前 Web 插件配置页只为 workspace MCP 显示信任 / 撤销入口；global MCP 保持只读 metadata 展示。

MCP discovery 同样保留 source 级明细；实际连接、tool 注入和聊天输入栏状态显示使用去重后的有效 MCP server。Runtime 按 `level + normalized server name` 分组，同组优先级为 `.agents > codex > claude-code > opencode`，只连接和显示一个 server。若优先来源连接或枚举失败，Runtime 会在同一逻辑组内 fallback 到下一个 trusted 候选；成功后清理同组其他临时状态，避免用户在状态栏看到重复或已经 fallback 的错误来源。Workspace MCP status server 会返回 `sources` 和 `duplicateCount`，用于表达该条状态来自多个 source-specific 配置的合并结果。

## MCP 执行边界

当前临时执行边界：

- 仅 workspace MCP 默认启用；global MCP 仍只做 discovery / trust metadata。
- Runtime status 查询 `POST /runtime/mcp/workspace/status` 默认会触发 trusted workspace MCP 连接和 tool 枚举；`GET /runtime/services/status` 只读快照，不触发连接。
- `GET /runtime/services/status` 中的 `mcp-runtime.status` 在已有 connected workspace MCP client / tool cache 时为 `running`；无连接且无最新错误时为 `idle`。Web 可以把 `idle` 展示为“就绪”，避免用户误解为未运行。
- Run 开始时，内部 `executorType = "ai-sdk"` 的可见主智能体和 `orchestrator` 会解析当前 workspace MCP context；隐藏子智能体、InstructAgent 和外部 adapter 不注入 MCP tool。
- MCP stdio 可能启动 workspace 配置中的本地命令；HTTP/SSE 会使用配置中的 URL、headers 或 env 值建立连接。headers、tokens、env、credential、rootPath 不得出现在 API、日志、RunEvent 或 model-visible tool result 中。
- 本轮不做 per-call approval / permission gate。MCP tool 的 `requiredPermissions = {}`、`approvalPolicy = "never"` 是临时实现，后续必须补上 command/network/tool 级审批和 allowlist。
- MCP tool 注入内部模型时使用命名空间名称，例如 `mcp_<serverId>_<toolName>`，避免与内置 Runtime Tool 冲突。
- MCP tool 调用必须输出 `tool.started`、`tool.completed`、`tool.failed`，并在事件 `data.externalProvider = "mcp"` 中保留来源边界。
- 当前动态 MCP tool 不要求静态 `agent.allowedTools`，但必须通过 Runtime Tool Registry 统一执行并输出事件；静态 Runtime Tool 的 allowlist / permission 语义不变。
- MCP resources / prompts 暂不开放给模型自由调用。

外部 Codex、Claude Code、OpenCode 的原生 MCP 调用仍属于对应外部 adapter 的私有执行语义。AgentHub 可以只读发现和展示摘要，但不写入外部平台配置，也不把外部平台 native MCP tool 注册为 AgentHub Tool Catalog 条目。

## 脱敏与持久化

Skill / MCP 服务不得在普通 API 响应、service status、诊断事件或持久化 trust 记录中泄露：

- workspace root 真实路径，除 HubServer 已保存的 workspace metadata 用于 Web 分组展示外。
- MCP env、headers、tokens、authorization、api key、password、secret 等值。
- Skill 正文，除 Runtime 内部 prompt assembly 阶段按需读取外。
- MCP 配置文件真实绝对路径。

Capability discovery 的 `path`、`configPath`、cache key 和 fingerprint 都必须是逻辑或哈希化引用。trust 服务只保存 logical ref、source / level、workspace root hash、trust 状态和时间戳。
