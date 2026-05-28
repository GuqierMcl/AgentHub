import { create } from "zustand"

import type { RuntimeRunEvent, RuntimeRunStatus } from "../api/runtime-runs"
import type { WorkbenchMessage } from "../types"

export type RunConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

type ConversationRuntimeState = {
  draft: string
  messages: WorkbenchMessage[]
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
  addUserMessage: (conversationId: string, content: string) => WorkbenchMessage[]
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
    messages: [],
    activeRuntimeRunId: null,
    runStatus: "idle",
    connectionStatus: "idle",
    chatSpeakerIds: {},
    receivedEventIds: {},
    events: [],
  }
}

function formatTime(date = new Date()): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function getOrCreateState(
  conversations: Record<string, ConversationRuntimeState>,
  conversationId: string
): ConversationRuntimeState {
  return conversations[conversationId] ?? createEmptyConversationState()
}

function getEventDataObject(event: RuntimeRunEvent): Record<string, unknown> {
  return typeof event.data === "object" && event.data !== null
    ? event.data as Record<string, unknown>
    : {}
}

function getEventText(event: RuntimeRunEvent, key: string): string {
  const data = getEventDataObject(event)
  return typeof data[key] === "string" ? data[key] : ""
}

function getRunErrorMessage(event: RuntimeRunEvent): string {
  const data = getEventDataObject(event)
  if (typeof data.message === "string") return data.message
  if (
    typeof data.error === "object" &&
    data.error !== null &&
    "message" in data.error &&
    typeof (data.error as { message?: unknown }).message === "string"
  ) {
    return (data.error as { message: string }).message
  }
  return "Run failed"
}

function getRunErrorCode(event: RuntimeRunEvent): string | undefined {
  const data = getEventDataObject(event)
  if (typeof data.code === "string") return data.code
  if (
    typeof data.error === "object" &&
    data.error !== null &&
    "code" in data.error &&
    typeof (data.error as { code?: unknown }).code === "string"
  ) {
    return (data.error as { code: string }).code
  }
  return undefined
}

function getAssistantMessageId(event: RuntimeRunEvent): string {
  const speakerId = event.agentId ?? "assistant"
  const scopeId = event.taskId ?? "entry"
  return `assistant-${event.runId}-${speakerId}-${scopeId}`
}

function isChatSpeaker(state: ConversationRuntimeState, agentId?: string): boolean {
  if (!agentId) return false
  return Boolean(state.chatSpeakerIds[agentId])
}

function upsertAssistantMessage(
  state: ConversationRuntimeState,
  event: RuntimeRunEvent,
  update: (message: WorkbenchMessage) => WorkbenchMessage
): WorkbenchMessage[] {
  const assistantMessageId = getAssistantMessageId(event)
  const existingIndex = state.messages.findIndex((message) => message.id === assistantMessageId)
  if (existingIndex >= 0) {
    return state.messages.map((message, index) =>
      index === existingIndex ? update(message) : message
    )
  }

  const created: WorkbenchMessage = {
    id: assistantMessageId,
    role: "assistant",
    agentId: event.agentId,
    text: "",
    time: formatTime(new Date(event.timestamp)),
    status: "streaming",
  }
  return [...state.messages, update(created)]
}

function appendRunStatusMessage(
  state: ConversationRuntimeState,
  event: RuntimeRunEvent,
  update: (message: WorkbenchMessage) => WorkbenchMessage
): WorkbenchMessage[] {
  const assistantMessageId = `assistant-${event.runId}-run-status`
  const existingIndex = state.messages.findIndex((message) => message.id === assistantMessageId)
  if (existingIndex >= 0) {
    return state.messages.map((message, index) =>
      index === existingIndex ? update(message) : message
    )
  }

  const created: WorkbenchMessage = {
    id: assistantMessageId,
    role: "assistant",
    agentId: event.agentId,
    text: "",
    time: formatTime(new Date(event.timestamp)),
  }
  return [...state.messages, update(created)]
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
    const message: WorkbenchMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: "user",
      text: content,
      time: formatTime(),
      status: "completed",
    }

    set((state) => {
      const current = getOrCreateState(state.conversations, conversationId)
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            draft: "",
            messages: [...current.messages, message],
          },
        },
      }
    })

    return get().getConversationState(conversationId).messages
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

      if (event.type === "message.delta") {
        const delta = getEventText(event, "delta")
        if (isChatSpeaker(next, event.agentId)) {
          next = {
            ...next,
            messages: upsertAssistantMessage(next, event, (message) => ({
              ...message,
              agentId: event.agentId ?? message.agentId,
              text: `${message.text}${delta}`,
              status: "streaming",
            })),
          }
        }
      }

      if (event.type === "message.completed") {
        const content = getEventText(event, "content")
        if (isChatSpeaker(next, event.agentId)) {
          next = {
            ...next,
            messages: upsertAssistantMessage(next, event, (message) => ({
              ...message,
              agentId: event.agentId ?? message.agentId,
              text: content || message.text,
              status: "completed",
            })),
          }
        }
      }

      if (event.type === "run.completed") {
        next = {
          ...next,
          runStatus: "completed",
          connectionStatus: "disconnected",
          messages: next.messages.map((message) =>
            message.id.startsWith(`assistant-${event.runId}-`) && message.status === "streaming"
              ? { ...message, status: "completed" }
              : message
          ),
        }
      }

      if (event.type === "run.cancelled") {
        next = {
          ...next,
          runStatus: "cancelled",
          connectionStatus: "disconnected",
          messages: appendRunStatusMessage(next, event, (message) => ({
            ...message,
            text: message.text || "Run cancelled.",
            status: "cancelled",
          })),
        }
      }

      if (event.type === "run.failed") {
        const message = getRunErrorMessage(event)
        const code = getRunErrorCode(event)
        next = {
          ...next,
          runStatus: "failed",
          connectionStatus: "disconnected",
          messages: appendRunStatusMessage(next, event, (existing) => ({
            ...existing,
            text: existing.text || message,
            status: "failed",
            error: code ? `${code}: ${message}` : message,
          })),
        }
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
      const errorMessage: WorkbenchMessage = {
        id: `local-error-${crypto.randomUUID()}`,
        role: "assistant",
        text: message,
        time: formatTime(),
        status: "failed",
        error: code ? `${code}: ${message}` : message,
      }

      return {
        conversations: {
          ...state.conversations,
          [conversationId]: {
            ...current,
            runStatus: "failed",
            connectionStatus: "error",
            messages: [...current.messages, errorMessage],
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
