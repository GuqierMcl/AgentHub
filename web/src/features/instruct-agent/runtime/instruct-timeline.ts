import type {
  RuntimeExternalModel,
  RuntimeGeneration,
} from "@/features/workbench/api/runtime-runs"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelineQuestion,
  WorkbenchTimelineQuestionAnswer,
  WorkbenchTimelineQuestionItem,
  WorkbenchTimelineReasoningBlock,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineToolItem,
} from "@/features/workbench/types"
import type { InstructRunEvent, InstructSavedAgent } from "../types"

export function formatTimelineTime(date = new Date()): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function createLocalUserTimelineItem(
  content: string
): WorkbenchTimelineChatMessageItem {
  return {
    kind: "chat_message",
    id: `local-user-${crypto.randomUUID()}`,
    role: "user",
    text: content,
    time: formatTimelineTime(),
    status: "completed",
  }
}

export function createLocalRunStatusItem(
  message: string,
  code?: string,
  status: WorkbenchTimelineRunStatusItem["status"] = "failed"
): WorkbenchTimelineRunStatusItem {
  return {
    kind: "run_status",
    id: `local-error-${crypto.randomUUID()}`,
    text: message,
    time: formatTimelineTime(),
    status,
    error: status === "failed"
      ? (code ? `${code}: ${message}` : message)
      : undefined,
  }
}

export function applyInstructRuntimeEventToTimeline(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  switch (event.type) {
    case "message.delta":
      return applyMessageDelta(items, event)
    case "message.completed":
      return applyMessageCompleted(items, event)
    case "reasoning.started":
      return applyReasoningStarted(items, event)
    case "reasoning.delta":
      return applyReasoningDelta(items, event)
    case "reasoning.completed":
      return applyReasoningCompleted(items, event)
    case "tool.started":
      return applyToolEvent(items, event, "input-available")
    case "tool.completed":
      return applyToolEvent(items, event, "output-available")
    case "tool.failed":
      return applyToolEvent(items, event, "output-error")
    case "question.requested":
      return applyQuestionEvent(items, event, "pending")
    case "question.answered":
      return applyQuestionEvent(items, event, "answered")
    case "question.cancelled":
      return applyQuestionEvent(items, event, "cancelled")
    case "run.failed":
      return upsertRunStatus(items, event, "failed")
    case "run.cancelled":
      return upsertRunStatus(items, event, "cancelled")
    default:
      return items
  }
}

export function extractSavedAgent(event: InstructRunEvent): InstructSavedAgent | null {
  if (event.type !== "tool.completed" || event.toolName !== "save_agent") {
    return null
  }

  const data = getRecord(event.data)
  const directAgent = toSavedAgent(data?.agent)
  if (directAgent) return directAgent

  const nestedData = getRecord(data?.data)
  const nestedResult = getRecord(data?.result)
  return toSavedAgent(nestedData?.agent) ?? toSavedAgent(nestedResult?.agent) ?? null
}

function applyMessageDelta(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  const delta = getString(getEventDataObject(event).delta)
  if (!delta) {
    return items
  }

  return upsertChatMessage(items, event, (item) => ({
    ...item,
    text: `${item.text}${delta}`,
    status: "streaming",
  }))
}

function applyMessageCompleted(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  const content = getString(getEventDataObject(event).content)
  return upsertChatMessage(items, event, (item) => ({
    ...item,
    text: content ?? item.text,
    status: "completed",
  }))
}

function upsertChatMessage(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent,
  update: (
    item: WorkbenchTimelineChatMessageItem
  ) => WorkbenchTimelineChatMessageItem
): WorkbenchTimelineItem[] {
  const id = getChatMessageId(event)
  const generation = getEventGeneration(event)
  const externalModel = getEventExternalModel(event)
  const created: WorkbenchTimelineChatMessageItem = {
    kind: "chat_message",
    id,
    runId: event.runId,
    runtimeMessageId: event.messageId,
    messageIndex: event.messageIndex,
    role: "assistant",
    agentId: event.agentId,
    text: "",
    time: formatTimelineTime(new Date(event.timestamp)),
    status: "streaming",
  }

  return upsertItem(items, id, (item) => {
    const next = update(
      item?.kind === "chat_message"
        ? {
            ...item,
            runtimeMessageId: item.runtimeMessageId ?? event.messageId,
            messageIndex: item.messageIndex ?? event.messageIndex,
            agentId: item.agentId ?? event.agentId,
          }
        : created
    )
    return {
      ...next,
      ...(generation ? { generation: mergeRuntimeGeneration(next.generation, generation) } : {}),
      ...(externalModel ? { externalModel } : {}),
    }
  })
}

function applyToolEvent(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent,
  status: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineItem[] {
  if (!event.toolCallId || !event.toolName || event.toolName === "question") {
    return items
  }

  if (event.messageId) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      toolItems: upsertToolNestedItem(item.toolItems, event, status, nextNestedOrder(item)),
    }))
  }

  const id = `tool:${event.runId}:${event.toolCallId}`
  return upsertItem(items, id, (item) => {
    const current = item?.kind === "tool" ? item : undefined
    return createToolItem(event, status, current)
  })
}

function createToolItem(
  event: InstructRunEvent,
  status: WorkbenchTimelineToolItem["status"],
  current?: WorkbenchTimelineToolItem,
  order?: number
): WorkbenchTimelineToolItem {
  const data = getEventDataObject(event)
  return {
    kind: "tool",
    id: `tool:${event.runId}:${event.toolCallId ?? event.id}`,
    runId: event.runId,
    agentId: event.agentId,
    toolCallId: event.toolCallId ?? current?.toolCallId ?? event.id,
    toolName: event.toolName ?? current?.toolName ?? "tool",
    title:
      getString(data.summary) ??
      getString(data.title) ??
      current?.title ??
      event.toolName ??
      "Tool",
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    input: data.input ?? data.parameters ?? current?.input,
    output: status === "output-available"
      ? (data.data ?? data.result ?? data.output ?? current?.output)
      : current?.output,
    errorText: status === "output-error"
      ? (getErrorMessage(data) ?? current?.errorText)
      : current?.errorText,
    order: current?.order ?? order,
  }
}

function applyQuestionEvent(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent,
  status: WorkbenchTimelineQuestionItem["status"]
): WorkbenchTimelineItem[] {
  if (event.messageId) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      questionItems: upsertQuestionNestedItem(
        item.questionItems,
        event,
        status,
        nextNestedOrder(item)
      ),
    }))
  }

  const id = `question:${event.runId}:${getQuestionRequestId(event)}`
  return upsertItem(items, id, (item) => {
    const current = item?.kind === "question" ? item : undefined
    return createQuestionItem(event, status, current)
  })
}

function createQuestionItem(
  event: InstructRunEvent,
  status: WorkbenchTimelineQuestionItem["status"],
  current?: WorkbenchTimelineQuestionItem,
  order?: number
): WorkbenchTimelineQuestionItem {
  const data = getEventDataObject(event)
  const questions = toQuestionList(data.questions) ?? current?.questions ?? []
  const answers = toQuestionAnswerList(data.answers) ?? current?.answers

  return {
    kind: "question",
    id: `question:${event.runId}:${getQuestionRequestId(event)}`,
    runId: event.runId,
    requestId: getQuestionRequestId(event),
    agentId: event.agentId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    messageId: event.messageId,
    messageIndex: event.messageIndex,
    title:
      getString(data.title) ??
      current?.title ??
      "需要补充创建信息",
    questions,
    ...(answers ? { answers } : {}),
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    order: current?.order ?? order,
  }
}

function applyReasoningStarted(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  return upsertReasoning(items, event, false, "streaming")
}

function applyReasoningDelta(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  return upsertReasoning(items, event, true, "streaming")
}

function applyReasoningCompleted(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent
): WorkbenchTimelineItem[] {
  return upsertReasoning(items, event, false, "completed")
}

function upsertReasoning(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent,
  append: boolean,
  status: WorkbenchTimelineReasoningBlock["status"]
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const text = getString(data.delta) ?? getString(data.content) ?? ""
  const reasoningId = getString(data.reasoningId) ?? event.id
  const startedAt = getString(data.startedAt) ?? event.timestamp
  const completedAt = status === "completed"
    ? (getString(data.completedAt) ?? event.timestamp)
    : undefined

  if (event.messageId) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      reasoningBlocks: upsertReasoningBlock(
        item.reasoningBlocks,
        {
          reasoningId,
          messageId: event.messageId,
          messageIndex: event.messageIndex,
          text,
          time: item.time,
          startedAt,
          completedAt,
          status,
        },
        append,
        nextNestedOrder(item)
      ),
    }))
  }

  const id = `reasoning:${event.runId}:${reasoningId}`
  return upsertItem(items, id, (item) => {
    const current = item?.kind === "reasoning" ? item : undefined
    return {
      kind: "reasoning",
      id,
      runId: event.runId,
      reasoningId,
      agentId: event.agentId,
      text: append ? `${current?.text ?? ""}${text}` : (text || current?.text || ""),
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      startedAt: current?.startedAt ?? startedAt,
      completedAt: completedAt ?? current?.completedAt,
      status,
    } satisfies WorkbenchTimelineReasoningItem
  })
}

function upsertRunStatus(
  items: WorkbenchTimelineItem[],
  event: InstructRunEvent,
  status: WorkbenchTimelineRunStatusItem["status"]
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const message = getErrorMessage(data) ?? (status === "cancelled" ? "Run cancelled." : "Run failed.")
  const code = getString(data.code) ?? getString(getRecord(data.error)?.code)
  const id = `run-status:${event.runId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "run_status" ? item : undefined
    return {
      kind: "run_status",
      id,
      runId: event.runId,
      text: current?.text || message,
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status,
      error: status === "failed"
        ? current?.error ?? (code ? `${code}: ${message}` : message)
        : undefined,
    }
  })
}

function upsertItem<T extends WorkbenchTimelineItem>(
  items: WorkbenchTimelineItem[],
  id: string,
  nextItem: (current?: WorkbenchTimelineItem) => T
): WorkbenchTimelineItem[] {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) {
    return [...items, nextItem()]
  }
  return items.map((item, itemIndex) =>
    itemIndex === index ? nextItem(item) : item
  )
}

function upsertNestedItem<T extends { id: string }>(
  items: T[] | undefined,
  nextItem: T
): T[] {
  const currentItems = items ?? []
  const index = currentItems.findIndex((item) => item.id === nextItem.id)
  if (index < 0) {
    return [...currentItems, nextItem]
  }
  return currentItems.map((item, itemIndex) =>
    itemIndex === index ? { ...item, ...nextItem } : item
  )
}

function upsertToolNestedItem(
  items: WorkbenchTimelineToolItem[] | undefined,
  event: InstructRunEvent,
  status: WorkbenchTimelineToolItem["status"],
  order: number
): WorkbenchTimelineToolItem[] {
  const id = `tool:${event.runId}:${event.toolCallId ?? event.id}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(currentItems, createToolItem(event, status, current, order))
}

function upsertQuestionNestedItem(
  items: WorkbenchTimelineQuestionItem[] | undefined,
  event: InstructRunEvent,
  status: WorkbenchTimelineQuestionItem["status"],
  order: number
): WorkbenchTimelineQuestionItem[] {
  const id = `question:${event.runId}:${getQuestionRequestId(event)}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(currentItems, createQuestionItem(event, status, current, order))
}

function upsertReasoningBlock(
  blocks: WorkbenchTimelineReasoningBlock[] | undefined,
  nextBlock: WorkbenchTimelineReasoningBlock,
  append: boolean,
  order: number
): WorkbenchTimelineReasoningBlock[] {
  const currentBlocks = blocks ?? []
  const index = currentBlocks.findIndex((block) =>
    block.reasoningId === nextBlock.reasoningId &&
    block.messageId === nextBlock.messageId
  )
  if (index < 0) {
    return [...currentBlocks, { ...nextBlock, order }]
  }

  return currentBlocks.map((block, blockIndex) =>
    blockIndex === index
      ? {
          ...block,
          ...nextBlock,
          order: block.order ?? order,
          text: append ? `${block.text}${nextBlock.text}` : (nextBlock.text || block.text),
        }
      : block
  )
}

function nextNestedOrder(parent: {
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  toolItems?: WorkbenchTimelineToolItem[]
  questionItems?: WorkbenchTimelineQuestionItem[]
}): number {
  let max = 0
  const groups = [
    parent.reasoningBlocks,
    parent.toolItems,
    parent.questionItems,
  ]
  for (const group of groups) {
    for (const block of group ?? []) {
      if (typeof block.order === "number" && block.order > max) {
        max = block.order
      }
    }
  }
  return max + 1
}

function getChatMessageId(event: InstructRunEvent): string {
  if (event.messageId) {
    return `chat:${event.runId}:${event.messageId}`
  }
  return `chat:${event.runId}:${event.agentId ?? "assistant"}`
}

function getQuestionRequestId(event: InstructRunEvent): string {
  const data = getEventDataObject(event)
  return getString(data.requestId) ?? event.toolCallId ?? event.id
}

function toQuestionList(value: unknown): WorkbenchTimelineQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions = value.flatMap((item, index) => {
    const question = getRecord(item)
    if (!question) return []
    const title = getString(question.title)
    const body = getString(question.body)
    if (!title || !body) return []
    const options = Array.isArray(question.options)
      ? question.options.flatMap((option, optionIndex) => {
          const record = getRecord(option)
          const label = getString(record?.label)
          if (!record || !label) return []
          return [{
            id: getString(record.id) ?? `option_${optionIndex + 1}`,
            label,
            value: getString(record.value),
            description: getString(record.description),
          }]
        })
      : []
    return [{
      id: getString(question.id) ?? `question_${index + 1}`,
      title,
      body,
      options,
      allowCustom: question.allowCustom !== false,
      required: question.required !== false,
    }]
  })

  return questions.length > 0 ? questions : undefined
}

function toQuestionAnswerList(value: unknown): WorkbenchTimelineQuestionAnswer[] | undefined {
  if (!Array.isArray(value)) return undefined
  const answers = value.flatMap((item) => {
    const answer = getRecord(item)
    const questionId = getString(answer?.questionId)
    if (!answer || !questionId) return []
    return [{
      questionId,
      optionId: getString(answer.optionId),
      answer: getString(answer.answer),
      custom: answer.custom === true,
    }]
  })

  return answers.length > 0 ? answers : undefined
}

function toSavedAgent(value: unknown): InstructSavedAgent | null {
  const record = getRecord(value)
  if (!record) return null

  const id = getString(record.id)
  const name = getString(record.name)
  const description = getString(record.description)
  if (!id || !name || !description) {
    return null
  }

  return {
    id,
    name,
    description,
    capabilities: toStringArray(record.capabilities),
    allowedTools: toStringArray(record.allowedTools),
    allowedSubagents: toStringArray(record.allowedSubagents),
    permissionPolicy: getRecord(record.permissionPolicy) ?? {},
    enabled: record.enabled !== false,
    readonly: record.readonly === true,
    createdAt: getString(record.createdAt),
    updatedAt: getString(record.updatedAt),
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

function getEventDataObject(event: InstructRunEvent): Record<string, unknown> {
  return getRecord(event.data) ?? {}
}

function getEventGeneration(event: InstructRunEvent): RuntimeGeneration | undefined {
  const data = getRecord(getEventDataObject(event).generation)
  if (!data) return undefined
  return {
    executionId: getString(data.executionId),
    model: getRecord(data.model)
      ? {
          providerId: getString(getRecord(data.model)?.providerId) ?? "",
          modelId: getString(getRecord(data.model)?.modelId) ?? "",
          providerName: getString(getRecord(data.model)?.providerName) ?? "",
          modelName: getString(getRecord(data.model)?.modelName) ?? "",
          modelSourceAgentId: getString(getRecord(data.model)?.modelSourceAgentId),
        }
      : undefined,
    usage: getRecord(data.usage)
      ? {
          inputTokens: getNumber(getRecord(data.usage)?.inputTokens),
          outputTokens: getNumber(getRecord(data.usage)?.outputTokens),
          totalTokens: getNumber(getRecord(data.usage)?.totalTokens),
          reasoningTokens: getNumber(getRecord(data.usage)?.reasoningTokens),
          cachedInputTokens: getNumber(getRecord(data.usage)?.cachedInputTokens),
        }
      : undefined,
    finishReason: getString(data.finishReason),
    durationMs: getNumber(data.durationMs),
  }
}

function getEventExternalModel(event: InstructRunEvent): RuntimeExternalModel | undefined {
  const data = getRecord(getEventDataObject(event).externalModel)
  if (!data) return undefined
  const provider = getString(data.provider)
  const providerId = getString(data.providerId)
  const modelId = getString(data.modelId)
  if (!provider || !providerId || !modelId) {
    return undefined
  }

  return {
    provider,
    providerId,
    modelId,
    providerName: getString(data.providerName),
    modelName: getString(data.modelName),
  }
}

function mergeRuntimeGeneration(
  current: RuntimeGeneration | undefined,
  next: RuntimeGeneration | undefined
): RuntimeGeneration | undefined {
  if (!current) return next
  if (!next) return current

  return {
    ...current,
    ...next,
    model: next.model ?? current.model,
    usage: next.usage
      ? { ...current.usage, ...next.usage }
      : current.usage,
  }
}

function getErrorMessage(data: Record<string, unknown>): string | undefined {
  const error = getRecord(data.error)
  return (
    getString(data.message) ??
    getString(error?.message) ??
    getString(data.summary)
  )
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined
}
