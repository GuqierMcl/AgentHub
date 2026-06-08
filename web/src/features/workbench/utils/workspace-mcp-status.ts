import type { ServiceStatusTone } from "@/features/app-shell/utils/service-status-copy"
import type {
  WorkspaceMcpStatusResponse,
  WorkspaceMcpServerStatus,
} from "../api/workspace-mcp-status"

export type WorkspaceMcpStatusBarItem = {
  id: string
  label: string
  status: WorkspaceMcpServerStatus
  statusLabel: string
  tone: ServiceStatusTone
  description?: string
}

export function getWorkspaceMcpStatusBarItems(
  status?: WorkspaceMcpStatusResponse
): WorkspaceMcpStatusBarItem[] {
  if (!status || status.servers.length === 0) {
    return []
  }

  return status.servers.map((server) => ({
    id: `mcp:${server.id}`,
    label: server.name,
    status: server.status,
    statusLabel: `${getWorkspaceMcpStatusLabel(server.status)} · ${server.toolCount} 个工具`,
    tone: getWorkspaceMcpStatusTone(server.status),
    ...(server.latestError ? { description: server.latestError } : {}),
  }))
}

export function getWorkspaceMcpStatusLabel(status: WorkspaceMcpServerStatus): string {
  switch (status) {
    case "connected":
      return "已连接"
    case "connecting":
      return "连接中"
    case "discovered":
      return "已发现"
    case "disabled":
      return "已停用"
    case "error":
      return "错误"
  }
}

export function getWorkspaceMcpStatusTone(status: WorkspaceMcpServerStatus): ServiceStatusTone {
  switch (status) {
    case "connected":
      return "success"
    case "connecting":
      return "warning"
    case "error":
      return "danger"
    case "discovered":
    case "disabled":
      return "muted"
  }
}
