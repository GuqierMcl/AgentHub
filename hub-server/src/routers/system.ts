import { Hono, type Context } from "hono"
import type { RuntimeClient } from "../lib/runtime"
import { AppError } from "../lib/errors"

declare module "hono" {
  interface ContextVariableMap {
    runtimeClient: RuntimeClient
  }
}

type ServiceStatus = "running" | "starting" | "idle" | "error" | "not_integrated"

type SystemServiceStatusItem = {
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

type RuntimeServicesStatusResponse = {
  checkedAt?: string
  services?: unknown
}

const system = new Hono()

system.get("/api/system/services/status", async (c: Context) => {
  const checkedAt = new Date().toISOString()
  const client = c.get("runtimeClient")

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

    return c.json({
      checkedAt,
      services: [
        createAgentRuntimeStatus(runtimeStatus, checkedAt),
        ...mergeExternalServices(externalServices, checkedAt),
      ],
    })
  } catch (error) {
    if (!(error instanceof AppError && error.code === "RUNTIME_NOT_READY")) {
      throw error
    }

    return c.json({
      checkedAt,
      services: [
        createAgentRuntimeStatus("error", checkedAt),
        createOpenCodeRuntimeUnavailableStatus(checkedAt),
        createPlaceholderStatus("codex", "Codex", checkedAt),
        createPlaceholderStatus("claude-code", "Claude Code", checkedAt),
      ],
    })
  }
})

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
    byId.get("codex") ?? createPlaceholderStatus("codex", "Codex", checkedAt),
    byId.get("claude-code") ??
      createPlaceholderStatus("claude-code", "Claude Code", checkedAt),
  ]
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

function createPlaceholderStatus(
  id: "codex" | "claude-code",
  label: string,
  checkedAt: string
): SystemServiceStatusItem {
  return {
    id,
    label,
    kind: "external-agent",
    status: "not_integrated",
    implemented: false,
    checkedAt,
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

export default system
