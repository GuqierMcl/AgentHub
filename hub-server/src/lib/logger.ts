import pino from 'pino'
import { nanoid } from 'nanoid'
import type { Context, Next } from 'hono'

export function createLogger(level?: string): pino.Logger {
  return pino({
    level: level ?? 'debug',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label }
      },
    },
  })
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
    childLogger.info({ method: c.req.method, path: c.req.path, status: c.res.status, duration }, 'request')
  }
}