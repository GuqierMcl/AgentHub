import pino from 'pino'
import { nanoid } from 'nanoid'
import { Writable } from 'node:stream'
import type { Context, Next } from 'hono'

const COLORS: Record<string, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
  debug: '\x1b[90m',
  trace: '\x1b[90m',
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function prettyStream(): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding: string, callback: () => void) {
      try {
        const log = JSON.parse(chunk.toString())
        const time = log.time
          ? new Date(log.time).toISOString().split('T')[1].slice(0, 12)
          : ''
        const color = COLORS[log.level] ?? ''
        const level = log.level.toUpperCase().padEnd(5)
        const msg = log.msg ?? ''

        let line = `${DIM}[${time}]${RESET} ${color}${level}${RESET} ${msg}`

        const skip = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'name', 'v'])
        const extras = Object.entries(log)
          .filter(([k]) => !skip.has(k))
          .map(([k, v]) => `${DIM}${k}=${RESET}${v}`)

        if (extras.length > 0) {
          line += `  ${extras.join(' ')}`
        }

        process.stdout.write(line + '\n')
      } catch {
        process.stdout.write(chunk.toString())
      }
      callback()
    },
  })
}

const isDev =
  (process.env.NODE_ENV ?? 'development') !== 'production'

const sharedOpts: pino.LoggerOptions = {
  timestamp: pino.stdTimeFunctions.isoTime,
  base: undefined,
  formatters: {
    level(label) {
      return { level: label }
    },
  },
}

export function createLogger(level?: string): pino.Logger {
  const opts = { ...sharedOpts, level: level ?? 'debug' }
  if (isDev) {
    return pino(opts, prettyStream())
  }
  return pino(opts)
}

export const logger = createLogger()

export function requestLogger() {
  return async (c: Context, next: Next) => {
    const reqId = `req_${nanoid(8)}`
    const childLogger = logger.child({ reqId })
    c.set('logger', childLogger)
    const start = Date.now()
    await next()
    const duration = Date.now() - start
    childLogger.info(`${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`)
  }
}