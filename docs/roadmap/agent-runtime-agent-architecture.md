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
- Workspace Backend 与文件读写工具可通过统一抽象接入，并支持敏感路径与沙箱外访问审批。

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

- AgentDefinition、AgentRegistry。
- 系统预设主智能体与子智能体定义。
- `orchestrator` 默认入口规则。
- 内部智能体统一执行接口。
- Mock 执行器与执行事件协议。
- AI SDK 执行器模板。
- Workspace Backend 抽象、沙箱外访问审批、敏感路径审批和文件读写工具。
- 外部智能体 Adapter 骨架。
- Runtime 的 agents/runs 基础 API。
- 用户自定义主智能体 CRUD API。
- Runtime Tool Catalog、执行权限校验与内部审批续跑 API。

### 不包含

- HubServer 持久化和 SSE 代理。
- 前端 Agent 管理 UI。
- 真实外部 Agent 的完整接入。
- HubServer / 前端的权限审批代理、交互和持久化。
- 更复杂的并行恢复、冲突处理和可视化编排平台。

## 阶段拆分

### 阶段 1：智能体定义与注册表

目标：

- 建立 `AgentDefinition`、`AgentRegistry`。
- 内置 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 和子智能体。
- 实现本地 `agents.json` 加载与合并。

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

### 阶段 6：Workspace Backend、文件工具与审批续跑

目标：

- 建立 `WorkspaceHandle`、`WorkspaceBackendCapabilities`、`WorkspaceBackend`、`WorkspaceService`。
- 落地 `LocalWorkspaceBackend` 作为第一版本地 workspace 后端。
- 建立沙箱外目录/文件访问审批模型与受控授权挂载语义。
- 实现首批只读文件工具：`ls`、`read_file`、`glob`、`grep`，其中 `read_file` 支持图片多模态返回。
- 实现首批写入文件工具：`write_file`、`edit_file`，其中 `edit_file` V1 使用 search/replace。
- 将文件类工具接入 Runtime Tool Registry，并输出 `permission.requested` 等审批相关事件。
- 以 Tool Catalog 单源承载工具权限、风险、审批策略与用户 authoring metadata。
- 实现 Runtime 内部审批决定接口与同一 Run 的 AI SDK continuation。
- 实现 per-run workspace、敏感读取/写入审批、scoped read/write grant 和分支级续跑。

验收：

- Runtime 可以在 workspace-relative 路径上完成只读文件访问。
- Runtime 可以在 workspace-relative 路径上完成受控文本写入和 search/replace 编辑。
- 图片文件可通过 `read_file` 返回多模态内容。
- 访问沙箱外目录/文件时会触发审批，而不是直接暴露宿主机绝对路径。
- 访问敏感文件内容或写入敏感文件时会触发审批。
- 文件工具的能力、风险和可见性可以通过工具注册表统一过滤。
- Run 可以进入 `waiting_approval`，并在批准或拒绝后继续同一执行链路。

### 阶段 7：外部智能体 Adapter 骨架

目标：

- 建立外部智能体统一接口。
- 为 OpenCode、Claude Code、Codex 留出统一接入点。
- 先完成能力描述和事件映射，不做完整实接。

验收：

- 外部智能体被统一视为主智能体。
- Runtime 内部协议无需为外部平台分叉。

## 当前进度

阶段 1 和阶段 2 已完成。阶段 3 已完成 Agents 查询 API、用户自定义主智能体 CRUD API、Run API、IM 会话入口解析和 SSE 事件骨架。阶段 4 已完成 `orchestrator` 的 AI SDK tool calling、`write_plan` 计划工具、`run_task` 内部任务工具化、任务组事件、依赖表达和批次并行委派；委派边界已从静态 `AgentRelation` 收敛为 `participantAgentIds` + `allowedSubagents`。阶段 5 已完成最小 AI SDK 执行器、provider/model 解析、agent 模型绑定回显、按主智能体配置模型的 API、系统预设主智能体系统提示词集中化，以及 AI SDK fullStream 的 `model.stream.part` 透传和 `reasoning.*` RunEvent。阶段 6 已完成 Workspace Backend、文件读写工具、工具目录与权限单源化、per-run workspace、敏感读写审批、scoped read/write grant，以及 Runtime 内部审批续跑闭环。隐藏子智能体已迁移到 `ai-sdk` 执行器，并按直接调用方继承模型；阶段 7 继续保留外部 Adapter 骨架。

## 已完成

- `AGENT_ARCHITECTURE.md` 已建立并补充最新共识。
- 主智能体 / 子智能体两级架构已确认。
- `orchestrator` 定位为特殊系统预设主智能体已确认。
- 内部智能体统一协议、外部智能体 Adapter 边界已确认。
- 阶段 1 已落地 `AgentDefinition`、系统预设主智能体、隐藏子智能体、本地 JSON 只读加载和 `AgentRegistry`。
- 阶段 3 已附带落地 `GET /runtime/agents` 与 `GET /runtime/agents/:agentId`。
- 阶段 3 已补齐用户自定义主智能体 CRUD：`POST /runtime/agents`、`PUT /runtime/agents/:agentId`、`DELETE /runtime/agents/:agentId`，并继续复用独立模型绑定 API。
- 阶段 2 已落地 `AgentExecutor`、最小 RunEvent 协议和 `MockExecutor`。
- 阶段 3 已落地 `POST /runtime/runs`、`GET /runtime/runs/:runId`、`GET /runtime/runs/:runId/events`、`POST /runtime/runs/:runId/cancel`。
- 阶段 3 已落地 IM 会话入口解析：单聊绑定主智能体、群聊默认 `orchestrator`、群聊单 @ 指定主智能体。
- 阶段 4 已落地 `orchestrator` AI SDK tool calling、`write_plan` 计划工具、`run_task` 内部任务工具、任务组事件、任务生命周期事件和并行委派。
- 委派关系已弃用 `AgentRelation` / `agent-relations.json`，改为主智能体间由当前 Run participants 决定，主智能体到子智能体由 `allowedSubagents` 决定。
- 阶段 4-5 之间已补齐 Runtime Tool 基础设施、`write_plan` / `run_task` 正式工具化、工具事件协议和 AI SDK 工具注册骨架。
- 阶段 5 已落地最小 `AiSdkExecutor`、provider/model 解析、`orchestrator` / 主智能体模型绑定返回，以及 agent 模型绑定 API。
- 系统预设主智能体 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 已统一从 `agent-runtime/src/agents/preset-agent-prompts.ts` 读取系统提示词。
- AI SDK 执行层已输出 `model.stream.part` 透传事件，并将 provider/AI SDK 显式暴露的 reasoning/thinking 提升为 `reasoning.started`、`reasoning.delta`、`reasoning.completed`；独立 SSE 契约见 `docs/contracts/RUNTIME_SSE_EVENTS.md`。
- `planner` 已收敛为人类可读方案顾问，`delegationPolicy = "terminal"`，不承担运行时任务委派，避免与 `orchestrator` 职责重叠。
- 阶段 6 已落地 `WorkspaceService`、`LocalWorkspaceBackend`、沙箱外访问请求与授权挂载语义，以及首批只读文件工具 `ls`、`read_file`、`glob`、`grep`。
- 阶段 6 已落地首批写工具 `write_file`、`edit_file`：支持 UTF-8 文本写入、overwrite 冲突保护和 search/replace 编辑冲突检测。
- 工具权限、风险、审批策略与 Authoring Options metadata 已统一由 Runtime Tool Catalog 提供；`allowedTools` 仅负责可见性，`permissionPolicy` 负责 agent 能力上限。
- Runtime 内部审批闭环已落地：`waiting_approval`、permission lifecycle events、权限查询/决定 API，以及同一 `runId` / `toolCallId` 的 AI SDK 续跑。
- per-run workspace 隔离已落地：`RunInput.workspace` 可绑定一个固定本地目录；无 workspace 的 Run 可纯对话，文件工具返回 `WORKSPACE_NOT_BOUND`；Run 查询、普通事件和工具成功结果不回显真实绝对路径。
- 敏感读取审批已落地：workspace 内 `.env`、`AGENTS.md`、`.npmrc`、密钥文件和 VCS 元数据等显式内容读取需要审批；`ls` / `glob` 隐藏敏感路径，递归 `grep` 跳过敏感文件。
- 读取 grant 已扩展为 scoped per-run grant：支持 `external_read`、`sensitive_read`、`external_sensitive_read`，并支持 delegated task 分支 continuation 与同一 frame 多审批请求的合并续跑。
- 写入 grant 已落地：workspace 内普通文件写入无需逐次审批；敏感写入、沙箱外写入和沙箱外敏感写入通过 scoped write grant 审批后续跑。
- `coder`、`writer` 和 `file` 子智能体已获得 `write_file` / `edit_file` 与 `filesystem: "write"`；用户自定义主智能体可显式选择写工具，但必须配置 `filesystem: "write"`。
- 隐藏子智能体 `explore`、`general`、`file`、`deploy` 已迁移到 `ai-sdk` 执行器。子智能体不支持模型绑定，执行时继承直接调用方的模型，同时保留自身工具、权限、系统提示词和身份。
- `AGENT_RUNTIME_BACKEND.md` 已建立，明确 Workspace Backend、沙箱外访问审批和本地优先实现。
- `AGENT_TOOLS.md` 已建立，明确工具可见性、`run_task` 语义、事件流和并发约束。

## 待办

- 扩展 `orchestrator` 的更完整计划策略、汇总策略和错误恢复。
- 后续补充计划持久化、计划任务与 `run_task` 的强校验，以及前端 UI 投影。
- 补齐 HubServer 对 Runtime RunEvent 的消费、持久化和 SSE 转发，使产品链路从直接 Runtime smoke 测试闭合到 `web -> hub-server -> agent-runtime`。
- 系统智能体层已开始落地：`title` 由 Runtime 在会话仍需自动命名时触发，继承入口智能体模型快照，只使用会话第一条用户输入；标题结果一旦 ready 且 Run 未结束会立即作为 `system_agent.completed` 进入同一 Run SSE，主智能体完成时保留短 flush 宽限兜底，模型标题没赶上或失败时会在 `run.completed` 前输出基于首条用户消息的 fallback 标题事件。HubServer 已消费该事件并在标题未被用户手动修改时更新会话标题；`summary` 和 `compaction` 仍为后续扩展。
- 补齐 HubServer 面向浏览器的自定义 Agent 管理 API 与前端配置 UI。
- 在 HubServer 与前端补齐 Runtime 权限审批的代理、用户交互、状态展示与持久化。
- 补充 AI SDK 工具循环、结构化输出和更完整的 agent 运行参数映射。
- 后续按 UI 需求从 `model.stream.part` 增量投影 `source`、`file`、`tool-input-*` 等更多稳定语义事件。
- 实现外部智能体 Adapter 骨架。
- 后续设计并行 @ 多个主智能体的事件流与聚合策略。
- 后续扩展 Patch / diff artifact、一键 apply、版本历史、回滚和更复杂的写入冲突处理。

## 风险与待确认点

- 自定义子智能体、外部智能体 CRUD 仍未开放；如后续需要，需要单独设计权限和 Adapter 配置模型。
- `GET /runtime/agents` 是否默认只返回可见主智能体。
- `deploy` 子智能体的权限与审批策略在第一版中是否只做声明不执行。
- 外部智能体是否需要先支持只读执行能力。
- 目前阶段已明确只允许单个 @，并行 @ 作为后续版本能力。
- 当前写工具只支持文本写入与 search/replace 编辑；Patch artifact、三方合并和批量目录写入仍需单独设计。

## 最近更新

2026-05-25

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
- 本轮已收敛 Runtime Tool Catalog 与 per-agent permission policy：工具元数据不再分散在 router 或 CRUD 白名单中，读取工具要求显式 `filesystem: "read"`。
- 本轮已闭环 Runtime 内部审批续跑：沙箱外只读访问支持 `waiting_approval`、permission API、受控 read grant 与 AI SDK 二次生成恢复；HubServer/UI 集成留待后续。
- 本轮已完成 per-run workspace 隔离、敏感读取审批和分支级 continuation：Run 可绑定固定 local workspace；文件工具不再回退到全局 `config.workdir`；敏感读取和沙箱外敏感读取通过 scoped read grant 恢复原执行分支。
- 本轮已完成 `write_file` / `edit_file`、write grant 与敏感/沙箱外写入审批；写工具已接入 Tool Catalog、Authoring Options 和 per-agent permission policy。
- 本轮已将隐藏子智能体迁移到 `ai-sdk` 执行器，并确定子智能体不绑定模型、执行时继承直接调用方模型。
- 本轮已增强 Run SSE 事件契约：AI SDK `fullStream` 通过 `model.stream.part` 薄封装透传，reasoning/thinking 默认提升为 `reasoning.*`，`raw` chunk 仅显式 opt-in，并新增 `RUNTIME_SSE_EVENTS.md` 作为事件契约专文。
