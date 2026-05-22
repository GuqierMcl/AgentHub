import { parseArgs } from "node:util";
import { z } from "zod";
import { resolve } from "node:path";

// 定义配置模式
const configSchema = z.object({
  port: z.coerce.number().int().positive().max(65535),
  hostname: z.string(),
  cors: z.array(z.string()),
  dataDir: z.string(),
});

// 解析命令行参数
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: {
      type: "string",
      short: "p",
    },
    hostname: {
      type: "string",
      short: "h",
    },
    cors: {
      type: "string",
      multiple: true,
    },
    "data-dir": {
      type: "string",
      short: "d",
    },
  },
  strict: true,
  allowPositionals: false,
});

// 构建原始配置（命令行参数 > 环境变量 > 默认值）
const rawConfig = {
  port: values.port ?? process.env.PORT ?? "4096",
  hostname: values.hostname ?? process.env.HOSTNAME ?? "127.0.0.1",
  cors: values.cors ?? (process.env.CORS ? process.env.CORS.split(",") : []),
  dataDir: resolve(values["data-dir"] ?? process.env.AGENT_RUNTIME_DATA_DIR ?? "./data"),
};

// 验证配置
export const config = configSchema.parse(rawConfig);