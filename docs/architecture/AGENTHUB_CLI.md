# AgentHub CLI

本文档记录 AgentHub CLI V1 的设计约束、生产启动职责、参数契约和后续实现边界。生产分发总览见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`，Bun 单文件可执行约束见 `docs/architecture/BUN_RUNTIME_PACKAGING.md`。

## 定位

AgentHub CLI 是生产发行包的命令行入口。用户启动 `agenthub-cli(.exe)` 后，CLI 负责拉起 HubServer，等待 HubServer 就绪，并把 Web 访问地址交给用户或系统浏览器。

CLI 不直接启动 Agent Runtime。Agent Runtime 的生命周期、ready 检查、内部 token 和重启策略都由 HubServer 的 SidecarManager 管理。

## 目标

- 提供一个可执行入口启动生产版 AgentHub。
- 自动定位同目录下的 HubServer、Agent Runtime 和 Web `public/`。
- 在未指定端口时为 HubServer 探测本机可用端口。
- 固定使用 `127.0.0.1` 启动 HubServer，避免默认暴露到局域网。
- 等待 HubServer `/health` 返回 ready 后再输出访问 URL。
- 默认打开系统浏览器；打开失败只警告，不中断服务。
- 接收 SIGINT/SIGTERM 后转发给 HubServer，并等待 HubServer 退出。

## 非目标

- CLI 不提供开发模式。开发环境仍由开发者手动启动 Web、HubServer 和 Agent Runtime。
- CLI 不直接管理 Agent Runtime，也不生成 Runtime token。
- CLI 不提供业务 API、数据库访问、Runtime API 或 Desktop 桥接能力。
- CLI 不支持覆盖 `--runtime-bin`、`--public-dir` 或远程 Runtime。
- CLI V1 不负责完整 build/package 发行链路；完整发行包构建由后续 `build:web`、`build:hub`、`build:runtime` 和 `package` 脚本补齐。

## 发行目录约束

CLI 按 `dirname(process.execPath)` 解析生产发行目录，并要求以下产物位于同一级目录：

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

平台规则：

| 平台 | CLI | HubServer | Agent Runtime |
| --- | --- | --- | --- |
| Windows | `agenthub-cli.exe` | `hub-server.exe` | `agent-runtime.exe` |
| macOS/Linux | `agenthub-cli` | `hub-server` | `agent-runtime` |

启动前必须检查：

- `hub-server(.exe)` 是文件。
- `agent-runtime(.exe)` 是文件。
- `public/` 是目录。

任一缺失时，CLI 必须在启动 HubServer 前失败，并打印清晰错误。

## 命令行参数

CLI V1 只暴露用户启动所需参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `--port` / `-p` | number | 指定 HubServer 端口。未提供时由 CLI 监听 `127.0.0.1:0` 获取可用端口。 |
| `--data-dir` / `-d` | string | 透传给 HubServer，作为 HubServer 数据目录。 |
| `--log-level` / `-l` | string | 透传给 HubServer。 |
| `--no-browser` | boolean | 禁止自动打开系统浏览器。 |

CLI 不接收位置参数。未知参数应直接报错。

## HubServer 启动契约

CLI 启动 HubServer 时固定传入以下参数：

```text
hub-server(.exe)
  --port <hubPort>
  --hostname 127.0.0.1
  --runtime-bin <dist>/agent-runtime(.exe)
  --public-dir <dist>/public
  [--data-dir <dir>]
  [--log-level <level>]
```

含义：

- `--runtime-bin` 显式启用 HubServer 生产 sidecar 模式。
- `--public-dir` 显式启用 HubServer Web 静态托管。
- `--hostname 127.0.0.1` 限制 HubServer 只监听本机。
- `--data-dir` 和 `--log-level` 仅在用户提供时透传。

CLI 不根据 `NODE_ENV` 判断生产模式。生产行为由传给 HubServer 的 `--runtime-bin` 和 `--public-dir` 触发。

## 启动流程

1. 解析 CLI 参数。
2. 以 `dirname(process.execPath)` 解析发行目录。
3. 检查 HubServer 二进制、Agent Runtime 二进制和 `public/`。
4. 如果用户未传 `--port`，在 `127.0.0.1` 上探测可用端口。
5. 使用 `Bun.spawn()` 启动 HubServer，`stdout` 和 `stderr` 继承当前终端。
6. 轮询 `GET http://127.0.0.1:<hubPort>/health`。
7. 只有 `/health` 返回 HTTP 2xx 且响应体 `status === "ok"` 时，视为 HubServer ready。
8. 输出：

   ```text
   AgentHub running at http://127.0.0.1:<hubPort>
   ```

9. 若未传 `--no-browser`，按平台打开浏览器。
10. 等待 HubServer 进程退出，并以 HubServer exit code 作为 CLI exit code。

当前 HubServer ready 等待超时为 30 秒。超时后 CLI 应向 HubServer 发送 SIGTERM，并以非 0 状态退出。

## 浏览器打开

浏览器打开是 best-effort 行为：

| 平台 | 命令 |
| --- | --- |
| Windows | `cmd /c start "" <url>` |
| macOS | `open <url>` |
| Linux | `xdg-open <url>` |

打开失败只打印 warning。HubServer 已经 ready 时，浏览器失败不得终止服务。

## 信号与退出

CLI 负责把用户终端中的退出信号传递给 HubServer：

- CLI 收到 SIGINT 时，向 HubServer 发送 SIGINT。
- CLI 收到 SIGTERM 时，向 HubServer 发送 SIGTERM。
- CLI 等待 HubServer 退出。
- HubServer 负责继续关闭 Agent Runtime Sidecar、数据库连接和 HTTP server。

CLI 不直接向 Agent Runtime 发送信号，避免绕过 HubServer 的 sidecar 清理逻辑。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 参数非法 | CLI 抛出参数错误并非 0 退出。 |
| 发行目录缺少 HubServer | 启动前失败。 |
| 发行目录缺少 Agent Runtime | 启动前失败。 |
| 发行目录缺少 `public/` | 启动前失败。 |
| HubServer `/health` 超时 | CLI 终止 HubServer 并非 0 退出。 |
| 浏览器打开失败 | 打印 warning，服务继续运行。 |
| HubServer 正常退出 | CLI 使用 HubServer exit code 退出。 |

CLI 只探测 HubServer 启动端口，不负责 Runtime 端口探测。Runtime 端口探测、Runtime ready 轮询和异常重启由 HubServer 完成。

## 与开发模式的关系

CLI 只面向生产发行包。开发模式保持手动启动：

```bash
bun run dev:web
bun run dev:server
bun run dev:runtime
```

开发时 HubServer 未收到 `--runtime-bin`，因此不会启动 Runtime sidecar，也不会探测 Runtime 端口。HubServer 继续使用 `--runtime-url` 或默认 Runtime URL 连接开发者手动启动的 Agent Runtime。

## 与 Desktop 的关系

Desktop 不通过 CLI 启动 HubServer。Desktop 主进程直接定位同一组生产产物，并启动：

```text
hub-server(.exe)
  --port <hubPort>
  --hostname 127.0.0.1
  --runtime-bin <runtimeBin>
  --public-dir <publicDir>
```

Desktop 与 CLI 共享 HubServer 的生产 sidecar/static 行为，但 Desktop 自己负责窗口生命周期、HubServer 进程生命周期和 WebView 打开。

## 构建与脚本

CLI 包位于 `cli/`，使用 Bun：

```json
{
  "dev": "bun run src/index.ts",
  "test": "bun test",
  "typecheck": "bunx tsc --noEmit",
  "build": "bun build src/index.ts --compile --outfile dist/agenthub-cli"
}
```

根级脚本保留：

```json
{
  "build:cli": "cd cli && bun install && bun run build"
}
```

完整发行链路仍应在后续补齐：

```text
build:web -> build:runtime -> build:hub -> build:cli -> package
```

其中 `build:hub` 不复制 Web assets。最终 `dist/public/` 由 package 阶段直接从 `web/dist/` 复制，CLI 只在运行时把 `<dist>/public` 作为 `--public-dir` 传给 HubServer。

## 验证清单

CLI V1 的轻量验证：

```bash
cd cli && bun test
cd cli && bunx tsc --noEmit
cd cli && bun run build
bun run build:cli
```

完整生产发行链路补齐后，还应做发行包 smoke：

```bash
cd dist
./agenthub-cli --no-browser
```

检查项：

- `/health` 返回 HubServer ready。
- `/` 返回 Web `index.html`。
- Web 静态资源可加载。
- HubServer 成功拉起 Agent Runtime sidecar。
- 退出 CLI 后 HubServer 和 Agent Runtime 都被清理。

## 后续扩展边界

- 若要支持自定义 `--public-dir` 或 `--runtime-bin`，必须重新评估 CLI 是否仍只面向生产发行包。
- 若要支持远程 HubServer 或远程 Runtime，必须同步更新安全模型、Runtime 权限边界和 Desktop 行为。
- 若要让 CLI 支持开发编排，应单独设计，不能影响现有开发者手动启动模式。
- 若要做单 exe 内嵌 Web assets，应优先更新 HubServer 静态托管和生产分发文档，再调整 CLI 的发行目录检查。
