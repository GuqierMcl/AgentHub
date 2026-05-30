import {
  conversationMessagesApi,
  type HubRunEventEnvelope,
} from "../api/messages"
import { queryClient } from "@/lib/query-client"
import { workbenchQueryKeys } from "../api/query-keys"
import { isTerminalRunStatus, useWorkbenchStore } from "../store/workbench-store"

const runtimeEventTypes = [
  "run.started",
  "agent.entry.resolved",
  "agent.started",
  "orchestrator.plan.created",
  "task.group.started",
  "task.group.completed",
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
  "message.delta",
  "message.completed",
  "agent.completed",
  "system_agent.completed",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const

type ManagedConnection = {
  conversationId: string
  runId: string
  source: EventSource
}

class RunStreamManager {
  private connections = new Map<string, ManagedConnection>()
  private pendingEvents = new Map<string, HubRunEventEnvelope[]>()
  private pendingFlushes = new Map<string, number>()

  connect(conversationId: string, runId: string, afterSequence = 0): void {
    const current = this.connections.get(conversationId)
    if (current?.runId === runId) {
      return
    }

    this.disconnect(conversationId, "disconnected")
    useWorkbenchStore.getState().setConnectionStatus(conversationId, "connecting")

    const source = new EventSource(
      conversationMessagesApi.eventsUrl(runId, afterSequence)
    )
    const connection: ManagedConnection = { conversationId, runId, source }
    this.connections.set(conversationId, connection)

    source.addEventListener("open", () => {
      if (this.connections.get(conversationId)?.source !== source) return
      useWorkbenchStore.getState().setConnectionStatus(conversationId, "connected")
    })

    source.addEventListener("error", () => {
      if (this.connections.get(conversationId)?.source !== source) return
      const status = useWorkbenchStore.getState().getConversationState(conversationId).runStatus
      if (isTerminalRunStatus(status)) {
        this.disconnect(conversationId, "disconnected")
        return
      }
      useWorkbenchStore.getState().setConnectionStatus(conversationId, "error")
    })

    const handleEvent = (eventMessage: MessageEvent<string>) => {
      if (this.connections.get(conversationId)?.source !== source) return
      try {
        const envelope = JSON.parse(eventMessage.data) as HubRunEventEnvelope
        handleConversationTitleEvent(conversationId, envelope)
        this.enqueueEvent(conversationId, envelope)
      } catch {
        useWorkbenchStore.getState().setConnectionStatus(conversationId, "error")
      }
    }

    source.addEventListener("message", handleEvent)
    source.addEventListener("run.event", handleEvent)
    for (const eventType of runtimeEventTypes) {
      source.addEventListener(eventType, handleEvent)
    }
  }

  disconnect(
    conversationId: string,
    status: "idle" | "disconnected" = "disconnected"
  ): void {
    const connection = this.connections.get(conversationId)
    if (!connection) return
    connection.source.close()
    this.connections.delete(conversationId)
    this.pendingEvents.delete(conversationId)
    const flushId = this.pendingFlushes.get(conversationId)
    if (flushId !== undefined) {
      this.pendingFlushes.delete(conversationId)
      globalThis.cancelAnimationFrame?.(flushId)
      window.clearTimeout(flushId)
    }
    useWorkbenchStore.getState().setConnectionStatus(conversationId, status)
  }

  private enqueueEvent(conversationId: string, envelope: HubRunEventEnvelope): void {
    const pending = this.pendingEvents.get(conversationId) ?? []
    pending.push(envelope)
    this.pendingEvents.set(conversationId, pending)

    if (this.pendingFlushes.has(conversationId)) {
      return
    }

    const flush = () => {
      this.pendingFlushes.delete(conversationId)
      this.flushEvents(conversationId)
    }
    const flushId = typeof globalThis.requestAnimationFrame === "function"
      ? globalThis.requestAnimationFrame(flush)
      : window.setTimeout(flush, 16)
    this.pendingFlushes.set(conversationId, flushId)
  }

  private flushEvents(conversationId: string): void {
    const envelopes = this.pendingEvents.get(conversationId)
    if (!envelopes?.length) {
      return
    }

    this.pendingEvents.delete(conversationId)
    useWorkbenchStore.getState().applyRuntimeEventEnvelopes(
      conversationId,
      envelopes,
      { source: "live" }
    )

    const nextStatus = useWorkbenchStore.getState().getConversationState(conversationId).runStatus
    if (isTerminalRunStatus(nextStatus)) {
      this.disconnect(conversationId, "disconnected")
    }
  }
}

function handleConversationTitleEvent(
  conversationId: string,
  envelope: HubRunEventEnvelope
): void {
  const event = envelope.event
  const data = getRecord(event.data)
  const result = getRecord(data?.result)
  if (
    event.type !== "system_agent.completed" ||
    event.agentId !== "system:title" ||
    data?.systemAgentId !== "title" ||
    data?.target !== "conversation.title" ||
    typeof result?.title !== "string" ||
    result.title.trim().length === 0
  ) {
    return
  }

  void queryClient.invalidateQueries({
    queryKey: workbenchQueryKeys.conversations.all,
  })
  void queryClient.invalidateQueries({
    queryKey: workbenchQueryKeys.conversations.detail(conversationId),
  })
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined
}

export const runStreamManager = new RunStreamManager()
