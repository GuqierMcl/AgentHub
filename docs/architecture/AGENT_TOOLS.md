# 工具体系设计

本文档定义 Agent Runtime 的工具体系架构，约束后续 `tool`、`run_task`、审批、事件流与并发执行的设计与实现。

工具不是提示词技巧，也不是模型内部黑盒，而是 Runtime 暴露给受控智能体的执行原语。所有工具必须经过注册、过滤、授权和事件化，才能被模型调用。

## 1. 设计目标

- 工具体系必须服务于 Runtime 的执行边界，而不是替代智能体分层。
- 主智能体、子智能体、外部智能体的工具能力必须可区分、可过滤、可审计。
- `orchestrator` 仍然是特殊主智能体，不是独立控制层。
- `run_task` 是内部任务工具，不是通用 RPC，也不是直接暴露给用户的 API。
- 工具调用必须输出统一事件，供 UI、日志和重放使用。
- 工具调用的并发、取消、超时和失败传播必须有明确语义。

## 2. 工具分层

工具体系分为三个逻辑层级：

### 2.1 Runtime Tools

Runtime Tools 是由 Agent Runtime 统一实现和托管的内部工具，例如：

- `run_task`
- `write_plan`
- 只读上下文检索类工具
- 文件操作类工具
- 网络请求类工具
- Shell 命令类工具
- 部署类工具

这类工具属于 Runtime 的能力边界，必须由注册表和权限系统统一控制。

### 2.2 Agent Tools

Agent Tools 是某个具体智能体在当前 Run 中实际可见、可调用的工具集合。

它不是一套新的工具实现，而是 Runtime Tools 在当前 agent / run / permission 上下文下的过滤结果。

### 2.3 Adapter Tools

Adapter Tools 属于外部智能体平台内部的工具模型，例如 OpenCode、Claude Code、Codex 的原生工具能力。

这类工具不应直接污染 Runtime 的公共工具协议，只能由 Adapter 在内部做映射。

## 3. 工具命名

- 工具名使用 `snake_case`。
- 工具名必须稳定、短、可读。
- 不建议引入复杂命名空间，除非后续出现明确冲突。
- `run_task` 是保留名，表示内部任务委派原语。
- `write_plan` 是保留名，表示 Orchestrator 的 UI 可渲染计划写入原语。
- `bash` 是保留名，表示 Runtime 托管的非交互式平台 shell 命令执行工具；工具名固定为 `bash`，但底层不保证是 GNU Bash。
- `question` 是保留名，表示 Runtime 托管的用户问答续跑工具；它不是权限审批工具。

建议风格：

- `run_task`
- `write_plan`
- `read_context`
- `read_file`
- `apply_patch`
- `deploy_task`

## 4. 可见性与选择

工具可用性不是全局常量，而是运行时计算结果。

工具是否可见，由 `AgentDefinition.allowedTools` 统一决定：

- `agent.allowedTools`

结论：

- `RuntimeToolRegistry` 不维护工具侧智能体白名单。
- `preset-agents.ts`、`preset-subagents.ts` 和用户自定义智能体配置中的 `allowedTools` 是工具可见性的事实来源。
- `run_task`、`write_plan` 只应出现在 `orchestrator.allowedTools` 中。
- `internal` 只表示默认不注入普通 AI SDK tool set；Orchestrator 专用路径可通过 `includeInternal=true` 取到 internal tools，但仍必须满足 `allowedTools`。
- 文件、部署、网络类工具的具体执行仍必须通过权限策略、沙箱和审批流程约束。
- 用户自定义智能体可配置的工具由 Tool Catalog 中的 `configurableByUserAgent` 投影得到，不再维护额外白名单。
- `question` 对所有内部 AI SDK 智能体隐式可见，包括系统预设主智能体、隐藏子智能体和用户自定义 AI SDK 智能体；它不出现在 authoring options 中，外部 adapter 不注入。
- 外部智能体默认不进入 Runtime Tool Registry。

## 5. 工具契约

每个工具都应具备以下元数据：

- `name`
- `displayName`
- `description`
- `category`
- `inputSchema`
- `riskLevel`
- `requiredPermissions`
- `approvalPolicy`
- `configurableByUserAgent`
- `deferred`
- `internal`
- `execute`

推荐定义：

```ts
type ToolDefinition = {
  name: string
  displayName: string
  description: string
  category: string
  inputSchema: unknown
  riskLevel: "low" | "medium" | "high"
  requiredPermissions: Partial<AgentPermissionPolicy>
  approvalPolicy: "never" | "contextual" | "always"
  configurableByUserAgent: boolean
  deferred?: boolean
  prepareExecution?: (input: unknown, context: ToolExecutionContext) => Promise<ToolPreflightDecision | null>
  prepareApproval?: (input: unknown, context: ToolExecutionContext) => Promise<ToolApprovalDraft | null>
  internal?: boolean
  execute(input: unknown, context: unknown): Promise<unknown>
}
```

约束：

- 所有输入必须先做 schema 校验。
- 工具返回必须是结构化对象，不允许只返回裸字符串作为主协议。
- 工具实现不得绕开事件系统直接修改业务态。

## 6. 事件与结果

工具执行必须输出两类信息：

### 6.1 Model-visible result

这是模型最终能看到的工具结果，只保留业务语义，建议包含：

- `status`
- `summary`
- `data`
- `error`

模型不应直接消费内部追踪地址、工作目录、调试细节或权限实现细节。

### 6.2 Runtime trace

这是给 UI、日志、重放和调试使用的运行痕迹，建议包含：

- `toolCallId`
- `runId`
- `taskRunId`
- `parentAgentId`
- `parentTaskId`
- `groupId`
- `eventsUrl`

Runtime trace 可以和 parent run 的事件流关联，但不应作为模型输出的主要部分。

### 6.3 工具事件

工具执行应至少产生以下事件：

- `tool.started`
- `tool.completed`
- `tool.failed`
- `permission.requested`
- `permission.approved`
- `permission.denied`
- `permission.cancelled`
- `question.requested`
- `question.answered`
- `question.cancelled`

当工具、审批或用户问答发生在某个模型输出上下文中，Runtime 应把当前消息容器的 `messageId/messageIndex` 写到对应 `tool.*` / `permission.*` / `question.*` RunEvent。UI 和后续 HubServer 持久化应优先把这些事件聚合到同一条 assistant message，而不是默认生成独立聊天发言；`run_task` 仍按后文规则只保留追踪，不渲染为普通工具卡片。

如果工具对应的是内部任务，还应继续产出：

- `task.started`
- `task.completed`
- `task.failed`

## 7. `write_plan` 设计

`write_plan` 是 Orchestrator 用来记录当前计划的原语。它和 DeepAgents 的 todo 写入类工具类似，目标是把计划变成工具结果，供 UI 和 HubServer 从事件流中渲染，而不是依赖私有事件或自然语言解析。

### 7.1 语义

- 一个 `write_plan` 调用只写入当前 Run 的一份计划结果。
- 不新增 `planId`；追踪使用现有 `runId + toolCallId + event.id`。
- 同一 Run 内可以多次调用 `write_plan`；最后一个成功的 `tool.completed(toolName="write_plan")` 是当前计划。
- `write_plan` 不执行任务，不产生 `task.*` 事件。
- `write_plan` 与 `run_task` 是软约束关系：Prompt 要求先写计划，但 Runtime 不强制拦截未计划任务。
- Orchestrator 应在委派任务完成、失败或取消后，用相同 `taskId` 再次调用 `write_plan` 更新对应任务的 `status`；并行任务建议在一个批次结果明确后批量更新一次，避免过度消耗模型工具步数。

### 7.2 输入与输出

第一版计划输入包含：

- `intent`
- `summaryInstruction`
- `tasks`

每个任务包含：

- `taskId`
- `title`
- `targetAgentId`
- `instruction`
- `expectedOutput`
- `riskLevel`
- `dependsOn`
- `status`

工具输出为统一工具结果，其中 `data.plan` 是前端可直接渲染的结构化计划。`status` 字段来自 Orchestrator 写入的计划状态，当前 Runtime 不会自动用 `task.completed` / `task.failed` 回填计划任务状态。

### 7.3 事件流

`write_plan` 只产生工具事件：

- `tool.started`
- `tool.completed`
- `tool.failed`

UI 或 HubServer 应从事件流中选择最后一个成功的 `tool.completed(toolName="write_plan")` 作为当前计划。`orchestrator.plan.created` 保留为兼容和后续扩展事件，但不是当前计划主事实来源。

## 8. `run_task` 设计

`run_task` 是 Orchestrator 用来创建内部任务的原语。

### 8.1 语义

- 一个 `run_task` 调用只拉起一个智能体执行一个任务。
- `run_task` 不负责多任务 DAG 本身，DAG 编排属于 orchestrator 的计划层。
- 模型可以在同一轮中同时发起多个 `run_task` 调用。
- Runtime 可以并行执行这些工具调用，但要受内部并发上限控制。

### 8.2 输入

`run_task` 的输入应只表达单任务语义，建议包含：

- `targetAgentId`
- `title`
- `instruction`
- `expectedOutput`
- `riskLevel`
- `context` 或 `contextRef`
- `lockPaths?: string[]`

不建议把 DAG 依赖塞进单个 `run_task` 工具输入里。

`lockPaths` 是 Orchestrator 声明式文件锁 V0。路径必须是 workspace-relative 的精确文件路径，不能为空、不能是绝对路径、不能包含 `..` 越界段，Runtime 会统一规范化为 `/`。当 `lockPaths` 非空时，Runtime 在目标智能体真正执行前按 `{ workspaceId, path }` 申请内存锁；任一文件已被其他 active delegated task 锁定，则该 `run_task` 失败并返回 `TASK_FILE_LOCK_CONFLICT`，不启动目标智能体。未绑定 workspace 的 Run 使用非空 `lockPaths` 会失败为 `TASK_FILE_LOCK_WORKSPACE_NOT_BOUND`。

V0 是 advisory lock：只保护 Orchestrator 主动在 `run_task.lockPaths` 中声明的文件，不新增 SQLite 锁表，不拦截普通单聊智能体直接使用 `write_file` / `edit_file`，也不拦截外部 Agent 未声明文件的真实写入。未知文件时 Orchestrator 应先委派只读探索任务，拿到文件列表后再委派写入任务并声明锁。

### 8.3 输出

模型只拿到最终结构化结果，例如：

```ts
type RunTaskResult = {
  status: "completed" | "failed" | "cancelled"
  summary: string
  data?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

Runtime 内部还会保留 trace，用于 UI 展示和事件重放。

### 8.4 事件流

`run_task` 生成的内部任务事件流属于运行态事实，不回灌给父智能体作为上下文输入。

默认原则：

- UI 可以订阅这条事件流。
- 父智能体只获得最终结果。
- 内部任务与直接用户调用共享同一套事件协议。
- `run_task` 自身的 `tool.*` 事件应作为原始追踪和持久化 RunEvent 保留，但产品 UI 不应渲染为普通工具卡片；可见执行过程来自 `task.*`、子智能体输出和 task summary，避免同一智能体输出被工具卡片和任务卡片重复展示。

Runtime 需要把“裸任务执行”和“工具包装”拆开：`RunManager.executeTask` 负责裸任务生命周期，`RuntimeToolRegistry.executeTool("run_task", ...)` 只负责在外层补上 `tool.started` / `tool.completed` / `tool.failed`。这样一个 `run_task` 调用只会对应一组工具事件和一组任务事件，不会出现双层工具包装。

## 9. 并发、取消与失败

### 9.1 并发

- 模型可以同时发起多个工具调用。
- 单个 `run_task` 只能对应一个任务。
- 工具并发的实际执行顺序不保证稳定。
- Runtime 可设置并发上限和排队策略。

### 9.2 失败传播

- 单个工具失败，不自动取消其他并发工具。
- 只有父 `run` 显式取消时，所有相关工具和子任务才停止。
- 工具失败必须返回结构化错误，并在事件流中记录。

### 9.3 取消

- 工具执行必须监听父级 `AbortSignal`。
- 取消后应尽快停止，并发出终态事件。
- 已完成的工具结果不应被回滚。

### 9.4 超时

- 工具可有独立超时。
- 超时必须被视为失败态或取消态之一，且事件码明确。

## 10. 审批与权限

工具调用由三个维度共同决定：

1. 可见性：`allowedTools` 决定 agent 能否获得并请求某工具。
2. 能力上限：每个 agent 的 `permissionPolicy` 必须覆盖 Tool Catalog 中的 `requiredPermissions`。
3. 审批语义：Tool Catalog 的 `approvalPolicy` 和运行上下文决定是否请求审批；审批不存储在 agent policy 中。

高风险工具必须显式审批，尤其是：

- 文件写入
- Patch 应用
- 部署发布
- 网络外联

`run_task` 默认不需要审批，但它委派的目标任务仍必须满足被委派智能体的权限与可见性约束。
`write_plan` 默认不需要审批，因为它只记录计划，不执行外部副作用。
`ls`、`read_file`、`glob`、`grep` 需要 `filesystem: "read"`，其 `approvalPolicy = "contextual"`：workspace 内普通读取直接执行；显式读取敏感文件、沙箱外读取或沙箱外敏感文件读取会创建权限请求。
`write_file`、`edit_file` 需要 `filesystem: "write"`，其 `approvalPolicy = "contextual"`：workspace 内普通文件修改直接执行；workspace 内敏感文件写入、沙箱外写入或沙箱外敏感文件写入会创建权限请求和 scoped write grant。
`web_fetch` 需要 `network: "limited"`，其 `approvalPolicy = "contextual"`：`permissionPolicy.network = "none"` 直接拒绝，`limited` 先产生 `permission.requested`，用户批准后同一 `runId + toolCallId` 不再重复审批并恢复请求，`full` 直接执行。第一版只允许 `http:` / `https:` 协议，不做域名 allowlist、私网拦截、Cookie jar、multipart builder 或二进制响应解析。
`bash` 需要 `shell: "limited"`，其 `approvalPolicy = "contextual"`：`permissionPolicy.shell = "none"` 直接拒绝，随后由 `AgentDefinition.toolPermissionRules.bash` 的命令级规则决定 `allow | ask | deny`。规则按插入顺序匹配且最后匹配生效，支持 `*` / `?` 简单 wildcard；`ask` 产生 `permissionType = "command_execute"`、`approvalReason = "bash_command"` 的权限请求，批准后同一 `runId + toolCallId` 直接执行，`deny` 在 `tool.started` 前返回 `BASH_COMMAND_DENIED`。完整契约见 `docs/architecture/BASH_TOOL.md`。
`question` 不需要权限审批，`requiredPermissions = {}`，`approvalPolicy = "never"`。它是 deferred interaction tool：AI SDK tool set 中只暴露 schema，不提供 `execute`；模型发起调用后 Runtime 记录问题请求、暂停对应执行分支，并等待用户通过 question answer API 提交答案。
文件系统类工具应通过 `docs/architecture/AGENT_RUNTIME_BACKEND.md` 定义的 Workspace Backend 访问真实存储；本地文件系统只是第一版后端实现。

对于已绑定 workspace 且具备文件系统工具的内部智能体，Prompt 会提供工具选择软约束：文件发现、读取、搜索和精确写入/编辑优先使用 `ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`；只有这些 workspace tools 不能完成需求时，才考虑 `bash` 等 shell 类工具。该规则只影响模型倾向，不改变 `allowedTools` 可见性、`permissionPolicy` 能力上限或审批语义。

### 10.1 审批续跑

- 需要审批时先发出 `permission.requested`；审批前不发出该次调用的 `tool.started`。
- Run 进入 `waiting_approval`，通过 `GET /runtime/runs/:runId/permissions` 查询请求，通过 decision API 提交结论。
- 批准后发出 `permission.approved` 并在同一 `runId`、原始 `toolCallId` 上恢复工具执行。
- 拒绝后发出 `permission.denied` 与 `tool.failed(TOOL_EXECUTION_DENIED)`，并把拒绝结果交回模型以继续完成答复。
- 取消等待中的 Run 会发出 `permission.cancelled` 和 `run.cancelled`。
- AI SDK 的工具审批采用二次生成续跑：Runtime 保存 continuation messages，追加 `tool-approval-response` 后重新调用 executor，不把底层 stream 视为暂停状态。
- continuation 按执行分支保存；`orchestrator -> run_task -> delegated agent` 中的审批会恢复原 delegated task，并在完成后继续把结果返回给 `orchestrator`。
- 同一个模型 step 产生的多个审批请求会进入同一个 continuation frame；全部请求决定后只恢复一次。并行分支互不自动取消，一个分支等待审批时，其他仍在运行的分支可以继续输出事件。

### 10.2 用户问答续跑

`question` 与权限审批共用 continuation frame 机制，但语义不同：

- 模型调用 `question` 后，Runtime 产生 `tool.started` 和 `question.requested`，并保存该次生成返回的 response messages。
- 当仍有 pending question 且没有其他 active task 时，Run 状态进入 `waiting_input`。
- 用户提交答案后，Runtime 产生 `question.answered` 和 `tool.completed(toolName="question")`，向模型上下文追加合成 `tool-result` message，然后用原 `executionId`、`agentId`、`taskId`、`parentAgentId` 与 `groupId` 二次执行同一分支。
- 同一 continuation frame 内可以有多个 question request；全部回答后才恢复一次。
- 取消 Run 时，pending question 输出 `question.cancelled` 和 `tool.failed(QUESTION_CANCELLED)`。

## 11. 允许的后续扩展

第一阶段只要求把工具体系架构定稳，后续可以逐步扩展：

- `read_context`
- `search_context`
- `read_file`
- `write_file`
- `edit_file`
- `apply_patch`
- `deploy_task`
- 浏览器类工具
- 外部 MCP / Adapter 桥接工具
- 文件工具和沙箱工具在进入实现前，必须先定义对应 backend capability、审批语义和外部授权策略。

MCP tool 接入必须遵守 Skill / MCP 服务设计中的 Phase 5 边界，详见 `docs/architecture/SKILL_MCP_SERVICES.md`。当前 Phase 5B-lite / 5C-lite 为了尽快让内部智能体感知并调用 workspace MCP，采用临时默认启用规则：discovery 有效、trust 未撤销的 workspace MCP server 会在 workspace status 查询或 Run 开始时连接、枚举，并以 `mcp_<server>_<tool>` 动态工具名注入内部可见主智能体和 Orchestrator。隐藏子智能体、InstructAgent 和外部 adapter 不注入。

动态 MCP tool 仍必须通过 Runtime Tool Registry 执行，并统一输出 `tool.started`、`tool.completed`、`tool.failed`，事件 `data.externalProvider = "mcp"`。本轮动态 MCP tool 不要求静态 `agent.allowedTools`，且暂不做 per-call approval / permission gate；这是后续增强前的临时边界，不改变静态 Runtime Tool 的 allowlist、`permissionPolicy` 和 approval continuation 语义。后续必须把 MCP stdio command、HTTP/SSE 网络连接和具体 tool 调用映射回 Runtime permission / approval 模型，并继续保证 workspace root、env、headers、token、secret args 和原始 MCP 配置不进入 API、日志、事件或模型可见结果。

新增工具必须先完成：

- 命名
- 风险等级
- 审批规则
- 事件语义
- 返回结构

具体实现步骤见 `docs/guides/ADDING_RUNTIME_TOOLS.md`。新增用户可配置工具时，应在工具定义中设置 authoring metadata 与 `configurableByUserAgent`，并同步更新 API 契约和测试；不得在 router 或 CRUD 中另建工具清单。

## 12. 不纳入范围

本设计不负责：

- 前端工具 UI 细节
- 具体模型 Prompt 模板
- 外部智能体平台的私有工具协议
- 复杂多轮自动修复策略
- 全量的工具市场或插件机制

## 13. 已锁定决策

- 工具是 Runtime 能力，不是纯 Prompt 技巧。
- `write_plan` 是 Orchestrator 计划的主事实来源。
- `write_plan` 不新增 `planId`。
- 多次 `write_plan` 调用时，最新成功工具结果为当前计划。
- `write_plan` 和 `run_task` 保持软约束，不做强制任务匹配。
- `run_task` 是内部任务原语，不是通用 RPC。
- 一个 `run_task` 只对应一个智能体和一个任务。
- 模型可以同时发起多个工具调用。
- 单个工具失败不自动取消其他并发工具。
- 工具事件主要面向 UI 和追踪，父智能体只看最终结果。
- `run_task` 产生的事件流可被 UI 订阅，但不会回灌给父智能体作为输入。

## 14. 当前实现状态

截至本轮，Runtime 工具体系已经进入可执行状态：

- 已实现 `RuntimeToolRegistry`，负责工具注册、按 `agent.allowedTools` 过滤、输入校验与工具事件派发。
- 已以注册工具定义作为 Tool Catalog，集中提供 `requiredPermissions`、`approvalPolicy`、风险等级和 Authoring Options metadata。
- 已在执行入口统一比对 `permissionPolicy` 与 `requiredPermissions`；权限不足返回 `TOOL_PERMISSION_DENIED`。
- 已实现通用 `internal` 工具标记；普通 AI SDK 主智能体默认看不到 internal tools，Orchestrator 专用路径通过 `includeInternal=true` 获取，但工具权限仍由 `allowedTools` 决定。
- 已将 `write_plan` 正式封装为 Runtime Tool，且仅 `orchestrator` 可见、可调用。
- `write_plan` 通过 `tool.completed.data.plan` 输出 UI 可渲染计划，只产生 `tool.*` 事件，不产生 `task.*` 事件。
- 已将 `run_task` 正式封装为 Runtime Tool，且仅 `orchestrator` 可见、可调用。
- `run_task` 单次只拉起一个目标智能体执行一个任务，返回统一结构化结果。
- `run_task.lockPaths` 已支持声明式内存文件锁 V0：同一 workspace 内同一路径的并发 delegated task 会产生结构化锁冲突，任务终态或 Run 终态会释放锁。
- 已将 `bash` 正式封装为 Runtime Tool，开放给内部预设主智能体；命令级规则写入 agent schema，用户自定义智能体暂不开放 shell。
- 已将 `question` 正式封装为 Runtime Tool，隐式开放给内部 AI SDK 智能体；用户自定义智能体无需配置即可使用，但 authoring options 不展示该工具，外部 adapter 不注入。
- `tool.*` 以及 `permission.requested`、`permission.approved`、`permission.denied`、`permission.cancelled` 已纳入 RunEvent 协议。
- `question.requested`、`question.answered`、`question.cancelled` 已纳入 RunEvent 协议，并通过 `waiting_input` 表示等待用户回答。
- 只读文件工具已支持 per-run workspace：未绑定 workspace 的 Run 可继续纯对话，但文件工具返回 `WORKSPACE_NOT_BOUND`。
- 沙箱外读取、workspace 内敏感文件显式读取、沙箱外敏感文件显式读取均已支持 `waiting_approval` 与同一 Run 的 AI SDK continuation；`ls` / `glob` 隐藏敏感文件，目录递归 `grep` 跳过敏感文件。
- 写文件工具已支持 per-run workspace：`write_file` 进行 UTF-8 文本创建/覆盖，`edit_file` 进行精确 search/replace；普通 workspace 内文件修改无需审批，敏感和沙箱外写入通过 write grant 审批续跑。
- `AiSdkExecutor` 已可接收工具注册表；只有模型支持 tools 且当前 agent 存在可见工具时，才会向 AI SDK 注入工具定义。
- 当前仍未开放部署等高风险工具，后续新工具必须先补齐命名、风险等级、审批与事件语义。
- `web_fetch` 已作为首个网络类 Runtime Tool 开放给系统预设主智能体；用户自定义智能体仍不能在 authoring options 中选择网络工具。
