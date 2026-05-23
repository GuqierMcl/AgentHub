import { AppError } from './errors'
import { logger } from './logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

interface RuntimeResponse {
  data: unknown
  status: number
}

interface RuntimeErrorBody {
  error?: string
  message?: string
  details?: unknown[]
}

function mapRuntimeError(status: number, body: RuntimeErrorBody | null): AppError {
  const message = body?.error ?? body?.message ?? `Agent Runtime returned status ${status}`

  if (status === 404) {
    return new AppError(404 as ContentfulStatusCode, 'PROVIDER_NOT_FOUND', message)
  }

  if (status === 409) {
    return new AppError(409 as ContentfulStatusCode, 'PROVIDER_ALREADY_EXISTS', message)
  }

  if (status === 400) {
    return new AppError(502 as ContentfulStatusCode, 'BAD_GATEWAY', message)
  }

  return new AppError(502 as ContentfulStatusCode, 'RUNTIME_ERROR', message)
}

export class RuntimeClient {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async forward(method: string, path: string, body?: unknown): Promise<RuntimeResponse> {
    const url = `${this.baseUrl}${path}`

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch {
      logger.error({ method, path }, 'Agent Runtime not available')
      throw new AppError(
        503 as ContentfulStatusCode,
        'RUNTIME_NOT_READY',
        'Agent Runtime is not available',
      )
    }

    if (response.status >= 200 && response.status < 300) {
      if (response.status === 204) {
        logger.debug({ method, path, status: 204 }, 'Agent Runtime forwarded')
        return { data: null, status: 204 }
      }
      const data = await response.json()
      logger.debug({ method, path, status: response.status }, 'Agent Runtime forwarded')
      return { data, status: response.status }
    }

    let errorBody: RuntimeErrorBody | null = null
    try {
      errorBody = await response.json()
    } catch {
      // response body is not JSON
    }

    logger.error({ method, path, status: response.status }, 'Agent Runtime returned error')
    throw mapRuntimeError(response.status, errorBody)
  }
}