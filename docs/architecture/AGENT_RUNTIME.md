# Agent Runtime 设计

## 1. 背景与目标

AgentHub 是一个以 IM 聊天为核心交互范式的多 Agent 协作平台。用户可以像使用聊天软件一样，与不同 Agent 进行单聊或群聊；在群聊场景下，由 Orchestrator 自动理解用户意图、拆分任务，并分派给不同 Agent 协作完成。

平台还需要支持 Claude Code、Codex、OpenCode 等外部 Agent 平台，以及用户自建 Agent。Agent 的产出不仅是文字，还包括代码、Diff、网页预览、文件附件、部署状态等富媒体产物。

因此，Agent Runtime 的核心目标是：作为 AgentHub 的智能体执行引擎，负责 Agent 调度、运行、适配、产物生成和事件输出。

Agent Runtime 不负责平台业务数据管理，不直接面向前端，也不直接承担会话、消息、用户、权限等业务 API 职责。它专注于“执行”。

## 2. 设计定位

Agent Runtime 在系统中的定位是：AgentHub 应用（含 Web + HubServer）的**侧车进程（Sidecar）**，负责运行 Agent。API Server 负责管理状态。

整体关系如下：

```text
Frontend
  ↓
API Server (HubServer)
  ↓
Agent Runtime (Sidecar)
  ↓
Agent Adapter
  ↓
Claude Code / Codex / OpenCode / LLM Agent / Custom Agent
```

其中：

- Frontend 只与 API Server 通信。
- API Server 负责会话、消息、Agent 配置、Artifact、Run 状态等业务数据。
- Agent Runtime 作为 Sidecar 进程，负责一次 Agent 任务的实际执行过程。
- Agent Adapter 负责屏蔽不同 Agent 平台的调用差异。

### 2.1 Sidecar 模式

Agent Runtime 定位为 HubServer 的 Sidecar 进程。这意味着：

- **生产环境**：HubServer 启动时，自动通过子进程方式拉起 Agent Runtime，并传入必要参数。
- **开发环境**：支持手动独立启动 Agent Runtime，便于调试和热重载。
- **进程隔离**：Agent Runtime 作为独立进程运行，拥有独立的端口和工作目录。
- **生命周期绑定**：Agent Runtime 的生命周期由 HubServer 管理。
- **生产入口约束**：生产发行包中 Runtime 是独立二进制，但不是用户入口；CLI 和 Desktop 都通过 HubServer 间接启动 Runtime。

架构决策详见 `docs/adr/ADR-001-sidecar-architecture.md`。
生产分发和入口约束详见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

### 2.2 启动与参数传递

HubServer 在启动时通过 `Bun.spawn` 或等价方式启动 Agent Runtime 子进程。

启动参数规范：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--port` | number | 否 | Agent Runtime 监听端口，默认 `3001` |
| `--hostname` | string | 否 | 监听地址，默认 `127.0.0.1`；`--host` 只能作为兼容别名 |
| `--hub-callback` | string | 否 | HubServer 回调地址，用于 Runtime 反向通知 |
| `--workdir` | string | 否 | Runtime 进程级工作目录；不再作为普通 Run 文件工具的隐式 workspace |
| `--data-dir` | string | 否 | Runtime 配置数据目录 |
| `--log-level` | string | 否 | 日志级别：`debug` / `info` / `warn` / `error`，默认 `info` |

配置优先级：命令行参数 > 环境变量 > 默认值。

生产环境中，HubServer 应生成每次启动唯一的内部 token，并通过环境变量传给 Runtime（例如 `AGENTHUB_RUNTIME_TOKEN`）。Runtime 检测到 token 后必须校验 HubServer 对 `/runtime/*` 的请求头 `x-agenthub-runtime-token`。开发环境未设置 token 时可跳过该校验。

开发环境示例：

```bash
cd agent-runtime && bun dev -- --port 3001
```

生产环境由 HubServer 自动拉起，无需手动启动。

### 2.3 健康检查与就绪信号

Agent Runtime 必须暴露 `/health` 端点，用于 HubServer 判断其是否就绪。

就绪判定流程：

1. HubServer 启动 Agent Runtime 子进程。
2. HubServer 轮询 `GET http://127.0.0.1:{port}/health`。
3. Agent Runtime 完成 ProviderService、AgentRegistry 等启动依赖初始化后，返回 `200 OK` 且响应体包含 `"status": "ok"`，视为就绪。
4. 超时（默认 10 秒）未就绪则标记启动失败，HubServer 应上报错误并决定是否重试。

Runtime 可以在 HTTP server 已监听但内部服务仍初始化时返回非 200 或 `"status": "starting"`；HubServer 不得把该状态视为可接收执行请求。

Runtime 另外暴露 `GET /runtime/services/status` 供 HubServer 读取服务状态快照。该端点只读，不会启动 OpenCode server、创建外部 Session、调用 Claude Code / Codex prompt 或修改 workspace。当前返回 OpenCode、Codex、Claude Code 三类服务状态，其中三者均已作为外部智能体接入。OpenCode 状态来自默认 `ManagedOpenCodeServer`：`idle` 表示待命，`starting` 表示 workspace server 启动中，`running` 表示至少一个 workspace connection 已就绪，`error` 表示最近一次启动或 workspace 校验失败。Codex 状态来自 `@openai/codex-sdk` 只读 readiness 和 Runtime 内存中的 active Run 摘要：`running` 表示至少一个非终态 Run 正在直接执行或委派执行 `codex`，`idle` 表示 SDK 可用且当前没有 active Codex Run，`details.clientMode = "sdk"`，`details.activeRunCount` 返回当前非终态 Codex Run 数。Claude Code 状态来自 SDK/可执行文件配置来源和 Runtime 内存中的 active Run 摘要：`running` 表示至少一个非终态 Run 正在直接执行或委派执行 `claude-code`，`idle` 表示 SDK/executable 可用且当前没有 active Claude Code Run，`details.activeRunCount` 返回当前非终态 Claude Code Run 数，`details.executableSource` 为 `sdk-bundled` 或 `env`，`AGENTHUB_CLAUDE_CODE_EXECUTABLE` 可覆盖真实 Claude Code executable 路径。

Runtime 还暴露 Skill / MCP Capability Discovery 只读端点，供 HubServer 查询当前 Runtime 可见的全局与 workspace/project 级能力摘要。第一阶段只读取 `%USERPROFILE%\.agents`、Codex、Claude Code、OpenCode 相关目录和配置文件，归一化返回 Skill 元数据与 MCP server 配置摘要；不会执行 Skill、不会把 Skill 注入 prompt、不会启动 MCP stdio 进程、不会连接 MCP HTTP/SSE server、不会调用 MCP tool，也不会写入任何外部平台配置。workspace 级发现必须由 HubServer 传入显式 `workspace` snapshot（`workspaceId/backendType/rootPath`）；Runtime 不根据 `workspaceId` 查询平台业务状态。Phase 2 在 Runtime 进程内增加 30 秒 TTL 缓存、基于候选文件 `mtimeMs + size` 的 fingerprint 自动刷新、强制刷新 API，以及 `capability-discovery` 服务状态；这些能力仍只服务只读可观测性，不改变 Run 执行链路。响应不得泄露 token、headers、完整 env、workspace root 或宿主机绝对路径。

#### Phase 4A Skill 注入边界

Runtime 可以在内部 AI SDK / Orchestrator Run 的 prompt assembly 阶段读取 `allowedSkills` 指向的有效 Skill 正文，并以 system prompt 区块注入给模型。该能力仍然不执行 Skill、不会启动 MCP server、不会扩展外部 agent 的 native Skill 开关，也不会把 Skill 正文返回给 HubServer 或前端消息流。

本阶段用户自定义智能体只允许引用 global Skill。workspace Skill 仍可被 discovery API 展示，但在缺少显式 workspace trust contract 前不会被用户自定义智能体注入。Runtime 只在诊断事件中返回 Skill id/name/source/level、截断状态和 warning，不返回正文。

健康检查响应格式：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345
}
```

### 2.4 进程退出与重启策略

HubServer 必须管理 Agent Runtime 的生命周期：

- **正常退出**：HubServer 收到 SIGTERM/SIGINT 时，先向 Agent Runtime 发送 SIGTERM，等待其优雅关闭（默认 5 秒），超时后发送 SIGKILL。
- **异常退出**：HubServer 监听子进程 `exit` 事件。若非正常退出（exit code !== 0 且非 SIGTERM），应自动重启 Agent Runtime，采用指数退避策略（初始 1 秒，最大 30 秒）。
- **连续失败**：连续重启失败 3 次后，HubServer 应停止重试，标记 Agent Runtime 为不可用，并向前端上报错误。

信号处理：

| 信号 | Agent Runtime 行为 |
| --- | --- |
| SIGTERM | 完成当前 Run，输出剩余事件，关闭 HTTP 服务，退出 |
| SIGKILL | 立即终止（由 OS 强制执行） |

## 3. 核心职责

Agent Runtime 的职责可以概括为六类。

### 3.1 任务执行

Agent Runtime 接收 API Server 发来的执行请求，启动一次 Agent Run。

一次 Run 可以是：

- 单 Agent 执行。
- 多 Agent 协作执行。
- Orchestrator 调度执行。
- 自建 Agent 执行。
- 外部 Agent 平台执行。
- 产物修改任务。
- 部署任务。

Agent Runtime 需要管理 Run 的生命周期：

- 创建。
- 启动。
- 执行中。
- 取消。
- 超时。
- 失败。
- 完成。

### 3.2 Orchestrator 调度

在群聊或复杂任务场景中，Agent Runtime 需要调用 Orchestrator 完成任务规划。

Orchestrator 的职责包括：

- 理解用户意图。
- 判断任务类型。
- 判断是否需要多个 Agent 参与。
- 将复杂任务拆分为多个子任务。
- 为每个子任务选择合适的 Agent。
- 确定执行顺序。
- 在必要时汇总各个 Agent 的输出，但不复述可见主智能体已经在聊天流中展示的回复。
- 在必要时处理失败降级。

课题要求 Orchestrator 在群聊模式下自动理解用户意图，将复杂任务拆解并分派给合适的子 Agent。可见主智能体的回复会以独立聊天内容展示给用户，Orchestrator 不应再以“以下是某智能体的回应”等形式复述全文；只有隐藏子智能体结果不可直接作为聊天内容展示，或用户明确要求总结时，Orchestrator 才需要聚合摘要。

MVP 阶段，Orchestrator 不需要做复杂 DAG 调度器外置化，可以直接在 Runtime 内采用“`write_plan` 计划工具 + `run_task` 任务工具 + 批次并行执行 + 汇总结果”的模式。`write_plan` 是 Runtime 内部计划工具，只对 Orchestrator 可见，用于输出 UI 可渲染计划；`run_task` 是 Runtime 内部任务工具，只对 Orchestrator 可见，用于调度当前群聊 participants 中的其他主智能体，或调度 Orchestrator 自身 `allowedSubagents` 中的隐藏子智能体。任务之间可通过 `dependsOn` 表达依赖关系。后续再扩展更复杂的并行恢复和冲突处理。

P1 冲突规避底座采用声明式文件锁 V0：Orchestrator 在委派可能写入已知文件的 `run_task` 时，可传入 `lockPaths` 申请 workspace-relative 精确文件锁。Runtime 使用单进程内存锁管理器按 `{ workspaceId, path }` 阻止其他 active delegated task 并发锁定同一文件；锁冲突以 `TASK_FILE_LOCK_CONFLICT` 形成 `task.failed` / `tool.failed`，不启动目标智能体。该能力只覆盖显式声明的 delegated task，不替代文件工具权限审批、外部 Agent workspace 隔离、强制写入拦截或自动合并。

Runtime 不再通过全局 `AgentRelation` 或 `agent-relations.json` 判断委派关系。主智能体之间的协作边界来自每次 Run 的 `participantAgentIds`，主智能体到隐藏子智能体的授权来自 `allowedSubagents`。

`planner` 与 `orchestrator` 的边界需要保持清晰：`orchestrator` 产出的是当前 Run 的执行计划，并可以通过 `run_task` 真实委派任务；`planner` 产出的是面向人类评审和决策的方案，不负责运行时路由、委派或汇总。当前 preset 中 `planner.delegationPolicy = "terminal"`，避免它成为第二个调度器。

工具体系、`write_plan`、`run_task` 语义、工具事件和审批边界的正式设计见 `docs/architecture/AGENT_TOOLS.md`。

### 3.3 Agent Executor 统一执行

Agent Runtime 需要通过统一执行接口接入内部智能体。这是 Agent Runtime 的核心设计之一。

内部智能体的运行方式可能不同，但对 Runtime 上层必须表现为同一套执行协议：

| Agent 类型 | 运行方式 |
| --- | --- |
| 普通 LLM 主智能体 | 通过模型 API 调用 |
| 系统预设主智能体 | 使用统一执行器与系统提示词运行 |
| 用户自定义主智能体 | 使用用户配置的 System Prompt 和模型运行 |
| 子智能体 | Runtime 内部能力单元，由主智能体委派调用 |
| Mock Agent | 用于 Demo 和测试 |

如果没有统一执行层，Runtime 内部会被不同智能体的调用方式污染。

因此，Agent Runtime 应将内部智能体差异封装到统一 `AgentExecutor` 内部，对上层只暴露统一的执行语义：

- 启动 Agent。
- 传入上下文。
- 接收流式输出。
- 接收工具调用、内部任务派发与批次调度。
- 接收产物结果。
- 接收错误信息。
- 返回统一事件。

当前实现中，`executorType = "ai-sdk"` 的主智能体会先通过 `ProviderService` 解析 `modelRef`，再交给 AI SDK 的 `streamText` 执行；`orchestrator` 也通过专用 `OrchestratorExecutor` 走 AI SDK `streamText` + `write_plan` + `run_task` 工具调用路径，仍然遵守同一套 `RunEvent` 协议。当前计划主事实来源是 `tool.completed(toolName="write_plan")`，而不是自然语言或私有计划事件。

主智能体的模型绑定是运行时配置覆盖层，持久化到 `config.dataDir` 下的 agent 模型绑定文件中，并在注册表加载时合并到 agent 定义。`orchestrator` 已被纳入允许绑定模型的内部主智能体集合，外部智能体和隐藏子智能体仍不在这套绑定层内。隐藏子智能体执行时固定继承直接调用方智能体的模型；继承只影响模型选择，不继承调用方工具、权限、系统提示词或身份。

Runtime 还维护一份系统默认模型设置，持久化在 `config.dataDir/system-model-settings.json`，结构为 `{ version: 1, systemDefaultModel?: { providerId, modelId } }`。该模型是系统预设主智能体缺少独立绑定时的默认来源，也是智能体绑定模型在首个用户可见事件前调用失败时的一次性降级模型。保存系统默认模型时 Runtime 会校验 provider 存在、启用、已配置 API key，model 存在、启用且支持 tools，以保障 `orchestrator`、系统智能体和后续任务型 Instruct Agent 的通用能力。

内部模型选择优先级为：可解析的智能体绑定优先；系统预设主智能体缺少绑定时使用系统默认模型；用户自定义智能体缺少绑定时继续返回 `MODEL_BINDING_MISSING`；隐藏子智能体仍继承直接调用方模型，但调用方是系统预设主智能体且缺少绑定时可经同一策略使用系统默认模型。外部智能体不参与这套模型策略。

内部 AI SDK 执行器和 `orchestrator` 支持首包前降级：绑定模型解析失败、provider/model 不可用、模型不支持 `orchestrator` 所需 tools，或 stream 在首个用户可见事件前失败时，可以用系统默认模型重试一次。首包边界以 Runtime 尚未对外发出 `message.*`、`tool.*`、`reasoning.*`、`permission.*` 或 `question.*` 为准；`agent.started` 与 `model.stream.part` 等预事件会在第一次尝试中缓冲，若发生降级则丢弃失败尝试的预事件。系统默认模型为空、无效或与失败模型相同时不降级；降级模型再次失败时沿用现有 `AgentModelResolutionError` 或普通 `RUN_FAILED` 映射。

Runtime 还支持独立的系统智能体层，用于自动执行不属于用户可见主智能体和隐藏子智能体的维护任务。首版系统智能体为 `title`：在会话仍需要自动命名时触发，优先使用系统默认模型生成短标题；未配置系统默认模型时，保留继承当前 Run 入口智能体模型快照的兼容行为。标题只使用会话第一条用户输入；若首次自动标题错过且 `titleSource` 仍为 `default`，后续 Run 可通过 `conversationState.titleSeedUserMessage` 重试。标题结果一旦 ready 且 Run 仍未结束，Runtime 会立即在同一条 Run SSE 中输出 `system_agent.completed`；主智能体完成时仅保留一个很短的 flush 宽限时间作为兜底。若模型标题没有赶上或生成失败，Runtime 会在 `run.completed` 前输出一个基于首条用户消息的确定性 fallback 标题事件，然后取消后台标题任务。Runtime 不直接更新会话标题；HubServer 消费该事件并在标题未被用户手动修改时落库。

系统预设主智能体的系统提示词集中维护在 `agent-runtime/src/agents/preset-agent-prompts.ts`。这些提示词应明确职责边界、性格特点和 IM 群成员式回复风格，使主智能体像真实协作成员一样发言，而不是把自己表述为后台工具或泛化机器人。`AiSdkExecutor` 和 `OrchestratorExecutor` 都从 `AgentDefinition.systemPrompt` 读取提示词，再追加运行态上下文、任务信息、可用工具和会话参与者等执行说明。普通主智能体不会看到 `internal` 工具；`orchestrator` 通过专用执行路径显式开启 `includeInternal=true`，因此只它能看到 `write_plan` 和 `run_task`。

每个 Runtime Run 创建后会生成一次 `RuntimeEnvironmentSnapshot`，并追加进 AI SDK 执行器的 system prompt。该快照只用于模型上下文，不进入 Runtime HTTP API、HubServer API 或前端 SSE/消息投影。

`question` 是 AI SDK 智能体的 deferred interaction tool。Runtime 在 AI SDK tool set 中只注入 schema，不提供 `execute`；当模型产生 `question` tool call 时，执行器捕获该调用并交给 `RunManager` 创建 question continuation frame。用户提交答案后，Runtime 追加合成 `tool-result` message 并二次执行同一分支。用户也可以通过 Run cancel 放弃等待中的 question；这种 Skip/停止回答路径只取消当前 Run，不提交答案，也不产生合成 `tool-result`。

AI SDK `streamText().fullStream` 的底层 part 通过 `model.stream.part` 薄封装进入 RunEvent 流；provider/AI SDK 显式暴露的 reasoning/thinking 会同步提升为 `reasoning.started`、`reasoning.delta`、`reasoning.completed`。RunInput 可通过 `diagnostics` 关闭模型流透传、关闭 reasoning 输出或显式开启 `raw` chunk。默认开启 `includeModelStream` 和 `includeReasoning`，默认关闭 `includeRawModelChunks`。完整 SSE 契约见 `docs/contracts/RUNTIME_SSE_EVENTS.md`。

### 3.3.1 当前对话链路闭环状态

当前 Runtime 内部对话链路已经闭环到以下程度：

- `GET /runtime/agents`、`GET /runtime/agents/:id` 可以查询注册表中的可见主智能体、模型绑定与工具能力。
- `POST /runtime/agents`、`PUT /runtime/agents/:id`、`DELETE /runtime/agents/:id` 可以管理用户自定义主智能体；首版只支持 `origin = "user"`、`executorType = "ai-sdk"` 的可见主智能体。
- `PUT /runtime/agents/:agentId/model` 可以为可见、启用的内部主智能体绑定 provider/model，外部智能体和隐藏子智能体不可绑定。
- `POST /runtime/runs` 可以接收单聊或群聊 RunInput，并通过 `EntryResolver` 实现单聊入口、群聊默认 `orchestrator`、群聊显式 @ 单个主智能体。
- `coder`、`reviewer`、`writer`、`planner` 作为内部系统预设主智能体，已经走 `AiSdkExecutor`、模型解析、系统提示词、流式 `message.*` 事件和非内部 Runtime Tools。
- `orchestrator` 已走真实 AI SDK tool calling，能够使用 `write_plan` 输出 UI 可渲染计划，并使用 `run_task` 委派当前 Run participants 中的其他主智能体或自身 `allowedSubagents` 中的子智能体；`run_task.lockPaths` 已提供 P1 声明式文件锁 V0，用于规避已知文件的并发委派写入冲突。
- `GET /runtime/runs/:runId/events` 可以 replay 和继续推送 `run.*`、`agent.*`、`message.*`、`tool.*`、`task.*`、`model.stream.part`、`reasoning.*`、完整 `permission.*` 与 `question.*` 事件。
- Runtime 已支持 `waiting_approval`：沙箱外读取、workspace 内敏感读取、沙箱外敏感读取、敏感写入和沙箱外写入请求审批后，通过 permission decision API 在同一个 Run 中批准、拒绝或取消，并恢复原执行分支。
- Runtime 已支持 `waiting_input`：AI SDK 智能体调用 `question` 后，Runtime 保存 continuation frame；用户通过 question answer API 回答后，同一 Run 恢复原执行分支。
- `write_file` / `edit_file` 已开放给 `coder`、`writer` 和 `file` 子智能体；用户自定义智能体也可在显式配置 `filesystem: "write"` 后选择这些工具。
- `web_fetch` 已开放给 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 这些系统预设主智能体，默认 `permissionPolicy.network = "full"`，可直接执行 HTTP(S) 请求；`opencode`、`claude-code` 与 `codex` 的网络策略也为 `full`，但外部适配器不注入 Runtime Tool。用户自定义智能体暂不开放网络工具。
- `bash` 已开放给 `orchestrator`、`coder`、`reviewer`、`writer`、`planner` 这些系统预设主智能体，默认 `permissionPolicy.shell = "limited"`，通过 `toolPermissionRules.bash` 做命令级 `allow | ask | deny` 控制；`opencode`、`claude-code` 与 `codex` 仍不注入 Runtime `bash`，原生命令/工具由对应 external adapter 映射。用户自定义智能体暂不开放 shell 工具和 bash 规则。
- `question` 隐式开放给所有内部 AI SDK 智能体，包括预设主智能体、隐藏子智能体和用户自定义智能体；它不进入用户自定义智能体 authoring options。外部 adapter 不注入 Runtime Tool Catalog 形式的 `question`，但可以通过 RunManager 的 external question waiter 把 Claude Code `AskUserQuestion` 等外部用户问答桥接为同一组 `question.*` 事件。
- 通用 Workspace Diff Summary V0 已闭环到 Runtime 终态事件：Run 创建时捕获 git baseline，`run.completed` / `run.failed` / `run.cancelled` best-effort 携带 `data.workspaceDiff`。该能力覆盖内部预设智能体、隐藏 `file` 子智能体、用户自定义写入智能体以及 OpenCode、Claude Code、Codex 等外部智能体。

尚未完全闭环的部分：

- HubServer 已开始作为产品状态中心消费 Runtime RunEvent，并持久化 user/assistant text messages、Run 状态、RunEvent 和最新 Plan；task/tool/reasoning/permission 的完整产品级 MessagePart 投影和 Artifact 投影仍未完成。当前 smoke 仍可直接访问 Runtime，但产品链路应使用 `web -> hub-server -> agent-runtime`。
- 前端已能从 `tool.completed(toolName="write_plan")` 投影当前计划，并在右侧“会话状态”面板展示；`task.*`、`tool.*`、`permission.*`、`reasoning.*` 已有 live timeline UI，但持久化恢复仍主要依赖原始 RunEvent，完整产品级 parts 投影留待后续阶段。
- HubServer 还未提供面向浏览器的自定义 Agent 管理 API 和配置 UI；当前 CRUD 仍是 Runtime 内部 API。
- 权限审批和用户问答已具备产品级 API 代理、事件持久化和前端交互；更完整的产品级 MessagePart/Artifact 投影仍在后续阶段。
- 隐藏子智能体 `explore`、`general`、`file`、`deploy` 已切换到 AI SDK 执行器并继承调用方模型；后续仍需为不同子智能体继续细化专用系统提示词与高风险工具策略。
- 外部智能体 `opencode`、`claude-code` 与 `codex` 已进入 `ExternalAdapterExecutor`，并以可见主智能体身份参与单聊、群聊显式调用和 Orchestrator delegated task。OpenCode 默认使用真实 OpenCode client，Runtime 已接入 `@opencode-ai/sdk/v2`，在 SDK 暴露安全 workspace 启动参数时可走 managed server；当前 SDK 未暴露 cwd/workdir/projectPath 时，使用 `opencode serve` 子进程以 workspace root 为 `cwd` 启动，并通过 `project.current` / `path.get` 校验 workspace。Claude Code 默认使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` async generator，`cwd` 固定为绑定 workspace root，可通过 `resume` 复用 HubServer 注入的 provider session hint，并通过 `canUseTool` 与 `onUserDialog` 桥接权限和用户问答；其中 `AskUserQuestion` 即使从 `canUseTool` 进入也必须走 question bridge，不产生权限审批。Codex 默认使用 `@openai/codex-sdk` 的 `startThread()` / `resumeThread(threadId)` 与 `thread.runStreamed()` / `thread.run()`，`cwd` 固定为绑定 workspace root，首轮 thread id 可通过 `session.updated` 回传真实 provider session。HubServer 已具备 provider-aware 外部 Session 映射、direct context bridge、通用 Workspace Diff 投影，以及 OpenCode/Claude Code/Codex 的 event stream/tool timeline 映射。
- 文件系统工具目前已开放 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`；Shell 工具目前已开放 `bash` 给内部预设主智能体；Workspace Diff、只读 Diff Viewer、ChangeSet 归因和可靠 Diff 的完整 Run 级撤销 V0 已开放。单文件/单 hunk revert、pre-apply proposed patch、隔离 workspace 合入和 deploy 仍未开放。

### 3.3.2 Instruct Agent（对话式智能体创建）

Instruct Agent 是一个独立的对话式智能体创建能力，不需要参与普通 Orchestrator 调度或群聊协作，通过独立的 instruct run 流程运行。

**职责**：

- 通过对话收集用户需求并创建用户自定义智能体。
- 判断信息是否足够（name、description、systemPrompt）。
- 信息不足时通过 `question` 工具向用户提问。
- 信息足够时调用 `save_agent` 工具写入 `AgentStore`。

**运行边界**：

- `instruct-agent` 只进入独立的 `InstructAgentRegistry`（位于 `agents/`，与 `AgentRegistry` 同级），不加载到普通 `AgentRegistry`。
- 普通 `GET /runtime/agents` 不会列出 `instruct-agent`。
- 运行入口只走 `POST /runtime/instruct-runs` 和独立的 `InstructRunManager`。
- 不进入普通 `RunManager` 的 EntryResolver、不参与群聊、不支持任务委派。

**工具集**：

| 工具 | 说明 |
| --- | --- |
| `question` | 复用现有 question schema 和 answer payload，用于向用户收集信息 |
| `save_agent` | 直接通过 `AgentStore.loadAgents()` / `AgentStore.saveAgents()` 写入用户主智能体；只注册到 instruct 专用 tool registry |

首版 `save_agent` 工具白名单只允许 `ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`；首版强制 `shell = "none"`、`network = "none"`、`deploy = "none"`。

**模型选择**：

- Instruct Agent 首版使用系统默认模型。
- 要求模型支持 tools 能力。
- 不修改普通 `model-resolver.ts` 行为。

**隔离策略**：

- `instruct-runtime` 自带独立 `InstructRunManager`、`InstructToolRegistry`、`InstructAgentExecutor`，以及位于 `agents/` 的 `InstructAgentRegistry`。
- `InstructAgentExecutor implements AgentExecutor`，使用与 `AiSdkExecutor` 相同的 `runWithPreVisibleFallback` 模型解析降级流程。
- `InstructRunManager` 遵循与 `RunManager` 相同的 `createRun → queueMicrotask → executeRun → updateRunStatus → emit` 生命周期。
- 只复用底层稳定积木（AI SDK、Zod schema、`question` 输入规范、RunEvent 事件形状、`AgentStore` 持久化）。
- 不复用普通对话的 EntryResolver、RunManager、AgentRegistry、默认 RuntimeToolRegistry 和 Orchestrator 调度。

**持久化**：

- `save_agent` 直接调用 `AgentStore.loadAgents()` 和 `AgentStore.saveAgents()`，不经过普通 `AgentRegistry.createUserAgent()`。
- 保存逻辑遵循与 `createUserAgent` 相同的校验模式：`normalizeStringList` 去重去空格、`normalizeAllowedToolsForInstruct` 工具白名单校验、`normalizePermissionPolicyForInstructAgent` 权限策略校验（含 filesystem 等级推导）、`normalizeUserToolPermissionRules` bash 规则拒绝。
- 所有首版权限策略集中在 `instruct-agent-authoring-policy.ts`，后续开放 shell/network/deploy 只扩展此文件。
- 保存时生成完整 `AgentDefinition`，`origin = "user"`、`tier = "primary"`、`visibility = "visible"`。
- 工具结果返回完整新智能体信息，HubServer 可立即更新产品状态。



### 3.4 外部智能体 Adapter

Claude Code、Codex、OpenCode 等外部 Agent 平台差异，应该被封装在 Adapter 内部，对上层只暴露统一事件。

课题要求通过统一适配器层屏蔽 Claude Code、Codex、OpenCode 等主流 Agent 平台差异，并支持用户自建 Agent，因此 Adapter 仍然是 Agent Runtime 的关键架构点，但它只面向外部智能体。

外部智能体的最新接入原则是把它们视为 AgentHub 中的可见聊天对象，而不是 AgentHub 托管的模型供应商、Skill 或 MCP 配置面板。公共外部智能体边界、Session scope、上下文 handoff、权限桥接和 Diff 投影见 `docs/external_agents/EXTERNAL_AGENT_ADAPTERS.md`；OpenCode 专属 Project/Session 映射和事件设计见 `docs/external_agents/OPENCODE_ADAPTER.md`；Claude Code 的 SDK、Session resume、权限、`AskUserQuestion` 和 Bun compiled binary 风险见 `docs/external_agents/CLAUDE_CODE_ADAPTER.md`；Codex 的 SDK-first、app-server fallback、`codex exec --json` fallback、Session/权限/事件映射见 `docs/external_agents/CODEX_ADAPTER.md`。

### 3.5 上下文组装

Agent Runtime 不直接管理完整业务数据库，但在执行前需要由 API Server 提供必要上下文。

Runtime 需要将这些上下文整理成 Agent 可理解的输入。

典型上下文包括：

- 当前用户消息。
- 会话历史。
- 被 pin 的关键消息。
- 当前会话中的 Agent 列表。
- Agent 的能力标签。
- Agent 的 System Prompt。
- Run 开始时捕获的 Runtime environment snapshot。
- 历史 Artifact。
- 当前正在编辑的产物。
- 用户选中的代码片段。
- 任务目标。
- 约束条件。

课题要求每个对话保持完整聊天历史，Agent 能基于历史消息理解上下文，并支持手动 pin 关键消息作为长期上下文。

因此，Agent Runtime 不只是简单把用户输入转发给模型，而是要承担“执行上下文编排”的职责。

### 3.5.1 Runtime Environment Snapshot

Runtime 在 `POST /runtime/runs` 创建 Run 后，基于当前 `WorkspaceService` 捕获一次环境快照，并保存在 `RunExecutionState`。同一个 Run 中的入口主智能体、隐藏子智能体、`run_task` delegated task、以及审批恢复后的 continuation frame 都复用同一份快照，避免一次任务内出现时间、cwd、shell 描述不一致。

快照字段：

```ts
type RuntimeEnvironmentSnapshot = {
  capturedAtIso: string
  timezone: string
  os: {
    platform: NodeJS.Platform
    release: string
    arch: string
  }
  workspace:
    | {
        bound: true
        cwd: "."
        workspaceId: string
        backendType: string
        rootLabel: string
        absolutePath: string
      }
    | {
        bound: false
        cwd: "."
      }
  shell: {
    toolName: "bash"
    displayName: string
    commandSyntax: "PowerShell" | "POSIX sh" | "Bash" | "cmd.exe" | "custom"
  }
  git:
    | {
        repository: true
        branch?: string
        dirty: boolean
        ahead?: number
        behind?: number
        changes: {
          modified: number
          added: number
          deleted: number
          renamed: number
          untracked: number
          conflicted: number
        }
      }
    | { repository: false; unavailableReason?: string }
    | { repository: "unknown"; unavailableReason: string }
}
```

注入范围：

- AI SDK 内部主智能体、用户自定义主智能体和隐藏子智能体都会收到该 system prompt 区块。
- `OrchestratorExecutor` 也会收到同一格式的区块，并把它传递给自身的任务拆解上下文。
- 外部 `external-adapter` 智能体不受该机制影响；它们仍由各自 adapter 负责上下文注入。

Git 状态只注入摘要。Runtime 使用非 shell 方式执行 `git -C <workspace> status --porcelain=v1 --branch`，超时为 800ms；失败不会阻塞 Run，而是写入 `repository: false` 或 `repository: "unknown"` 与 `unavailableReason`。摘要只包含 branch、dirty、ahead/behind 与变更计数，不包含文件列表、diff 或完整 `git status` 输出。

Prompt 中会明确 `bash` 工具名固定为 `bash`，但命令语法应按 `shell.commandSyntax` 编写；workspace cwd 固定写作 `"."`。快照会包含 workspace 绝对路径，便于模型在用户询问或任务确实需要时给出准确上下文；同时提示模型不要主动复述本机绝对路径。

### 3.6 产物生成与执行环境管理

Agent 的输出不仅是文本，还可能是代码、网页、文档、Diff、部署状态等结构化产物。

Agent Runtime 需要负责将 Agent 的执行结果转化为平台可识别的产物事件。

典型产物包括：

- 文本回复。
- 代码片段。
- 代码文件。
- 网页预览。
- Diff 修改建议。
- 文件附件。
- 部署状态。
- 构建日志。
- 预览链接。

课题要求 Agent 回复中可以内联展示代码 Diff、网页预览卡片、文件附件等富媒体产物，并支持全屏预览、代码编辑、一键应用 Diff 等操作。

因此，Agent Runtime 需要具备基础 Workspace 能力：

- 为 Run 创建隔离工作目录。
- 管理 Agent 生成的文件。
- 读取和写入产物文件。
- 生成 Diff。
- 应用 Patch。
- 生成预览内容。
- 清理临时文件。
- 管理执行超时。

MVP 阶段，Workspace 可以是轻量本地目录；后续可以演进为沙箱、容器或远程执行环境。

当前 Runtime 只消费每次 `POST /runtime/runs` 传入的可选 workspace snapshot：

```ts
workspace?: {
  workspaceId: string
  backendType: "local"
  rootPath: string
}
```

首版规则：

- 一个 Run 最多绑定一个主 workspace，创建时固定，运行中不可切换。
- `backendType` 当前只支持 `local`。
- `rootPath` 必须是已存在目录；Runtime 使用 canonical real path 建立 session，不自动创建目录。
- 未携带 workspace 的 Run 可以继续纯对话；文件工具返回 `WORKSPACE_NOT_BOUND`，不会回退到 `config.workdir`。
- Run 查询只回显 `workspaceId`、`backendType` 和 `rootLabel`，不回显 `rootPath`。

Workspace Diff V0 由 Runtime 的通用 diff 服务负责，而不是由某个 Adapter 私有实现。Run 创建时，Runtime 基于绑定 workspace 捕获 git baseline，包括 repository 可用性、branch/head、dirty 状态和 status map；Run 完成、失败或取消时，在 workspace close 前计算 final status、changed files、numstat、diffstat 和 bounded patch，并写入终态 `RunEvent.data.workspaceDiff`。取消路径同样 best-effort 计算 diff：取消先 abort 正在执行的 adapter/tool，再输出带 diff 的 `run.cancelled`。行数统计优先来自 `git diff HEAD --numstat`；未跟踪文本文件不会出现在 git numstat 中，因此 Runtime 会读取文件内容 best-effort 计算新增行数，无法可靠统计时前端不应展示 `+0/-0` 伪统计。对于尚未首次 commit、没有可用 `HEAD` 的 Git 仓库，Runtime 会跳过必然失败的 HEAD numstat，并为未跟踪文本文件生成 fallback bounded patch；summary 仍会以 `head_unavailable` 标记为 degraded。

Diff V0 只基于 git。未绑定 workspace、非 git repository、git 不存在、git 命令超时或 patch 超预算时，Runtime 返回结构化 `unavailable` 或 `degraded` summary，不让 diff 失败升级为 Run 失败。如果 Run 开始前 workspace 已 dirty，summary 会标记 `baselineDirty = true`、`runOnlyReliable = false`。Runtime 会用 baseline/final 脏文件 fingerprint 尽量过滤掉本轮未变化的既有脏文件，但 dirty baseline 下 bounded patch 仍是 final-vs-HEAD 的保守摘要，不声称精确归因到本次 Run。HubServer 负责把有实际文件变化的 summary 投影为 `Artifact(type="diff")` 与 ArtifactVersion，并基于 Artifact Detail/ChangeSet 提供 Web 只读 Diff Viewer。

Runtime 还提供 `POST /runtime/workspace/revert/preview` 与 `POST /runtime/workspace/revert/apply` 供 HubServer 执行可靠 Diff 的完整 Run 级撤销。该 API 只接受 HubServer 从原 Run workspace 和 source Diff Artifact 派生出的请求；浏览器不直接访问 Runtime，也不传 workspace root。Runtime 只允许完整、未截断、非 binary、`baselineDirty = false` 且 `runOnlyReliable = true` 的 text patch，先执行 `git apply --reverse --check --whitespace=nowarn`，通过后再执行 `git apply --reverse --whitespace=nowarn`。patch 缺失、patch truncated、dirty baseline、非 git workspace、缺少 workspace、binary file、文件后续冲突或 reverse check 失败都返回结构化 `blocked`，不修改文件。响应只回显 `workspaceId/backendType`、文件 action、warnings 和 blocked reason，不泄露 workspace root。

Workspace 的具体读写实现应通过可插拔的 Workspace Backend 完成，相关设计见 `docs/architecture/AGENT_RUNTIME_BACKEND.md`。文件工具不直接接触宿主机绝对路径；当用户显式指定沙箱外目录或文件时，Runtime 必须先发起审批，再以受控授权挂载的方式暴露访问范围。workspace 内 `.env`、`AGENTS.md`、`.npmrc`、密钥文件和 VCS 元数据等敏感路径的显式内容读写也必须审批；`ls` / `glob` 隐藏敏感路径，目录递归 `grep` 跳过敏感文件。workspace 内普通文件写入和 search/replace 编辑在 agent 具备 `filesystem: "write"` 时直接执行，不逐次审批。

Runtime 通过每个 Run 独立的 `RuntimePermissionService` 存储内存态审批请求。AI SDK 的 `needsApproval` 会结束当次生成并返回 approval request；Runtime 将对应执行分支保存为 continuation frame。收到决定后追加 `tool-approval-response` 并再次执行同一分支，保持原始 `runId`、`toolCallId`、`agentId`、`taskId`、`parentAgentId` 和 `groupId`。同一 frame 的多个审批请求全部决定后只恢复一次；其他并行分支不会因单个审批失败而自动取消。

网络权限沿用现有三档 `permissionPolicy.network` 表达三态：`none = deny`、`limited = ask`、`full = allow`。`web_fetch` 在 `limited` 下会创建 `permissionType = "network_access"`、`approvalReason = "network_request"` 的权限请求，并在批准后用同一个 `toolCallId` 继续执行；HTTP 4xx/5xx 是正常工具结果，超时、网络异常、取消、响应体超过 `maxResponseBytes` 才是工具失败。

Shell 权限先由 `permissionPolicy.shell` 做粗粒度门禁：`none` 直接拒绝，`limited` / `full` 允许进入命令级规则。`bash` 使用 `AgentDefinition.toolPermissionRules.bash` 控制单条命令，规则值为 `allow | ask | deny`；`ask` 创建 `permissionType = "command_execute"`、`approvalReason = "bash_command"` 的审批请求，`deny` 在工具启动前失败。`bash` 不提供 OS/container sandbox，真实进程仍以 Runtime 所在用户权限运行；当前边界是命令规则、审批、workspace-relative `cwd`、环境变量白名单、超时和输出截断。完整设计见 `docs/architecture/BASH_TOOL.md`。

用户问答不走权限审批链路。内部 AI SDK 智能体调用 `question` 时会创建 `question.requested`，并在没有其他 active task 时将 Run 标记为 `waiting_input`；用户回答后发送 `question.answered` 和 `tool.completed(toolName="question")`，再以合成 `tool-result` message 恢复同一 execution branch。同一 frame 的多个 question request 全部回答后只恢复一次。外部 adapter 可通过 waitable external question bridge 复用同一事件协议；Claude Code 的 `onUserDialog` / `AskUserQuestion` 走该桥接，SDK 当前也可能先通过 `canUseTool("AskUserQuestion")` 暴露该工具，Adapter 必须把答案回传给 SDK `updatedInput.answers`，而不是合成 AI SDK `tool-result` 或产生 `permission.*`。取消 Run 时发送 `question.cancelled` 与对应 `tool.failed`，并关闭 continuation frame 或 external waiter，不再续跑原 execution branch。

### 3.7 事件流输出

Agent Runtime 不应只返回一个最终结果，而应输出一条持续的事件流。

原因是 Agent 执行过程本身就是渐进式的：

- Run 开始。
- Orchestrator 生成计划。
- 某个 Agent 开始执行。
- Agent 流式输出文本。
- Agent 调用工具。
- Agent 生成 Artifact。
- Agent 提出 Diff。
- 部署状态变化。
- Run 完成或失败。

前端聊天流需要实时展示这些状态，因此 Runtime 应将执行过程抽象为统一事件流，由 API Server 负责持久化和转发给前端。

Agent Runtime 的输出可以被理解为：一次 Run 的执行轨迹。

API Server 消费这条事件流后，将事件转化为业务状态，例如消息、Artifact、Diff、部署记录和 Run 状态。

## 4. Agent Runtime 与 API Server 的边界

### 4.1 API Server 负责什么

API Server 负责状态管理，包括：

- 用户鉴权。
- 会话管理。
- 消息管理。
- Agent 配置管理。
- Artifact 元数据管理。
- Artifact 版本管理。
- Run 状态持久化。
- Runtime 事件持久化。
- 前端 API。
- SSE 转发。
- 权限控制。

API Server 是系统的业务状态中心。

### 4.2 Agent Runtime 负责什么

Agent Runtime 负责执行过程，包括：

- Orchestrator 调度。
- Agent 选择。
- Agent Executor 调用。
- 外部 Agent Adapter 调用。
- LLM 调用。
- CLI Agent 进程管理。
- Workspace 管理。
- 工具调用。
- Diff 生成。
- Artifact 生成。
- 执行取消。
- 执行超时。
- 失败降级。
- 事件流输出。

Agent Runtime 是系统的执行引擎。

### 4.3 边界原则

为了保持架构清晰，需要遵守以下原则。

#### 原则一：前端不直接访问 Agent Runtime

前端只访问 API Server。

这样可以保证：

- 鉴权统一。
- API 统一。
- 状态一致。
- 前端不关心 Runtime 部署位置。
- 后续 Runtime 可以本地化、远程化或容器化。

#### 原则二：Agent Runtime 不直接写业务数据库

Agent Runtime 只输出事件。

API Server 负责消费事件，并将事件保存为消息、Artifact、Run 状态等业务数据。

这样可以避免两个服务同时修改业务状态。

#### 原则三：Agent Runtime 不关心 UI 细节

Runtime 不应该知道前端如何展示消息气泡、卡片、编辑器或预览面板。

Runtime 只负责输出结构化事件。

具体 UI 由 API Server 和前端根据事件内容渲染。

#### 原则四：Agent Adapter 不影响上层协议

Claude Code、Codex、OpenCode、普通 LLM、自建 Agent 的差异只存在于 Adapter 内部。

Runtime 对外输出统一事件。

API Server 和前端不需要知道底层 Agent 的具体实现方式。

## 5. 开发命令

`agent-runtime` 预期使用 Bun + Hono。脚手架完成后，需要在本文档中维护准确命令。

```bash
cd agent-runtime && bun dev
```

## 6. Hono 使用约定

Agent Runtime 使用 Hono 承载内部执行 API。通用 Hono 约定见 `docs/reference/HONO.md`。

**重要：实现任何 Hono 相关功能时，必须优先参考 Hono 官方 LLM 文档 `https://hono.dev/llms-small.txt`。**

- Runtime API 面向 `hub-server`，不直接面向 `web`。
- 内部执行 API 建议使用 `/runtime/*` 作为路径前缀。
- 保留 `/health` 作为健康检查端点。
- Run 创建、取消、状态查询、事件流订阅等路由应按领域拆分。
- Runtime 内部调用必须具备服务间鉴权或等价的内部访问控制设计。
- 执行错误应转换为结构化 Runtime 错误或 Runtime 事件，不应泄露底层 Provider、CLI 或系统细节。
- Run 事件流应保证开始、执行中、失败、超时、取消、完成等状态都有明确事件。
- 流式事件契约必须同步维护在 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`。
- 后续测试应优先使用 Hono `app.request()` 风格的轻量 API smoke test。
