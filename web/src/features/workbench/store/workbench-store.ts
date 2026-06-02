import { create } from "zustand"

import { useTabStore } from "@/store/tab-store"

import type {
  ActiveRunSnapshot,
  ConversationTimelineRunSnapshot,
  HubRunEventEnvelope,
  PersistedMessage,
} from "../api/messages"
import type { RuntimeRunEvent, RuntimeRunStatus } from "../api/runtime-runs"
import {
  applyRuntimeEventToTimeline,
  createLocalRunStatusItem,
  createLocalUserTimelineItem,
} from "../runtime/timeline-projection"
import type {
  WorkbenchTimelineItem,
  WorkbenchTimelineChatMessageItem,
  WorkbenchTimelinePlanItem,
  WorkbenchTimelineStatus,
} from "../types"

export type RunConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

type ConversationRuntimeState = {
  draft: string
  timelineItems: WorkbenchTimelineItem[]
  activeRuntimeRunId: string | null
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  chatSpeakerIds: Record<string, true>
  receivedEventIds: Set<string>
  events: RuntimeRunEvent[]
}

type WorkbenchStore = {
  activeConversationId: string | null
  conversations: Record<string, ConversationRuntimeState>
  setActiveConversationId: (conversationId: string | null) => void
  setConversationChatSpeakers: (conversationId: string, speakerIds: string[]) => void
  setDraft: (conversationId: string, draft: string) => void
  hydrateTimelineFromReplay: (
    conversationId: string,
    messages: PersistedMessage[],
    timelineRuns: ConversationTimelineRunSnapshot[],
    activeRun: ActiveRunSnapshot | null
  ) => void
  addUserMessage: (conversationId: string, content: string) => WorkbenchTimelineItem[]
  markRunSubmitted: (conversationId: string) => void
  startRuntimeRun: (conversationId: string, runId: string, status: RuntimeRunStatus) => void
  applyHubRunStatus: (
    conversationId: string,
    runId: string,
    status: RuntimeRunStatus
  ) => void
  applyRuntimeEvent: (conversationId: string, event: RuntimeRunEvent) => void
  applyRuntimeEvents: (conversationId: string, events: RuntimeRunEvent[]) => void
  applyRuntimeEventEnvelopes: (
    conversationId: string,
    envelopes: HubRunEventEnvelope[],
    options?: { source?: "live" | "replay" }
  ) => void
  failRunStart: (conversationId: string, message: string, code?: string) => void
  setConnectionStatus: (conversationId: string, status: RunConnectionStatus) => void
  getConversationState: (conversationId: string) => ConversationRuntimeState
}

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"])
const maxEventLogSize = 200

const timelineEventTypes = new Set([
  "message.delta",
  "message.completed",
  "task.started",
  "task.completed",
  "task.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "permission.requested",
  "permission.approved",
  "permission.denied",
  "permission.cancelled",
  "question.requested",
  "question.answered",
  "question.cancelled",
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
  "agent.completed",
  "orchestrator.plan.created",
  "run.completed",
  "run.failed",
  "run.cancelled",
])

const runStatusByEventType: Partial<Record<string, RuntimeRunStatus>> = {
  "run.started": "running",
  "run.completed": "completed",
  "run.cancelled": "cancelled",
  "run.failed": "failed",
  "question.requested": "waiting_input",
  "question.answered": "running",
  "question.cancelled": "running",
}

function createEmptyConversationState(): ConversationRuntimeState {
  return {
    draft: "",
    timelineItems: [],
    activeRuntimeRunId: null,
    runStatus: "idle",
    connectionStatus: "idle",
    chatSpeakerIds: {},
    receivedEventIds: new Set(),
    events: [],
  }
}

function getOrCreateState(
  conversations: Record<string, ConversationRuntimeState>,
  conversationId: string
): ConversationRuntimeState {
  return conversations[conversationId] ?? createEmptyConversationState()
}

export function isTerminalRunStatus(status: RuntimeRunStatus | "idle" | "submitted"): boolean {
  return terminalRunStatuses.has(status)
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  activeConversationId: null,
  conversations: {},

  setActiveConversationId: (conversationId) => {
    set({ activeConversationId: conversationId })
  },

  setConversationChatSpeakers: (conversationId, speakerIds) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            chatSpeakerIds: Object.fromEntries(
              speakerIds.map((speakerId) => [speakerId, true])
            ),
          },
        },
      }
    })
  },

  setDraft: (conversationId, draft) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            draft,
          },
        },
      }
    })
  },

  addUserMessage: (conversationId, content) => {
    const message = createLocalUserTimelineItem(content)

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            draft: "",
            timelineItems: [...current.timelineItems, message],
          },
        },
      }
    })

    return get().getConversationState(conversationId).timelineItems
  },

  markRunSubmitted: (conversationId) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            runStatus: "submitted",
            connectionStatus: "connecting",
          },
        },
      }
    })
  },

  startRuntimeRun: (conversationId, runId, status) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: runId,
            runStatus: status,
            connectionStatus: "connecting",
            receivedEventIds: new Set(),
            events: [],
          },
        },
      }
    })
  },

  applyHubRunStatus: (conversationId, runId, status) => {
    set((state) => {
      const current = state.conversations[conversationId]
      if (!current) return state
      if (
        current.activeRuntimeRunId &&
        current.activeRuntimeRunId !== runId
      ) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: current.activeRuntimeRunId ?? runId,
            runStatus: status,
            connectionStatus: isTerminalRunStatus(status)
              ? "disconnected"
              : current.connectionStatus,
          },
        },
      }
    })
  },

  hydrateTimelineFromReplay: (conversationId, messages, timelineRuns, activeRun) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const activeRuntimeRunId = activeRun?.id ?? null
      const runStatus = activeRun?.status ?? "idle"
      const replayed = replayTimelineRuns(
        timelineRuns,
        messages,
        current.chatSpeakerIds
      )

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId,
            runStatus,
            connectionStatus: activeRun ? current.connectionStatus : "idle",
            timelineItems: replayed.timelineItems,
            receivedEventIds: replayed.receivedEventIds,
            events: replayed.events,
          },
        },
      }
    })
  },

  applyRuntimeEvent: (conversationId, event) => {
    get().applyRuntimeEvents(conversationId, [event])
  },

  applyRuntimeEvents: (conversationId, events) => {
    get().applyRuntimeEventEnvelopes(
      conversationId,
      events.map((event) => ({ sequence: 0, event })),
      { source: "live" }
    )
  },

  applyRuntimeEventEnvelopes: (conversationId, envelopes, options) => {
    if (envelopes.length === 0) return

    const source = options?.source ?? "live"
    let planFocusReasonKey: string | null = null

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const next = applyEnvelopesToRuntimeState(
        current,
        envelopes,
        current.chatSpeakerIds,
        source
      )
      planFocusReasonKey = next.planFocusReasonKey

      if (!next.changed) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId: next.activeRuntimeRunId,
            runStatus: next.runStatus,
            connectionStatus: next.connectionStatus,
            timelineItems: next.timelineItems,
            receivedEventIds: next.receivedEventIds,
            events: next.events,
          },
        },
      }
    })

    if (
      source === "live" &&
      planFocusReasonKey &&
      get().activeConversationId === conversationId
    ) {
      useTabStore.getState().requestWorkspaceFocus({
        tabType: "conversation-status",
        conversationId,
        reason: "plan",
        reasonKey: planFocusReasonKey,
      })
    }
  },

  failRunStart: (conversationId, message, code) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const errorMessage = createLocalRunStatusItem(message, code)

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            runStatus: "failed",
            connectionStatus: "error",
            timelineItems: [...current.timelineItems, errorMessage],
          },
        },
      }
    })
  },

  setConnectionStatus: (conversationId, status) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            connectionStatus: status,
          },
        },
      }
    })
  },

  getConversationState: (conversationId) => {
    return getOrCreateState(get().conversations, conversationId)
  },
}))

function appendEventLog(
  events: RuntimeRunEvent[],
  event: RuntimeRunEvent
): RuntimeRunEvent[] {
  if (events.length >= maxEventLogSize) {
    return [...events.slice(events.length - maxEventLogSize + 1), event]
  }
  return [...events, event]
}

type EnvelopeSource = "live" | "replay"

type EnvelopeApplicationResult = {
  activeRuntimeRunId: string | null
  runStatus: RuntimeRunStatus | "idle" | "submitted"
  connectionStatus: RunConnectionStatus
  timelineItems: WorkbenchTimelineItem[]
  receivedEventIds: Set<string>
  events: RuntimeRunEvent[]
  planFocusReasonKey: string | null
  changed: boolean
}

function replayTimelineRuns(
  timelineRuns: ConversationTimelineRunSnapshot[],
  messages: PersistedMessage[],
  chatSpeakerIds: Record<string, true>
): Pick<ConversationRuntimeState, "timelineItems" | "receivedEventIds" | "events"> {
  let timelineItems: WorkbenchTimelineItem[] = []
  let receivedEventIds = new Set<string>()
  let events: RuntimeRunEvent[] = []
  const persistedMessagesByRunId = groupPersistedChatMessagesByRun(messages)
  const replayedRunIds = new Set<string>()

  for (const timelineRun of sortTimelineRuns(timelineRuns)) {
    replayedRunIds.add(timelineRun.run.id)
    if (timelineRun.triggerMessage) {
      timelineItems = mergePersistedChatMessages(
        timelineItems,
        [timelineRun.triggerMessage]
      )
    }

    const replayState: ConversationRuntimeState = {
      draft: "",
      timelineItems,
      activeRuntimeRunId: null,
      runStatus: "idle",
      connectionStatus: "idle",
      chatSpeakerIds,
      receivedEventIds,
      events,
    }
    const next = applyEnvelopesToRuntimeState(
      replayState,
      withSyntheticTerminalRunEvent(timelineRun),
      chatSpeakerIds,
      "replay"
    )
    timelineItems = next.timelineItems
    receivedEventIds = next.receivedEventIds
    events = next.events
    timelineItems = mergePersistedChatMessages(
      timelineItems,
      persistedMessagesByRunId.get(timelineRun.run.id) ?? []
    )
  }

  const messagesOutsideReplay = sortPersistedChatMessages(messages).filter((message) =>
    !message.runId || !replayedRunIds.has(message.runId)
  )
  timelineItems = mergePersistedChatMessages(timelineItems, messagesOutsideReplay)

  return { timelineItems, receivedEventIds, events }
}

function withSyntheticTerminalRunEvent(
  timelineRun: ConversationTimelineRunSnapshot
): HubRunEventEnvelope[] {
  const status = timelineRun.run.status
  if (!isTerminalRunStatus(status)) {
    return timelineRun.events
  }

  const terminalType = `run.${status}`
  if (timelineRun.events.some((envelope) => envelope.event.type === terminalType)) {
    return timelineRun.events
  }

  const lastSequence = timelineRun.events.at(-1)?.sequence ?? 0
  return [
    ...timelineRun.events,
    {
      sequence: lastSequence + 1,
      event: {
        id: `local-replay-terminal:${timelineRun.run.id}:${status}`,
        runId: timelineRun.run.id,
        runtimeRunId: timelineRun.run.runtimeId,
        type: terminalType,
        timestamp: new Date().toISOString(),
        data: {
          status,
          reason: "terminal_run_snapshot",
        },
      },
    },
  ]
}

function applyEnvelopesToRuntimeState(
  current: ConversationRuntimeState,
  envelopes: HubRunEventEnvelope[],
  chatSpeakerIds: Record<string, true>,
  source: EnvelopeSource
): EnvelopeApplicationResult {
  let activeRuntimeRunId = current.activeRuntimeRunId
  let runStatus = current.runStatus
  let connectionStatus = current.connectionStatus
  let timelineItems = current.timelineItems
  let eventLog = current.events
  let planFocusReasonKey: string | null = null
  let changed = false
  const receivedEventIds = new Set(current.receivedEventIds)

  for (const envelope of sortEnvelopes(envelopes)) {
    const event = envelope.event
    if (receivedEventIds.has(event.id)) {
      continue
    }

    receivedEventIds.add(event.id)
    activeRuntimeRunId = activeRuntimeRunId ?? event.runId
    changed = true

    const nextRunStatus = runStatusByEventType[event.type]
    if (nextRunStatus && nextRunStatus !== runStatus) {
      runStatus = nextRunStatus
      if (isTerminalRunStatus(nextRunStatus)) {
        connectionStatus = "disconnected"
      }
    }

    const shouldProject = timelineEventTypes.has(event.type)
    if (!shouldProject) {
      continue
    }

    eventLog = appendEventLog(eventLog, event)
    const previousPlanSignature = getLatestPlanSignature(timelineItems)
    const nextTimelineItems = applyRuntimeEventToTimeline(
      timelineItems,
      event,
      chatSpeakerIds
    )

    if (nextTimelineItems !== timelineItems) {
      const nextPlanSignature = getLatestPlanSignature(nextTimelineItems)
      if (
        source === "live" &&
        nextPlanSignature &&
        nextPlanSignature !== previousPlanSignature
      ) {
        planFocusReasonKey = nextPlanSignature
      }
      timelineItems = nextTimelineItems
    }
  }

  return {
    activeRuntimeRunId,
    runStatus,
    connectionStatus,
    timelineItems,
    receivedEventIds,
    events: eventLog,
    planFocusReasonKey,
    changed,
  }
}

function sortTimelineRuns(
  timelineRuns: ConversationTimelineRunSnapshot[]
): ConversationTimelineRunSnapshot[] {
  return [...timelineRuns].sort((left, right) => {
    const leftTime = Date.parse(left.triggerMessage?.createdAt ?? left.run.createdAt)
    const rightTime = Date.parse(right.triggerMessage?.createdAt ?? right.run.createdAt)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return left.run.id.localeCompare(right.run.id)
  })
}

function sortEnvelopes(envelopes: HubRunEventEnvelope[]): HubRunEventEnvelope[] {
  return envelopes
    .map((envelope, index) => ({ envelope, index }))
    .sort((left, right) => {
      if (left.envelope.sequence !== right.envelope.sequence) {
        return left.envelope.sequence - right.envelope.sequence
      }
      return left.index - right.index
    })
    .map(({ envelope }) => envelope)
}

function getLatestPlanSignature(items: WorkbenchTimelineItem[]): string | null {
  const plan = items.findLast(
    (item): item is WorkbenchTimelinePlanItem => item.kind === "plan"
  )
  if (!plan) return null

  return JSON.stringify({
    id: plan.id,
    runId: plan.runId,
    title: plan.title,
    description: plan.description,
    status: plan.status,
    tasks: plan.tasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      targetAgentId: task.targetAgentId,
      status: task.status,
    })),
  })
}

function toTimelineItemFromPersistedMessage(
  message: PersistedMessage
): WorkbenchTimelineItem[] {
  if (message.surface !== "chat") return []
  if (message.role !== "user" && message.role !== "assistant") return []

  const text = message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")

  if (!text && message.role === "assistant" && message.status !== "streaming") {
    return []
  }

  const runtimeMessageId = getPersistedRuntimeMessageId(message)
  const item: WorkbenchTimelineChatMessageItem = {
    kind: "chat_message",
    id: getPersistedTimelineMessageId(message, runtimeMessageId),
    role: message.role,
    runId: message.runId ?? undefined,
    runtimeMessageId: runtimeMessageId ?? undefined,
    messageIndex: message.messageIndex ?? undefined,
    agentId: message.agentId ?? undefined,
    text,
    time: formatPersistedMessageTime(message.createdAt),
    status: toTimelineStatus(message.status, message.role),
  }
  const externalModel = getPersistedExternalModel(message)
  return [externalModel ? { ...item, externalModel } : item]
}

function groupPersistedChatMessagesByRun(
  messages: PersistedMessage[]
): Map<string, PersistedMessage[]> {
  const groups = new Map<string, PersistedMessage[]>()
  for (const message of sortPersistedChatMessages(messages)) {
    if (!isPersistedChatMessage(message) || !message.runId) continue
    const current = groups.get(message.runId) ?? []
    current.push(message)
    groups.set(message.runId, current)
  }
  return groups
}

function mergePersistedChatMessages(
  items: WorkbenchTimelineItem[],
  messages: PersistedMessage[]
): WorkbenchTimelineItem[] {
  let nextItems = items

  for (const message of sortPersistedChatMessages(messages)) {
    const [persistedItem] = toTimelineItemFromPersistedMessage(message)
    if (!persistedItem || persistedItem.kind !== "chat_message") continue

    const existingIndex = findMatchingChatMessageIndex(nextItems, persistedItem)
    if (existingIndex < 0) {
      nextItems = [...nextItems, persistedItem]
      continue
    }

    const existing = nextItems[existingIndex]
    if (existing?.kind !== "chat_message") continue
    const merged = mergePersistedChatMessage(existing, persistedItem)
    if (merged !== existing) {
      nextItems = nextItems.map((item, index) =>
        index === existingIndex ? merged : item
      )
    }
  }

  return nextItems
}

function mergePersistedChatMessage(
  current: WorkbenchTimelineChatMessageItem,
  persisted: WorkbenchTimelineChatMessageItem
): WorkbenchTimelineChatMessageItem {
  if (current.role !== persisted.role) return current

  const persistedIsTerminal =
    persisted.status === "completed" ||
    persisted.status === "failed" ||
    persisted.status === "cancelled"
  const shouldUsePersistedText =
    !current.text ||
    (
      persistedIsTerminal &&
      persisted.text.length > current.text.length
    )
  const nextStatus = getMergedTimelineStatus(current.status, persisted.status)
  const next: WorkbenchTimelineChatMessageItem = {
    ...current,
    runId: current.runId ?? persisted.runId,
    runtimeMessageId: current.runtimeMessageId ?? persisted.runtimeMessageId,
    messageIndex: current.messageIndex ?? persisted.messageIndex,
    agentId: current.agentId ?? persisted.agentId,
    text: shouldUsePersistedText ? persisted.text : current.text,
    status: nextStatus,
    generation: current.generation ?? persisted.generation,
    externalModel: current.externalModel ?? persisted.externalModel,
  }

  return isSameChatMessage(current, next) ? current : next
}

function findMatchingChatMessageIndex(
  items: WorkbenchTimelineItem[],
  message: WorkbenchTimelineChatMessageItem
): number {
  return items.findIndex((item) => {
    if (item.kind !== "chat_message") return false
    if (item.id === message.id) return true
    return Boolean(
      item.runId &&
      message.runId &&
      item.runtimeMessageId &&
      message.runtimeMessageId &&
      item.runId === message.runId &&
      item.runtimeMessageId === message.runtimeMessageId
    )
  })
}

function isPersistedChatMessage(message: PersistedMessage): boolean {
  return message.surface === "chat" &&
    (message.role === "user" || message.role === "assistant")
}

function sortPersistedChatMessages(messages: PersistedMessage[]): PersistedMessage[] {
  return messages.filter(isPersistedChatMessage).sort(comparePersistedMessages)
}

function comparePersistedMessages(
  left: PersistedMessage,
  right: PersistedMessage
): number {
  if (left.runId && right.runId && left.runId === right.runId) {
    const leftSequence = getPersistedMessageOrderSequence(left)
    const rightSequence = getPersistedMessageOrderSequence(right)
    if (leftSequence !== rightSequence) {
      return leftSequence - rightSequence
    }
  }

  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }
  return left.id.localeCompare(right.id)
}

function getPersistedMessageOrderSequence(message: PersistedMessage): number {
  if (typeof message.firstEventSequence === "number") {
    return message.firstEventSequence
  }
  if (message.role === "user") {
    return 0
  }
  if (typeof message.messageIndex === "number") {
    return message.messageIndex + 1
  }
  return Number.MAX_SAFE_INTEGER
}

function getPersistedTimelineMessageId(
  message: PersistedMessage,
  runtimeMessageId: string | null
): string {
  if (message.role === "assistant" && message.runId && runtimeMessageId) {
    return `chat:${message.runId}:${runtimeMessageId}`
  }
  return message.id
}

function getPersistedRuntimeMessageId(message: PersistedMessage): string | null {
  return message.runtimeMessageId ?? getString(getPersistedRuntimeMetadata(message).messageId) ?? null
}

function getPersistedRuntimeMetadata(message: PersistedMessage): Record<string, unknown> {
  return getRecord(message.metadataJson.runtime) ?? {}
}

function getPersistedExternalModel(
  message: PersistedMessage
): WorkbenchTimelineChatMessageItem["externalModel"] | undefined {
  const externalModel = getRecord(getPersistedRuntimeMetadata(message).externalModel)
  if (!externalModel) return undefined

  const provider = getString(externalModel.provider)
  const providerId = getString(externalModel.providerId)
  const modelId = getString(externalModel.modelId)
  if (!provider || !providerId || !modelId) {
    return undefined
  }

  const providerName = getString(externalModel.providerName)
  const modelName = getString(externalModel.modelName)
  return {
    provider,
    providerId,
    modelId,
    ...(providerName ? { providerName } : {}),
    ...(modelName ? { modelName } : {}),
  }
}

function toTimelineStatus(
  status: PersistedMessage["status"],
  role: PersistedMessage["role"]
): WorkbenchTimelineStatus | undefined {
  if (status === "streaming" || status === "completed" || status === "failed" || status === "cancelled") {
    return status
  }
  return role === "user" ? "completed" : undefined
}

function getMergedTimelineStatus(
  current: WorkbenchTimelineStatus | undefined,
  persisted: WorkbenchTimelineStatus | undefined
): WorkbenchTimelineStatus | undefined {
  if (!current) return persisted
  if (!persisted) return current
  if (current === "streaming" && persisted !== "streaming") {
    return persisted
  }
  return current
}

function isSameChatMessage(
  left: WorkbenchTimelineChatMessageItem,
  right: WorkbenchTimelineChatMessageItem
): boolean {
  return left.runId === right.runId &&
    left.runtimeMessageId === right.runtimeMessageId &&
    left.messageIndex === right.messageIndex &&
    left.agentId === right.agentId &&
    left.text === right.text &&
    left.status === right.status &&
    left.generation === right.generation &&
    left.externalModel === right.externalModel
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

function formatPersistedMessageTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
