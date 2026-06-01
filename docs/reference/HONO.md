# Hono 使用约定

本文档记录 `hub-server` 与 `agent-runtime` 共同使用 Hono 时应遵守的项目约定。

**重要：涉及 Hono.js 框架的任何操作（路由、中间件、Context、流式输出、测试等），必须优先参考 Hono 官方 LLM 文档：**

- **精简版（推荐，适合 LLM 读取）**：`https://hono.dev/llms-small.txt`
- **完整版**：`https://hono.dev/llms.txt`

资料来源为 Hono 官方 LLM 文档入口及其指向的精简文档。

## 定位

Hono 是基于 Web 标准 API 的轻量 Web 框架，适合运行在 Bun、Node.js、Cloudflare Workers、Deno 等多种运行时中。

在 AgentHub 中：

- `hub-server` 使用 Hono 承载平台控制面 API。
- `agent-runtime` 使用 Hono 承载执行面 Runtime API。
- 两者可以复用相同的路由、上下文、中间件、错误处理和测试风格，但不能混淆业务职责。

## 基础结构

Hono 应用应保持入口清晰：

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

export default app
```

项目代码应优先按领域拆分路由，再由入口文件挂载：

```ts
app.route('/api/conversations', conversationRoutes)
app.route('/api/runs', runRoutes)
```

## 路由约定

- 使用清晰、稳定的 REST 风格路径。
- 健康检查统一保留 `/health`。
- `hub-server` 的浏览器侧 API 建议统一放在 `/api/*` 下。
- `agent-runtime` 的内部执行 API 建议统一放在 `/runtime/*` 下。
- Agent Runtime 跨进程接口新增或变更时，必须同步更新 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`。

## Context 使用约定

Hono 的 `Context` 用于读取请求、返回响应和访问上下文变量。

- 请求体解析应集中在路由边界完成。
- 鉴权结果、请求 ID、运行时配置等横切信息可以通过 `c.set()` / `c.get()` 在中间件和 handler 间传递。
- 不要在 `Context` 中塞入大型业务对象或长生命周期状态。
- 需要持久化的业务状态应交给对应服务层或存储层。

## 中间件约定

通用能力应优先以中间件实现：

- 请求日志。
- 请求 ID。
- CORS。
- 鉴权。
- 错误处理。
- 超时控制。
- Runtime 内部调用鉴权。

中间件应保持职责单一。涉及业务状态写入的逻辑不应隐藏在通用中间件中。

## 响应与错误

- 默认使用 `c.json()` 返回结构化 JSON。
- 错误响应应包含稳定的 `code` 和可读的 `message`。
- 不要把底层 Provider、CLI 或系统错误原样暴露给前端。
- `agent-runtime` 的错误应转换为 Runtime 事件或结构化错误，由 `hub-server` 再映射成业务状态。

示例：

```ts
return c.json(
  {
    error: {
      code: 'RUN_NOT_FOUND',
      message: 'Run 不存在',
    },
  },
  404,
)
```

## 流式输出

AgentHub 的 Agent 执行天然需要流式事件：

- `agent-runtime` 负责产生 Run 事件流。
- `hub-server` 负责消费、持久化，并转发给前端。
- Runtime 流式事件名称、载荷和终止状态必须记录在 `docs/contracts/AGENT_RUNTIME_API_CONTRACTS.md`。

实现时应优先使用 Hono 生态提供的 Web 标准流能力或 SSE 辅助工具，并保证取消、失败、超时和完成都有明确终止事件。

## 测试约定

Hono 应用可以直接对 `app.request()` 发起请求进行轻量测试。

```ts
const res = await app.request('/health')
```

后续为 `hub-server` 和 `agent-runtime` 增加测试时，应优先编写这种轻量 API smoke test，避免默认使用构建类命令做验证。

## 运行时约定

- 当前项目优先使用 Bun 运行 Hono 服务。
- `hub-server` 开发命令：`cd hub-server && bun dev`。
- `agent-runtime` 脚手架完成后应提供：`cd agent-runtime && bun dev`。
- 新增运行命令时，需要同步更新对应架构文档和根目录 README。
