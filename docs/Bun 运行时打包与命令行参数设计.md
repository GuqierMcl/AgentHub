Bun 运行时打包与命令行参数设计
目标

本项目选择 Bun 作为运行时与包管理器，最终通过 Bun 的 --compile 能力将服务打包为单文件可执行程序。这样部署时不需要目标机器预装 Bun，也不需要额外拖带 node_modules。Bun 官方说明，bun build --compile 可以从 TypeScript/JavaScript 入口生成独立可执行文件，并会把导入的文件、依赖包以及 Bun runtime 一起打包进去。

基本打包方式

推荐在 package.json 中定义脚本：

{
  "scripts": {
    "dev": "bun src/index.ts",
    "build": "bun build src/index.ts --compile --outfile dist/server",
    "start": "./dist/server"
  }
}

开发环境运行：

bun run dev

生产构建：

bun run build

构建后运行：

./dist/server

如果需要压缩产物，可以在构建时加上：

bun build src/index.ts --compile --minify --outfile dist/server

Bun 文档也提到，生产环境可以使用 --compile --minify 将运行时解析、转译等成本前移到构建阶段。

命令行参数设计

服务需要支持类似下面的启动参数：

./dist/server --port 3000

开发环境也应保持一致：

bun run dev -- --port 3000

注意：通过 bun run dev 传递参数时，需要使用 --，否则参数可能被 Bun 自身消费。

参数读取方式

Bun 环境下可以使用 Bun.argv 获取命令行参数。推荐配合 Node 标准库的 node:util 中的 parseArgs 进行解析。

示例：

// src/config.ts
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

服务入口：

// src/index.ts
import { config } from "./config";

Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch() {
    return new Response("OK");
  },
});

console.log(`Server listening on ${config.HOST}:${config.PORT}`);
配置优先级

推荐采用以下优先级：

命令行参数 > 环境变量 > 默认值

例如：

./dist/server --port 3000

优先级高于：

PORT=4000 ./dist/server

如果两者都没有提供，则使用默认值：

PORT: 3000
使用示例

开发环境：

bun run dev -- --port 3000

打包：

bun run build

生产环境：

./dist/server --port 3000

指定 host：

./dist/server --host 127.0.0.1 --port 3000

使用环境变量：

HOST=0.0.0.0 PORT=3000 ./dist/server
结论

本项目采用 Bun 运行时打包方案：

Bun 包管理
  ↓
Bun 运行时开发
  ↓
bun build --compile
  ↓
单文件可执行程序

该方案的优势是开发和生产运行时一致，打包流程简单，部署时不需要目标机器单独安装 Bun。命令行参数通过 Bun.argv + parseArgs 统一处理，保证开发环境和打包后的可执行文件使用方式一致。
