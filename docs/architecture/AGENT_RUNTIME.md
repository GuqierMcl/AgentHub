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

架构决策详见 `docs/adr/ADR-001-sidecar-architecture.md`。

### 2.2 启动与参数传递

HubServer 在启动时通过 `Bun.spawn` 或等价方式启动 Agent Runtime 子进程。

启动参数规范：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `--port` | number | 否 | Agent Runtime 监听端口，默认 `3001` |
| `--host` | string | 否 | 监听地址，默认 `127.0.0.1` |
| `--hub-callback` | string | 否 | HubServer 回调地址，用于 Runtime 反向通知 |
| `--workdir` | string | 否 | 工作目录根路径，默认使用系统临时目录 |
| `--log-level` | string | 否 | 日志级别：`debug` / `info` / `warn` / `error`，默认 `info` |

配置优先级：命令行参数 > 环境变量 > 默认值。

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
3. Agent Runtime 返回 `200 OK` 且响应体包含 `"status": "ok"` 时，视为就绪。
4. 超时（默认 10 秒）未就绪则标记启动失败，HubServer 应上报错误并决定是否重试。

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
- 汇总各个 Agent 的输出。
- 在必要时处理失败降级。

课题要求 Orchestrator 在群聊模式下自动理解用户意图，将复杂任务拆解并分派给合适的子 Agent；子 Agent 完成后，再由 Orchestrator 聚合产出并汇报结果。

MVP 阶段，Orchestrator 不需要做复杂 DAG 调度，可以先采用“计划生成 + 顺序执行 + 汇总结果”的模式。后续再扩展并行调度、失败恢复和冲突处理。

### 3.3 Agent Adapter 统一接入

Agent Runtime 需要通过统一 Adapter 层接入不同类型的 Agent。这是 Agent Runtime 的核心设计之一。

不同 Agent 的运行方式可能完全不同：

| Agent 类型 | 运行方式 |
| --- | --- |
| 普通 LLM Agent | 通过模型 API 调用 |
| 自建 Agent | 使用用户配置的 System Prompt 和工具集运行 |
| Claude Code | 可能通过 CLI 或 SDK 接入 |
| Codex | 可能通过 CLI 或相关工具接入 |
| OpenCode | 可能通过 CLI、服务或本地进程接入 |
| Mock Agent | 用于 Demo 和测试 |

如果没有统一 Adapter 层，API Server 和 Runtime 内部都会被不同 Agent 的调用方式污染。

因此，Agent Runtime 应将不同 Agent 的差异封装到 Adapter 内部，对上层只暴露统一的执行语义：

- 启动 Agent。
- 传入上下文。
- 接收流式输出。
- 接收工具调用。
- 接收产物结果。
- 接收错误信息。
- 返回统一事件。

课题要求通过统一适配器层屏蔽 Claude Code、Codex、OpenCode 等主流 Agent 平台差异，并支持用户自建 Agent，因此 Adapter 是 Agent Runtime 的关键架构点。

### 3.4 上下文组装

Agent Runtime 不直接管理完整业务数据库，但在执行前需要由 API Server 提供必要上下文。

Runtime 需要将这些上下文整理成 Agent 可理解的输入。

典型上下文包括：

- 当前用户消息。
- 会话历史。
- 被 pin 的关键消息。
- 当前会话中的 Agent 列表。
- Agent 的能力标签。
- Agent 的 System Prompt。
- 历史 Artifact。
- 当前正在编辑的产物。
- 用户选中的代码片段。
- 任务目标。
- 约束条件。

课题要求每个对话保持完整聊天历史，Agent 能基于历史消息理解上下文，并支持手动 pin 关键消息作为长期上下文。

因此，Agent Runtime 不只是简单把用户输入转发给模型，而是要承担“执行上下文编排”的职责。

### 3.5 产物生成与执行环境管理

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

### 3.6 事件流输出

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
- Agent Adapter 调用。
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

- Runtime API 面向 `hub-server`，不直接面向 `web`。
- 内部执行 API 建议使用 `/runtime/*` 作为路径前缀。
- 保留 `/health` 作为健康检查端点。
- Run 创建、取消、状态查询、事件流订阅等路由应按领域拆分。
- Runtime 内部调用必须具备服务间鉴权或等价的内部访问控制设计。
- 执行错误应转换为结构化 Runtime 错误或 Runtime 事件，不应泄露底层 Provider、CLI 或系统细节。
- Run 事件流应保证开始、执行中、失败、超时、取消、完成等状态都有明确事件。
- 流式事件契约必须同步维护在 `docs/contracts/API_CONTRACTS.md`。
- 后续测试应优先使用 Hono `app.request()` 风格的轻量 API smoke test。
