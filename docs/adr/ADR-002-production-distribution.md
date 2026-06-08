# ADR-002: 生产分发采用 HubServer 托管 Web 和内置 Bun Runtime

## 状态

已采纳

## 上下文

AgentHub 需要落地生产构建和入口模式：

- CLI 用于生产启动 HubServer、Web 和 Runtime。
- Desktop 使用本地壳层，需要自动启动 HubServer，并展示同一套 Web 应用。
- HubServer 托管构建好的 Web dist。
- Agent Runtime 作为 HubServer 的 Sidecar 子进程运行。
- HubServer 和 Runtime 依赖 native/dynamic 包，例如 libsql、sharp、node-pty 和外部 agent SDK bundled binaries。

此前讨论过两类生产服务打包方式：

1. 使用 `bun build --compile` 把 HubServer 和 Runtime 编译为单文件可执行程序。
2. 在发行包中内置 Bun runtime，服务代码用 `bun build --target bun` 生成 bundle，native/dynamic 依赖保留真实 `node_modules/`。

单 exe 对分发体验友好，但 native/dynamic 依赖会遇到真实路径、`.node` addon、DLL/so/dylib、动态 `require()` 和 `require.resolve()` 问题。继续把服务进程做成单 exe 会让生产构建链路过早绑定到大量依赖细节。

此前还讨论过两种 Desktop Web 加载方式：

1. Desktop 也让 HubServer 托管 Web，并打开 `http://127.0.0.1:<port>`。
2. Desktop 通过 `views://` 或本地文件加载 Web，仅让 HubServer 提供 API。

第二种方式会要求前端引入 Desktop 专属 API base、SSE 路径处理、CORS/Origin 策略和可能的认证注入，首版复杂度较高。

## 决策

首版生产分发采用内置 Bun runtime 的资源目录：

```text
dist/
  bun(.exe)
  agenthub-cli(.exe | .js | platform launcher)
  hub-server/
    index.js
    node_modules/
  agent-runtime/
    index.js
    node_modules/
  public/
```

HubServer 和 Agent Runtime 默认不编译为单 exe，而是使用发行包内 Bun runtime 执行 bundle：

```text
bun hub-server/index.js
bun agent-runtime/index.js
```

native/dynamic 依赖通过 bundle external 策略保留在 service-local `node_modules/`，并由 package 阶段复制当前平台需要的依赖闭包。V1 可以先复制服务级生产依赖保证 smoke 稳定，后续再裁剪体积。

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
- 服务 bundle 仍能减少源码分发体积，同时避免单 exe 虚拟文件系统对 native/dynamic 依赖的干扰。
- Native 依赖以真实目录参与 smoke，更接近实际运行条件。
- Desktop 与 CLI 都可以复用同一组核心资源。

### 代价

- 发行包需要携带 Bun runtime 和一部分 `node_modules/`，体积会大于纯单 exe。
- package 脚本必须维护 service-local external/native 依赖闭包，并按平台复制。
- npm 分发需要平台包策略，避免单包包含所有平台 runtime 和 native 包。
- Desktop 首版会在本机回环地址启动 Web 服务。
- Web assets 作为 `public/` 目录随包分发，而不是内嵌到 HubServer bundle。

## 后续工作

- 调整 HubServer build：生成 bundle，不再 `--compile`。
- 调整 Runtime build：生成 bundle，不再 `--compile`。
- 调整 SidecarManager：支持 `--bun-bin` + `--runtime-entry` 启动 Runtime bundle，并保留 `--runtime-bin` 兼容路径。
- 调整 CLI：定位 Bun runtime 和 service bundle，启动 `bun hub-server/index.js`。
- 调整 package 脚本：复制 Bun runtime、service bundle、Web dist、native/dynamic 依赖闭包。
- 建立发行包 smoke，覆盖 Web、HubServer health、Runtime sidecar、Prisma/libsql、sharp、node-pty 和外部 agent SDK binary resolution。
- 调整 Desktop 主进程：定位应用资源目录中的 Bun runtime 和 HubServer bundle，打开本地 URL。
