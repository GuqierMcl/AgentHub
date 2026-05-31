import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { logger } from './logger'

export class AppError extends HTTPException {
  code: string

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(status, { message })
    this.name = 'AppError'
    this.code = code
  }
}

export function errorHandler(err: unknown, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      { error: { code: err.code, message: err.message } },
      err.status,
    )
  }

  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: 'HTTP_ERROR', message: err.message } },
      err.status,
    )
  }

  logger.error({ err }, 'Unhandled error')
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500,
  )
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message)
}

export function badRequest(code: string, message: string): AppError {
  return new AppError(400, code, message)
}

export function runtimeNotReady(message?: string): AppError {
  return new AppError(503, 'RUNTIME_NOT_READY', message ?? 'Agent Runtime is not available')
}

export function badGateway(code: string, message: string): AppError {
  return new AppError(502, code, message)
}

export function forbidden(code: string, message: string): AppError {
  return new AppError(403, code, message)
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message)
}