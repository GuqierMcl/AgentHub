import { z } from "zod"
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types"

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576
const MAX_RESPONSE_BYTES = 5 * 1_048_576

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "api-key",
])

export const WebFetchInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(HTTP_METHODS).optional().default("GET"),
  headers: z.record(z.string(), z.string()).optional().default({}),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional().default(DEFAULT_TIMEOUT_MS),
  maxResponseBytes: z.number().int().positive().max(MAX_RESPONSE_BYTES).optional().default(DEFAULT_MAX_RESPONSE_BYTES),
}).strict().superRefine((input, context) => {
  if ((input.method === "GET" || input.method === "HEAD") && input.body !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["body"],
      message: `${input.method} requests cannot include a body`,
    })
  }
})

export type WebFetchInput = z.infer<typeof WebFetchInputSchema>

export type WebFetchResult = {
  url: string
  finalUrl: string
  method: WebFetchInput["method"]
  statusCode: number
  statusText: string
  headers: Record<string, string>
  body: string
  truncated: boolean
  bytesRead: number
  durationMs: number
}

class ResponseTooLargeError extends Error {
  constructor(
    public bytesRead: number,
    public maxResponseBytes: number,
  ) {
    super(`Response exceeded ${maxResponseBytes} bytes`)
    this.name = "ResponseTooLargeError"
  }
}

function parseHttpUrl(url: string): URL | ToolExecutionResult<WebFetchResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return createFailure<WebFetchResult>("NETWORK_INVALID_URL", "web_fetch requires a valid URL")
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return createFailure<WebFetchResult>(
      "NETWORK_UNSUPPORTED_PROTOCOL",
      "web_fetch only supports http and https URLs",
      {
        protocol: parsed.protocol,
      }
    )
  }

  return parsed
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ""
    parsed.password = ""
    parsed.hash = ""
    parsed.search = parsed.search ? "?redacted" : ""
    return parsed.toString()
  } catch {
    return "[invalid-url]"
  }
}

function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Object.entries(headers)

  return Object.fromEntries(entries.map(([name, value]) => [
    name,
    SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[redacted]" : value,
  ]))
}

function createFailure<TData = unknown>(
  code: string,
  message: string,
  details?: unknown,
  data?: TData,
  status: "failed" | "cancelled" = "failed"
): ToolExecutionResult<TData> {
  return {
    status,
    summary: message,
    ...(data === undefined ? {} : { data }),
    error: {
      code,
      message,
      details,
    },
  }
}

function createAbortController(
  parentSignal: AbortSignal,
  timeoutMs: number
): {
  controller: AbortController
  clear: () => void
  timedOut: () => boolean
} {
  const controller = new AbortController()
  let timeoutTriggered = false

  const abortFromParent = () => controller.abort(parentSignal.reason)
  if (parentSignal.aborted) {
    abortFromParent()
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true })
  }

  const timeout = setTimeout(() => {
    timeoutTriggered = true
    controller.abort()
  }, timeoutMs)

  return {
    controller,
    clear: () => {
      clearTimeout(timeout)
      parentSignal.removeEventListener("abort", abortFromParent)
    },
    timedOut: () => timeoutTriggered,
  }
}

async function readResponseBody(
  response: Response,
  maxResponseBytes: number
): Promise<Pick<WebFetchResult, "body" | "bytesRead" | "truncated">> {
  if (!response.body) {
    return {
      body: "",
      bytesRead: 0,
      truncated: false,
    }
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      bytesRead += chunk.byteLength
      if (bytesRead > maxResponseBytes) {
        await reader.cancel()
        throw new ResponseTooLargeError(bytesRead, maxResponseBytes)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new TextDecoder("utf-8").decode(concatChunks(chunks, bytesRead))
  return {
    body,
    bytesRead,
    truncated: false,
  }
}

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const output = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function isApprovedToolCall(context: ToolExecutionContext): boolean {
  const request = context.permissionService?.getRequestForToolCall(context.runId, context.toolCallId)
  return request?.status === "approved"
}

export function createWebFetchTool(): ToolDefinition<WebFetchInput, WebFetchResult> {
  return {
    name: "web_fetch",
    displayName: "Web Fetch",
    description: "执行受控 HTTP(S) 网络请求并返回 UTF-8 文本响应。",
    category: "network",
    inputSchema: WebFetchInputSchema,
    riskLevel: "medium",
    requiredPermissions: {
      network: "limited",
    },
    approvalPolicy: "contextual",
    configurableByUserAgent: false,
    prepareApproval: async (input, context) => {
      if (context.agent.permissionPolicy.network === "full" || isApprovedToolCall(context)) {
        return null
      }

      const parsed = parseHttpUrl(input.url)
      if (!(parsed instanceof URL)) {
        return null
      }
      const safeUrl = sanitizeUrl(parsed.toString())
      const host = parsed.host
      return {
        reason: `${context.agent.name} wants to make a ${input.method} request to ${host ?? safeUrl}.`,
        riskLevel: "medium",
        data: {
          permissionType: "network_access",
          approvalReason: "network_request",
          method: input.method,
          url: safeUrl,
          host,
        },
      }
    },
    async execute(input, context) {
      const parsed = parseHttpUrl(input.url)
      if (!(parsed instanceof URL)) {
        return parsed as ToolExecutionResult<WebFetchResult>
      }

      const startedAt = Date.now()
      const requestUrl = sanitizeUrl(parsed.toString())
      const abort = createAbortController(context.signal, input.timeoutMs)

      try {
        const response = await fetch(parsed.toString(), {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: abort.controller.signal,
        })
        const body = await readResponseBody(response, input.maxResponseBytes)
        const durationMs = Date.now() - startedAt
        const finalUrl = response.url ? sanitizeUrl(response.url) : requestUrl

        return {
          status: "completed",
          summary: `${input.method} ${finalUrl} returned ${response.status}`,
          data: {
            url: requestUrl,
            finalUrl,
            method: input.method,
            statusCode: response.status,
            statusText: response.statusText,
            headers: redactHeaders(response.headers),
            body: body.body,
            truncated: body.truncated,
            bytesRead: body.bytesRead,
            durationMs,
          },
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt
        if (error instanceof ResponseTooLargeError) {
          return createFailure<WebFetchResult>(
            "NETWORK_RESPONSE_TOO_LARGE",
            `Response exceeded maxResponseBytes (${error.maxResponseBytes})`,
            {
              maxResponseBytes: error.maxResponseBytes,
              bytesRead: error.bytesRead,
            },
            {
              url: requestUrl,
              finalUrl: requestUrl,
              method: input.method,
              statusCode: 0,
              statusText: "",
              headers: {},
              body: "",
              truncated: true,
              bytesRead: error.bytesRead,
              durationMs,
            }
          )
        }

        if (abort.timedOut()) {
          return createFailure<WebFetchResult>(
            "NETWORK_TIMEOUT",
            `Request timed out after ${input.timeoutMs}ms`,
            {
              timeoutMs: input.timeoutMs,
              url: requestUrl,
            }
          )
        }

        if (context.signal.aborted) {
          return createFailure<WebFetchResult>(
            "TOOL_EXECUTION_ABORTED",
            "web_fetch was cancelled",
            {
              url: requestUrl,
            },
            undefined,
            "cancelled"
          )
        }

        const message = error instanceof Error ? error.message : "Network request failed"
        return createFailure<WebFetchResult>(
          "NETWORK_REQUEST_FAILED",
          message,
          {
            url: requestUrl,
          }
        )
      } finally {
        abort.clear()
      }
    },
  }
}
