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
- Workspace Backend 与首批只读文件工具可通过统一抽象接入，并支持沙箱外访问审批。

## 依赖文档

- `docs/architecture/AGENT_ARCHITECTURE.md`
- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/AGENT_RUNTIME_BACKEND.md`
- `docs/architecture/AGENT_TOOLS.md`
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
- Workspace Backend 抽象、沙箱外访问审批和首批只读文件工具。
- 外部智能体 Adapter 骨架。
- Runtime 的 agents/runs 基础 API。

### 不包含

- HubServer 持久化和 SSE 代理。
- 前端 Agent 管理 UI。
- 真实外部 Agent 的完整接入。
- 权限审批闭环的完整产品化。
- 更复杂的并行恢复、冲突处理和可视化编排平台。

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

### 阶段 4：Orchestrator AI SDK Tool Calling V1

目标：

- 通过 AI SDK `streamText` 让 `orchestrator` 成为真实的 tool-calling 主智能体。
- 暴露 `write_plan` 内部计划工具，仅供 `orchestrator` 调用。
- 暴露 `run_task` 内部任务工具，仅供 `orchestrator` 调用。
- 支持委派 `explore`、`general`、`file`、`deploy` 以及其他允许的主智能体。
- 支持结构化汇总输出，并保留任务图与工具事件供 UI 回放。

验收：

- `orchestrator` 能在群聊默认入口下通过 `run_task` 委派其他智能体。
- `orchestrator` 能通过 `write_plan` 输出 UI 可渲染计划。
- `write_plan` 仅 `orchestrator` 可见、可调用。
- `run_task` 仅 `orchestrator` 可见、可调用。
- 工具调用、任务生命周期和最终汇总都能通过 SSE 正确回放。
- 高风险子智能体会触发权限检查。

### 阶段 5：AI SDK 执行器模板

目标：

- 实现 `AiSdkExecutor` 的标准骨架。
- 接入 provider/model 解析。
- 暂不接入 tool loop、计划、artifact 推导。

验收：

- 系统预设主智能体和用户自定义主智能体可切换到 AI SDK 执行器。
- 输出事件和内部智能体协议一致。

### 阶段 6：Workspace Backend 与首批只读文件工具

目标：

- 建立 `WorkspaceHandle`、`WorkspaceBackendCapabilities`、`WorkspaceBackend`、`WorkspaceService`。
- 落地 `LocalWorkspaceBackend` 作为第一版本地 workspace 后端。
- 建立沙箱外目录/文件访问审批模型与受控授权挂载语义。
- 实现首批只读文件工具：`ls`、`read_file`、`glob`、`grep`，其中 `read_file` 支持图片多模态返回。
- 将文件类工具接入 Runtime Tool Registry，并输出 `permission.requested` 等审批相关事件。

验收：

- Runtime 可以在 workspace-relative 路径上完成只读文件访问。
- 图片文件可通过 `read_file` 返回多模态内容。
- 访问沙箱外目录/文件时会触发审批，而不是直接暴露宿主机绝对路径。
- 文件工具的能力、风险和可见性可以通过工具注册表统一过滤。

### 阶段 7：外部智能体 Adapter 骨架

目标：

- 建立外部智能体统一接口。
- 为 OpenCode、Claude Code、Codex 留出统一接入点。
- 先完成能力描述和事件映射，不做完整实接。

验收：

- 外部智能体被统一视为主智能体。
- Runtime 内部协议无需为外部平台分叉。

## 当前进度

阶段 1 和阶段 2 已完成。阶段 3 已完成只读 Agents API、Run API、IM 会话入口解析和 SSE 事件骨架。阶段 4 已完成 `orchestrator` 的 AI SDK tool calling、`write_plan` 计划工具、`run_task` 内部任务工具化、任务组事件、依赖表达和批次并行委派；本轮进一步把工具体系抽成正式的 Runtime Tool 底座，并将 `write_plan` / `run_task` 统一纳入工具事件与 AI SDK 工具注册流程。阶段 5 已完成最小 AI SDK 执行器、provider/model 解析、agent 模型绑定回显、按主智能体配置模型的 API，以及系统预设主智能体系统提示词集中化。阶段 6 已完成 Workspace Backend、沙箱外访问审批和首批只读文件工具；阶段 7 继续保留外部 Adapter 骨架。

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
- 阶段 4 已落地 `orchestrator` AI SDK tool calling、`write_plan` 计划工具、`run_task` 内部任务工具、任务组事件、任务生命周期事件和并行委派。
- 阶段 4-5 之间已补齐 Runtime Tool 基础设施、`write_plan` / `run_task` 正式工具化、工具事件协议和 AI SDK 工具注册骨架。
- 阶段 5 已落地最小 `AiSdkExecutor`、provider/model 解析、`orchestrator` / 主智能体模型绑定返回，以及 agent 模型绑定 API。
- 系统预设主智能体 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 已统一从 `agent-runtime/src/agents/preset-agent-prompts.ts` 读取系统提示词。
- 阶段 6 已落地 `WorkspaceService`、`LocalWorkspaceBackend`、沙箱外访问请求与授权挂载语义，以及首批只读文件工具 `ls`、`read_file`、`glob`、`grep`。
- `AGENT_RUNTIME_BACKEND.md` 已建立，明确 Workspace Backend、沙箱外访问审批和本地优先实现。
- `AGENT_TOOLS.md` 已建立，明确工具可见性、`run_task` 语义、事件流和并发约束。

## 待办

- 扩展 `orchestrator` 的更完整计划策略、汇总策略和错误恢复。
- 后续补充计划持久化、计划任务与 `run_task` 的强校验，以及前端 UI 投影。
- 补齐 HubServer 对 Runtime RunEvent 的消费、持久化和 SSE 转发，使产品链路从直接 Runtime smoke 测试闭合到 `web -> hub-server -> agent-runtime`。
- 补齐工具权限审批闭环，包括审批 API、审批结果回传、恢复执行、拒绝处理和 UI 状态。
- 补充 AI SDK 工具循环、结构化输出和更完整的 agent 运行参数映射。
- 实现外部智能体 Adapter 骨架。
- 将隐藏子智能体从 mock 逐步迁移到真实执行器或专用工具执行路径。
- 后续设计并行 @ 多个主智能体的事件流与聚合策略。
- 继续扩展文件写入、Patch 应用和更复杂的沙箱审批闭环。

## 风险与待确认点

- 用户自定义智能体是否允许在第一版直接编辑，还是只允许本地 JSON 加载。
- `GET /runtime/agents` 是否默认只返回可见主智能体。
- `deploy` 子智能体的权限与审批策略在第一版中是否只做声明不执行。
- 外部智能体是否需要先支持只读执行能力。
- 目前阶段已明确只允许单个 @，并行 @ 作为后续版本能力。
- Workspace 根目录来源是 `--workdir`、配置项还是 HubServer 传入参数，需要在实现前最终敲定。
- 沙箱外审批是按“文件”还是按“目录”粒度优先实现，需要在首版实现时保持一致。

## 最近更新

2026-05-24

- 根据对话补充了 `orchestrator` 的特殊系统预设主智能体定位。
- 明确内部智能体共享统一执行协议，不引入兼容层。
- 将实现路径拆为注册表、统一执行接口、Run API、Orchestrator AI SDK Tool Calling、AI SDK 模板和外部 Adapter 骨架六个阶段。
- 第一轮实现阶段 1，并附带完成只读 Agents API。
- 补充 IM 会话入口规则：单聊入口为绑定主智能体，群聊无 @ 入口为 orchestrator，群聊有 @ 入口为被 @ 主智能体。
- 第二轮实现阶段 2，并推进阶段 3：Run/Event 骨架、MockExecutor、Run API、SSE replay 和取消能力。
- 第三轮实现阶段 4：`orchestrator` 的 `run_task` DAG 调度、任务组事件、依赖表达和批次并行委派。
- 第四轮把 Runtime Tool 基础设施正式落地，并将 `run_task` 工具化，统一接入 AI SDK 工具注册骨架。
- 第五轮完成 Workspace Backend、沙箱外访问审批和首批只读文件工具；阶段 7 保留外部智能体 Adapter 骨架。
- 最新一轮已把 `orchestrator` 迁移到真实 AI SDK tool calling，并通过 `deepseek/deepseek-v4-pro` 在 4096 端口完成群聊与单聊 smoke 验证。
- 本轮已将 Orchestrator 计划工具化：`write_plan` 成为计划主事实来源，计划通过 `tool.completed` 事件供 UI 渲染；不新增 `planId`，多次调用时最新成功工具结果为准。
