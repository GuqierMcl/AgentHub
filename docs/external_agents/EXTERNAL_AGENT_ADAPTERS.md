# 外部智能体接入公共设计

本文档定义 AgentHub 接入外部智能体的公共设计。外部智能体包括 OpenCode、Claude Code、Codex 以及后续其他独立 Agent 平台。

本设计的核心结论是：外部智能体在 AgentHub 中首先是一个可对话、可被编排、可产生消息和产物的“聊天对象”，不是 AgentHub 内部模型供应商、Skill、MCP 或工具体系的拆分对象。

## 1. 设计目标

- 外部智能体以可见主智能体身份参与 AgentHub IM 会话。
- 用户可以在单聊中直接与外部智能体对话，也可以在群聊中 `@` 外部智能体。
- Orchestrator 可以像委派其他预设主智能体一样委派外部智能体。
- 外部智能体的输出必须进入 AgentHub 统一 RunEvent、消息、权限、Artifact 和 Diff 投影链路。
- AgentHub 不管理外部智能体内部的模型供应商、Skill、MCP、原生工具或平台私有配置。
- 外部智能体的私有执行协议必须被 Adapter 封装，不能泄漏到 Runtime 上层编排协议。

## 2. 边界原则

### 2.1 AgentHub 负责

AgentHub 负责产品和编排边界：

- 会话、群聊、单聊、成员关系和 `@` 入口解析。
- Orchestrator 的任务拆分、委派和汇总。
- 用户可见聊天历史、pinned context、Artifact、Diff、权限卡和 Run 状态。
- 外部智能体的启动、连接、健康检查、取消和事件投影。
- 将外部智能体输出转换为 AgentHub 统一事件和消息。
- 在需要时将外部智能体的权限请求桥接到 AgentHub UI。

### 2.2 外部智能体负责

外部智能体保留自身平台能力：

- 模型供应商与模型选择。
- 平台原生 agents / skills / prompts。
- MCP、插件、命令、hook 和私有工具。
- 平台自身认证、配置文件和内部会话机制。
- 平台内部如何调用模型、工具和文件系统。

AgentHub 不把这些能力拆成自身配置面板。用户专注于“与这个外部智能体协作”，而不是在 AgentHub 里重新配置外部平台。

## 3. 智能体身份与可见性

外部智能体是可见主智能体：

- `tier = "primary"`。
- `origin = "external"`。
- `visibility = "visible"`。
- `entryPolicy = "callable"`。
- 默认 `delegationPolicy = "terminal"`。
- 默认不调用 AgentHub 内部子智能体。

用户显式调用外部智能体时，外部智能体以普通聊天对象身份回复。Orchestrator 委派外部智能体时，外部智能体也应产生普通可见发言，行为与其他系统预设主智能体保持一致。Orchestrator 可以在最终回复中总结、引用或衔接结果，但不应复述外部智能体已经可见的完整回复。

## 4. Project 与 Workspace

如果外部平台存在 Project 概念，应优先以 AgentHub 绑定的 workspace 目录作为 Project 边界。

规则：

- 同一个 canonical workspace 目录对应同一个外部 Project。
- 一个 AgentHub Run 最多绑定一个主 workspace；外部智能体执行也应使用该 workspace。
- Adapter 不应回退到 Runtime 全局工作目录。
- 如果会话没有绑定 workspace，而外部智能体需要项目目录，Adapter 应返回结构化错误或引导用户绑定 workspace。

Project 是代码环境边界，不等同于 AgentHub 会话。多个 AgentHub 会话可以共享同一个 workspace Project，但它们的外部 Session 应按会话和语境分开。

## 5. Session Scope

外部平台通常有自己的 Session。AgentHub 不能简单地把“AgentHub 会话”与“外部 Session”一一绑定，因为同一个群聊中存在直接对话和 Orchestrator 委派两种不同语境。

公共设计定义两类 Session scope。

### 5.1 Conversation-visible Session

面向用户直接对话：

- 单聊外部智能体。
- 群聊中用户显式 `@` 外部智能体。

该 Session 维护外部智能体在当前 AgentHub 会话中的用户可见对话记忆。它可以接收公共群聊历史摘要、pinned context、Artifact 引用、Diff 摘要和历史 handoff summary。

### 5.2 Delegated-task Session

面向 Orchestrator 委派任务：

- 每个被委派给外部智能体的任务使用 task scope。
- task scope 只接收完成该任务所需的窄上下文。
- task scope 不应污染 conversation-visible session 的原始上下文。

委派任务完成后，Adapter 或 HubServer 生成 handoff summary。后续用户直接 `@` 外部智能体时，conversation-visible session 可以通过该 summary 感知先前任务结果，而不是继承原始任务 prompt。

### 5.3 Session 映射事实来源

HubServer 是业务状态中心，应持久化外部 Session 映射。Runtime 可以创建或发现外部 Session，但不能把映射只保存在内存中。

映射应至少表达：

- provider。
- AgentHub conversation id。
- external agent id。
- workspace/project identity。
- configuration/profile identity。
- session scope。
- provider session id。
- 可选 parent session id。
- 可选 run id / task id。
- 最后同步到的 AgentHub 消息或事件位置。
- 可选 handoff summary。

## 6. 上下文组装

AgentHub 是用户可见上下文的事实来源。外部 Session 是外部平台的工作记忆，不是业务事实来源。

### 6.1 Direct Context

用户直接调用外部智能体时，Adapter 应组装：

- 当前用户消息。
- 当前会话中用户可见的公共历史。
- pinned 消息。
- 与当前任务相关的 Artifact 和 Diff 摘要。
- 其他可见智能体的公开输出。
- 外部智能体过去 delegated task 的 handoff summary。
- 当前 workspace 摘要。

不应注入：

- Orchestrator 私有计划提示。
- 其他智能体的隐藏 scratch/context。
- 内部工具原始续跑消息。
- 外部 delegated-task session 的原始任务包装 prompt。

### 6.2 Delegated Task Context

Orchestrator 委派外部智能体时，Adapter 应组装：

- Orchestrator 生成的 task title、instruction、expected output 和 risk level。
- 当前用户目标的必要摘要。
- 被选中的相关公共历史和 Artifact。
- workspace 摘要。
- 父 Run / task 的追踪身份。

该上下文面向任务执行，不等同于用户直接聊天上下文。

## 7. Handoff Summary

Handoff summary 是 delegated task 与后续 direct conversation 之间的桥。

它应记录：

- 外部智能体完成了什么。
- 关键结论。
- 重要文件变化。
- Diff 或 Artifact 引用。
- 失败、取消或权限拒绝状态。
- 源 task 和外部 Session 引用。

Handoff summary 可以进入：

- AgentHub raw RunEvent。
- task result。
- 群聊公共历史。
- 外部 conversation-visible session 的同步上下文。

Handoff summary 不应包含外部 task session 的原始私有 prompt 或 Orchestrator 的隐藏调度内容。

## 8. 权限桥接

外部智能体默认不进入 AgentHub Runtime Tool Registry。它们使用自身平台的原生工具和权限机制。

但为了统一用户体验，外部平台产生权限请求时，Adapter 应尽量桥接成 AgentHub permission events：

- `permission.requested`。
- `permission.approved`。
- `permission.denied`。
- `permission.cancelled`。

首版审批语义建议：

- AgentHub 用户批准映射为外部平台的一次性批准。
- AgentHub 用户拒绝映射为外部平台拒绝。
- “始终允许”需要 AgentHub 产品层支持明确作用域后再开放。

如果外部平台配置本身已经允许某些操作且不会发起权限请求，AgentHub 无法在 Adapter 层拦截这些操作。该能力属于用户信任外部平台配置的边界，应在 UI 和文档中说明。

## 9. 事件映射

Adapter 负责把外部平台事件转换成 AgentHub 稳定 RunEvent。

公共映射方向：

| 外部事件类别 | AgentHub 事件 |
| --- | --- |
| 文本输出 | `message.delta` / `message.completed` |
| 推理或 thinking 输出 | `reasoning.*`，仅当外部平台显式暴露 |
| 工具执行状态 | `tool.started` / `tool.completed` / `tool.failed` |
| 权限请求 | `permission.*` |
| 会话状态 | `agent.started` / `agent.completed` / `run.*` 的辅助依据 |
| 文件变化 | Diff / Artifact 投影，或首版 trace |
| 外部错误 | `agent.completed` error 或 `run.failed` / 稳定 `ADAPTER_*` 错误码 |

Adapter 应保留足够的 raw provider event 供调试，但面向 HubServer 和 Web 的产品投影应优先使用 AgentHub 稳定事件。

## 10. Artifact 与 Diff

外部智能体可能直接修改 workspace。AgentHub 需要在产品层可见这些变化。

设计要求：

- Run 开始前记录 workspace 摘要或快照引用。
- Run 结束后计算本次变更 Diff。
- Diff 归因到外部 agent、Run 和可选 task。
- 普通文本发言与文件变更应同时存在：用户既看到外部智能体说了什么，也能看到改了什么。
- 后续应支持一键查看、应用、回滚、版本历史和冲突处理。

首版可以先完成变更检测和 Diff 摘要，完整 Artifact 投影后续扩展。

## 11. 并发与取消

外部 Session 通常不是无状态模型调用。

规则：

- 同一个 conversation-visible session 同一时间只允许一个 active prompt。
- 同一个 delegated-task session 同一时间只允许一个 active prompt。
- 如果 Orchestrator 并行委派多个任务给同一个外部智能体，应创建多个 task session，或在 MVP 阶段串行化。
- AgentHub 取消 Run 时，Adapter 必须调用外部平台的 abort/cancel 能力。
- 取消后应输出 AgentHub 的终态事件，并尽量清理外部进程中的活动任务。

## 12. 失败与恢复

Adapter 必须处理：

- 外部 CLI 未安装。
- 外部 server 启动失败。
- 外部 server 崩溃。
- 事件流断开。
- 外部 Session 丢失或不可恢复。
- 权限请求超时或取消。
- Provider auth 失败。
- workspace 无效。

Runtime 不应泄漏底层异常堆栈给 Web。外部平台错误应转换为稳定错误码。当前 OpenCode V1 已使用的基础错误码包括 `ADAPTER_CONFIG_MISSING`、`ADAPTER_NOT_AVAILABLE`、`ADAPTER_WORKSPACE_REQUIRED`、`ADAPTER_SERVER_START_FAILED`、`ADAPTER_SERVER_UNHEALTHY`、`ADAPTER_WORKSPACE_MISMATCH`、`ADAPTER_SESSION_FAILED`、`ADAPTER_PROMPT_FAILED`、`ADAPTER_ABORT_FAILED` 和 `ADAPTER_EXECUTION_FAILED`；权限桥接阶段会继续补充 `ADAPTER_PERMISSION_*` 类错误。

## 13. 非目标

首版外部智能体接入不做：

- 在 AgentHub 中配置外部平台模型供应商。
- 在 AgentHub 中管理外部平台 Skill、MCP、plugin、command。
- 把外部平台原生工具注册为 AgentHub Runtime Tools。
- 让外部智能体直接调用 AgentHub 隐藏子智能体。
- 复杂多方编辑合并和自动冲突修复。
- 完整外部平台配置 UI。

## 14. 当前已确认决策

- 外部智能体作为 AgentHub 中的聊天对象接入。
- 用户关注与外部智能体协作，不在 AgentHub 中配置外部平台模型、Skill、MCP。
- 外部智能体输出在群聊中应与其他预设主智能体一样成为普通可见发言。
- Orchestrator 委派外部智能体时仍使用 task scope，避免污染用户 direct session。
- delegated task 完成后通过 handoff summary 同步到 direct context。
- 外部平台权限请求应桥接到 AgentHub UI。
- 同一 workspace 目录对应同一外部 Project。
- 外部 Session 需要按 conversation-visible 与 delegated-task 分 scope。
