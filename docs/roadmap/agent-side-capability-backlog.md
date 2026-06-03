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
- OpenCode 基础接入：OpenCode 已作为外部可见主智能体接入，支持 direct conversation、Orchestrator delegated task、Session 持久化、模型只读展示和 direct context bridge。

## 尚未接入或尚未闭环的能力

### 1. 通用 Workspace Diff

状态：未闭环。

当前内部智能体和 OpenCode 都可以修改 workspace，但 AgentHub 还没有统一记录 Run 前后 baseline、变更文件列表、diffstat 和 bounded patch summary。Diff 不应作为 OpenCode 私有能力实现，应是内部预设智能体、用户自定义写入智能体和外部智能体共享的平台能力。

下一阶段：Phase 4B：Workspace Diff Summary V0。

### 2. OpenCode Event Stream 与工具 timeline

状态：已接入 Phase 4C，仍需真实长任务 smoke 与恢复投影硬化。

当前 OpenCode Adapter 使用 `@opencode-ai/sdk/v2` 订阅 OpenCode event stream，并把 `session.next.text.delta`、`session.next.reasoning.*`、`session.next.tool.*` 归一为 AgentHub `message.*`、`reasoning.*` 和 `tool.*`。Web 复用既有消息和 timeline 渲染逻辑，不为 OpenCode 单独建立浏览器直连或专属 UI 通道。

后续重点：观察真实 OpenCode 长任务、断流和高频 tool event 表现；补齐完整产品级 MessagePart 持久化恢复。

### 3. OpenCode Permission Bridge

状态：未接入。

内部 Runtime Tool 权限已有审批链路，但 OpenCode 原生 permission request 还没有映射到 AgentHub `permission.*`，也没有把用户决定回写 OpenCode。该能力依赖 OpenCode event stream 和 permission payload 实测。

下一阶段：Phase 4D：OpenCode Permission Bridge。

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

1. Phase 4B：通用 Workspace Diff Summary V0。
2. Phase 4C：OpenCode Event Stream 与 Tool Timeline。
3. Phase 4D：OpenCode Permission Bridge。
4. Artifact Projection V1：把 Diff summary、文件、网页预览等结构化产物接到真实消息卡片。
5. 第二个外部 Agent Adapter：优先选择 Codex 或 Claude Code。
6. 用户自建 Agent 产品化：HubServer API、Web Authoring UI、工具集授权。
7. Context Pin Bridge：将 pin 关键消息注入内部智能体和外部 direct context。
8. Selected Context + Local Edit：支持选中代码后的对话式局部修改。
9. Deploy Tool + Deployment Artifact：部署状态卡和发布流程。
10. Orchestrator Hardening V2：失败降级、冲突处理、并行 `@` 与更强计划恢复。

## 风险与待确认点

- 第二个外部 Agent 选 Codex 还是 Claude Code，需要根据本地安装、SDK/CLI 可控性、事件流能力和权限桥接难度决定。
- Workspace Diff 的 agent/task 归因在多智能体并发写入时只能近似；V0 应先提供 aggregate summary，后续再细化。
- Artifact Projection 会跨 Runtime contract、HubServer persistence 和 Web UI，需单独路线图或扩展 `runs-chat-integration` roadmap。
- Pin 关键消息需要限制注入预算，避免与普通历史、external context 和 future summary/compaction 互相重复。
- Deploy 能力涉及真实外部服务或本机命令，应优先设计审批、环境隔离、凭据处理和失败回滚。

## 最近更新

- 2026-06-02：创建本文档，对照原始需求梳理智能体侧尚未接入或尚未闭环的能力，并确定 Phase 4B-4D 后续执行顺序。
