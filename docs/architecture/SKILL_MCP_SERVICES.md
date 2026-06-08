# Skill / MCP 服务设计

## 目标

Skill / MCP 服务是 Agent Runtime 面向 AgentHub 内部智能体的能力层。它们共享同一套发现、来源、scope 和 trust 语义，但运行边界不同：

- Skill 是上下文能力。Runtime 可以在内部 AI SDK / Orchestrator prompt assembly 阶段读取 Skill 正文，并以受控 system prompt 区块注入。
- MCP 是工具能力。Runtime 后续只能在显式启用、连接、枚举和权限审批后，把 MCP tool 作为受控工具入口暴露给内部模型。

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

## MCP 服务链路

MCP 当前只完成 metadata discovery；Phase 5A 增加 trust 地基，不启动 MCP server，不连接远程 MCP endpoint，不枚举 tool，也不调用 tool。

| 服务 | 阶段 | 职责 |
| --- | --- | --- |
| `CapabilityDiscoveryService` | 已实现 | 只读解析 MCP server 配置摘要，返回 server `id`、name、source、level、transport、command 和脱敏 args。 |
| `McpTrustService` | Phase 5A | 记录 global / workspace MCP 显式允许或撤销决策。缺失记录默认 trusted，显式 revoke 阻止后续启用、枚举和注入候选。 |
| `McpRuntimeService` | Phase 5B+ | 显式启用后管理 MCP client、transport、连接生命周期、tool schema 枚举和 tool 调用。 |

MCP trust 的 `mcpRef` 使用 Capability Discovery 返回的 MCP `id`。workspace MCP trust 记录按 `{ workspaceId, workspaceRootHash, mcpRef }` 隔离；global MCP trust 记录按 `{ level = "global", mcpRef }` 隔离。缺失记录默认 trusted 只表示该 MCP server 可以进入后续候选，不表示 Runtime 会自动启动 stdio 进程、连接 HTTP/SSE server 或调用 tool。

OpenCode MCP discovery 需要兼容官方 JSON / JSONC 配置入口：全局 `%USERPROFILE%\.config\opencode\opencode.json` / `opencode.jsonc`，以及工作区根目录 `opencode.json` / `opencode.jsonc`。Runtime 只读解析 `mcp` 顶层 server map；`type = "local"` 与 `command` 数组归一化为 `stdio` metadata，`type = "remote"` 或 HTTP URL 归一化为 `http` metadata。

## MCP 执行边界

后续 MCP tool 接入必须走 Runtime 工具和权限体系：

- MCP stdio server 启动需要显式启用，并根据 command 风险触发 Runtime approval。
- MCP HTTP/SSE server 连接需要网络权限；headers、tokens、env 和 credential 值必须脱敏。
- MCP tool 注入内部模型时使用命名空间名称，例如 `mcp_<serverId>_<toolName>`，避免与内置 Runtime Tool 冲突。
- MCP tool 调用必须输出 `tool.started`、`tool.completed`、`tool.failed`，并在事件 `data.externalProvider = "mcp"` 中保留来源边界。
- MCP tool 不绕过 `agent.allowedTools`、`permissionPolicy`、approval continuation 或 workspace sandbox。
- MCP resources / prompts 首版作为 application-driven context，不直接开放给模型自由调用。

外部 Codex、Claude Code、OpenCode 的原生 MCP 调用仍属于对应外部 adapter 的私有执行语义。AgentHub 可以只读发现和展示摘要，但不写入外部平台配置，也不把外部平台 native MCP tool 注册为 AgentHub Tool Catalog 条目。

## 脱敏与持久化

Skill / MCP 服务不得在普通 API 响应、service status、诊断事件或持久化 trust 记录中泄露：

- workspace root 真实路径，除 HubServer 已保存的 workspace metadata 用于 Web 分组展示外。
- MCP env、headers、tokens、authorization、api key、password、secret 等值。
- Skill 正文，除 Runtime 内部 prompt assembly 阶段按需读取外。
- MCP 配置文件真实绝对路径。

Capability discovery 的 `path`、`configPath`、cache key 和 fingerprint 都必须是逻辑或哈希化引用。trust 服务只保存 logical ref、source / level、workspace root hash、trust 状态和时间戳。
