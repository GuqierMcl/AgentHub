import type {
  RuntimeExternalModel,
  RuntimeGeneration,
  RuntimeRunEvent,
} from "../api/runtime-runs"
import type {
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelineItem,
  WorkbenchTimelinePermissionItem,
  WorkbenchTimelinePermissionDetail,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelinePlanTask,
  WorkbenchTimelineQuestion,
  WorkbenchTimelineQuestionAnswer,
  WorkbenchTimelineQuestionItem,
  WorkbenchTimelineReasoningBlock,
  WorkbenchTimelineReasoningItem,
  WorkbenchTimelineRunStatusItem,
  WorkbenchTimelineTaskItem,
  WorkbenchTimelineToolItem,
  Artifact,
} from "../types"
import {
  formatWorkspaceDiffDescription,
  formatWorkspaceDiffMeta,
  formatWorkspaceDiffTitle,
} from "../utils/workspace-diff-copy"

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
    case "question.requested":
      return applyQuestionEvent(items, event, chatSpeakerIds, "pending")
    case "question.answered":
      return applyQuestionEvent(items, event, chatSpeakerIds, "answered")
    case "question.cancelled":
      return applyQuestionEvent(items, event, chatSpeakerIds, "cancelled")
    case "reasoning.started":
      return applyReasoningStarted(items, event, chatSpeakerIds)
    case "reasoning.delta":
      return applyReasoningDelta(items, event, chatSpeakerIds)
    case "reasoning.completed":
      return applyReasoningCompleted(items, event, chatSpeakerIds)
    case "agent.completed":
      return applyAgentCompleted(items, event, chatSpeakerIds)
    case "orchestrator.plan.created":
      return upsertPlanFromEvent(items, event)
    case "run.completed":
      return applyWorkspaceDiffArtifact(
        finalizeTerminalRunItems(items, event, "completed"),
        event,
        "completed"
      )
    case "run.failed":
      return upsertRunStatus(
        applyWorkspaceDiffArtifact(
          finalizeTerminalRunItems(items, event, "failed"),
          event,
          "failed"
        ),
        event,
        "failed"
      )
    case "run.cancelled":
      return upsertRunStatus(
        applyWorkspaceDiffArtifact(
          finalizeTerminalRunItems(items, event, "cancelled"),
          event,
          "cancelled"
        ),
        event,
        "cancelled"
      )
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
  const eventGeneration = getEventGeneration(event)
  const eventExternalModel = getEventExternalModel(event)
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
    mergeChatMessageMetadata(
      update(
        item?.kind === "chat_message"
          ? {
              ...item,
              runtimeMessageId: item.runtimeMessageId ?? event.messageId,
              messageIndex: item.messageIndex ?? event.messageIndex,
              agentId: item.agentId ?? event.agentId,
            }
          : created
      ),
      eventGeneration,
      eventExternalModel
    )
  )
}

function applyAgentCompleted(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds
): WorkbenchTimelineItem[] {
  const generation = getEventGeneration(event)
  if (!generation || !isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return items
  }

  const targetIndex = findLastAssistantMessageIndexForGeneration(items, event, generation)
  if (targetIndex < 0) {
    return items
  }

  return items.map((item, index) =>
    index === targetIndex && item.kind === "chat_message"
      ? mergeChatMessageGeneration(item, generation)
      : item
  )
}

function findLastAssistantMessageIndexForGeneration(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  generation: RuntimeGeneration
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== "chat_message" || item.role !== "assistant") continue
    if (item.runId !== event.runId) continue
    if (event.agentId && item.agentId !== event.agentId) continue
    if (
      generation.executionId &&
      item.generation?.executionId &&
      item.generation.executionId !== generation.executionId
    ) {
      continue
    }
    return index
  }

  return -1
}

function mergeChatMessageGeneration(
  item: WorkbenchTimelineChatMessageItem,
  generation: RuntimeGeneration | undefined
): WorkbenchTimelineChatMessageItem {
  if (!generation) {
    return item
  }
  const nextGeneration = mergeRuntimeGeneration(item.generation, generation)
  return nextGeneration ? { ...item, generation: nextGeneration } : item
}

function mergeChatMessageMetadata(
  item: WorkbenchTimelineChatMessageItem,
  generation: RuntimeGeneration | undefined,
  externalModel: RuntimeExternalModel | undefined
): WorkbenchTimelineChatMessageItem {
  const withGeneration = mergeChatMessageGeneration(item, generation)
  return externalModel ? { ...withGeneration, externalModel } : withGeneration
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
  if (!event.toolCallId || !event.toolName || event.toolName === "run_task" || event.toolName === "question") return items
  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: item.text,
      toolItems: upsertToolNestedItem(item.toolItems, event, status, nextNestedOrder(item)),
    }))
  }

  if (event.taskId || event.parentTaskId) {
    return upsertTaskNestedItem(items, event, (task) => ({
      ...task,
      toolItems: upsertToolNestedItem(task.toolItems, event, status, nextNestedOrder(task)),
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
  if (!event.toolCallId || !event.toolName || event.toolName === "run_task" || event.toolName === "question") return items
  const id = `tool:${event.runId}:${event.toolCallId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "tool" ? item : undefined
    return createToolItem(event, status, current)
  })
}

function createToolItem(
  event: RuntimeRunEvent,
  status: WorkbenchTimelineToolItem["status"],
  current?: WorkbenchTimelineToolItem,
  order?: number
): WorkbenchTimelineToolItem {
  const id = `tool:${event.runId}:${event.toolCallId ?? event.id}`
  const data = getEventDataObject(event)
  const nextStatus = resolveToolStatus(status, current?.status)
  const errorText = nextStatus === "output-error" ? getErrorMessage(data) : undefined

  return {
    kind: "tool",
    id,
    runId: event.runId,
    agentId: event.agentId,
    externalProvider: getString(data.externalProvider) ?? current?.externalProvider,
    toolCallId: event.toolCallId ?? current?.toolCallId ?? id,
    toolName: event.toolName ?? current?.toolName ?? "tool",
    title: getString(data.summary) ?? current?.title ?? event.toolName ?? "Tool",
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status: nextStatus,
    input: data.input ?? data.parameters ?? current?.input,
    output: getToolDisplayOutput(event, data, status, current),
    errorText: errorText ?? current?.errorText,
    order: current?.order ?? order,
  }
}

function resolveToolStatus(
  nextStatus: WorkbenchTimelineToolItem["status"],
  currentStatus?: WorkbenchTimelineToolItem["status"]
): WorkbenchTimelineToolItem["status"] {
  if (currentStatus?.startsWith("output-") && !nextStatus.startsWith("output-")) {
    return currentStatus
  }
  return nextStatus
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

  const output = data.data ?? data.result ?? data.output ?? data.summary ?? data
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
        approved,
        nextNestedOrder(item)
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
        approved,
        nextNestedOrder(task)
      ),
    }))
  }

  return upsertPermission(items, event, status, approved)
}

function createPermissionItem(
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved?: boolean,
  current?: WorkbenchTimelinePermissionItem,
  order?: number
): WorkbenchTimelinePermissionItem {
  const data = getEventDataObject(event)
  const requestData = getRecord(data.data)
  const requestId = getPermissionRequestId(event)
  const externalProvider =
    getString(data.externalProvider) ??
    getString(requestData?.externalProvider) ??
    current?.externalProvider
  const permissionKind =
    getString(data.permissionKind) ??
    getString(requestData?.permissionKind) ??
    current?.permissionKind
  const permissionType =
    getString(data.permissionType) ??
    getString(requestData?.permissionType) ??
    current?.permissionType
  const target = resolvePermissionTarget(data, requestData, event, current)
  const details = createPermissionDetails(data, requestData, event) ?? current?.details
  return {
    kind: "permission",
    id: `permission:${event.runId}:${requestId}`,
    runId: event.runId,
    requestId,
    agentId: event.agentId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    externalProvider,
    permissionKind,
    permissionType,
    target,
    details,
    title: formatPermissionTitle({
      externalProvider,
      permissionKind,
      toolName: event.toolName,
      target,
    }),
    reason: getString(data.reason) ?? getString(data.approvalReason) ?? current?.reason,
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    approved,
    order: current?.order ?? order,
  }
}

function formatPermissionTitle(input: {
  externalProvider?: string
  permissionKind?: string
  toolName?: string
  target?: string
}): string {
  const action = input.permissionKind ?? input.toolName
  if (input.externalProvider === "opencode") {
    return `OpenCode 权限请求${action ? `：${action}` : ""}`
  }
  if (input.toolName) {
    return `Permission required for ${input.toolName}`
  }
  return "Permission required"
}

function resolvePermissionTarget(
  data: Record<string, unknown>,
  requestData: Record<string, unknown> | undefined,
  event: RuntimeRunEvent,
  current?: WorkbenchTimelinePermissionItem
): string | undefined {
  return (
    getString(data.target) ??
    getString(requestData?.command) ??
    getString(data.command) ??
    getString(requestData?.logicalPath) ??
    getString(data.logicalPath) ??
    getString(requestData?.url) ??
    getString(data.url) ??
    getString(requestData?.host) ??
    getString(data.host) ??
    firstString(requestData?.patterns) ??
    firstString(data.patterns) ??
    current?.target ??
    event.toolName
  )
}

function createPermissionDetails(
  data: Record<string, unknown>,
  requestData: Record<string, unknown> | undefined,
  event: RuntimeRunEvent
): WorkbenchTimelinePermissionDetail[] | undefined {
  const approvalReason = getPermissionString(data, requestData, "approvalReason")
  const permissionType = getPermissionString(data, requestData, "permissionType")

  if (
    approvalReason === "deployment_command" ||
    permissionType === "deployment" ||
    event.toolName === "run_deploy_command"
  ) {
    return compactPermissionDetails([
      permissionDetail("服务器", getPermissionString(data, requestData, "serverDisplayName")),
      permissionDetail("用户", getPermissionString(data, requestData, "user")),
      permissionDetail("命令", getPermissionString(data, requestData, "command"), true),
      permissionDetail("工作目录", getPermissionString(data, requestData, "cwd"), true),
      permissionDetail("部署原因", getPermissionString(data, requestData, "reason")),
    ])
  }

  if (
    approvalReason === "bash_command" ||
    permissionType === "command_execute" ||
    event.toolName === "bash"
  ) {
    const matchedRule = getPermissionString(data, requestData, "matchedRule")
    const ruleAction = getPermissionString(data, requestData, "ruleAction")
    return compactPermissionDetails([
      permissionDetail("命令", getPermissionString(data, requestData, "command"), true),
      permissionDetail("工作目录", getPermissionString(data, requestData, "cwd"), true),
      permissionDetail("Shell", getPermissionString(data, requestData, "shell")),
      permissionDetail(
        "规则",
        matchedRule ? `${matchedRule}${ruleAction ? ` -> ${ruleAction}` : ""}` : undefined
      ),
    ])
  }

  if (
    approvalReason === "network_request" ||
    permissionType === "network_access" ||
    event.toolName === "web_fetch"
  ) {
    return compactPermissionDetails([
      permissionDetail("方法", getPermissionString(data, requestData, "method")),
      permissionDetail("URL", getPermissionString(data, requestData, "url"), true),
      permissionDetail("Host", getPermissionString(data, requestData, "host")),
    ])
  }

  const logicalPath = getPermissionString(data, requestData, "logicalPath")
  const accessMode = getPermissionString(data, requestData, "accessMode")
  const targetKind = getPermissionString(data, requestData, "targetKind")
  if (logicalPath || accessMode || targetKind) {
    return compactPermissionDetails([
      permissionDetail("路径", logicalPath, true),
      permissionDetail("访问模式", accessMode),
      permissionDetail("目标类型", targetKind),
      permissionDetail("审批原因", approvalReason),
    ])
  }

  const permissionKind = getPermissionString(data, requestData, "permissionKind")
  const patterns = firstString(requestData?.patterns) ?? firstString(data.patterns)
  return compactPermissionDetails([
    permissionDetail("权限类型", permissionKind ?? permissionType),
    permissionDetail("目标", patterns, true),
    permissionDetail("审批原因", approvalReason),
  ])
}

function getPermissionString(
  data: Record<string, unknown>,
  requestData: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  return getString(requestData?.[key]) ?? getString(data[key])
}

function permissionDetail(
  label: string,
  value: string | undefined,
  code = false
): WorkbenchTimelinePermissionDetail | undefined {
  if (!value) return undefined
  return code ? { label, value, code: true } : { label, value }
}

function compactPermissionDetails(
  details: Array<WorkbenchTimelinePermissionDetail | undefined>
): WorkbenchTimelinePermissionDetail[] | undefined {
  const compacted = details.filter(
    (detail): detail is WorkbenchTimelinePermissionDetail => Boolean(detail)
  )
  return compacted.length > 0 ? compacted : undefined
}

function applyQuestionEvent(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  chatSpeakerIds: ChatSpeakerIds,
  status: WorkbenchTimelineQuestionItem["status"]
): WorkbenchTimelineItem[] {
  if (isChatSpeaker(chatSpeakerIds, event.agentId)) {
    return upsertChatMessage(items, event, (item) => ({
      ...item,
      text: item.text,
      questionItems: upsertQuestionNestedItem(item.questionItems, event, status, nextNestedOrder(item)),
    }))
  }

  if (event.taskId || event.parentTaskId) {
    return upsertTaskNestedItem(items, event, (task) => ({
      ...task,
      questionItems: upsertQuestionNestedItem(task.questionItems, event, status, nextNestedOrder(task)),
    }))
  }

  return upsertQuestion(items, event, status)
}

function upsertQuestion(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: WorkbenchTimelineQuestionItem["status"]
): WorkbenchTimelineItem[] {
  const requestId = getQuestionRequestId(event)
  const id = `question:${event.runId}:${requestId}`

  return upsertItem(items, id, (item) => {
    const current = item?.kind === "question" ? item : undefined
    return createQuestionItem(event, status, current)
  })
}

function createQuestionItem(
  event: RuntimeRunEvent,
  status: WorkbenchTimelineQuestionItem["status"],
  current?: WorkbenchTimelineQuestionItem,
  order?: number
): WorkbenchTimelineQuestionItem {
  const data = getEventDataObject(event)
  const requestId = getQuestionRequestId(event)
  const questions = toQuestionList(data.questions) ?? current?.questions ?? []
  const answers = toQuestionAnswerList(data.answers) ?? current?.answers
  const title = questions[0]?.title ?? current?.title ?? "Question"

  return {
    kind: "question",
    id: `question:${event.runId}:${requestId}`,
    runId: event.runId,
    requestId,
    agentId: event.agentId ?? current?.agentId,
    toolCallId: event.toolCallId ?? current?.toolCallId,
    toolName: event.toolName ?? current?.toolName ?? "question",
    messageId: event.messageId ?? current?.messageId,
    messageIndex: event.messageIndex ?? current?.messageIndex,
    title,
    questions,
    answers,
    time: current?.time ?? formatTimelineTime(new Date(event.timestamp)),
    status,
    order: current?.order ?? order,
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
      reasoningBlocks: upsertReasoningBlock(
        item.reasoningBlocks,
        block,
        delta !== undefined,
        nextNestedOrder(item)
      ),
    }))
  }

  return upsertTaskNestedItem(items, event, (task) => ({
    ...task,
    reasoningBlocks: upsertReasoningBlock(
      task.reasoningBlocks,
      block,
      delta !== undefined,
      nextNestedOrder(task)
    ),
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

function finalizeTerminalRunItems(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: "completed" | "failed" | "cancelled"
): WorkbenchTimelineItem[] {
  const runId = event.runId
  const completedAt = event.timestamp
  return items.map((item) => {
    if ("runId" in item && item.runId !== runId) return item
    if (item.kind === "chat_message" && item.status === "streaming") {
      return {
        ...item,
        status,
        reasoningBlocks: item.reasoningBlocks?.map((block) =>
          completeReasoningBlock(block, completedAt)
        ),
        questionItems: cancelPendingQuestionItems(item.questionItems),
      }
    }
    if (item.kind === "task" && item.status === "running") {
      return {
        ...item,
        status: status === "completed" ? "completed" : "failed",
        reasoningBlocks: item.reasoningBlocks?.map((block) =>
          completeReasoningBlock(block, completedAt)
        ),
        questionItems: cancelPendingQuestionItems(item.questionItems),
      }
    }
    if (item.kind === "question" && item.status === "pending") {
      return { ...item, status: "cancelled" }
    }
    if (item.kind === "reasoning" && item.status === "streaming") {
      return completeReasoningItem(item, completedAt)
    }
    if (item.kind === "chat_message") {
      const questionItems = cancelPendingQuestionItems(item.questionItems)
      return questionItems === item.questionItems ? item : { ...item, questionItems }
    }
    if (item.kind === "task") {
      const questionItems = cancelPendingQuestionItems(item.questionItems)
      return questionItems === item.questionItems ? item : { ...item, questionItems }
    }
    return item
  })
}

function applyWorkspaceDiffArtifact(
  items: WorkbenchTimelineItem[],
  event: RuntimeRunEvent,
  status: "completed" | "failed" | "cancelled"
): WorkbenchTimelineItem[] {
  const artifact = createWorkspaceDiffArtifact(event)
  if (!artifact) return items

  const targetIndex = findWorkspaceDiffArtifactTargetIndex(items, event.runId)
  if (targetIndex < 0) {
    const artifactOnlyMessage: WorkbenchTimelineChatMessageItem = {
      kind: "chat_message",
      id: `chat:${event.runId}:workspace-diff`,
      runId: event.runId,
      role: "assistant",
      text: "",
      time: formatTimelineTime(new Date(event.timestamp)),
      status,
      artifacts: [artifact],
    }
    return [...items, artifactOnlyMessage]
  }

  return items.map((item, index) => {
    if (index !== targetIndex || item.kind !== "chat_message") return item
    return {
      ...item,
      artifacts: upsertArtifact(item.artifacts, artifact),
    }
  })
}

function createWorkspaceDiffArtifact(event: RuntimeRunEvent): Artifact | undefined {
  const workspaceDiff = getRecord(getEventDataObject(event).workspaceDiff)
  if (!workspaceDiff) return undefined

  const changedFileCount = getWorkspaceDiffChangedFileCount(workspaceDiff)
  if (changedFileCount <= 0) return undefined

  return {
    id: `diff:${event.runId}:${event.id}`,
    type: "diff",
    title: formatWorkspaceDiffTitle(),
    description: formatWorkspaceDiffDescription(workspaceDiff, changedFileCount),
    meta: formatWorkspaceDiffArtifactMeta(workspaceDiff, changedFileCount),
    detail: {
      kind: "workspace-diff",
      workspaceDiff,
      ...(resolveWorkspaceDiffPatchText(workspaceDiff) ? {
        patchText: resolveWorkspaceDiffPatchText(workspaceDiff),
      } : {}),
    },
  }
}

function resolveWorkspaceDiffPatchText(
  workspaceDiff: Record<string, unknown>
): string | undefined {
  const patch = getRecord(workspaceDiff.patch)
  const patchText = getString(patch?.text)
  return patchText === undefined ? undefined : patchText
}

function findWorkspaceDiffArtifactTargetIndex(
  items: WorkbenchTimelineItem[],
  runId: string
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === "chat_message" && item.runId === runId && item.role === "assistant") {
      return index
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind === "chat_message" && item.runId === runId) {
      return index
    }
  }

  return -1
}

function upsertArtifact(
  artifacts: Artifact[] | undefined,
  artifact: Artifact
): Artifact[] {
  const current = artifacts ?? []
  const index = current.findIndex((item) => item.id === artifact.id)
  if (index < 0) {
    return [...current, artifact]
  }
  return current.map((item, itemIndex) =>
    itemIndex === index ? artifact : item
  )
}

function getWorkspaceDiffChangedFileCount(
  workspaceDiff: Record<string, unknown>
): number {
  const stats = getRecord(workspaceDiff.stats)
  const fromStats = getNumber(stats?.filesChanged)
  if (fromStats !== undefined) return fromStats
  return Array.isArray(workspaceDiff.changedFiles) ? workspaceDiff.changedFiles.length : 0
}

function formatWorkspaceDiffArtifactMeta(
  workspaceDiff: Record<string, unknown>,
  changedFileCount: number
): string {
  const status = getString(workspaceDiff.status)
  return formatWorkspaceDiffMeta(workspaceDiff, changedFileCount, {
    baselineDirty: workspaceDiff.baselineDirty === true,
    status,
  })
}

function cancelPendingQuestionItems(
  questionItems: WorkbenchTimelineQuestionItem[] | undefined
): WorkbenchTimelineQuestionItem[] | undefined {
  if (!questionItems?.some((question) => question.status === "pending")) {
    return questionItems
  }

  return questionItems.map((question): WorkbenchTimelineQuestionItem =>
    question.status === "pending"
      ? { ...question, status: "cancelled" }
      : question
  )
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
      questionItems: current?.questionItems,
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
  status: WorkbenchTimelineToolItem["status"],
  order: number
): WorkbenchTimelineToolItem[] {
  const id = `tool:${event.runId}:${event.toolCallId ?? event.id}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(currentItems, createToolItem(event, status, current, order))
}

function upsertPermissionNestedItem(
  items: WorkbenchTimelinePermissionItem[] | undefined,
  event: RuntimeRunEvent,
  status: WorkbenchTimelinePermissionItem["status"],
  approved: boolean | undefined,
  order: number
): WorkbenchTimelinePermissionItem[] {
  const id = `permission:${event.runId}:${getPermissionRequestId(event)}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(
    currentItems,
    createPermissionItem(event, status, approved, current, order)
  )
}

function upsertQuestionNestedItem(
  items: WorkbenchTimelineQuestionItem[] | undefined,
  event: RuntimeRunEvent,
  status: WorkbenchTimelineQuestionItem["status"],
  order: number
): WorkbenchTimelineQuestionItem[] {
  const id = `question:${event.runId}:${getQuestionRequestId(event)}`
  const currentItems = items ?? []
  const current = currentItems.find((item) => item.id === id)
  return upsertNestedItem(
    currentItems,
    createQuestionItem(event, status, current, order)
  )
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
      ? mergeReasoningBlock(block, nextBlock, append)
      : block
  )
}

// Next interleave position among a message/task's nested blocks. Assigned once
// on creation so reasoning, tools, permissions and questions render in the real
// order they happened (think -> tool -> think -> tool) rather than bucketed by
// kind. Shared by internal and external (e.g. OpenCode) agent runs.
function nextNestedOrder(parent: {
  reasoningBlocks?: WorkbenchTimelineReasoningBlock[]
  toolItems?: WorkbenchTimelineToolItem[]
  permissionItems?: WorkbenchTimelinePermissionItem[]
  questionItems?: WorkbenchTimelineQuestionItem[]
}): number {
  let max = 0
  const groups = [
    parent.reasoningBlocks,
    parent.toolItems,
    parent.permissionItems,
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

function getQuestionRequestId(event: RuntimeRunEvent): string {
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

function getEventGeneration(event: RuntimeRunEvent): RuntimeGeneration | undefined {
  return toRuntimeGeneration(getEventDataObject(event).generation)
}

function getEventExternalModel(event: RuntimeRunEvent): RuntimeExternalModel | undefined {
  return toRuntimeExternalModel(getEventDataObject(event).externalModel)
}

function toRuntimeGeneration(value: unknown): RuntimeGeneration | undefined {
  const data = getRecord(value)
  if (!data) return undefined

  const generation: RuntimeGeneration = {
    executionId: getString(data.executionId),
    model: toRuntimeGenerationModel(data.model),
    usage: toRuntimeGenerationUsage(data.usage),
    finishReason: getString(data.finishReason),
    durationMs: getNumber(data.durationMs),
  }

  return hasRuntimeGenerationValue(generation) ? generation : undefined
}

function toRuntimeGenerationModel(
  value: unknown
): RuntimeGeneration["model"] | undefined {
  const data = getRecord(value)
  if (!data) return undefined

  const providerId = getString(data.providerId)
  const modelId = getString(data.modelId)
  const providerName = getString(data.providerName)
  const modelName = getString(data.modelName)
  if (!providerId || !modelId || !providerName || !modelName) {
    return undefined
  }

  return {
    providerId,
    modelId,
    providerName,
    modelName,
    modelSourceAgentId: getString(data.modelSourceAgentId),
  }
}

function toRuntimeGenerationUsage(
  value: unknown
): RuntimeGeneration["usage"] | undefined {
  const data = getRecord(value)
  if (!data) return undefined

  const usage: RuntimeGeneration["usage"] = {
    inputTokens: getNumber(data.inputTokens),
    outputTokens: getNumber(data.outputTokens),
    totalTokens: getNumber(data.totalTokens),
    reasoningTokens: getNumber(data.reasoningTokens),
    cachedInputTokens: getNumber(data.cachedInputTokens),
  }

  return Object.values(usage).some((usageValue) => usageValue !== undefined)
    ? usage
    : undefined
}

function toRuntimeExternalModel(value: unknown): RuntimeExternalModel | undefined {
  const data = getRecord(value)
  if (!data) return undefined

  const provider = getString(data.provider)
  const providerId = getString(data.providerId)
  const modelId = getString(data.modelId)
  const providerName = getString(data.providerName)
  const modelName = getString(data.modelName)
  if (!provider || !providerId || !modelId) {
    return undefined
  }

  return {
    provider,
    providerId,
    modelId,
    ...(providerName ? { providerName } : {}),
    ...(modelName ? { modelName } : {}),
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

function hasRuntimeGenerationValue(generation: RuntimeGeneration): boolean {
  return Boolean(
    generation.executionId ||
    generation.model ||
    generation.usage ||
    generation.finishReason ||
    generation.durationMs !== undefined
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

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  return value.find((item): item is string => typeof item === "string" && item.trim().length > 0)
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
