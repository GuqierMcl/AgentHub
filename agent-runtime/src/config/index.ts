import { parseArgs } from "node:util";
import { z } from "zod";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export const DEFAULT_HUB_CALLBACK = "http://127.0.0.1:3000"

// 定义配置模式
const configSchema = z.object({
  port: z.coerce.number().int().positive().max(65535),
  hostname: z.string(),
  cors: z.array(z.string()),
  dataDir: z.string(),
  workdir: z.string(),
  hubCallback: z.string().optional(),
  logLevel: z.string(),
});

export type RuntimeConfig = z.infer<typeof configSchema>

export function loadRuntimeConfig(
  args: string[] = Bun.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): RuntimeConfig {
  // 解析命令行参数
  const { values } = parseArgs({
    args,
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
      workdir: {
        type: "string",
      },
      "hub-callback": {
        type: "string",
      },
      "log-level": {
        type: "string",
      },
    },
    strict: true,
    allowPositionals: false,
  });

  // 构建原始配置（命令行参数 > 环境变量 > 默认值）
  const rawConfig = {
    port: values.port ?? env.PORT ?? "4096",
    hostname: values.hostname ?? env.HOSTNAME ?? "127.0.0.1",
    cors: values.cors ?? (env.CORS ? env.CORS.split(",") : []),
    dataDir: resolve(values["data-dir"] ?? env.AGENT_RUNTIME_DATA_DIR ?? "./data-tmp"),
    workdir: resolve(values.workdir ?? env.AGENT_RUNTIME_WORKDIR ?? join(tmpdir(), "agent-runtime-workspace")),
    hubCallback: values["hub-callback"] ?? env.AGENTHUB_HUB_CALLBACK ?? DEFAULT_HUB_CALLBACK,
    logLevel: values["log-level"] ?? env.LOG_LEVEL ?? "info",
  };

  // 验证配置
  return configSchema.parse(rawConfig);
}

export const config = loadRuntimeConfig();
