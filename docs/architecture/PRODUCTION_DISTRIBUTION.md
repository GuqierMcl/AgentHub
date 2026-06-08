# Production Distribution

本文档记录 AgentHub 生产构建、发行包布局、CLI/Desktop 入口、HubServer Web 托管、Agent Runtime Sidecar 和数据库迁移的约束。后续实现 CLI、Desktop 生产启动或构建链路时，以本文档为优先参考。CLI 入口细节见 `docs/architecture/AGENTHUB_CLI.md`；Bun 打包细节见 `docs/architecture/BUN_RUNTIME_PACKAGING.md`；GitHub Release 流水线见 `docs/architecture/GITHUB_RELEASE_WORKFLOW.md`；相关架构决策见 `docs/adr/ADR-002-production-distribution.md`。

## 目标

- 用户只需要启动一个入口，即可运行 AgentHub 的 Web、HubServer 和 Agent Runtime。
- CLI 与 Desktop 入口共享同一套 HubServer 生产行为。
- HubServer 是浏览器和桌面 WebView 的唯一后端入口。
- Agent Runtime 在生产环境中作为 HubServer 的 Sidecar 子进程运行。
- Web 生产资源由 HubServer 托管，浏览器端继续使用相对路径 `/api/*` 和 `/api/events`。
- 生产发行包内置 Bun runtime；HubServer 和 Agent Runtime 使用 Bun bundle 运行，native/dynamic 依赖保留真实 `node_modules` 目录。

## 非目标

- 首版不追求 HubServer 或 Agent Runtime 单 exe。
- 首版不把 Web assets 嵌入 HubServer bundle 或 exe。
- 首版不实现 Desktop `views://` 或本地 `file://` Web。
- CLI 不承担业务 API、数据库、AI 执行或 Runtime 适配器逻辑。
- Desktop 不通过桥接层暴露文件、Shell、网络、Runtime 或 LLM 能力给前端。

## 发行目录

生产打包产物采用资源根目录布局：

```text
dist/
  bun(.exe)
  agenthub-cli(.exe | .js | platform launcher)
  hub-server/
    index.js
    pty-session-host.cjs
    node_modules/
      ...
  agent-runtime/
    index.js
    node_modules/
      ...
  public/
    index.html
    assets/
    ...
```

规则：

- Windows 的 Bun runtime 使用 `bun.exe`；macOS/Linux 使用 `bun`。
- `public/` 来自 `web/dist/`。
- `hub-server/index.js` 和 `agent-runtime/index.js` 是 `bun build --target bun` 生成的生产 bundle。
- `hub-server/pty-session-host.cjs` 是 HubServer terminal PTY helper，必须与 `hub-server/index.js` 同目录分发。
- HubServer terminal PTY helper 的运行时解析顺序为 `AGENTHUB_NODE_BIN`、系统 `node`、当前 `process.execPath`。生产包不额外携带 Node 时，应回落到内置 Bun runtime。
- native/dynamic 依赖必须保留在 service-local 真实 `node_modules/` 中，不能依赖 Bun `--compile` 虚拟文件系统。
- CLI 和 Desktop 都从同一个资源根目录解析 Bun runtime、service bundle 和 `public/`。
- Desktop 安装包可以把同一组资源放入应用资源目录，但运行时仍按等价目录关系解析。

## 为什么不把服务编译成单 exe

HubServer 当前依赖 `@prisma/adapter-libsql`、`@libsql/client`、`sharp` 等 native/dynamic 包；Runtime 也会逐步依赖外部 agent SDK 和平台二进制。此类依赖通常需要真实文件路径、`.node` addon、DLL/so/dylib、动态 `require()` 或 `require.resolve()`。

Bun `--compile` 会把 JS 放入虚拟文件系统；这会让这些依赖的运行时解析变得脆弱。生产 V1 因此采用更稳的布局：

- 可 bundle 的业务代码进入 `index.js`。
- native-heavy 包通过 `--external` 保留在 service-local `node_modules/`。
- 发行包内置 Bun runtime 来执行 bundle。

单 exe 可以作为未来优化项，但不得阻塞 V1 生产发行。

## 分发线

AgentHub 分发分为两条线，但共享同一套生产核心资源：

- CLI 启动包：包含 CLI launcher、Bun runtime、HubServer bundle、Agent Runtime bundle、service-local `node_modules/` 和 `public/`。可通过 GitHub Release 压缩包分发，也可通过 npm 平台包分发。
- Desktop 安装包：包含 Desktop shell、Bun runtime、HubServer bundle、Agent Runtime bundle、service-local `node_modules/` 和 `public/`。Desktop 不通过 CLI 启动 HubServer，安装包可通过 GitHub Release 或官网分发。

规则：

- GitHub Release 应按平台发布产物，并附带 sha256。
- GitHub Release V1 由 `v*` tag 自动触发；tag 必须匹配根目录 `package.json#version`。
- npm 不应把所有平台 runtime/native 包塞进同一个包；若发布 npm CLI，优先使用 meta package + platform package 方案。
- CLI、HubServer、Agent Runtime、Bun runtime、native 依赖和 Web assets 必须同版本发布。
- 版本号以根目录 `package.json#version` 为唯一项目级来源；GitHub Release tag 必须匹配 `v${version}`。
- Desktop 复用 HubServer 的 sidecar/static 生产行为，不复用 CLI 进程。
- AgentHub 自有二进制 launcher（如 Windows `agenthub-cli.exe`）必须使用 AgentHub 图标；发行包内置的 Bun runtime 保持上游文件资源不变。

## 入口模式

### CLI

CLI V1 的详细参数、启动流程和错误处理见 `docs/architecture/AGENTHUB_CLI.md`。本节只保留它在生产发行总览中的入口关系。

CLI 只用于生产启动。开发模式继续手动启动：

```bash
bun run dev:web
bun run dev:server
bun run dev:runtime
```

CLI 启动流程：

1. 解析参数：`--port` / `-p`、`--data-dir` / `-d`、`--log-level` / `-l`、`--no-browser`。
2. 定位资源根目录下的 Bun runtime、`hub-server/index.js`、`agent-runtime/index.js` 和 `public/`。
3. 若未指定 `--port`，预分配一个本机可用端口给 HubServer。
4. 启动 HubServer：

   ```text
   bun hub-server/index.js
     --port <hubPort>
     --hostname 127.0.0.1
     --bun-bin <dist>/bun(.exe)
     --runtime-entry <dist>/agent-runtime/index.js
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

Desktop 入口不通过 CLI 启动 HubServer。Desktop 主进程直接定位应用资源目录并启动 HubServer：

```text
Desktop
  -> spawn bun hub-server/index.js --port <hubPort> --bun-bin <bunBin> --runtime-entry <runtimeEntry> --public-dir <publicDir>
  -> HubServer spawn bun agent-runtime/index.js
  -> BrowserWindow/WebView opens http://127.0.0.1:<hubPort>
```

规则：

- Desktop release 构建通过 Electrobun 将核心资源目录复制到应用 Resources app code 下的 `app/agenthub-runtime/`。
- Desktop release 构建同时复制 `desktop/assets/icon.png` 到 `app/assets/icon.png`，启动加载窗口从该资源显示 AgentHub 产品图标。
- Desktop 主进程在生产模式下先显示轻量加载窗口；HubServer `/health` ready 后再关闭加载窗口并打开主窗口。
- `AGENTHUB_DESKTOP_URL` 可覆盖为开发/调试 URL；此时 Desktop 不启动 HubServer。
- `AGENTHUB_DESKTOP_RESOURCES_DIR` 可在本地 smoke 中指向已组装的资源目录，例如根级 `dist/`。
- Desktop 也让 HubServer 托管 Web，而不是加载 `views://` 或本地 `file://` Web。
- Web 前端继续使用相对 API 路径，不需要 Desktop 专属 API base。
- Desktop 负责 HubServer 进程生命周期、窗口生命周期和退出清理。
- Desktop 不把 CLI 作为中间层，避免多一层监督进程。

### Development

开发模式保持现状：Web、HubServer、Agent Runtime 可分别手动启动。未提供 `--runtime-entry` 或 `--runtime-bin` 时，HubServer 不自动启动 Runtime，而是使用 `--runtime-url` 或默认 Runtime URL。

## HubServer 生产职责

HubServer 是生产运行的主服务进程。它负责：

- 初始化数据目录和数据库。
- 运行生产数据库迁移 runner。
- 启动并管理 Agent Runtime Sidecar。
- 创建 RuntimeClient，并将所有 Runtime 调用转发到当前 Sidecar URL。
- 托管 Web 静态资源。
- 暴露 `/health`、`/api/*`、`/api/events` 和产品 API。
- 在退出时优雅关闭 Runtime Sidecar 和数据库连接。

生产参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `--bun-bin` | string | Bun runtime 路径。与 `--runtime-entry` 一起用于启动 Runtime bundle。 |
| `--runtime-entry` | string | Agent Runtime bundle 入口。提供时启用 Sidecar 自动启动。 |
| `--runtime-bin` | string | Agent Runtime 可执行文件路径；保留为兼容二进制 sidecar 的入口。 |
| `--public-dir` | string | Web dist 目录。提供且未禁用 Web 时启用静态资源托管。 |
| `--no-web` | boolean | 禁用 Web 静态资源托管，保留给未来特殊宿主。CLI/Desktop 首版不使用。 |
| `--runtime-url` | string | 开发或调试时连接已运行 Runtime。提供 sidecar 参数时由启动结果覆盖。 |
| `--data-dir` | string | HubServer 数据目录。 |
| `--log-level` | string | 日志级别。 |

启动顺序：

1. 解析配置并确保数据目录存在。
2. 运行生产数据库迁移 runner，并初始化数据库。生产环境不得运行 `bunx prisma generate` 或 Prisma CLI migrate。
3. 若提供 `--runtime-entry`，使用 `--bun-bin` 启动 Runtime bundle；若提供 `--runtime-bin`，启动 Runtime 可执行文件。
4. 等待 Runtime ready。
5. 基于 Runtime URL 创建 RuntimeClient 和依赖 RuntimeClient 的服务。
6. 注册 Hono app、中间件、API router、静态 Web 托管和 SPA fallback。
7. 调用 `Bun.serve()` 显式启动 HTTP 服务。
8. 监听 SIGINT/SIGTERM，依次关闭 Runtime Sidecar、数据库和 HTTP 服务。

生产 sidecar 模式由 `--runtime-entry` 或 `--runtime-bin` 显式触发；`NODE_ENV=production` 只影响数据库生产保护，不单独触发 Runtime 生命周期管理。

## SidecarManager

`hub-server` 使用 SidecarManager 管理 Agent Runtime：

```text
start(options) -> RuntimeEndpoint
shutdown() -> Promise<void>
```

启动规则：

- 监听地址固定为 `127.0.0.1`，除非后续有明确远程 Runtime 设计。
- HubServer 为 Runtime 预分配端口，并传给 `--port`。
- 优先使用 bundle 形式启动：

  ```text
  bun agent-runtime/index.js
    --port <runtimePort>
    --hostname 127.0.0.1
    --hub-callback http://127.0.0.1:<hubPort>
    --data-dir <runtimeDataDir>
    --workdir <runtimeWorkdir>
    --log-level <level>
  ```

- 兼容二进制形式：

  ```text
  agent-runtime(.exe)
    --port <runtimePort>
    --hostname 127.0.0.1
    ...
  ```

- 预分配端口存在 TOCTOU 风险；若 Runtime 因端口占用启动失败，应重新分配并重试一次。
- HubServer 轮询 `/health`，默认超时 10 秒。
- Runtime `/health` 只有在服务初始化完成后才能返回 `status = "ok"`。

重启规则：

- 正常退出不自动重启。
- 异常退出使用指数退避重启：1s、2s、4s，最大 30s。
- 连续失败 3 次后停止重试，并将 Runtime 标记为不可用。
- RuntimeClient 必须能使用当前 Runtime URL；如果 Sidecar 重启后端口变化，RuntimeClient 需要更新 base URL。

关闭规则：

- HubServer 收到退出信号时，先向 Runtime 发送 SIGTERM。
- 等待最多 5 秒。
- 超时后发送 SIGKILL。

## Web 静态托管

Web 静态托管属于 HubServer 启动装配层，不属于领域 router。

规则：

- API router 必须先注册。
- 静态资源和 SPA fallback 在 API router 之后注册。
- SPA fallback 不得吞掉未知 `/api/*` 请求。未知 API 应返回 404 JSON 错误，而不是 `index.html`。
- `/assets/*`、`/favicon.*`、`/manifest.*` 等静态文件从 `public/` 读取。
- 前端路由路径返回 `public/index.html`。
- 静态托管启用条件：`--no-web = false` 且 `--public-dir` 存在。
- CLI/Desktop 生产启动下缺失 `public/` 必须启动失败。

首版不做 Web assets bundle/exe 嵌入。若未来需要嵌入，应单独评估 Vite hash assets、Monaco worker、PDF/字体/wasm 等资源。

## Agent Runtime 生产约束

Agent Runtime 生产构建为 Bun bundle，但产品入口不是 Runtime 本身。

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

生产发行包不得在运行时依赖 `bunx`、Prisma CLI 或源码生成步骤。

规则：

- Prisma Client 在构建期生成，并被 HubServer bundle 引用。
- `initDatabase()` 在生产环境不得执行 `bunx --bun prisma generate`。
- 生产 bundle 运行时不得依赖 `prisma/schema.prisma` 或 `src/generated/prisma/*` 源码文件做时间戳检查；这些源码文件不随发行包分发。Prisma Client 的新鲜度由 `build:hub` 的构建期 `prisma generate` 和发行包 smoke 验证。
- `build:hub` 在构建期读取 `hub-server/prisma/migrations/*/migration.sql`，生成内置 `src/generated/prisma-migrations.ts` manifest。
- HubServer 生产启动时先运行内置轻量 SQL migration runner，再初始化 Prisma Client。
- 生产数据库模式由 sidecar 参数或 `NODE_ENV=production` 触发；CLI/Desktop 启动包都会传 sidecar 参数。
- 生产 migration runner 只执行构建期 manifest 中的 SQL，不调用 `bunx`、Prisma CLI 或源码生成步骤；如果 `agenthub_schema_migrations` 为空但数据库已存在业务表，则先把当前 manifest 作为基线写入，再继续后续增量迁移。
- migration runner 在 `hub.db` 中维护 `agenthub_schema_migrations` 表，记录 migration 名称、checksum 和应用时间。
- 已应用 migration 的 checksum 与当前应用内置 manifest 不一致时，HubServer 启动失败。
- SQLite 数据文件继续位于 HubServer 数据目录下。
- 启动时不得删除、截断或重建 `hub.db-wal` / `hub.db-shm`。
- Native/WASM 依赖必须在发行包 smoke test 中验证。

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
  "build:runtime": "cd agent-runtime && bun install && bun run build",
  "build:hub": "cd hub-server && bun install && bun run build",
  "build:cli": "cd cli && bun install && bun run build",
  "build:desktop": "bun run build && bun run package && cd desktop && bun install && bun run build:release",
  "build": "bun run build:web && bun run build:runtime && bun run build:hub && bun run build:cli",
  "package": "bun run scripts/package.ts"
}
```

构建规则：

- `build:web` 只负责生成 `web/dist/`。
- `build:hub` 只负责校验 `web/dist/` 存在、生成内置 migration manifest、在构建期生成 Prisma Client、生成 HubServer Bun bundle，并复制 HubServer terminal PTY helper 到 `hub-server/dist/`。
- `build:runtime` 生成 Agent Runtime Bun bundle，并 externalize `pino` / `thread-stream` 等 worker/dynamic-path 依赖，避免 bundle 写入构建机绝对路径。
- `build:cli` 可继续生成轻量 launcher，也可生成 JS CLI bundle；CLI 不应承担 native-heavy 服务依赖。
- `package` 负责组装最终 `dist/`：复制 Bun runtime、service bundles、CLI launcher、`web/dist -> public/`、以及每个服务生产运行需要的 service-local `node_modules/` 依赖闭包。
- `build:desktop` 先复用根级 `build` + `package` 生成核心资源，再运行 Desktop release build；Electrobun 将 `dist/` 复制进应用 Resources app code 的 `app/agenthub-runtime/`，并复制 loading 图标资源到 `app/assets/icon.png`。
- Windows Desktop release 在 Electrobun `postWrap` / `postPackage` hook 中使用仓库内 `rcedit` patch AgentHub launcher 和 installer 图标；若 installer zip 已生成，需要重建 zip，确保上传到 GitHub Release 的 zip 内也是 patch 后 installer。
- 生产运行所需 native-heavy 包必须通过 bundle `--external` 保留真实目录结构。V1 可以先复制服务级生产 `node_modules/`，后续再按 smoke 结果裁剪。
- Package V1 组装 CLI 启动包的资源目录；Desktop installer 在自己的 build 阶段复用这组资源。

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
- native/dynamic 依赖可加载：Prisma/libsql、sharp、HubServer terminal PTY helper/node-pty、Agent Runtime pino/thread-stream worker、外部 agent SDK bundled binaries。

Desktop smoke：

- Desktop 启动后先显示加载窗口，而不是立即打开主窗口。
- Desktop 启动 Bun runtime + HubServer bundle。
- WebView 打开 `http://127.0.0.1:<hubPort>`。
- 关闭窗口后 HubServer 和 Runtime 被清理。

## 后续扩展

- CLI 可从 compiled launcher 演进为 JS launcher + 平台脚本，前提是 npm/GitHub Release 启动体验保持稳定。
- HubServer Web assets 可在未来改为内嵌资源，但应单独验证 Vite 资源、worker、wasm、字体和缓存策略。
- Runtime 内部 token 可升级为 mTLS、命名管道、Unix socket 或更强本机进程认证。
- Sidecar 可支持远程 Runtime，但这会改变安全、权限、文件系统和 workspace 模型，必须另写 ADR。
