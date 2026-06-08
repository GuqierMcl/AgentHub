import { AppError } from './errors'
import { logger } from './logger'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

interface RuntimeResponse {
  data: unknown
  status: number
}

interface RuntimeClientOptions {
  token?: string
}

export interface RuntimeErrorBody {
  error?: string
  message?: string
  details?: unknown[]
}

export function mapRuntimeError(status: number, body: RuntimeErrorBody | null): AppError {
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
  private token?: string

  constructor(baseUrl: string, options: RuntimeClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = options.token
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setToken(token: string | undefined): void {
    this.token = token
  }

  private createHeaders(path: string, initial?: HeadersInit, body?: unknown): Record<string, string> | undefined {
    const headers = new Headers(initial)

    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    if (this.token && path.startsWith('/runtime/')) {
      headers.set('x-agenthub-runtime-token', this.token)
    }

    const entries = [...headers.entries()]
    if (entries.length === 0) {
      return undefined
    }

    return Object.fromEntries(entries)
  }

  async forward(method: string, path: string, body?: unknown, options?: { raw?: boolean }): Promise<RuntimeResponse> {
    const url = `${this.baseUrl}${path}`
    const headers = this.createHeaders(path, undefined, body)

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
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

    if (options?.raw) {
      return { data: errorBody, status: response.status }
    }

    throw mapRuntimeError(response.status, errorBody)
  }

  async stream(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`
    const headers = this.createHeaders(path, init?.headers)

    try {
      const response = await fetch(url, {
        ...init,
        headers,
      })
      if (!response.ok) {
        logger.error({ path, status: response.status }, 'Agent Runtime stream returned error')
      }
      return response
    } catch {
      logger.error({ path }, 'Agent Runtime stream not available')
      throw new AppError(
        503 as ContentfulStatusCode,
        'RUNTIME_NOT_READY',
        'Agent Runtime is not available',
      )
    }
  }
}
