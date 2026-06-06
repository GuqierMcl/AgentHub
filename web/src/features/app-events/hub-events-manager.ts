import { queryClient } from "@/lib/query-client"
import type {
  ServiceStatusValue,
  SystemServiceStatusItem,
} from "@/features/app-shell/api/service-status"
import { useServiceStatusStore } from "@/features/app-shell/store/service-status-store"
import { workbenchQueryKeys } from "@/features/workbench/api/query-keys"
import type { RuntimeRunStatus } from "@/features/workbench/api/runtime-runs"
import { isTerminalRunStatus, useWorkbenchStore } from "@/features/workbench/store/workbench-store"
import type { WorkbenchTimelineServiceStatusNoticeItem } from "@/features/workbench/types"

export type HubGlobalEventType =
  | "conversation.updated"
  | "conversation.title.updated"
  | "conversation.last_message.updated"
  | "run.status.changed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "service.status.changed"

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
      case "service.status.changed":
        handleServiceStatusChanged(event)
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

function handleServiceStatusChanged(event: HubGlobalEventEnvelope): void {
  const change = parseServiceStatusChangedData(event.data)
  if (!change) return

  useServiceStatusStore.getState().applyServiceStatusChange(change.service)

  const notice = createServiceStatusNotice(event, change)
  const conversationId = useWorkbenchStore.getState().activeConversationId
  if (!notice || !conversationId) return

  useWorkbenchStore.getState().appendServiceStatusNotice(conversationId, notice)
}

export function createServiceStatusNotice(
  event: Pick<HubGlobalEventEnvelope, "id" | "timestamp">,
  change: {
    previousStatus: ServiceStatusValue
    service: SystemServiceStatusItem
  }
): WorkbenchTimelineServiceStatusNoticeItem | null {
  const { previousStatus, service } = change
  if (!isExternalService(service)) return null

  const previousAvailable = isAvailableServiceStatus(previousStatus)
  const currentAvailable = isAvailableServiceStatus(service.status)
  if (previousAvailable === currentAvailable) return null

  if (!previousAvailable && currentAvailable) {
    return createNotice(event, service, "started", `${service.label} · 已启动`)
  }
  if (service.status === "error") {
    return createNotice(event, service, "error", `${service.label} · 服务异常`)
  }
  if (service.status === "not_integrated") {
    return createNotice(event, service, "closed", `${service.label} · 已关闭`)
  }

  return null
}

function createNotice(
  event: Pick<HubGlobalEventEnvelope, "id" | "timestamp">,
  service: SystemServiceStatusItem & { id: "opencode" | "codex" | "claude-code" },
  status: WorkbenchTimelineServiceStatusNoticeItem["status"],
  text: string
): WorkbenchTimelineServiceStatusNoticeItem {
  return {
    kind: "service_status_notice",
    id: `service-status:${event.id}`,
    serviceId: service.id,
    serviceLabel: service.label,
    status,
    text,
    time: event.timestamp,
  }
}

function parseServiceStatusChangedData(data: Record<string, unknown>): {
  previousStatus: ServiceStatusValue
  service: SystemServiceStatusItem
} | null {
  const previousStatus = getServiceStatus(data.previousStatus)
  const service = getServiceStatusItem(data.service)
  if (!previousStatus || !service) return null
  return { previousStatus, service }
}

function getServiceStatusItem(value: unknown): SystemServiceStatusItem | null {
  if (!value || typeof value !== "object") return null
  const service = value as Record<string, unknown>
  const status = getServiceStatus(service.status)
  if (
    !status ||
    !isSystemServiceId(service.id) ||
    typeof service.label !== "string" ||
    !isServiceKind(service.kind) ||
    typeof service.implemented !== "boolean" ||
    typeof service.checkedAt !== "string"
  ) {
    return null
  }

  return {
    id: service.id,
    label: service.label,
    kind: service.kind,
    status,
    implemented: service.implemented,
    checkedAt: service.checkedAt,
    ...(typeof service.activeWorkspaceCount === "number"
      ? { activeWorkspaceCount: service.activeWorkspaceCount }
      : {}),
    ...(typeof service.pendingWorkspaceCount === "number"
      ? { pendingWorkspaceCount: service.pendingWorkspaceCount }
      : {}),
    ...(isRecord(service.details) ? { details: service.details } : {}),
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function getServiceStatus(value: unknown): ServiceStatusValue | undefined {
  return value === "running" ||
    value === "starting" ||
    value === "idle" ||
    value === "error" ||
    value === "not_integrated"
    ? value
    : undefined
}

function getRunStatus(value: unknown): RuntimeRunStatus | undefined {
  return value === "queued" ||
    value === "running" ||
    value === "waiting_approval" ||
    value === "waiting_input" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : undefined
}

function isAvailableServiceStatus(status: ServiceStatusValue): boolean {
  return status === "running" || status === "starting" || status === "idle"
}

function isSystemServiceId(value: unknown): value is SystemServiceStatusItem["id"] {
  return value === "agent-runtime" ||
    value === "opencode" ||
    value === "codex" ||
    value === "claude-code"
}

function isExternalServiceId(
  value: SystemServiceStatusItem["id"]
): value is "opencode" | "codex" | "claude-code" {
  return value === "opencode" || value === "codex" || value === "claude-code"
}

function isExternalService(
  service: SystemServiceStatusItem
): service is SystemServiceStatusItem & {
  id: "opencode" | "codex" | "claude-code"
  kind: "external-agent"
} {
  return service.kind === "external-agent" && isExternalServiceId(service.id)
}

function isServiceKind(value: unknown): value is SystemServiceStatusItem["kind"] {
  return value === "runtime" || value === "external-agent"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export const hubEventsManager = new HubEventsManager()
