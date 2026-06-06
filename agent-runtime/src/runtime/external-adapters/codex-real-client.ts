import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { createChildLogger } from "../../logger"
import { ExternalAdapterError, type ExternalSessionLink } from "./types"
import type {
  CodexClient,
  CodexExternalModel,
  CodexPromptEvent,
  CodexPromptRequest,
  CodexSessionRequest,
} from "./codex-client"

type CodexSdkLike = {
  startThread(options?: Record<string, unknown>): CodexThreadLike | Promise<CodexThreadLike>
  resumeThread(id: string, options?: Record<string, unknown>): CodexThreadLike | Promise<CodexThreadLike>
}

type CodexThreadLike = {
  id?: string | null
  run?: (input: string, options?: { signal?: AbortSignal }) => Promise<unknown>
  runStreamed?: (input: string, options?: { signal?: AbortSignal }) => Promise<{
    events?: AsyncIterable<unknown>
  }>
}

export type CodexServiceReadiness = {
  available: boolean
  clientMode: "sdk"
  version?: string
  error?: string
}

export type RealCodexClientDependencies = {
  createSdk?: () => CodexSdkLike | Promise<CodexSdkLike>
}

const log = createChildLogger("codex-client")
const requireFromHere = createRequire(import.meta.url)

export class RealCodexClient implements CodexClient {
  private sdkPromise: Promise<CodexSdkLike> | null = null
  private readonly threads = new Map<string, CodexThreadLike>()

  constructor(private readonly dependencies: RealCodexClientDependencies = {}) {}

  async ensureSession(request: CodexSessionRequest): Promise<ExternalSessionLink> {
    const sdk = await this.getSdk()
    const threadOptions = this.createThreadOptions(request.workspaceRootPath)
    const thread = request.providerSessionId && isResumableThreadId(request.providerSessionId)
      ? await sdk.resumeThread(request.providerSessionId, threadOptions)
      : await sdk.startThread(threadOptions)
    const providerSessionId = getThreadId(thread) ?? request.providerSessionId ?? `pending_${request.runId}`

    this.rememberThread(providerSessionId, thread)

    return {
      provider: "codex",
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

  async *streamPrompt(request: CodexPromptRequest): AsyncIterable<CodexPromptEvent> {
    const thread = await this.resolveThread(request)

    try {
      if (typeof thread.runStreamed === "function") {
        yield* this.streamPromptWithEvents(thread, request)
        return
      }

      if (typeof thread.run !== "function") {
        throw new ExternalAdapterError(
          "ADAPTER_PROMPT_FAILED",
          "Codex SDK thread does not expose run or runStreamed",
          { providerSessionId: request.session.providerSessionId }
        )
      }

      const result = await thread.run(request.prompt.content, {
        signal: request.signal,
      })
      if (request.signal.aborted) {
        return
      }

      const providerSessionId = getThreadId(thread)
      if (providerSessionId && providerSessionId !== request.session.providerSessionId) {
        this.rememberThread(providerSessionId, thread)
        yield {
          type: "session.updated",
          providerSessionId,
        }
      }

      const content = extractCodexFinalResponse(result)
      const modelId = extractCodexModelId(result)
      if (content) {
        yield {
          type: "message.delta",
          delta: content,
        }
        yield {
          type: "message.completed",
          content,
          ...(modelId ? { externalModel: toExternalModel(modelId) } : {}),
        }
      }
    } catch (error) {
      if (request.signal.aborted) {
        return
      }
      if (error instanceof ExternalAdapterError) {
        throw error
      }
      log.error(
        {
          externalProvider: "codex",
          runId: request.session.runId,
          conversationId: request.session.conversationId,
          providerSessionId: request.session.providerSessionId,
          error: describeError(error),
        },
        "Codex prompt failed"
      )
      throw new ExternalAdapterError(
        "ADAPTER_PROMPT_FAILED",
        "Codex prompt failed",
        { provider: "codex", cause: describeError(error) }
      )
    }
  }

  private async *streamPromptWithEvents(
    thread: CodexThreadLike,
    request: CodexPromptRequest
  ): AsyncIterable<CodexPromptEvent> {
    const streamed = await thread.runStreamed!(request.prompt.content, {
      signal: request.signal,
    })
    const events = streamed.events
    if (!events) {
      return
    }

    for await (const event of events) {
      if (request.signal.aborted) {
        return
      }

      for (const mapped of convertCodexThreadEvent(event)) {
        if (mapped.type === "session.updated") {
          this.rememberThread(mapped.providerSessionId, thread)
        }
        yield mapped
      }
    }
  }

  private async resolveThread(request: CodexPromptRequest): Promise<CodexThreadLike> {
    const cached = this.threads.get(request.session.providerSessionId)
    if (cached) {
      return cached
    }

    if (!isResumableThreadId(request.session.providerSessionId)) {
      throw new ExternalAdapterError(
        "ADAPTER_SESSION_FAILED",
        "Codex session is not available in the current runtime process",
        { providerSessionId: request.session.providerSessionId }
      )
    }

    const sdk = await this.getSdk()
    const thread = await sdk.resumeThread(
      request.session.providerSessionId,
      this.createThreadOptions(request.cwd)
    )
    this.rememberThread(request.session.providerSessionId, thread)
    return thread
  }

  private rememberThread(providerSessionId: string, thread: CodexThreadLike): void {
    this.threads.set(providerSessionId, thread)
  }

  private async getSdk(): Promise<CodexSdkLike> {
    if (!this.sdkPromise) {
      this.sdkPromise = Promise.resolve(
        this.dependencies.createSdk?.() ?? createDefaultCodexSdk()
      )
    }
    return this.sdkPromise
  }

  private createThreadOptions(workspaceRootPath: string): Record<string, unknown> {
    return {
      workingDirectory: workspaceRootPath,
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
    }
  }
}

export function createDefaultCodexClient(): CodexClient {
  return new RealCodexClient()
}

export function getCodexReadiness(
  dependencies: RealCodexClientDependencies = {}
): CodexServiceReadiness {
  try {
    if (dependencies.createSdk) {
      dependencies.createSdk()
      return {
        available: true,
        clientMode: "sdk",
      }
    }

    const packagePath = requireFromHere.resolve("@openai/codex-sdk/package.json")
    const packageJson = requireFromHere(packagePath) as { version?: string }
    return {
      available: true,
      clientMode: "sdk",
      version: packageJson.version,
    }
  } catch (error) {
    return {
      available: false,
      clientMode: "sdk",
      error: error instanceof Error ? error.message : "Codex SDK is not available",
    }
  }
}

async function createDefaultCodexSdk(): Promise<CodexSdkLike> {
  const sdk = await import("@openai/codex-sdk")
  return new sdk.Codex()
}

function* convertCodexThreadEvent(value: unknown): Iterable<CodexPromptEvent> {
  const event = asRecord(value)
  const type = getString(event?.type)
  if (!event || !type) {
    return
  }

  switch (type) {
    case "thread.started": {
      const providerSessionId = getString(event.thread_id)
      if (providerSessionId) {
        yield {
          type: "session.updated",
          providerSessionId,
        }
      }
      return
    }
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = asRecord(event.item)
      if (!item) {
        return
      }
      yield* convertCodexThreadItem(type, item)
      return
    }
    case "turn.failed": {
      const error = asRecord(event.error)
      throw new ExternalAdapterError(
        "ADAPTER_PROMPT_FAILED",
        getString(error?.message) ?? "Codex turn failed",
        { provider: "codex" }
      )
    }
    case "error":
      throw new ExternalAdapterError(
        "ADAPTER_PROMPT_FAILED",
        getString(event.message) ?? "Codex event stream failed",
        { provider: "codex" }
      )
  }
}

function* convertCodexThreadItem(
  eventType: string,
  item: Record<string, unknown>
): Iterable<CodexPromptEvent> {
  const itemType = getString(item.type)
  const id = getString(item.id) ?? `${itemType ?? "item"}_${randomUUID()}`
  if (!itemType) {
    return
  }

  if (itemType === "agent_message") {
    const text = getString(item.text)
    if (text && eventType === "item.completed") {
      yield {
        type: "message.delta",
        delta: text,
      }
      yield {
        type: "message.completed",
        content: text,
      }
    }
    return
  }

  if (itemType === "reasoning") {
    const text = getString(item.text)
    if (text && eventType === "item.completed") {
      yield {
        type: "reasoning.completed",
        reasoningId: id,
        content: text,
      }
    }
    return
  }

  if (eventType === "item.started") {
    yield {
      type: "tool.started",
      providerToolCallId: id,
      providerToolName: itemType,
      input: summarizeCodexToolInput(item),
      providerExecuted: false,
      providerMetadata: {
        providerItemType: itemType,
      },
    }
    return
  }

  if (eventType !== "item.completed") {
    return
  }

  const failed = isCodexItemFailed(item)
  yield {
    type: failed ? "tool.failed" : "tool.completed",
    providerToolCallId: id,
    providerToolName: itemType,
    input: summarizeCodexToolInput(item),
    ...(failed
      ? { error: summarizeCodexToolError(item) }
      : { output: summarizeCodexToolOutput(item) }),
    providerExecuted: true,
    providerMetadata: {
      providerItemType: itemType,
    },
  }
}

function extractCodexFinalResponse(value: unknown): string {
  const record = asRecord(value)
  const direct = getString(record?.finalResponse) ??
    getString(record?.outputText) ??
    getString(record?.text) ??
    (typeof value === "string" ? value : undefined)
  if (direct) {
    return direct
  }

  const items = Array.isArray(record?.items) ? record.items : []
  const message = [...items].reverse()
    .map((item) => asRecord(item))
    .find((item) => item?.type === "agent_message" && typeof item.text === "string")
  return getString(message?.text) ?? ""
}

function extractCodexModelId(value: unknown): string | undefined {
  const record = asRecord(value)
  return getString(record?.model) ??
    getString(record?.modelId) ??
    getString(record?.model_id)
}

function toExternalModel(modelId: string): CodexExternalModel {
  return {
    provider: "codex",
    providerId: "openai",
    modelId,
  }
}

function isResumableThreadId(value: string): boolean {
  return Boolean(value && !value.startsWith("pending_") && !value.startsWith("fake_"))
}

function getThreadId(thread: CodexThreadLike): string | undefined {
  return typeof thread.id === "string" && thread.id.length > 0 ? thread.id : undefined
}

function isCodexItemFailed(item: Record<string, unknown>): boolean {
  return getString(item.status) === "failed" || item.error !== undefined
}

function summarizeCodexToolInput(item: Record<string, unknown>): unknown {
  switch (item.type) {
    case "command_execution":
      return {
        command: getString(item.command),
      }
    case "mcp_tool_call":
      return {
        server: getString(item.server),
        tool: getString(item.tool),
        arguments: item.arguments,
      }
    case "web_search":
      return {
        query: getString(item.query),
      }
    case "file_change":
      return {
        changes: item.changes,
      }
    default:
      return item
  }
}

function summarizeCodexToolOutput(item: Record<string, unknown>): unknown {
  switch (item.type) {
    case "command_execution":
      return {
        status: getString(item.status),
        exitCode: typeof item.exit_code === "number" ? item.exit_code : undefined,
        output: getString(item.aggregated_output),
      }
    case "file_change":
      return {
        status: getString(item.status),
        changes: item.changes,
      }
    case "mcp_tool_call":
      return {
        status: getString(item.status),
        result: item.result,
      }
    default:
      return item
  }
}

function summarizeCodexToolError(item: Record<string, unknown>): unknown {
  const error = asRecord(item.error)
  return {
    status: getString(item.status),
    message: getString(error?.message) ?? getString(item.message) ?? "Codex item failed",
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
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
