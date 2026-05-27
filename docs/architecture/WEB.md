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
- 聊天模块当前仍使用 mock 数据展示 IM 壳、消息流、输入区和内联 Artifact；智能体模块已经通过 HubServer 代理的 `/api/runtime/agents` 端点管理真实智能体配置。
- 页面根容器填满视口，不产生 `body` 级滚动；模块内的列表、消息流、详情表单与产物内容各自在内部滚动。
- 当同一 Web 应用运行在 Electrobun 桌面壳内时，`AppShell` 可以通过 Electrobun 注入的 `window.__electrobunWindowId` 与 `window.__electrobunWebviewId` 检测桌面运行时，并渲染自定义 `DesktopTitleBar`。普通浏览器不显示该标题栏，保持原 Web 布局。
- 桌面运行时由 `DesktopTitleBar` 承担 AgentHub 品牌展示；`AppNavigation` 不重复显示 Logo 与 `AgentHub` 标题。Windows 桌面壳应保留不透明、可调整大小的原生窗口，让窗口边缘缩放和圆角裁剪由系统处理；不要为 Web 外壳圆角启用透明宿主窗口，否则 resize 后的透明区域可能产生点击透传。普通浏览器不应用桌面外壳样式。
- 桌面标题栏拖拽区域必须同时使用 Electrobun 识别的 `.electrobun-webkit-app-region-drag` / `.electrobun-webkit-app-region-no-drag` 类；按钮和其他交互区域必须标记为 no-drag。
- 桌面标题栏只允许通过 Electrobun 最小 RPC 调用窗口控制能力（最小化、最大化/还原、关闭、查询窗口状态）。前端仍只能调用 `hub-server` 业务 API，不得通过桌面桥接访问文件、Shell、网络、Runtime 或 LLM 能力。
- Windows 桌面壳必须在加载 Electrobun 窗口 API 之前设置 per-monitor DPI awareness，避免系统在 125%/150% 等缩放屏幕上对整个窗口做位图拉伸，导致 Web 内容模糊。该行为属于 `desktop` 壳层职责，Web CSS 不应为此做额外缩放补偿。
- 创建智能体、绑定模型和删除确认维持模态操作；已有用户智能体配置在智能体模块右侧内容区内联编辑。

## Activity 生命周期约束

- 一级模块在首次访问后使用 React `Activity` 保持挂载；产物工作台的标签页内容也可以使用内部 `Activity` 保持 UI 状态。
- `Activity` 进入 `hidden` 时会保留组件状态与 DOM，但会清理隐藏子树中的 Effects；恢复为 `visible` 时 Effects 会重新建立。
- `Activity` 只负责 UI 状态保活，例如输入草稿、已选会话、列表筛选、打开的产物标签页和面板布局状态。不要依赖隐藏模块中的 effect 持续执行后台工作。
- 后续接入流式聊天、Run SSE 事件、后台任务进度或其他持续连接时，连接生命周期与运行状态必须放到页面级 `Activity` 边界之外的应用级 store、provider 或 service 中。聊天模块只订阅并渲染这些状态。
- React 行为参考官方文档：[Activity](https://react.dev/reference/react/Activity)。

## 开发命令

```bash
cd web && bun dev
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```
