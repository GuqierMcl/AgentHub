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
  receivedEventIds: Record<string, true>
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
  failRunStart: (conversationId: string, message: string, code?: string) => void
  setConnectionStatus: (conversationId: string, status: RunConnectionStatus) => void
  getConversationState: (conversationId: string) => ConversationRuntimeState
}

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"])

function createEmptyConversationState(): ConversationRuntimeState {
  return {
    draft: "",
    timelineItems: [],
    activeRuntimeRunId: null,
    runStatus: "idle",
    connectionStatus: "idle",
    chatSpeakerIds: {},
    receivedEventIds: {},
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
            receivedEventIds: {},
            events: [],
          },
        },
      }
    })
  },

  applyRuntimeEvent: (conversationId, event) => {
    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      if (current.receivedEventIds[event.id]) {
        return state
      }

      let next: ConversationRuntimeState = {
        ...current,
        activeRuntimeRunId: current.activeRuntimeRunId ?? event.runId,
        receivedEventIds: {
          ...current.receivedEventIds,
          [event.id]: true,
        },
        events: [...current.events, event],
      }

      if (event.type === "run.started") {
        next = { ...next, runStatus: "running" }
      }

      if (event.type === "run.completed") {
        next = {
          ...next,
          runStatus: "completed",
          connectionStatus: "disconnected",
        }
      }

      if (event.type === "run.cancelled") {
        next = {
          ...next,
          runStatus: "cancelled",
          connectionStatus: "disconnected",
        }
      }

      if (event.type === "run.failed") {
        next = {
          ...next,
          runStatus: "failed",
          connectionStatus: "disconnected",
        }
      }

      next = {
        ...next,
        timelineItems: applyRuntimeEventToTimeline(
          next.timelineItems,
          event,
          next.chatSpeakerIds
        ),
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: next,
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
