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
- 只读上下文检索类工具
- 文件操作类工具
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

建议风格：

- `run_task`
- `read_context`
- `read_file`
- `apply_patch`
- `deploy_task`

## 4. 可见性与选择

工具可用性不是全局常量，而是运行时计算结果。

工具是否可见，由以下条件共同决定：

- `agent.allowedTools`
- `agent.permissionPolicy`
- `agent.executorType`
- `agent.delegationPolicy`
- 当前 Run 的模式和状态
- 当前工具是否需要审批

结论：

- `run_task` 只允许 `orchestrator` 使用。
- 文件、部署、网络类工具必须额外受权限约束。
- 外部智能体默认不进入 Runtime Tool Registry。

## 5. 工具契约

每个工具都应具备以下元数据：

- `name`
- `description`
- `inputSchema`
- `riskLevel`
- `requiresApproval`
- `allowedAgents`
- `execute`

推荐定义：

```ts
type ToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
  riskLevel: "low" | "medium" | "high"
  requiresApproval: boolean | ((input: unknown) => boolean | Promise<boolean>)
  allowedAgents: string[]
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

如果工具对应的是内部任务，还应继续产出：

- `task.started`
- `task.completed`
- `task.failed`

## 7. `run_task` 设计

`run_task` 是 Orchestrator 用来创建内部任务的原语。

### 7.1 语义

- 一个 `run_task` 调用只拉起一个智能体执行一个任务。
- `run_task` 不负责多任务 DAG 本身，DAG 编排属于 orchestrator 的计划层。
- 模型可以在同一轮中同时发起多个 `run_task` 调用。
- Runtime 可以并行执行这些工具调用，但要受内部并发上限控制。

### 7.2 输入

`run_task` 的输入应只表达单任务语义，建议包含：

- `targetAgentId`
- `title`
- `instruction`
- `expectedOutput`
- `riskLevel`
- `context` 或 `contextRef`

不建议把 DAG 依赖塞进单个 `run_task` 工具输入里。

### 7.3 输出

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

### 7.4 事件流

`run_task` 生成的内部任务事件流属于运行态事实，不回灌给父智能体作为上下文输入。

默认原则：

- UI 可以订阅这条事件流。
- 父智能体只获得最终结果。
- 内部任务与直接用户调用共享同一套事件协议。

## 8. 并发、取消与失败

### 8.1 并发

- 模型可以同时发起多个工具调用。
- 单个 `run_task` 只能对应一个任务。
- 工具并发的实际执行顺序不保证稳定。
- Runtime 可设置并发上限和排队策略。

### 8.2 失败传播

- 单个工具失败，不自动取消其他并发工具。
- 只有父 `run` 显式取消时，所有相关工具和子任务才停止。
- 工具失败必须返回结构化错误，并在事件流中记录。

### 8.3 取消

- 工具执行必须监听父级 `AbortSignal`。
- 取消后应尽快停止，并发出终态事件。
- 已完成的工具结果不应被回滚。

### 8.4 超时

- 工具可有独立超时。
- 超时必须被视为失败态或取消态之一，且事件码明确。

## 9. 审批与权限

工具权限由两层共同决定：

1. 智能体权限：`permissionPolicy`
2. 工具自身风险：`riskLevel` / `requiresApproval`

高风险工具必须显式审批，尤其是：

- 文件写入
- Patch 应用
- 部署发布
- 网络外联

`run_task` 默认不需要审批，但它委派的目标任务仍必须满足被委派智能体的权限与可见性约束。

## 10. 允许的后续扩展

第一阶段只要求把工具体系架构定稳，后续可以逐步扩展：

- `read_context`
- `search_context`
- `read_file`
- `apply_patch`
- `write_file`
- `deploy_task`
- 浏览器类工具
- 外部 MCP / Adapter 桥接工具

新增工具必须先完成：

- 命名
- 风险等级
- 审批规则
- 事件语义
- 返回结构

## 11. 不纳入范围

本设计不负责：

- 前端工具 UI 细节
- 具体模型 Prompt 模板
- 外部智能体平台的私有工具协议
- 复杂多轮自动修复策略
- 全量的工具市场或插件机制

## 12. 已锁定决策

- 工具是 Runtime 能力，不是纯 Prompt 技巧。
- `run_task` 是内部任务原语，不是通用 RPC。
- 一个 `run_task` 只对应一个智能体和一个任务。
- 模型可以同时发起多个工具调用。
- 单个工具失败不自动取消其他并发工具。
- 工具事件主要面向 UI 和追踪，父智能体只看最终结果。
- `run_task` 产生的事件流可被 UI 订阅，但不会回灌给父智能体作为输入。
