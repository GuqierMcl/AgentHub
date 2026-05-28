import { runtimeRunsApi, type RuntimeRunEvent } from "../api/runtime-runs"
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
  "model.stream.part",
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

  connect(conversationId: string, runId: string): void {
    const current = this.connections.get(conversationId)
    if (current?.runId === runId) {
      return
    }

    this.disconnect(conversationId, "disconnected")
    useWorkbenchStore.getState().setConnectionStatus(conversationId, "connecting")

    const source = new EventSource(runtimeRunsApi.eventsUrl(runId))
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
        const event = JSON.parse(eventMessage.data) as RuntimeRunEvent
        useWorkbenchStore.getState().applyRuntimeEvent(conversationId, event)
        const nextStatus = useWorkbenchStore.getState().getConversationState(conversationId).runStatus
        if (isTerminalRunStatus(nextStatus)) {
          this.disconnect(conversationId, "disconnected")
        }
      } catch {
        useWorkbenchStore.getState().setConnectionStatus(conversationId, "error")
      }
    }

    source.addEventListener("message", handleEvent)
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
    useWorkbenchStore.getState().setConnectionStatus(conversationId, status)
  }
}

export const runStreamManager = new RunStreamManager()
