# Bun Runtime Packaging

本文档记录 Bun 运行时、单文件可执行程序和命令行参数解析的独立设计说明。生产分发总览见 `docs/architecture/PRODUCTION_DISTRIBUTION.md`。

## 目标

AgentHub 采用 Bun 作为开发运行时和包管理器。生产形态优先使用 `bun build --compile` 将服务入口打包为独立可执行程序，使目标机器不需要预装 Bun，也不需要携带完整 `node_modules`。

设计原则：

- 开发和生产入口保持一致的参数语义。
- 命令行参数优先级高于环境变量，环境变量优先级高于默认值。
- HubServer、Agent Runtime 和 CLI 都显式声明自己的启动参数，不依赖隐式全局状态。
- 生产二进制不得在运行时执行源码生成、依赖安装或 Prisma CLI 步骤。

## 基础脚本

服务包内建议保留以下脚本形态：

```json
{
  "scripts": {
    "dev": "bun src/index.ts",
    "build": "bun build src/index.ts --compile --outfile dist/server",
    "start": "./dist/server"
  }
}
```

常用命令：

```bash
bun run dev
bun run build
./dist/server
```

如需要压缩产物，可在构建时增加 `--minify`：

```bash
bun build src/index.ts --compile --minify --outfile dist/server
```

## 命令行参数

生产可执行程序应支持显式参数：

```bash
./dist/server --host 127.0.0.1 --port 3000
```

开发环境通过 `bun run` 传递业务参数时需要使用 `--`：

```bash
bun run dev -- --host 127.0.0.1 --port 3000
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
    host: {
      type: "string",
    },
  },
  strict: true,
  allowPositionals: false,
});

const rawConfig = {
  PORT: values.port ?? process.env.PORT ?? "3000",
  HOST: values.host ?? process.env.HOST ?? "0.0.0.0",
};

const schema = z.object({
  PORT: z.coerce.number().int().positive().max(65535),
  HOST: z.string().default("0.0.0.0"),
});

export const config = schema.parse(rawConfig);
```

服务入口应显式使用解析后的配置：

```ts
import { config } from "./config";

Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch() {
    return new Response("OK");
  },
});
```

## AgentHub 约束

- `agent-runtime` 使用 `--hostname` / `--port` 接收 HubServer 分配的监听地址。
- `hub-server` 生产入口接收 `--port`、`--runtime-bin`、`--public-dir`、`--data-dir` 等参数。
- CLI 只负责解析用户启动意图、拉起 HubServer、打开浏览器和转发生命周期信号。
- Desktop 主进程直接拉起 HubServer，不通过 CLI 中转。
- 所有生产打包 smoke 都必须验证 Web 静态资源、HubServer 健康检查、Runtime sidecar 健康检查和进程退出清理。
