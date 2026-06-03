import type { ManagedOpenCodeServer } from "./external-adapters"

export type RuntimeServiceStatus =
  | "running"
  | "starting"
  | "idle"
  | "error"
  | "not_integrated"

export type RuntimeServiceStatusItem = {
  id: "opencode" | "codex" | "claude-code"
  label: string
  kind: "external-agent"
  status: RuntimeServiceStatus
  implemented: boolean
  checkedAt: string
  activeWorkspaceCount?: number
  pendingWorkspaceCount?: number
  details?: Record<string, unknown>
}

export type RuntimeServicesStatusResponse = {
  checkedAt: string
  services: RuntimeServiceStatusItem[]
}

export function createRuntimeServicesStatus(
  openCodeServer: Pick<ManagedOpenCodeServer, "getStatus">
): RuntimeServicesStatusResponse {
  const checkedAt = new Date().toISOString()
  return {
    checkedAt,
    services: [
      createOpenCodeServiceStatus(openCodeServer, checkedAt),
      createPlaceholderServiceStatus("codex", "Codex", checkedAt),
      createPlaceholderServiceStatus("claude-code", "Claude Code", checkedAt),
    ],
  }
}

function createOpenCodeServiceStatus(
  openCodeServer: Pick<ManagedOpenCodeServer, "getStatus">,
  checkedAt: string
): RuntimeServiceStatusItem {
  const status = openCodeServer.getStatus()
  return {
    id: "opencode",
    label: "OpenCode",
    kind: "external-agent",
    status: status.status,
    implemented: true,
    checkedAt,
    activeWorkspaceCount: status.activeWorkspaceCount,
    pendingWorkspaceCount: status.pendingWorkspaceCount,
    details: {
      mode: status.mode,
      ...(status.lastError ? { lastError: status.lastError } : {}),
    },
  }
}

function createPlaceholderServiceStatus(
  id: "codex" | "claude-code",
  label: string,
  checkedAt: string
): RuntimeServiceStatusItem {
  return {
    id,
    label,
    kind: "external-agent",
    status: "not_integrated",
    implemented: false,
    checkedAt,
  }
}
