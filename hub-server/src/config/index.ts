import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import os from 'node:os'
import { z } from 'zod'

function getDefaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const envDir = env.AGENTHUB_DATA_DIR
  if (envDir) return envDir

  const platform = os.platform()
  if (platform === 'win32') {
    return resolve(os.homedir(), 'AppData', 'Roaming', 'AgentHub')
  }
  if (platform === 'darwin') {
    return resolve(os.homedir(), 'Library', 'Application Support', 'AgentHub')
  }
  return resolve(os.homedir(), '.local', 'share', 'AgentHub')
}

const configSchema = z.object({
  port: z.coerce.number().int().positive().max(65535),
  hostname: z.string().min(1),
  cors: z.array(z.string()),
  dataDir: z.string().min(1),
  dbUrl: z.string().min(1),
  runtimeUrl: z.string().min(1),
  bunBin: z.string().min(1).optional(),
  runtimeEntry: z.string().min(1).optional(),
  runtimeBin: z.string().min(1).optional(),
  publicDir: z.string().min(1).optional(),
  noWeb: z.boolean(),
  logLevel: z.string().min(1),
  env: z.enum(['development', 'production']),
})

export type HubConfig = z.infer<typeof configSchema>

export function parseHubConfig(args: string[] = Bun.argv.slice(2), env: NodeJS.ProcessEnv = process.env): HubConfig {
  const { values } = parseArgs({
    args,
    options: {
      port: {
        type: 'string',
        short: 'p',
      },
      hostname: {
        type: 'string',
        short: 'h',
      },
      cors: {
        type: 'string',
        multiple: true,
      },
      'data-dir': {
        type: 'string',
        short: 'd',
      },
      'runtime-url': {
        type: 'string',
        short: 'r',
      },
      'bun-bin': {
        type: 'string',
      },
      'runtime-entry': {
        type: 'string',
      },
      'runtime-bin': {
        type: 'string',
      },
      'public-dir': {
        type: 'string',
      },
      'no-web': {
        type: 'boolean',
      },
      'log-level': {
        type: 'string',
        short: 'l',
      },
    },
    strict: true,
    allowPositionals: false,
  })

  const dataDir = resolve(values['data-dir'] ?? env.AGENTHUB_DATA_DIR ?? getDefaultDataDir(env))

  const rawConfig = {
    port: values.port ?? env.PORT ?? '3000',
    hostname: values.hostname ?? env.HOSTNAME ?? '127.0.0.1',
    cors: values.cors ?? (env.CORS ? env.CORS.split(',') : []),
    dataDir,
    dbUrl: `file:${resolve(dataDir, 'hub.db')}`,
    runtimeUrl: values['runtime-url'] ?? env.AGENTHUB_RUNTIME_URL ?? 'http://127.0.0.1:4096',
    bunBin: values['bun-bin'] ? resolve(values['bun-bin']) : undefined,
    runtimeEntry: values['runtime-entry'] ? resolve(values['runtime-entry']) : undefined,
    runtimeBin: values['runtime-bin'] ? resolve(values['runtime-bin']) : undefined,
    publicDir: values['public-dir'] ? resolve(values['public-dir']) : undefined,
    noWeb: values['no-web'] ?? false,
    logLevel: values['log-level'] ?? env.LOG_LEVEL ?? 'debug',
    env: (env.NODE_ENV === 'production' ? 'production' : 'development'),
  }

  return configSchema.parse(rawConfig)
}

export const config = parseHubConfig()
