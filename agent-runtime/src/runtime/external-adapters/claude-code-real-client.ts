import {
  query,
  type CanUseTool,
  type SDKMessage,
  type UserDialogRequest,
} from "@anthropic-ai/claude-agent-sdk"
import type { NormalizedQuestionAnswer, QuestionItem } from "../question"
import { ExternalAdapterError, type ExternalSessionLink } from "./types"
import type {
  ClaudeCodeClient,
  ClaudeCodeExternalModel,
  ClaudeCodePromptEvent,
  ClaudeCodePromptRequest,
  ClaudeCodeQuestionRequest,
  ClaudeCodeSessionRequest,
} from "./claude-code-client"

type ToolState = {
  id: string
  name: string
  input?: unknown
  inputJson: string
  emittedInputJson?: string
}

type ToolStateStore = {
  byId: Map<string, ToolState>
  byIndex: Map<number, ToolState>
}

export type ClaudeCodeServiceReadiness = {
  available: boolean
  executableSource: "env" | "sdk-bundled"
  executablePath?: string
}

export class RealClaudeCodeClient implements ClaudeCodeClient {
  async ensureSession(request: ClaudeCodeSessionRequest): Promise<ExternalSessionLink> {
    return {
      provider: "claude-code",
      agentId: request.agentId,
      scope: request.scope,
      providerSessionId: request.providerSessionId ?? `pending_${request.runId}`,
      conversationId: request.conversationId,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      runId: request.runId,
      handoffSummary: request.handoffSummary,
    }
  }

  async *streamPrompt(request: ClaudeCodePromptRequest): AsyncIterable<ClaudeCodePromptEvent> {
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    if (request.signal.aborted) {
      abort()
    } else {
      request.signal.addEventListener("abort", abort, { once: true })
    }

    const toolState = createToolStateStore()
    let emittedDelta = false
    let emittedCompleted = false
    let currentModelId: string | undefined

    try {
      const executablePath = process.env.AGENTHUB_CLAUDE_CODE_EXECUTABLE?.trim()
      const stream = query({
        prompt: request.prompt.content,
        options: {
          cwd: request.cwd,
          abortController,
          includePartialMessages: true,
          permissionMode: "default",
          ...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
          ...(isResumableSessionId(request.session.providerSessionId)
            ? { resume: request.session.providerSessionId }
            : {}),
          canUseTool: this.createPermissionCallback(request),
          onUserDialog: async (dialog, options) => this.handleUserDialog(dialog, options.signal, request),
        },
      })

      for await (const message of stream) {
        if (request.signal.aborted) {
          return
        }

        for (const event of this.convertMessage(message, toolState)) {
          if (event.type === "message.delta") {
            emittedDelta = true
          }
          yield event
        }

        const record = message as Record<string, unknown>
        if (record.type === "system" && record.subtype === "init") {
          const sessionId = getString(record.session_id)
          currentModelId = getString(record.model) ?? currentModelId
          if (sessionId) {
            yield {
              type: "session.updated",
              providerSessionId: sessionId,
              modelId: currentModelId,
            }
          }
        }

        if (record.type === "assistant") {
          const content = extractAssistantText(record)
          const modelId = extractAssistantModel(record) ?? currentModelId
          if (modelId) {
            currentModelId = modelId
          }
          if (content && !emittedDelta) {
            emittedDelta = true
            yield {
              type: "message.delta",
              delta: content,
            }
          }
          if (content && !emittedCompleted) {
            emittedCompleted = true
            yield {
              type: "message.completed",
              content,
              ...(modelId ? { externalModel: toExternalModel(modelId) } : {}),
            }
          }
        }

        if (record.type === "result") {
          const sessionId = getString(record.session_id)
          if (sessionId) {
            yield {
              type: "session.updated",
              providerSessionId: sessionId,
              modelId: currentModelId,
            }
          }

          if (record.subtype !== "success" || record.is_error === true) {
            throw new ExternalAdapterError(
              "ADAPTER_PROMPT_FAILED",
              firstString(record.errors) ?? "Claude Code prompt failed",
              {
                subtype: record.subtype,
                errors: record.errors,
              }
            )
          }

          const content = getString(record.result)
          const modelId = extractModelIdFromUsage(record.modelUsage) ?? currentModelId
          if (content && !emittedCompleted) {
            if (!emittedDelta) {
              yield {
                type: "message.delta",
                delta: content,
              }
            }
            emittedCompleted = true
            yield {
              type: "message.completed",
              content,
              ...(modelId ? { externalModel: toExternalModel(modelId) } : {}),
            }
          }
        }
      }
    } finally {
      request.signal.removeEventListener("abort", abort)
    }
  }

  private createPermissionCallback(request: ClaudeCodePromptRequest): CanUseTool {
    return async (toolName, input, options) => {
      if (!request.permissionHandler) {
        return {
          behavior: "deny",
          message: "Claude Code permission bridge is not available",
          toolUseID: options.toolUseID,
        }
      }

      const decision = await request.permissionHandler({
        providerPermissionId: options.toolUseID,
        permissionKind: toolName,
        input,
        providerToolCallId: options.toolUseID,
        providerMetadata: compactRecord({
          blockedPath: options.blockedPath,
          decisionReason: options.decisionReason,
          title: options.title,
          displayName: options.displayName,
          description: options.description,
          agentID: options.agentID,
        }),
        reason: options.title ?? options.description ?? options.decisionReason,
      })

      if (decision.approved) {
        return {
          behavior: "allow",
          updatedInput: input,
          toolUseID: options.toolUseID,
        }
      }

      return {
        behavior: "deny",
        message: decision.reason ?? `Claude Code ${toolName} permission denied`,
        toolUseID: options.toolUseID,
      }
    }
  }

  private async handleUserDialog(
    dialog: UserDialogRequest,
    signal: AbortSignal,
    request: ClaudeCodePromptRequest
  ) {
    if (!request.questionHandler || signal.aborted || !isAskUserQuestionDialog(dialog.dialogKind)) {
      return { behavior: "cancelled" as const }
    }

    const question = toQuestionItem(dialog)
    const answers = await request.questionHandler({
      providerQuestionId: dialog.toolUseID ?? `dialog_${crypto.randomUUID()}`,
      providerToolCallId: dialog.toolUseID,
      providerMetadata: {
        dialogKind: dialog.dialogKind,
        payload: sanitizeUnknown(dialog.payload),
      },
      questions: [question],
    } satisfies ClaudeCodeQuestionRequest)

    return {
      behavior: "completed" as const,
      result: toUserDialogResult(answers),
    }
  }

  private *convertMessage(
    message: SDKMessage,
    toolState: ToolStateStore
  ): Iterable<ClaudeCodePromptEvent> {
    yield* convertClaudeCodeSdkMessage(message, toolState)
  }
}

export function createDefaultClaudeCodeClient(): ClaudeCodeClient {
  return new RealClaudeCodeClient()
}

export function getClaudeCodeReadiness(): ClaudeCodeServiceReadiness {
  const executablePath = process.env.AGENTHUB_CLAUDE_CODE_EXECUTABLE?.trim()
  if (executablePath) {
    return {
      available: true,
      executableSource: "env",
      executablePath,
    }
  }

  return {
    available: true,
    executableSource: "sdk-bundled",
  }
}

export function convertClaudeCodeSdkMessagesForTest(messages: unknown[]): ClaudeCodePromptEvent[] {
  const toolState = createToolStateStore()
  return messages.flatMap((message) =>
    Array.from(convertClaudeCodeSdkMessage(message as SDKMessage, toolState))
  )
}

function createToolStateStore(): ToolStateStore {
  return {
    byId: new Map(),
    byIndex: new Map(),
  }
}

function* convertClaudeCodeSdkMessage(
  message: SDKMessage,
  toolState: ToolStateStore
): Iterable<ClaudeCodePromptEvent> {
  const record = message as Record<string, unknown>
  if (record.type === "stream_event") {
    yield* convertStreamEvent(record.event, toolState)
    return
  }

  if (record.type === "user") {
    for (const result of extractToolUseResults(record)) {
      const state = toolState.byId.get(result.providerToolCallId)
      yield {
        type: "tool.completed",
        providerToolCallId: result.providerToolCallId,
        providerToolName: state?.name ?? "tool",
        input: state?.input,
        output: result.output,
        providerExecuted: true,
      }
    }
    return
  }

  if (record.type === "system" && record.subtype === "permission_denied") {
    const providerToolCallId = getString(record.tool_use_id) ?? `permission_denied_${crypto.randomUUID()}`
    yield {
      type: "tool.failed",
      providerToolCallId,
      providerToolName: getString(record.tool_name) ?? "tool",
      input: record.tool_input,
      error: {
        code: "permission_denied",
        message: "Claude Code denied tool execution",
        decisionReasonType: record.decision_reason_type,
      },
      providerExecuted: false,
    }
  }
}

function* convertStreamEvent(
  value: unknown,
  toolState: ToolStateStore
): Iterable<ClaudeCodePromptEvent> {
  const event = asRecord(value)
  if (!event) {
    return
  }

  if (event.type === "content_block_start") {
    const block = asRecord(event.content_block)
    if (block?.type === "tool_use") {
      const id = getString(block.id) ?? `tool_${crypto.randomUUID()}`
      const name = getString(block.name) ?? "tool"
      const input = block.input
      const state: ToolState = {
        id,
        name,
        input,
        inputJson: "",
      }
      toolState.byId.set(id, state)
      const index = getNumber(event.index)
      if (index !== undefined) {
        toolState.byIndex.set(index, state)
      }
      yield {
        type: "tool.started",
        providerToolCallId: id,
        providerToolName: name,
        input,
        providerExecuted: false,
      }
    }
    return
  }

  if (event.type === "content_block_delta") {
    const delta = asRecord(event.delta)
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
      yield {
        type: "message.delta",
        delta: delta.text,
      }
    }
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      const index = getNumber(event.index)
      const state = index !== undefined ? toolState.byIndex.get(index) : undefined
      if (!state) {
        return
      }
      state.inputJson += delta.partial_json
      const parsed = parseCompleteJson(state.inputJson)
      if (parsed === undefined) {
        return
      }
      state.input = parsed
      const emittedJson = JSON.stringify(parsed)
      if (state.emittedInputJson === emittedJson) {
        return
      }
      state.emittedInputJson = emittedJson
      yield {
        type: "tool.started",
        providerToolCallId: state.id,
        providerToolName: state.name,
        input: parsed,
        providerExecuted: false,
      }
    }
    return
  }

  if (event.type === "content_block_stop") {
    const index = getNumber(event.index)
    const state = index !== undefined ? toolState.byIndex.get(index) : undefined
    if (!state || !state.inputJson) {
      return
    }
    const parsed = parseCompleteJson(state.inputJson)
    if (parsed === undefined) {
      return
    }
    state.input = parsed
    const emittedJson = JSON.stringify(parsed)
    if (state.emittedInputJson === emittedJson) {
      return
    }
    state.emittedInputJson = emittedJson
    yield {
      type: "tool.started",
      providerToolCallId: state.id,
      providerToolName: state.name,
      input: parsed,
      providerExecuted: false,
    }
  }
}

function extractAssistantText(record: Record<string, unknown>): string {
  const message = asRecord(record.message)
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .map((block) => {
      const item = asRecord(block)
      return item?.type === "text" && typeof item.text === "string" ? item.text : ""
    })
    .filter(Boolean)
    .join("")
}

function extractAssistantModel(record: Record<string, unknown>): string | undefined {
  const message = asRecord(record.message)
  return getString(message?.model)
}

function extractModelIdFromUsage(value: unknown): string | undefined {
  const usage = asRecord(value)
  return usage ? Object.keys(usage)[0] : undefined
}

function toExternalModel(modelId: string): ClaudeCodeExternalModel {
  return {
    provider: "claude-code",
    providerId: "anthropic",
    modelId,
  }
}

function isResumableSessionId(value: string): boolean {
  return Boolean(value && !value.startsWith("pending_") && !value.startsWith("fake_"))
}

function isAskUserQuestionDialog(kind: string): boolean {
  const normalized = kind.replace(/[-_]/g, "").toLowerCase()
  return normalized === "askuserquestion"
}

function toQuestionItem(dialog: UserDialogRequest): QuestionItem {
  const payload = dialog.payload
  const title = getString(payload.title) ?? getString(payload.question) ?? "Claude Code question"
  const body = getString(payload.body) ?? getString(payload.prompt) ?? getString(payload.message) ?? title
  const rawOptions = Array.isArray(payload.options) ? payload.options : []
  const options = rawOptions
    .map((option, index) => {
      if (typeof option === "string") {
        return {
          id: `option_${index + 1}`,
          label: option,
        }
      }
      const record = asRecord(option)
      if (!record) {
        return null
      }
      const label = getString(record.label) ?? getString(record.title) ?? getString(record.value)
      if (!label) {
        return null
      }
      return {
        id: getString(record.id) ?? `option_${index + 1}`,
        label,
        value: getString(record.value),
        description: getString(record.description) ?? getString(record.preview),
      }
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option))

  return {
    id: dialog.toolUseID ?? "claude_code_question",
    title,
    body,
    options: options.length > 0 ? options : [{
      id: "answer",
      label: "Answer",
    }],
    allowCustom: true,
    required: true,
  }
}

function toUserDialogResult(answers: NormalizedQuestionAnswer[]): unknown {
  const first = answers[0]
  const text = first?.answer ?? first?.optionId ?? ""
  return {
    answer: text,
    answers,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string") : undefined
}

function parseCompleteJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function extractToolUseResults(record: Record<string, unknown>): Array<{
  providerToolCallId: string
  output: unknown
}> {
  const results: Array<{
    providerToolCallId: string
    output: unknown
  }> = []
  const message = asRecord(record.message)
  const content = Array.isArray(message?.content) ? message.content : []

  for (const block of content) {
    const item = asRecord(block)
    if (item?.type !== "tool_result") {
      continue
    }
    const providerToolCallId = getString(item.tool_use_id) ?? getString(record.parent_tool_use_id)
    if (!providerToolCallId) {
      continue
    }
    results.push({
      providerToolCallId,
      output: item.content ?? item,
    })
  }

  const parentToolUseId = getString(record.parent_tool_use_id)
  if (results.length === 0 && parentToolUseId && record.tool_use_result !== undefined) {
    results.push({
      providerToolCallId: parentToolUseId,
      output: record.tool_use_result,
    })
  }

  return results
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitizeUnknown)
  }
  const record = asRecord(value)
  if (!record) {
    return value
  }

  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 50)
      .map(([key, inner]) => [key, typeof inner === "string" && inner.length > 1000
        ? `${inner.slice(0, 1000)}...`
        : sanitizeUnknown(inner)])
  )
}
