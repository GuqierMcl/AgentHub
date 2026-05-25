# 智能体架构设计

本文档定义 Agent Runtime 内部的智能体架构。目标是把系统预设智能体、用户自定义智能体、外部智能体和隐藏子智能体统一到一套可执行、可编排、可扩展的模型中。

本文档约束 `agent-runtime` 的设计与实现；涉及跨进程 API 或事件载荷时，还需要同步更新 `docs/contracts/API_CONTRACTS.md`。

## 1. 设计目标

AgentHub 的用户体验是 IM 式聊天，但 Runtime 内部需要具备更强的执行编排能力。智能体架构需要同时满足：

- 用户只需要理解和选择少量“主智能体”。
- Runtime 可以使用隐藏“子智能体”完成探索、通用推理、文件操作、部署等专门任务。
- `orchestrator` 是默认入口和核心调度器，用户没有显式指定智能体时，由它接管运行入口。
- 系统预设主智能体、用户自定义主智能体和外部主智能体使用统一注册、统一调用和统一事件协议。
- 子智能体不能被用户直接调用，只能由允许的主智能体委派。
- 外部智能体通过 Adapter 接入，差异不能泄漏到上层编排协议。
- 权限、工具、文件、部署等高风险能力必须可声明、可校验、可审计。

## 2. 核心分层

智能体分为两个大级别：

```text
Primary Agent 主智能体
  ├─ orchestrator
  ├─ 系统预设主智能体
  ├─ 用户自定义主智能体
  └─ 外部智能体

Subagent 子智能体
  ├─ explore
  ├─ general
  ├─ file
  ├─ deploy
  └─ 后续扩展能力单元
```

### 2.1 主智能体

主智能体是用户可感知的聊天对象，通常可以出现在会话列表、Agent 列表、群聊成员或显式调用入口中。

主智能体包含四类：

| 类型 | 说明 | 示例 |
| --- | --- | --- |
| `orchestrator` | 默认入口与核心调度器，仍然属于系统预设主智能体 | `orchestrator` |
| 系统预设主智能体 | AgentHub 内置的专业主智能体 | `coder`、`reviewer`、`writer`、`planner` |
| 用户自定义主智能体 | 用户配置 prompt、模型、能力和可用子智能体 | `my-react-agent` |
| 外部智能体 | 通过 Adapter 接入的外部 Agent 平台 | `opencode`、`claude-code`、`codex` |

### 2.2 子智能体

子智能体是 Runtime 内部能力单元，默认隐藏，不作为聊天对象暴露给用户。

子智能体的职责是把复杂执行能力拆成可控、可授权、可测试的内部模块。它们可以输出 RunEvent，但不应该成为前端 IM 中的独立联系人。

MVP 子智能体建议如下：

| 子智能体 | 职责 | 默认权限等级 |
| --- | --- | --- |
| `explore` | 探索上下文、项目结构、历史消息、相关文件和 Artifact | 只读 |
| `general` | 通用推理、解释、总结、改写、轻量规划 | 无文件权限 |
| `file` | 文件读取、写入、Patch、Diff 生成、局部编辑 | 文件读写，需授权 |
| `deploy` | 构建、预览、部署、发布、部署状态追踪 | 高风险，需显式授权 |

后续可以扩展：

| 子智能体 | 职责 |
| --- | --- |
| `test` | 运行测试、解析失败、提出修复建议 |
| `artifact` | 生成和更新 document、code、webpage 等 Artifact |
| `browser` | 网页访问、截图、网页内容提取 |
| `review` | 静态审查、风险检查、变更摘要 |

## 3. Orchestrator 的核心位置

`orchestrator` 不是独立层级，它仍然是一个特殊的系统预设主智能体。它和 `coder`、`reviewer`、`writer`、`planner` 一样遵守同一套 `AgentDefinition`、`AgentExecutor` 和 `RunEvent` 协议，只是具有默认入口和编排职责。

### 3.1 默认入口规则

Runtime 创建 Run 时，需要先解析入口智能体：

```text
如果 mode = single：
  使用该单聊绑定的主智能体作为入口
  单聊入口不能是 orchestrator 或子智能体

如果 mode = group 且用户显式 @ 了一个或多个主智能体：
  使用被 @ 的主智能体作为入口
  被 @ 的智能体必须属于当前群聊

如果 mode = group 且用户没有显式 @ 主智能体：
  使用 orchestrator 作为入口
  群聊必须包含 orchestrator
```

用户显式选择外部智能体、系统预设主智能体或自定义主智能体时，Runtime 不应强制再绕回 orchestrator。这样可以保留用户明确意图。

IM 会话的成员关系由 HubServer 管理。Runtime 不创建或持久化会话成员，只在每次 Run 中接收执行态的会话参与者列表，并校验入口解析是否合法。

### 3.1.1 IM 会话参与者模型

AgentHub 的 IM 体验要求不同会话拥有不同的主智能体成员。Runtime 的 RunInput 必须携带当前会话的执行态成员信息。

推荐结构：

```ts
type RuntimeConversationMode = "single" | "group"

type RunInput = {
  conversationId: string
  mode: RuntimeConversationMode
  participantAgentIds: string[]
  addressedAgentIds?: string[]
  userMessage: RuntimeMessage
  history: RuntimeMessage[]
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `mode` | 单聊或群聊 |
| `participantAgentIds` | 当前会话包含的主智能体成员 |
| `addressedAgentIds` | 当前用户消息显式 @ 的主智能体；为空表示未显式指定 |

约束：

- `participantAgentIds` 只能包含可见、启用、可调用的主智能体。
- `participantAgentIds` 不能包含子智能体。
- 单聊必须且只能包含一个非 `orchestrator` 主智能体。
- 群聊必须包含 `orchestrator`，由 HubServer 创建群聊时自动加入。
- 群聊可以包含系统预设主智能体、用户自定义主智能体和外部主智能体。
- `addressedAgentIds` 必须是 `participantAgentIds` 的子集。
- 用户不能显式 @ 子智能体。

### 3.1.2 单聊规则

单聊用于用户与一个明确主智能体直接对话。

规则：

- 用户创建单聊时，应从 `GET /runtime/agents` 返回的可见主智能体中选择。
- 单聊候选列表应排除 `entryPolicy = "default"` 的 `orchestrator`。
- 单聊可以选择外部主智能体。
- 单聊不自动加入 `orchestrator`。
- 单聊 Run 未提供 `addressedAgentIds` 时，入口就是该单聊绑定的主智能体。

示例：

```json
{
  "mode": "single",
  "participantAgentIds": ["coder"],
  "addressedAgentIds": []
}
```

入口解析结果：

```json
{
  "entryAgentIds": ["coder"],
  "reason": "single_participant"
}
```

### 3.1.3 群聊规则

群聊用于多个主智能体协作。

创建规则：

- 用户选择多个可见主智能体。
- HubServer 自动加入 `orchestrator`。
- HubServer 需要对成员列表去重。
- 用户不需要手动选择 `orchestrator`。
- 当前阶段 `addressedAgentIds` 只允许包含 1 个主智能体；后续计划扩展为并行 @ 多个主智能体。

运行规则：

- 用户没有显式 @ 主智能体时，入口是 `orchestrator`。
- 用户显式 @ 一个或多个主智能体时，入口是被 @ 的主智能体。
- 被 @ 的主智能体必须属于当前群聊。
- 用户不能显式 @ 子智能体。

默认群聊入口示例：

```json
{
  "mode": "group",
  "participantAgentIds": ["orchestrator", "coder", "reviewer", "opencode"],
  "addressedAgentIds": []
}
```

入口解析结果：

```json
{
  "entryAgentIds": ["orchestrator"],
  "reason": "group_default_orchestrator"
}
```

显式 @ 示例：

```json
{
  "mode": "group",
  "participantAgentIds": ["orchestrator", "coder", "reviewer", "opencode"],
  "addressedAgentIds": ["reviewer"]
}
```

入口解析结果：

```json
{
  "entryAgentIds": ["reviewer"],
  "reason": "group_addressed_agents"
}
```

### 3.2 调度职责

`orchestrator` 负责：

- 理解用户任务。
- 判断是否需要调用其他主智能体。
- 判断是否需要调用子智能体。
- 生成结构化执行计划。
- 检查候选智能体权限和能力。
- 顺序或并行执行任务。
- 汇总子任务输出。
- 输出面向用户的最终答复。

MVP 已落地为“AI SDK `streamText` + `write_plan` 计划工具 + `run_task` 内部任务工具 + 批次并行执行 + 汇总”的模型。`orchestrator` 仍然是普通主智能体，只是它拥有默认入口语义和更强的委派能力；Runtime 负责把工具调用包装成计划事件、任务事件，并在必要时做二次校验与汇总。

`write_plan` 是 Runtime 内部计划工具，只对 `orchestrator` 可见，用于写入 UI 可渲染计划；`run_task` 是 Runtime 内部任务工具，只对 `orchestrator` 可见，用于调度允许的主智能体或子智能体。任务之间可通过 `dependsOn` 表达依赖关系；没有依赖的任务可并行启动。并行委派由 Runtime 内部调度，不引入独立控制层。

工具体系的正式契约、事件流、审批与并发语义见 `docs/architecture/AGENT_TOOLS.md`。

```text
RunInput
  ↓
EntryResolver 选择 orchestrator
  ↓
ContextBuilder 组装上下文
  ↓
write_plan 写入 UI 可渲染计划
  ↓
run_task 按计划或模型判断调用主智能体或子智能体
  ↓
Aggregator 汇总结果
  ↓
RunEvent 流输出
```

### 3.3 Orchestrator 与其他主智能体的关系

`orchestrator` 可以调用：

- 系统预设主智能体。
- 用户自定义主智能体。
- 外部主智能体。
- 被授权的子智能体。

其他主智能体可以调用：

- 被其声明允许的子智能体。

当前阶段只有 `orchestrator` 可以通过 `run_task` 调用其他主智能体，且目标主智能体必须属于当前 Run 的 `participantAgentIds`。其他主智能体默认不调用其他主智能体；后续如需开放，也必须继续受当前会话成员边界约束，避免跨会话隐式委派。

### 3.4 内部智能体统一执行协议

内部智能体指系统预设主智能体与子智能体。它们不需要各自的兼容层，而应共享同一套 Runtime 执行协议。

统一原则：

- 相同的 Run 输入结构。
- 相同的 RunEvent 种类与事件格式。
- 相同的执行状态机。
- 相同的权限检查入口。
- 相同的结果汇总与错误表达。

差异仅体现在：

- `agentId`
- `tier`
- `origin`
- `visibility`
- `entryPolicy`
- `delegationPolicy`
- `permissionPolicy`

因此，内部智能体使用的是统一的 `AgentExecutor` 接口，而不是 `Adapter`。`Adapter` 只面向外部智能体平台，用来屏蔽 OpenCode、Claude Code、Codex 等外部执行系统差异。

## 4. 可见性与调用策略

智能体可见性和可调用性需要分开建模。

| 字段 | 目的 |
| --- | --- |
| `tier` | 区分主智能体和子智能体 |
| `origin` | 区分系统、用户、外部来源 |
| `visibility` | 控制是否展示给用户 |
| `entryPolicy` | 控制是否允许作为 Run 入口 |
| `delegationPolicy` | 控制能否被其他智能体委派 |

推荐枚举：

```ts
type AgentTier = "primary" | "subagent"
type AgentOrigin = "system" | "user" | "external"
type AgentVisibility = "visible" | "hidden"
type AgentEntryPolicy = "default" | "callable" | "not-callable"
type AgentDelegationPolicy = "can-delegate" | "delegated-only" | "terminal"
```

含义：

| 策略 | 说明 |
| --- | --- |
| `default` | 默认入口，仅 `orchestrator` 使用 |
| `callable` | 用户可以显式调用 |
| `not-callable` | 用户不能显式调用 |
| `can-delegate` | 可以委派其他智能体 |
| `delegated-only` | 只能被委派调用 |
| `terminal` | 只执行自身任务，不继续委派 |

示例：

```ts
const orchestrator = {
  id: "orchestrator",
  tier: "primary",
  origin: "system",
  visibility: "visible",
  entryPolicy: "default",
  delegationPolicy: "can-delegate",
}

const fileSubagent = {
  id: "file",
  tier: "subagent",
  origin: "system",
  visibility: "hidden",
  entryPolicy: "not-callable",
  delegationPolicy: "delegated-only",
}

const opencode = {
  id: "opencode",
  tier: "primary",
  origin: "external",
  visibility: "visible",
  entryPolicy: "callable",
  delegationPolicy: "terminal",
}
```

## 5. 智能体定义模型

所有智能体统一使用 `AgentDefinition` 描述。

```ts
type AgentDefinition = {
  id: string
  name: string
  description: string

  tier: AgentTier
  origin: AgentOrigin
  visibility: AgentVisibility
  entryPolicy: AgentEntryPolicy
  delegationPolicy: AgentDelegationPolicy

  executorType: AgentExecutorType
  systemPrompt?: string

  modelRef?: {
    providerId: string
    modelId: string
  }

  capabilities: string[]
  allowedSubagents: string[]
  allowedTools: string[]

  permissionPolicy: AgentPermissionPolicy
  external?: ExternalAgentConfig

  enabled: boolean
  readonly: boolean
  createdAt?: string
  updatedAt?: string
}
```

系统预设主智能体的系统提示词集中维护在 `agent-runtime/src/agents/preset-agent-prompts.ts`，`preset-agents.ts` 只引用这些常量。当前集中维护的对象包括 `orchestrator`、`coder`、`reviewer`、`writer`、`planner`。外部智能体如 `opencode` 不在这套系统提示词绑定内，后续由外部 Adapter 根据平台能力处理。用户自定义主智能体仍通过自身 `AgentDefinition.systemPrompt` 提供提示词。

### 5.1 用户自定义智能体 CRUD

Runtime 当前支持通过内部 `/runtime/agents` API 创建、更新和删除用户自定义智能体。首版 CRUD 只覆盖 `origin = "user"`、`tier = "primary"`、`visibility = "visible"`、`executorType = "ai-sdk"` 的主智能体。

创建时 Runtime 强制设置：

- `entryPolicy = "callable"`
- `delegationPolicy = "can-delegate"`
- `readonly = false`

可写字段包括：

- `name`
- `description`
- `systemPrompt`
- `capabilities`
- `allowedSubagents`
- `allowedTools`
- `permissionPolicy`
- `enabled`

约束：

- 用户不能通过 CRUD 创建隐藏子智能体或外部智能体。
- 用户不能覆盖、更新或删除系统预设智能体。
- `allowedSubagents` 只能引用已注册、启用、隐藏的子智能体。
- `allowedTools` 首版只允许 `ls`、`read_file`、`glob`、`grep` 四个只读文件工具。
- `write_plan`、`run_task` 仍是 `orchestrator` 的内部工具，不能授予用户自定义智能体。
- `permissionPolicy` 首版限制为只读能力：文件权限只允许 `none` 或 `read`，shell、network、deploy 工具权限必须为 `none`。

用户自定义智能体的 `systemPrompt` 可通过详情接口返回，供 HubServer 或后续配置 UI 回显；系统预设智能体的系统提示词不通过 Runtime API 暴露。

### 5.2 执行器类型

```ts
type AgentExecutorType =
  | "orchestrator"
  | "ai-sdk"
  | "mock"
  | "external-adapter"
```

说明：

- `orchestrator` 用于特殊系统预设主智能体。
- `ai-sdk` 用于普通 LLM 主智能体、系统预设主智能体、用户自定义主智能体和部分子智能体。
- `mock` 用于开发和测试。
- `external-adapter` 用于外部智能体平台接入。

### 5.3 权限策略

```ts
type AgentPermissionPolicy = {
  filesystem: "none" | "read" | "write"
  shell: "none" | "limited" | "full"
  network: "none" | "limited" | "full"
  deploy: "none" | "preview" | "publish"
  requiresApproval: boolean
}
```

权限原则：

- 子智能体权限默认最小化。
- `general` 不应获得文件和 shell 权限。
- `explore` 默认只读。
- `file` 默认需要文件写权限审批。
- `deploy` 默认需要显式审批。
- 外部智能体需要声明真实能力，不能隐式获得全部权限。

### 5.4 外部智能体配置

外部智能体通过 `external` 字段配置。

```ts
type ExternalAgentConfig = {
  provider: "opencode" | "claude-code" | "codex"
  command?: string
  args?: string[]
  workingDirectoryPolicy: "runtime-workspace" | "user-workspace"
  configDirectoryPolicy: "runtime-managed" | "user-global"
  outputFormat: "text" | "json" | "event-stream"
}
```

Runtime 应使用隔离工作目录和 Runtime 管理的配置目录，避免污染用户全局配置。

## 6. 委派边界模型

Runtime 不再使用全局静态 `AgentRelation` 表表达智能体调用关系。委派边界由两类上下文共同决定：

| 边界 | 来源 | 说明 |
| --- | --- | --- |
| 主智能体之间 | `RunInput.participantAgentIds` | 当前群聊成员就是主智能体协作边界 |
| 主智能体到子智能体 | `AgentDefinition.allowedSubagents` | 每个主智能体声明自己可使用的隐藏子智能体 |

规则：

- `orchestrator` 可以委派当前 Run participants 中的其他可见、启用主智能体。
- `orchestrator` 可以委派自身 `allowedSubagents` 中的隐藏子智能体。
- 普通主智能体当前阶段不调用其他主智能体。
- 普通主智能体后续如获得内部任务工具，也只能调用自身 `allowedSubagents` 中的子智能体。
- 子智能体不能再委派主智能体，默认也不能互相委派。
- `AgentRelation` 和 `agent-relations.json` 视为废弃的早期开发期配置，不再作为 Runtime 主路径。

## 7. 调用与委派规则

### 7.1 用户入口解析

```text
mode = single：
  1. participantAgentIds 必须有且只有一个
  2. 该智能体必须是 visible primary callable
  3. 该智能体不能是 orchestrator
  4. 通过后作为入口智能体

mode = group 且 addressedAgentIds 非空：
  1. addressedAgentIds 必须全部属于 participantAgentIds
  2. 每个 addressed agent 必须是 visible primary callable 或 default
  3. 不允许 addressed agent 是子智能体
  4. 通过后使用 addressedAgentIds 作为入口智能体

mode = group 且 addressedAgentIds 为空：
  1. participantAgentIds 必须包含 orchestrator
  2. orchestrator 必须是 visible primary default
  3. 通过后使用 orchestrator 作为入口智能体
```

### 7.2 委派校验

主智能体委派另一个智能体前必须校验：

1. 被委派智能体存在并启用。
2. 委派源智能体的 `delegationPolicy` 必须是 `can-delegate`。
3. 如果目标是子智能体，目标必须在源智能体的 `allowedSubagents` 中，并且是 `entryPolicy = "not-callable"`、`delegationPolicy = "delegated-only"`。
4. 如果目标是主智能体，当前阶段仅允许 `orchestrator` 委派，并且目标必须属于当前 Run 的 `participantAgentIds`。
5. 当前 Run 的权限上下文覆盖被委派智能体所需权限。
6. 委派深度未超过限制。

MVP 建议限制：

| 限制 | 默认值 |
| --- | --- |
| 最大委派深度 | `2` |
| 最大子任务数 | `5` |
| 单个子任务超时 | `60s` |
| 整个 Run 超时 | `300s` |

### 7.3 子智能体返回值

子智能体不直接面向用户生成完整对话。它们返回结构化结果，由主智能体或 orchestrator 决定如何进入最终回复。

```ts
type SubagentResult = {
  agentId: string
  taskId: string
  status: "completed" | "failed" | "cancelled"
  summary: string
  data?: unknown
  artifacts?: RuntimeArtifactDraft[]
  events: RunEvent[]
}
```

## 8. Orchestrator Plan

Orchestrator 的计划必须结构化，不能只依赖自然语言。当前实现中，计划由 `write_plan` 工具调用结果承载，前端和 HubServer 从 RunEvent 流中读取最后一个成功的 `tool.completed(toolName="write_plan")` 作为当前计划。

```ts
type OrchestratorPlan = {
  intent: string
  entryAgentId: string
  tasks: OrchestratorTask[]
  summaryInstruction: string
}

type OrchestratorTask = {
  taskId: string
  targetAgentId: string
  title: string
  instruction: string
  expectedOutput: string
  riskLevel: "low" | "medium" | "high"
  dependsOn: string[]
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled"
}
```

本阶段不新增 `planId`；计划追踪使用现有 `runId + toolCallId + event.id`。同一 Run 内可以多次调用 `write_plan`，最新成功工具结果代表当前计划。`write_plan` 与 `run_task` 保持软约束：Prompt 要求复杂任务或委派任务先写计划，但 Runtime 不强制拦截未在计划中的 `run_task`。

计划生成后，Runtime 需要做二次校验：

- `targetAgentId` 必须存在。
- 用户不可见子智能体只能出现在委派任务中，不能成为 Run 入口。
- 高风险任务必须触发权限检查或审批事件。
- 计划中的任务数量不能超过限制。
- 不允许模型生成任意不存在的智能体 ID 后直接执行。
- `dependsOn` 必须引用同一计划中的有效任务，且不能形成循环依赖。

## 9. RunEvent 设计要求

智能体执行过程应统一输出 RunEvent。与智能体架构相关的事件建议包括：

```text
run.started
agent.entry.resolved
agent.started
orchestrator.plan.created
task.group.started
task.group.completed
task.started
task.completed
 task.failed
 tool.started
 tool.completed
 tool.failed
 message.delta
message.completed
permission.requested
artifact.created
diff.proposed
agent.completed
 run.completed
 run.failed
```

其中 `orchestrator.plan.created` 目前保留为后续可视化和调试事件的扩展点，当前计划的主事实来源是 `tool.completed(toolName="write_plan")`。

事件载荷要包含足够的追踪信息：

```ts
type RunEventBase = {
  id: string
  runId: string
  timestamp: string
  type: string
  agentId?: string
  parentAgentId?: string
  taskId?: string
  toolCallId?: string
  toolName?: string
}
```

这样 HubServer 可以持久化完整执行轨迹，并在前端展示“由哪个主智能体委派了哪个内部能力”。

其中 `task.*` 事件表示 `orchestrator` 通过 `run_task` 发起的内部任务生命周期，建议携带 `taskId`、`parentAgentId`、`parentTaskId`、`groupId` 和 `targetAgentId` 等字段，便于追踪委派链路和批次归属。

## 10. Runtime 模块划分

建议目录结构：

```text
agent-runtime/src/
  agents/
    agent-definition.ts
    preset-agents.ts
    preset-subagents.ts
    agent-registry.ts
    agent-store.ts
    invocation-policy.ts

  executors/
    agent-executor.ts
    executor-registry.ts
    mock-executor.ts
    ai-sdk-executor.ts
    orchestrator-executor.ts

  adapters/
    external-agent-adapter.ts
    external-adapter-registry.ts
    opencode-adapter.ts
    claude-code-adapter.ts
    codex-adapter.ts

  orchestration/
    orchestrator.ts
    plan-schema.ts
    plan-validator.ts
    delegation-runner.ts
    agent-selector.ts
    aggregator.ts

  runtime/
    run-manager.ts
    run-context.ts
    run-state.ts

  events/
    run-event.ts
    event-bus.ts
    sse.ts

  workspace/
    workspace-manager.ts

  routers/
    agents.ts
    runs.ts
    providers.ts
```

## 11. 存储策略

### 11.1 系统预设

系统预设主智能体和子智能体应写在代码中，作为 Runtime 默认能力：

```text
agent-runtime/src/agents/preset-agents.ts
agent-runtime/src/agents/preset-subagents.ts
```

系统预设应满足：

- `readonly = true`
- 不允许用户删除
- 可允许用户复制为自定义智能体
- 可允许部分字段覆盖，但必须保留 ID、tier、origin、默认权限边界

### 11.2 用户配置

在 HubServer 状态中心完成前，Runtime 可先使用本地 JSON 存储：

```text
dataDir/
  agents.json
  agent-model-bindings.json
```

`agents.json` 存储非系统预设的本地智能体定义。Runtime CRUD 本轮只会写入用户自定义主智能体；外部智能体和子智能体的自定义能力后续再单独设计。模型绑定继续由 `agent-model-bindings.json` 承载，不混入 Agent CRUD 主体流程。

未来接入 HubServer 后，HubServer 可以成为产品状态源；Runtime 的 `AgentRegistry` 则负责加载 HubServer 传入的执行态配置，或缓存运行时需要的智能体定义。

## 12. 外部智能体边界

外部智能体是主智能体，不是子智能体。

原则：

- 用户可以显式选择外部智能体作为入口。
- `orchestrator` 可以委派任务给外部智能体。
- 外部智能体默认是 `terminal`，不继续调用 AgentHub 内部子智能体。
- 如果未来要允许外部智能体使用 AgentHub 子智能体，需要通过 Runtime wrapper 暴露受控工具，而不是让外部进程直接访问内部模块。
- 外部智能体的文件、shell、网络和部署能力必须由 Runtime 权限策略包裹。

## 13. 权限与安全

权限控制不应只依赖 prompt。Runtime 在调用 executor 或子智能体前必须做结构化校验。

高风险操作包括：

- 文件写入。
- Patch 应用。
- Shell 命令执行。
- 网络访问。
- 部署发布。
- 外部 Agent 访问用户工作区。

建议事件：

```text
permission.requested
permission.granted
permission.denied
```

MVP 可以先只生成 `permission.requested`，由 HubServer 和前端后续补审批闭环。在审批能力完成前，高风险能力默认不可自动执行，或者只能在开发模式下显式开启。

## 14. MVP 落地顺序

### 阶段一：智能体定义与注册表

产出：

- `AgentDefinition`
- `AgentRegistry`
- `preset-agents`
- `preset-subagents`
- 本地 `agents.json` 加载与合并

完成标准：

- Runtime 能列出可见主智能体。
- Runtime 能加载隐藏子智能体。
- `orchestrator` 被标记为默认入口。

### 阶段二：统一执行接口与事件协议

产出：

- `AgentExecutor`
- `ExecutorRegistry`
- `MockExecutor`
- 最小 RunEvent 协议

完成标准：

- 所有内部智能体都能通过统一接口输出事件。
- 事件流不依赖具体智能体类型。

### 阶段三：Run API 与入口解析

产出：

- `GET /runtime/agents`
- `GET /runtime/agents/:id`
- `POST /runtime/runs`
- `GET /runtime/runs/:runId/events`
- 入口解析和委派校验

完成标准：

- 单聊未显式 @ 时进入该单聊绑定的主智能体。
- 群聊未显式 @ 时默认进入 `orchestrator`。
- 群聊显式 @ 时进入被 @ 的主智能体。
- 当前阶段 `addressedAgentIds` 只允许 1 个主智能体。
- 指定子智能体作为入口会被拒绝。
- 运行态事件可通过 SSE 读取。

### 阶段四：Orchestrator V1

产出：

- `OrchestratorPlan`
- `PlanValidator`
- `DelegationRunner`
- `Aggregator`

完成标准：

- `orchestrator` 能生成 plan 并驱动子智能体执行。
- 高风险子智能体会触发权限检查。

### 阶段五：AI SDK 执行器模板

产出：

- 使用现有 `ProviderService` 选择 provider/model。
- 将 Runtime 上下文转换为模型消息。
- 将模型流转换为 RunEvent。

完成标准：

- 系统预设主智能体和用户自定义主智能体可以用真实模型回复。
- 暂不介入计划、tool loop 和 artifact 推导。

### 阶段六：外部智能体 Adapter 骨架

产出：

- 外部智能体统一接口。
- OpenCode、Claude Code、Codex 的接入位。
- 能力描述与事件映射骨架。

完成标准：

- 外部智能体被统一视为主智能体。
- Runtime 内部协议无需为外部平台分叉。

## 15. 非目标

当前阶段不解决：

- 完整用户系统和团队权限。
- 前端 Agent 配置 UI。
- 复杂 DAG 并行调度。
- 子智能体在前端作为聊天成员展示。
- 外部智能体直接调用 AgentHub 内部子智能体。
- 生产级部署发布。
- 多 Runtime 分布式调度。

## 16. 关键设计结论

- AgentHub 用户只直接面对主智能体。
- 子智能体是 Runtime 内部隐藏能力，不是用户联系人。
- `orchestrator` 是特殊系统预设主智能体，也是默认入口和核心调度器。
- 系统预设、用户自定义和外部智能体统一使用 `AgentDefinition`。
- 内部智能体共享统一执行协议，不需要兼容层。
- 委派边界由当前 Run 的 `participantAgentIds` 和主智能体自身 `allowedSubagents` 共同决定，不得靠 prompt 隐式执行。
- 外部智能体通过 Adapter 接入，默认作为 terminal 主智能体。
- 权限必须结构化声明并在调用前校验。
