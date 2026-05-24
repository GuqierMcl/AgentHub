import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import os from 'node:os'
import { z } from 'zod'

function getDefaultDataDir(): string {
  const envDir = process.env.AGENTHUB_DATA_DIR
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

const { values } = parseArgs({
  args: Bun.argv.slice(2),
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
    'log-level': {
      type: 'string',
      short: 'l',
    },
  },
  strict: true,
  allowPositionals: false,
})

const configSchema = z.object({
  port: z.coerce.number().int().positive().max(65535),
  hostname: z.string().min(1),
  cors: z.array(z.string()),
  dataDir: z.string().min(1),
  dbUrl: z.string().min(1),
  runtimeUrl: z.string().min(1),
  logLevel: z.string().min(1),
})

const dataDir = resolve(values['data-dir'] ?? getDefaultDataDir())

const rawConfig = {
  port: values.port ?? process.env.PORT ?? '3000',
  hostname: values.hostname ?? process.env.HOSTNAME ?? '127.0.0.1',
  cors: values.cors ?? (process.env.CORS ? process.env.CORS.split(',') : []),
  dataDir,
  dbUrl: `file:${resolve(dataDir, 'hub.db')}`,
  runtimeUrl: values['runtime-url'] ?? process.env.AGENTHUB_RUNTIME_URL ?? 'http://127.0.0.1:4096',
  logLevel: values['log-level'] ?? process.env.LOG_LEVEL ?? 'debug',
}

export const config = configSchema.parse(rawConfig)