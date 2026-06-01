import type { Part, Session, SessionPromptResponse } from "@opencode-ai/sdk"
import type {
  ExternalAdapterPrompt,
  ExternalSessionLink,
} from "./types"
import { createChildLogger } from "../../logger"
import { ExternalAdapterError } from "./types"
import {
  ManagedOpenCodeServer,
  type OpenCodeApiClient,
  type OpenCodeWorkspaceConnection,
  unwrapOpenCodeResponse,
} from "./opencode-server"
import type {
  OpenCodeClient,
  OpenCodePromptEvent,
  OpenCodePromptRequest,
  OpenCodeSessionRequest,
} from "./opencode-client"

type SessionState = {
  sessionId: string
  workspaceRootPath: string
  connection: OpenCodeWorkspaceConnection
}

type OpenCodeModelInfo = {
  providerId?: string
  modelId?: string
}

export type RealOpenCodeClientDependencies = {
  server?: ManagedOpenCodeServer
}

export class RealOpenCodeClient implements OpenCodeClient {
  private readonly server: ManagedOpenCodeServer
  private readonly sessions = new Map<string, SessionState>()
  private readonly log = createChildLogger("opencode-client")

  constructor(dependencies: RealOpenCodeClientDependencies = {}) {
    this.server = dependencies.server ?? new ManagedOpenCodeServer()
  }

  async ensureSession(request: OpenCodeSessionRequest): Promise<ExternalSessionLink> {
    this.log.info(
      {
        externalProvider: "opencode",
        runId: request.runId,
        conversationId: request.conversationId,
        agentId: request.agentId,
        scope: request.scope,
        workspaceId: request.workspaceId,
        workspaceRootPath: request.workspaceRootPath,
        taskId: request.taskId,
        hasProviderSessionHint: Boolean(request.providerSessionId),
        providerSessionId: request.providerSessionId,
      },
      "OpenCode session ensure starting"
    )
    const connection = await this.server.ensure(request.workspaceRootPath)
    this.log.info(
      {
        externalProvider: "opencode",
        runId: request.runId,
        conversationId: request.conversationId,
        workspaceId: request.workspaceId,
        workspaceRootPath: request.workspaceRootPath,
        serverUrl: connection.server.url,
        mode: connection.mode,
      },
      "OpenCode workspace connection acquired for session"
    )

    if (request.providerSessionId) {
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.runId,
          conversationId: request.conversationId,
          scope: request.scope,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          providerSessionId: request.providerSessionId,
        },
        "OpenCode hinted session lookup starting"
      )
      const existing = await this.getSessionOrNull(
        connection.client,
        request.providerSessionId,
        connection.directory
      )
      if (existing) {
        this.rememberSession(request.providerSessionId, request.workspaceRootPath, connection)
        this.log.info(
          {
            externalProvider: "opencode",
            runId: request.runId,
            conversationId: request.conversationId,
            scope: request.scope,
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            providerSessionId: request.providerSessionId,
            title: existing.title,
          },
          "OpenCode hinted session reused"
        )
        return createSessionLink(request, request.providerSessionId)
      }
      this.log.warn(
        {
          externalProvider: "opencode",
          runId: request.runId,
          conversationId: request.conversationId,
          scope: request.scope,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          providerSessionId: request.providerSessionId,
        },
        "OpenCode hinted session unavailable; creating replacement session"
      )
    }

    const session = await this.createSession(connection, request)
    this.rememberSession(session.id, request.workspaceRootPath, connection)
    this.log.info(
      {
        externalProvider: "opencode",
        runId: request.runId,
        conversationId: request.conversationId,
        scope: request.scope,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        providerSessionId: session.id,
        title: session.title,
      },
      "OpenCode session ready"
    )
    return createSessionLink(request, session.id)
  }

  async *streamPrompt(request: OpenCodePromptRequest): AsyncIterable<OpenCodePromptEvent> {
    const state = this.sessions.get(request.session.providerSessionId)
    if (!state) {
      this.log.error(
        {
          externalProvider: "opencode",
          providerSessionId: request.session.providerSessionId,
          workspaceId: request.session.workspaceId,
          runId: request.session.runId,
          scope: request.session.scope,
          taskId: request.session.taskId,
        },
        "OpenCode prompt cannot start because session state is missing"
      )
      throw new ExternalAdapterError(
        "ADAPTER_SESSION_FAILED",
        "OpenCode session is not available in the current runtime process",
        {
          providerSessionId: request.session.providerSessionId,
          workspaceId: request.session.workspaceId,
        }
      )
    }

    let abortPromise: Promise<void> | null = null
    let abortError: unknown
    const startAbort = (): void => {
      if (abortPromise) return
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
        },
        "OpenCode prompt abort requested"
      )
      abortPromise = this.abortSession(state).catch((error) => {
        abortError = error
      })
    }

    if (request.signal.aborted) {
      startAbort()
      await abortPromise
      if (abortError) throw abortError
      return
    }

    request.signal.addEventListener("abort", startAbort, { once: true })

    try {
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          promptLength: request.prompt.content.length,
        },
        "OpenCode prompt starting"
      )
      const response = await state.connection.client.session.prompt({
        path: { id: state.sessionId },
        query: { directory: state.connection.directory },
        body: {
          parts: [{
            type: "text",
            text: request.prompt.content,
          }],
        },
        signal: request.signal,
      })

      if (request.signal.aborted) {
        return
      }

      const message = unwrapOpenCodeResponse<SessionPromptResponse>(
        response,
        "ADAPTER_PROMPT_FAILED",
        "OpenCode prompt failed"
      )
      if (message.info.error) {
        throw new ExternalAdapterError(
          "ADAPTER_PROMPT_FAILED",
          "OpenCode prompt failed",
          { provider: "opencode", error: message.info.error }
        )
      }

      const content = extractAssistantText(message.parts)
      const model = getAssistantModelInfo(message.info)
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          assistantMessageId: message.info.id,
          contentLength: content.length,
          providerId: model.providerId,
          modelId: model.modelId,
          finish: getRecordString(message.info, "finish"),
        },
        "OpenCode prompt completed"
      )
      if (content) {
        yield {
          type: "message.delta",
          delta: content,
        }
      }
      yield {
        type: "message.completed",
        content,
      }
    } catch (error) {
      if (request.signal.aborted) {
        if (abortPromise) await abortPromise
        if (abortError) throw abortError
        this.log.info(
          {
            externalProvider: "opencode",
            runId: request.session.runId,
            conversationId: request.session.conversationId,
            workspaceId: request.session.workspaceId,
            scope: request.session.scope,
            taskId: request.session.taskId,
            providerSessionId: state.sessionId,
          },
          "OpenCode prompt stopped after abort"
        )
        return
      }
      if (error instanceof ExternalAdapterError) {
        this.log.error(
          {
            externalProvider: "opencode",
            runId: request.session.runId,
            conversationId: request.session.conversationId,
            workspaceId: request.session.workspaceId,
            scope: request.session.scope,
            taskId: request.session.taskId,
            providerSessionId: state.sessionId,
            code: error.code,
            error: error.message,
            details: error.details,
          },
          "OpenCode prompt failed"
        )
        throw error
      }
      this.log.error(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          error: describeError(error),
        },
        "OpenCode prompt failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_PROMPT_FAILED",
        "OpenCode prompt failed",
        { provider: "opencode", cause: describeError(error) }
      )
    } finally {
      request.signal.removeEventListener("abort", startAbort)
      if (request.signal.aborted && abortPromise) {
        await abortPromise
        if (abortError) throw abortError
      }
    }
  }

  private rememberSession(
    providerSessionId: string,
    workspaceRootPath: string,
    connection: OpenCodeWorkspaceConnection
  ): void {
    this.sessions.set(providerSessionId, {
      sessionId: providerSessionId,
      workspaceRootPath,
      connection,
    })
    this.log.info(
      {
        externalProvider: "opencode",
        providerSessionId,
        workspaceRootPath,
        serverUrl: connection.server.url,
      },
      "OpenCode session cached in runtime process"
    )
  }

  private async getSessionOrNull(
    client: OpenCodeApiClient,
    providerSessionId: string,
    directory: string
  ): Promise<Session | null> {
    try {
      const response = await client.session.get({
        path: { id: providerSessionId },
        query: { directory },
      })
      if (isNotFoundResponse(response)) {
        this.log.warn(
          {
            externalProvider: "opencode",
            providerSessionId,
            directory,
            responseError: isRecord(response) ? response.error : undefined,
          },
          "OpenCode session lookup returned not found"
        )
        return null
      }
      return unwrapOpenCodeResponse<Session>(
        response,
        "ADAPTER_SESSION_FAILED",
        "OpenCode session lookup failed"
      )
    } catch (error) {
      if (isNotFoundError(error)) {
        this.log.warn(
          {
            externalProvider: "opencode",
            providerSessionId,
            directory,
            error: describeError(error),
          },
          "OpenCode session lookup threw not found"
        )
        return null
      }
      if (error instanceof ExternalAdapterError) {
        this.log.error(
          {
            externalProvider: "opencode",
            providerSessionId,
            directory,
            code: error.code,
            error: error.message,
            details: error.details,
          },
          "OpenCode session lookup failed"
        )
        throw error
      }
      this.log.error(
        {
          externalProvider: "opencode",
          providerSessionId,
          directory,
          error: describeError(error),
        },
        "OpenCode session lookup failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_SESSION_FAILED",
        "OpenCode session lookup failed",
        { provider: "opencode", providerSessionId, cause: describeError(error) }
      )
    }
  }

  private async createSession(
    connection: OpenCodeWorkspaceConnection,
    request: OpenCodeSessionRequest
  ): Promise<Session> {
    try {
      const title = createSessionTitle(request)
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.runId,
          conversationId: request.conversationId,
          scope: request.scope,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          title,
        },
        "OpenCode session creation starting"
      )
      const response = await connection.client.session.create({
        query: { directory: connection.directory },
        body: {
          title,
        },
      })
      const session = unwrapOpenCodeResponse<Session>(
        response,
        "ADAPTER_SESSION_FAILED",
        "OpenCode session creation failed"
      )
      if (!session.id) {
        throw new ExternalAdapterError(
          "ADAPTER_SESSION_FAILED",
          "OpenCode session creation returned no session id",
          { provider: "opencode" }
        )
      }
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.runId,
          conversationId: request.conversationId,
          scope: request.scope,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          providerSessionId: session.id,
          title: session.title,
        },
        "OpenCode session created"
      )
      return session
    } catch (error) {
      if (error instanceof ExternalAdapterError) {
        this.log.error(
          {
            externalProvider: "opencode",
            runId: request.runId,
            conversationId: request.conversationId,
            scope: request.scope,
            workspaceId: request.workspaceId,
            taskId: request.taskId,
            code: error.code,
            error: error.message,
            details: error.details,
          },
          "OpenCode session creation failed"
        )
        throw error
      }
      this.log.error(
        {
          externalProvider: "opencode",
          runId: request.runId,
          conversationId: request.conversationId,
          scope: request.scope,
          workspaceId: request.workspaceId,
          taskId: request.taskId,
          error: describeError(error),
        },
        "OpenCode session creation failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_SESSION_FAILED",
        "OpenCode session creation failed",
        { provider: "opencode", cause: describeError(error) }
      )
    }
  }

  private async abortSession(state: SessionState): Promise<void> {
    try {
      this.log.info(
        {
          externalProvider: "opencode",
          providerSessionId: state.sessionId,
          workspaceRootPath: state.workspaceRootPath,
        },
        "OpenCode session abort starting"
      )
      const response = await state.connection.client.session.abort({
        path: { id: state.sessionId },
        query: { directory: state.connection.directory },
      })
      unwrapOpenCodeResponse<boolean>(
        response,
        "ADAPTER_ABORT_FAILED",
        "OpenCode session abort failed"
      )
      this.log.info(
        {
          externalProvider: "opencode",
          providerSessionId: state.sessionId,
          workspaceRootPath: state.workspaceRootPath,
        },
        "OpenCode session abort completed"
      )
    } catch (error) {
      if (error instanceof ExternalAdapterError) {
        this.log.error(
          {
            externalProvider: "opencode",
            providerSessionId: state.sessionId,
            workspaceRootPath: state.workspaceRootPath,
            code: error.code,
            error: error.message,
            details: error.details,
          },
          "OpenCode session abort failed"
        )
        throw error
      }
      this.log.error(
        {
          externalProvider: "opencode",
          providerSessionId: state.sessionId,
          workspaceRootPath: state.workspaceRootPath,
          error: describeError(error),
        },
        "OpenCode session abort failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_ABORT_FAILED",
        "OpenCode session abort failed",
        { provider: "opencode", providerSessionId: state.sessionId, cause: describeError(error) }
      )
    }
  }
}

export function createDefaultOpenCodeClient(): OpenCodeClient {
  return new RealOpenCodeClient()
}

export function extractAssistantText(parts: Array<Part> | unknown): string {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => extractTextPart(part))
    .filter((text): text is string => Boolean(text))
    .join("")
}

function extractTextPart(part: unknown): string | null {
  if (!isRecord(part)) return null
  if (part.type !== "text") return null
  if (part.ignored === true) return null
  return typeof part.text === "string" ? part.text : null
}

function getAssistantModelInfo(info: unknown): OpenCodeModelInfo {
  if (!isRecord(info)) return {}
  return {
    providerId: getRecordString(info, "providerID"),
    modelId: getRecordString(info, "modelID"),
  }
}

function getRecordString(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function createSessionLink(
  request: OpenCodeSessionRequest,
  providerSessionId: string
): ExternalSessionLink {
  return {
    provider: "opencode",
    agentId: request.agentId,
    scope: request.scope,
    providerSessionId,
    conversationId: request.conversationId,
    workspaceId: request.workspaceId,
    taskId: request.taskId,
    runId: request.runId,
    handoffSummary: request.handoffSummary,
  }
}

function createSessionTitle(request: OpenCodeSessionRequest): string {
  if (request.scope === "delegated-task" && request.taskId) {
    return `AgentHub task: ${request.taskId}`
  }
  return `AgentHub: ${request.conversationId}`
}

function isNotFoundResponse(response: unknown): boolean {
  if (!isRecord(response)) return false
  return isNotFoundError(response.error)
}

function isNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.name === "NotFoundError" ||
    error.name === "NotFound" ||
    getNestedString(error, ["data", "name"]) === "NotFoundError" ||
    getNestedString(error, ["data", "message"])?.toLowerCase().includes("not found") === true
}

function getNestedString(value: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return typeof current === "string" ? current : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function describeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }
  return error
}
