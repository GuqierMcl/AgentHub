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

## 当前静态 Workbench

- 当前 Web 静态原型入口位于 `web/src/features/workbench/`，`App.tsx` 仅作为应用根组件和全局 Provider 容器。
- Workbench 暂不接入后端、LLM Provider 或 Agent Runtime，只使用 mock 数据展示 IM 壳、会话列表、消息流、输入区和内联 Artifact。
- Workbench 使用视口内滚动布局：页面根容器填满视口，不产生 `body` 级滚动；会话列表和消息流各自在内部滚动。
- Workbench 左侧栏从上到下为品牌区、顶部功能入口、可折叠消息记录区和底部当前用户信息栏。折叠态只保留品牌标识、功能图标与用户入口，不显示会话记录文本。

## 开发命令

```bash
cd web && bun dev
cd web && bun run lint
cd web && bunx tsc --noEmit -p tsconfig.app.json
```
