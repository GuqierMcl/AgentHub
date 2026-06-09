import type { Part, Session, SessionPromptResponse } from "@opencode-ai/sdk/v2"
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
  OpenCodeExecutionAgent,
  OpenCodeExternalModel,
  OpenCodeModelCatalog,
  OpenCodePermissionRequest,
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
  providerName?: string
  modelName?: string
}

const DEFAULT_OPENCODE_EXECUTION_AGENT: OpenCodeExecutionAgent = "build"
const MAX_EXTERNAL_EVENT_TEXT_CHARS = 12_000
const MAX_EXTERNAL_EVENT_ARRAY_ITEMS = 50
const MAX_EXTERNAL_EVENT_OBJECT_KEYS = 80
const OPENCODE_EVENT_STREAM_READY_TIMEOUT_MS = 250
const OPENCODE_EVENT_STREAM_DRAIN_IDLE_MS = 20
const OPENCODE_EVENT_STREAM_DRAIN_MAX_MS = 250
const OPENCODE_EVENT_STREAM_STOP_TIMEOUT_MS = 250

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

  async listModels(workspaceRootPath: string): Promise<OpenCodeModelCatalog> {
    const connection = await this.server.ensure(workspaceRootPath)
    try {
      const response = await connection.client.provider.list({
        directory: connection.directory,
      })
      const catalog = unwrapOpenCodeResponse<unknown>(
        response,
        "ADAPTER_PROMPT_FAILED",
        "OpenCode provider list failed"
      )
      return normalizeOpenCodeModelCatalog(catalog)
    } catch (error) {
      if (error instanceof ExternalAdapterError) {
        throw error
      }
      throw new ExternalAdapterError(
        "ADAPTER_PROMPT_FAILED",
        "OpenCode provider list failed",
        { provider: "opencode", cause: describeError(error) }
      )
    }
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
    const startAbort = (): Promise<void> => {
      if (abortPromise) return abortPromise
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
      return abortPromise
    }
    const abortListener = (): void => {
      void startAbort()
    }

    if (request.signal.aborted) {
      await startAbort()
      if (abortError) throw abortError
      return
    }

    request.signal.addEventListener("abort", abortListener, { once: true })
    const executionAgent = request.executionAgent ?? DEFAULT_OPENCODE_EXECUTION_AGENT

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
          executionAgent,
          promptLength: request.prompt.content.length,
        },
        "OpenCode prompt starting"
      )

      const eventController = new AbortController()
      const stopEventStream = (): void => {
        if (!eventController.signal.aborted) {
          eventController.abort()
        }
      }
      request.signal.addEventListener("abort", stopEventStream, { once: true })

      const eventQueue: OpenCodePromptEvent[] = []
      let eventStreamDone = false
      let eventSubscriptionReady = false
      let resolveEventSubscriptionReady: (() => void) | undefined
      const eventSubscriptionReadyPromise = new Promise<void>((resolve) => {
        resolveEventSubscriptionReady = resolve
      })
      const markEventSubscriptionReady = (): void => {
        if (eventSubscriptionReady) return
        eventSubscriptionReady = true
        resolveEventSubscriptionReady?.()
      }
      let wakeEventLoop: (() => void) | undefined
      let eventStreamError: unknown
      const wake = (): void => {
        wakeEventLoop?.()
        wakeEventLoop = undefined
      }
      const waitForWake = (timeoutMs?: number): Promise<void> => {
        return new Promise((resolve) => {
          let timeout: ReturnType<typeof setTimeout> | undefined
          const resolveWake = (): void => {
            if (timeout) {
              clearTimeout(timeout)
            }
            if (wakeEventLoop === resolveWake) {
              wakeEventLoop = undefined
            }
            resolve()
          }
          wakeEventLoop = resolveWake
          if (timeoutMs !== undefined) {
            timeout = setTimeout(resolveWake, Math.max(0, timeoutMs))
          }
        })
      }
      const eventPump = (async () => {
        try {
          for await (const event of this.streamOpenCodeSessionEvents(
            state,
            request,
            eventController.signal,
            markEventSubscriptionReady
          )) {
            eventQueue.push(event)
            wake()
          }
        } catch (error) {
          if (isPermissionAdapterError(error)) {
            eventStreamError = error
            wake()
          } else if (!eventController.signal.aborted && !request.signal.aborted) {
            this.log.warn(
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
              "OpenCode event stream failed; continuing with prompt response fallback"
            )
          }
        } finally {
          markEventSubscriptionReady()
          eventStreamDone = true
          wake()
        }
      })()
      const stopEventStreamAndWait = async (): Promise<void> => {
        stopEventStream()
        const stopped = await waitForBoundedPromise(
          eventPump,
          OPENCODE_EVENT_STREAM_STOP_TIMEOUT_MS
        )
        if (!stopped) {
          this.log.warn(
            {
              externalProvider: "opencode",
              runId: request.session.runId,
              conversationId: request.session.conversationId,
              workspaceId: request.session.workspaceId,
              scope: request.session.scope,
              taskId: request.session.taskId,
              providerSessionId: state.sessionId,
              timeoutMs: OPENCODE_EVENT_STREAM_STOP_TIMEOUT_MS,
            },
            "OpenCode event stream did not stop promptly; continuing with prompt response"
          )
        }
      }

      const eventStreamReady = await waitForBoundedPromise(
        eventSubscriptionReadyPromise,
        OPENCODE_EVENT_STREAM_READY_TIMEOUT_MS
      )
      if (!eventStreamReady) {
        this.log.warn(
          {
            externalProvider: "opencode",
            runId: request.session.runId,
            conversationId: request.session.conversationId,
            workspaceId: request.session.workspaceId,
            scope: request.session.scope,
            taskId: request.session.taskId,
            providerSessionId: state.sessionId,
            timeoutMs: OPENCODE_EVENT_STREAM_READY_TIMEOUT_MS,
          },
          "OpenCode event stream subscription not ready before prompt; continuing with prompt fallback"
        )
      }

      if (request.signal.aborted) {
        await stopEventStreamAndWait()
        request.signal.removeEventListener("abort", stopEventStream)
        return
      }

      let promptSettled = false
      let promptSettledAt: number | undefined
      const promptPromise = state.connection.client.session.prompt({
        sessionID: state.sessionId,
        directory: state.connection.directory,
        agent: executionAgent,
        parts: [{
          type: "text",
          text: request.prompt.content,
        }],
        ...(request.model ? { model: request.model } : {}),
      }, {
        signal: request.signal,
      }).finally(() => {
        promptSettled = true
        promptSettledAt = Date.now()
        wake()
      })

      let streamedTextDelta = false
      let lastEventReceivedAt = Date.now()
      while (true) {
        if (eventStreamError && eventQueue.length === 0) {
          break
        }

        const nextEvent = eventQueue.shift()
        if (nextEvent) {
          lastEventReceivedAt = Date.now()
          if (nextEvent.type === "message.delta") {
            streamedTextDelta = true
          }
          yield nextEvent
          continue
        }

        if (request.signal.aborted) {
          break
        }

        if (!promptSettled) {
          if (eventStreamDone) {
            break
          }
          await waitForWake()
          continue
        }

        if (eventStreamDone) {
          break
        }

        const now = Date.now()
        const maxDrainDeadline = (promptSettledAt ?? now) + OPENCODE_EVENT_STREAM_DRAIN_MAX_MS
        const idleDrainStart = Math.max(lastEventReceivedAt, promptSettledAt ?? now)
        const idleDrainDeadline = idleDrainStart + OPENCODE_EVENT_STREAM_DRAIN_IDLE_MS
        const waitMs = Math.min(maxDrainDeadline, idleDrainDeadline) - now
        if (waitMs <= 0) {
          break
        }
        await waitForWake(waitMs)
      }

      await stopEventStreamAndWait()
      request.signal.removeEventListener("abort", stopEventStream)

      if (eventStreamError) {
        await startAbort().catch(() => {})
        void promptPromise.catch(() => {})
        throw eventStreamError
      }

      const response = await promptPromise

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
      const rawModel = getAssistantModelInfo(message.info)
      const model = await this.resolveModelDisplayInfo(
        state.connection.client,
        state.connection.directory,
        rawModel,
        request
      )
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
          executionAgent,
          contentLength: content.length,
          providerId: model.providerId,
          modelId: model.modelId,
          providerName: model.providerName,
          modelName: model.modelName,
          finish: getRecordString(message.info, "finish"),
        },
        "OpenCode prompt completed"
      )
      const externalModel = toExternalModel(model)
      if (content && !streamedTextDelta) {
        yield {
          type: "message.delta",
          delta: content,
        }
      }
      yield {
        type: "message.completed",
        content,
        ...(externalModel ? { externalModel } : {}),
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
      request.signal.removeEventListener("abort", abortListener)
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

  private async *streamOpenCodeSessionEvents(
    state: SessionState,
    request: OpenCodePromptRequest,
    signal: AbortSignal,
    onSubscriptionReady?: () => void
  ): AsyncIterable<OpenCodePromptEvent> {
    const eventApi = state.connection.client.event
    if (!eventApi?.subscribe) {
      onSubscriptionReady?.()
      return
    }

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
      "OpenCode event stream subscription starting"
    )

    try {
      const response = await eventApi.subscribe(
        { directory: state.connection.directory },
        { signal } as Parameters<typeof eventApi.subscribe>[1]
      )
      onSubscriptionReady?.()
      const stream = (response as { stream?: AsyncIterable<unknown> }).stream
      if (!stream) {
        this.log.warn(
          {
            externalProvider: "opencode",
            runId: request.session.runId,
            conversationId: request.session.conversationId,
            workspaceId: request.session.workspaceId,
            providerSessionId: state.sessionId,
          },
          "OpenCode event stream subscription returned no stream"
        )
        return
      }

      const eventState = createOpenCodeEventNormalizationState()
      for await (const providerEvent of stream) {
        if (signal.aborted || request.signal.aborted) {
          return
        }

        const normalized = normalizeOpenCodeProviderEvent(
          providerEvent,
          state.sessionId,
          state.workspaceRootPath,
          eventState
        )
        if (normalized?.type === "permission.requested") {
          await this.handlePermissionRequest(state, request, normalized)
          continue
        }
        if (normalized) {
          yield normalized
        }
      }
    } finally {
      onSubscriptionReady?.()
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          aborted: signal.aborted || request.signal.aborted,
        },
        "OpenCode event stream subscription stopped"
      )
    }
  }

  private async getSessionOrNull(
    client: OpenCodeApiClient,
    providerSessionId: string,
    directory: string
  ): Promise<Session | null> {
    try {
      const response = await client.session.get({
        sessionID: providerSessionId,
        directory,
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

  private async handlePermissionRequest(
    state: SessionState,
    request: OpenCodePromptRequest,
    permission: OpenCodePermissionRequest
  ): Promise<void> {
    if (!request.permissionHandler) {
      this.log.error(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          providerPermissionId: permission.providerPermissionId,
          permissionKind: permission.permissionKind,
        },
        "OpenCode permission request received without AgentHub permission handler"
      )
      await this.replyToPermission(state, request, permission, false, "AgentHub permission bridge is unavailable")
      throw new ExternalAdapterError(
        "ADAPTER_PERMISSION_FAILED",
        "OpenCode permission bridge is unavailable",
        { provider: "opencode", providerPermissionId: permission.providerPermissionId }
      )
    }

    this.log.info(
      {
        externalProvider: "opencode",
        runId: request.session.runId,
        conversationId: request.session.conversationId,
        workspaceId: request.session.workspaceId,
        scope: request.session.scope,
        taskId: request.session.taskId,
        providerSessionId: state.sessionId,
        providerPermissionId: permission.providerPermissionId,
        permissionKind: permission.permissionKind,
        patternCount: permission.patterns.length,
        providerToolCallId: permission.providerToolCallId,
      },
      "OpenCode permission request bridged to AgentHub"
    )

    const decision = await request.permissionHandler(permission)
    await this.replyToPermission(
      state,
      request,
      permission,
      decision.approved,
      decision.reason
    )
  }

  private async replyToPermission(
    state: SessionState,
    request: OpenCodePromptRequest,
    permission: OpenCodePermissionRequest,
    approved: boolean,
    message?: string
  ): Promise<void> {
    const reply = approved ? "once" : "reject"
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
          providerPermissionId: permission.providerPermissionId,
          permissionKind: permission.permissionKind,
          reply,
        },
        "OpenCode permission reply starting"
      )
      const response = await state.connection.client.permission.reply({
        requestID: permission.providerPermissionId,
        directory: state.connection.directory,
        reply,
        ...(message ? { message } : {}),
      })
      unwrapOpenCodeResponse<boolean>(
        response,
        "ADAPTER_PERMISSION_REPLY_FAILED",
        "OpenCode permission reply failed"
      )
      this.log.info(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          scope: request.session.scope,
          taskId: request.session.taskId,
          providerSessionId: state.sessionId,
          providerPermissionId: permission.providerPermissionId,
          permissionKind: permission.permissionKind,
          reply,
        },
        "OpenCode permission reply completed"
      )
    } catch (error) {
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
            providerPermissionId: permission.providerPermissionId,
            permissionKind: permission.permissionKind,
            code: error.code,
            error: error.message,
            details: error.details,
          },
          "OpenCode permission reply failed"
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
          providerPermissionId: permission.providerPermissionId,
          permissionKind: permission.permissionKind,
          error: describeError(error),
        },
        "OpenCode permission reply failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_PERMISSION_REPLY_FAILED",
        "OpenCode permission reply failed",
        {
          provider: "opencode",
          providerPermissionId: permission.providerPermissionId,
          cause: describeError(error),
        }
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
        directory: connection.directory,
        title,
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
        sessionID: state.sessionId,
        directory: state.connection.directory,
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

  private async resolveModelDisplayInfo(
    client: OpenCodeApiClient,
    directory: string,
    model: OpenCodeModelInfo,
    request: OpenCodePromptRequest
  ): Promise<OpenCodeModelInfo> {
    if (!model.providerId || !model.modelId) {
      return model
    }

    try {
      const response = await client.provider.list({
        directory,
      })
      const catalog = unwrapOpenCodeResponse<unknown>(
        response,
        "ADAPTER_PROMPT_FAILED",
        "OpenCode provider list failed"
      )
      const names = lookupOpenCodeModelNames(catalog, model.providerId, model.modelId)
      if (names.providerName || names.modelName) {
        this.log.info(
          {
            externalProvider: "opencode",
            runId: request.session.runId,
            conversationId: request.session.conversationId,
            workspaceId: request.session.workspaceId,
            providerSessionId: request.session.providerSessionId,
            providerId: model.providerId,
            modelId: model.modelId,
            providerName: names.providerName,
            modelName: names.modelName,
          },
          "OpenCode model display info resolved"
        )
        return {
          ...model,
          ...names,
        }
      }

      this.log.warn(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          providerSessionId: request.session.providerSessionId,
          providerId: model.providerId,
          modelId: model.modelId,
        },
        "OpenCode model display info not found in provider catalog"
      )
      return model
    } catch (error) {
      this.log.warn(
        {
          externalProvider: "opencode",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          workspaceId: request.session.workspaceId,
          providerSessionId: request.session.providerSessionId,
          providerId: model.providerId,
          modelId: model.modelId,
          error: describeError(error),
        },
        "OpenCode model display info unavailable"
      )
      return model
    }
  }
}

export function createDefaultOpenCodeClient(): OpenCodeClient {
  return defaultOpenCodeClient
}

export function getDefaultOpenCodeServer(): ManagedOpenCodeServer {
  return defaultOpenCodeServer
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

function toExternalModel(
  model: OpenCodeModelInfo
): OpenCodeExternalModel | undefined {
  if (!model.providerId || !model.modelId) {
    return undefined
  }
  return {
    provider: "opencode",
    providerId: model.providerId,
    modelId: model.modelId,
    ...(model.providerName ? { providerName: model.providerName } : {}),
    ...(model.modelName ? { modelName: model.modelName } : {}),
  }
}

type OpenCodeEventNormalizationState = {
  // partID -> part type (e.g. "text" | "reasoning" | "tool"), learned from
  // message.part.updated so we can route message.part.delta correctly.
  partTypes: Map<string, string>
  // partID of reasoning parts already finished, so the legacy stream (which can
  // re-emit a finished part) only yields one reasoning.completed each.
  finishedReasoningParts: Set<string>
  // callID -> tool name, so success/failure events can label the tool.
  toolNames: Map<string, string>
  // callID -> last emitted tool lifecycle phase, so the legacy
  // message.part.updated stream (which re-emits the whole tool part on every
  // transition) only yields a started/completed/failed event once each.
  toolPhases: Map<string, "started" | "completed" | "failed">
}

function createOpenCodeEventNormalizationState(): OpenCodeEventNormalizationState {
  return {
    partTypes: new Map<string, string>(),
    finishedReasoningParts: new Set<string>(),
    toolNames: new Map<string, string>(),
    toolPhases: new Map<string, "started" | "completed" | "failed">(),
  }
}

function normalizeOpenCodeProviderEvent(
  providerEvent: unknown,
  providerSessionId: string,
  workspaceRootPath: string,
  state: OpenCodeEventNormalizationState
): OpenCodePromptEvent | undefined {
  const event = getRecord(providerEvent)
  const type = getRecordString(event, "type")
  const properties = getRecord(event?.properties)
  const sessionId = getRecordString(properties, "sessionID") ?? getRecordString(properties, "sessionId")
  if (!type || !properties || sessionId !== providerSessionId) {
    return undefined
  }

  const providerEventId = getRecordString(event, "id")
  switch (type) {
    // --- Vocabulary emitted by the legacy session.prompt() agent loop. ---
    case "message.part.updated":
      return normalizeMessagePartUpdated(properties, workspaceRootPath, providerEventId, state)
    case "message.part.delta":
      return normalizeMessagePartDelta(properties, state)
    case "permission.asked":
      return normalizePermissionAsked(properties, workspaceRootPath)
    case "permission.updated":
      return normalizePermissionUpdated(properties, workspaceRootPath)
    // --- Forward-compatible session.next.* vocabulary. ---
    case "session.next.text.delta": {
      const delta = getRecordString(properties, "delta")
      return delta ? { type: "message.delta", delta } : undefined
    }
    case "session.next.reasoning.delta": {
      const reasoningId = getRecordString(properties, "reasoningID") ?? "opencode-reasoning"
      const delta = getRecordString(properties, "delta")
      return delta ? { type: "reasoning.delta", reasoningId, delta } : undefined
    }
    case "session.next.reasoning.ended": {
      const reasoningId = getRecordString(properties, "reasoningID") ?? "opencode-reasoning"
      const content = getRecordString(properties, "text") ?? ""
      return { type: "reasoning.completed", reasoningId, content }
    }
    case "session.next.tool.called": {
      const callId = getRecordString(properties, "callID")
      const toolName = getRecordString(properties, "tool")
      if (!callId || !toolName) return undefined
      state.toolNames.set(callId, toolName)
      const provider = getRecord(properties.provider)
      return {
        type: "tool.started",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: toolName,
        input: sanitizeExternalProviderValue(properties.input, workspaceRootPath),
        providerExecuted: getRecordBoolean(provider, "executed"),
        providerMetadata: sanitizeExternalProviderRecord(provider?.metadata, workspaceRootPath),
      }
    }
    case "session.next.tool.success": {
      const callId = getRecordString(properties, "callID")
      if (!callId) return undefined
      const provider = getRecord(properties.provider)
      return {
        type: "tool.completed",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: state.toolNames.get(callId) ?? "tool",
        output: {
          structured: sanitizeExternalProviderValue(properties.structured, workspaceRootPath),
          content: sanitizeExternalProviderValue(properties.content, workspaceRootPath),
        },
        providerExecuted: getRecordBoolean(provider, "executed"),
        providerMetadata: sanitizeExternalProviderRecord(provider?.metadata, workspaceRootPath),
      }
    }
    case "session.next.tool.failed": {
      const callId = getRecordString(properties, "callID")
      if (!callId) return undefined
      const provider = getRecord(properties.provider)
      return {
        type: "tool.failed",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: state.toolNames.get(callId) ?? "tool",
        error: sanitizeExternalProviderValue(properties.error, workspaceRootPath),
        providerExecuted: getRecordBoolean(provider, "executed"),
        providerMetadata: sanitizeExternalProviderRecord(provider?.metadata, workspaceRootPath),
      }
    }
    default:
      return undefined
  }
}

function normalizePermissionAsked(
  properties: Record<string, unknown>,
  workspaceRootPath: string
): OpenCodePromptEvent | undefined {
  const providerPermissionId = getRecordString(properties, "id")
  const permissionKind = getRecordString(properties, "permission")
  if (!providerPermissionId || !permissionKind) {
    return undefined
  }

  const tool = getRecord(properties.tool)
  const metadata = sanitizeExternalProviderRecord(properties.metadata, workspaceRootPath)
  return {
    type: "permission.requested",
    providerPermissionId,
    permissionKind,
    patterns: normalizePermissionPatterns(properties.patterns, workspaceRootPath),
    always: normalizePermissionPatterns(properties.always, workspaceRootPath),
    providerToolCallId: getRecordString(tool, "callID"),
    providerMessageId: getRecordString(tool, "messageID"),
    providerMetadata: metadata,
    reason: getRecordString(metadata, "reason") ?? `OpenCode requested ${permissionKind} permission`,
  }
}

function normalizePermissionUpdated(
  properties: Record<string, unknown>,
  workspaceRootPath: string
): OpenCodePromptEvent | undefined {
  const providerPermissionId = getRecordString(properties, "id")
  const permissionKind = getRecordString(properties, "type") ?? getRecordString(properties, "permission")
  if (!providerPermissionId || !permissionKind) {
    return undefined
  }

  const metadata = sanitizeExternalProviderRecord(properties.metadata, workspaceRootPath)
  return {
    type: "permission.requested",
    providerPermissionId,
    permissionKind,
    patterns: normalizePermissionPatterns(properties.pattern, workspaceRootPath),
    providerToolCallId: getRecordString(properties, "callID"),
    providerMessageId: getRecordString(properties, "messageID"),
    providerMetadata: metadata,
    reason: getRecordString(metadata, "reason") ??
      getRecordString(properties, "title") ??
      `OpenCode requested ${permissionKind} permission`,
  }
}

function normalizePermissionPatterns(value: unknown, workspaceRootPath: string): string[] {
  const patterns = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return patterns
    .filter((pattern): pattern is string => typeof pattern === "string")
    .map((pattern) => truncateExternalProviderText(redactWorkspaceRoot(pattern, workspaceRootPath)))
}

function normalizeMessagePartDelta(
  properties: Record<string, unknown>,
  state: OpenCodeEventNormalizationState
): OpenCodePromptEvent | undefined {
  // Only text/reasoning fields stream as deltas; tool input deltas are surfaced
  // via the tool lifecycle (message.part.updated) instead.
  if (getRecordString(properties, "field") !== "text") {
    return undefined
  }
  const delta = getRecordString(properties, "delta")
  if (!delta) {
    return undefined
  }
  const partId = getRecordString(properties, "partID")
  const partType = partId ? state.partTypes.get(partId) : undefined
  if (partType === "reasoning") {
    return {
      type: "reasoning.delta",
      reasoningId: partId ?? "opencode-reasoning",
      delta,
    }
  }
  // Default unknown/text parts to assistant message text.
  return { type: "message.delta", delta }
}

function normalizeMessagePartUpdated(
  properties: Record<string, unknown>,
  workspaceRootPath: string,
  providerEventId: string | undefined,
  state: OpenCodeEventNormalizationState
): OpenCodePromptEvent | undefined {
  const part = getRecord(properties.part)
  const partType = getRecordString(part, "type")
  const partId = getRecordString(part, "id")
  if (part && partType && partId) {
    state.partTypes.set(partId, partType)
  }

  // A reasoning part that carries time.end has finished thinking. The legacy
  // stream never emits session.next.reasoning.ended, so this updated event is
  // the only signal that lets the UI close the "thinking" block.
  if (part && partType === "reasoning" && partId) {
    const time = getRecord(part.time)
    const ended = time !== undefined && time.end !== undefined
    if (ended && !state.finishedReasoningParts.has(partId)) {
      state.finishedReasoningParts.add(partId)
      return {
        type: "reasoning.completed",
        reasoningId: partId,
        content: getRecordString(part, "text") ?? "",
      }
    }
    return undefined
  }

  if (!part || partType !== "tool") {
    return undefined
  }

  const callId = getRecordString(part, "callID")
  const toolName = getRecordString(part, "tool")
  if (!callId || !toolName) {
    return undefined
  }
  state.toolNames.set(callId, toolName)

  const toolState = getRecord(part.state)
  const status = getRecordString(toolState, "status")
  const phase = state.toolPhases.get(callId)
  const input = toolState ? sanitizeExternalProviderValue(toolState.input, workspaceRootPath) : undefined
  const metadata = sanitizeExternalProviderRecord(toolState?.metadata, workspaceRootPath)

  switch (status) {
    case "completed": {
      if (phase === "completed" || phase === "failed") return undefined
      state.toolPhases.set(callId, "completed")
      return {
        type: "tool.completed",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: toolName,
        input,
        output: {
          output: sanitizeExternalProviderValue(toolState?.output, workspaceRootPath),
          title: sanitizeExternalProviderValue(toolState?.title, workspaceRootPath),
        },
        providerExecuted: true,
        providerMetadata: metadata,
      }
    }
    case "error": {
      if (phase === "failed") return undefined
      state.toolPhases.set(callId, "failed")
      return {
        type: "tool.failed",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: toolName,
        input,
        error: sanitizeExternalProviderValue(toolState?.error, workspaceRootPath),
        providerExecuted: true,
        providerMetadata: metadata,
      }
    }
    case "pending":
    case "running":
    default: {
      // The legacy stream re-emits the whole tool part on every transition and
      // the pending snapshot carries an empty input. Hold the started event
      // until we actually have input so the tool card shows real arguments, and
      // only emit it once.
      if (phase) return undefined
      if (!hasMeaningfulToolInput(input) && status !== "running") return undefined
      state.toolPhases.set(callId, "started")
      return {
        type: "tool.started",
        providerEventId,
        providerToolCallId: callId,
        providerToolName: toolName,
        input,
        providerExecuted: true,
        providerMetadata: metadata,
      }
    }
  }
}

function hasMeaningfulToolInput(input: unknown): boolean {
  if (input === undefined || input === null) return false
  if (typeof input === "object") {
    return Object.keys(input as Record<string, unknown>).length > 0
  }
  return true
}

function sanitizeExternalProviderRecord(
  value: unknown,
  workspaceRootPath: string
): Record<string, unknown> | undefined {
  const sanitized = sanitizeExternalProviderValue(value, workspaceRootPath)
  return getRecord(sanitized)
}

function sanitizeExternalProviderValue(
  value: unknown,
  workspaceRootPath: string,
  seen = new WeakSet<object>(),
  depth = 0
): unknown {
  if (typeof value === "string") {
    return truncateExternalProviderText(redactWorkspaceRoot(value, workspaceRootPath))
  }
  if (typeof value !== "object" || value === null) {
    return value
  }
  if (seen.has(value)) {
    return "[Circular]"
  }
  if (depth >= 6) {
    return "[MaxDepth]"
  }

  seen.add(value)
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_EXTERNAL_EVENT_ARRAY_ITEMS)
      .map((item) => sanitizeExternalProviderValue(item, workspaceRootPath, seen, depth + 1))
    if (value.length > MAX_EXTERNAL_EVENT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_EXTERNAL_EVENT_ARRAY_ITEMS} items truncated]`)
    }
    return items
  }

  const entries = Object.entries(value).slice(0, MAX_EXTERNAL_EVENT_OBJECT_KEYS)
  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    sanitized[key] = sanitizeExternalProviderValue(item, workspaceRootPath, seen, depth + 1)
  }
  if (Object.keys(value).length > MAX_EXTERNAL_EVENT_OBJECT_KEYS) {
    sanitized.__truncatedKeys = Object.keys(value).length - MAX_EXTERNAL_EVENT_OBJECT_KEYS
  }
  return sanitized
}

function redactWorkspaceRoot(value: string, workspaceRootPath: string): string {
  const normalizedRoot = workspaceRootPath.replace(/\\/g, "/")
  return value
    .split(workspaceRootPath).join("[workspace-root]")
    .split(normalizedRoot).join("[workspace-root]")
}

function truncateExternalProviderText(value: string): string {
  if (value.length <= MAX_EXTERNAL_EVENT_TEXT_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_EXTERNAL_EVENT_TEXT_CHARS)}...[truncated ${value.length - MAX_EXTERNAL_EVENT_TEXT_CHARS} chars]`
}

async function waitForBoundedPromise(
  promise: Promise<void>,
  timeoutMs: number
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function lookupOpenCodeModelNames(
  catalog: unknown,
  providerId: string,
  modelId: string
): Pick<OpenCodeModelInfo, "providerName" | "modelName"> {
  const catalogRecord = getRecord(catalog)
  const providers = Array.isArray(catalogRecord?.all) ? catalogRecord.all : []
  const provider = providers
    .map((candidate) => getRecord(candidate))
    .find((candidate) => getRecordString(candidate, "id") === providerId)
  if (!provider) {
    return {}
  }

  const models = getRecord(provider.models)
  const keyedModel = getRecord(models?.[modelId])
  const model = keyedModel ?? Object.values(models ?? {})
    .map((candidate) => getRecord(candidate))
    .find((candidate) => getRecordString(candidate, "id") === modelId)

  return {
    providerName: getRecordString(provider, "name"),
    modelName: getRecordString(model, "name"),
  }
}

function normalizeOpenCodeModelCatalog(catalog: unknown): OpenCodeModelCatalog {
  const warnings: string[] = []
  const models: OpenCodeModelCatalog["models"] = []
  const catalogRecord = getRecord(catalog)
  const providers = Array.isArray(catalogRecord?.all) ? catalogRecord.all : []
  const connectedProviderIds = Array.isArray(catalogRecord?.connected)
    ? new Set(
        catalogRecord.connected.filter(
          (providerID): providerID is string =>
            typeof providerID === "string" && providerID.trim().length > 0
        )
      )
    : new Set<string>()

  if (!Array.isArray(catalogRecord?.all)) {
    warnings.push("OpenCode provider catalog did not include an all array.")
  }
  if (!Array.isArray(catalogRecord?.connected)) {
    warnings.push("OpenCode provider catalog did not include a connected array.")
  } else if (providers.length > 0 && connectedProviderIds.size === 0) {
    warnings.push("OpenCode did not report any connected providers.")
  }

  for (const providerValue of providers) {
    const provider = getRecord(providerValue)
    if (!provider) {
      warnings.push("Skipped invalid OpenCode provider entry.")
      continue
    }
    const providerID = getRecordString(provider, "id")
    if (!providerID) {
      warnings.push("Skipped OpenCode provider without an id.")
      continue
    }
    if (!connectedProviderIds.has(providerID)) {
      continue
    }

    const providerName = getRecordString(provider, "name")
    const providerModels = getRecord(provider.models)
    if (!providerModels) {
      warnings.push(`Skipped OpenCode provider ${providerID} because models were missing.`)
      continue
    }

    for (const [modelKey, modelValue] of Object.entries(providerModels)) {
      const model = getRecord(modelValue)
      const modelID = getRecordString(model, "id") ?? modelKey
      if (!modelID) {
        warnings.push(`Skipped OpenCode model without an id for provider ${providerID}.`)
        continue
      }

      models.push({
        providerID,
        ...(providerName ? { providerName } : {}),
        modelID,
        ...(getRecordString(model, "name") ? { modelName: getRecordString(model, "name") } : {}),
      })
    }
  }

  return {
    provider: "opencode",
    models,
    warnings,
  }
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function getRecordString(record: unknown, key: string): string | undefined {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function getRecordStringArray(record: unknown, key: string): string[] {
  if (!isRecord(record)) return []
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function getRecordBoolean(record: unknown, key: string): boolean | undefined {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "boolean" ? value : undefined
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

function isPermissionAdapterError(error: unknown): error is ExternalAdapterError {
  return error instanceof ExternalAdapterError && error.code.startsWith("ADAPTER_PERMISSION_")
}

const defaultOpenCodeServer = new ManagedOpenCodeServer()
const defaultOpenCodeClient = new RealOpenCodeClient({
  server: defaultOpenCodeServer,
})
