import { basename, dirname } from "node:path"
import type { TextStreamPart, ToolSet } from "ai"
import { createRunEvent } from "./run-events"
import type { AgentExecutionContext, RunDiagnostics, RunEvent, RunInput } from "./types"

export type ResolvedRunDiagnostics = {
  includeModelStream: boolean
  includeReasoning: boolean
  includeRawModelChunks: boolean
}

export const DEFAULT_RUN_DIAGNOSTICS: ResolvedRunDiagnostics = {
  includeModelStream: true,
  includeReasoning: true,
  includeRawModelChunks: false,
}

type Redaction = {
  value: string
  replacement: string
}

type ToolIdentity = {
  toolCallId?: string
  toolName?: string
}

type ReasoningStreamPart = Extract<TextStreamPart<ToolSet>, {
  type: "reasoning-start" | "reasoning-delta" | "reasoning-end"
}>

export function resolveRunDiagnostics(input: Pick<RunInput, "diagnostics">): ResolvedRunDiagnostics {
  return {
    ...DEFAULT_RUN_DIAGNOSTICS,
    ...input.diagnostics,
  }
}

export class ModelStreamEventBuilder {
  private readonly diagnostics: ResolvedRunDiagnostics
  private readonly reasoningContentById = new Map<string, string>()

  constructor(private readonly context: AgentExecutionContext) {
    this.diagnostics = resolveRunDiagnostics(context.input)
  }

  createEvents(part: TextStreamPart<ToolSet>): RunEvent[] {
    const events: RunEvent[] = []
    const streamEvent = this.createModelStreamPartEvent(part)
    if (streamEvent) {
      events.push(streamEvent)
    }

    const reasoningEvent = this.createReasoningEvent(part)
    if (reasoningEvent) {
      events.push(reasoningEvent)
    }

    return events
  }

  private createModelStreamPartEvent(part: TextStreamPart<ToolSet>): RunEvent | null {
    if (!this.diagnostics.includeModelStream) {
      return null
    }
    if (!this.diagnostics.includeRawModelChunks && part.type === "raw") {
      return null
    }
    if (!this.diagnostics.includeReasoning && isReasoningPart(part)) {
      return null
    }

    return this.attachContextMetadata(
      createRunEvent(this.context.runId, "model.stream.part", this.context.agent.id, {
        partType: part.type,
        part: sanitizeModelStreamPart(part, this.context),
      }),
      part
    )
  }

  private createReasoningEvent(part: TextStreamPart<ToolSet>): RunEvent | null {
    if (!this.diagnostics.includeReasoning || !isReasoningPart(part)) {
      return null
    }

    if (part.type === "reasoning-start") {
      this.reasoningContentById.set(part.id, "")
      return this.attachContextMetadata(
        createRunEvent(this.context.runId, "reasoning.started", this.context.agent.id, {
          reasoningId: part.id,
        }),
        part
      )
    }

    if (part.type === "reasoning-delta") {
      this.reasoningContentById.set(
        part.id,
        `${this.reasoningContentById.get(part.id) ?? ""}${part.text}`
      )
      return this.attachContextMetadata(
        createRunEvent(this.context.runId, "reasoning.delta", this.context.agent.id, {
          reasoningId: part.id,
          delta: part.text,
        }),
        part
      )
    }

    const content = this.reasoningContentById.get(part.id) ?? ""
    this.reasoningContentById.delete(part.id)
    return this.attachContextMetadata(
      createRunEvent(this.context.runId, "reasoning.completed", this.context.agent.id, {
        reasoningId: part.id,
        content,
      }),
      part
    )
  }

  private attachContextMetadata(event: RunEvent, part: TextStreamPart<ToolSet>): RunEvent {
    const toolIdentity = getToolIdentity(part)
    event.taskId = this.context.task?.taskId
    event.parentAgentId = this.context.parentAgentId
    event.parentTaskId = this.context.parentTaskId
    event.groupId = this.context.groupId
    event.toolCallId = toolIdentity.toolCallId
    event.toolName = toolIdentity.toolName
    return event
  }
}

export function sanitizeModelStreamPart(part: TextStreamPart<ToolSet>, context: AgentExecutionContext): unknown {
  const redactions = collectPathRedactions(context)
  return sanitizeJsonValue(part, {
    redactions,
    seen: new WeakSet<object>(),
  })
}

function isReasoningPart(part: TextStreamPart<ToolSet>): part is ReasoningStreamPart {
  return part.type === "reasoning-start" ||
    part.type === "reasoning-delta" ||
    part.type === "reasoning-end"
}

function getToolIdentity(part: TextStreamPart<ToolSet>): ToolIdentity {
  if (part.type === "tool-approval-request") {
    return {
      toolCallId: part.toolCall.toolCallId,
      toolName: part.toolCall.toolName,
    }
  }

  if ("toolCallId" in part) {
    return {
      toolCallId: typeof part.toolCallId === "string" ? part.toolCallId : undefined,
      toolName: "toolName" in part && typeof part.toolName === "string" ? part.toolName : undefined,
    }
  }

  if ("toolName" in part) {
    return {
      toolName: typeof part.toolName === "string" ? part.toolName : undefined,
    }
  }

  return {}
}

function collectPathRedactions(context: AgentExecutionContext): Redaction[] {
  const redactions: Redaction[] = []

  const addPath = (pathValue: string | undefined, replacement: string) => {
    if (!pathValue || pathValue.trim().length < 3) {
      return
    }
    const normalized = pathValue.trim()
    redactions.push({ value: normalized, replacement })
    redactions.push({ value: normalized.replaceAll("\\", "/"), replacement })
    redactions.push({ value: normalized.replaceAll("/", "\\"), replacement })
  }

  addPath(context.input.workspace?.rootPath, "[workspace-root]")

  try {
    addPath(context.workspaceService?.getHandle().rootPath, "[workspace-root]")
    for (const request of context.workspaceService?.listExternalAccessRequests() ?? []) {
      addPath(request.targetPath, "[external-path]")
      addPath(dirname(request.targetPath), "[external-path]")
    }
  } catch {
    // Redaction should never break event delivery.
  }

  const unique = new Map<string, Redaction>()
  for (const redaction of redactions) {
    unique.set(`${redaction.value}\0${redaction.replacement}`, redaction)
  }

  return Array.from(unique.values())
    .filter((redaction) => redaction.value.length > 0)
    .sort((left, right) => right.value.length - left.value.length)
}

function sanitizeString(value: string, redactions: Redaction[]): string {
  return redactions.reduce(
    (current, redaction) => current.replace(
      new RegExp(escapeRegExp(redaction.value), "g"),
      redaction.replacement
    ),
    value
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sanitizeJsonValue(
  value: unknown,
  options: {
    redactions: Redaction[]
    seen: WeakSet<object>
  },
  currentKey?: string
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const sanitized = sanitizeString(value, options.redactions)
    return isPathLikeKey(currentKey) ? redactAbsolutePathValue(sanitized) : sanitized
  }
  if (typeof value === "bigint") {
    return value.toString()
  }
  if (typeof value === "undefined" || typeof value === "symbol" || typeof value === "function") {
    return undefined
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message, options.redactions),
    }
  }
  if (value instanceof Uint8Array) {
    return {
      type: "Uint8Array",
      byteLength: value.byteLength,
    }
  }
  if (value instanceof ArrayBuffer) {
    return {
      type: "ArrayBuffer",
      byteLength: value.byteLength,
    }
  }
  if (Array.isArray(value)) {
    if (options.seen.has(value)) {
      return "[Circular]"
    }
    options.seen.add(value)
    return value.map((item) => sanitizeJsonValue(item, options, currentKey))
  }
  if (typeof value === "object") {
    if (options.seen.has(value)) {
      return "[Circular]"
    }
    options.seen.add(value)

    if (isGeneratedFileLike(value)) {
      return {
        mediaType: value.mediaType,
        base64: value.base64,
        byteLength: value.uint8Array.byteLength,
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const sanitized = sanitizeJsonValue(child, options, key)
      if (typeof sanitized !== "undefined") {
        result[key] = sanitized
      }
    }
    return result
  }

  return String(value)
}

function isPathLikeKey(key: string | undefined): boolean {
  if (!key) {
    return false
  }
  const normalized = key.toLowerCase()
  return normalized.includes("path") ||
    normalized.includes("file") ||
    normalized.includes("root")
}

function redactAbsolutePathValue(value: string): string {
  const trimmed = value.trim()
  const isWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(trimmed)
  const isWindowsUncPath = /^\\\\[^\\]+\\[^\\]+/.test(trimmed)
  const isUnixPath = trimmed.startsWith("/") && !trimmed.startsWith("//")
  if (!isWindowsDrivePath && !isWindowsUncPath && !isUnixPath) {
    return value
  }

  const leafName = basename(trimmed)
  return leafName && leafName !== trimmed
    ? `[absolute-path]/${leafName}`
    : "[absolute-path]"
}

function isGeneratedFileLike(value: object): value is {
  mediaType: string
  base64: string
  uint8Array: Uint8Array
} {
  return "mediaType" in value &&
    "base64" in value &&
    "uint8Array" in value &&
    typeof (value as { mediaType?: unknown }).mediaType === "string" &&
    typeof (value as { base64?: unknown }).base64 === "string" &&
    (value as { uint8Array?: unknown }).uint8Array instanceof Uint8Array
}
