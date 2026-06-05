# Claude Code Adapter 实现路线图

## 模块名称

Claude Code Adapter V1

## 目标

将 Claude Code 作为 OpenCode 之后第二个外部可见主智能体接入 AgentHub。执行链路保持 `web -> hub-server -> agent-runtime -> external-adapter`，Runtime 通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 接入 Claude Code，而不是把 Claude Code 当作普通模型 Provider。

## 完成标准

- `claude-code` 注册为可见外部主智能体，`executorType = "external-adapter"`。
- Direct conversation 与 Orchestrator delegated task 都能产生普通可见 `claude-code` 消息。
- Claude Code Session 按 `conversation-visible` 与 `delegated-task` 分 scope，并由 HubServer 持久化 provider session mapping。
- Direct run 支持 session hint resume 和 provider-aware context bridge。
- Claude Code 文本、原生 tool trace、权限请求、AskUserQuestion 和终态 session metadata 都进入 AgentHub RunEvent 链路。
- `GET /runtime/services/status` 返回 `claude-code.implemented = true`，且不启动 prompt。
- 默认测试不依赖本机 Claude 登录、真实 API 凭据或真实 Claude Code 执行。

## 依赖文档

- `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`
- `docs/external_agents/CLAUDE_CODE_ADAPTER.md`
- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/HUB_SERVER.md`
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- `docs/contracts/RUNTIME_SSE_EVENTS.md`
- `docs/roadmap/opencode-adapter-implementation.md`

## 范围

### 包含

- Runtime Claude Code adapter、client 抽象、fake client、真实 SDK client。
- `@anthropic-ai/claude-agent-sdk` 接入。
- Preset agent 注册和 external adapter registry 注册。
- HubServer external session/context bridge provider 泛化。
- Permission bridge 与 AskUserQuestion bridge。
- Service status 实现。
- 设计文档、契约文档和路线图。
- 默认 fake/mock 自动化测试。

### 不包含

- AgentHub 内配置 Claude Code 模型、账号、MCP、Skill、hook 或全局设置。
- 浏览器直接访问 Claude Code。
- 把 Claude Code 原生工具注册为 AgentHub Runtime Tool Catalog 工具。
- 前端专属 Claude Code UI；首版复用现有消息、timeline、permission、question 和 diff UI。
- 自动写回 Claude Code “始终允许”权限配置。
- 多智能体并发编辑冲突自动合并。

## 阶段拆分

### Phase 1：文档与契约确认

目标：

- 明确 Claude Code 是外部智能体 adapter，不是 ProviderService/model provider。
- 记录 Claude Agent SDK 的关键 option：`query()`、`cwd`、`resume`、`permissionMode`、`canUseTool`、`onUserDialog`、`pathToClaudeCodeExecutable`、`allowedTools` / `disallowedTools`。
- 记录 Bun compiled binary 风险和 `AGENTHUB_CLAUDE_CODE_EXECUTABLE` 覆盖策略。

状态：

- 已新增 `docs/external_agents/CLAUDE_CODE_ADAPTER.md`。
- 已新增本路线图。
- 已更新 Runtime/API 文档索引与契约。

### Phase 2：Runtime Adapter 骨架、Fake Client、Preset 注册

目标：

- 新增 `ClaudeCodeAdapter`、`ClaudeCodeClient`、`FakeClaudeCodeClient`。
- 在 `DefaultExternalAdapterRegistry` 注册 `claude-code`。
- 新增 `claude-code` preset，使用 `executorType = "external-adapter"`，要求绑定 workspace。
- fake client 覆盖 direct/delegated 基础消息流。

状态：

- 已落地。
- Focused Runtime tests 覆盖 direct run、session hint、tool message identity、permission bridge 和 AskUserQuestion bridge。

### Phase 3：真实 SDK Client、流式事件映射、权限与问题桥接

目标：

- 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` async generator。
- `cwd` 固定为 workspace root。
- session hint 可恢复时传入 `resume`。
- 文本 delta、assistant/result 完成、tool use、tool result、permission denied 映射为 AgentHub RunEvent。
- `canUseTool` 接入 `RuntimePermissionService.stageExternalApproval()`。
- `onUserDialog` 中的 `AskUserQuestion` 接入 `requestExternalQuestion()`。

状态：

- 已落地。
- 当前 `RealClaudeCodeClient` 覆盖 SDK stream event、assistant/result、tool、permission denied 和 user dialog 主要路径。
- 真实复杂 payload 仍需可选 smoke 验证。

### Phase 4：HubServer 外部会话泛化与 Context 恢复

目标：

- 将 OpenCode-specific direct session resolver 泛化为 provider-aware helper。
- `claude-code` 复用 `ExternalAgentSession`。
- Direct Claude Code run 注入 `externalSessionHints` 与 `externalContext`。
- `agent.completed.data.externalContext` 成功后推进 `metadataJson.contextBridge`。
- 保持 OpenCode 当前行为不回归。

状态：

- 已落地。
- 新增 HubServer 测试覆盖 Claude Code context packet、direct session hint/context 和 contextBridge cursor 推进。
- `buildOpenCodeExternalContextPacket()` 继续作为兼容 wrapper 保留。

### Phase 5：状态检查、集成硬化、真实 Smoke

目标：

- `GET /runtime/services/status` 返回 `claude-code` 真实状态。
- 默认 CI 不依赖本机 Claude 登录或真实 credentials。
- 增加 gated real smoke，验证 SDK executable、最小 prompt 和可选 workspace 写入。
- 完成 Bun compiled distribution 的 binary extraction 或 executable override 验收。

状态：

- Service status 已落地：`implemented = true`，`status = "idle"`，details 报告 `sdk-bundled` 或 `env` executable source。
- 默认 fake/mock 测试已覆盖核心行为。
- 已新增 gated real smoke：`AGENTHUB_CLAUDE_CODE_SMOKE=1` 跑最小 prompt，`AGENTHUB_CLAUDE_CODE_WRITE_SMOKE=1` 跑临时 git workspace 写入与 Diff 验证。默认 CI 仍只 skip，不依赖本机 Claude 登录状态。
- 生产 binary extraction 仍待补充。

## 当前进度

- Runtime adapter、fake client、real SDK client、registry、preset、service status 已实现。
- Runtime RunManager 已支持 external question waiter，供 Claude Code `AskUserQuestion` 使用。
- HubServer external session/context bridge 已支持 `opencode` 与 `claude-code`。
- 文档新增与契约更新已进入本路线图记录。

## 待办

- 在生产打包脚本中处理 Bun compiled executable 的 Claude Code binary extraction，或明确要求设置 `AGENTHUB_CLAUDE_CODE_EXECUTABLE`。
- 根据真实 smoke 结果校正 `onUserDialog` payload 到 AgentHub question 的映射。
- 继续观察 SDK message 类型变化，补充更多 Claude Code 状态事件映射。

## 验证命令

默认轻量验证：

```bash
cd agent-runtime && bun test
cd hub-server && bun test
```

如触及前端类型或 UI：

```bash
cd web && bunx tsc --noEmit -p tsconfig.app.json
```

可选真实 smoke 后续使用环境变量显式开启，不进入默认 CI。

## 风险与待确认点

- Claude Agent SDK 的 native binary 在 Bun single executable 中需要真实文件路径；发布前必须验证。
- Claude Code 用户本机配置可能直接允许某些工具，AgentHub 只能桥接 SDK 实际发出的 permission request。
- `AskUserQuestion` payload shape 需要真实复杂任务验证。
- 多个外部智能体共享 workspace 编辑时仍可能冲突；V1 只通过 Diff/ChangeSet 提示，不自动合并。

## 最近更新

- 2026-06-05：创建 Claude Code Adapter 路线图；Runtime adapter、SDK client、HubServer provider-aware session/context bridge、service status、基础测试和 gated real smoke 已落地，下一步进入真实 smoke 实测反馈与生产打包硬化。
