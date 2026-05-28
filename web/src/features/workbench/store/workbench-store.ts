import { create } from "zustand"

import type { RuntimeRunEvent, RuntimeRunStatus } from "../api/runtime-runs"
import {
  applyRuntimeEventToTimeline,
  createLocalRunStatusItem,
  createLocalUserTimelineItem,
} from "../runtime/timeline-projection"
import type { WorkbenchTimelineItem } from "../types"

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
  addUserMessage: (conversationId: string, content: string) => WorkbenchTimelineItem[]
  markRunSubmitted: (conversationId: string) => void
  startRuntimeRun: (conversationId: string, runId: string, status: RuntimeRunStatus) => void
  applyRuntimeEvent: (conversationId: string, event: RuntimeRunEvent) => void
  applyRuntimeEvents: (conversationId: string, events: RuntimeRunEvent[]) => void
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

  applyRuntimeEvent: (conversationId, event) => {
    get().applyRuntimeEvents(conversationId, [event])
  },

  applyRuntimeEvents: (conversationId, events) => {
    if (events.length === 0) return

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      let activeRuntimeRunId = current.activeRuntimeRunId
      let runStatus = current.runStatus
      let connectionStatus = current.connectionStatus
      let timelineItems = current.timelineItems
      let eventLog = current.events
      let hasRenderableChange = false

      for (const event of events) {
        if (current.receivedEventIds.has(event.id)) {
          continue
        }

        current.receivedEventIds.add(event.id)
        activeRuntimeRunId = activeRuntimeRunId ?? event.runId

        const nextRunStatus = runStatusByEventType[event.type]
        if (nextRunStatus && nextRunStatus !== runStatus) {
          runStatus = nextRunStatus
          hasRenderableChange = true
          if (isTerminalRunStatus(nextRunStatus)) {
            connectionStatus = "disconnected"
          }
        }

        const shouldProject = timelineEventTypes.has(event.type)
        if (!shouldProject) {
          continue
        }

        eventLog = appendEventLog(eventLog, event)
        hasRenderableChange = true
        const nextTimelineItems = applyRuntimeEventToTimeline(
          timelineItems,
          event,
          current.chatSpeakerIds
        )

        if (nextTimelineItems !== timelineItems) {
          timelineItems = nextTimelineItems
          hasRenderableChange = true
        }
      }

      if (!hasRenderableChange && activeRuntimeRunId === current.activeRuntimeRunId) {
        return state
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            activeRuntimeRunId,
            runStatus,
            connectionStatus,
            timelineItems,
            events: eventLog,
          },
        },
      }
    })
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
