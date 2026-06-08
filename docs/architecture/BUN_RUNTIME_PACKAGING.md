# Bun Runtime Packaging

本文档记录 AgentHub 使用 Bun runtime、Bun bundle、外置 native 依赖和命令行参数解析的设计说明。生产分发总览见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

## 目标

AgentHub 采用 Bun 作为开发运行时、包管理器和生产服务运行时。生产 V1 不追求把 HubServer 或 Agent Runtime 编译成单 exe，而是：

- 在发行包中内置当前平台的 Bun runtime。
- 使用 `bun build --target bun` 将业务代码打包成 service bundle。
- 对 native-heavy 或依赖真实文件路径的包使用 `--external`，保留真实 `node_modules/`。
- 用发行包内的 Bun runtime 执行 HubServer 和 Agent Runtime bundle。

设计原则：

- 开发和生产入口保持一致的参数语义。
- 命令行参数优先级高于环境变量，环境变量优先级高于默认值。
- HubServer、Agent Runtime 和 CLI 都显式声明自己的启动参数，不依赖隐式全局状态。
- 生产发行包不得在运行时执行源码生成、依赖安装、Prisma CLI 或 `bunx` 步骤。
- native/dynamic 依赖必须以真实目录形态参与 smoke test。

## Bundle 与 Compile 的边界

AgentHub 区分两种 Bun 构建方式：

| 构建方式 | 用途 | V1 结论 |
| --- | --- | --- |
| `bun build --target bun --outfile ...` | 生成由 Bun runtime 执行的 JS bundle | HubServer 和 Agent Runtime 默认使用 |
| `bun build --compile --outfile ...` | 生成单文件可执行程序 | 不用于 native-heavy 服务进程 |

HubServer 当前依赖 `@prisma/adapter-libsql`、`@libsql/client`、`sharp` 等包；Runtime 也需要兼容外部 agent SDK 和平台二进制。这些依赖可能通过 `.node` addon、DLL/so/dylib、动态 `require()` 或 `require.resolve()` 访问真实文件。`--compile` 的虚拟文件系统会增加运行时解析风险，因此服务进程默认不使用单 exe。

CLI 可以继续是轻量 compiled launcher，因为它不承载 native-heavy 服务依赖；也可以在后续改为 JS launcher + 平台脚本。无论哪种形式，CLI 都只负责启动 HubServer bundle。若某个平台产出 AgentHub 自有二进制 launcher，应使用 AgentHub 产品图标；随发行包携带的 Bun runtime 是上游运行时本体，保持原样复制。

## 基础脚本

服务包内建议使用 bundle 脚本：

```json
{
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --target bun --outfile dist/index.js",
    "start": "bun dist/index.js"
  }
}
```

native-heavy 依赖必须 external：

```bash
bun build src/index.ts \
  --target bun \
  --outfile dist/index.js \
  --external sharp \
  --external @libsql/client \
  --external libsql \
  --external node-pty
```

是否 external 某个包的判断标准：

- 包含 `.node`、DLL/so/dylib、平台二进制或 wasm runtime。
- 包在运行时使用动态 `require()`、`require.resolve()` 或扫描自身 package 目录。
- 包的官方文档明确要求真实文件路径或不支持单文件虚拟文件系统。

## 发行包运行

最终发行包内置 Bun runtime：

```text
dist/
  bun(.exe)
  hub-server/index.js
  agent-runtime/index.js
  hub-server/node_modules/
  agent-runtime/node_modules/
  public/
```

HubServer 运行示例：

```bash
./bun hub-server/index.js --hostname 127.0.0.1 --port 4095 --public-dir ./public
```

HubServer 启动 Runtime bundle 示例：

```bash
./bun agent-runtime/index.js --hostname 127.0.0.1 --port 4096 --hub-callback http://127.0.0.1:4095
```

package 阶段必须保证：

- Bun runtime 与当前平台匹配。
- AgentHub 自有 compiled launcher 使用 AgentHub 图标；Bun runtime 不做资源改写。
- service-local `node_modules/` 中包含对应 service bundle 的 external 依赖闭包。
- CLI/Desktop 启动 HubServer 时不依赖全局 `NODE_PATH`；Bun 按 entry 文件所在目录解析 service-local `node_modules/`。
- HubServer bundle 运行时不依赖源码目录检查 Prisma Client 是否新鲜；构建期必须先生成 Prisma Client，再把生成代码打入 bundle。
- native 包在发行包 smoke 中真实加载。

## 命令行参数

生产服务应支持显式参数：

```bash
./bun hub-server/index.js --hostname 127.0.0.1 --port 4095
```

开发环境通过 `bun run` 传递业务参数时需要使用 `--`：

```bash
bun run dev -- --hostname 127.0.0.1 --port 4095
```

参数优先级：

```text
命令行参数 > 环境变量 > 默认值
```

## 参数解析模式

Bun 环境下可以读取 `Bun.argv`，并配合 Node 标准库 `node:util` 的 `parseArgs` 做结构化解析。API 边界继续使用 Zod 校验。

```ts
import { parseArgs } from "node:util";
import { z } from "zod";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: {
      type: "string",
      short: "p",
    },
    hostname: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: false,
});

const rawConfig = {
  PORT: values.port ?? process.env.PORT ?? "3000",
  HOSTNAME: values.hostname ?? process.env.HOSTNAME ?? "127.0.0.1",
};

const schema = z.object({
  PORT: z.coerce.number().int().positive().max(65535),
  HOSTNAME: z.string().default("127.0.0.1"),
});

export const config = schema.parse(rawConfig);
```

服务入口应显式使用解析后的配置：

```ts
import { config } from "./config";

Bun.serve({
  port: config.PORT,
  hostname: config.HOSTNAME,
  fetch() {
    return new Response("OK");
  },
});
```

## AgentHub 约束

- `hub-server` 生产入口接收 `--port`、`--hostname`、`--bun-bin`、`--runtime-entry`、`--runtime-bin`、`--public-dir`、`--data-dir` 等参数。
- `agent-runtime` 使用 `--hostname` / `--port` 接收 HubServer 分配的监听地址。
- `hub-server` 构建只编译服务 bundle，并在构建期生成 Prisma Client 和内置 migration manifest；Web assets 不嵌入、不复制到 `hub-server/public/`，最终由 package 阶段复制 `web/dist/` 到 `dist/public/`。
- `agent-runtime` 构建生成 Runtime bundle；生产启动由 HubServer 使用发行包内 Bun runtime 拉起。
- CLI 只负责解析用户启动意图、拉起 HubServer bundle、打开浏览器和转发生命周期信号。
- Desktop 主进程直接拉起 HubServer bundle，不通过 CLI 中转；release 构建将根级 `dist/` 复制到应用 Resources app code 的 `app/agenthub-runtime/`，并将 `desktop/assets/icon.png` 复制到 `app/assets/icon.png` 供 loading 窗口使用，ready 前显示加载窗口。
- Windows Desktop release 使用 Electrobun hook 调用仓库内 `rcedit` patch AgentHub launcher 和 installer 图标；若 GitHub Release 上传 installer zip，zip 必须包含 patch 后的 installer。内置 Bun runtime 保持上游图标资源不变。
- AgentHub 版本号以根目录 `package.json#version` 为唯一来源；Desktop app metadata 应读取该版本，而不是维护自己的独立版本。
- 所有生产打包 smoke 都必须验证 Web 静态资源、HubServer 健康检查、Runtime sidecar 健康检查、native 依赖加载和进程退出清理。

## Native 依赖策略

package 阶段维护生产 external 依赖清单。V1 可以先复制服务级生产 `node_modules/` 保证 smoke 稳定，后续再裁剪到 external 依赖闭包。裁剪时至少覆盖：

- `sharp` 及当前平台 `@img/*` 包。
- `@libsql/client`、`libsql`、当前平台 `@libsql/*` 包，以及它们的普通 JS 依赖。
- `node-pty` 及当前平台 prebuilds。
- 外部 agent SDK 需要的 bundled binaries 或通过环境变量显式指定的 executable。

新增 native/dynamic 依赖时，必须同步更新：

- package 脚本的 external/copy 清单。
- 发行包 smoke。
- `docs/architecture/PRODUCTION_DISTRIBUTION.md` 的验证清单。
