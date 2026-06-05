import type { InstructRunEvent, InstructRunStatus } from "../types"
import { instructRunsApi } from "../api/instruct-runs"

const runtimeEventTypes = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "agent.started",
  "agent.completed",
  "reasoning.started",
  "reasoning.delta",
  "reasoning.completed",
  "message.delta",
  "message.completed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "question.requested",
  "question.answered",
  "question.cancelled",
] as const

type ManagedConnection = {
  runId: string
  source: EventSource
  pendingEvents: InstructRunEvent[]
  pendingFlushId: number | null
}

type ConnectHandlers = {
  onOpen?: () => void
  onError?: () => void
  onEvents: (events: InstructRunEvent[]) => void
  getRunStatus?: () => InstructRunStatus | "idle" | "submitted"
  onTerminal?: (status: InstructRunStatus) => void
}

export class InstructStreamManager {
  private connection: ManagedConnection | null = null

  connect(runId: string, handlers: ConnectHandlers): void {
    if (
      this.connection?.runId === runId &&
      this.connection.source.readyState !== EventSource.CLOSED
    ) {
      return
    }

    this.disconnect()

    const source = new EventSource(instructRunsApi.eventsUrl(runId))
    this.connection = {
      runId,
      source,
      pendingEvents: [],
      pendingFlushId: null,
    }

    source.addEventListener("open", () => {
      if (this.connection?.source !== source) return
      handlers.onOpen?.()
    })

    source.addEventListener("error", () => {
      if (this.connection?.source !== source) return
      const status = handlers.getRunStatus?.()
      if (status && isTerminalRunStatus(status)) {
        this.disconnect()
        return
      }
      handlers.onError?.()
    })

    const handleEvent = (eventMessage: MessageEvent<string>) => {
      if (this.connection?.source !== source) return

      try {
        const event = JSON.parse(eventMessage.data) as InstructRunEvent
        this.enqueueEvent(event, handlers)
      } catch {
        handlers.onError?.()
      }
    }

    source.addEventListener("message", handleEvent)
    for (const eventType of runtimeEventTypes) {
      source.addEventListener(eventType, handleEvent)
    }
  }

  disconnect(): void {
    if (!this.connection) {
      return
    }

    if (this.connection.pendingFlushId !== null) {
      cancelScheduledFlush(this.connection.pendingFlushId)
    }
    this.connection.source.close()
    this.connection = null
  }

  private enqueueEvent(event: InstructRunEvent, handlers: ConnectHandlers): void {
    const connection = this.connection
    if (!connection) {
      return
    }

    connection.pendingEvents.push(event)
    if (connection.pendingFlushId !== null) {
      return
    }

    connection.pendingFlushId = scheduleFlush(() => {
      if (this.connection !== connection) {
        return
      }

      connection.pendingFlushId = null
      if (connection.pendingEvents.length === 0) {
        return
      }

      const events = connection.pendingEvents.splice(0, connection.pendingEvents.length)
      handlers.onEvents(events)

      const terminalStatus = getTerminalStatus(events)
      if (terminalStatus) {
        handlers.onTerminal?.(terminalStatus)
        this.disconnect()
      }
    })
  }
}

function getTerminalStatus(events: InstructRunEvent[]): InstructRunStatus | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    switch (events[index]?.type) {
      case "run.completed":
        return "completed"
      case "run.failed":
        return "failed"
      case "run.cancelled":
        return "cancelled"
      default:
        break
    }
  }
  return null
}

function isTerminalRunStatus(status: InstructRunStatus | "idle" | "submitted"): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function scheduleFlush(flush: () => void): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(flush)
  }

  return window.setTimeout(flush, 16)
}

function cancelScheduledFlush(id: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(id)
    return
  }

  window.clearTimeout(id)
}
