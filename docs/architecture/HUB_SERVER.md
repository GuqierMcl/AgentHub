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

## 规则

- `web` 必须把 `hub-server` 视为唯一后端入口。
- `hub-server` 不拥有 Provider 级 LLM 逻辑。
- 具体执行、适配器调用、工具调用、Workspace 和沙箱能力属于 `agent-runtime`。
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
