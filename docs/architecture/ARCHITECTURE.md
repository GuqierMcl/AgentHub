# 总体架构

AgentHub 按三个主要目录和职责边界组织：

```text
web -> hub-server -> agent-runtime
```

## Web

`web/` 负责用户可见的 IM 聊天体验。它只调用 `hub-server` 提供的 API，不能直接调用 LLM 服务，也不能直接访问 `agent-runtime`。

## Hub Server / API Server

`hub-server/` 是平台控制面，负责面向前端的业务 API、会话状态、消息状态、Agent 配置、Artifact 元数据、Run 状态以及生产环境 Web 静态资源托管。

它不直接实现具体 Agent 执行逻辑，而是把执行请求委托给 `agent-runtime`。

## Agent Runtime

`agent-runtime/` 是执行面，负责 LLM 调用、外部 Agent 适配器、Orchestrator 编排、工具调用、权限检查、沙箱策略、Workspace 管理和 Artifact 生成。

Agent Runtime 定位为 HubServer 的**侧车进程（Sidecar）**。生产环境中，HubServer 启动时自动拉起 Agent Runtime 子进程并传入参数；开发环境下支持手动独立启动。架构决策详见 `docs/adr/ADR-001-sidecar-architecture.md`。

## 边界规则

- 前端到后端的请求必须经过 `hub-server`。
- 所有 AI 执行必须经过 `agent-runtime`。
- `agent-runtime` 是 `hub-server` 的 Sidecar 进程，由 `hub-server` 管理其生命周期。
- `agent-runtime` 不直接写业务数据库，只输出结构化事件。
- API 与事件契约必须记录在 `docs/contracts/API_CONTRACTS.md`。
- 权限、沙箱与执行环境变化必须记录在 `docs/architecture/AGENT_RUNTIME.md`。
- 领域数据模型建议以 `docs/architecture/DATA_MODEL.md` 为准，并采用 AI SDK 的 `UIMessage` 最佳实践。
