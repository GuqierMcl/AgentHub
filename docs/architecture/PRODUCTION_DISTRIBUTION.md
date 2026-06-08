# Production Distribution

本文档记录 AgentHub 生产构建、发行包布局、CLI/Desktop 入口、HubServer Web 托管和 Agent Runtime Sidecar 的约束。后续实现 CLI、Desktop 生产启动或构建链路时，以本文档为优先参考。CLI 生产入口细节见 `docs/architecture/AGENTHUB_CLI.md`；相关架构决策见 `docs/adr/ADR-002-production-distribution.md`；Bun `--compile` 与命令行参数解析细节见 `docs/architecture/BUN_RUNTIME_PACKAGING.md`。

## 目标

- 用户只需要启动一个入口，即可运行 AgentHub 的 Web、HubServer 和 Agent Runtime。
- CLI 与 Desktop 入口共享同一套 HubServer 生产行为。
- HubServer 是浏览器和桌面 WebView 的唯一后端入口。
- Agent Runtime 在生产环境中只作为 HubServer 的 Sidecar 子进程运行。
- Web 生产资源由 HubServer 托管，保持浏览器端 `/api/*`、`/api/events` 等相对路径不变。
- 首版采用扁平发行目录和外置 `public/` 资源目录，不要求把 Web dist 嵌入 HubServer 单 exe。

## 非目标

- 首版不实现 Desktop `views://` 或本地文件加载 Web。
- 首版不要求 HubServer 单可执行文件内嵌全部 Web assets。
- CLI 不承担业务 API、数据库、AI 执行或 Runtime 适配器逻辑。
- Desktop 不通过桥接层暴露文件、Shell、网络、Runtime 或 LLM 能力给前端。

## 发行目录

生产打包产物采用扁平目录：

```text
dist/
  agenthub-cli(.exe)
  hub-server(.exe)
  agent-runtime(.exe)
  public/
    index.html
    assets/
    ...
```

规则：

- Windows 可执行文件使用 `.exe` 后缀；macOS/Linux 不加 `.exe`。
- `public/` 来自 `web/dist/`。
- `agenthub-cli`、`hub-server`、`agent-runtime` 与 `public/` 在同一级目录，便于入口进程通过 `dirname(process.execPath)` 定位资源。
- 未来 Desktop 安装包可以把同一组二进制和 `public/` 放入应用资源目录，但运行时仍按等价目录关系解析。

## 入口模式

### CLI

CLI V1 的详细参数、启动流程和错误处理见 `docs/architecture/AGENTHUB_CLI.md`。本节只保留它在生产发行总览中的入口关系。

CLI 二进制名：

- Windows: `agenthub-cli.exe`
- macOS/Linux: `agenthub-cli`

CLI 只用于生产启动。开发模式继续手动启动：

```bash
bun run dev:web
bun run dev:server
bun run dev:runtime
```

CLI 启动流程：

1. 解析参数：`--port` / `-p`、`--data-dir` / `-d`、`--log-level` / `-l`、`--no-browser`。
2. 定位同目录下的 `hub-server(.exe)`、`agent-runtime(.exe)` 和 `public/`。
3. 若未指定 `--port`，预分配一个本机可用端口给 HubServer。
4. 启动 HubServer：

   ```text
   hub-server(.exe)
     --port <hubPort>
     --hostname 127.0.0.1
     --runtime-bin <dist>/agent-runtime(.exe)
     --public-dir <dist>/public
     [--data-dir <dir>]
     [--log-level <level>]
   ```

5. 轮询 `GET http://127.0.0.1:<hubPort>/health` 等待 HubServer 就绪。
6. 输出 `AgentHub running at http://127.0.0.1:<hubPort>`。
7. 除非传入 `--no-browser`，打开系统浏览器。
8. CLI 收到 SIGINT/SIGTERM 时，转发给 HubServer 并等待退出。

CLI 不直接启动 Agent Runtime；Agent Runtime 始终由 HubServer 管理。

### Desktop

Desktop 入口不通过 CLI 启动 HubServer。Desktop 主进程直接启动 `hub-server(.exe)`，再打开 WebView：

```text
Desktop
  -> spawn hub-server(.exe) --port <hubPort> --runtime-bin <runtimeBin> --public-dir <publicDir>
  -> HubServer spawn agent-runtime(.exe)
  -> BrowserWindow/WebView opens http://127.0.0.1:<hubPort>
```

规则：

- Desktop 也让 HubServer 托管 Web，而不是加载 `views://` 或本地 `file://` Web。
- Web 前端继续使用相对 API 路径，不需要 Desktop 专属 API base。
- Desktop 负责 HubServer 进程生命周期、窗口生命周期和退出清理。
- Desktop 不把 CLI 作为中间层，避免多一层监督进程。

### Development

开发模式保持现状：Web、HubServer、Agent Runtime 可分别手动启动。未提供 `--runtime-bin` 时，HubServer 不自动启动 Runtime，而是使用 `--runtime-url` 或默认 Runtime URL。

## HubServer 生产职责

HubServer 是生产运行的主服务进程。它负责：

- 初始化数据目录和数据库。
- 启动并管理 Agent Runtime Sidecar。
- 创建 RuntimeClient，并将所有 Runtime 调用转发到当前 Sidecar URL。
- 托管 Web 静态资源。
- 暴露 `/health`、`/api/*`、`/api/events` 和产品 API。
- 在退出时优雅关闭 Runtime Sidecar 和数据库连接。

新增生产参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `--runtime-bin` | string | Agent Runtime 二进制路径。提供时启用 Sidecar 自动启动。 |
| `--public-dir` | string | Web dist 目录。提供且未禁用 Web 时启用静态资源托管。 |
| `--no-web` | boolean | 禁用 Web 静态资源托管，保留给未来特殊宿主。CLI/Desktop 首版不使用。 |
| `--runtime-url` | string | 开发或调试时连接已运行 Runtime。提供 `--runtime-bin` 时由 Sidecar 启动结果覆盖。 |
| `--data-dir` | string | HubServer 数据目录。 |
| `--log-level` | string | 日志级别。 |

启动顺序：

1. 解析配置并确保数据目录存在。
2. 初始化数据库。生产环境不得运行 `bunx prisma generate`。
3. 若提供 `--runtime-bin`，启动 Sidecar 并等待 Runtime ready。
4. 基于 Runtime URL 创建 RuntimeClient 和依赖 RuntimeClient 的服务。
5. 注册 Hono app、中间件、API router、静态 Web 托管和 SPA fallback。
6. 调用 `Bun.serve()` 显式启动 HTTP 服务。
7. 监听 SIGINT/SIGTERM，依次关闭 Runtime Sidecar、数据库和 HTTP 服务。

HubServer 入口必须显式调用 `Bun.serve()`，不能继续只依赖 module default export。原因是生产启动必须等待数据库与 Runtime ready 后才接收 API 请求，并且需要读取实际监听端口。

## SidecarManager

`hub-server` 应新增 SidecarManager，用于管理 Agent Runtime：

```text
start(runtimeBin, options) -> RuntimeEndpoint
shutdown() -> Promise<void>
```

启动规则：

- 监听地址固定为 `127.0.0.1`，除非后续有明确远程 Runtime 设计。
- HubServer 为 Runtime 预分配端口，并传给 `--port`。
- 预分配端口存在 TOCTOU 风险；若 Runtime 因端口占用启动失败，应重新分配并重试一次。
- Runtime 启动参数至少包括：

  ```text
  --port <runtimePort>
  --hostname 127.0.0.1
  --hub-callback http://127.0.0.1:<hubPort>
  --data-dir <runtimeDataDir>
  --workdir <runtimeWorkdir>
  --log-level <level>
  ```

- HubServer 轮询 `/health`，默认超时 10 秒。
- Runtime `/health` 只有在服务初始化完成后才能返回 `status = "ok"`。

重启规则：

- 正常退出不自动重启。
- 异常退出使用指数退避重启：1s、2s、4s，最大 30s。
- 连续失败 3 次后停止重启，并将 Runtime 标记为不可用。
- RuntimeClient 必须能使用重启后的 Runtime URL。优先保持同一端口；若端口变化，应更新 RuntimeClient base URL。

关闭规则：

- HubServer 收到退出信号时，先向 Runtime 发送 SIGTERM。
- 等待最多 5 秒。
- 超时后发送 SIGKILL。

## Web 静态托管

Web 静态托管属于 HubServer 启动装配层，不属于领域 router。实现时应在 `hub-server/src/index.ts` 或等价 bootstrap 模块中注册。

规则：

- API router 必须先注册。
- 静态资源和 SPA fallback 在 API router 之后注册。
- SPA fallback 不得吞掉未知 `/api/*` 请求。未知 API 应返回 404 JSON 错误，而不是 `index.html`。
- `/assets/*`、`/favicon.*`、`/manifest.*` 等静态文件从 `public/` 读取。
- 前端路由路径返回 `public/index.html`。
- 静态托管启用条件：`--no-web = false` 且 `--public-dir` 存在。
- 如果 `--public-dir` 不存在，HubServer 应记录清晰错误或警告；生产 CLI/Desktop 应把缺失 public 视为启动失败。

首版不做 Web assets 单 exe 嵌入。若未来需要嵌入，应单独评估 Vite hash assets、Monaco worker、PDF/字体/wasm 等资源。

## Agent Runtime 生产约束

Agent Runtime 生产构建为独立二进制，但产品入口不是 Runtime 本身。

规则：

- 生产环境由 HubServer 自动启动 Runtime。
- 开发环境仍允许 Runtime 独立启动，便于调试和热重载。
- Runtime 支持 `--hub-callback` 和 `--log-level`。
- Runtime 监听地址参数以 `--hostname` 为准；如保留 `--host`，只能作为兼容别名。
- Runtime `/health` 应区分 `starting` 和 `ok`。只有 ProviderService、AgentRegistry 等启动依赖完成后才返回 200 + `status = "ok"`。
- Runtime 不直接面向浏览器，不托管 Web，不写 HubServer 业务数据库。

## 内部调用鉴权

生产环境中 HubServer 与 Agent Runtime 之间应使用每次启动生成的内部 token。

规则：

- HubServer 生成随机 token，通过环境变量传给 Runtime，例如 `AGENTHUB_RUNTIME_TOKEN`。
- HubServer 调 Runtime `/runtime/*` API 时携带 `x-agenthub-runtime-token`。
- Runtime 检测到 token 后必须校验请求头；缺失或错误时返回 401/403。
- `/health` 是否要求 token 可由实现决定，但不得泄露敏感信息。
- 开发环境未设置 token 时可跳过校验。

该机制只保护 HubServer 到 Runtime 的内部 API；浏览器仍不得直接访问 Runtime。

## 数据库与 Prisma

生产二进制不得在运行时依赖 `bunx`、Prisma CLI 或源码生成步骤。

规则：

- Prisma Client 在构建期生成，并被 HubServer 构建产物引用。
- `initDatabase()` 在生产环境不得执行 `bunx --bun prisma generate`。
- 生产迁移策略必须在实现前明确：可以使用轻量迁移 runner 执行随包分发的 SQL migrations，但不得在应用运行时代码中拼接业务 DDL。
- SQLite 数据文件继续位于 HubServer 数据目录下。
- 启动时不得删除、截断或重建 `hub.db-wal` / `hub.db-shm`。
- Native/WASM 依赖（例如 Prisma runtime、SQLite/libsql adapter、`node-pty`、`sharp`）必须在打包 smoke test 中验证。

## 构建链路

根级构建顺序：

```text
build:web
build:runtime
build:hub
build:cli
package
```

建议脚本：

```json
{
  "build:web": "cd web && bun install && bun run build",
  "build:runtime": "cd agent-runtime && bun run build",
  "build:hub": "cd hub-server && bun install && bun run build",
  "build:cli": "cd cli && bun run build",
  "build": "bun run build:web && bun run build:runtime && bun run build:hub && bun run build:cli",
  "package": "bun run scripts/package.ts"
}
```

构建规则：

- `build:web` 只负责生成 `web/dist/`。
- `build:hub` 只负责校验 `web/dist/` 存在、在构建期生成 Prisma Client、编译 `hub-server(.exe)`；不复制 `web/dist/`，也不创建 `hub-server/public/`。
- `package` 直接复制 `web/dist/` 到最终 `dist/public/`。
- `agent-runtime` 使用 `bun build src/index.ts --compile --outfile dist/agent-runtime`。
- `hub-server` 使用 `bun build src/index.ts --compile --outfile dist/hub-server`。
- `cli` 使用 `bun build src/index.ts --compile --outfile dist/agenthub-cli`。
- `--compile` 当前平台构建不使用 `--target bun`。跨平台构建时再显式指定 Bun 支持的平台 target。
- `scripts/package.ts` 根据当前平台处理可执行文件后缀，并复制三个二进制与 `public/` 到根级 `dist/`。

## 验证清单

实现生产分发链路后，至少执行：

```bash
cd hub-server && bunx tsc --noEmit
cd agent-runtime && bun test
cd cli && bunx tsc --noEmit
bun run build
bun run package
```

发行包 smoke：

```bash
cd dist
./agenthub-cli --no-browser
```

检查：

- `GET /health` 返回 HubServer 就绪。
- `/` 返回 Web `index.html`。
- 前端静态资源加载成功。
- `GET /api/system/services/status` 返回 `agent-runtime` 可用状态。
- 浏览器不直接访问 Runtime。
- 退出 CLI 后 HubServer 和 Agent Runtime 子进程都关闭。

Desktop smoke：

- Desktop 启动 HubServer。
- WebView 打开 `http://127.0.0.1:<hubPort>`。
- Web 标题栏仍可通过 Electrobun 最小 RPC 控制窗口。
- 关闭窗口后 HubServer 和 Runtime 被清理。

## 后续扩展

- Desktop 可在未来引入 `--no-web` + custom protocol，但需要同步改 Web API base、SSE 和安全策略。
- HubServer Web assets 可在未来改为单 exe 嵌入，但应单独验证 Vite 资源、worker、wasm、字体和缓存策略。
- Runtime 内部 token 可升级为 mTLS、命名管道、Unix socket 或更强本机进程认证。
- Sidecar 可支持远程 Runtime，但这会改变安全、权限、文件系统和 workspace 模型，必须另写 ADR。
