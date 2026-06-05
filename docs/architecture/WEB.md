# Web 架构

`web/` 目录包含 React + Vite 前端项目，是 AgentHub 的主要用户界面。

## 职责

- 对话列表与会话导航。
- 单 Agent 聊天与多 Agent 群聊视图。
- 消息输入、消息流展示与流式状态展示。
- Agent 身份、头像、名称与能力标签展示。
- 代码、文件、网页预览、Diff、部署状态等 Artifact 卡片。
- 预览、编辑、应用 Diff 和部署等操作入口。

## 规则

- 只调用 `hub-server`，不能直接调用 `agent-runtime` 或 LLM Provider。
- 不能在浏览器中保存或直接使用 LLM Provider 凭据。
- UI 设计必须围绕 IM 产品模型展开。
- 在合适场景下，优先复用本仓库的 `ai-elements` 技能和组件。
- 前端契约类型必须与后端 API 返回保持同步。
- 新建单聊时，只展示可见、启用、可调用的主智能体；不展示 `orchestrator`，但允许选择外部主智能体。
- 新建群聊时，用户选择一个或多个可见主智能体，`orchestrator` 由 HubServer 自动加入且不需要用户手动选择。
- 聊天输入框在任意会话类型输入 `@` 都打开 mention 候选；群聊候选显示可直接 @ 的成员主智能体并排除 `orchestrator`，非群聊当前只显示空状态。当前阶段只允许结构化选择一个 @ 智能体；纯手打 `@Agent` 文本不改变路由。

## 当前应用工作区

- `App.tsx` 仅作为应用根组件和全局 Provider 容器；应用壳、一级导航和模块注册表位于 `web/src/features/app-shell/`，聊天模块及产物工作台位于 `web/src/features/workbench/`。
- 页面根布局由默认折叠、可展开的一级导航栏和模块内容工作区组成。一级模块必须通过 `features/app-shell/app-modules.tsx` 的集中注册表接入，不应在壳层复制模块专用的导航或切换判断。
- 首批一级模块为 `chat` 与 `agents`。`chat` 内容区使用“会话列表、聊天区、产物工作台”的三栏布局；`agents` 使用“智能体列表、详情/编辑区”的两栏布局。
- Chat 模块首次进入时不自动选中已有会话；`activeConversationId` 为空时右侧内容区渲染欢迎页，不挂载聊天面板和产物工作台。用户手动选择会话或创建新会话后，才渲染聊天区和产物工作台。
- 已选中的空会话不显示空白消息区；当 conversation 没有 timeline item 且 Run 处于 idle 时，聊天区中部渲染轻量空状态，保留 header 与 composer。
- 聊天模块的会话列表、会话详情、新建、重命名、置顶和归档已经接入 HubServer conversation API；列表卡片使用 `lastMessageContent` 显示最近一条文本消息，HubServer 返回前最多截取 50 个字符，前端保持单行 `truncate` 展示。会话列表由 HubServer 排序：置顶会话在最前，未置顶会话按 `lastMessageAt ?? createdAt desc` 排序，新建空会话会默认排在其他未置顶会话之前。消息发送与恢复当前走 HubServer 产品级 messages/runs API：Web 调用 `POST /api/conversations/:conversationId/messages/send`，再通过 `GET /api/conversations/:conversationId/messages` 获取最近窗口的 `timelineRuns` 产品 event replay 数据、active run snapshot、messages/runItems 和 latest plan。刷新页面后，聊天主 UI 通过重放产品 event envelopes 恢复，并用 `messages` 中的持久化 chat user/assistant 消息做兜底；完整 raw Runtime event 留在 HubServer `RunEvent.payloadJson`。
- 消息回复 V1 为整条消息回复。Web 在消息 action 行提供“回复”，composer header 显示被回复消息的紧凑引用预览和取消按钮；提交时只向 HubServer 发送 `replyToMessageId`，不由浏览器生成持久化快照。hydrate/merge 持久化消息时，Web 从 `metadataJson.replyTo` 恢复 `replyTo` timeline 字段并在消息气泡顶部渲染引用块，因此刷新、分页或父消息不在当前窗口时仍能显示引用摘要。
- 重新生成 V1 只作用于已完成 assistant chat 消息。Web 在 assistant 消息 action 行提供“重新生成”图标按钮，点击后调用 HubServer regenerate API，并进入与普通发送相同的 submitted/running/SSE hydrate 流程；hydrate/merge 持久化消息时保留 `metadataJson.regenerate` 和 `regeneratedFromId`。复制出的 user trigger 在气泡顶部显示“重新生成请求”和源回复摘要；如果源 assistant 在当前 timeline 窗口内，新替代回复会折叠进源回复的 `MessageBranch` 版本分页，并在候选气泡顶部显示“重新生成回复”标记；如果源消息不在窗口内，替代回复仍独立显示该标记。V1 不做设为首选答案、自动隐藏旧回复或线程视图。
- 会话列表卡片的运行状态只来自 Web 已经打开过的 conversation 在 Zustand 中的本地 Run 状态：提交、排队、运行和等待审批时，卡片右上角显示 spinner，底部显示 `InfiniteLinearProgress`；未打开过的 conversation 不从列表 API 初始化运行状态。卡片时间显示在右侧 hover 操作按钮下方，避免与编辑、置顶、归档按钮重叠。
- 聊天 header 使用 conversation detail 的成员关系和 runtime agents 查询结果渲染真实智能体头像组、会话标题、群聊/单聊 badge、参与智能体名称、成员数量、工作区标签和基础模型绑定提示；不得再依赖 workbench mock agent 数据。Header 不提供独立 pin 按钮；右侧使用 button group 提供产物工作台单例标签入口，点击后展开右侧工作台并打开对应标签页；面板折叠按钮保持独立。当前 Run 处于提交、排队、运行或等待审批时，header 底部使用 `InfiniteLinearProgress` 展示 indeterminate 进度线，不为 Run 状态单独保留一条额外状态栏。
- 产物工作台包含全局单例“会话状态”标签页，内容随当前 active conversation 切换。`orchestrator.plan.created` 或 `tool.completed(toolName="write_plan")` 投影出的 Plan 保留为本地 timeline item，但不在聊天消息流渲染；当前 Plan 在“会话状态”标签页中使用 ai-elements `Queue` 展示。当前会话收到新的 Plan 或 Plan 更新事件时，Web 会通过 Zustand workspace focus request 自动展开右侧产物工作台并激活“会话状态”标签页；切换到已有历史 Plan 的会话不会仅因历史数据自动弹开工作台。
- “会话状态”标签页还展示当前会话已知的运行上下文摘要：Git 信息来自最近一次 Diff Artifact 的 `workspaceDiff`，包括 branch/head、dirty 状态、变更文件数和增删行；Token 信息来自已投影到 assistant chat message 的 `generation.usage` 聚合，包括累计、输入、输出、推理和缓存输入 token。没有相关事实时显示空状态，不使用静态占位。
- Diff Artifact 卡片是右侧“代码审查”标签页的入口。live Run terminal event 产生的 Diff 卡片携带内存 `workspaceDiff`，可以立即打开只读 Diff Viewer；persisted Diff 卡片携带 HubServer artifact id，并可通过 `GET /api/conversations/:conversationId/artifacts/:artifactId` 获取 canonical detail。`review` 作为单例 tab，重复打开不同 Diff 时更新 payload 与标题。Diff 卡片整卡可点击，同时必须展示一个“打开代码审查”的图标按钮，让用户明确它可以打开审查面板。
- 当前 Diff Viewer 支持只读查看和可靠 Diff 的完整 Run 级撤销：展示文件列表、hunk、增删行、binary、truncated、dirty baseline 和 runOnlyReliable 提示；dirty baseline 下必须明确提示“不是精确 run-only patch”，并禁用撤销。若 HubServer artifact detail 返回 `diff.changeSet`，右侧“代码审查”面板顶部显示“来源：工具 / 任务 / 智能体 / 整个 Run”，每个变更文件以可展开卡片呈现，未展开时展示路径、增删行、归因 badge 和状态；展开后在同一卡片内展示归因详情和文件 Diff。ambiguous 时显示候选数量和“无法精确归因”。旧 Diff Artifact 没有关联 ChangeSet 时显示“归因正在同步”，不能崩溃或隐藏 Diff。可靠的 persisted 原始 Diff 显示“撤销本次变更”按钮；点击后先调用 HubServer preview API 展示受影响文件数和风险提示，再确认 apply。撤销成功后刷新会话消息和 artifact detail，并打开新的撤销记录 Diff Artifact；撤销记录显示 banner“这是一次撤销记录，Diff 展示的是被撤销的原始变更”，且不显示二次撤销按钮。当前不支持单文件、单 hunk、accept/reject 或 apply proposed patch。“代码审查”标签页内容必须随右侧产物工作台父容器宽度弹性变化：文件卡片占满父容器宽度，父容器变窄时内容继续压缩，文本路径截断，长代码行只在 Diff 区内部横向滚动，不能撑破父容器。
- Web 通过 HubServer 的产品级 `/api/conversations/:conversationId/messages*` 与 `/api/runs/:runId/*` API 发送消息、续订事件流和取消 Run；浏览器仍不得直接调用 `agent-runtime`。`/api/runtime/runs*` 仅保留为调试代理，不是聊天主路径。HubServer 创建 Runtime Run 时默认设置 `diagnostics.includeModelStream=false`，避免高频 `model.stream.part` 诊断事件进入前端热路径；需要调试模型原始 part 时再显式打开诊断。
- 设置页“AI能力 -> 模型”顶部展示系统默认模型设置。Web 调用 HubServer `/api/settings/model`，由 HubServer 代理 Runtime `/runtime/settings/model`，不直接访问 Agent Runtime，也不把该设置写入 HubServer `setting.json`。该设置用于系统内置智能体、系统内置任务智能体和智能体绑定模型首包前失败时的一次性降级；模型候选只展示已连接、已启用且支持 tools 的模型。
- Web 在 `App` 根部维护一条全局 `EventSource("/api/events")`，用于消费 HubServer 的 best-effort 产品状态通知。该通道只处理 conversation 标题、最近消息和 Run 状态等低频事件；不用于聊天 timeline，不做 replay，不做断线期间漏事件补偿。收到 conversation 事件后刷新 TanStack Query；收到 run 状态事件后只更新已打开 conversation 的 Zustand runtime state。
- 左侧一级导航在模块导航下方、用户栏上方展示系统服务状态面板。Web 只轮询 `GET /api/system/services/status`，不直接访问 Agent Runtime 或 OpenCode server。展开导航时显示 AgentRuntime、OpenCode、Codex、Claude Code 的紧凑中文状态；折叠导航时显示聚合状态点与 tooltip。OpenCode `idle` 显示为“待命”，Codex/Claude Code 未接入时显示“未接入”。
- 当前智能体头像 V1 由前端共享 resolver 根据 agent id/origin 解析：系统预设使用图标库，外部智能体可使用静态资源，未知或用户自定义智能体使用 initials/hash 兜底；API 契约暂不包含头像字段。
- 页面根容器填满视口，不产生 `body` 级滚动；模块内的列表、消息流、详情表单与产物内容各自在内部滚动。
- 网页预览面板内点击链接时，不在当前 iframe 内跳转；而是新开一个网页预览 tab。新 tab 标题优先使用页面 `document.title`，取不到时回退为目标 URL 的 hostname。
- 当同一 Web 应用运行在 Electrobun 桌面壳内时，`AppShell` 可以通过 Electrobun 注入的 `window.__electrobunWindowId` 与 `window.__electrobunWebviewId` 检测桌面运行时，并渲染自定义 `DesktopTitleBar`。普通浏览器不显示该标题栏，保持原 Web 布局。
- 生产 Desktop 首版不通过 `views://` 或 `file://` 加载 Web。Desktop 主进程应启动 HubServer，并让 WebView 打开 HubServer 托管的 `http://127.0.0.1:<port>`；因此 Web 继续使用相对 API 路径 `/api/*` 与 `/api/events`，不引入 Desktop 专属 API base。
- 桌面运行时由 `DesktopTitleBar` 承担 AgentHub 品牌展示；`AppNavigation` 不重复显示 Logo 与 `AgentHub` 标题。Windows 桌面壳应保留不透明、可调整大小的原生窗口，让窗口边缘缩放和圆角裁剪由系统处理；不要为 Web 外壳圆角启用透明宿主窗口，否则 resize 后的透明区域可能产生点击透传。普通浏览器不应用桌面外壳样式。
- 桌面标题栏拖拽区域必须同时使用 Electrobun 识别的 `.electrobun-webkit-app-region-drag` / `.electrobun-webkit-app-region-no-drag` 类；按钮和其他交互区域必须标记为 no-drag。
- 桌面标题栏只允许通过 Electrobun 最小 RPC 调用窗口控制能力（最小化、最大化/还原、关闭、查询窗口状态）。前端仍只能调用 `hub-server` 业务 API，不得通过桌面桥接访问文件、Shell、网络、Runtime 或 LLM 能力。
- Windows 桌面壳必须在加载 Electrobun 窗口 API 之前设置 per-monitor DPI awareness，避免系统在 125%/150% 等缩放屏幕上对整个窗口做位图拉伸，导致 Web 内容模糊。该行为属于 `desktop` 壳层职责，Web CSS 不应为此做额外缩放补偿。
- 创建智能体、绑定模型和删除确认维持模态操作；已有用户智能体配置在智能体模块右侧内容区内联编辑。

## 状态管理

- TanStack Query 管理服务端事实：active conversation list、conversation detail、runtime agents、conversation timeline replay snapshot、active run snapshot，以及后续 permissions/artifacts。
- Zustand 管理客户端运行态和 UI overlay：`activeConversationId`、per-conversation draft、由 `timelineRuns` 产品 event replay hydrate 出来的 timeline items、当前 HubServer active run id、Run 状态、SSE 连接状态、已收到 Runtime event ids、轻量 event log、产物工作台 tab、折叠状态和自动聚焦请求。会话列表可用该本地状态覆盖已打开会话的最近消息预览和运行状态；未打开会话不显示运行状态。`ResizablePanel` 等 DOM imperative ref 不进入 store，布局组件只消费 store 意图并执行展开/折叠。
- Conversation create、rename、pin、archive 使用 mutation；成功后 invalidate conversation list 和对应 detail。模态框开关、输入框内容等纯临时 UI 状态仍可以保留在组件局部 state。
- 当前阶段同一 conversation 同时只允许一个 active run。发送消息时 Web 不再自行组装 Runtime `RunInput`，而是调用 HubServer `POST /api/conversations/:conversationId/messages/send`；HubServer 从持久化 messages 投影 Runtime `history`，并透传由结构化 mention 选择得到的 `addressedAgentIds`。未选择 mention 时 `addressedAgentIds` 为空数组，保持默认入口规则。
- HubServer 产品 SSE 事件格式为 `{ sequence, event }`；Web 用 `activeRun.lastEventSequence` 作为 `afterSequence` 续订，收到后仍按 Runtime `event.id` 去重，并通过 Web 本地 projection reducer 转为 `WorkbenchTimelineItem` 后渲染。产品 event 的 `event.runId` 是 HubServer 本地 Run id，`event.runtimeRunId` 保留 Agent Runtime run id，Web 调用产品 API（取消、审批、续订）必须使用本地 Run id。会话 hydrate 以 `timelineRuns` 为主路径：按 run 顺序插入 trigger user message，再按每个 run 的 `sequence asc` 重放产品 event envelopes；随后合并 `messages` 中 `surface="chat"` 的 user/assistant 记录作为持久化兜底，并按 `runId + runtimeMessageId` 去重，避免 OpenCode 等外部智能体回复已经投影落库但 raw replay 窗口不完整时消失。live SSE 与 replay 共用同一套 projection reducer。为保护 `EventSource` 热路径，大工具结果可以由 HubServer 投影为 UI 摘要（例如 `web_fetch` 不向前端传输 body，只显示 URL、状态码、bytes 和耗时等摘要）。切回会话时 messages snapshot 必须强制 refetch，组件生命周期 cleanup 必须断开旧 run stream，再用 fresh `activeRun.lastEventSequence` 续订 live SSE，避免切回后只等 terminal snapshot 刷新。`message.delta` / `message.completed` 优先使用 `event.messageId` 作为聊天气泡身份：`chat:${runtimeRunId}:${messageId}`；缺少 `messageId` 的老事件才回退到 `runId + agentId + taskId/entry`。
- HubServer 全局事件流 `GET /api/events` 独立于产品 Run SSE。全局事件只作为 query invalidation 和已打开会话运行态更新信号；它不进入 timeline projection，也不影响产品 event replay 顺序。
- `messageId` 是 Web 聚合智能体消息的主键：同一 `messageId` 下的 `reasoning.*`、普通 `tool.*`、`permission.*` 和 `message.*` 会嵌入同一个 `chat_message` item；旧事件缺少 `messageId` 时，Web 退回按同一 run 内当前 chat speaker 聚合。这样 reasoning、工具和审批是消息内部过程卡片，而不是散落在消息流里的独立发言。
- Web timeline projection 会从 `message.*.data.generation` 合并每条内部 assistant 消息使用的模型信息，并在收到同一 execution 的 `agent.completed.data.generation` 后把 usage、finishReason 和 durationMs 补到最后一条可见 assistant 消息。外部智能体可通过 `message.completed.data.externalModel` 提供本条回复实际使用的外部平台模型。聊天消息 action 行在复制按钮左侧显示模型名与 compact total tokens，或显示 OpenCode 等外部平台的实际回复模型名；若外部平台没有返回 display name，UI 可将 model id 人类可读化作为 fallback。tooltip 展示 provider/model id、token breakdown、耗时和结束原因等可用事实。该信息只来自 Runtime event replay/live SSE，不读取当前 agent 绑定状态推断历史消息。
- assistant 消息在 `status === "streaming"` 时，无论当前是否已经有正文内容，消息底部都应保留稳定的“正在生成...” 指示，避免切换会话后只剩正文却看不出仍在流式输出。
- Run-level raw SSE 中的 `system_agent.completed(systemAgentId="title")` 不投影为聊天 timeline item。HubServer 消费该事件并条件落库后，通过全局 `conversation.title.updated` 事件通知 Web 刷新 conversation list/detail 查询；当前活动会话的 run-level SSE 也会把该事件作为刷新兜底，避免 best-effort 全局事件漏送时标题不更新。
- Reasoning UI 的耗时显示由 Web timeline projection 使用 `reasoning.started` / `reasoning.completed` 的 event timestamp 推导并写入 timeline item，再传给 ai-elements `Reasoning` 组件；不要依赖组件挂载期间的本地计时作为 replay 后的事实来源。
- `message.delta` / `message.completed` 只在 `event.agentId` 属于 conversation chat speakers 时投影为 `chat_message`；非 chat speaker 的子智能体输出进入关联 `task` item，不创建普通聊天气泡。子智能体的 reasoning/tool/permission 同样优先进入关联 task item；无法归属到消息或 task 的老事件才作为独立 reasoning/tool/permission timeline item 渲染。`orchestrator.plan.created` 和 `write_plan` 成功结果投影为 plan timeline item，供右侧“会话状态”标签页展示。`run.failed` / `run.cancelled` 投影为 run status item。
- `toolName = "run_task"` 的 `tool.*` 事件保留在原始 event log 中，但不投影为 `ToolTimelineItem`，避免与 `task.*`、子智能体输出和 task summary 重复展示。普通工具仍渲染为 tool 卡片；Tool 卡片只渲染适合 UI 展示的轻量输出，`web_fetch` 等大响应体由 HubServer 产品 envelope 投影为摘要，完整事实保留在 HubServer `RunEvent.payloadJson`。
- 外部智能体原生工具继续复用 AgentHub 的普通 Tool UI，不建立 OpenCode 专属渲染链路。会话恢复时，持久化 `MessagePart(type="tool")` 必须恢复为 assistant 消息内的 `toolItems`；否则 live 时闪现过的外部工具会在刷新或 snapshot merge 后消失。外部工具的 `data.externalProvider` 是渲染边界：即使 OpenCode 原生工具名为 `bash`，也不得进入内部 AgentHub `bash` tool 的 Terminal 专用视图，除非该 tool 没有外部 provider 标记。
- Task 卡片标题只来自任务 title / instruction 的短摘要兜底，不得使用 `task.completed.data.summary` 作为标题；`summary` 可能包含子智能体完整输出，应保留为运行结果/上下文数据，而不是 UI 标题。
- SSE 事件进入 Web 后按 animation frame 批量写入 Zustand；`receivedEventIds` 使用 per-conversation `Set` 去重，轻量 event log 只保留最近一段 UI 相关事件，避免子智能体和工具调用产生大量诊断事件时触发每事件一次的全量重渲染。
- Timeline 渲染层复用本仓库 `ai-elements` 组件：chat message 使用 `Message`，普通 tool 使用 `Tool`，`bash` tool 直接使用 `Terminal` 展示命令状态和 stdout/stderr 结果，task 使用 `Task`，permission 使用 `Confirmation`，reasoning 使用 `Reasoning`。Plan 不作为聊天流 item 渲染，而是在产物工作台“会话状态”标签页使用 `Queue` 展示。Timeline 渲染不得再依赖 workbench mock agent 数据，智能体头像与名称来自 conversation detail + runtime agents 查询结果。

## Activity 生命周期约束

- 一级模块在首次访问后使用 React `Activity` 保持挂载；产物工作台的标签页内容也可以使用内部 `Activity` 保持 UI 状态。
- `Activity` 进入 `hidden` 时会保留组件状态与 DOM，但会清理隐藏子树中的 Effects；恢复为 `visible` 时 Effects 会重新建立。
- `Activity` 只负责 UI 状态保活，例如输入草稿、已选会话、列表筛选、打开的产物标签页和面板布局状态。不要依赖隐藏模块中的 effect 持续执行后台工作。
- Run SSE 连接由 workbench runtime connection manager 管理，EventSource 实例不得保存在 React 组件局部 state 中。聊天组件只订阅 Zustand 中的可渲染状态。
- 切换 conversation 时，Web 关闭切出会话的 EventSource，但绝不调用 cancel；HubServer 后台 consumer 继续消费 Runtime SSE 并持久化 RunEvent。切回该 conversation 时，Web 先重新加载 `timelineRuns` 并重放产品 event envelopes；若 `activeRun` 非终态，则重新打开 `/api/runs/:runId/events?afterSequence=:lastEventSequence`，由 HubServer replay sequence 更大的持久化事件并继续推送 live events。如果 Run 在切走期间完成，切回后 replay 已包含完成事件且不会保持连接。
- 端到端持久化和恢复机制见 `docs/architecture/RUN_PERSISTENCE_AND_STREAMING.md`。
- React 行为参考官方文档：[Activity](https://react.dev/reference/react/Activity)。

## 开发命令

```bash
cd web && bun dev
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```
