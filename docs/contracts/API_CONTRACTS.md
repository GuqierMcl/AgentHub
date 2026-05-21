# API 契约

本文档记录 `web`、`hub-server` 与 `agent-runtime` 之间的跨进程契约。

## 进程流向

```text
web -> hub-server -> agent-runtime
```

## 契约规则

- 浏览器侧 API 由 `hub-server` 提供。
- Runtime 执行 API 由 `agent-runtime` 提供。
- `hub-server` 的前端 API 建议使用 `/api/*` 前缀。
- `agent-runtime` 的内部执行 API 建议使用 `/runtime/*` 前缀。
- 两个 Hono 服务都应保留 `/health` 健康检查端点。
- 契约载荷应使用明确的 TypeScript 类型。
- 流式事件名称、事件载荷与终止状态必须在实现前或实现时同步记录。
- 错误应尽量使用稳定错误码。
- `agent-runtime` 只输出结构化事件，不直接写业务数据库。
- `hub-server` 负责消费 Runtime 事件，并持久化为消息、Artifact、Diff、部署记录和 Run 状态。
- Hono 相关通用约定见 `docs/reference/HONO.md`。

## 初始契约范围

- 会话。
- 消息。
- Agent 注册表。
- Runtime 调用。
- Runtime 流式事件。
- Artifact 元数据。
- 权限请求与审批。

具体端点、事件名称和载荷结构应随着 API 实现逐步补充。
