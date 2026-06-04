# 智能体侧能力缺口与闭环路线图

## 模块名称

Agent-side Capability Backlog

## 来源需求

原始课题文档 `docs/AgentHub- 多Agent协作平台设计.md` 对智能体侧提出以下核心要求：

- 多 Agent 群聊协作，由 Orchestrator 自动协调分工。
- 每个 Agent 是独立聊天对象，可单聊、群聊、被 `@`、被委派。
- 至少接入两个主流外部 Agent 平台，例如 Claude Code、Codex、OpenCode。
- 支持用户自建 Agent，可设定 System Prompt 和工具集。
- 聊天历史自动作为上下文，支持 pin 关键消息作为长期上下文。
- Agent 回复不仅是文本，还包括代码、文件、网页预览、Diff、部署状态等内联产物。
- 支持代码二次编辑、对话式局部修改和一键部署发布。

本文档记录这些要求在当前 AgentHub 智能体侧的闭环状态，作为后续阶段排期依据。

## 当前已基本闭环

- 内部预设主智能体：`orchestrator`、`coder`、`reviewer`、`writer`、`planner` 已通过 Runtime 统一执行协议运行。
- 隐藏子智能体：`explore`、`general`、`file`、`deploy` 已迁移到 `ai-sdk` 执行器，并由主智能体按授权委派。
- Orchestrator 基础编排：已具备 `write_plan` 和 `run_task`，可在群聊默认入口下拆分和委派任务。
- 基础文件工具：`ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file` 已接入 Runtime Tool Registry。
- 内部权限审批：文件敏感读写、沙箱外访问、命令执行等已有 Runtime permission lifecycle、HubServer 投影和 Web 交互基础。
- 用户问答续跑：`question` 工具已有 Runtime / HubServer / Web 基础闭环。
- 通用 Workspace Diff 与 ChangeSet 归因 V0：Runtime 在 Run 前后计算 git-based diff summary，HubServer 投影为 diff Artifact 与 Workspace ChangeSet，Web 支持摘要卡、只读 Diff Viewer 和 agent/task/tool/run 归因展示。
- OpenCode 基础接入：OpenCode 已作为外部可见主智能体接入，支持 direct conversation、Orchestrator delegated task、Session 持久化、模型只读展示、direct context bridge、event stream/tool timeline 和 permission bridge。

## 当前缺口与后续增强

### 1. 通用 Workspace Diff

状态：已闭环 V0 + ChangeSet 归因 V0，后续做交互增强。

当前 Runtime 已统一记录 Run 前后 baseline、变更文件列表、diffstat 和 bounded patch summary。Diff 不作为 OpenCode 私有能力实现，而是内部预设智能体、用户自定义写入智能体和外部智能体共享的平台能力。HubServer 已将有 changed files 的 terminal workspaceDiff 投影为 WorkspaceChangeSet；内部 `write_file` / `edit_file` 可基于路径唯一匹配归因到具体 toolCallId，OpenCode 等外部智能体 V0 保守展示 agent aggregate。

后续增强：Run revert / restore、冲突提示、完整版本历史、apply/pre-apply review 和更强的非 git workspace fallback。

### 2. OpenCode Event Stream 与工具 timeline

状态：已接入 Phase 4C，并完成基础集成硬化；仍可继续观察真实长任务表现。

当前 OpenCode Adapter 使用 `@opencode-ai/sdk/v2` 订阅 OpenCode event stream，并把主路径 `message.part.*` 以及前向兼容的 `session.next.*` 归一为 AgentHub `message.*`、`reasoning.*` 和 `tool.*`。Web 复用既有消息和 timeline 渲染逻辑，不为 OpenCode 单独建立浏览器直连或专属 UI 通道。

后续重点：在真实 OpenCode 长任务中继续观察高频 tool event 表现；基础断流 fallback 和 OpenCode tool MessagePart 恢复已经进入 hardening 回归。

### 3. OpenCode Permission Bridge

状态：已接入 Phase 4D，并完成基础集成硬化；真实 permission kind smoke 依赖用户 OpenCode 配置。

OpenCode 原生 `permission.updated` 已映射到 AgentHub `permission.*`，HubServer/Web 复用现有权限投影和 decision API，旧 `permission.asked` 作为 provider 兼容输入继续支持。AgentHub approve 固定回写 OpenCode `reply: "once"`；deny 和 Run cancel 固定回写 `reply: "reject"`。该能力不把 OpenCode 原生工具注册成 AgentHub Runtime Tool。

OpenCode V1 基础集成硬化已补齐 mock 回归与 gated real smoke。不同 permission kind 的真实触发依赖用户 OpenCode permission 配置，后续作为可选验收记录继续补充。

### 4. 第二个外部 Agent 平台

状态：未接入。

原始需求要求至少接入两个主流外部 Agent 平台。当前真实接入的是 OpenCode；Claude Code / Codex 只保留 provider enum 和 Adapter 方向，没有完整实现。后续应在 OpenCode V1 稳定后选择 Codex 或 Claude Code 作为第二个外部 Adapter，并复用 ExternalAdapterExecutor、ExternalAgentSession、Context Bridge、Workspace Diff 和 event mapping 设计。

建议阶段：OpenCode V1 集成硬化后启动外部 Agent Adapter V2。

### 5. 用户自建 Agent 产品化

状态：部分 Runtime 能力已存在，产品链路未闭环。

Runtime 已有用户自定义主智能体 CRUD 和模型绑定能力，但 HubServer 面向浏览器的管理 API、Web 配置 UI、对话式创建流程和完整工具集授权尚未完成。当前用户自定义 Agent 对 shell、network、deploy 等高风险能力也仍受限。

建议阶段：自定义 Agent Hub API + Web Authoring V1。

### 6. Pin 关键消息作为长期上下文

状态：数据层有雏形，智能体上下文未闭环。

会话置顶已经存在；`MessagePin` repository 也存在。但原始需求中的“pin 关键消息作为长期上下文”需要把被 pin 的消息注入内部智能体 prompt、OpenCode externalContext 和后续 context compaction 中。当前这条链路尚未完成。

建议阶段：Context Pin Bridge V1。

### 7. Artifact 产物投影

状态：数据模型和 UI 占位存在，Runtime 到产品投影未闭环。

HubServer 已有 Artifact / ArtifactVersion repository，Web 也有 Artifact 卡片组件和 mock preview。但 Agent 运行过程中产生的代码、文件、网页预览、文档、PPT、部署状态等，还没有稳定从 Runtime RunEvent 投影到 HubServer Artifact，再在 Web 中作为真实消息卡片恢复。

建议阶段：Artifact Projection V1。Workspace Diff Summary 可以作为第一个结构化产物摘要先落地。

### 8. 对话式局部修改

状态：未接入。

内部文件工具能按路径读写，但 Web 的代码选区、当前 Artifact、编辑器状态和用户“修改这一段”的自然语言请求还没有传入 Runtime。后续需要设计 selected context contract，并让 Coder/File 子智能体使用该上下文进行局部修改。

建议阶段：Selected Context + Local Edit V1。

### 9. 部署发布

状态：声明存在，真实工具未接入。

`deploy` 子智能体和 deploy permission 字段已存在，但没有 deploy Runtime Tool，没有部署状态卡片，也没有预览 URL、静态站点部署、容器化部署或源码打包下载流程。

建议阶段：Deploy Tool + Deployment Artifact V1。

### 10. Orchestrator 高级协作能力

状态：基础编排已完成，高级策略未闭环。

当前 Orchestrator 能写计划、委派任务并做基础汇总。尚未完成更强的失败降级、代码冲突处理、计划任务与实际 `run_task` 的强校验、复杂 DAG 恢复、多轮计划更新策略，以及多个显式 `@` 主智能体的并行入口与聚合策略。

建议阶段：Orchestrator Hardening V2。

### 11. 产品级 MessagePart 恢复

状态：实时 UI 有基础，恢复链路未完全闭环。

HubServer 会持久化 raw RunEvent，并投影文本消息、Run 状态、最新计划和部分权限/工具状态。task、tool、reasoning、permission 的完整产品级 MessagePart 投影和重启恢复仍未完成。OpenCode event stream 接入后，也需要进入同一恢复体系。

建议阶段：RunEvent Projection Hardening。

## 建议执行顺序

1. AgentHub Native Patch Review Phase 4：内部写入工具 proposed patch / pre-apply review。
2. Artifact Projection V1：把文件、网页预览、部署状态等结构化产物接到真实消息卡片；Diff 已作为首个 artifact 闭环。
3. 第二个外部 Agent Adapter：优先选择 Codex 或 Claude Code。
4. 用户自建 Agent 产品化：HubServer API、Web Authoring UI、工具集授权。
5. Context Pin Bridge：将 pin 关键消息注入内部智能体和外部 direct context。
6. Selected Context + Local Edit：支持选中代码后的对话式局部修改。
7. Deploy Tool + Deployment Artifact：部署状态卡和发布流程。
8. Orchestrator Hardening V2：失败降级、冲突处理、并行 `@` 与更强计划恢复。

## 风险与待确认点

- 第二个外部 Agent 选 Codex 还是 Claude Code，需要根据本地安装、SDK/CLI 可控性、事件流能力和权限桥接难度决定。
- Workspace Diff 的 agent/task 归因在多智能体并发写入时只能近似；V0 应先提供 aggregate summary，后续再细化。
- OpenCode permission bridge 已有 mock 覆盖；真实 OpenCode server 的不同 permission kind、拒绝后 agent loop 表现仍依赖用户 permission 配置，可作为可选 smoke。
- Artifact Projection 会跨 Runtime contract、HubServer persistence 和 Web UI，需单独路线图或扩展 `runs-chat-integration` roadmap。
- Pin 关键消息需要限制注入预算，避免与普通历史、external context 和 future summary/compaction 互相重复。
- Deploy 能力涉及真实外部服务或本机命令，应优先设计审批、环境隔离、凭据处理和失败回滚。

## 最近更新

- 2026-06-02：创建本文档，对照原始需求梳理智能体侧尚未接入或尚未闭环的能力，并确定 Phase 4B-4D 后续执行顺序。
- 2026-06-03：同步 OpenCode 4B/4C/4D 进度：通用 Workspace Diff V0、OpenCode Event Stream/Tool Timeline 与 Permission Bridge 均已落地；下一步转向 OpenCode V1 集成硬化和 Artifact Projection V1。
- 2026-06-04：同步 AgentHub Native Patch Review Phase 3 进度：Run 级完整 Diff 撤销 V0 已落地；下一步建议转向内部写入工具 proposed patch / pre-apply review，或按产品优先级推进 Artifact Projection V1。
- 2026-06-03：同步 OpenCode V1 基础集成硬化：新增真实 write smoke 开关、event stream fallback 回归和产品级 replay 回归；下一步建议转向 AgentHub Native Patch Review Phase 2。
- 2026-06-04：同步 AgentHub Native Patch Review Phase 2：Workspace ChangeSet 与归因 V0 已落地；下一步建议进入 Run Revert / Restore 或 Artifact Projection V1。
