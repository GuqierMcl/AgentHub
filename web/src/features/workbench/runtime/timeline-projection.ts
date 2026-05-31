import type { RuntimeRunEvent } from "../api/runtime-runs"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelinePlanTask,
  WorkbenchTimelineReasoningBlock,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
} from "../types"

type ChatSpeakerIds = Record<string, true>

const WEB_FETCH_BODY_PREVIEW_CHARS = 12_000
const BASH_OUTPUT_PREVIEW_CHARS = 12_000

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
  code?: string
): WorkbenchTimelineRunStatusItem {
  return {
    kind: "run_status",
    id: `local-error-${crypto.randomUUID()}`,
    text: message,
    time: formatTimelineTime(),
    status: "failed",
    error: code ? `${code}: ${message}` : message,
  }
}

export function applyRuntimeEventToTimeline(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  switch (event.type) {
    case "message.delta":
      return applyMessageDelta(items, event, chatSpeakerIds)
    case "message.completed":
      return applyMessageCompleted(items, event, chatSpeakerIds)
    case "task.started":
      return upsertTask(items, event, "running")
    case "task.completed":
      return upsertTask(items, event, "completed")
    case "task.failed":
      return upsertTask(items, event, "failed")
    case "tool.started":
      return applyToolEvent(items, event, chatSpeakerIds, "input-available")
    case "tool.completed":
      return upsertPlanFromTool(
        applyToolEvent(items, event, chatSpeakerIds, "output-available"),
        event
      )
    case "tool.failed":
      return applyToolEvent(items, event, chatSpeakerIds, "output-error")
    case "permission.requested":
      return applyPermissionEvent(items, event, chatSpeakerIds, "approval-requested")
    case "permission.approved":
      return applyPermissionEvent(items, event, chatSpeakerIds, "approval-responded", true)
    case "permission.denied":
    case "permission.cancelled":
      return applyPermissionEvent(items, event, chatSpeakerIds, "output-denied", false)
    case "reasoning.started":
      return applyReasoningStarted(items, event, chatSpeakerIds)
    case "reasoning.delta":
      return applyReasoningDelta(items, event, chatSpeakerIds)
    case "reasoning.completed":
      return applyReasoningCompleted(items, event, chatSpeakerIds)
    case "orchestrator.plan.created":
      return upsertPlanFromEvent(items, event)
    case "run.completed":
      return completeRunItems(items, event)
    case "run.failed":
      return upsertRunStatus(items, event, "failed")
    case "run.cancelled":
      return upsertRunStatus(items, event, "cancelled")
    default:
      return items
  }
}

function applyMessageDelta(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  const delta = getEventText(event, "delta")
  if (!delta) return items

  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: `${item.text}${delta}`,
      status: "streaming",
    }))
  }

  return appendTaskTranscript(items, event, delta)
}

function applyMessageCompleted(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  const content = getEventText(event, "content")

  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: content || item.text,
      status: "completed",
    }))
  }

  if (!content) return items
  return appendTaskTranscript(items, event, content, true)
}

function upsertChatMessage(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  update: (
    item: WorkbenchTimelineChatMessageItem
  ) => WorkbenchTimelineChatMessageItem
): WorkbenchTimelineItem[] {
  const id = getChatMessageId(event)
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

  return upsertItem(items, id, (item) =>
    update(
      item?.kind === "chat_message"
        ? {
            ...item,
            runtimeMessageId: item.runtimeMessageId ?? event.messageId,
            messageIndex: item.messageIndex ?? event.messageIndex,
            agentId: item.agentId ?? event.agentId,
          }
        : created
    )
  )
}

function upsertTask(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineTaskItem["status"]
): WorkbenchTimelineItem[] {
  const id = getTaskItemId(event)
  const data = getEventDataObject(event)
  const error = status === "failed" ? getErrorMessage(data) : undefined

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "task" ? item : undefined
    const title = getTaskTitle(event, current)
    return {
      kind: "task",
      id,
      runId: event.runId,
      taskId: getTaskId(event),
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      title,
      targetAgentId: getString(data.targetAgentId),
      text: current?.text ?? "",
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status,
      error,
      transcriptMessages: current?.transcriptMessages,
    }
  })
}

function appendTaskTranscript(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  text: string,
  replace = false
): WorkbenchTimelineItem[] {
  const id = getTaskItemId(event)
  return upsertItem(items, id, (item) => {
    const current = item?.kind === "task" ? item : undefined
    const transcriptMessages = event.messageId
      ? updateTaskTranscriptMessages(current?.transcriptMessages, event, text, replace)
      : current?.transcriptMessages
    return {
      kind: "task",
      id,
      runId: event.runId,
      taskId: getTaskId(event),
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      title: `${event.agentId ?? "Agent"} activity`,
      text: event.messageId && transcriptMessages
        ? formatTaskTranscript(transcriptMessages)
        : replace ? text : `${current?.text ?? ""}${text}`,
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status: current?.status ?? "running",
      error: current?.error,
      transcriptMessages,
    }
  })
}

function applyToolEvent(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds,
  status: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineItem[] {
  if (!event.toolCallId || !event.toolName || event.toolName === "run_task") return items
  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: item.text,
      toolItems: upsertToolNestedItem(item.toolItems, event, status),
    }))
  }

  if (event.taskId || event.parentTaskId) {
    return upsertTaskNestedItem(items, event, (task) => ({
      ...task,
      toolItems: upsertToolNestedItem(task.toolItems, event, status),
    }))
  }

  return upsertTool(items, event, status)
}

function updateTaskTranscriptMessages(
  currentMessages: WorkbenchTimelineTaskItem["transcriptMessages"] | undefined,
  event: RuntimeRunEvent,
  text: string,
  replace: boolean
): WorkbenchTimelineTaskItem["transcriptMessages"] | undefined {
  const messageId = event.messageId
  if (!messageId) {
    return currentMessages
  }

  const nextMessages = [...(currentMessages ?? [])]
  const index = nextMessages.findIndex((message) => message.messageId === messageId)
  const currentMessage = index >= 0 ? nextMessages[index] : undefined
  const nextMessage = {
    messageId,
    messageIndex: event.messageIndex,
    text: replace ? text : `${currentMessage?.text ?? ""}${text}`,
  }

  if (index >= 0) {
    nextMessages[index] = nextMessage
  } else {
    nextMessages.push(nextMessage)
  }

  return nextMessages.sort((left, right) => {
    if (typeof left.messageIndex === "number" && typeof right.messageIndex === "number") {
      return left.messageIndex - right.messageIndex
    }
    return 0
  })
}

function formatTaskTranscript(
  messages: NonNullable<WorkbenchTimelineTaskItem["transcriptMessages"]>
): string {
  return messages
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

function upsertTool(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineItem[] {
  if (!event.toolCallId || !event.toolName || event.toolName === "run_task") return items
  const id = `tool:${event.runId}:${event.toolCallId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "tool" ? item : undefined
    return createToolItem(event, status, current)
  })
}

function createToolItem(
  event: RuntimeRunEvent,
  status: WorkbenchTimelineToolItem["status"],
  current?: WorkbenchTimelineToolItem
): WorkbenchTimelineToolItem {
  const id = `tool:${event.runId}:${event.toolCallId ?? event.id}`
  const data = getEventDataObject(event)
  const errorText = status === "output-error" ? getErrorMessage(data) : undefined

  return {
    kind: "tool",
    id,
    runId: event.runId,
    agentId: event.agentId,
    toolCallId: event.toolCallId ?? current?.toolCallId ?? id,
    toolName: event.toolName ?? current?.toolName ?? "tool",
    title: getString(data.summary) ?? current?.title ?? event.toolName ?? "Tool",
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    input: current?.input ?? data.input ?? data.parameters,
    output: getToolDisplayOutput(event, data, status, current),
    errorText: errorText ?? current?.errorText,
  }
}

function getToolDisplayOutput(
  event: RuntimeRunEvent,
  data: Record<string, unknown>,
  status: WorkbenchTimelineToolItem["status"],
  current?: WorkbenchTimelineToolItem
): unknown {
  if (status !== "output-available") {
    return current?.output
  }

  const output = data.data ?? data.result ?? data.summary ?? data
  if (event.toolName === "web_fetch") {
    return formatWebFetchDisplayOutput(output)
  }
  if (event.toolName === "bash") {
    return formatBashDisplayOutput(output)
  }

  return output
}

function formatWebFetchDisplayOutput(output: unknown): unknown {
  const response = getRecord(output)
  if (!response) return output

  const body = response.body
  if (typeof body !== "string") return output

  const bodyCharacters = getNumber(response.bodyCharacters) ?? body.length
  const bodyTruncatedForDisplay =
    body.length > WEB_FETCH_BODY_PREVIEW_CHARS ||
    response.bodyTruncatedForTransport === true
  return {
    ...response,
    body: bodyTruncatedForDisplay
      ? body.slice(0, WEB_FETCH_BODY_PREVIEW_CHARS)
      : body,
    bodyCharacters,
    bodyTruncatedForDisplay,
  }
}

function formatBashDisplayOutput(output: unknown): unknown {
  const response = getRecord(output)
  if (!response) return output

  const stdout = typeof response.stdout === "string" ? response.stdout : ""
  const stderr = typeof response.stderr === "string" ? response.stderr : ""
  const stdoutCharacters = getNumber(response.stdoutCharacters) ?? stdout.length
  const stderrCharacters = getNumber(response.stderrCharacters) ?? stderr.length
  const stdoutTruncatedForDisplay =
    stdout.length > BASH_OUTPUT_PREVIEW_CHARS ||
    response.stdoutTruncatedForUi === true
  const stderrTruncatedForDisplay =
    stderr.length > BASH_OUTPUT_PREVIEW_CHARS ||
    response.stderrTruncatedForUi === true

  return {
    ...response,
    stdout: stdoutTruncatedForDisplay
      ? stdout.slice(0, BASH_OUTPUT_PREVIEW_CHARS)
      : stdout,
    stderr: stderrTruncatedForDisplay
      ? stderr.slice(0, BASH_OUTPUT_PREVIEW_CHARS)
      : stderr,
    stdoutCharacters,
    stderrCharacters,
    stdoutTruncatedForDisplay,
    stderrTruncatedForDisplay,
  }
}

function upsertPermission(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean
): WorkbenchTimelineItem[] {
  const requestId = getPermissionRequestId(event)
  const id = `permission:${event.runId}:${requestId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "permission" ? item : undefined
    return createPermissionItem(event, status, approved, current)
  })
}

function applyPermissionEvent(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean
): WorkbenchTimelineItem[] {
  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: item.text,
      permissionItems: upsertPermissionNestedItem(
        item.permissionItems,
        event,
        status,
        approved
      ),
    }))
  }

  if (event.taskId || event.parentTaskId) {
    return upsertTaskNestedItem(items, event, (task) => ({
      ...task,
      permissionItems: upsertPermissionNestedItem(
        task.permissionItems,
        event,
        status,
        approved
      ),
    }))
  }

  return upsertPermission(items, event, status, approved)
}

function createPermissionItem(
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean,
  current?: WorkbenchTimelinePermissionItem
): WorkbenchTimelinePermissionItem {
  const data = getEventDataObject(event)
  const requestId = getPermissionRequestId(event)
  return {
    kind: "permission",
    id: `permission:${event.runId}:${requestId}`,
    runId: event.runId,
    requestId,
    agentId: event.agentId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    title: event.toolName
      ? `Permission required for ${event.toolName}`
      : "Permission required",
    reason: getString(data.reason) ?? getString(data.approvalReason) ?? current?.reason,
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    approved,
  }
}

function applyReasoningStarted(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  return applyReasoningEvent(items, event, chatSpeakerIds, "streaming")
}

function applyReasoningDelta(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const delta = getString(data.delta) ?? ""
  return applyReasoningEvent(items, event, chatSpeakerIds, "streaming", delta)
}

function applyReasoningCompleted(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  return applyReasoningEvent(
    items,
    event,
    chatSpeakerIds,
    "completed",
    undefined,
    getString(data.content)
  )
}

function applyReasoningEvent(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds,
  status: WorkbenchTimelineReasoningBlock["status"],
  delta?: string,
  content?: string
): WorkbenchTimelineItem[] {
  if (!event.messageId) {
    if (typeof delta === "string") {
      return appendReasoningDelta(items, event)
    }
    return upsertReasoning(items, event, status)
  }

  const block = createReasoningBlock(event, status, delta, content)
  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: item.text,
      reasoningBlocks: upsertReasoningBlock(item.reasoningBlocks, block, delta !== undefined),
    }))
  }

  return upsertTaskNestedItem(items, event, (task) => ({
    ...task,
    reasoningBlocks: upsertReasoningBlock(task.reasoningBlocks, block, delta !== undefined),
  }))
}

function createReasoningBlock(
  event: RuntimeRunEvent,
  status: WorkbenchTimelineReasoningBlock["status"],
  delta?: string,
  content?: string
): WorkbenchTimelineReasoningBlock {
  const data = getEventDataObject(event)
  const startedAt = status === "streaming" ? event.timestamp : undefined
  const completedAt = status === "completed" ? event.timestamp : undefined
  return {
    reasoningId: getString(data.reasoningId) ?? "default",
    messageId: event.messageId,
    messageIndex: event.messageIndex,
    text: content ?? delta ?? "",
    time: formatTimelineTime(new Date(event.timestamp)),
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    status,
  }
}

function upsertReasoning(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineReasoningItem["status"]
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const reasoningId = getString(data.reasoningId) ?? "default"
  const id = `reasoning:${event.runId}:${event.agentId ?? "agent"}:${reasoningId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "reasoning" ? item : undefined
    const startedAt = current?.startedAt ?? (status === "streaming" ? event.timestamp : undefined)
    const completedAt = status === "completed" ? event.timestamp : current?.completedAt
    const duration = current?.duration ?? getReasoningDuration(startedAt, completedAt)
    return {
      kind: "reasoning",
      id,
      runId: event.runId,
      reasoningId,
      agentId: event.agentId,
      text: getString(data.content) ?? current?.text ?? "",
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      startedAt,
      completedAt,
      duration,
      status,
    }
  })
}

function appendReasoningDelta(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const reasoningId = getString(data.reasoningId) ?? "default"
  const id = `reasoning:${event.runId}:${event.agentId ?? "agent"}:${reasoningId}`
  const delta = getString(data.delta) ?? ""

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "reasoning" ? item : undefined
    return {
      kind: "reasoning",
      id,
      runId: event.runId,
      reasoningId,
      agentId: event.agentId,
      text: `${current?.text ?? ""}${delta}`,
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      startedAt: current?.startedAt ?? event.timestamp,
      completedAt: current?.completedAt,
      duration: current?.duration,
      status: "streaming",
    }
  })
}

function upsertPlanFromTool(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent
): WorkbenchTimelineItem[] {
  if (event.toolName !== "write_plan") return items
  const data = getEventDataObject(event)
  const nestedData = getRecord(data.data)
  const plan = getRecord(nestedData?.plan)
  return plan ? upsertPlan(items, event, plan) : items
}

function upsertPlanFromEvent(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const plan = getRecord(data.plan) ?? data
  return upsertPlan(items, event, plan)
}

function upsertPlan(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  plan: Record<string, unknown>
): WorkbenchTimelineItem[] {
  const id = `plan:${event.runId}`
  const tasks = Array.isArray(plan.tasks)
    ? plan.tasks.flatMap(toPlanTask)
    : []

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "plan" ? item : undefined
    const next: WorkbenchTimelinePlanItem = {
      kind: "plan",
      id,
      runId: event.runId,
      agentId: event.agentId,
      title: getString(plan.intent) ?? "Execution plan",
      description:
        getString(plan.summaryInstruction) ??
        getString(plan.summary) ??
        current?.description ??
        "Agent task plan",
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status: "completed",
      tasks,
    }
    return next
  })
}

function completeRunItems(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent
): WorkbenchTimelineItem[] {
  const runId = event.runId
  const completedAt = event.timestamp
  return items.map((item) => {
    if ("runId" in item && item.runId !== runId) return item
    if (item.kind === "chat_message" && item.status === "streaming") {
      return {
        ...item,
        status: "completed",
        reasoningBlocks: item.reasoningBlocks?.map((block) =>
          completeReasoningBlock(block, completedAt)
        ),
      }
    }
    if (item.kind === "task" && item.status === "running") {
      return {
        ...item,
        status: "completed",
        reasoningBlocks: item.reasoningBlocks?.map((block) =>
          completeReasoningBlock(block, completedAt)
        ),
      }
    }
    if (item.kind === "reasoning" && item.status === "streaming") {
      return completeReasoningItem(item, completedAt)
    }
    return item
  })
}

function upsertRunStatus(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineRunStatusItem["status"]
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const message = status === "failed" ? getErrorMessage(data) : "Run cancelled."
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

function upsertTaskNestedItem(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  update: (task: WorkbenchTimelineTaskItem) => WorkbenchTimelineTaskItem
): WorkbenchTimelineItem[] {
  const id = getTaskItemId(event)
  return upsertItem(items, id, (item) => {
    const current = item?.kind === "task" ? item : undefined
    return update({
      kind: "task",
      id,
      runId: event.runId,
      taskId: getTaskId(event),
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      title: getTaskTitle(event, current),
      targetAgentId: current?.targetAgentId,
      text: current?.text ?? "",
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status: current?.status ?? "running",
      error: current?.error,
      transcriptMessages: current?.transcriptMessages,
      reasoningBlocks: current?.reasoningBlocks,
      toolItems: current?.toolItems,
      permissionItems: current?.permissionItems,
    })
  })
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
  event: RuntimeRunEvent,
  status: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineToolItem[] {
  const id = `tool:${event.runId}:${event.toolCallId ?? event.id}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(currentItems, createToolItem(event, status, current))
}

function upsertPermissionNestedItem(
  items: WorkbenchTimelinePermissionItem[] | undefined,
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean
): WorkbenchTimelinePermissionItem[] {
  const id = `permission:${event.runId}:${getPermissionRequestId(event)}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(currentItems, createPermissionItem(event, status, approved, current))
}

function upsertReasoningBlock(
  blocks: WorkbenchTimelineReasoningBlock[] | undefined,
  nextBlock: WorkbenchTimelineReasoningBlock,
  append: boolean
): WorkbenchTimelineReasoningBlock[] {
  const currentBlocks = blocks ?? []
  const index = currentBlocks.findIndex((block) =>
    block.reasoningId === nextBlock.reasoningId &&
    block.messageId === nextBlock.messageId
  )
  if (index < 0) {
    return [...currentBlocks, nextBlock]
  }

  return currentBlocks.map((block, blockIndex) =>
    blockIndex === index
      ? mergeReasoningBlock(block, nextBlock, append)
      : block
  )
}

function mergeReasoningBlock(
  current: WorkbenchTimelineReasoningBlock,
  nextBlock: WorkbenchTimelineReasoningBlock,
  append: boolean
): WorkbenchTimelineReasoningBlock {
  const startedAt = current.startedAt ?? nextBlock.startedAt
  const completedAt = nextBlock.completedAt ?? current.completedAt
  const duration =
    nextBlock.duration ??
    current.duration ??
    getReasoningDuration(startedAt, completedAt)

  return {
    ...current,
    ...nextBlock,
    startedAt,
    completedAt,
    duration,
    text: append ? `${current.text}${nextBlock.text}` : nextBlock.text || current.text,
  }
}

function completeReasoningBlock(
  block: WorkbenchTimelineReasoningBlock,
  completedAt: string
): WorkbenchTimelineReasoningBlock {
  if (block.status === "completed") return block
  const nextCompletedAt = block.completedAt ?? completedAt
  return {
    ...block,
    completedAt: nextCompletedAt,
    duration: block.duration ?? getReasoningDuration(block.startedAt, nextCompletedAt),
    status: "completed",
  }
}

function completeReasoningItem(
  item: WorkbenchTimelineReasoningItem,
  completedAt: string
): WorkbenchTimelineReasoningItem {
  const nextCompletedAt = item.completedAt ?? completedAt
  return {
    ...item,
    completedAt: nextCompletedAt,
    duration: item.duration ?? getReasoningDuration(item.startedAt, nextCompletedAt),
    status: "completed",
  }
}

function getReasoningDuration(
  startedAt?: string,
  completedAt?: string
): number | undefined {
  if (!startedAt || !completedAt) return undefined
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return undefined
  }
  return Math.max(1, Math.ceil((end - start) / 1000))
}

function getChatMessageId(event: RuntimeRunEvent): string {
  if (event.messageId) {
    return `chat:${event.runId}:${event.messageId}`
  }
  return `chat:${event.runId}:${event.agentId ?? "assistant"}:${event.taskId ?? "entry"}`
}

function getTaskItemId(event: RuntimeRunEvent): string {
  return `task:${event.runId}:${getTaskId(event)}`
}

function getTaskId(event: RuntimeRunEvent): string {
  return event.taskId ?? event.parentTaskId ?? `agent-${event.agentId ?? "unknown"}`
}

function getTaskTitle(
  event: RuntimeRunEvent,
  current?: WorkbenchTimelineTaskItem
): string {
  const data = getEventDataObject(event)
  const task = getRecord(data.task)
  return compactTitle(
    getString(task?.title) ??
    getString(data.title) ??
    current?.title ??
    getString(task?.instruction) ??
    getString(data.instruction) ??
    `${event.agentId ?? "Agent"} task`
  )
}

function compactTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim()
  if (normalized.length <= 96) {
    return normalized
  }
  return `${normalized.slice(0, 93)}...`
}

function getPermissionRequestId(event: RuntimeRunEvent): string {
  const data = getEventDataObject(event)
  return getString(data.requestId) ?? event.toolCallId ?? event.id
}

function isChatSpeaker(
  chatSpeakerIds: ChatSpeakerIds,
  agentId?: string
): boolean {
  if (!agentId) return false
  return Boolean(chatSpeakerIds[agentId])
}

function getEventDataObject(event: RuntimeRunEvent): Record<string, unknown> {
  return getRecord(event.data) ?? {}
}

function getEventText(event: RuntimeRunEvent, key: string): string {
  return getString(getEventDataObject(event)[key]) ?? ""
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

function getErrorMessage(data: Record<string, unknown>): string {
  const error = getRecord(data.error)
  return (
    getString(data.message) ??
    getString(error?.message) ??
    getString(data.summary) ??
    "Run failed"
  )
}

function toPlanTask(value: unknown): WorkbenchTimelinePlanTask[] {
  const task = getRecord(value)
  if (!task) return []
  const title = getString(task.title) ?? getString(task.instruction) ?? "task"
  const taskId = getString(task.taskId) ?? getString(task.id) ?? title
  return [{
    taskId,
    title,
    targetAgentId: getString(task.targetAgentId),
    status: getString(task.status),
  }]
}
