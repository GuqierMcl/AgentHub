export type ServiceStatusValue =
  | "running"
  | "starting"
  | "idle"
  | "error"
  | "not_integrated"
  | "refreshing"

export type SystemServiceStatusItem = {
  id: "agent-runtime" | "opencode" | "codex" | "claude-code" | "capability-discovery" | "mcp-runtime"
  label: string
  kind: "runtime" | "external-agent" | "runtime-capability"
  status: ServiceStatusValue
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

export async function fetchSystemServicesStatus(
  signal?: AbortSignal
): Promise<SystemServicesStatusResponse> {
  const response = await fetch("/api/system/services/status", { signal })
  if (!response.ok) {
    throw new Error(`服务状态请求失败 (${response.status})`)
  }
  return response.json()
}
