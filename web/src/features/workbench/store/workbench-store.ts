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
  WorkbenchTimelinePlanItem,
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
    timelineRuns: ConversationTimelineRunSnapshot[],
    activeRun: ActiveRunSnapshot | null
  ) => void
  addUserMessage: (conversationId: string, content: string) => WorkbenchTimelineItem[]
  markRunSubmitted: (conversationId: string) => void
  startRuntimeRun: (conversationId: string, runId: string, status: RuntimeRunStatus) => void
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
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
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

  hydrateTimelineFromReplay: (conversationId, timelineRuns, activeRun) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      const activeRuntimeRunId = activeRun?.id ?? null
      const runStatus = activeRun?.status ?? "idle"
      const replayed = replayTimelineRuns(
        timelineRuns,
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
  chatSpeakerIds: Record<string, true>
): Pick<ConversationRuntimeState, "timelineItems" | "receivedEventIds" | "events"> {
  let timelineItems: WorkbenchTimelineItem[] = []
  let receivedEventIds = new Set<string>()
  let events: RuntimeRunEvent[] = []

  for (const timelineRun of sortTimelineRuns(timelineRuns)) {
    if (timelineRun.triggerMessage) {
      timelineItems = [
        ...timelineItems,
        ...toTimelineItemFromPersistedMessage(timelineRun.triggerMessage),
      ]
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
      timelineRun.events,
      chatSpeakerIds,
      "replay"
    )
    timelineItems = next.timelineItems
    receivedEventIds = next.receivedEventIds
    events = next.events
  }

  return { timelineItems, receivedEventIds, events }
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
  if (message.role !== "user") return []

  const text = message.parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")

  return [{
    kind: "chat_message",
    id: message.id,
    role: "user",
    runId: message.runId ?? undefined,
    text,
    time: formatPersistedMessageTime(message.createdAt),
    status: "completed",
  }]
}

function formatPersistedMessageTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
