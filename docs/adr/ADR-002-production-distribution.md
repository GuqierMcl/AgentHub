# ADR-002: 生产分发采用 HubServer 托管 Web 的扁平发行包

## 状态

已采纳

## 上下文

AgentHub 需要落地生产构建和入口模式：

- Agent Runtime 使用 Bun 打包为独立二进制，并作为 HubServer 的 Sidecar 子进程运行。
- HubServer 使用 Bun 打包为独立二进制，并在生产环境托管构建好的 Web dist。
- CLI 未来位于 `cli/`，用于生产启动 HubServer、Web 和 Runtime。
- Desktop 使用 Electrobun 壳层，需要自动启动 HubServer，并展示同一套 Web 应用。

此前讨论过两种 Desktop Web 加载方式：

1. Desktop 也让 HubServer 托管 Web，并打开 `http://127.0.0.1:<port>`。
2. Desktop 通过 `views://` 或本地文件加载 Web，仅让 HubServer 提供 API。

第二种方式可以减少一个 Web 服务暴露面，但会要求前端引入 Desktop 专属 API base、SSE 路径处理、CORS/Origin 策略和可能的认证注入，首版复杂度较高。

## 决策

首版生产分发采用扁平发行包：

```text
dist/
  agenthub-cli(.exe)
  hub-server(.exe)
  agent-runtime(.exe)
  public/
```

CLI 和 Desktop 都启动 HubServer；HubServer 托管 `public/` 中的 Web dist，并自动拉起 Agent Runtime Sidecar。

Desktop 首版也打开 HubServer 托管的本地 Web URL：

```text
http://127.0.0.1:<hub-port>
```

因此 Web 继续使用相对路径 `/api/*` 和 `/api/events`，不引入 Desktop 专属 API base。

完整执行约束见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

## 影响

### 正面影响

- CLI 与 Desktop 共享同一套 HubServer 生产行为。
- 前端 API 路径保持同源相对路径，减少 Desktop 首版改造面。
- HubServer 继续是浏览器和 WebView 的唯一后端入口，符合 `web -> hub-server -> agent-runtime` 边界。
- 扁平发行包便于 CLI、Desktop 和脚本定位二进制与 `public/`。
- 首版不需要处理 Vite assets 单 exe 嵌入、custom protocol、EventSource 跨源认证等复杂点。

### 代价

- Desktop 首版会在本机回环地址启动 Web 服务。
- Web assets 作为 `public/` 目录随包分发，而不是内嵌到 HubServer 单 exe。
- 如果未来要改为 Desktop custom protocol，需要同步调整 Web API base、SSE 和安全策略。

## 后续工作

- 实现 HubServer SidecarManager。
- 实现 HubServer 生产 Web 静态托管和 SPA fallback。
- 实现 CLI 生产 supervisor。
- 调整 Desktop 主进程，启动 HubServer 后打开本地 URL。
- 建立构建和打包脚本，生成扁平发行包。
- 明确生产 Prisma Client 和迁移策略，避免运行时依赖 `bunx` 或 Prisma CLI。
