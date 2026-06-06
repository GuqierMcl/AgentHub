import { AppError } from "../lib/errors"
import type { RuntimeClient } from "../lib/runtime"
import { logger } from "../lib/logger"
import type { HubEventBus } from "./hub-event-bus.service"

export type ServiceStatus =
  | "running"
  | "starting"
  | "idle"
  | "error"
  | "not_integrated"

export type SystemServiceStatusItem = {
  id: "agent-runtime" | "opencode" | "codex" | "claude-code"
  label: string
  kind: "runtime" | "external-agent"
  status: ServiceStatus
  implemented: boolean
  checkedAt: string
  activeWorkspaceCount?: number
  pendingWorkspaceCount?: number
  details?: Record<string, unknown>
}

export type SystemServicesStatusResponse = {
  checkedAt: string
  services: SystemServiceStatusItem[]
}

type RuntimeServicesStatusResponse = {
  checkedAt?: string
  services?: unknown
}

type ServiceStatusMonitorOptions = {
  intervalMs?: number
}

export const SERVICE_STATUS_MONITOR_INTERVAL_MS = 7000

export async function fetchSystemServicesStatusSnapshot(
  client: RuntimeClient
): Promise<SystemServicesStatusResponse> {
  const checkedAt = new Date().toISOString()

  try {
    const health = await client.forward("GET", "/health", undefined, { raw: true })
    const runtimeStatus = health.status >= 200 && health.status < 300
      ? "running"
      : "error"
    const runtimeServices = await client.forward(
      "GET",
      "/runtime/services/status",
      undefined,
      { raw: true }
    )
    const externalServices = normalizeRuntimeServices(
      runtimeServices.data,
      checkedAt
    )

    return {
      checkedAt,
      services: [
        createAgentRuntimeStatus(runtimeStatus, checkedAt),
        ...mergeExternalServices(externalServices, checkedAt),
      ],
    }
  } catch (error) {
    if (!(error instanceof AppError && error.code === "RUNTIME_NOT_READY")) {
      throw error
    }

    return createRuntimeUnavailableStatus(checkedAt)
  }
}

export class ServiceStatusMonitor {
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private previousStatuses: Map<SystemServiceStatusItem["id"], ServiceStatus> | null = null
  private inFlight = false

  constructor(
    private readonly runtimeClient: RuntimeClient,
    private readonly hubEventBus: HubEventBus,
    options: ServiceStatusMonitorOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? SERVICE_STATUS_MONITOR_INTERVAL_MS
  }

  start(): void {
    if (this.timer) return

    void this.checkOnce()
    this.timer = setInterval(() => {
      void this.checkOnce()
    }, this.intervalMs)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async checkOnce(): Promise<SystemServicesStatusResponse | null> {
    if (this.inFlight) return null
    this.inFlight = true

    try {
      const snapshot = await fetchSystemServicesStatusSnapshot(this.runtimeClient)
      this.publishStatusChanges(snapshot)
      return snapshot
    } catch (error) {
      logger.warn({ err: error }, "ServiceStatusMonitor: status check failed")
      return null
    } finally {
      this.inFlight = false
    }
  }

  private publishStatusChanges(snapshot: SystemServicesStatusResponse): void {
    const nextStatuses = new Map<SystemServiceStatusItem["id"], ServiceStatus>()
    for (const service of snapshot.services) {
      nextStatuses.set(service.id, service.status)
    }

    if (!this.previousStatuses) {
      this.previousStatuses = nextStatuses
      return
    }

    for (const service of snapshot.services) {
      const previousStatus = this.previousStatuses.get(service.id)
      if (!previousStatus || previousStatus === service.status) continue

      this.hubEventBus.publish("service.status.changed", {
        previousStatus,
        service,
      })
    }

    this.previousStatuses = nextStatuses
  }
}

function normalizeRuntimeServices(
  body: unknown,
  checkedAt: string
): SystemServiceStatusItem[] {
  const response = body as RuntimeServicesStatusResponse
  if (!Array.isArray(response.services)) {
    return []
  }

  return response.services
    .map((service): SystemServiceStatusItem | null => {
      if (!isRuntimeExternalService(service)) {
        return null
      }
      return {
        id: service.id,
        label: service.label,
        kind: "external-agent",
        status: service.status,
        implemented: service.implemented,
        checkedAt: service.checkedAt ?? checkedAt,
        activeWorkspaceCount: service.activeWorkspaceCount,
        pendingWorkspaceCount: service.pendingWorkspaceCount,
        details: service.details,
      }
    })
    .filter((service): service is SystemServiceStatusItem => Boolean(service))
}

function mergeExternalServices(
  services: SystemServiceStatusItem[],
  checkedAt: string
): SystemServiceStatusItem[] {
  const byId = new Map(services.map((service) => [service.id, service]))
  return [
    byId.get("opencode") ?? createOpenCodeRuntimeUnavailableStatus(checkedAt),
    byId.get("codex") ?? createCodexRuntimeUnavailableStatus(checkedAt),
    byId.get("claude-code") ??
      createClaudeCodeRuntimeUnavailableStatus(checkedAt),
  ]
}

function createRuntimeUnavailableStatus(checkedAt: string): SystemServicesStatusResponse {
  return {
    checkedAt,
    services: [
      createAgentRuntimeStatus("error", checkedAt),
      createOpenCodeRuntimeUnavailableStatus(checkedAt),
      createCodexRuntimeUnavailableStatus(checkedAt),
      createClaudeCodeRuntimeUnavailableStatus(checkedAt),
    ],
  }
}

function createAgentRuntimeStatus(
  status: "running" | "error",
  checkedAt: string
): SystemServiceStatusItem {
  return {
    id: "agent-runtime",
    label: "AgentRuntime",
    kind: "runtime",
    status,
    implemented: true,
    checkedAt,
  }
}

function createOpenCodeRuntimeUnavailableStatus(checkedAt: string): SystemServiceStatusItem {
  return {
    id: "opencode",
    label: "OpenCode",
    kind: "external-agent",
    status: "error",
    implemented: true,
    checkedAt,
    details: {
      reason: "runtime-unavailable",
    },
  }
}

function createCodexRuntimeUnavailableStatus(checkedAt: string): SystemServiceStatusItem {
  return {
    id: "codex",
    label: "Codex",
    kind: "external-agent",
    status: "error",
    implemented: true,
    checkedAt,
    details: {
      reason: "runtime-unavailable",
    },
  }
}

function createClaudeCodeRuntimeUnavailableStatus(checkedAt: string): SystemServiceStatusItem {
  return {
    id: "claude-code",
    label: "Claude Code",
    kind: "external-agent",
    status: "error",
    implemented: true,
    checkedAt,
    details: {
      reason: "runtime-unavailable",
    },
  }
}

function isRuntimeExternalService(value: unknown): value is Omit<SystemServiceStatusItem, "kind"> & {
  id: "opencode" | "codex" | "claude-code"
  kind?: "external-agent"
} {
  if (!value || typeof value !== "object") return false
  const service = value as Record<string, unknown>
  return (
    (service.id === "opencode" ||
      service.id === "codex" ||
      service.id === "claude-code") &&
    typeof service.label === "string" &&
    isServiceStatus(service.status) &&
    typeof service.implemented === "boolean"
  )
}

function isServiceStatus(value: unknown): value is ServiceStatus {
  return value === "running" ||
    value === "starting" ||
    value === "idle" ||
    value === "error" ||
    value === "not_integrated"
}
