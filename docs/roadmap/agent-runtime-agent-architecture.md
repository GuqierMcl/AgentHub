# Agent Runtime 智能体架构路线图

## 模块名称

Agent Runtime 智能体架构

## 目标

在 `agent-runtime` 内实现一套统一的智能体执行内核，支持：

- `orchestrator` 作为默认入口的特殊系统预设主智能体。
- 系统预设主智能体、用户自定义主智能体、外部主智能体统一建模。
- 子智能体默认隐藏，只能被允许的主智能体委派调用。
- 内部智能体共享统一执行协议与统一事件流。
- 外部智能体通过 Adapter 接入，和内部智能体执行协议解耦。
- 后续可平滑接入 AI SDK、OpenCode 等具体执行器。

## 完成标准

- Runtime 能加载系统预设主智能体和子智能体。
- `orchestrator` 可作为默认入口。
- 子智能体不可被用户显式调用。
- `GET /runtime/agents` 和 `GET /runtime/agents/:id` 可返回可见主智能体与受控详情。
- 内部智能体的执行输出统一为同一种 RunEvent 协议。
- 外部智能体仅通过 Adapter 进入 Runtime 执行层。

## 依赖文档

- `docs/architecture/AGENT_ARCHITECTURE.md`
- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/contracts/API_CONTRACTS.md`
- `docs/README.md`

## 范围

### 包含

- AgentDefinition、AgentRelation、AgentRegistry。
- 系统预设主智能体与子智能体定义。
- `orchestrator` 默认入口规则。
- 内部智能体统一执行接口。
- Mock 执行器与执行事件协议。
- AI SDK 执行器模板。
- 外部智能体 Adapter 骨架。
- Runtime 的 agents/runs 基础 API。

### 不包含

- HubServer 持久化和 SSE 代理。
- 前端 Agent 管理 UI。
- 真实外部 Agent 的完整接入。
- 权限审批闭环的完整产品化。
- 复杂 DAG 调度和并行编排。

## 阶段拆分

### 阶段 1：智能体定义与注册表

目标：

- 建立 `AgentDefinition`、`AgentRelation`、`AgentRegistry`。
- 内置 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 和子智能体。
- 实现本地 `agents.json` / `agent-relations.json` 合并。

验收：

- Runtime 能列出可见主智能体。
- 子智能体默认隐藏。
- `orchestrator` 标记为默认入口。

### 阶段 2：统一执行接口与事件协议

目标：

- 建立 `AgentExecutor` 统一接口。
- 明确内部智能体共享的 RunEvent 种类和 payload 结构。
- 完成 `MockExecutor`。

验收：

- 所有内部智能体都能通过统一接口输出事件。
- 事件流不依赖具体智能体类型。

### 阶段 3：Run API 与入口解析

目标：

- 实现 `GET /runtime/agents`
- 实现 `GET /runtime/agents/:id`
- 实现 `POST /runtime/runs`
- 实现 `GET /runtime/runs/:runId/events`
- 实现 IM 会话参与者入口解析和委派校验

验收：

- 单聊未显式 @ 时进入该单聊绑定的主智能体。
- 群聊未显式 @ 时默认进入 `orchestrator`。
- 群聊显式 @ 时进入被 @ 的主智能体。
- 当前阶段 `addressedAgentIds` 只允许 1 个；后续阶段扩展并行 @。
- 指定子智能体作为入口会被拒绝。
- 运行态事件可通过 SSE 读取。

### 阶段 4：Orchestrator V1

目标：

- 实现规则版 `orchestrator` 计划生成。
- 支持委派 `explore`、`general`、`file`、`deploy` 等子智能体。
- 支持结构化汇总输出。

验收：

- `orchestrator` 能生成 plan 并驱动子智能体执行。
- 高风险子智能体会触发权限检查。

### 阶段 5：AI SDK 执行器模板

目标：

- 实现 `AiSdkExecutor` 的标准骨架。
- 接入 provider/model 解析。
- 暂不接入 tool loop、计划、artifact 推导。

验收：

- 系统预设主智能体和用户自定义主智能体可切换到 AI SDK 执行器。
- 输出事件和内部智能体协议一致。

### 阶段 6：外部智能体 Adapter 骨架

目标：

- 建立外部智能体统一接口。
- 为 OpenCode、Claude Code、Codex 留出统一接入点。
- 先完成能力描述和事件映射，不做完整实接。

验收：

- 外部智能体被统一视为主智能体。
- Runtime 内部协议无需为外部平台分叉。

## 当前进度

阶段 1 和阶段 2 已完成。阶段 3 已完成只读 Agents API、Run API、IM 会话入口解析和 SSE 事件骨架。阶段 4 已进入第一轮实现：`orchestrator` 的最小编排路径、`run_task` 内部任务工具和顺序委派已落地；并行 DAG、AI SDK 执行器和外部 Adapter 实接仍保留到后续阶段。

## 已完成

- `AGENT_ARCHITECTURE.md` 已建立并补充最新共识。
- 主智能体 / 子智能体两级架构已确认。
- `orchestrator` 定位为特殊系统预设主智能体已确认。
- 内部智能体统一协议、外部智能体 Adapter 边界已确认。
- 阶段 1 已落地 `AgentDefinition`、`AgentRelation`、系统预设主智能体、隐藏子智能体、本地 JSON 只读加载和 `AgentRegistry`。
- 阶段 3 已附带落地 `GET /runtime/agents` 与 `GET /runtime/agents/:agentId`。
- 阶段 2 已落地 `AgentExecutor`、最小 RunEvent 协议和 `MockExecutor`。
- 阶段 3 已落地 `POST /runtime/runs`、`GET /runtime/runs/:runId`、`GET /runtime/runs/:runId/events`、`POST /runtime/runs/:runId/cancel`。
- 阶段 3 已落地 IM 会话入口解析：单聊绑定主智能体、群聊默认 `orchestrator`、群聊单 @ 指定主智能体。
- 阶段 4 已落地 `orchestrator` 最小编排执行、`run_task` 内部任务工具、任务生命周期事件和顺序委派。

## 待办

- 补充 `AiSdkExecutor` 模板。
- 扩展 `orchestrator` 的更完整计划策略、汇总策略和错误恢复。
- 实现外部智能体 Adapter 骨架。
- 后续设计并行 @ 多个主智能体的事件流与聚合策略。

## 风险与待确认点

- 用户自定义智能体是否允许在第一版直接编辑，还是只允许本地 JSON 加载。
- `GET /runtime/agents` 是否默认只返回可见主智能体。
- `deploy` 子智能体的权限与审批策略在第一版中是否只做声明不执行。
- 外部智能体是否需要先支持只读执行能力。
- 目前阶段已明确只允许单个 @，并行 @ 作为后续版本能力。

## 最近更新

2026-05-23

- 根据对话补充了 `orchestrator` 的特殊系统预设主智能体定位。
- 明确内部智能体共享统一执行协议，不引入兼容层。
- 将实现路径拆为注册表、统一执行接口、Run API、Orchestrator V1、AI SDK 模板和外部 Adapter 骨架六个阶段。
- 第一轮实现阶段 1，并附带完成只读 Agents API。
- 补充 IM 会话入口规则：单聊入口为绑定主智能体，群聊无 @ 入口为 orchestrator，群聊有 @ 入口为被 @ 主智能体。
- 第二轮实现阶段 2，并推进阶段 3：Run/Event 骨架、MockExecutor、Run API、SSE replay 和取消能力。
