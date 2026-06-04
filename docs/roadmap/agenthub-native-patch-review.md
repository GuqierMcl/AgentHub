# AgentHub Native Patch Review 路线图

## 模块名称

AgentHub Native Patch Review / Workspace Change Review

## 目标

让 AgentHub 自己具备类似成熟代码 Agent 产品的代码变更体验：用户不仅能看到智能体说了什么，还能清楚看到它改了哪些文件、每个文件如何变化、这些变化来自哪个 Run / agent / task / tool，并能在合适的阶段审查、回滚或批准应用。

该能力是 AgentHub 平台级能力，不是 OpenCode Adapter 专属能力。OpenCode 只是一个参照物：AgentHub 需要拥有自己的 Diff、Patch、Review、Revert 和变更归因链路；OpenCode、内部 AI SDK 智能体、隐藏 `file` 子智能体和用户自定义写入智能体都应复用同一套产品体验。

## 完成标准

- 聊天消息中的 Diff 卡片可以打开完整 Diff Viewer。
- 用户可以查看文件树、文件级摘要、hunk、增删行、二进制/截断/dirty baseline 状态。
- Diff Artifact 可持久化、可重启恢复，并能从聊天卡片进入详情。
- AgentHub 能把代码变更与 `runId`、`agentId`、`taskId`、`messageId`、`toolCallId` 等上下文尽量关联。
- 用户可以对一次 Run 的变更执行安全的 revert，且 dirty baseline / 冲突情况下有明确提示。
- 内部 AgentHub 写入工具可以进入 proposed patch / pre-apply review 流程。
- 外部智能体直接写 workspace 时，有清晰的隔离、观察或合入策略，不把“事后看到变化”伪装成“事前审查过变化”。

## 依赖文档

- `docs/architecture/AGENT_RUNTIME.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/architecture/WEB.md`
- `docs/architecture/HUB_SERVER.md`
- `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`
- `docs/contracts/RUNTIME_SSE_EVENTS.md`
- `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`
- `docs/external_agents/OPENCODE_ADAPTER.md`
- `docs/roadmap/opencode-adapter-implementation.md`
- `docs/roadmap/agent-side-capability-backlog.md`

## 范围

### 包含

- 平台级 workspace change summary、diff artifact 和 diff viewer。
- Diff Artifact 详情 API、持久化恢复和 Web 展示。
- 变更文件、hunk、增删行、patch 截断、binary file、dirty baseline 的产品语义。
- Run / agent / task / tool / message 级变更归因。
- Run 级 revert / unrevert 能力。
- AgentHub 内部写入工具的 proposed patch / pre-apply review。
- 外部智能体写入的隔离执行或后审查合入策略。

### 不包含

- 在 AgentHub 中复刻 OpenCode TUI。
- 直接依赖 OpenCode 的 session diff 作为 AgentHub 的核心事实来源。
- 首版支持复杂三方 merge、跨 Run 自动冲突修复或多人协作评审。
- 首版支持非 git workspace 的完整文件系统快照 diff。
- 首版把外部智能体原生工具全部改造成 AgentHub Runtime Tools。

## 阶段拆分

### Phase 0：Workspace Diff Summary Foundation（已完成）

目标：

- Runtime 在 Run 前后捕获 workspace git baseline。
- 终态 `run.completed` / `run.failed` / `run.cancelled` 携带 `data.workspaceDiff`。
- HubServer 将有文件变化的 summary 投影为 `Artifact(type="diff")` 与 ArtifactVersion。
- Web 在聊天消息中展示 Diff 摘要卡片，并支持 live / persisted replay。
- dirty baseline 下过滤未变化的既有脏文件。
- 未跟踪文本文件 best-effort 统计新增行；没有有效行数时 UI 不显示 `+0/-0`。

验收：

- 内部智能体和 OpenCode 修改 workspace 后，聊天里能看到真实 Diff 摘要卡片。
- 重启 HubServer / Web 后，Diff 卡片仍能恢复。
- 非 git、无 workspace、git 超时等情况结构化降级，不导致 Run 失败。

### Phase 1：Diff Artifact Detail 与只读 Diff Viewer（已完成）

目标：

- 为 Diff Artifact 提供详情读取路径，Web 可以从聊天卡片打开完整详情。
- 解析 `ArtifactVersion.diffJson` 与 bounded patch，生成文件树和 hunk 视图。
- 展示 changed files、status、additions/deletions、binary、truncated、baseline dirty、runOnlyReliable。
- 支持从 viewer 回到聊天消息和关联 Run。
- 首版只读，不提供 apply / revert / accept hunk。

验收：

- 点击 Diff 卡片能打开右侧工作台或弹层里的 Diff Viewer。
- Viewer 能展示文件列表、每个文件的 patch/hunk、增删行和截断提示。
- persisted Diff Artifact 刷新后仍能打开详情。
- 没有 bounded patch 或 patch 被截断时，Viewer 仍展示文件级摘要和原因。
- UI 清楚声明 dirty baseline 时“不是精确 run-only patch”。

为什么下一步最适合做它：

- 已有 Runtime summary、HubServer Artifact 和 Web 卡片，Phase 1 可以直接复用现有数据。
- 用户当前最直接的痛点是“卡片太粗，只知道改了，不知道怎么改”。
- Revert、pre-apply review、hunk accept/reject 都需要一个可靠的 Diff Viewer 作为交互基础。
- 不需要先接 OpenCode event stream 或 permission bridge；那些是外部智能体链路增强，不是 AgentHub 原生 Patch Review 的最短路径。

### Phase 2：Workspace ChangeSet 与变更归因（已完成 V0）

目标：

- 引入平台级 `WorkspaceChangeSet` 概念，表达一次 Run 或一次工具调用造成的文件变化集合。
- 对内部 `write_file` / `edit_file` 工具基于路径匹配记录 toolCallId、messageId、agentId、taskId 归因。
- 外部智能体先保守归因到 Run 和 agent；V0 不解析 provider 私有工具 payload。
- HubServer 将 ChangeSet 与 Artifact、RunEvent、Message 建立可恢复关联。

验收：

- Diff Viewer 能显示“由哪个 agent / task / tool 产生”。
- 内部写入工具的文件变化可归因到具体 toolCallId。
- 外部智能体无法细分时，UI 明确展示为 Run-level / agent-level aggregate。
- 多个 agent 在同一 Run 写入时，ChangeSet 不把归因说得比实际更精确。

实现边界：

- HubServer 新增 `WorkspaceChangeSet` / `WorkspaceChangeSetFile` 持久化模型，`sourceEventId` 唯一保证 terminal RunEvent replay 幂等。
- Terminal `workspaceDiff` 投影继续创建 `diff` Artifact，同时为有 changed files 的结果创建 ChangeSet；no-change summary 不创建。
- 单个内部 `write_file` / `edit_file` 匹配某个 changed file path 时，该文件归因为 `tool + inferred`。
- 同一文件匹配多个写入工具时，文件与 ChangeSet 归因为 `run + ambiguous`，候选 toolCallIds 进入 metadata，UI 显示“归因不确定”。
- OpenCode 等外部智能体 V0 只归因为 `agent + aggregate`，并可携带 taskId；不把 OpenCode 原生工具伪装成 AgentHub 内部写入工具。
- `GET /api/conversations/:conversationId/artifacts/:artifactId` 的 diff detail 返回 `changeSet` 与文件级 `attribution`；旧 Diff Artifact 没有关联 ChangeSet 时继续兼容。
- 本阶段仍不做 revert、pre-apply review、hunk accept/reject、隔离 workspace 或 per-tool 精确 patch capture。

### Phase 3：Run Revert / Restore

目标：

- 基于 git patch 或 captured baseline 为一次 Run 提供 revert 操作。
- Revert 操作进入 HubServer API，再由 Agent Runtime 执行受控 workspace 修改。
- Revert 前展示将要撤销的文件列表和风险提示。
- dirty baseline、patch truncated、文件已被后续修改、冲突等情况返回结构化 blocked/degraded 状态。

验收：

- 对 clean baseline 的简单 Run，用户可以一键撤销本次文件修改。
- Revert 后产生新的 `WorkspaceChangeSet` / Diff Artifact，说明撤销了什么。
- dirty baseline 或冲突情况下不静默执行危险撤销。
- Revert API 与 UI 不依赖浏览器直接访问本机文件。

### Phase 4：AgentHub 内部写入工具的 Proposed Patch / Pre-Apply Review

目标：

- 将内部 `write_file` / `edit_file` 从“直接写入”扩展为可选 proposed patch 模式。
- 智能体生成 patch 后先进入 `patch.proposed` / Artifact review 状态。
- 用户可以批准应用、拒绝、或要求智能体修改 patch。
- 批准后由 Runtime 应用 patch，并产生正式 `WorkspaceChangeSet`。

验收：

- 对高风险文件或用户选择 review mode 时，内部智能体不会直接写入，而是提交 proposed patch。
- UI 能展示 proposed patch，并提供“应用 / 拒绝”操作。
- 应用失败、冲突、文件变更过期都有结构化错误。
- 该能力先覆盖 AgentHub 内部工具，不强行套到外部智能体。

### Phase 5：外部智能体写入的隔离与合入策略

目标：

- 为 OpenCode、Claude Code、Codex 等外部智能体提供 AgentHub-native 的变更审查边界。
- 可选策略包括：独立 git worktree、临时 branch、overlay workspace 或 provider permission bridge。
- 外部智能体在隔离环境中执行后，AgentHub 展示 patch，由用户决定是否合入主 workspace。
- 如果仍允许外部智能体直接写主 workspace，UI 必须明确这是 post-run observed diff，不是 pre-apply review。

验收：

- 外部智能体可以在隔离 workspace 中完成修改，并把结果作为 Diff Review 呈现。
- 用户批准后再合入主 workspace。
- 合入失败或冲突时有明确恢复路径。
- OpenCode Permission Bridge 可作为辅助能力，但不作为 AgentHub Patch Review 的唯一基础。

### Phase 6：版本历史、冲突处理与协作审查

目标：

- 为 Artifact / ChangeSet 提供版本历史。
- 支持多轮智能体修改的比较、回滚和重做。
- 支持冲突检测、冲突解释和人工选择。
- 后续可扩展到评论、多人审查、PR/commit 生成等协作流程。

验收：

- 用户能查看同一文件在多轮 Run 中的修改历史。
- 可以比较两个 ChangeSet 或 ArtifactVersion。
- 冲突状态可解释、可恢复，不破坏 workspace。
- 可以从 ChangeSet 生成 commit message 或 PR draft。

## 当前进度

- Phase 0 已落地：通用 Workspace Diff Summary V0、HubServer diff Artifact 投影、Web live/persisted 摘要卡片。
- Diff 卡片已中文化，并修正了未跟踪文本文件行数与 `+0/-0` 展示问题。
- Phase 1 已落地：HubServer 提供 conversation-scoped Diff Artifact Detail API；Web 支持从 live/persisted Diff 卡片打开右侧“代码审查”只读 Diff Viewer，展示文件列表、hunk、增删行、binary、truncated、dirty baseline 和 runOnlyReliable 提示。
- Phase 2 已落地 V0：HubServer 从 terminal `workspaceDiff` 推导并持久化 Workspace ChangeSet；Web 右侧“代码审查”展示顶部来源、文件级归因 badge、tool/task/agent/message 细节与 ambiguous 候选提示。
- 还没有 Run revert、pre-apply review 或隔离合入。
- OpenCode Adapter roadmap 中的 Phase 4C/4D 仍重要，但它们主要服务外部智能体事件和权限桥接，不应替代 AgentHub Native Patch Review 主线。

## 已完成

- Run-level workspace diff summary。
- Diff Artifact + ArtifactVersion 持久化。
- Diff 摘要卡片 live / persisted replay。
- Diff Artifact Detail API。
- 只读 Diff Viewer。
- WorkspaceChangeSet / WorkspaceChangeSetFile 归因 V0。
- Diff Viewer 归因展示。
- dirty baseline 过滤。
- 未跟踪文本文件新增行数 best-effort 统计。
- 无有效行数时不展示 `+0/-0`。

## 待办

- Phase 3：Run Revert / Restore。
- Phase 4：AgentHub 内部写入工具 proposed patch / pre-apply review。
- Phase 5：外部智能体隔离执行与合入策略。
- Phase 6：版本历史、冲突处理与协作审查。

## 风险与待确认点

- 当前 bounded patch 有大小预算；Diff Viewer 需要处理 patch 缺失或截断。
- dirty baseline 下无法保证精确 run-only patch；UI 和 API 都必须保守表达。
- 外部智能体直接写主 workspace 时，AgentHub 只能事后观察，不能承诺事前审查。
- Revert 可能与用户后续手动修改冲突，需要严格 blocked/degraded 状态。
- Proposed patch review 会改变内部写入工具的执行语义，需要明确哪些 agent、哪些文件或哪些风险级别默认进入 review。
- 隔离 workspace / worktree 会增加运行成本和状态管理复杂度。

## 最近更新

- 2026-06-02：创建路线图，将“类似 OpenCode 的代码变更体验”定义为 AgentHub 平台级 Native Patch Review，而不是 OpenCode Adapter 专属体验；确认下一步最适合做 Phase 1：Diff Artifact Detail 与只读 Diff Viewer。
- 2026-06-02：完成 Phase 1：新增 `GET /api/conversations/:conversationId/artifacts/:artifactId` 详情 API，Web Diff 卡片可打开右侧只读 Diff Viewer；live 卡片使用内存 `workspaceDiff` 即时展示，persisted 卡片可通过 Artifact Detail API 恢复。
- 2026-06-04：完成 Phase 2 V0：新增 Workspace ChangeSet 持久化与归因展示，内部写入工具可归因到 toolCallId，外部智能体保守展示 agent aggregate，ambiguous 情况不做伪精确归因。
