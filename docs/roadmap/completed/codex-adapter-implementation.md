# Codex Adapter Implementation Roadmap

> Status: Completed and archived for delivery. Follow-up Codex hardening work should be tracked in `docs/backlog/AGENT_SIDE_CAPABILITY_BACKLOG.md` or a new roadmap when implementation restarts.

本文档记录 Codex Adapter 从设计到落地的执行路线。专属设计事实来源是 `docs/external_agents/CODEX_ADAPTER.md`；本文只记录实施阶段、验收点和后续推进顺序。

## Decision

- V1 采用 SDK-first：Runtime 默认通过 `@openai/codex-sdk` 驱动 Codex，本地 `codex exec --json` 只保留为诊断、真实 smoke 和受限 fallback。
- Codex 作为外部聊天对象接入，不进入 AgentHub ProviderService、Runtime Tool Catalog 或浏览器直连链路。
- TypeScript SDK V1 先完成 thread start/resume/run 与最终文本映射；如果 SDK 当前事件粒度不足，再在后续阶段接入 Codex app-server JSON-RPC。

## Current Status

- 2026-06-06：Phase 1 已实现。Runtime 已注册 `codex` preset agent、adapter、SDK client、fake client、readiness 与 service status；HubServer 已将 `codex` 纳入 direct external provider session hint/context bridge/context cursor；默认测试使用 fake/injected SDK，不依赖真实 Codex 登录。
- 已额外确认 `@openai/codex-sdk@0.137.0` 暴露 `startThread()`、`resumeThread(threadId)`、`thread.runStreamed()` 与 `thread.run()`，并把 `thread.started` / `item.*` / `turn.*` 事件映射到 AgentHub 标准事件。
- 真实 Codex smoke、真实写入和 Windows/Bun compiled runtime resolution 已作为交付后增强项记录，不阻塞本路线图归档。

## Historical Phases

### Phase 1: SDK-First Minimal Loop

- 新增 `codex` preset agent、`CodexAdapter`、`CodexClient`、`FakeCodexClient` 和 real SDK client。
- 将 `codex` 注册进 Runtime external adapter registry 与导出入口。
- 支持 conversation-visible direct run 和 delegated-task run，输出标准 `agent.started`、`message.delta`、`message.completed`、`agent.completed`。
- 回传 `externalSession`，支持 provider session hint 恢复。
- `GET /runtime/services/status` 将 Codex 改为已实现，并返回 readiness、active run count、client mode 和 last error。
- HubServer 将 `codex` 纳入 direct external provider hint/context bridge。

### Phase 2: Streaming And Timeline（交付后增强）

- 以 SDK 类型为准确认是否有稳定 stream event API。
- 如果 SDK 不足，新增隔离的 Codex app-server client。
- 将 agent message、reasoning、command execution、file change、MCP tool call 和 web search 映射为 AgentHub timeline events。

### Phase 3: Approval And Question Bridge（交付后增强）

- 桥接 command/file/network approval 到 AgentHub `permission.*`。
- 桥接 Codex user input request 到 AgentHub `question.*`。
- Run cancel 时清理 pending approval/question，并 best-effort interrupt Codex active turn。

### Phase 4: Production Hardening（交付后增强）

- 增加真实 smoke：SDK readiness、direct prompt、write prompt + Workspace Diff、exec JSONL parser。
- 核对 Bun compiled distribution 下的 SDK/runtime binary resolution。
- 如接入 app-server，生成并 pin 当前 Codex runtime schema。

## Acceptance Criteria

- Runtime agent registry 可列出 `codex`，且 direct/delegated fake run 完成。
- Codex real client 能通过 dependency-injected fake SDK 覆盖 start/resume/run 映射，不依赖真实登录。
- Runtime service status 中 `codex.implemented = true`，Runtime 有 active Codex run 时状态为 `running`。
- HubServer direct run 会向 Runtime 发送 Codex external session hint 与 external context packet。
- 默认自动化测试不需要真实 OpenAI/Codex 凭据。

## Test Matrix

- `agent-runtime/test/external-adapter.test.ts`: fake Codex direct run、session hint、delegated task、handoff summary。
- `agent-runtime/test/codex-real-client.test.ts`: SDK fake injection 下的 start/resume/run、final text、abort 和 error mapping。
- `agent-runtime/test/service-status.test.ts`: Codex readiness 与 active run count。
- `hub-server/src/services/run-persistence.service.test.ts`: Codex direct session hint、context packet、context bridge cursor。
- `hub-server/src/services/service-status.service.test.ts` 与 `hub-server/src/routers/system.test.ts`: Codex implemented status 透传和 runtime-unavailable 降级。

## Historical Risks

- TypeScript SDK 当前公开文档主要展示 start/resume/run，streaming、approval 和 cancellation 能力需以安装包类型为准。
- Codex app-server 有 experimental surface，所有依赖必须封装在 client 层。
- 用户本机 Codex 配置可能绕过 AgentHub approval；AgentHub V1 仍依赖通用 Workspace Diff 观察最终变更。
- Windows 与 Bun compiled binary 场景需要真实 smoke 才能确认 SDK/runtime resolution。
