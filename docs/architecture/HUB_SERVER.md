# Hub Server 架构

`hub-server/` 目录包含基于 Node/Bun + Hono 的平台后端，也可以称为 API Server。

## 定位

Hub Server 是 AgentHub 的控制面，负责业务状态管理和前端 API。它不直接承担具体 Agent 执行过程，而是将执行请求交给 `agent-runtime`。

## 职责

- 向 `web` 提供平台 API。
- 管理用户鉴权。
- 管理会话、消息、Agent 配置和 Artifact 元数据。
- 管理 Artifact 版本。
- 持久化 Run 状态。
- 持久化 Runtime 事件。
- 向前端转发 SSE 或其他实时事件。
- 在生产环境托管 Web 静态资源。
- 将 AI 执行请求转发给 `agent-runtime`。
- 将 Runtime 事件转化为消息、Artifact、Diff、部署记录和 Run 状态等业务数据。

## Sidecar 管理

HubServer 负责管理 Agent Runtime 侧车进程的完整生命周期。这是 HubServer 的核心职责之一。

### 启动

- HubServer 启动时，通过 `Bun.spawn` 或等价方式拉起 Agent Runtime 子进程。
- 传入参数：`--port`、`--hub-callback`、`--workdir`、`--log-level` 等。
- 启动后轮询 Agent Runtime 的 `/health` 端点，等待就绪信号。
- 超时（默认 10 秒）未就绪则标记启动失败，上报错误。

### 监控

- HubServer 监听 Agent Runtime 子进程的 `exit` 事件。
- 若 Agent Runtime 异常退出，HubServer 应自动重启（指数退避策略）。
- 连续重启失败 3 次后，停止重试，标记为不可用。

### 优雅关闭

- HubServer 收到 SIGTERM/SIGINT 时，先向 Agent Runtime 发送 SIGTERM。
- 等待 Agent Runtime 完成当前任务并退出（默认 5 秒超时）。
- 超时后发送 SIGKILL 强制终止。

### 开发环境

- 开发环境下，Agent Runtime 可手动独立启动（`cd agent-runtime && bun dev`）。
- HubServer 应支持通过环境变量或配置跳过自动拉起 Sidecar 的逻辑，允许连接到已独立运行的 Agent Runtime。

## 规则

- `web` 必须把 `hub-server` 视为唯一后端入口。
- `hub-server` 不拥有 Provider 级 LLM 逻辑。
- 具体执行、适配器调用、工具调用、Workspace 和沙箱能力属于 `agent-runtime`。
- `hub-server` 负责 Agent Runtime 侧车进程的启动、监控、重启和关闭。
- API 变化必须同步更新 `docs/contracts/API_CONTRACTS.md`。
- Hono 路由、Context、中间件、错误响应、流式输出和测试约定应遵循 `docs/reference/HONO.md`。

## Hono 使用约定

- 浏览器侧 API 统一由 `hub-server` 暴露，建议使用 `/api/*` 作为 API 路径前缀。
- 保留 `/health` 作为健康检查端点。
- 将会话、消息、Agent 配置、Artifact、Run 等领域路由拆分到独立模块，再由入口文件统一挂载。
- 请求鉴权、请求 ID、日志、CORS、错误处理等横切能力优先通过 Hono 中间件实现。
- 默认使用结构化 JSON 响应；错误响应应包含稳定 `code` 与可读 `message`。
- SSE 或其他实时转发能力由 `hub-server` 面向前端提供，但事件来源应来自 `agent-runtime`。
- 新增或修改 API 时，同步更新 `docs/contracts/API_CONTRACTS.md`。

## 开发命令

```bash
cd hub-server && bun dev
```
