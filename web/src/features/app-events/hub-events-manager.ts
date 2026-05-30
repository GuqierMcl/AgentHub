import { queryClient } from "@/lib/query-client"
import { workbenchQueryKeys } from "@/features/workbench/api/query-keys"
import type { RuntimeRunStatus } from "@/features/workbench/api/runtime-runs"
import { isTerminalRunStatus, useWorkbenchStore } from "@/features/workbench/store/workbench-store"

export type HubGlobalEventType =
  | "conversation.updated"
  | "conversation.title.updated"
  | "conversation.last_message.updated"
  | "run.status.changed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"

export type HubGlobalEventEnvelope = {
  id: string
  type: HubGlobalEventType
  timestamp: string
  data: Record<string, unknown>
}

class HubEventsManager {
  private source: EventSource | null = null

  connect(): void {
    if (this.source) return

    const source = new EventSource("/api/events")
    this.source = source

    source.addEventListener("hub.event", (message) => {
      this.handleMessage(message as MessageEvent<string>)
    })
    source.addEventListener("message", (message) => {
      this.handleMessage(message as MessageEvent<string>)
    })
    source.addEventListener("error", () => {
      // Native EventSource reconnect is enough for v1. Missed events are ignored by design.
    })
  }

  disconnect(): void {
    this.source?.close()
    this.source = null
  }

  private handleMessage(message: MessageEvent<string>): void {
    try {
      this.handleEvent(JSON.parse(message.data) as HubGlobalEventEnvelope)
    } catch {
      // Ignore malformed best-effort notifications.
    }
  }

  private handleEvent(event: HubGlobalEventEnvelope): void {
    switch (event.type) {
      case "conversation.updated":
      case "conversation.title.updated":
      case "conversation.last_message.updated":
        invalidateConversationQueries(getString(event.data.conversationId))
        break
      case "run.status.changed":
      case "run.completed":
      case "run.failed":
      case "run.cancelled":
        handleRunStatusEvent(event.data)
        break
    }
  }
}

function invalidateConversationQueries(conversationId: string | undefined): void {
  void queryClient.invalidateQueries({
    queryKey: workbenchQueryKeys.conversations.all,
  })

  if (!conversationId) return

  void queryClient.invalidateQueries({
    queryKey: workbenchQueryKeys.conversations.detail(conversationId),
  })
}

function handleRunStatusEvent(data: Record<string, unknown>): void {
  const conversationId = getString(data.conversationId)
  const runId = getString(data.runId)
  const status = getRunStatus(data.status)

  if (!conversationId || !runId || !status) return

  useWorkbenchStore.getState().applyHubRunStatus(conversationId, runId, status)

  if (isTerminalRunStatus(status)) {
    void queryClient.invalidateQueries({
      queryKey: workbenchQueryKeys.conversations.messages(conversationId),
    })
    void queryClient.invalidateQueries({
      queryKey: workbenchQueryKeys.conversations.all,
    })
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getRunStatus(value: unknown): RuntimeRunStatus | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "waiting_approval" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : undefined
}

export const hubEventsManager = new HubEventsManager()
