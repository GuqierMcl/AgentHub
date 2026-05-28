import type { RuntimeRunEvent } from "../api/runtime-runs"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelinePlanTask,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
} from "../types"

type ChatSpeakerIds = Record<string, true>

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
      return upsertTool(items, event, "input-available")
    case "tool.completed":
      return upsertPlanFromTool(upsertTool(items, event, "output-available"), event)
    case "tool.failed":
      return upsertTool(items, event, "output-error")
    case "permission.requested":
      return upsertPermission(items, event, "approval-requested")
    case "permission.approved":
      return upsertPermission(items, event, "approval-responded", true)
    case "permission.denied":
    case "permission.cancelled":
      return upsertPermission(items, event, "output-denied", false)
    case "reasoning.started":
      return upsertReasoning(items, event, "streaming")
    case "reasoning.delta":
      return appendReasoningDelta(items, event)
    case "reasoning.completed":
      return upsertReasoning(items, event, "completed")
    case "orchestrator.plan.created":
      return upsertPlanFromEvent(items, event)
    case "run.completed":
      return completeRunItems(items, event.runId)
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
    role: "assistant",
    agentId: event.agentId,
    text: "",
    time: formatTimelineTime(new Date(event.timestamp)),
    status: "streaming",
  }

  return upsertItem(items, id, (item) =>
    update(
      item?.kind === "chat_message"
        ? item
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
  const title = getString(data.title) ??
    getString(data.summary) ??
    getString(data.instruction) ??
    `${event.agentId ?? "Agent"} task`
  const error = status === "failed" ? getErrorMessage(data) : undefined

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "task" ? item : undefined
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
    return {
      kind: "task",
      id,
      runId: event.runId,
      taskId: getTaskId(event),
      agentId: event.agentId,
      parentAgentId: event.parentAgentId,
      title: `${event.agentId ?? "Agent"} activity`,
      text: replace ? text : `${current?.text ?? ""}${text}`,
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
      status: current?.status ?? "running",
      error: current?.error,
    }
  })
}

function upsertTool(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineItem[] {
  if (!event.toolCallId || !event.toolName) return items
  const id = `tool:${event.runId}:${event.toolCallId}`
  const data = getEventDataObject(event)
  const errorText = status === "output-error" ? getErrorMessage(data) : undefined

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "tool" ? item : undefined
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
      output: status === "output-available"
        ? data.data ?? data.result ?? data.summary ?? data
        : current?.output,
      errorText: errorText ?? current?.errorText,
    }
  })
}

function upsertPermission(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean
): WorkbenchTimelineItem[] {
  const data = getEventDataObject(event)
  const requestId = getString(data.requestId) ?? event.toolCallId ?? event.id
  const id = `permission:${event.runId}:${requestId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "permission" ? item : undefined
    return {
      kind: "permission",
      id,
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
  })
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
    return {
      kind: "reasoning",
      id,
      runId: event.runId,
      reasoningId,
      agentId: event.agentId,
      text: getString(data.content) ?? current?.text ?? "",
      time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
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
  runId: string
): WorkbenchTimelineItem[] {
  return items.map((item) => {
    if ("runId" in item && item.runId !== runId) return item
    if (item.kind === "chat_message" && item.status === "streaming") {
      return { ...item, status: "completed" }
    }
    if (item.kind === "task" && item.status === "running") {
      return { ...item, status: "completed" }
    }
    if (item.kind === "reasoning" && item.status === "streaming") {
      return { ...item, status: "completed" }
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

function getChatMessageId(event: RuntimeRunEvent): string {
  return `chat:${event.runId}:${event.agentId ?? "assistant"}:${event.taskId ?? "entry"}`
}

function getTaskItemId(event: RuntimeRunEvent): string {
  return `task:${event.runId}:${getTaskId(event)}`
}

function getTaskId(event: RuntimeRunEvent): string {
  return event.taskId ?? event.parentTaskId ?? `agent-${event.agentId ?? "unknown"}`
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
