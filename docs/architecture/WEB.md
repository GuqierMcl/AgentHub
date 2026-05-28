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
- 群聊消息当前阶段只允许显式 @ 一个主智能体；未 @ 时默认由 `orchestrator` 接管，后续再扩展并行 @ 多个主智能体。

## 当前应用工作区

- `App.tsx` 仅作为应用根组件和全局 Provider 容器；应用壳、一级导航和模块注册表位于 `web/src/features/app-shell/`，聊天模块及产物工作台位于 `web/src/features/workbench/`。
- 页面根布局由默认折叠、可展开的一级导航栏和模块内容工作区组成。一级模块必须通过 `features/app-shell/app-modules.tsx` 的集中注册表接入，不应在壳层复制模块专用的导航或切换判断。
- 首批一级模块为 `chat` 与 `agents`。`chat` 内容区使用“会话列表、聊天区、产物工作台”的三栏布局；`agents` 使用“智能体列表、详情/编辑区”的两栏布局。
- Chat 模块首次进入时不自动选中已有会话；`activeConversationId` 为空时右侧内容区渲染欢迎页，不挂载聊天面板和产物工作台。用户手动选择会话或创建新会话后，才渲染聊天区和产物工作台。
- 聊天模块的会话列表、会话详情、新建、重命名、置顶和归档已经接入 HubServer conversation API；消息流当前处于“未持久化 Runs 聊天”阶段：Web 使用本地 Zustand 状态保存每个 conversation 的草稿、临时消息、最近 Runtime `runId`、Run 状态、SSE 连接状态和已接收事件 id，刷新页面丢失这些本地消息与 active run 映射是当前阶段的预期行为。
- 聊天 header 使用 conversation detail 的成员关系和 runtime agents 查询结果渲染真实智能体头像组、会话标题、群聊/单聊 badge、参与智能体名称、成员数量、工作区标签和基础模型绑定提示；不得再依赖 workbench mock agent 数据。当前 Run 处于提交、排队、运行或等待审批时，header 底部使用 `InfiniteLinearProgress` 展示 indeterminate 进度线，不为 Run 状态单独保留一条额外状态栏。
- Web 通过 HubServer 的 `/api/runtime/runs*` 转发接口创建 Runtime Run、订阅 Run SSE 和取消 Run；浏览器仍不得直接调用 `agent-runtime`。本阶段不写 HubServer `Message`、`Run` 或 `RunEvent` 表，后续由产品级 messages/runs API 接管持久化。
- 当前智能体头像 V1 由前端共享 resolver 根据 agent id/origin 解析：系统预设使用图标库，外部智能体可使用静态资源，未知或用户自定义智能体使用 initials/hash 兜底；API 契约暂不包含头像字段。
- 页面根容器填满视口，不产生 `body` 级滚动；模块内的列表、消息流、详情表单与产物内容各自在内部滚动。
- 当同一 Web 应用运行在 Electrobun 桌面壳内时，`AppShell` 可以通过 Electrobun 注入的 `window.__electrobunWindowId` 与 `window.__electrobunWebviewId` 检测桌面运行时，并渲染自定义 `DesktopTitleBar`。普通浏览器不显示该标题栏，保持原 Web 布局。
- 桌面运行时由 `DesktopTitleBar` 承担 AgentHub 品牌展示；`AppNavigation` 不重复显示 Logo 与 `AgentHub` 标题。Windows 桌面壳应保留不透明、可调整大小的原生窗口，让窗口边缘缩放和圆角裁剪由系统处理；不要为 Web 外壳圆角启用透明宿主窗口，否则 resize 后的透明区域可能产生点击透传。普通浏览器不应用桌面外壳样式。
- 桌面标题栏拖拽区域必须同时使用 Electrobun 识别的 `.electrobun-webkit-app-region-drag` / `.electrobun-webkit-app-region-no-drag` 类；按钮和其他交互区域必须标记为 no-drag。
- 桌面标题栏只允许通过 Electrobun 最小 RPC 调用窗口控制能力（最小化、最大化/还原、关闭、查询窗口状态）。前端仍只能调用 `hub-server` 业务 API，不得通过桌面桥接访问文件、Shell、网络、Runtime 或 LLM 能力。
- Windows 桌面壳必须在加载 Electrobun 窗口 API 之前设置 per-monitor DPI awareness，避免系统在 125%/150% 等缩放屏幕上对整个窗口做位图拉伸，导致 Web 内容模糊。该行为属于 `desktop` 壳层职责，Web CSS 不应为此做额外缩放补偿。
- 创建智能体、绑定模型和删除确认维持模态操作；已有用户智能体配置在智能体模块右侧内容区内联编辑。

## 状态管理

- TanStack Query 管理服务端事实：active conversation list、conversation detail、runtime agents，以及后续持久化 messages/runs/permissions/artifacts。
- Zustand 管理客户端运行态和 UI overlay：`activeConversationId`、per-conversation draft、第一阶段未持久化 messages、最近 active Runtime `runId`、Run 状态、SSE 连接状态、已收到 Runtime event ids 和轻量 event log。
- Conversation create、rename、pin、archive 使用 mutation；成功后 invalidate conversation list 和对应 detail。模态框开关、输入框内容等纯临时 UI 状态仍可以保留在组件局部 state。
- 当前阶段同一 conversation 同时只允许一个 active run。发送消息时 Web 先 append 本地 user message，再调用 `POST /api/runtime/runs`，并把本地历史消息投影为 Runtime `history`；`addressedAgentIds` 暂固定为空数组。
- Runtime 事件按 `event.id` 去重。`message.delta` 追加到本地 assistant streaming message，`message.completed` 对齐最终内容；第一阶段本地 assistant message 只为 conversation detail 中的 chat speakers 创建，identity 按 `runId + agentId + taskId/entry` 归并，群聊中 orchestrator 与被委派主智能体的发言应渲染为不同消息气泡。子智能体不是群聊发言人，其 `message.*` 事件暂只进入 event log，后续投影为任务/工具 UI 卡片。`run.failed` / `run.cancelled` 转为可读错误或取消状态；工具、任务、权限和 reasoning 事件暂只记录或忽略，后续阶段投影到 UI。

## Activity 生命周期约束

- 一级模块在首次访问后使用 React `Activity` 保持挂载；产物工作台的标签页内容也可以使用内部 `Activity` 保持 UI 状态。
- `Activity` 进入 `hidden` 时会保留组件状态与 DOM，但会清理隐藏子树中的 Effects；恢复为 `visible` 时 Effects 会重新建立。
- `Activity` 只负责 UI 状态保活，例如输入草稿、已选会话、列表筛选、打开的产物标签页和面板布局状态。不要依赖隐藏模块中的 effect 持续执行后台工作。
- Run SSE 连接由 workbench runtime connection manager 管理，EventSource 实例不得保存在 React 组件局部 state 中。聊天组件只订阅 Zustand 中的可渲染状态。
- 切换 conversation 时，Web 关闭切出会话的 EventSource，但绝不调用 cancel；Agent Runtime 中的 Run 继续执行。切回该 conversation 时，如果 Zustand 中保存了非终态 `activeRuntimeRunId`，Web 重新打开 `/api/runtime/runs/:runId/events`，依赖 Runtime replay 和本地 event id 去重恢复流式显示。如果 Run 在切走期间完成，切回后 replay 到 terminal event 并自然关闭连接。
- React 行为参考官方文档：[Activity](https://react.dev/reference/react/Activity)。

## 开发命令

```bash
cd web && bun dev
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```
